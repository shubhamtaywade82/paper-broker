import { describe, it, expect } from 'vitest';
import { ErrorNormalizer } from '../../src/notifications/error-pipeline/ErrorNormalizer.js';

describe('ErrorNormalizer', () => {
  it('normalizes standard errors into structured incidents with generated IDs', () => {
    const normalizer = new ErrorNormalizer();
    const error = new Error('Connection reset by peer');
    const { incident, shouldAlert } = normalizer.normalize({
      component: 'BinanceStreamHandler',
      provider: 'Binance',
      symbol: 'SOLUSDT',
      error,
      severity: 'WARNING',
      actionTaken: 'Reconnecting...',
    });

    expect(shouldAlert).toBe(true);
    expect(incident.incidentId).toMatch(/^INC-\d{8}-[A-Z0-9]+$/);
    expect(incident.component).toBe('BinanceStreamHandler');
    expect(incident.provider).toBe('Binance');
    expect(incident.symbol).toBe('SOLUSDT');
    expect(incident.message).toBe('Connection reset by peer');
    expect(incident.severity).toBe('WARNING');
    expect(incident.classification).toBe('RECOVERABLE');
    expect(incident.occurrenceCount).toBe(1);
  });

  it('deduplicates repetitive errors within window and suppresses duplicate alerts', () => {
    const normalizer = new ErrorNormalizer(60000);
    const error = new Error('Socket timeout');

    const first = normalizer.normalize({
      component: 'BinanceStreamHandler',
      error,
      severity: 'WARNING',
    });
    expect(first.shouldAlert).toBe(true);
    expect(first.incident.occurrenceCount).toBe(1);

    const second = normalizer.normalize({
      component: 'BinanceStreamHandler',
      error,
      severity: 'WARNING',
    });
    expect(second.shouldAlert).toBe(false);
    expect(second.incident.occurrenceCount).toBe(2);
    expect(second.incident.incidentId).toBe(first.incident.incidentId);
  });

  it('does not collide two different long errors sharing the same first 50 characters (Medium)', () => {
    // Previously the dedup key truncated the message to 50 chars, so two
    // genuinely different errors differing only after that point (e.g. a
    // different host/symbol/ID appended at the end) were treated as the
    // same incident and the second one's alert was suppressed.
    const normalizer = new ErrorNormalizer(60000);
    const prefix = 'Failed to fetch order book depth from ';
    expect(prefix.length).toBeLessThan(50);

    const first = normalizer.normalize({
      component: 'BinanceRest', error: `${prefix}https://fapi.binance.com/depth?symbol=BTCUSDT`, severity: 'WARNING',
    });
    const second = normalizer.normalize({
      component: 'BinanceRest', error: `${prefix}https://fapi.binance.com/depth?symbol=ETHUSDT`, severity: 'WARNING',
    });

    expect(first.shouldAlert).toBe(true);
    expect(second.shouldAlert).toBe(true); // must NOT be suppressed as a dup of the first
    expect(second.incident.incidentId).not.toBe(first.incident.incidentId);
    expect(second.incident.occurrenceCount).toBe(1);
  });

  it('infers TRADING_UNSAFE classification for critical risk or reconciliation errors', () => {
    const normalizer = new ErrorNormalizer();
    const { incident } = normalizer.normalize({
      component: 'PositionReconciler',
      error: 'Position size mismatch detected',
      severity: 'CRITICAL',
    });

    expect(incident.classification).toBe('TRADING_UNSAFE');
    expect(incident.severity).toBe('CRITICAL');
  });
});
