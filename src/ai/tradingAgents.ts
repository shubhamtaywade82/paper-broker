import { OllamaClient } from '@nemesis-oss/ollama-sdk';
import {
  AnalystReportSchema,
  DebateVerdictSchema,
  TraderDecisionSchema,
  type AnalystReport,
  type DebateEntry,
  type DebateVerdict,
  type TraderDecision,
  type RiskOpinion,
  type FundManagerApproval,
  type CycleRecord,
} from './schemas.js';
import type { SignalInput } from '../strategy/signal.js';
import { parseSignalInput } from '../strategy/signal.js';
import { logger } from '../telemetry/logger.js';

export interface TradingAgentsConfig {
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  debateRounds?: number;
}

export type AgentCycleStage =
  | 'analyst_team'
  | 'debate_bull'
  | 'debate_bear'
  | 'debate_verdict'
  | 'trader_decision'
  | 'risk_team'
  | 'fund_manager';

export interface AgentCycleStep {
  cycleId: string;
  symbol: string;
  stage: AgentCycleStage;
  status: 'started' | 'completed' | 'failed';
  detail?: string;
  timestamp: number;
}

export type AgentCycleStepListener = (step: AgentCycleStep) => void;

export interface MarketFactContext {
  symbol: string;
  lastPrice: number;
  bid: number;
  ask: number;
  spread: number;
  mark: number;
  fundingRate?: number;
  openInterest?: number;
  candlesSummary?: string;
  accountEquity?: number;
  availableBalance?: number;
}

export class TradingAgentsPipeline {
  private client: OllamaClient;
  private config: Required<TradingAgentsConfig>;

  constructor(config: TradingAgentsConfig) {
    this.config = {
      model: config.model,
      baseUrl: config.baseUrl ?? 'http://localhost:11434',
      timeoutMs: config.timeoutMs ?? 60_000,
      debateRounds: config.debateRounds ?? 2,
    };
    this.client = new OllamaClient({
      baseUrl: this.config.baseUrl,
      timeoutMs: this.config.timeoutMs,
    });
  }

  /** Best-effort reachability probe — never throws, used for startup operator visibility only. */
  async checkOllamaReachable(): Promise<boolean> {
    try {
      const results = await this.client.healthCheck();
      return results.some((r) => r.reachable);
    } catch {
      return false;
    }
  }

  async runCycle(ctx: MarketFactContext, onStep?: AgentCycleStepListener): Promise<CycleRecord> {
    const startedAt = Date.now();
    const cycleId = `cycle_${ctx.symbol}_${startedAt}`;

    const analystReports = await this.runAnalystTeam(cycleId, ctx, onStep);
    const { debate, verdict } = await this.runDebate(cycleId, ctx.symbol, analystReports, onStep);
    const traderDecision = await this.runTrader(cycleId, ctx, verdict, analystReports, onStep);
    const riskOpinions = await this.runRiskTeam(cycleId, ctx, traderDecision, onStep);
    const fundManagerApproval = await this.runFundManager(cycleId, traderDecision, riskOpinions, onStep);

    return {
      cycleId,
      symbol: ctx.symbol,
      startedAt,
      analystReports,
      debate,
      verdict,
      traderDecision,
      riskOpinions,
      fundManagerApproval,
      executed: fundManagerApproval.approved && fundManagerApproval.finalDecision.action !== 'NEUTRAL',
    };
  }

  toSignalInput(approval: FundManagerApproval, strategyId = 'trading-agents-v1'): SignalInput | null {
    if (!approval.approved || approval.finalDecision.action === 'NEUTRAL') {
      return null;
    }
    const d = approval.finalDecision;
    const action = d.action === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT';

    return parseSignalInput({
      strategyId,
      symbol: d.symbol,
      action,
      confidence: d.confidence,
      stopLossPrice: d.stopLoss ? String(d.stopLoss) : undefined,
      takeProfitPrice: d.takeProfit ? String(d.takeProfit) : undefined,
      reasoning: `[TradingAgents] ${approval.rationale} | Trader: ${d.rationale}`,
      ttlMs: 60_000,
      features: { leverage: d.leverage, sizePct: d.sizePct },
    });
  }

  private emitStep(
    onStep: AgentCycleStepListener | undefined,
    cycleId: string,
    symbol: string,
    stage: AgentCycleStage,
    status: AgentCycleStep['status'],
    detail?: string
  ): void {
    onStep?.({ cycleId, symbol, stage, status, detail, timestamp: Date.now() });
  }

