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

  getCandles(symbol: string, interval: string, limit: number): Candle[] {
    const key = `${symbol}:${interval}`;
    const series = this.candles.get(key);
    if (!series) return [];
    return series.slice(-limit);
  }

  getRecent(symbol: string, interval: string, limit: number): Candle[] {
    return this.getCandles(symbol, interval, limit);
  }

  upsertCandle(candle: Candle): void {
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
      };
    } else {
      candle = {
        symbol: tick.symbol,
        interval,
        openTime,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.qty,
      };
    }

    this.upsertCandle(candle);
    return candle;
  }

  clear(): void {
    this.candles.clear();
  }

  count(): number {
    return this.candles.size;
  }
}