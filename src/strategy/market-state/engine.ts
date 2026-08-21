import { atr, type Candle } from '../indicators.js';
import type { DisplacementEvent, FlowContext, LiquiditySweep, MarketStateSnapshot, MarketStructureState, StructureEvent, SwingPoint, TradeSetup } from './types.js';

export interface MarketStateEngineOptions {
  pivotLeft?: number;
  pivotRight?: number;
  atrPeriod?: number;
  displacementAtrMultiple?: number;
  displacementVolumeZScore?: number;
  sweepLookback?: number;
}

const defaults: Required<MarketStateEngineOptions> = {
  pivotLeft: 2,
  pivotRight: 2,
  atrPeriod: 14,
  displacementAtrMultiple: 1.2,
  displacementVolumeZScore: 1.5,
  sweepLookback: 12,
};

export function detectSwings(candles: Candle[], options: MarketStateEngineOptions = {}): SwingPoint[] {
  const opts = { ...defaults, ...options };
  const swings: SwingPoint[] = [];
  for (let i = opts.pivotLeft; i < candles.length - opts.pivotRight; i++) {
    const candle = candles[i]!;
    const left = candles.slice(i - opts.pivotLeft, i);
    const right = candles.slice(i + 1, i + 1 + opts.pivotRight);
    if (left.every((c) => candle.high > c.high) && right.every((c) => candle.high >= c.high)) {
      swings.push({ kind: 'HIGH', index: i, time: candle.openTime, price: candle.high });
    }
    if (left.every((c) => candle.low < c.low) && right.every((c) => candle.low <= c.low)) {
      swings.push({ kind: 'LOW', index: i, time: candle.openTime, price: candle.low });
    }
  }
  return swings.sort((a, b) => a.index - b.index || (a.kind === 'LOW' ? -1 : 1));
}

export function deriveStructure(candles: Candle[], swings: SwingPoint[]): MarketStructureState {
  const events: StructureEvent[] = [];
  let lastHigh: SwingPoint | undefined;
  let lastLow: SwingPoint | undefined;
  let trend: MarketStructureState['trend'] = 'RANGE';
  let higherHigh = false, higherLow = false, lowerHigh = false, lowerLow = false;

  for (const swing of swings) {
    if (swing.kind === 'HIGH') {
      if (lastHigh) {
        const type = swing.price > lastHigh.price ? 'HH' : 'LH';
        higherHigh = type === 'HH'; lowerHigh = type === 'LH';
        events.push({ type, index: swing.index, time: swing.time, price: swing.price });
      }
      if (higherHigh && higherLow) trend = 'UP';
      else if (lowerHigh && lowerLow) trend = 'DOWN';
      lastHigh = swing;
    } else {
      if (lastLow) {
        const type = swing.price > lastLow.price ? 'HL' : 'LL';
        higherLow = type === 'HL'; lowerLow = type === 'LL';
        events.push({ type, index: swing.index, time: swing.time, price: swing.price });
      }
      if (higherHigh && higherLow) trend = 'UP';
      else if (lowerHigh && lowerLow) trend = 'DOWN';
      lastLow = swing;
    }
  }

  const lastClose = candles.at(-1)?.close;
  let bos: false | 'UP' | 'DOWN' = false;
  let choch: false | 'UP' | 'DOWN' = false;
  if (lastClose !== undefined && lastHigh && lastClose > lastHigh.price) {
    bos = 'UP'; choch = trend === 'DOWN' ? 'UP' : false;
    events.push({ type: choch ? 'CHOCH_UP' : 'BOS_UP', index: candles.length - 1, time: candles.at(-1)!.openTime, price: lastClose });
  } else if (lastClose !== undefined && lastLow && lastClose < lastLow.price) {
    bos = 'DOWN'; choch = trend === 'UP' ? 'DOWN' : false;
    events.push({ type: choch ? 'CHOCH_DOWN' : 'BOS_DOWN', index: candles.length - 1, time: candles.at(-1)!.openTime, price: lastClose });
  }

  if ((higherHigh && higherLow) || bos === 'UP') trend = 'UP';
  else if ((lowerHigh && lowerLow) || bos === 'DOWN') trend = 'DOWN';

  return { trend, lastSwingHigh: lastHigh, lastSwingLow: lastLow, higherHigh, higherLow, lowerHigh, lowerLow, bos, choch, events };
}

