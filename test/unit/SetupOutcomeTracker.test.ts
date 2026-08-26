import { describe, it, expect } from 'vitest';
import { SetupOutcomeTracker } from '../../src/strategy/SetupOutcomeTracker.js';

describe('SetupOutcomeTracker', () => {
  it('resolves the setup type that opened a symbol and clears it', () => {
    const tracker = new SetupOutcomeTracker();
    tracker.recordOpen('BTCUSDT', 'SSL_SWEEP_REVERSAL_LONG');

    expect(tracker.resolveOnClose('BTCUSDT')).toBe('SSL_SWEEP_REVERSAL_LONG');
    // Resolved once — a second close (e.g. a stray fill) has nothing left to attribute.
    expect(tracker.resolveOnClose('BTCUSDT')).toBeUndefined();
  });

  it('returns undefined for a symbol with no recorded open', () => {
    const tracker = new SetupOutcomeTracker();
    expect(tracker.resolveOnClose('ETHUSDT')).toBeUndefined();
  });

  it('tracks multiple symbols independently', () => {
    const tracker = new SetupOutcomeTracker();
    tracker.recordOpen('BTCUSDT', 'SSL_SWEEP_REVERSAL_LONG');
    tracker.recordOpen('ETHUSDT', 'BEARISH_CHOCH_RETEST_SHORT');

    expect(tracker.resolveOnClose('ETHUSDT')).toBe('BEARISH_CHOCH_RETEST_SHORT');
    expect(tracker.resolveOnClose('BTCUSDT')).toBe('SSL_SWEEP_REVERSAL_LONG');
  });

  it('a later open overwrites an earlier unresolved one for the same symbol', () => {
    const tracker = new SetupOutcomeTracker();
    tracker.recordOpen('BTCUSDT', 'SSL_SWEEP_REVERSAL_LONG');
    tracker.recordOpen('BTCUSDT', 'BULLISH_CHOCH_RETEST_LONG');

    expect(tracker.resolveOnClose('BTCUSDT')).toBe('BULLISH_CHOCH_RETEST_LONG');
  });
});
