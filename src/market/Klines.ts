import type { Candle } from '../strategy/indicators.js';

export type KlineInterval = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d';

const INTERVAL_MS: Record<KlineInterval, number> = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '6h': 21_600_000,
  '8h': 28_800_000,
  '12h': 43_200_000,
  '1d': 86400_000,
};

export function floorToInterval(ts: number, interval: KlineInterval): number {
  const ms = INTERVAL_MS[interval];
  return Math.floor(ts / ms) * ms;
}

export class KlineStore {
  private candles = new Map<string, Candle[]>();
  private maxPerSeries: number;

  constructor(maxPerSeries = 500) {
    this.maxPerSeries = maxPerSeries;
  }

  async fetchHistoricalKlines(symbol: string, interval: string, limit = 100): Promise<Candle[]> {
    try {
      const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) return this.getCandles(symbol, interval, limit);
      const data = (await res.json()) as Array<[number, string, string, string, string, string]>;
      if (!Array.isArray(data)) return this.getCandles(symbol, interval, limit);

      const candles: Candle[] = data.map((item) => ({
        symbol,
        interval,
        openTime: item[0],
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[5]),
      }));

      for (const candle of candles) {
        this.upsertCandle(candle);
      }
      return candles;
    } catch {
      return this.getCandles(symbol, interval, limit);
    }
  }

  getCandles(symbol: string, interval: string, limit: number): Candle[] {
    const key = `${symbol}:${interval}`;
    const series = this.candles.get(key);
    if (!series) return [];
    return series.slice(-limit);
  }

  getCandlesAsOf(symbol: string, interval: string, asOfTimestamp: number, limit: number): Candle[] {
    const key = `${symbol}:${interval}`;
    const series = this.candles.get(key);
    if (!series) return [];
    // Strict point-in-time filter: no future candles beyond asOfTimestamp
    return series.filter((c) => c.openTime <= asOfTimestamp).slice(-limit);
  }

  getRecent(symbol: string, interval: string, limit: number): Candle[] {
    return this.getCandles(symbol, interval, limit);
  }

  upsertCandle(candle: Candle): void {
    if (candle.high < candle.low || candle.volume < 0 || candle.openTime <= 0) return;
    const key = `${candle.symbol}:${candle.interval}`;
    let series = this.candles.get(key);

    if (!series) {
      series = [];
      this.candles.set(key, series);
    }

    const existingIndex = series.findIndex((c) => c.openTime === candle.openTime);

    if (existingIndex >= 0) {
      series[existingIndex] = candle;
    } else {
      series.push(candle);
      series.sort((a, b) => a.openTime - b.openTime);
    }

    if (series.length > this.maxPerSeries) {
      this.candles.set(key, series.slice(-this.maxPerSeries));
    }
  }

  applyTick(tick: { symbol: string; price: number; qty: number; ts: number }, interval: KlineInterval): Candle | null {
    const openTime = floorToInterval(tick.ts, interval);
    const key = `${tick.symbol}:${interval}`;
    const series = this.candles.get(key) ?? [];
    const existing = series[series.length - 1];

    let candle: Candle;

    if (existing && existing.openTime === openTime) {
      candle = {
        ...existing,
        high: Math.max(existing.high, tick.price),
        low: Math.min(existing.low, tick.price),
        close: tick.price,
        volume: existing.volume + tick.qty,
        isClosed: false,
        receivedAt: Date.now(),
      };
    } else {
      candle = {
        symbol: tick.symbol,
        interval,
        openTime,
        closeTime: openTime + (INTERVAL_MS[interval] ?? 0) - 1,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.qty,
        isClosed: false,
        receivedAt: Date.now(),
      };
    }

    this.upsertCandle(candle);
    return candle;
  }

  detectGaps(symbol: string, interval: KlineInterval): Array<{ expectedTime: number; actualTime: number; missingCount: number }> {
    const key = `${symbol}:${interval}`;
    const series = this.candles.get(key) ?? [];
    const intervalMs = INTERVAL_MS[interval];
    const gaps: Array<{ expectedTime: number; actualTime: number; missingCount: number }> = [];

    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1]!;
      const curr = series[i]!;
      const diff = curr.openTime - prev.openTime;
      if (diff > intervalMs) {
        const missingCount = Math.round(diff / intervalMs) - 1;
        gaps.push({ expectedTime: prev.openTime + intervalMs, actualTime: curr.openTime, missingCount });
      }
    }
    return gaps;
  }

  clear(): void {
    this.candles.clear();
  }

  count(): number {
    return this.candles.size;
  }
}