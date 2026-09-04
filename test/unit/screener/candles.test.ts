import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchDailyCandles } from '../../../src/screener/candles.js';

function rawKline(closeTime: number, open: number, high: number, low: number, close: number, volume: number) {
  return [closeTime - 86400000, String(open), String(high), String(low), String(close), String(volume), closeTime];
}

describe('fetchDailyCandles', () => {
  afterEach(() => vi.restoreAllMocks());

  it('parses real Binance kline array shape into Candle objects', async () => {
    const raw = [rawKline(1000, 100, 110, 95, 105, 12345)];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => raw })));

    const candles = await fetchDailyCandles('BTCUSDT', 1);

    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({
      symbol: 'BTCUSDT', interval: '1d', open: 100, high: 110, low: 95, close: 105, volume: 12345,
    });
  });

  it('throws (does not swallow) on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })));
    await expect(fetchDailyCandles('BTCUSDT', 10)).rejects.toThrow(/429/);
  });

  it('throws (does not swallow) on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    await expect(fetchDailyCandles('BTCUSDT', 10)).rejects.toThrow(/ECONNRESET/);
  });

  it('throws on a malformed (non-array) response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ code: -1121, msg: 'Invalid symbol' }) })));
    await expect(fetchDailyCandles('NOTASYMBOL', 10)).rejects.toThrow(/Invalid symbol|malformed/i);
  });
});
