import type { MarketDataProviderType } from '../../broker/types.js';
import type { ProviderHealthState } from './types.js';

export interface HealthManagerOptions {
  staleThresholdMs?: number;
  degradedThresholdMs?: number;
}

export class ProviderHealthManager {
  private staleThresholdMs: number;
  private degradedThresholdMs: number;
  private providerStates = new Map<MarketDataProviderType, ProviderHealthState>();

  constructor(options?: HealthManagerOptions) {
    this.staleThresholdMs = options?.staleThresholdMs ?? 5000;
    this.degradedThresholdMs = options?.degradedThresholdMs ?? 2500;
  }

  public recordTick(provider: MarketDataProviderType, tickTimeMs = Date.now(), latencyMs = 0): void {
    this.providerStates.set(provider, {
      provider,
      status: 'HEALTHY',
      lastTickTimeMs: tickTimeMs,
      latencyMs,
      stale: false,
      consecutiveMisses: 0,
    });
  }

  public recordDisconnect(provider: MarketDataProviderType): void {
    const existing = this.getHealth(provider);
    this.providerStates.set(provider, {
      ...existing,
      status: 'DISCONNECTED',
      stale: true,
      consecutiveMisses: existing.consecutiveMisses + 1,
    });
  }

  public getHealth(provider: MarketDataProviderType, nowMs = Date.now()): ProviderHealthState {
    const state = this.providerStates.get(provider);
    if (!state) {
      return {
        provider,
        status: 'DISCONNECTED',
        lastTickTimeMs: 0,
        latencyMs: 0,
        stale: true,
        consecutiveMisses: 1,
      };
    }

    if (state.status === 'DISCONNECTED') {
      return state;
    }

    const elapsed = nowMs - state.lastTickTimeMs;
    if (elapsed > this.staleThresholdMs) {
      return {
        ...state,
        status: 'STALE',
        stale: true,
      };
    }

    if (elapsed > this.degradedThresholdMs) {
      return {
        ...state,
        status: 'DEGRADED',
        stale: false,
      };
    }

    return {
      ...state,
      status: 'HEALTHY',
      stale: false,
    };
  }

  public isHealthy(provider: MarketDataProviderType, nowMs = Date.now()): boolean {
    const health = this.getHealth(provider, nowMs);
    return health.status === 'HEALTHY' && !health.stale;
  }
}
