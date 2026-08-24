import type { Candle } from '../indicators.js';
import { atr } from '../indicators.js';
import type { SupertrendParams } from './types.js';

export interface AdaptiveSupertrendResult {
  supertrend: number[];
  direction: number[]; // 1 for Bullish (Long), -1 for Bearish (Short)
  upperBand: number[];
  lowerBand: number[];
  isCrossover: boolean;
}

export function calculateAdaptiveSupertrend(
  candles: Candle[],
  params: SupertrendParams
): AdaptiveSupertrendResult {
  const { atrPeriod, multiplier } = params;
  const len = candles.length;

  const st: number[] = candles.map(() => NaN);
  // H-20: previously defaulted to 1 (not NaN, unlike the other three arrays
  // here) for the warm-up region before the loop below ever runs. That made
  // the first actually-computed direction look like it was being compared
  // against a real "uptrend" bar instead of an uninitialized placeholder —
  // see the isCrossover guard below, which is the actual fix for the false
  // first-bar crossover this caused.
  const dir: number[] = candles.map(() => NaN);
  const upperBand: number[] = candles.map(() => NaN);
  const lowerBand: number[] = candles.map(() => NaN);

  if (len < atrPeriod + 1) {
    return { supertrend: st, direction: dir, upperBand, lowerBand, isCrossover: false };
  }

  const atrValues = atr(candles, atrPeriod);
  let finalUpper = 0;
  let finalLower = 0;
  let prevSt = 0;
  let prevDir = 1;

  for (let i = atrPeriod; i < len; i++) {
    const c = candles[i]!;
    const prevC = candles[i - 1]!;
    const curAtr = atrValues[i] || 0;
    const hl2 = (c.high + c.low) / 2;

    const basicUpper = hl2 + multiplier * curAtr;
    const basicLower = hl2 - multiplier * curAtr;

    finalUpper = basicUpper < finalUpper || prevC.close > finalUpper ? basicUpper : finalUpper;
    finalLower = basicLower > finalLower || prevC.close < finalLower ? basicLower : finalLower;

    if (prevSt === finalUpper) {
      prevDir = c.close <= finalUpper ? -1 : 1;
    } else {
      prevDir = c.close >= finalLower ? 1 : -1;
    }

    const currentSt = prevDir === 1 ? finalLower : finalUpper;
    st[i] = currentSt;
    dir[i] = prevDir;
    upperBand[i] = finalUpper;
    lowerBand[i] = finalLower;
    prevSt = currentSt;
  }

  // H-20: only a genuine trend flip counts as a crossover — both bars being
  // compared must actually have been computed by the loop above (index
  // >= atrPeriod). Comparing the first computed bar (index === atrPeriod)
  // against index atrPeriod - 1, which is still inside the warm-up region,
  // used to report a crossover purely from the array-initialization
  // artifact whenever that first real direction happened to be -1.
  const isCrossover = len >= 2 && len - 2 >= atrPeriod && dir[len - 1] !== dir[len - 2];

  return {
    supertrend: st,
    direction: dir,
    upperBand,
    lowerBand,
    isCrossover,
  };
}
