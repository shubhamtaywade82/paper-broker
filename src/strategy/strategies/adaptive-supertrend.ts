import type { Strategy } from '../StrategyEngine.js';
import type { StrategyContext } from '../StrategyContext.js';
import type { Candle } from '../indicators.js';
import { parseSignalInput, type SignalInput } from '../signal.js';
import type { Instrument } from '../../broker/types.js';
import {
  extractMarketFeatures,
  formatRegimeKey,
  AdaptiveParameterAI,
  calculateAdaptiveSupertrend,
  FuzzySignalAI,
  type AdaptiveSignal,
  type MarketFeatures,
} from '../adaptive-supertrend/index.js';

export const ADAPTIVE_SUPERTREND_STRATEGY_ID = 'adaptive-supertrend-v1';

// C-08: learn() used to be called with a hardcoded reward of 0.5 at signal
// generation time, before the trade's outcome was known — meaningless
// feedback that made the Q-table converge on noise. A pending decision is now
// tracked per symbol and settled (real learn() call, with the actual realized
// directional return as reward) once the resulting position goes flat.
interface PendingLearn {
  state: string;
  actionIndex: number;
  entryPrice: number;
  side: 'LONG' | 'SHORT';
}

// A directional move of this magnitude in the trade's favor maps to reward
// 1.0 (and against, to -1.0); reward is linear and clamped to [-1, 1] beyond
// that. 2% is a coarse but reasonable scale for the leveraged, ATR-sized
// stops this strategy trades with.
const REWARD_NORMALIZATION_RETURN = 0.02;

export interface AdaptiveSupertrendDeps {
  getInstrument: (symbol: string) => Instrument | undefined;
  symbols?: string[];
  intervals?: string[];
  minConfidence?: number;
  riskFraction?: number;
  persistencePath?: string;
  isAggressive?: () => boolean;
  onSignalGenerated?: (signal: AdaptiveSignal, symbol: string) => void;
}

export function createAdaptiveSupertrendStrategy(deps: AdaptiveSupertrendDeps): Strategy {
  const paramAI = new AdaptiveParameterAI({
    persistencePath: deps.persistencePath ?? 'data/adaptive_supertrend_memory.json',
  });
  const signalAI = new FuzzySignalAI();
  const pendingLearns = new Map<string, PendingLearn>();

  return {
    id: ADAPTIVE_SUPERTREND_STRATEGY_ID,
    name: 'AI-Based Adaptive Supertrend',
    enabled: true,
    symbols: deps.symbols ?? ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
    intervals: deps.intervals ?? ['15m'],
    priority: 8,
    cooldownMs: 30_000,
    onCandleClose: (ctx, candle) => evaluateCandle(deps, paramAI, signalAI, pendingLearns, ctx, candle),
  };
}

/** Settles a still-pending (state, action) decision once its position has gone flat, feeding the real realized outcome back into the Q-table. */
function settlePendingLearn(
  paramAI: AdaptiveParameterAI,
  pendingLearns: Map<string, PendingLearn>,
  ctx: StrategyContext,
  candle: Candle,
  features: MarketFeatures
): void {
  const pending = pendingLearns.get(candle.symbol);
  if (!pending) return;

  const position = ctx.getPosition(candle.symbol);
  if (position && position.qty !== 0) return; // trade still open — nothing to settle yet

  const directionalReturn =
    pending.side === 'LONG'
      ? (candle.close - pending.entryPrice) / pending.entryPrice
      : (pending.entryPrice - candle.close) / pending.entryPrice;
  const reward = Math.max(-1, Math.min(1, directionalReturn / REWARD_NORMALIZATION_RETURN));

  paramAI.learn(pending.state, pending.actionIndex, reward, formatRegimeKey(features));
  pendingLearns.delete(candle.symbol);
}

