import type { Candle } from '../../strategy/indicators.js';
import type { AnalysisTimeframe } from '../MtfStateEngine.js';
import type { ConfirmedSwing, StructureScope, SwingConfig, SwingType } from './types.js';

export const DEFAULT_SWING_CONFIG: SwingConfig = {
  swingLeftBars: 3,
  swingRightBars: 3,
  equalTolerancePct: 0.0005,
};

export class SwingDetector {
  static detectSwings(
    candles: Candle[],
    symbol: string,
    timeframe: AnalysisTimeframe,
    config = DEFAULT_SWING_CONFIG,
    scope: StructureScope = 'EXTERNAL'
  ): ConfirmedSwing[] {
    const left = Math.max(1, config.swingLeftBars);
    const right = Math.max(1, config.swingRightBars);
    const swings: ConfirmedSwing[] = [];
    let prevHigh: ConfirmedSwing | undefined;
    let prevLow: ConfirmedSwing | undefined;

    for (let i = left; i < candles.length - right; i++) {
      const highSwing = this.checkSwingHigh(candles, i, left, right, symbol, timeframe, scope, prevHigh, config.equalTolerancePct);
      if (highSwing) {
        swings.push(highSwing);
        prevHigh = highSwing;
      }
      const lowSwing = this.checkSwingLow(candles, i, left, right, symbol, timeframe, scope, prevLow, config.equalTolerancePct);
      if (lowSwing) {
        swings.push(lowSwing);
        prevLow = lowSwing;
      }
    }
    return swings.sort((a, b) => a.confirmationTime - b.confirmationTime);
  }

  private static checkSwingHigh(
    candles: Candle[],
    i: number,
    left: number,
    right: number,
    symbol: string,
    tf: AnalysisTimeframe,
    scope: StructureScope,
    prev?: ConfirmedSwing,
    tol = 0.0005
  ): ConfirmedSwing | null {
    const current = candles[i]!;
    for (let j = i - left; j < i; j++) {
      if (candles[j]!.high >= current.high) return null;
    }
    for (let k = i + 1; k <= i + right; k++) {
      if (candles[k]!.high > current.high) return null;
    }

    const confCandle = candles[i + right]!;
    const confirmationTime = confCandle.closeTime ?? confCandle.openTime;
    const classification = this.classifySwing(current.high, 'HIGH', prev?.price, tol);

    return {
      id: `${symbol}:${tf}:${scope}:SH:${current.openTime}`,
      symbol,
      timeframe: tf,
      scope,
      type: 'HIGH',
      classification,
      price: current.high,
      pivotTime: current.openTime,
      confirmationTime,
      candleIndex: i,
    };
  }

  private static checkSwingLow(
    candles: Candle[],
    i: number,
    left: number,
    right: number,
    symbol: string,
    tf: AnalysisTimeframe,
    scope: StructureScope,
    prev?: ConfirmedSwing,
    tol = 0.0005
  ): ConfirmedSwing | null {
    const current = candles[i]!;
    for (let j = i - left; j < i; j++) {
      if (candles[j]!.low <= current.low) return null;
    }
    for (let k = i + 1; k <= i + right; k++) {
      if (candles[k]!.low < current.low) return null;
    }

    const confCandle = candles[i + right]!;
    const confirmationTime = confCandle.closeTime ?? confCandle.openTime;
    const classification = this.classifySwing(current.low, 'LOW', prev?.price, tol);

    return {
      id: `${symbol}:${tf}:${scope}:SL:${current.openTime}`,
      symbol,
      timeframe: tf,
      scope,
      type: 'LOW',
      classification,
      price: current.low,
      pivotTime: current.openTime,
      confirmationTime,
      candleIndex: i,
    };
  }

  private static classifySwing(price: number, type: SwingType, prevPrice?: number, tol = 0.0005) {
    if (prevPrice === undefined) return 'UNKNOWN';
    const diff = Math.abs(price - prevPrice) / prevPrice;
    if (diff <= tol) return type === 'HIGH' ? 'EQUAL_HIGH' : 'EQUAL_LOW';

    if (type === 'HIGH') {
      return price > prevPrice ? 'HH' : 'LH';
    }
    return price < prevPrice ? 'LL' : 'HL';
  }
}
