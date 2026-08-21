import { describe, it, expect } from 'vitest';
import { ProviderHealthManager } from '../../src/market/supervisor/ProviderHealthManager.js';

describe('ProviderHealthManager', () => {
  it('marks provider as HEALTHY after recording a tick', () => {
    const manager = new ProviderHealthManager({ staleThresholdMs: 5000, degradedThresholdMs: 2000 });
    const now = 100000;
    manager.recordTick('BINANCE', now, 42);

    const health = manager.getHealth('BINANCE', now + 500);
    expect(health.status).toBe('HEALTHY');
    expect(health.stale).toBe(false);
    expect(health.latencyMs).toBe(42);
    expect(manager.isHealthy('BINANCE', now + 500)).toBe(true);
  });

  it('marks provider as DEGRADED after degraded threshold', () => {
    const manager = new ProviderHealthManager({ staleThresholdMs: 5000, degradedThresholdMs: 2000 });
    const now = 100000;
    manager.recordTick('BINANCE', now, 50);

    const health = manager.getHealth('BINANCE', now + 3000);
    expect(health.status).toBe('DEGRADED');
    expect(health.stale).toBe(false);
  });

  it('marks provider as STALE after stale threshold', () => {
    const manager = new ProviderHealthManager({ staleThresholdMs: 5000, degradedThresholdMs: 2000 });
    const now = 100000;
    manager.recordTick('BINANCE', now, 50);

    const health = manager.getHealth('BINANCE', now + 6000);
    expect(health.status).toBe('STALE');
    expect(health.stale).toBe(true);
    expect(manager.isHealthy('BINANCE', now + 6000)).toBe(false);
  });

  it('marks provider as DISCONNECTED when disconnect is recorded', () => {
    const manager = new ProviderHealthManager();
    manager.recordDisconnect('COINDCX');

    const health = manager.getHealth('COINDCX');
    expect(health.status).toBe('DISCONNECTED');
    expect(health.stale).toBe(true);
  });
});
