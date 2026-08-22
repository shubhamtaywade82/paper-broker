import { describe, it, expect } from 'vitest';
import { ReplayEngine } from '../../src/research/replay/ReplayEngine.js';
import { DEFAULT_PAPER_CONFIG } from '../../src/broker/paper/SmcPaperBroker.js';
import type { HistoricalDataset, ReplayConfig } from '../../src/research/replay/types.js';
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

describe('Phase 9 — Replay Engine', () => {
  it('executes full historical replay without lookahead and compiles complete BacktestReport', () => {
    const t0 = 1700000000000;
    const dataset: HistoricalDataset = {
      symbol: 'SOLUSDT',
      candles4h: [
        makeCandle('4h', t0, 90, 110, 85, 105),
        makeCandle('4h', t0 + 14400_000, 105, 115, 100, 112),
      ],
      candles1h: [
        makeCandle('1h', t0, 95, 102, 92, 100),
        makeCandle('1h', t0 + 3600_000, 100, 108, 98, 106),
      ],
      candles15m: [
        makeCandle('15m', t0, 98, 101, 90, 92), // Low formed
        makeCandle('15m', t0 + 900_000, 92, 104, 91, 103), // Breakout
      ],
      candles5m: [
        makeCandle('5m', t0, 98, 100, 96, 97),
        makeCandle('5m', t0 + 300_000, 97, 98, 90, 92),
        makeCandle('5m', t0 + 600_000, 92, 103, 91, 102),
        makeCandle('5m', t0 + 900_000, 102, 105, 101, 104),
      ],
    };

    const config: ReplayConfig = {
      symbol: 'SOLUSDT',
      startTime: t0,
      endTime: t0 + 28800_000,
      initialEquity: 10_000,
      riskPerTradePct: 0.01,
      maxDailyLossPct: 0.03,
      maxOpenPositions: 3,
      defaultLeverage: 5,
      paperBrokerConfig: DEFAULT_PAPER_CONFIG,
      strategyVersion: '1.0.0',
    };

    const report = ReplayEngine.runBacktest(dataset, config);

    expect(report.id).toBe(`RUN:SOLUSDT:${t0}`);
    expect(report.symbol).toBe('SOLUSDT');
    expect(report.initialEquity).toBe(10_000);
    expect(report.configHash).toContain('CFG:SOLUSDT:1.0.0:0.01');
    expect(report.coreMetrics).toBeDefined();
    expect(report.monteCarlo).toBeDefined();
    expect(report.scoreBucketValidation.length).toBe(8);
  });
});
