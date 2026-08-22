import type { Candle } from '../../strategy/indicators.js';
import { BinanceHistoricalFetcher } from '../replay/BinanceHistoricalFetcher.js';
import { DatasetIntegrityValidator } from './DatasetIntegrityValidator.js';
import { HistoricalDatasetStore } from './HistoricalDatasetStore.js';
import type { DatasetManifest, DatasetTimeframeStats, StoredHistoricalDataset } from './types.js';

const INTERVAL_MS: Record<string, number> = {
  '4h': 14400_000,
  '1h': 3600_000,
  '15m': 900_000,
  '5m': 300_000,
  '1m': 60_000,
};

export class HistoricalDatasetPaginator {
  static async fetchPaginatedInterval(
    symbol: string,
    interval: '4h' | '1h' | '15m' | '5m' | '1m',
    startTimestamp: number,
    endTimestamp: number,
    chunkLimit = 1000
  ): Promise<Candle[]> {
    const candles: Candle[] = [];
    let cursor = startTimestamp;
    const intervalMs = INTERVAL_MS[interval] ?? 300_000;

    while (cursor < endTimestamp) {
      const chunk = await BinanceHistoricalFetcher.fetchKlines(
        symbol,
        interval,
        chunkLimit,
        cursor,
        endTimestamp
      );

      if (!chunk || chunk.length === 0) {
        break;
      }

      candles.push(...chunk);
      const lastCandle = chunk[chunk.length - 1]!;
      const nextCursor = lastCandle.openTime + intervalMs;

      if (nextCursor <= cursor) {
        break;
      }
      cursor = nextCursor;
    }

    return candles;
  }

  static async buildDataset(
    symbol: string,
    startTimestamp: number,
    endTimestamp: number,
    include1m = false
  ): Promise<StoredHistoricalDataset> {
    const warmupStart4h = startTimestamp - 30 * INTERVAL_MS['4h']!;
    const warmupStart1h = startTimestamp - 40 * INTERVAL_MS['1h']!;
    const warmupStart15m = startTimestamp - 60 * INTERVAL_MS['15m']!;
    const warmupStart5m = startTimestamp - 60 * INTERVAL_MS['5m']!;

    const [raw4h, raw1h, raw15m, raw5m, raw1m, funding] = await Promise.all([
      this.fetchPaginatedInterval(symbol, '4h', warmupStart4h, endTimestamp),
      this.fetchPaginatedInterval(symbol, '1h', warmupStart1h, endTimestamp),
      this.fetchPaginatedInterval(symbol, '15m', warmupStart15m, endTimestamp),
      this.fetchPaginatedInterval(symbol, '5m', warmupStart5m, endTimestamp),
      include1m ? this.fetchPaginatedInterval(symbol, '1m', startTimestamp, endTimestamp) : Promise.resolve([]),
      BinanceHistoricalFetcher.fetchFundingRates(symbol, 100),
    ]);

    const { cleanCandles: candles4h, stats: stats4h } = DatasetIntegrityValidator.validateTimeframe(raw4h, '4h', INTERVAL_MS['4h']!, warmupStart4h, endTimestamp);
    const { cleanCandles: candles1h, stats: stats1h } = DatasetIntegrityValidator.validateTimeframe(raw1h, '1h', INTERVAL_MS['1h']!, warmupStart1h, endTimestamp);
    const { cleanCandles: candles15m, stats: stats15m } = DatasetIntegrityValidator.validateTimeframe(raw15m, '15m', INTERVAL_MS['15m']!, warmupStart15m, endTimestamp);
    const { cleanCandles: candles5m, stats: stats5m } = DatasetIntegrityValidator.validateTimeframe(raw5m, '5m', INTERVAL_MS['5m']!, warmupStart5m, endTimestamp);

    const timeframeStats: Record<string, DatasetTimeframeStats> = {
      '4h': stats4h,
      '1h': stats1h,
      '15m': stats15m,
      '5m': stats5m,
    };

    const datasetHash = HistoricalDatasetStore.computeDatasetHash({
      '4h': candles4h,
      '1h': candles1h,
      '15m': candles15m,
      '5m': candles5m,
    });

    const manifest: DatasetManifest = {
      id: `DATASET_${symbol}_${startTimestamp}_${endTimestamp}`,
      symbol,
      market: 'Binance USDⓈ-M Perpetual Futures',
      timeframes: ['4h', '1h', '15m', '5m', ...(include1m ? ['1m'] : [])],
      startTimestamp,
      endTimestamp,
      durationDays: Number(((endTimestamp - startTimestamp) / 86_400_000).toFixed(1)),
      datasetHash,
      timeframeStats,
      derivativesAvailability: {
        fundingRate: funding.length > 0 ? 'AVAILABLE' : 'UNAVAILABLE',
        openInterest: 'UNAVAILABLE',
        takerVolume: 'UNAVAILABLE',
        orderBookDepth: 'UNAVAILABLE',
      },
      retrievedAtUtc: new Date().toISOString(),
    };

    return {
      manifest,
      candles4h,
      candles1h,
      candles15m,
      candles5m,
      candles1m: include1m ? raw1m : undefined,
      fundingRates: funding,
    };
  }
}
