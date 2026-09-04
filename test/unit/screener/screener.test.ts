import { describe, it, expect, vi } from 'vitest';
import * as candlesModule from '../../../src/screener/candles.js';
import * as universeModule from '../../../src/screener/universe.js';
import { screen, MIN_AVG_TRADED_VALUE } from '../../../src/screener/screener.js';
import type { Candle } from '../../../src/strategy/indicators.js';

function series(days: number, start: number, dailyPct: number, volume = 1_000_000): Candle[] {
  const out: Candle[] = [];
  let price = start;
  for (let i = 0; i < days; i++) {
    price *= 1 + dailyPct / 100;
    out.push({ symbol: 'X', interval: '1d', openTime: i, open: price, high: price * 1.01, low: price * 0.99, close: price, volume });
  }
  return out;
}

describe('screen', () => {
  it('screens a universe, separating passed/failed by real horizon rules', async () => {
    vi.spyOn(universeModule, 'resolveUniverse').mockResolvedValue(['BTCUSDT', 'STRONGCOIN', 'WEAKCOIN']);
    vi.spyOn(candlesModule, 'fetchDailyCandles').mockImplementation(async (symbol) => {
      if (symbol === 'BTCUSDT') return series(300, 100, 0.05); // the benchmark itself
      if (symbol === 'STRONGCOIN') return series(300, 100, 0.4);
      return series(300, 100, -0.2); // WEAKCOIN
    });

    const result = await screen({} as any);

    expect(result.totalScreened).toBe(3);
    expect(result.candidates.find((c) => c.symbol === 'STRONGCOIN')!.passed).toBe(true);
    expect(result.candidates.find((c) => c.symbol === 'WEAKCOIN')!.passed).toBe(false);
    expect(result.topPicks).toContain('STRONGCOIN');
  });

  it('retries a fetch failure once, then reports it as FETCH_FAILED, not NO_HISTORY', async () => {
    vi.spyOn(universeModule, 'resolveUniverse').mockResolvedValue(['BTCUSDT', 'FLAKYCOIN']);
    let flakyCalls = 0;
    vi.spyOn(candlesModule, 'fetchDailyCandles').mockImplementation(async (symbol) => {
      if (symbol === 'BTCUSDT') return series(300, 100, 0.05);
      flakyCalls++;
      throw new Error('429 rate limited');
    });

    const result = await screen({} as any);

    expect(flakyCalls).toBe(2); // one retry
    expect(result.skippedFetchFailed).toEqual(['FLAKYCOIN']);
    expect(result.skippedNoHistory).toEqual([]);
  });

  it('reports genuinely short history as NO_HISTORY, distinct from a fetch failure', async () => {
    vi.spyOn(universeModule, 'resolveUniverse').mockResolvedValue(['BTCUSDT', 'NEWCOIN']);
    vi.spyOn(candlesModule, 'fetchDailyCandles').mockImplementation(async (symbol) => {
      if (symbol === 'BTCUSDT') return series(300, 100, 0.05);
      return series(10, 100, 0.3); // real data, just too little of it
    });

    const result = await screen({} as any);

    expect(result.skippedNoHistory).toEqual(['NEWCOIN']);
    expect(result.skippedFetchFailed).toEqual([]);
  });

  it('rejects an illiquid coin however strong its trend', async () => {
    vi.spyOn(universeModule, 'resolveUniverse').mockResolvedValue(['BTCUSDT', 'THINCOIN']);
    vi.spyOn(candlesModule, 'fetchDailyCandles').mockImplementation(async (symbol) => {
      if (symbol === 'BTCUSDT') return series(300, 100, 0.05);
      return series(300, 100, 0.4, 1); // strong trend, volume=1 -> tiny notional
    });

    const result = await screen({} as any);
    const thin = result.candidates.find((c) => c.symbol === 'THINCOIN')!;
    expect(thin.passed).toBe(false);
    expect(thin.metrics.avgTradedValue).toBeLessThan(MIN_AVG_TRADED_VALUE);
  });

  it('reports progress via the callback during a scan', async () => {
    vi.spyOn(universeModule, 'resolveUniverse').mockResolvedValue(['BTCUSDT']);
    vi.spyOn(candlesModule, 'fetchDailyCandles').mockResolvedValue(series(300, 100, 0.05));

    const messages: string[] = [];
    await screen({} as any, (msg) => messages.push(msg));

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => /universe/i.test(m))).toBe(true);
  });

  it('retries a failed benchmark fetch once, then proceeds normally on success', async () => {
    vi.spyOn(universeModule, 'resolveUniverse').mockResolvedValue(['STRONGCOIN']);
    let benchmarkCalls = 0;
    vi.spyOn(candlesModule, 'fetchDailyCandles').mockImplementation(async (symbol) => {
      if (symbol === 'BTCUSDT') {
        benchmarkCalls++;
        if (benchmarkCalls === 1) throw new Error('429 rate limited');
        return series(300, 100, 0.05);
      }
      return series(300, 100, 0.4);
    });

    const result = await screen({} as any);

    expect(benchmarkCalls).toBe(2);
    expect(result.candidates.find((c) => c.symbol === 'STRONGCOIN')!.passed).toBe(true);
  });

  it('throws a specific error when the benchmark fetch fails persistently, not a generic fetch error', async () => {
    vi.spyOn(universeModule, 'resolveUniverse').mockResolvedValue(['STRONGCOIN']);
    vi.spyOn(candlesModule, 'fetchDailyCandles').mockImplementation(async (symbol) => {
      if (symbol === 'BTCUSDT') throw new Error('429 rate limited');
      return series(300, 100, 0.4);
    });

    await expect(screen({} as any)).rejects.toThrow(/benchmark.*BTCUSDT.*could not be fetched after retry/i);
  });

  it('retries a failed per-symbol fetch once, then treats the coin as a normal, non-skipped candidate', async () => {
    vi.spyOn(universeModule, 'resolveUniverse').mockResolvedValue(['BTCUSDT', 'RETRYCOIN']);
    let retryCoinCalls = 0;
    vi.spyOn(candlesModule, 'fetchDailyCandles').mockImplementation(async (symbol) => {
      if (symbol === 'BTCUSDT') return series(300, 100, 0.05);
      retryCoinCalls++;
      if (retryCoinCalls === 1) throw new Error('429 rate limited');
      return series(300, 100, 0.4);
    });

    const result = await screen({} as any);

    expect(retryCoinCalls).toBe(2);
    expect(result.skippedFetchFailed).toEqual([]);
    expect(result.candidates.find((c) => c.symbol === 'RETRYCOIN')!.passed).toBe(true);
  });
});
