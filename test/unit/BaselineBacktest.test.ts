import { describe, it, expect } from 'vitest';
import { BaselineSolusdtBacktest } from '../../src/research/replay/BaselineSolusdtBacktest.js';
import type { HistoricalDataset } from '../../src/research/replay/types.js';
import type { Candle } from '../../src/strategy/indicators.js';

function makeCandle(interval: string, openTime: number, open: number, high: number, low: number, close: number): Candle {
  const step = interval === '4h' ? 14400_000 : interval === '1h' ? 3600_000 : interval === '15m' ? 900_000 : 300_000;
  return {
    symbol: 'SOLUSDT',
    interval,
    openTime,
    closeTime: openTime + step - 1,
    open,
    high,
    low,
    close,
    volume: 1000,
    isClosed: true,
  };
}

function makeSyntheticDataset(t0 = 1700000000000): HistoricalDataset {
  const step5m = 300_000;
  const step15m = 900_000;
  const step1h = 3600_000;
  const step4h = 14400_000;

  const candles4h: Candle[] = [];
  for (let i = 0; i < 30; i++) {
    candles4h.push(makeCandle('4h', t0 + i * step4h, 90 + i, 100 + i, 85 + i, 95 + i));
  }

  const candles1h: Candle[] = [];
  for (let i = 0; i < 40; i++) {
    candles1h.push(makeCandle('1h', t0 + i * step1h, 92 + (i % 5), 98 + (i % 5), 90 + (i % 5), 95 + (i % 5)));
  }

  const candles15m: Candle[] = [];
  for (let i = 0; i < 60; i++) {
    candles15m.push(makeCandle('15m', t0 + i * step15m, 93 + (i % 3), 97 + (i % 3), 91 + (i % 3), 94 + (i % 3)));
  }

  const candles5m: Candle[] = [];
  for (let i = 0; i < 70; i++) {
    candles5m.push(makeCandle('5m', t0 + i * step5m, 93.5, 96.0, 92.0, 94.0));
  }

  return {
    symbol: 'SOLUSDT',
    candles4h,
    candles1h,
    candles15m,
    candles5m,
    fundingRates: [{ timestamp: t0 + 28800_000, fundingRate: 0.0001 }],
  };
}

describe('Phase 9.2 — Baseline SOLUSDT Backtest Audit', () => {
  it('enforces warmup requirements and flags insufficient history', async () => {
    const insufficientDataset: HistoricalDataset = {
      symbol: 'SOLUSDT',
      candles4h: [makeCandle('4h', 1000, 100, 105, 95, 102)],
      candles1h: [makeCandle('1h', 1000, 100, 105, 95, 102)],
      candles15m: [makeCandle('15m', 1000, 100, 105, 95, 102)],
      candles5m: [makeCandle('5m', 1000, 100, 105, 95, 102)],
    };

    const res = await BaselineSolusdtBacktest.runBaseline(insufficientDataset);
    expect(res.dataQualityStatus).toContain('DATA_QUALITY_INSUFFICIENT');
    expect(res.verdict).toBe('DATA_INSUFFICIENT');
  });

  it('runs deterministic baseline replay with 100% bitwise parity between Run 1 and Run 2', async () => {
    const dataset = makeSyntheticDataset();
    const res = await BaselineSolusdtBacktest.runBaseline(dataset);

    expect(res.isReproducible).toBe(true);
    expect(res.report1.configHash).toBe(res.report2.configHash);
    expect(res.report1.totalNetPnl).toBe(res.report2.totalNetPnl);
    expect(res.markdownSummary).toContain('BASELINE SOLUSDT HISTORICAL BACKTEST AUDIT');
    expect(res.markdownSummary).toContain('100% Bitwise Parity');
  });
});