function evaluateCandle(
  deps: AdaptiveSupertrendDeps,
  paramAI: AdaptiveParameterAI,
  signalAI: FuzzySignalAI,
  pendingLearns: Map<string, PendingLearn>,
  ctx: StrategyContext,
  candle: Candle
): SignalInput | null {
  const candles = ctx.getCandles(candle.symbol, candle.interval, 100);
  if (candles.length < 35) return null;

  const features = extractMarketFeatures(candles);
  if (!features) return null;

  settlePendingLearn(paramAI, pendingLearns, ctx, candle, features);

  const { params, state, actionIndex } = paramAI.chooseAction(features);
  const stResult = calculateAdaptiveSupertrend(candles, params);
  const lastIndex = candles.length - 1;
  const currentSt = stResult.supertrend[lastIndex];
  const currentDir = stResult.direction[lastIndex];

  if (currentSt === undefined || Number.isNaN(currentSt) || currentDir === undefined) return null;

  const aggressive = deps.isAggressive?.() ?? false;
  const minConfidence = deps.minConfidence ?? (aggressive ? 0.30 : 0.55);
  const slAtrMult = aggressive ? 1.0 : 1.5;
  const tpAtrMult = aggressive ? 1.5 : 2.5;

  const signal = signalAI.generateSignal({
    stDirection: currentDir,
    isCrossover: stResult.isCrossover,
    features,
    params,
    currentPrice: candle.close,
    supertrendValue: currentSt,
    minConfidence,
    slAtrMult,
    tpAtrMult,
  });

  if (signal.action === 'HOLD') return null;

  deps.onSignalGenerated?.(signal, candle.symbol);

  // Record the decision for later settlement (see settlePendingLearn) rather
  // than learning immediately with a placeholder reward. Don't clobber an
  // already-pending entry for this symbol — that trade hasn't closed yet, so
  // its (state, action) attribution is still the one awaiting a real outcome.
  if (!pendingLearns.has(candle.symbol)) {
    pendingLearns.set(candle.symbol, {
      state,
      actionIndex,
      entryPrice: signal.currentPrice,
      side: signal.action === 'OPEN_LONG' ? 'LONG' : 'SHORT',
    });
  }

  // This strategy otherwise only ever tries to OPEN a position — it never
  // looks at what it's already holding. If the trend has reversed against an
  // existing position, close it outright rather than betting on the
  // higher-confidence-gated flip path (StrategyEngine.checkConflicts) firing
  // in the same candle. A flat position gets a fresh entry decision next
  // candle once real, not a same-tick gamble on reversing.
  const existingPosition = ctx.getPosition(candle.symbol);
  if (existingPosition && existingPosition.qty !== 0) {
    const positionSide: 'LONG' | 'SHORT' = existingPosition.qty > 0 ? 'LONG' : 'SHORT';
    const reversedAgainstPosition =
      (positionSide === 'LONG' && signal.action === 'OPEN_SHORT') ||
      (positionSide === 'SHORT' && signal.action === 'OPEN_LONG');

    if (reversedAgainstPosition) {
      return parseSignalInput({
        strategyId: ADAPTIVE_SUPERTREND_STRATEGY_ID,
        symbol: candle.symbol,
        action: positionSide === 'LONG' ? 'CLOSE_LONG' : 'CLOSE_SHORT',
        confidence: signal.confidence,
        reasoning: `Trend reversed against open ${positionSide} (${signal.reasoning}) — closing.`,
        ttlMs: 300_000,
      });
    }
  }

  return buildSignalInput(deps, ctx, candle.symbol, signal);
}

function buildSignalInput(
  deps: AdaptiveSupertrendDeps,
  ctx: StrategyContext,
  symbol: string,
  signal: AdaptiveSignal
): SignalInput | null {
  const instrument = deps.getInstrument(symbol);
  const account = ctx.getAccount();
  // CONTRACTS.md: never invent balances. This used to fall back to a literal
  // 10000 when the account read came back at zero or negative, sizing real
  // orders off a balance the account did not have.
  const equity = account.equity;
  if (!Number.isFinite(equity) || equity <= 0) return null;
  const riskPct = deps.riskFraction ?? 0.02;
  const stopDist = Math.abs(signal.currentPrice - signal.stopLossPrice);

  if (stopDist <= 0 || signal.currentPrice <= 0) return null;

  // Sizing by risk budget with a safe notional cap ($3,500 per order)
  const rawQty = (equity * riskPct) / stopDist;
  const maxNotional = 3500;
  const maxQtyByNotional = maxNotional / signal.currentPrice;

  const minQty = instrument?.minQty ? parseFloat(instrument.minQty) : 0.001;
  const maxQty = instrument?.maxQty ? parseFloat(instrument.maxQty) : 100000;
  const stepSize = instrument?.stepSize ? parseFloat(instrument.stepSize) : 0.001;

  const boundedQty = Math.min(maxQty, Math.min(rawQty, maxQtyByNotional));
  const precision = stepSize < 0.01 ? 3 : stepSize < 0.1 ? 2 : stepSize < 1 ? 1 : 0;
  const qty = Math.max(minQty, Number(boundedQty.toFixed(precision)));

  if (qty * signal.currentPrice < (instrument?.minNotional ? parseFloat(instrument.minNotional) : 5)) {
    return null;
  }

  return parseSignalInput({
    strategyId: ADAPTIVE_SUPERTREND_STRATEGY_ID,
    symbol,
    action: signal.action,
    confidence: signal.confidence,
    stopLossPrice: String(signal.stopLossPrice),
    takeProfitPrice: String(signal.takeProfitPrice),
    reasoning: signal.reasoning,
    ttlMs: 300_000,
    features: {
      leverage: 5,
      quantity: qty,
    },
  });
}
