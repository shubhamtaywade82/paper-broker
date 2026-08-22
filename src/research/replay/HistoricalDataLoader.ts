import type { Candle } from '../../strategy/indicators.js';
import type { HistoricalDataset, HistoricalFundingRate } from './types.js';

export class HistoricalDataLoader {
  static sanitizeDataset(dataset: HistoricalDataset): HistoricalDataset {
    return {
      symbol: dataset.symbol,
      candles4h: this.sortAndDedupe(dataset.candles4h),
      candles1h: this.sortAndDedupe(dataset.candles1h),
      candles15m: this.sortAndDedupe(dataset.candles15m),
      candles5m: this.sortAndDedupe(dataset.candles5m),
      candles1m: dataset.candles1m ? this.sortAndDedupe(dataset.candles1m) : undefined,
      fundingRates: dataset.fundingRates ? this.sortFunding(dataset.fundingRates) : undefined,
      instrument: dataset.instrument,
    };
  }

  private static sortAndDedupe(candles: Candle[]): Candle[] {
    const map = new Map<number, Candle>();
    for (const c of candles) {
      if (c.open > 0 && c.high >= c.low && c.high >= c.open && c.high >= c.close && c.low <= c.open && c.low <= c.close) {
        map.set(c.openTime, c);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.openTime - b.openTime);
  }

  private static sortFunding(rates: HistoricalFundingRate[]): HistoricalFundingRate[] {
    const map = new Map<number, HistoricalFundingRate>();
    for (const r of rates) {
      map.set(r.timestamp, r);
    }
    return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
  }
}
