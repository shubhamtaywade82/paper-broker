import type { Candle } from '../strategy/indicators.js';

/**
 * Fetches real daily candles from Binance's public futures klines endpoint.
 * Deliberately does NOT swallow failures the way KlineStore.
 * fetchHistoricalKlines does (src/market/Klines.ts) — a failed fetch must be
 * distinguishable from "this symbol has no history", not silently reported
 * as the same thing. See the plan's "Deviation from the spec" note.
 */
export async function fetchDailyCandles(symbol: string, limit = 400): Promise<Candle[]> {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Binance klines fetch failed for ${symbol}: HTTP ${res.status} ${JSON.stringify(body)}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error(`Binance klines response for ${symbol} was not an array — malformed or an error payload: ${JSON.stringify(data)}`);
  }
  return (data as Array<[number, string, string, string, string, string, number]>).map((item) => ({
    symbol,
    interval: '1d',
    openTime: item[0],
    open: parseFloat(item[1]),
    high: parseFloat(item[2]),
    low: parseFloat(item[3]),
    close: parseFloat(item[4]),
    volume: parseFloat(item[5]),
    closeTime: item[6],
    isClosed: true,
  }));
}
