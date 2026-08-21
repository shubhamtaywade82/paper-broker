import type { MarketDataProviderType } from '../../broker/types.js';
import { ProviderHealthManager } from './ProviderHealthManager.js';
import { DivergenceGuard } from './DivergenceGuard.js';
import type { FailoverValidationResult } from './types.js';

export interface SupervisorOptions {
  primary?: MarketDataProviderType;
  fallback?: MarketDataProviderType;
  healthManager?: ProviderHealthManager;
  divergenceGuard?: DivergenceGuard;
}

export interface SupervisorTickResult {
  activeProvider: MarketDataProviderType;
  switched: boolean;
  reason?: string;
  divergent: boolean;
}

export class MarketDataSupervisor {
  private primary: MarketDataProviderType;
  private fallback: MarketDataProviderType;
  private active: MarketDataProviderType;
  public readonly health: ProviderHealthManager;
  public readonly divergence: DivergenceGuard;

  constructor(options?: SupervisorOptions) {
    this.primary = options?.primary ?? 'BINANCE';
    this.fallback = options?.fallback ?? 'COINDCX';
    this.active = this.primary;
    this.health = options?.healthManager ?? new ProviderHealthManager();
    this.divergence = options?.divergenceGuard ?? new DivergenceGuard();
  }

  public getActiveProvider(): MarketDataProviderType {
    return this.active;
  }

  public validateFailover(symbol: string, nowMs = Date.now()): FailoverValidationResult {
    if (!this.health.isHealthy(this.fallback, nowMs)) {
      return {
        canFailover: false,
        reason: `Fallback provider ${this.fallback} is not healthy`,
      };
    }

    const div = this.divergence.checkDivergence(symbol);
    if (div.isDivergent) {
      return {
        canFailover: false,
        reason: `Price divergence too high (${div.divergenceBps} bps)`,
      };
    }

    return { canFailover: true };
  }

  public processTick(
    provider: MarketDataProviderType,
    symbol: string,
    price: number,
    tickTimeMs = Date.now(),
    latencyMs = 0
  ): SupervisorTickResult {
    this.health.recordTick(provider, tickTimeMs, latencyMs);
    const divResult = this.divergence.recordPrice(symbol, provider, price);

    const now = tickTimeMs;
    let switched = false;
    let switchReason: string | undefined;

    if (this.active === this.primary && !this.health.isHealthy(this.primary, now)) {
      const failoverCheck = this.validateFailover(symbol, now);
      if (failoverCheck.canFailover) {
        this.active = this.fallback;
        switched = true;
        switchReason = `Primary provider ${this.primary} unhealthy; switched to ${this.fallback}`;
      }
    } else if (this.active === this.fallback && this.health.isHealthy(this.primary, now)) {
      this.active = this.primary;
      switched = true;
      switchReason = `Primary provider ${this.primary} recovered; restored as active`;
    }

    return {
      activeProvider: this.active,
      switched,
      reason: switchReason,
      divergent: divResult.isDivergent,
    };
  }
}