export function detectLiquiditySweeps(candles: Candle[], swings: SwingPoint[], options: MarketStateEngineOptions = {}): LiquiditySweep[] {
  const opts = { ...defaults, ...options };
  const sweeps: LiquiditySweep[] = [];
  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i]!;
    const candidates = swings.filter((s) => s.index < i && i - s.index <= opts.sweepLookback);
    const low = candidates.filter((s) => s.kind === 'LOW').at(-1);
    const high = candidates.filter((s) => s.kind === 'HIGH').at(-1);
    if (low && candle.low < low.price && candle.close > low.price) sweeps.push({ side: 'SELL_SIDE', sweptSwing: low, index: i, time: candle.openTime, wickExtreme: candle.low, close: candle.close });
    if (high && candle.high > high.price && candle.close < high.price) sweeps.push({ side: 'BUY_SIDE', sweptSwing: high, index: i, time: candle.openTime, wickExtreme: candle.high, close: candle.close });
  }
  return sweeps;
}

function zScore(value: number, values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return value > mean ? Number.POSITIVE_INFINITY : 0;
  return (value - mean) / sd;
}

export function detectDisplacement(candles: Candle[], options: MarketStateEngineOptions = {}): DisplacementEvent[] {
  const opts = { ...defaults, ...options };
  const atrs = atr(candles, opts.atrPeriod);
  return candles.flatMap((candle, i) => {
    const currentAtr = atrs[i];
    if (!currentAtr || Number.isNaN(currentAtr)) return [];
    const volumes = candles.slice(Math.max(0, i - opts.atrPeriod), i).map((c) => c.volume);
    if (volumes.length < opts.atrPeriod) return [];
    const body = Math.abs(candle.close - candle.open);
    const range = candle.high - candle.low;
    const atrMultiple = body / currentAtr;
    const volumeZScore = zScore(candle.volume, volumes);
    const closeLocation = range === 0 ? 0.5 : (candle.close - candle.low) / range;
    const bullish = candle.close > candle.open && closeLocation >= 0.8;
    const bearish = candle.close < candle.open && closeLocation <= 0.2;
    if (atrMultiple < opts.displacementAtrMultiple || volumeZScore < opts.displacementVolumeZScore || (!bullish && !bearish)) return [];
    const score = Math.min(1, (atrMultiple / opts.displacementAtrMultiple + volumeZScore / opts.displacementVolumeZScore + (bullish ? closeLocation : 1 - closeLocation)) / 3);
    return [{ direction: bullish ? 'BULLISH' : 'BEARISH', index: i, time: candle.openTime, atrMultiple, volumeZScore, closeLocation, score }];
  });
}

export function buildMarketState(symbol: string, timeframe: string, candles: Candle[], flow: FlowContext = {}, options: MarketStateEngineOptions = {}): MarketStateSnapshot {
  const swings = detectSwings(candles, options);
  const structure = deriveStructure(candles, swings);
  const sweeps = detectLiquiditySweeps(candles, swings, options);
  const displacements = detectDisplacement(candles, options);
  const latestSweep = sweeps.at(-1);
  const latestDisplacement = displacements.at(-1);
  const lastHigh = structure.lastSwingHigh?.price;
  const lastLow = structure.lastSwingLow?.price;
  const close = candles.at(-1)?.close;
  const mid = lastHigh !== undefined && lastLow !== undefined ? (lastHigh + lastLow) / 2 : undefined;
  const premiumDiscount = close === undefined || mid === undefined ? 'UNKNOWN' : close > mid ? 'PREMIUM' : close < mid ? 'DISCOUNT' : 'EQUILIBRIUM';
  return {
    symbol, timeframe, regime: structure.trend === 'UP' ? 'BULLISH' : structure.trend === 'DOWN' ? 'BEARISH' : 'NEUTRAL', candles, swings, structure,
    liquidity: { sellSideSweep: sweeps.some((s) => s.side === 'SELL_SIDE'), buySideSweep: sweeps.some((s) => s.side === 'BUY_SIDE'), latestSweep, nearestSellLiquidity: lastLow, nearestBuyLiquidity: lastHigh },
    displacement: { bullish: latestDisplacement?.direction === 'BULLISH', bearish: latestDisplacement?.direction === 'BEARISH', latest: latestDisplacement },
    flow,
    location: { premiumDiscount, distanceFromImpulse: latestDisplacement && close ? Math.abs(close - candles[latestDisplacement.index]!.close) / close : undefined },
  };
}

