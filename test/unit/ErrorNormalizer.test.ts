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
