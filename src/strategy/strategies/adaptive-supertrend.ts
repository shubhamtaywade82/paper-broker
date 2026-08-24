import type { Strategy } from '../StrategyEngine.js';
import type { StrategyContext } from '../StrategyContext.js';
import type { Candle } from '../indicators.js';
import { parseSignalInput, type SignalInput } from '../signal.js';
import type { Instrument } from '../../broker/types.js';
import {
  extractMarketFeatures,
  AdaptiveParameterAI,
  calculateAdaptiveSupertrend,
  FuzzySignalAI,
  type AdaptiveSignal,
} from '../adaptive-supertrend/index.js';

export const ADAPTIVE_SUPERTREND_STRATEGY_ID = 'adaptive-supertrend-v1';

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

  return {
    id: ADAPTIVE_SUPERTREND_STRATEGY_ID,
    name: 'AI-Based Adaptive Supertrend',
    enabled: true,
    symbols: deps.symbols ?? ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
    intervals: deps.intervals ?? ['1m', '5m', '15m'],
    priority: 8,
    cooldownMs: 30_000,
    onCandleClose: (ctx, candle) => evaluateCandle(deps, paramAI, signalAI, ctx, candle),
  };
}

function evaluateCandle(
  deps: AdaptiveSupertrendDeps,
  paramAI: AdaptiveParameterAI,
  signalAI: FuzzySignalAI,
  ctx: StrategyContext,
  candle: Candle
): SignalInput | null {
  const candles = ctx.getCandles(candle.symbol, candle.interval, 100);
  if (candles.length < 35) return null;

  const features = extractMarketFeatures(candles);
  if (!features) return null;

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
  paramAI.learn(state, actionIndex, 0.5);

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
  const equity = account.equity > 0 ? account.equity : 10000;
  const riskPct = deps.riskFraction ?? 0.02;
  const stopDist = Math.abs(signal.currentPrice - signal.stopLossPrice);

  if (stopDist <= 0) return null;

  const rawQty = (equity * riskPct) / stopDist;
  const minQty = instrument?.minQty ? parseFloat(instrument.minQty) : 0.01;
  const maxQty = instrument?.maxQty ? parseFloat(instrument.maxQty) : 100;
  const qty = Math.min(maxQty, Math.max(minQty, Math.round(rawQty * 100) / 100));

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
