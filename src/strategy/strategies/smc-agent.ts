import type { TradeSignal } from '../../trading/signal/types.js';
import { parseSignalInput, type SignalInput } from '../signal.js';
import type { Strategy } from '../StrategyEngine.js';
import type { StrategyContext } from '../StrategyContext.js';
import type { SetupEngine } from '../../market/setup/SetupEngine.js';
import type { MarketStructureEngine } from '../../market/structure/MarketStructureEngine.js';
import type { SmcLocationEngine } from '../../market/smc/SmcLocationEngine.js';
import type { ExecutionPlanEngine } from '../../market/execution/ExecutionPlanEngine.js';
import type { TradeIntentEngine } from '../../trading/TradeIntentEngine.js';
import type { AgentCycleStepListener, MarketFactContext } from '../../ai/tradingAgents.js';
import type { CycleRecord } from '../../ai/schemas.js';
import type { AccountState, Instrument, Order, Position } from '../../broker/types.js';
import { toRiskAccountState, toPortfolioPositions } from '../../trading/risk/adapters.js';
import { logger } from '../../telemetry/logger.js';
import type { StrategyPerformanceTracker } from '../StrategyPerformanceTracker.js';
import type { SetupOutcomeTracker } from '../SetupOutcomeTracker.js';

export interface AgentDebatePipeline {
  runCycle(ctx: MarketFactContext, onStep?: AgentCycleStepListener): Promise<CycleRecord>;
}

export function tradeSignalToSignalInput(
  ts: TradeSignal,
  agentConfidence: number,
  strategyId: string
): SignalInput {
  const action = ts.direction === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT';
  const firstTakeProfit = ts.takeProfits[0]?.price ?? ts.entryPrice;

  return parseSignalInput({
    strategyId,
    symbol: ts.symbol,
    action,
    confidence: agentConfidence,
    stopLossPrice: String(ts.stopLossPrice),
    takeProfitPrice: String(firstTakeProfit),
    reasoning: `[${ts.setupType}] confluence=${ts.confluenceScore}`,
    ttlMs: Math.max(1000, ts.expiresAt - ts.createdAt),
    features: {
      leverage: ts.sizing?.leverage ?? 0,
      quantity: ts.sizing?.quantity ?? 0,
    },
  });
}

const STRATEGY_ID = 'smc-agent-v1';

// C-06: tradingAgentsPipeline.runCycle() used to be called unguarded — if
// Ollama went down mid-cycle or any LLM call threw, the error propagated to
// StrategyEngine.onCandleClose's generic catch (console.error only, no
// alerting) and the strategy silently stopped producing signals with zero
// operational visibility. Now caught locally with structured logging, plus a
// simple circuit breaker: after MAX_CONSECUTIVE_LLM_FAILURES in a row, the
// strategy stops calling the pipeline entirely for CIRCUIT_COOLDOWN_MS so a
// persistently-down LLM doesn't retry (and log) every single candle close.
const MAX_CONSECUTIVE_LLM_FAILURES = 5;
const CIRCUIT_COOLDOWN_MS = 5 * 60_000;

interface LlmCircuitState {
  consecutiveFailures: number;
  circuitOpenUntil: number;
}

export interface SmcAgentStrategyDeps {
  setupEngine: SetupEngine;
  structureEngine: MarketStructureEngine;
  smcEngine: SmcLocationEngine;
  planEngine: ExecutionPlanEngine;
  tradeIntentEngine: TradeIntentEngine;
  tradingAgentsPipeline: AgentDebatePipeline;
  getInstrument: (symbol: string) => Instrument | undefined;
  symbols?: string[];
  getAllPositions?: () => Position[];
  getAllOpenOrders?: () => Order[];
  onCycleCompleted?: (cycle: CycleRecord) => void;
  onCycleStep?: AgentCycleStepListener;
  /**
   * Self-learning memory: realized-outcome stats per SMC setup archetype
   * (e.g. 'SSL_SWEEP_REVERSAL_LONG'), keyed exactly like
   * StrategyPerformanceTracker's existing strategyId keying but scoped to
   * setup type instead of strategy. Reused as-is rather than a parallel
   * class — the tracker is already generic over its string key.
   */
  setupPerformance?: StrategyPerformanceTracker;
  /** Attributes a closing fill back to the setup type that opened it. */
  setupOutcomeTracker?: SetupOutcomeTracker;
  /** Mirrors STRATEGY_FEEDBACK_ENABLED: observe stats always, only gate entries when true. */
  enforceSetupQuarantine?: boolean;
}

export function createSmcAgentStrategy(deps: SmcAgentStrategyDeps): Strategy {
  const llmCircuit: LlmCircuitState = { consecutiveFailures: 0, circuitOpenUntil: 0 };
  return {
    id: STRATEGY_ID,
    name: 'SMC Structure + Multi-Agent Debate',
    enabled: true,
    symbols: deps.symbols ?? ['BTCUSDT', 'ETHUSDT'],
    intervals: ['5m'],
    priority: 10,
    cooldownMs: 300_000,
    onCandleClose: (ctx, candle) => evaluateCandle(deps, llmCircuit, ctx, candle.symbol, candle.openTime),
  };
}

