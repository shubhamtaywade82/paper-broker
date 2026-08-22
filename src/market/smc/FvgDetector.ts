import type { Candle } from '../../strategy/indicators.js';
import type { AnalysisTimeframe } from '../MtfStateEngine.js';
import type { FairValueGap, SmcConfig } from './types.js';
import { DEFAULT_SMC_CONFIG } from './LiquidityDetector.js';

export class FvgDetector {
  static detectFvgs(
    candles: Candle[],
    symbol: string,
    timeframe: AnalysisTimeframe,
    config: SmcConfig = DEFAULT_SMC_CONFIG
  ): FairValueGap[] {
    const fvgs: FairValueGap[] = [];
    const minSize = config.fvgMinSizePct ?? 0;

    for (let i = 2; i < candles.length; i++) {
      const c0 = candles[i - 2]!;
      const c1 = candles[i - 1]!;
      const c2 = candles[i]!;

      const bullishFvg = this.checkBullishFvg(c0, c1, c2, symbol, timeframe, minSize);
      if (bullishFvg) fvgs.push(bullishFvg);

      const bearishFvg = this.checkBearishFvg(c0, c1, c2, symbol, timeframe, minSize);
      if (bearishFvg) fvgs.push(bearishFvg);
    }

    return this.trackFvgLifecycles(candles, fvgs);
  }

  private static checkBullishFvg(
    c0: Candle,
    c1: Candle,
    c2: Candle,
    symbol: string,
    tf: AnalysisTimeframe,
    minSize: number
  ): FairValueGap | null {
    if (c0.high < c2.low) {
      const lowerPrice = c0.high;
      const upperPrice = c2.low;
      if ((upperPrice - lowerPrice) / lowerPrice < minSize) return null;

      const confirmedAt = c2.closeTime ?? (c2.openTime + 1);
      return {
        id: `${symbol}:${tf}:FVG:BULLISH:${c1.openTime}`,
        symbol,
        timeframe: tf,
        type: 'BULLISH',
        upperPrice,
        lowerPrice,
        midpoint: (upperPrice + lowerPrice) / 2,
        sourceCandleTimes: [c0.openTime, c1.openTime, c2.openTime],
        createdAt: c1.openTime,
        confirmedAt,
        status: 'ACTIVE',
      };
    }
    return null;
  }

  private static checkBearishFvg(
    c0: Candle,
    c1: Candle,
    c2: Candle,
    symbol: string,
    tf: AnalysisTimeframe,
    minSize: number
  ): FairValueGap | null {
    if (c0.low > c2.high) {
      const lowerPrice = c2.high;
      const upperPrice = c0.low;
      if ((upperPrice - lowerPrice) / lowerPrice < minSize) return null;

      const confirmedAt = c2.closeTime ?? (c2.openTime + 1);
      return {
        id: `${symbol}:${tf}:FVG:BEARISH:${c1.openTime}`,
        symbol,
        timeframe: tf,
        type: 'BEARISH',
        upperPrice,
        lowerPrice,
        midpoint: (upperPrice + lowerPrice) / 2,
        sourceCandleTimes: [c0.openTime, c1.openTime, c2.openTime],
        createdAt: c1.openTime,
        confirmedAt,
        status: 'ACTIVE',
      };
    }
    return null;
  }

  private static trackFvgLifecycles(candles: Candle[], fvgs: FairValueGap[]): FairValueGap[] {
    return fvgs.map((fvg) => {
      let status = fvg.status;
      let mitigatedAt: number | undefined;
      let mitigationPrice: number | undefined;

      for (const c of candles) {
        if (c.openTime < fvg.confirmedAt) continue;

        if (fvg.type === 'BULLISH') {
          if (c.close < fvg.lowerPrice) {
            status = 'INVALIDATED';
            break;
          } else if (c.low <= fvg.lowerPrice) {
            status = 'MITIGATED';
            mitigatedAt = c.closeTime ?? c.openTime;
            mitigationPrice = c.low;
          } else if (c.low <= fvg.midpoint && status === 'ACTIVE') {
            status = 'PARTIALLY_FILLED';
          }
        } else if (fvg.type === 'BEARISH') {
          if (c.close > fvg.upperPrice) {
            status = 'INVALIDATED';
            break;
          } else if (c.high >= fvg.upperPrice) {
            status = 'MITIGATED';
            mitigatedAt = c.closeTime ?? c.openTime;
            mitigationPrice = c.high;
          } else if (c.high >= fvg.midpoint && status === 'ACTIVE') {
            status = 'PARTIALLY_FILLED';
          }
        }
      }

      return { ...fvg, status, mitigatedAt, mitigationPrice };
    });
  }
}
