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

/**
 * Limits the deterministic risk stage enforces. Deliberately separate from
 * RiskConfig (src/trading/risk): this bounds what the *agent pipeline* is
 * willing to propose, and RiskEngine independently re-validates whatever
 * survives before an order is built. Two gates, not one.
 */
export interface AgentRiskPolicy {
  personaCeilings: Record<
    'SAFE' | 'NEUTRAL' | 'RISKY',
    { maxLeverage: number; maxSizePct: number; minConfidence: number }
  >;
  /** Reject a directional proposal that carries no stop loss. */
  requireStopLoss: boolean;
  /** Fund manager's own confidence floor, applied after the personas. */
  minApprovalConfidence: number;
}

export const DEFAULT_AGENT_RISK_POLICY: AgentRiskPolicy = {
  personaCeilings: {
    SAFE: { maxLeverage: 3, maxSizePct: 0.05, minConfidence: 0.65 },
    NEUTRAL: { maxLeverage: 5, maxSizePct: 0.1, minConfidence: 0.55 },
    RISKY: { maxLeverage: 10, maxSizePct: 0.15, minConfidence: 0.45 },
  },
  requireStopLoss: true,
  minApprovalConfidence: 0.5,
};

export interface TradingAgentsConfig {
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  debateRounds?: number;
  apiKeys?: string[];
  cloudBaseUrl?: string;
  cloudModel?: string;
  riskPolicy?: AgentRiskPolicy;
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
  /**
   * What actually produced this stage.
   *
   * The pipeline mixes genuine LLM stages (analyst, debate, trader) with
   * deterministic policy stages (risk team, fund manager — see the note on
   * runRiskTeam). Presenting all seven identically as "agents" in the
   * dashboard and the event log overstates how much of the decision an LLM
   * makes. This field makes the distinction explicit at the point the step is
   * emitted, so no consumer has to infer it.
   */
  engine: 'llm' | 'deterministic';
}

export type AgentCycleStepListener = (step: AgentCycleStep) => void;

/**
 * Result of a veto consultation (AUTONOMY_AUDIT Finding 1).
 *
 * The autonomous agent calls {@link TradingAgentsPipeline.runVetoConsultation}
 * before submitting an entry: instead of only *probing* the LLM for a
 * confidence number, the setup is put in front of the full bull/bear debate
 * and the trader stage, and their verdict can VETO the trade.
 *
 * The veto rule lives with the caller (the agent), but the contract is:
 * - `action` NEUTRAL, or opposing the intended direction → veto.
 * - `degraded === true` → at least one LLM stage fell back to its
 *   deterministic fallback, so the verdict is NOT a genuine model opinion —
 *   the caller must NOT veto on a degraded consultation (the agent's
 *   "never blocks on Ollama availability" property depends on this).
 */
