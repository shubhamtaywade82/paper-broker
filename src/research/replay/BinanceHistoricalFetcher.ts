import type { Candle } from '../../strategy/indicators.js';
import type { HistoricalDataset, HistoricalFundingRate } from './types.js';

export class BinanceHistoricalFetcher {
  static async fetchKlines(
    symbol = 'SOLUSDT',
    interval: '4h' | '1h' | '15m' | '5m' | '1m',
    limit = 500,
    startTime?: number,
    endTime?: number
  ): Promise<Candle[]> {
    const allCandles: Candle[] = [];
    let currentStart = startTime;
    const batchSize = 1000;

    while (true) {
      let url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${batchSize}`;
      if (currentStart) url += `&startTime=${currentStart}`;
      if (endTime) url += `&endTime=${endTime}`;

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch klines from Binance: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as Array<[number, string, string, string, string, string, number, string, number, string, string, string]>;
      if (data.length === 0) break;

      for (const d of data) {
        allCandles.push({
          symbol,
          interval,
          openTime: d[0],
          closeTime: d[6],
          open: Number(d[1]),
          high: Number(d[2]),
          low: Number(d[3]),
          close: Number(d[4]),
          volume: Number(d[5]),
          isClosed: true,
        });
      }

      if (data.length < batchSize) break;
      const last = data[data.length - 1];
      if (!last) break;
      currentStart = last[0] + 1;
    }

    return allCandles.slice(-limit);
  }

  static async fetchFundingRates(symbol = 'SOLUSDT', limit = 100): Promise<HistoricalFundingRate[]> {
    const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = (await res.json()) as Array<{ symbol: string; fundingTime: number; fundingRate: string }>;
    return data.map((d) => ({
      timestamp: d.fundingTime,
      fundingRate: Number(d.fundingRate),
    }));
  }

  static async loadSolusdtDataset(targetDays = 3, symbol = 'SOLUSDT'): Promise<HistoricalDataset> {
    const now = Date.now();
    const replayDurationMs = targetDays * 24 * 3600 * 1000;
    const replayStartTime = now - replayDurationMs;

    const start4h = replayStartTime - 30 * 4 * 3600 * 1000;
    const start1h = replayStartTime - 40 * 3600 * 1000;
    const start15m = replayStartTime - 60 * 900 * 1000;
    const start5m = replayStartTime - 60 * 300 * 1000;

    const [candles4h, candles1h, candles15m, candles5m, fundingRates] = await Promise.all([
      this.fetchKlines(symbol, '4h', targetDays * 6 + 30, start4h, now),
      this.fetchKlines(symbol, '1h', targetDays * 24 + 40, start1h, now),
      this.fetchKlines(symbol, '15m', targetDays * 96 + 60, start15m, now),
      this.fetchKlines(symbol, '5m', targetDays * 288 + 60, start5m, now),
      this.fetchFundingRates(symbol, 100),
    ]);

    return {
      symbol,
      candles4h,
      candles1h,
      candles15m,
      candles5m,
      fundingRates,
    };
  }
}