export function scoreSetup(state: MarketStateSnapshot, direction: 'LONG' | 'SHORT'): number {
  const bullish = direction === 'LONG';
  let score = 0;
  if ((bullish && state.structure.trend === 'UP') || (!bullish && state.structure.trend === 'DOWN')) score += 25;
  if ((bullish && state.liquidity.sellSideSweep) || (!bullish && state.liquidity.buySideSweep)) score += 15;
  if ((bullish && state.displacement.bullish) || (!bullish && state.displacement.bearish)) score += 15;
  if ((bullish && state.structure.bos === 'UP') || (!bullish && state.structure.bos === 'DOWN')) score += 10;
  if ((bullish && state.flow.takerDelta === 'POSITIVE') || (!bullish && state.flow.takerDelta === 'NEGATIVE')) score += 10;
  if (state.flow.openInterest === 'RISING') score += 10;
  if ((bullish && state.location.premiumDiscount !== 'PREMIUM') || (!bullish && state.location.premiumDiscount !== 'DISCOUNT')) score += 10;
  if (state.displacement.latest) score += Math.round(state.displacement.latest.score * 5);
  return Math.min(100, score);
}

export function gradeSetup(score: number) {
  if (score < 50) return 'NO_TRADE' as const;
  if (score < 65) return 'WATCH' as const;
  if (score < 75) return 'CANDIDATE' as const;
  if (score < 85) return 'TRADEABLE' as const;
  return 'HIGH_CONVICTION' as const;
}

export function deriveTradeSetup(state: MarketStateSnapshot): TradeSetup | null {
  const direction = state.regime === 'BULLISH' ? 'LONG' : state.regime === 'BEARISH' ? 'SHORT' : undefined;
  if (!direction) return null;
  const score = scoreSetup(state, direction);
  if (score < 65) return null;
  const long = direction === 'LONG';
  const invalidation = long ? state.structure.lastSwingLow?.price : state.structure.lastSwingHigh?.price;
  const target = long ? state.structure.lastSwingHigh?.price : state.structure.lastSwingLow?.price;
  const close = state.candles.at(-1)?.close;
  if (!invalidation || !target || !close) return null;
  return {
    id: `${state.symbol}:${state.timeframe}:${state.candles.at(-1)!.openTime}:${direction}`,
    symbol: state.symbol,
    direction,
    type: state.structure.choch ? 'REVERSAL' : state.liquidity.latestSweep ? 'LIQUIDITY_REVERSAL' : 'BREAKOUT_RETEST',
    timeframe: state.timeframe,
    entry: { min: long ? Math.min(close, target) : Math.min(close, target), max: long ? Math.max(close, target) : Math.max(close, target), trigger: 'CONFIRMATION' },
    invalidation: { price: invalidation, reason: long ? 'below latest sell-side liquidity / swing low' : 'above latest buy-side liquidity / swing high' },
    targets: [target],
    score,
    grade: gradeSetup(score),
    evidence: {
      structure: state.structure.events.slice(-5).map((e) => `${e.type}@${e.price}`),
      liquidity: state.liquidity.latestSweep ? [`${state.liquidity.latestSweep.side} sweep of ${state.liquidity.latestSweep.sweptSwing.price}`] : [],
      flow: state.flow.takerDelta ? [`taker_delta=${state.flow.takerDelta}`] : [],
      volume: state.displacement.latest ? [`${state.displacement.latest.direction} displacement score=${state.displacement.latest.score.toFixed(2)}`] : [],
      derivatives: [state.flow.openInterest, state.flow.openInterestPriceState, state.flow.funding].filter(Boolean).map(String),
    },
  };
}
