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

export interface TradingAgentsConfig {
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  debateRounds?: number;
}

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

  async runCycle(ctx: MarketFactContext): Promise<CycleRecord> {
    const startedAt = Date.now();
    const cycleId = `cycle_${ctx.symbol}_${startedAt}`;

    const analystReports = await this.runAnalystTeam(ctx);
    const { debate, verdict } = await this.runDebate(ctx.symbol, analystReports);
    const traderDecision = await this.runTrader(ctx, verdict, analystReports);
    const riskOpinions = await this.runRiskTeam(ctx, traderDecision);
    const fundManagerApproval = await this.runFundManager(traderDecision, riskOpinions);

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

  private async runAnalystTeam(ctx: MarketFactContext): Promise<AnalystReport[]> {
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
          options: { temperature: 0.2 },
        },
        AnalystReportSchema
      );
      return [report];
    } catch {
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

  private async runDebate(symbol: string, reports: AnalystReport[]): Promise<{ debate: DebateEntry[]; verdict: DebateVerdict }> {
    const debate: DebateEntry[] = [];
    const reportSummary = JSON.stringify(reports);

    // Round 1: Bull opening case
    const bullPrompt = `Analyst context: ${reportSummary}\nPresent the strongest evidence for a LONG position on ${symbol}.`;
    const bullArg = await this.generateProse(bullPrompt, 'You are a bullish researcher. Present a crisp evidence-grounded long case.');
    debate.push({ role: 'BULL', round: 1, argument: bullArg });

    // Round 1: Bear rebuttal
    const bearPrompt = `Analyst context: ${reportSummary}\nBull argument: "${bullArg}"\nRebut the bull case and argue for SHORT or FLAT on ${symbol}.`;
    const bearArg = await this.generateProse(bearPrompt, 'You are a bearish researcher. Highlight leverage risks and rejection levels.');
    debate.push({ role: 'BEAR', round: 1, argument: bearArg });

    // Facilitator evaluation
    const verdict = await this.judgeDebate(symbol, debate);
    return { debate, verdict };
  }

  private async judgeDebate(symbol: string, debate: DebateEntry[]): Promise<DebateVerdict> {
    const prompt = `Debate for ${symbol}:\n${JSON.stringify(debate)}\nJudge which side presented stronger evidence. Return valid JSON.`;
    try {
      return await this.client.generateWithSchema<DebateVerdict>(
        {
          model: this.config.model,
          prompt,
          system: 'You are an impartial trading debate judge. Output valid JSON verdict.',
          options: { temperature: 0.1 },
        },
        DebateVerdictSchema
      );
    } catch {
      return { prevailingSide: 'NEUTRAL', rationale: 'Debate inconclusive', conviction: 0.5 };
    }
  }

  private async runTrader(ctx: MarketFactContext, verdict: DebateVerdict, reports: AnalystReport[]): Promise<TraderDecision> {
    const prompt = [
      `Symbol: ${ctx.symbol}, Price: ${ctx.lastPrice}`,
      `Debate Verdict: ${verdict.prevailingSide} (Conviction: ${verdict.conviction})`,
      `Rationale: ${verdict.rationale}`,
      `Reports: ${JSON.stringify(reports)}`,
      'Formulate trade decision with action (LONG/SHORT/NEUTRAL), leverage (1-10x), stopLoss, and takeProfit. Output valid JSON.',
    ].join('\n');

    try {
      return await this.client.generateWithSchema<TraderDecision>(
        {
          model: this.config.model,
          prompt,
          system: 'You are an institutional crypto futures trader. Prioritize risk-defined entries. Output valid JSON.',
          options: { temperature: 0.2 },
        },
        TraderDecisionSchema
      );
    } catch {
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

  private async runRiskTeam(ctx: MarketFactContext, decision: TraderDecision): Promise<RiskOpinion[]> {
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

    return opinions;
  }

  private async runFundManager(decision: TraderDecision, riskOpinions: RiskOpinion[]): Promise<FundManagerApproval> {
    const safeOpinion = riskOpinions.find((o) => o.persona === 'SAFE');
    const finalDecision = { ...decision };

    if (safeOpinion?.adjustedLeverage) {
      finalDecision.leverage = safeOpinion.adjustedLeverage;
    }

    const approved = decision.action !== 'NEUTRAL' && decision.confidence >= 0.5;

    return {
      approved,
      finalDecision,
      rationale: approved
        ? `Approved with leverage ${finalDecision.leverage}x based on risk team consensus`
        : 'Trade rejected or held neutral due to risk limits',
    };
  }

  private async generateProse(prompt: string, system: string): Promise<string> {
    try {
      const res = await this.client.chat({
        model: this.config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        options: { temperature: 0.4 },
      });
      return res.message.content.trim() || 'No argument provided.';
    } catch {
      return 'Argument generation unavailable.';
    }
  }
}