  private async runAnalystTeam(
    cycleId: string,
    ctx: MarketFactContext,
    onStep?: AgentCycleStepListener
  ): Promise<AnalystReport[]> {
    this.emitStep(onStep, cycleId, ctx.symbol, 'analyst_team', 'started');
    const prompt = [
      `Analyze crypto futures derivatives and order flow for ${ctx.symbol}:`,
      `Last Price: ${ctx.lastPrice}, Bid: ${ctx.bid}, Ask: ${ctx.ask}, Spread: ${ctx.spread}`,
      `Mark Price: ${ctx.mark}, Funding: ${ctx.fundingRate ?? 0.0001}, OI: ${ctx.openInterest ?? 0}`,
      ctx.candlesSummary ? `Price Action:\n${ctx.candlesSummary}` : '',
    ].filter(Boolean).join('\n');

    try {
      const report = await this.client.generateWithSchema<AnalystReport>(
        {
          model: this.config.model,
          prompt,
          system: 'You are a crypto derivatives analyst. Identify funding crowding, liquidation magnets, and order flow balance. Output valid JSON.',
          think: false,
          options: { temperature: 0.2 },
        },
        AnalystReportSchema
      );
      this.emitStep(onStep, cycleId, ctx.symbol, 'analyst_team', 'completed', report.summary);
      return [report];
    } catch (err) {
      logger.warn({ cycleId, symbol: ctx.symbol, model: this.config.model, error: (err as Error).message }, '[TradingAgents] analyst team call failed, using deterministic fallback');
      this.emitStep(onStep, cycleId, ctx.symbol, 'analyst_team', 'failed', (err as Error).message);
      // Deterministic fallback report when offline or model unavailable
      return [{
        agent: 'DerivativesAnalyst',
        symbol: ctx.symbol,
        timestamp: Date.now(),
        summary: `Spread: ${ctx.spread.toFixed(2)}, Mark: ${ctx.mark.toFixed(2)}`,
        bullishSignals: ctx.lastPrice > ctx.mark ? ['Price trading above mark'] : [],
        bearishSignals: ctx.lastPrice < ctx.mark ? ['Price trading below mark'] : [],
        keyMetrics: { spread: ctx.spread, mark: ctx.mark },
        confidence: 0.5,
      }];
    }
  }

  private async runDebate(
    cycleId: string,
    symbol: string,
    reports: AnalystReport[],
    onStep?: AgentCycleStepListener
  ): Promise<{ debate: DebateEntry[]; verdict: DebateVerdict }> {
    const debate: DebateEntry[] = [];
    const reportSummary = JSON.stringify(reports);

    // Round 1: Bull opening case
    this.emitStep(onStep, cycleId, symbol, 'debate_bull', 'started');
    const bullPrompt = `Analyst context: ${reportSummary}\nPresent the strongest evidence for a LONG position on ${symbol}.`;
    const bullArg = await this.generateProse(cycleId, symbol, 'debate_bull', bullPrompt, 'You are a bullish researcher. Present a crisp evidence-grounded long case.', onStep);
    debate.push({ role: 'BULL', round: 1, argument: bullArg });

    // Round 1: Bear rebuttal
    this.emitStep(onStep, cycleId, symbol, 'debate_bear', 'started');
    const bearPrompt = `Analyst context: ${reportSummary}\nBull argument: "${bullArg}"\nRebut the bull case and argue for SHORT or FLAT on ${symbol}.`;
    const bearArg = await this.generateProse(cycleId, symbol, 'debate_bear', bearPrompt, 'You are a bearish researcher. Highlight leverage risks and rejection levels.', onStep);
    debate.push({ role: 'BEAR', round: 1, argument: bearArg });

    // Facilitator evaluation
    const verdict = await this.judgeDebate(cycleId, symbol, debate, onStep);
    return { debate, verdict };
  }

  private async judgeDebate(
    cycleId: string,
    symbol: string,
    debate: DebateEntry[],
    onStep?: AgentCycleStepListener
  ): Promise<DebateVerdict> {
    this.emitStep(onStep, cycleId, symbol, 'debate_verdict', 'started');
    const prompt = `Debate for ${symbol}:\n${JSON.stringify(debate)}\nJudge which side presented stronger evidence. Return valid JSON.`;
    try {
      const verdict = await this.client.generateWithSchema<DebateVerdict>(
        {
          model: this.config.model,
          prompt,
          system: 'You are an impartial trading debate judge. Output valid JSON verdict.',
          think: false,
          options: { temperature: 0.1 },
        },
        DebateVerdictSchema
      );
      this.emitStep(onStep, cycleId, symbol, 'debate_verdict', 'completed', `${verdict.prevailingSide} (${verdict.conviction})`);
      return verdict;
    } catch (err) {
      logger.warn({ cycleId, symbol, model: this.config.model, error: (err as Error).message }, '[TradingAgents] debate judge call failed, using NEUTRAL fallback');
      this.emitStep(onStep, cycleId, symbol, 'debate_verdict', 'failed', (err as Error).message);
      return { prevailingSide: 'NEUTRAL', rationale: 'Debate inconclusive', conviction: 0.5 };
    }
  }