export interface VetoConsultation {
  /** Trader stage's final action. */
  action: TraderDecision['action'];
  /** Debate judge's prevailing side. */
  prevailingSide: DebateVerdict['prevailingSide'];
  /** Trader stage's confidence (0..1). */
  confidence: number;
  /** True when any LLM stage failed and fell back — see interface doc. */
  degraded: boolean;
  /** Compact rationale for logs / the rejection broadcast. */
  rationale: string;
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
  /**
   * Self-learning memory: a one-line summary of this setup archetype's
   * realized track record, supplied by the strategy layer (see
   * smc-agent.ts's buildSetupMemory). Advisory context only — it informs the
   * analyst/trader prompts, never the deterministic risk/fund-manager stages,
   * per CONTRACTS.md Section 5 (LLM Authority Contract).
   */
  setupMemory?: string;
  /**
   * Agent memory block — distilled, decay-weighted lessons from past closed
   * trades (see AgentMemoryStore / SelfImprovementLoop). Advisory only, same
   * contract as setupMemory. Empty string when the memory store is empty or
   * disabled; the analyst stage treats empty as "no memory" and proceeds
   * normally.
   *
   * (feature/agentic-upgrade)
   */
  agentMemory?: string;
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
      apiKeys: (config.apiKeys ?? []).filter(Boolean),
      cloudBaseUrl: config.cloudBaseUrl ?? 'https://ollama.com',
      cloudModel: config.cloudModel ?? 'gemma4:cloud',
      riskPolicy: config.riskPolicy ?? DEFAULT_AGENT_RISK_POLICY,
    };

    const endpoints: Array<{ name: string; baseUrl: string; apiKey?: string; priority?: number }> = [];

    // Register all configured cloud account keys in priority order (1..N)
    this.config.apiKeys.forEach((key, idx) => {
      endpoints.push({
        name: `ollama-cloud-account-${idx + 1}`,
        baseUrl: this.config.cloudBaseUrl,
        apiKey: key,
        priority: idx + 1,
      });
    });

    // Local daemon fallback endpoint
    endpoints.push({
      name: 'ollama-local-daemon',
      baseUrl: this.config.baseUrl,
      priority: 10,
    });

    this.client = new OllamaClient({
      endpoints,
      timeoutMs: this.config.timeoutMs,
      failoverOn: ['rate_limited', 'network_error', 'server_error', 'unsupported_capability', 'timeout'],
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

  /**
   * Debate-driven veto consultation (AUTONOMY_AUDIT Finding 1).
   *
   * Runs the LLM stages of the pipeline — analyst team, bull/bear debate,
   * judge, trader — WITHOUT the deterministic risk-team / fund-manager stages:
   * the autonomous agent already has its own AdaptiveRiskManager,
   * CircuitBreaker and the canonical RiskEngine behind it, and
   * CONTRACTS.md Section 5 keeps risk authority out of model hands anyway.
   *
   * The caller (the agent) treats a genuine NEUTRAL / opposing `action` as a
   * veto, and MUST ignore the verdict when `degraded` is true — see
   * {@link VetoConsultation}.
   */
  async runVetoConsultation(
    ctx: MarketFactContext,
    _direction: 'LONG' | 'SHORT',
    onStep?: AgentCycleStepListener
  ): Promise<VetoConsultation> {
    const cycleId = `veto_${ctx.symbol}_${Date.now()}`;

    // Any LLM stage that emits 'failed' means we're on a deterministic
    // fallback path — the resulting action is not a genuine model opinion.
    let degraded = false;
    const trackingListener: AgentCycleStepListener = (step) => {
      if (step.status === 'failed' && step.engine === 'llm') degraded = true;
      onStep?.(step);
    };

    const analystReports = await this.runAnalystTeam(cycleId, ctx, trackingListener);
    const { verdict } = await this.runDebate(cycleId, ctx.symbol, analystReports, trackingListener);
    const traderDecision = await this.runTrader(cycleId, ctx, verdict, analystReports, trackingListener);

    return {
      action: traderDecision.action,
      prevailingSide: verdict.prevailingSide,
      confidence: traderDecision.confidence,
      degraded,
      rationale: `verdict=${verdict.prevailingSide} (${verdict.rationale}) | trader=${traderDecision.action} conf=${traderDecision.confidence.toFixed(2)} (${traderDecision.rationale})`,
    };
  }

  private static readonly STAGE_ENGINE: Record<AgentCycleStage, 'llm' | 'deterministic'> = {
    analyst_team: 'llm',
    debate_bull: 'llm',
    debate_bear: 'llm',
    debate_verdict: 'llm',
    trader_decision: 'llm',
    risk_team: 'deterministic',
    fund_manager: 'deterministic',
  };

  private emitStep(
    onStep: AgentCycleStepListener | undefined,
    cycleId: string,
    symbol: string,
    stage: AgentCycleStage,
    status: AgentCycleStep['status'],
    detail?: string
  ): void {
    onStep?.({
      cycleId,
      symbol,
      stage,
      status,
      detail,
      timestamp: Date.now(),
      engine: TradingAgentsPipeline.STAGE_ENGINE[stage],
    });
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
      ctx.setupMemory ? `Historical track record for this setup: ${ctx.setupMemory}` : '',
      ctx.agentMemory ? `Agent memory (lessons from past closed trades):\n${ctx.agentMemory}` : '',
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
    // H-17: `debateRounds` was accepted in config, stored on `this.config`,
    // and never read anywhere — this method always ran exactly one bull/bear
    // exchange regardless of what it was set to. Now actually drives the
    // number of rounds, with each round's arguments responding to the
    // debate transcript so far rather than repeating the opening case.
    const rounds = Math.max(1, this.config.debateRounds);

    for (let round = 1; round <= rounds; round++) {
      const priorDebate = debate.length > 0 ? `\nDebate so far: ${JSON.stringify(debate)}` : '';

      this.emitStep(onStep, cycleId, symbol, 'debate_bull', 'started');
      const bullPrompt = `Analyst context: ${reportSummary}${priorDebate}\nPresent the strongest evidence for a LONG position on ${symbol} (round ${round} of ${rounds}).`;
      const bullArg = await this.generateProse(
        cycleId, symbol, 'debate_bull', bullPrompt,
        'You are a bullish researcher. Present a crisp evidence-grounded long case, directly rebutting the bear\'s prior points if any exist.',
        onStep
      );
      debate.push({ role: 'BULL', round, argument: bullArg });

      this.emitStep(onStep, cycleId, symbol, 'debate_bear', 'started');
      const bearPrompt = `Analyst context: ${reportSummary}\nBull argument: "${bullArg}"${priorDebate}\nRebut the bull case and argue for SHORT or FLAT on ${symbol} (round ${round} of ${rounds}).`;
      const bearArg = await this.generateProse(
        cycleId, symbol, 'debate_bear', bearPrompt,
        'You are a bearish researcher. Highlight leverage risks and rejection levels, directly rebutting the bull\'s point above.',
        onStep
      );
      debate.push({ role: 'BEAR', round, argument: bearArg });
    }

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
      ctx.setupMemory ? `Historical track record for this setup: ${ctx.setupMemory} Weigh a poor track record toward lower confidence or NEUTRAL.` : '',
      ctx.agentMemory ? `Agent memory (advisory lessons from past closed trades):\n${ctx.agentMemory}` : '',
      'Formulate a trade decision. Output valid JSON with exactly these fields:',
      '- action: "LONG", "SHORT", or "NEUTRAL"',
      '- leverage: number between 1 and 20',
      '- sizePct: fraction of account equity to risk, a number between 0 and 0.25 (e.g. 0.1 = 10%, NOT 10)',
      '- confidence: a number between 0 and 1 (e.g. 0.7, NOT 70)',
      '- stopLoss, takeProfit: price levels (numbers)',
      '- rationale: short string',
    ].filter(Boolean).join('\n');

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

  /**
   * Risk team and fund manager are deterministic by design — this is the one
   * stage of the pipeline an LLM is not allowed to drive.
   *
   * CONTRACTS.md Section 5 (LLM Authority Contract) states the LLM may NOT
   * "override risk checks", and AGENTS.md requires treating LLM reasoning as
   * "advisory/orchestrating, never as an authority over risk". Risk approval
   * is precisely that authority: it is the gate deciding whether a trade
   * executes at all. Routing it through a model call would be the contract
   * violation, not the fix — a prompt-injected or simply hallucinating model
   * could approve unbounded leverage.
   *
   * What was genuinely incomplete, and is fixed here, is that the policy was a
   * stub: it evaluated only two of the three declared personas and its only
   * rule was `leverage > 5`. It now evaluates all three personas against the
   * risk limits actually in force and can return every verdict in
   * RiskOpinionSchema, and every step it emits is tagged `engine:
   * 'deterministic'` so no dashboard or event-log consumer can mistake it for
   * model output.
   */
  private async runRiskTeam(
    cycleId: string,
    ctx: MarketFactContext,
    decision: TraderDecision,
    onStep?: AgentCycleStepListener
  ): Promise<RiskOpinion[]> {
    this.emitStep(onStep, cycleId, ctx.symbol, 'risk_team', 'started');

    const limits = this.config.riskPolicy;
    const personas: Array<'SAFE' | 'NEUTRAL' | 'RISKY'> = ['SAFE', 'NEUTRAL', 'RISKY'];
    const opinions: RiskOpinion[] = personas.map((persona) =>
      this.evaluateRiskPersona(persona, ctx, decision, limits)
    );

    const rejects = opinions.filter((o) => o.verdict === 'REJECT').length;
    this.emitStep(
      onStep,
      cycleId,
      ctx.symbol,
      'risk_team',
      'completed',
      `${opinions.length} personas, ${rejects} reject`
    );
    return opinions;
  }

  /**
   * One persona's view of the trader's proposal. Each persona has its own
   * leverage ceiling and size ceiling; a proposal beyond a ceiling is reduced,
   * and a proposal that fails a hard safety condition is rejected outright.
   */
  private evaluateRiskPersona(
    persona: 'SAFE' | 'NEUTRAL' | 'RISKY',
    ctx: MarketFactContext,
    decision: TraderDecision,
    limits: AgentRiskPolicy
  ): RiskOpinion {
    const ceilings = limits.personaCeilings[persona];

    // A neutral proposal has nothing to approve or reduce.
    if (decision.action === 'NEUTRAL') {
      return {
        persona,
        verdict: 'APPROVE',
        adjustedLeverage: decision.leverage,
        adjustedSizePct: decision.sizePct,
        rationale: `${persona}: no directional exposure proposed`,
      };
    }

    const reasons: string[] = [];

    // Hard rejections first — these are not negotiable by resizing.
    if (decision.confidence < ceilings.minConfidence) {
      return {
        persona,
        verdict: 'REJECT',
        rationale: `${persona}: confidence ${decision.confidence.toFixed(2)} below floor ${ceilings.minConfidence}`,
      };
    }

    if (limits.requireStopLoss && !Number.isFinite(decision.stopLoss ?? NaN)) {
      return {
        persona,
        verdict: 'REJECT',
        rationale: `${persona}: no stop loss on the proposal`,
      };
    }

    // A stop on the wrong side of entry would widen, not cap, the loss.
    const entry = ctx.lastPrice;
    const stop = decision.stopLoss;
    if (stop !== undefined && Number.isFinite(stop) && Number.isFinite(entry)) {
      const stopIsWrongSide =
        decision.action === 'LONG' ? stop >= entry : stop <= entry;
      if (stopIsWrongSide) {
        return {
          persona,
          verdict: 'REJECT',
          rationale: `${persona}: stop ${stop} is on the wrong side of entry ${entry} for a ${decision.action}`,
        };
      }
    }

    let adjustedLeverage = decision.leverage;
    let adjustedSizePct = decision.sizePct;

    if (adjustedLeverage > ceilings.maxLeverage) {
      adjustedLeverage = ceilings.maxLeverage;
      reasons.push(`leverage capped ${decision.leverage}x -> ${adjustedLeverage}x`);
    }

    if (adjustedSizePct > ceilings.maxSizePct) {
      adjustedSizePct = ceilings.maxSizePct;
      reasons.push(`size capped ${(decision.sizePct * 100).toFixed(1)}% -> ${(adjustedSizePct * 100).toFixed(1)}%`);
    }

    const equity = ctx.accountEquity ?? 0;
    const available = ctx.availableBalance ?? equity;
    if (equity > 0 && available > 0) {
      // Notional the proposal implies must be servable by free margin.
      const impliedMargin = equity * adjustedSizePct;
      if (impliedMargin > available) {
        const cappedSizePct = available / equity;
        reasons.push(
          `size limited by free margin ${(adjustedSizePct * 100).toFixed(1)}% -> ${(cappedSizePct * 100).toFixed(1)}%`
        );
        adjustedSizePct = cappedSizePct;
      }
    }

    const leverageReduced = adjustedLeverage < decision.leverage;
    const sizeReduced = adjustedSizePct < decision.sizePct;

    let verdict: RiskOpinion['verdict'] = 'APPROVE';
    if (sizeReduced) verdict = 'REDUCE_SIZE';
    else if (leverageReduced) verdict = 'REDUCE_LEVERAGE';

    return {
      persona,
      verdict,
      adjustedLeverage,
      adjustedSizePct,
      rationale:
        reasons.length > 0
          ? `${persona}: ${reasons.join('; ')}`
          : `${persona}: within limits at equity ${equity.toFixed(2)}`,
    };
  }

  /**
   * Final gate. Takes the most conservative view across the risk personas —
   * any single REJECT blocks the trade, and the surviving leverage/size are the
   * minimum any persona was willing to allow. Deterministic for the same
   * contract reason as the risk team.
   */
  private async runFundManager(
    cycleId: string,
    decision: TraderDecision,
    riskOpinions: RiskOpinion[],
    onStep?: AgentCycleStepListener
  ): Promise<FundManagerApproval> {
    this.emitStep(onStep, cycleId, decision.symbol, 'fund_manager', 'started');

    const limits = this.config.riskPolicy;
    const finalDecision: TraderDecision = { ...decision };

    const rejections = riskOpinions.filter((o) => o.verdict === 'REJECT');

    // Most conservative surviving numbers across every persona.
    const leverages = riskOpinions
      .map((o) => o.adjustedLeverage)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const sizes = riskOpinions
      .map((o) => o.adjustedSizePct)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

    if (leverages.length > 0) finalDecision.leverage = Math.min(...leverages);
    if (sizes.length > 0) finalDecision.sizePct = Math.min(...sizes);

    let approved = decision.action !== 'NEUTRAL';
    let rationale: string;

    if (!approved) {
      rationale = 'Held neutral — no directional proposal to approve';
    } else if (rejections.length > 0) {
      approved = false;
      rationale = `Rejected by risk team: ${rejections.map((r) => r.rationale).join(' | ')}`;
    } else if (decision.confidence < limits.minApprovalConfidence) {
      approved = false;
      rationale = `Rejected: confidence ${decision.confidence.toFixed(2)} below approval floor ${limits.minApprovalConfidence}`;
    } else if (finalDecision.sizePct <= 0) {
      approved = false;
      rationale = 'Rejected: risk team reduced position size to zero';
    } else {
      rationale = `Approved at ${finalDecision.leverage}x, ${(finalDecision.sizePct * 100).toFixed(1)}% of equity (most conservative of ${riskOpinions.length} risk personas)`;
    }

    this.emitStep(
      onStep,
      cycleId,
      decision.symbol,
      'fund_manager',
      'completed',
      approved ? 'APPROVED' : 'REJECTED'
    );

    return { approved, finalDecision, rationale };
  }

  private async generateProse(
    cycleId: string,
    symbol: string,
    stage: AgentCycleStage,
    prompt: string,
    system: string,
    onStep?: AgentCycleStepListener
  ): Promise<string> {
    const targetModel = this.config.apiKeys.length > 0 ? this.config.cloudModel : this.config.model;
    try {
      const res = await this.client.chat({
        model: targetModel,
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
      if (targetModel !== this.config.model) {
        try {
          const fallbackRes = await this.client.chat({
            model: this.config.model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: prompt },
            ],
            think: false,
            options: { temperature: 0.4 },
          });
          const text = fallbackRes.message.content.trim() || 'No argument provided.';
          this.emitStep(onStep, cycleId, symbol, stage, 'completed', text.slice(0, 160));
          return text;
        } catch {
          // Fall through to error reporting
        }
      }
      logger.warn({ cycleId, symbol, stage, model: targetModel, error: (err as Error).message }, '[TradingAgents] researcher call failed, using fallback text');
      this.emitStep(onStep, cycleId, symbol, stage, 'failed', (err as Error).message);
      return 'Argument generation unavailable.';
    }
  }
}
