import { describe, it, expect } from 'vitest';
import { computePerformance, classifyHorizons, performanceScore } from '../../../src/screener/performance.js';
import type { Candle } from '../../../src/strategy/indicators.js';

/** Deterministic series: `days` sessions compounding at `dailyPct`. */
function series(days: number, start: number, dailyPct: number, volume = 1_000_000): Candle[] {
  const out: Candle[] = [];
  let price = start;
  for (let i = 0; i < days; i++) {
    price *= 1 + dailyPct / 100;
    out.push({ symbol: 'TEST', interval: '1d', openTime: i, open: price, high: price * 1.01, low: price * 0.99, close: price, volume });
  }
  return out;
}

describe('computePerformance', () => {
  it('returns null rather than scoring a symbol with too little history', () => {
    expect(computePerformance(series(30, 100, 0.1))).toBeNull();
  });

  it('computes real return/SMA/volatility numbers from a known series', () => {
    const p = computePerformance(series(300, 100, 0.3), series(300, 100, 0.05))!;
    expect(p).not.toBeNull();
    expect(p.candleCount).toBe(300);
    expect(p.close).toBeGreaterThan(100);
    expect(p.return20d).toBeGreaterThan(0);
    expect(p.sma200Rising).toBe(true);
    expect(p.relativeStrength250d).toBeGreaterThan(0); // 0.3%/day beats 0.05%/day
  });

  it('does not claim a rising 200DMA when there is not enough history to prove it', () => {
    // 210 sessions: enough for a 200DMA, not enough for the "vs 20 sessions
    // ago" comparison that proves it is rising.
    const p = computePerformance(series(210, 100, 0.3))!;
    expect(p.sma200Rising).toBeNull();
  });

  it('returns pctFrom52wHigh: null for a symbol with fewer than 250 candles, even at the 60-candle minimum', () => {
    // A newly-listed coin with a strong short uptrend would trivially look
    // "near its 52-week high" if the high/low were computed from whatever
    // short window it has. It must fail closed instead, like sma200Rising.
    const p = computePerformance(series(60, 100, 0.5))!;
    expect(p.candleCount).toBe(60);
    expect(p.pctFrom52wHigh).toBeNull();
  });

  it('does not qualify a thin-history uptrend for SWING purely on a fake proximity-to-high', () => {
    const p = computePerformance(series(90, 100, 0.5))!; // strong uptrend, only 90 days of history
    expect(p.pctFrom52wHigh).toBeNull();
    expect(classifyHorizons(p)).not.toContain('SWING');
  });
});

describe('classifyHorizons', () => {
  it('classifies a sustained uptrend as long-term and swing (at the highs)', () => {
    const p = computePerformance(series(300, 100, 0.3), series(300, 100, 0.05))!;
    const horizons = classifyHorizons(p);
    expect(horizons).toContain('LONG_TERM');
    expect(horizons).toContain('SWING');
  });

  it('gives a downtrend no horizon at all', () => {
    const p = computePerformance(series(300, 100, -0.2), series(300, 100, 0.05))!;
    expect(classifyHorizons(p)).toHaveLength(0);
  });
});

describe('performanceScore', () => {
  it('scores a strong outperformer higher than a weak one', () => {
    const bench = series(300, 100, 0.05);
    const strong = computePerformance(series(300, 100, 0.4), bench)!;
    const weak = computePerformance(series(300, 100, 0.06), bench)!;
    expect(performanceScore(strong))
      .toBeGreaterThan(performanceScore(weak));
  });

  it('always returns a score in [0, 100]', () => {
    const bench = series(300, 100, 0.05);
    const crashed = computePerformance(series(300, 100, -0.5), bench)!;
    const score = performanceScore(crashed);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('scores lower when relative strength is null (no benchmark) than with a known outperformance', () => {
    const bench = series(300, 100, 0.05);
    const withBenchmark = computePerformance(series(300, 100, 0.3), bench)!;
    const withoutBenchmark = computePerformance(series(300, 100, 0.3))!;

    // Both have same internal returns/trend, but withoutBenchmark has null relativeStrength fields
    expect(withoutBenchmark.relativeStrength60d).toBeNull();
    expect(withoutBenchmark.relativeStrength250d).toBeNull();
    expect(withBenchmark.relativeStrength60d).not.toBeNull();
    expect(withBenchmark.relativeStrength250d).not.toBeNull();

    // Null relative strength should score lower than a measured outperformance
    const scoreWithBench = performanceScore(withBenchmark);
    const scoreWithoutBench = performanceScore(withoutBenchmark);
    expect(scoreWithoutBench).toBeLessThan(scoreWithBench);
  });

  it('handles partial relative strength history (60d but not 250d)', () => {
    const p = computePerformance(series(120, 100, 0.3), series(120, 100, 0.05))!;

    // 120 candles: enough for 60d return but not 250d
    expect(p.relativeStrength60d).not.toBeNull();
    expect(p.relativeStrength250d).toBeNull();

    const score = performanceScore(p);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
