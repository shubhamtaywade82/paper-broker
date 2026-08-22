import type { Candle } from '../../strategy/indicators.js';
import type { HistoricalFundingRate } from '../replay/types.js';

export interface DatasetTimeframeStats {
  interval: string;
  expectedCount: number;
  receivedCount: number;
  missingCount: number;
  duplicateCount: number;
  rejectedCount: number;
  gapCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
}

export interface DatasetManifest {
  id: string;
  symbol: string;
  market: string;
  timeframes: string[];
  startTimestamp: number;
  endTimestamp: number;
  durationDays: number;
  datasetHash: string;
  timeframeStats: Record<string, DatasetTimeframeStats>;
  derivativesAvailability: {
    fundingRate: 'AVAILABLE' | 'UNAVAILABLE';
    openInterest: 'AVAILABLE' | 'UNAVAILABLE';
    takerVolume: 'AVAILABLE' | 'UNAVAILABLE';
    orderBookDepth: 'AVAILABLE' | 'UNAVAILABLE';
  };
  retrievedAtUtc: string;
}

export interface StoredHistoricalDataset {
  manifest: DatasetManifest;
  candles4h: Candle[];
  candles1h: Candle[];
  candles15m: Candle[];
  candles5m: Candle[];
  candles1m?: Candle[];
  fundingRates?: HistoricalFundingRate[];
}
