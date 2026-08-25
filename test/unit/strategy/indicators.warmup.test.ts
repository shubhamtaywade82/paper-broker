import { describe, it, expect } from 'vitest';
import { macd, supertrend, type Candle } from '../../../src/strategy/indicators.js';

function makeCandle(close: number, i = 0): Candle {
  return {
    symbol: 'BTCUSDT',
    interval: '5m',
    openTime: 1700000000000 + i * 300_000,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000,
    isClosed: true,
  };
}

describe('Indicator warm-up (H-19/H-20 regression)', () => {
  it('MACD-01: histogram is NaN for first 33 bars, defined from bar 34', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.1);
    const out = macd(closes);
    // slowPeriod(26) - 1 + signalPeriod(9) - 1 = 33 bars of NaN
    expect(out.histogram.slice(0, 33).every((v) => Number.isNaN(v))).toBe(true);
    expect(Number.isNaN(out.histogram[33])).toBe(false);
  });

  it('MACD-02: no false-momentum histogram spike during warm-up window', () => {
    const closes = [...Array(30).fill(100), 110, ...Array(30).fill(110)];
    const out = macd(closes);
    expect(out.histogram.slice(0, 33).every((v) => Number.isNaN(v))).toBe(true);
  });

  it('ST-01: direction is NaN during warm-up period', () => {
    const candles = Array.from({ length: 40 }, (_, i) => makeCandle(100 - i, i));
    const out = supertrend(candles, 10, 3);
    expect(out.direction.slice(0, 10).every((v) => Number.isNaN(v))).toBe(true);
    expect(Number.isNaN(out.direction[10])).toBe(false);
  });

  it('ST-02: genuine reversal after warm-up switches direction', () => {
    const candles = [
      ...Array.from({ length: 25 }, (_, i) => makeCandle(100 + i * 2, i)),
      ...Array.from({ length: 25 }, (_, i) => makeCandle(150 - i * 3, i + 25)),
    ];
    const out = supertrend(candles, 10, 3);
    const validDirs = out.direction.slice(10);
    expect(validDirs.includes(1)).toBe(true);
    expect(validDirs.includes(-1)).toBe(true);
  });
});