async function evaluateCandle(
  deps: SmcAgentStrategyDeps,
  llmCircuit: LlmCircuitState,
  ctx: StrategyContext,
  symbol: string,
  asOf: number
) {
  const setups = deps.setupEngine.getReadySetups(symbol, asOf);
  const candidate = setups.find((s) => s.direction !== 'AVOID');
  if (!candidate) return null;

  // Self-learning gate: a setup archetype that has repeatedly lost money is
  // deterministically skipped before spending an LLM call on it, same spirit
  // as StrategyPerformanceTracker's whole-strategy quarantine but scoped to
  // this one setup type. Observation (recordRealizedPnl) always happens via
  // the onFill hook regardless of this flag — only enforcement is gated.
  if (deps.enforceSetupQuarantine && deps.setupPerformance?.isQuarantined(candidate.setupType)) {
    return null;
  }

  const structure = deps.structureEngine.computeMultiTimeframeStructure(symbol, asOf);
  const smc = deps.smcEngine.computeMultiTimeframeSmcContext(symbol, asOf);
  const instrument = deps.getInstrument(symbol);
  const plan = deps.planEngine.generateExecutionPlan(candidate, structure, smc, instrument, asOf, true);
  if (plan.status !== 'EXECUTABLE') return null;

  const account = ctx.getAccount();
  const marketFacts = buildMarketFacts(ctx, symbol, account);
  if (!marketFacts) return null;
  marketFacts.setupMemory = buildSetupMemory(candidate.setupType, deps.setupPerformance);

  if (Date.now() < llmCircuit.circuitOpenUntil) {
    return null;
  }

  let cycle: CycleRecord;
  try {
    cycle = await deps.tradingAgentsPipeline.runCycle(marketFacts, deps.onCycleStep);
    llmCircuit.consecutiveFailures = 0;
  } catch (error) {
    llmCircuit.consecutiveFailures += 1;
    logger.warn(
      { symbol, error: error instanceof Error ? error.message : String(error), consecutiveFailures: llmCircuit.consecutiveFailures },
      '[SmcAgentStrategy] tradingAgentsPipeline.runCycle failed'
    );
    if (llmCircuit.consecutiveFailures >= MAX_CONSECUTIVE_LLM_FAILURES) {
      llmCircuit.circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
      logger.error(
        { symbol, consecutiveFailures: llmCircuit.consecutiveFailures, cooldownMs: CIRCUIT_COOLDOWN_MS },
        '[SmcAgentStrategy] LLM pipeline circuit breaker OPEN after repeated failures — pausing agent debate calls'
      );
    }
    return null;
  }

  deps.onCycleCompleted?.(cycle);

  const currentPosition = ctx.getPosition(symbol);
  const agentDirection = cycle.fundManagerApproval.finalDecision.action;

  // A confident, approved reversal against an existing position should close
  // it even when it doesn't match today's specific technical setup — this
  // pipeline otherwise only ever considers opening, and would silently do
  // nothing while a debate-confirmed reversal sits unacted on.
  if (cycle.fundManagerApproval.approved && currentPosition && currentPosition.qty !== 0) {
    const positionSide: 'LONG' | 'SHORT' = currentPosition.qty > 0 ? 'LONG' : 'SHORT';
    const reversedAgainstPosition =
      (positionSide === 'LONG' && agentDirection === 'SHORT') ||
      (positionSide === 'SHORT' && agentDirection === 'LONG');

    if (reversedAgainstPosition) {
      return parseSignalInput({
        strategyId: STRATEGY_ID,
        symbol,
        action: positionSide === 'LONG' ? 'CLOSE_LONG' : 'CLOSE_SHORT',
        confidence: cycle.traderDecision.confidence,
        reasoning: `Agent debate approved ${agentDirection} against open ${positionSide} — closing.`,
        ttlMs: 300_000,
      });
    }
  }

  if (!cycle.fundManagerApproval.approved) return null;
  if (agentDirection === 'NEUTRAL' || agentDirection !== candidate.direction) return null;

  const riskAccount = toRiskAccountState(account);
  // Whole-account risk checks (e.g. maxOpenPositions) need positions/orders across ALL
  // symbols, not just this candle's symbol — falls back to single-symbol view when the
  // multi-symbol callbacks aren't wired (keeps existing callers/tests working unchanged).
  const allPositions = deps.getAllPositions
    ? deps.getAllPositions()
    : (currentPosition ? [currentPosition] : ([] as Position[]));
  const allOpenOrders = deps.getAllOpenOrders ? deps.getAllOpenOrders() : ctx.getOpenOrders(symbol);
  const riskPositions = toPortfolioPositions(allPositions, allOpenOrders);

  const tradeSignal = deps.tradeIntentEngine.processExecutionPlan(plan, riskAccount, riskPositions, instrument, asOf);
  if (tradeSignal.status !== 'PAPER_READY') return null;

  deps.setupOutcomeTracker?.recordOpen(symbol, candidate.setupType);
  return tradeSignalToSignalInput(tradeSignal, cycle.traderDecision.confidence, STRATEGY_ID);
}

/** Advisory-only context for the LLM stages — never gates execution itself. */
function buildSetupMemory(setupType: string, tracker?: StrategyPerformanceTracker): string | undefined {
  const stats = tracker?.getStats(setupType);
  if (!stats || stats.trades === 0) return undefined;
  return (
    `Setup archetype ${setupType}: ${stats.trades} past trades, ` +
    `${(stats.winRate * 100).toFixed(0)}% win rate, realized PnL ${stats.realizedPnl.toFixed(2)} USDT` +
    (stats.quarantined ? ' (currently quarantined for poor performance)' : '') +
    '.'
  );
}

function buildMarketFacts(
  ctx: StrategyContext,
  symbol: string,
  account: AccountState
): MarketFactContext | null {
  const market = ctx.getMarket(symbol);
  if (!market || market.bid === undefined || market.ask === undefined || market.last === undefined || market.mark === undefined) {
    return null;
  }
  return {
    symbol,
    lastPrice: market.last,
    bid: market.bid,
    ask: market.ask,
    spread: market.spread ?? market.ask - market.bid,
    mark: market.mark,
    fundingRate: market.fundingRate,
    openInterest: market.openInterest,
    accountEquity: account.equity,
    availableBalance: account.availableBalance,
  };
}
