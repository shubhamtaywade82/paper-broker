import { describe, it, expect } from 'vitest';
import { MarketDataSupervisor } from '../../src/market/supervisor/MarketDataSupervisor.js';
import { ProviderHealthManager } from '../../src/market/supervisor/ProviderHealthManager.js';
import { DivergenceGuard } from '../../src/market/supervisor/DivergenceGuard.js';

describe('MarketDataSupervisor', () => {
  it('keeps Binance as primary when healthy', () => {
    const supervisor = new MarketDataSupervisor({ primary: 'BINANCE', fallback: 'COINDCX' });
    const now = Date.now();

    const res = supervisor.processTick('BINANCE', 'SOLUSDT', 90.0, now);
    expect(res.activeProvider).toBe('BINANCE');
    expect(res.switched).toBe(false);
    expect(supervisor.getActiveProvider()).toBe('BINANCE');
  });

  it('fails over to CoinDCX when Binance is stale and CoinDCX is healthy & price aligned', () => {
    const health = new ProviderHealthManager({ staleThresholdMs: 1000, degradedThresholdMs: 500 });
    const divergence = new DivergenceGuard({ maxDivergenceBps: 50 });
    const supervisor = new MarketDataSupervisor({
      primary: 'BINANCE',
      fallback: 'COINDCX',
      healthManager: health,
      divergenceGuard: divergence,
    });

    const t0 = 100000;
    // Binance and CoinDCX send ticks at t0
    supervisor.processTick('BINANCE', 'SOLUSDT', 90.0, t0);
    supervisor.processTick('COINDCX', 'SOLUSDT', 90.1, t0);

    // At t0 + 1500ms, CoinDCX sends fresh tick, Binance has stopped
    const t1 = t0 + 1500;
    const res = supervisor.processTick('COINDCX', 'SOLUSDT', 90.2, t1);

    expect(res.switched).toBe(true);
    expect(res.activeProvider).toBe('COINDCX');
    expect(res.reason).toContain('switched to COINDCX');
    expect(supervisor.getActiveProvider()).toBe('COINDCX');
  });

  it('refuses failover if CoinDCX price has high divergence', () => {
    const health = new ProviderHealthManager({ staleThresholdMs: 1000, degradedThresholdMs: 500 });
    const divergence = new DivergenceGuard({ maxDivergenceBps: 50 }); // 0.5% max
    const supervisor = new MarketDataSupervisor({
      primary: 'BINANCE',
      fallback: 'COINDCX',
      healthManager: health,
      divergenceGuard: divergence,
    });

    const t0 = 100000;
    supervisor.processTick('BINANCE', 'SOLUSDT', 100.0, t0);
    // CoinDCX price is 105.0 (500 bps divergence!)
    supervisor.processTick('COINDCX', 'SOLUSDT', 105.0, t0 + 500);

    const validation = supervisor.validateFailover('SOLUSDT', t0 + 500);
    expect(validation.canFailover).toBe(false);
    expect(validation.reason).toContain('divergence too high');
  });

  it('restores Binance as active provider when Binance recovers', () => {
    const health = new ProviderHealthManager({ staleThresholdMs: 1000, degradedThresholdMs: 500 });
    const supervisor = new MarketDataSupervisor({
      primary: 'BINANCE',
      fallback: 'COINDCX',
      healthManager: health,
    });

    const t0 = 100000;
    supervisor.processTick('BINANCE', 'SOLUSDT', 90.0, t0);
    supervisor.processTick('COINDCX', 'SOLUSDT', 90.0, t0);

    // Failover to CoinDCX at t0 + 1500
    supervisor.processTick('COINDCX', 'SOLUSDT', 90.0, t0 + 1500);
    expect(supervisor.getActiveProvider()).toBe('COINDCX');

    // Binance recovers at t0 + 2000
    const recoverRes = supervisor.processTick('BINANCE', 'SOLUSDT', 90.0, t0 + 2000);
    expect(recoverRes.switched).toBe(true);
    expect(recoverRes.activeProvider).toBe('BINANCE');
    expect(supervisor.getActiveProvider()).toBe('BINANCE');
  });
});