  private async runTrader(
    cycleId: string,
    ctx: MarketFactContext,
    verdict: DebateVerdict,
    reports: AnalystReport[],
    onStep?: AgentCycleStepListener
  ): Promise<TraderDecision> {
    this.emitStep(onStep, cycleId, ctx.symbol, 'trader_decision', 'started');
    const prompt = [
      `Symbol: ${ctx.symbol}, Price: ${ctx.lastPrice}`,
      `Debate Verdict: ${verdict.prevailingSide} (Conviction: ${verdict.conviction})`,
      `Rationale: ${verdict.rationale}`,
      `Reports: ${JSON.stringify(reports)}`,
      'Formulate a trade decision. Output valid JSON with exactly these fields:',
      '- action: "LONG", "SHORT", or "NEUTRAL"',
      '- leverage: number between 1 and 20',
      '- sizePct: fraction of account equity to risk, a number between 0 and 0.25 (e.g. 0.1 = 10%, NOT 10)',
      '- confidence: a number between 0 and 1 (e.g. 0.7, NOT 70)',
      '- stopLoss, takeProfit: price levels (numbers)',
      '- rationale: short string',
    ].join('\n');

    try {
      const decision = await this.client.generateWithSchema<TraderDecision>(
        {
          model: this.config.model,
          prompt,
          system: 'You are an institutional crypto futures trader. Prioritize risk-defined entries. Output valid JSON.',
          think: false,
          options: { temperature: 0.2 },
        },
        TraderDecisionSchema
      );
      this.emitStep(onStep, cycleId, ctx.symbol, 'trader_decision', 'completed', `${decision.action} conf=${decision.confidence}`);
      return decision;
    } catch (err) {
      logger.warn({ cycleId, symbol: ctx.symbol, model: this.config.model, error: (err as Error).message }, '[TradingAgents] trader call failed, using NEUTRAL fallback');
      this.emitStep(onStep, cycleId, ctx.symbol, 'trader_decision', 'failed', (err as Error).message);
      return {
        symbol: ctx.symbol,
        action: 'NEUTRAL',
        leverage: 1,
        sizePct: 0,
        rationale: 'Trader fallback to neutral',
        confidence: 0,
      };
    }
  }

  private async runRiskTeam(
    cycleId: string,
    ctx: MarketFactContext,
    decision: TraderDecision,
    onStep?: AgentCycleStepListener
  ): Promise<RiskOpinion[]> {
    this.emitStep(onStep, cycleId, ctx.symbol, 'risk_team', 'started');
    const personas: Array<'RISKY' | 'NEUTRAL' | 'SAFE'> = ['SAFE', 'NEUTRAL'];
    const opinions: RiskOpinion[] = [];

    for (const persona of personas) {
      opinions.push({
        persona,
        verdict: decision.action === 'NEUTRAL' ? 'APPROVE' : persona === 'SAFE' && decision.leverage > 5 ? 'REDUCE_LEVERAGE' : 'APPROVE',
        adjustedLeverage: persona === 'SAFE' && decision.leverage > 5 ? Math.min(3, decision.leverage) : decision.leverage,
        rationale: `${persona} risk evaluation against equity ${ctx.accountEquity ?? 10000}`,
      });
    }

    this.emitStep(onStep, cycleId, ctx.symbol, 'risk_team', 'completed');
    return opinions;
  }

  private async runFundManager(
    cycleId: string,
    decision: TraderDecision,
    riskOpinions: RiskOpinion[],
    onStep?: AgentCycleStepListener
  ): Promise<FundManagerApproval> {
    this.emitStep(onStep, cycleId, decision.symbol, 'fund_manager', 'started');
    const safeOpinion = riskOpinions.find((o) => o.persona === 'SAFE');
    const finalDecision = { ...decision };

    if (safeOpinion?.adjustedLeverage) {
      finalDecision.leverage = safeOpinion.adjustedLeverage;
    }

    const approved = decision.action !== 'NEUTRAL' && decision.confidence >= 0.5;

    this.emitStep(onStep, cycleId, decision.symbol, 'fund_manager', 'completed', approved ? 'APPROVED' : 'REJECTED');
    return {
      approved,
      finalDecision,
      rationale: approved
        ? `Approved with leverage ${finalDecision.leverage}x based on risk team consensus`
        : 'Trade rejected or held neutral due to risk limits',
    };
  }

  private async generateProse(
    cycleId: string,
    symbol: string,
    stage: AgentCycleStage,
    prompt: string,
    system: string,
    onStep?: AgentCycleStepListener
  ): Promise<string> {
    try {
      const res = await this.client.chat({
        model: this.config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        think: false,
        options: { temperature: 0.4 },
      });
      const text = res.message.content.trim() || 'No argument provided.';
      this.emitStep(onStep, cycleId, symbol, stage, 'completed', text.slice(0, 160));
      return text;
    } catch (err) {
      logger.warn({ cycleId, symbol, stage, model: this.config.model, error: (err as Error).message }, '[TradingAgents] researcher call failed, using fallback text');
      this.emitStep(onStep, cycleId, symbol, stage, 'failed', (err as Error).message);
      return 'Argument generation unavailable.';
    }
  }
}
