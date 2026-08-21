import { describe, it, expect } from 'vitest';
import { LiveTradingGuard } from '../../src/execution/LiveTradingGuard.js';
import { resolveRuntimeProfile } from '../../src/config/modes/resolver.js';

describe('LiveTradingGuard', () => {
  it('allows execution in paper mode', () => {
    const guard = new LiveTradingGuard();
    const profile = resolveRuntimeProfile({ TRADING_MODE: 'paper' });
    const check = guard.canExecute(profile);
    expect(check.allowed).toBe(true);
  });

  it('allows simulated execution in shadow mode', () => {
    const guard = new LiveTradingGuard();
    const profile = resolveRuntimeProfile({ TRADING_MODE: 'shadow' });
    const check = guard.canExecute(profile);
    expect(check.allowed).toBe(true);
  });

  it('blocks live execution when disarmed', () => {
    const guard = new LiveTradingGuard();
    const profile = resolveRuntimeProfile({
      TRADING_MODE: 'live',
      LIVE_TRADING_ARMED: false,
    });
    const check = guard.canExecute(profile);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('LIVE_TRADING_DISARMED');
  });

  it('allows live execution when armed', () => {
    const guard = new LiveTradingGuard();
    const profile = resolveRuntimeProfile({
      TRADING_MODE: 'live',
      LIVE_TRADING_ARMED: true,
    });
    const check = guard.canExecute(profile);
    expect(check.allowed).toBe(true);
  });

  it('blocks all modes when safe mode is active', () => {
    const guard = new LiveTradingGuard();
    guard.triggerSafeMode('Reconciliation failure detected');
    expect(guard.isSafeMode()).toBe(true);

    const paperProfile = resolveRuntimeProfile({ TRADING_MODE: 'paper' });
    const check = guard.canExecute(paperProfile);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('SAFE_MODE_ACTIVE');

    guard.clearSafeMode();
    expect(guard.isSafeMode()).toBe(false);
    expect(guard.canExecute(paperProfile).allowed).toBe(true);
  });
});
