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
}

export function createSmcAgentStrategy(deps: SmcAgentStrategyDeps): Strategy {
  return {
    id: STRATEGY_ID,
    name: 'SMC Structure + Multi-Agent Debate',
    enabled: true,
    symbols: deps.symbols ?? ['BTCUSDT', 'ETHUSDT'],
    intervals: ['5m'],
    priority: 10,
    cooldownMs: 300_000,
    onCandleClose: (ctx, candle) => evaluateCandle(deps, ctx, candle.symbol, candle.openTime),
  };
}

async function evaluateCandle(
  deps: SmcAgentStrategyDeps,
  ctx: StrategyContext,
  symbol: string,
  asOf: number
) {
  const setups = deps.setupEngine.getReadySetups(symbol, asOf);
  const candidate = setups.find((s) => s.direction !== 'AVOID');
  if (!candidate) return null;

  const structure = deps.structureEngine.computeMultiTimeframeStructure(symbol, asOf);
  const smc = deps.smcEngine.computeMultiTimeframeSmcContext(symbol, asOf);
  const instrument = deps.getInstrument(symbol);
  const plan = deps.planEngine.generateExecutionPlan(candidate, structure, smc, instrument, asOf, true);
  if (plan.status !== 'EXECUTABLE') return null;

  const account = ctx.getAccount();
  const marketFacts = buildMarketFacts(ctx, symbol, account);
  if (!marketFacts) return null;

  const cycle = await deps.tradingAgentsPipeline.runCycle(marketFacts, deps.onCycleStep);
  deps.onCycleCompleted?.(cycle);
  if (!cycle.fundManagerApproval.approved) return null;
  const agentDirection = cycle.fundManagerApproval.finalDecision.action;
  if (agentDirection === 'NEUTRAL' || agentDirection !== candidate.direction) return null;

  const riskAccount = toRiskAccountState(account);
  const currentPosition = ctx.getPosition(symbol);
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

  return tradeSignalToSignalInput(tradeSignal, cycle.traderDecision.confidence, STRATEGY_ID);
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
