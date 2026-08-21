import type { MarketDataProviderType, ProviderHealthStatus } from '../../broker/types.js';

export interface ProviderHealthState {
  provider: MarketDataProviderType;
  status: ProviderHealthStatus;
  lastTickTimeMs: number;
  latencyMs: number;
  stale: boolean;
  consecutiveMisses: number;
}

export interface PriceDivergenceResult {
  symbol: string;
  binancePrice?: number;
  coindcxPrice?: number;
  divergenceBps: number;
  isDivergent: boolean;
}

export interface FailoverValidationResult {
  canFailover: boolean;
  reason?: string;
}
