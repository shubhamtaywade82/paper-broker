import { describe, it, expect } from 'vitest';
import { resolveRuntimeProfile } from '../../src/config/modes/resolver.js';

describe('resolveRuntimeProfile', () => {
  it('resolves paper mode as default with no real orders', () => {
    const profile = resolveRuntimeProfile({ TRADING_MODE: 'paper' });
    expect(profile.mode).toBe('paper');
    expect(profile.executionVenue).toBe('PAPER');
    expect(profile.realOrders).toBe(false);
    expect(profile.accountReadOnly).toBe(false);
    expect(profile.liveArmed).toBe(false);
    expect(profile.marketDataPrimary).toBe('BINANCE');
    expect(profile.marketDataFallback).toBe('COINDCX');
  });

  it('resolves shadow mode with read-only account and no real orders', () => {
    const profile = resolveRuntimeProfile({ TRADING_MODE: 'shadow' });
    expect(profile.mode).toBe('shadow');
    expect(profile.executionVenue).toBe('PAPER');
    expect(profile.realOrders).toBe(false);
    expect(profile.accountReadOnly).toBe(true);
    expect(profile.reconciliationEnabled).toBe(true);
    expect(profile.liveGuardEnabled).toBe(true);
    expect(profile.liveArmed).toBe(false);
  });

  it('resolves live mode as disarmed if LIVE_TRADING_ARMED is not true', () => {
    const profile = resolveRuntimeProfile({
      TRADING_MODE: 'live',
      LIVE_TRADING_ARMED: false,
    });
    expect(profile.mode).toBe('live');
    expect(profile.executionVenue).toBe('COINDCX');
    expect(profile.realOrders).toBe(false);
    expect(profile.liveArmed).toBe(false);
    expect(profile.accountReadOnly).toBe(false);
    expect(profile.reconciliationEnabled).toBe(true);
  });

  it('resolves live mode as armed when LIVE_TRADING_ARMED is true', () => {
    const profile = resolveRuntimeProfile({
      TRADING_MODE: 'live',
      LIVE_TRADING_ARMED: true,
    });
    expect(profile.mode).toBe('live');
    expect(profile.executionVenue).toBe('COINDCX');
    expect(profile.realOrders).toBe(true);
    expect(profile.liveArmed).toBe(true);
  });

  it('enables telegram only when enabled and credentials are provided', () => {
    const profileNoCreds = resolveRuntimeProfile({
      TRADING_MODE: 'paper',
      TELEGRAM_ENABLED: true,
    });
    expect(profileNoCreds.telegramEnabled).toBe(false);

    const profileWithCreds = resolveRuntimeProfile({
      TRADING_MODE: 'paper',
      TELEGRAM_ENABLED: true,
      TELEGRAM_BOT_TOKEN: '123456:ABC-DEF',
      TELEGRAM_CHAT_ID: '987654321',
    });
    expect(profileWithCreds.telegramEnabled).toBe(true);
  });
});
