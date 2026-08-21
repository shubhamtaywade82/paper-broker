import { describe, it, expect } from 'vitest';
import { DivergenceGuard } from '../../src/market/supervisor/DivergenceGuard.js';

describe('DivergenceGuard', () => {
  it('detects acceptable price divergence within threshold', () => {
    const guard = new DivergenceGuard({ maxDivergenceBps: 50 }); // 0.5% max
    guard.recordPrice('SOLUSDT', 'BINANCE', 100.0);
    const result = guard.recordPrice('SOLUSDT', 'COINDCX', 100.2); // 20 bps (0.2%)

    expect(result.isDivergent).toBe(false);
    expect(result.divergenceBps).toBe(20);
    expect(guard.shouldHaltNewEntries('SOLUSDT')).toBe(false);
  });

  it('detects unacceptable price divergence exceeding threshold and halts entries', () => {
    const guard = new DivergenceGuard({ maxDivergenceBps: 50 }); // 0.5% max
    guard.recordPrice('SOLUSDT', 'BINANCE', 100.0);
    const result = guard.recordPrice('SOLUSDT', 'COINDCX', 101.0); // 100 bps (1.0%)

    expect(result.isDivergent).toBe(true);
    expect(result.divergenceBps).toBe(100);
    expect(guard.shouldHaltNewEntries('SOLUSDT')).toBe(true);
  });

  it('returns false when only one provider has reported price', () => {
    const guard = new DivergenceGuard();
    const result = guard.recordPrice('ETHUSDT', 'BINANCE', 3000.0);
    expect(result.isDivergent).toBe(false);
    expect(result.divergenceBps).toBe(0);
  });
});
