import { describe, it, expect } from 'vitest';
import { DatasetIntegrityValidator } from '../../src/research/dataset/DatasetIntegrityValidator.js';
import { HistoricalDatasetStore } from '../../src/research/dataset/HistoricalDatasetStore.js';
import type { Candle } from '../../src/strategy/indicators.js';

function makeCandle(openTime: number, open = 100, high = 105, low = 95, close = 102): Candle {
  return {
    symbol: 'SOLUSDT',
    interval: '5m',
    openTime,
    closeTime: openTime + 300_000 - 1,
    open,
    high,
    low,
    close,
    volume: 500,
    isClosed: true,
  };
}

describe('Phase 9.2A — Extended Historical Dataset Infrastructure', () => {
  it('deduplicates candles and detects interval gaps accurately', () => {
    const t0 = 1700000000000;
    const step = 300_000;

    const candles: Candle[] = [
      makeCandle(t0),
      makeCandle(t0 + step),
      makeCandle(t0 + step), // Duplicate
      makeCandle(t0 + 3 * step), // Gap (missing t0 + 2*step)
    ];

    const { cleanCandles, stats } = DatasetIntegrityValidator.validateTimeframe(
      candles,
      '5m',
      step,
      t0,
      t0 + 4 * step
    );

    expect(cleanCandles.length).toBe(3);
    expect(stats.duplicateCount).toBe(1);
    expect(stats.gapCount).toBe(1);
    expect(stats.missingCount).toBe(1);
  });

  it('rejects corrupt OHLC candles', () => {
    const t0 = 1700000000000;
    const candles: Candle[] = [
      makeCandle(t0),
      makeCandle(t0 + 300_000, 100, 90, 110, 95), // high < low (corrupt)
    ];

    const { cleanCandles, stats } = DatasetIntegrityValidator.validateTimeframe(
      candles,
      '5m',
      300_000,
      t0,
      t0 + 600_000
    );

    expect(cleanCandles.length).toBe(1);
    expect(stats.rejectedCount).toBe(1);
  });

  it('computes deterministic cryptographic dataset hash', () => {
    const t0 = 1700000000000;
    const candlesA = [makeCandle(t0), makeCandle(t0 + 300_000)];
    const candlesB = [makeCandle(t0), makeCandle(t0 + 300_000)];

    const hashA = HistoricalDatasetStore.computeDatasetHash({ '5m': candlesA });
    const hashB = HistoricalDatasetStore.computeDatasetHash({ '5m': candlesB });

    expect(hashA).toBe(hashB);
    expect(typeof hashA).toBe('string');
    expect(hashA.length).toBe(32);
  });
});
