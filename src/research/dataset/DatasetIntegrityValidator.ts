import type { Candle } from '../../strategy/indicators.js';
import type { DatasetTimeframeStats } from './types.js';

export class DatasetIntegrityValidator {
  static validateTimeframe(
    candles: Candle[],
    interval: string,
    intervalMs: number,
    expectedStart: number,
    expectedEnd: number
  ): { cleanCandles: Candle[]; stats: DatasetTimeframeStats } {
    const sorted = [...candles].sort((a, b) => a.openTime - b.openTime);
    const cleanCandles: Candle[] = [];
    const seenTimes = new Set<number>();

    let duplicateCount = 0;
    let rejectedCount = 0;
    let gapCount = 0;

    for (const c of sorted) {
      if (seenTimes.has(c.openTime)) {
        duplicateCount++;
        continue;
      }
      if (!this.isValidOhlc(c)) {
        rejectedCount++;
        continue;
      }
      seenTimes.add(c.openTime);
      cleanCandles.push(c);
    }

    const expectedCount = Math.max(0, Math.floor((expectedEnd - expectedStart) / intervalMs));
    gapCount = this.countGaps(cleanCandles, intervalMs);
    const missingCount = Math.max(0, expectedCount - cleanCandles.length);

    const stats: DatasetTimeframeStats = {
      interval,
      expectedCount,
      receivedCount: cleanCandles.length,
      missingCount,
      duplicateCount,
      rejectedCount,
      gapCount,
      firstTimestamp: cleanCandles[0]?.openTime ?? expectedStart,
      lastTimestamp: cleanCandles[cleanCandles.length - 1]?.openTime ?? expectedEnd,
    };

    return { cleanCandles, stats };
  }

  private static isValidOhlc(c: Candle): boolean {
    return (
      c.open > 0 &&
      c.high >= c.low &&
      c.high >= c.open &&
      c.high >= c.close &&
      c.low <= c.open &&
      c.low <= c.close &&
      c.volume >= 0
    );
  }

  private static countGaps(candles: Candle[], intervalMs: number): number {
    let gaps = 0;
    for (let i = 1; i < candles.length; i++) {
      const diff = candles[i]!.openTime - candles[i - 1]!.openTime;
      if (diff > intervalMs) {
        gaps++;
      }
    }
    return gaps;
  }
}
