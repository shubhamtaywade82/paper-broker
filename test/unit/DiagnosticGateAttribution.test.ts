import { describe, it, expect } from 'vitest';
import { DiagnosticFunnelEngine } from '../../src/research/diagnostic/DiagnosticFunnelEngine.js';
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

describe('Phase 9.2A — Diagnostic Funnel & Gate Attribution', () => {
  it('instruments full pipeline gates and reports sequential and independent pass rates', () => {
    const t0 = 1700000000000;
    const step5m = 300_000;
    const step15m = 900_000;
    const step1h = 3600_000;
    const step4h = 14400_000;

    const dataset: HistoricalDataset = {
      symbol: 'SOLUSDT',
      candles4h: Array.from({ length: 30 }, (_, i) => makeCandle('4h', t0 + i * step4h, 90 + i, 100 + i, 85 + i, 95 + i)),
      candles1h: Array.from({ length: 40 }, (_, i) => makeCandle('1h', t0 + i * step1h, 92 + (i % 5), 98 + (i % 5), 90 + (i % 5), 95 + (i % 5))),
      candles15m: Array.from({ length: 60 }, (_, i) => makeCandle('15m', t0 + i * step15m, 93 + (i % 3), 97 + (i % 3), 91 + (i % 3), 94 + (i % 3))),
      candles5m: Array.from({ length: 70 }, (_, i) => makeCandle('5m', t0 + i * step5m, 93.5, 96.0, 92.0, 94.0)),
    };

    const report = DiagnosticFunnelEngine.runDiagnostic(dataset);

    expect(report.totalCandles5m).toBe(70);
    expect(report.overallFunnel.length).toBe(11);
    expect(report.longFunnel.length).toBe(11);
    expect(report.shortFunnel.length).toBe(11);
    expect(report.overallFunnel[0]?.gateName).toBe('4H Regime');
    expect(report.bottleneckCategory).toBeDefined();
    expect(report.primaryBottleneckGate).toBeDefined();
  });
});
