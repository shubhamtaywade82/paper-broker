import { describe, it, expect } from 'vitest';
import {
  backoffDelay,
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  WsConnectionManager,
} from '../wsConnection.js';

describe('WebSocket backoff math', () => {
  it('BACKOFF-01: delay grows exponentially, base 1s', () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const d = backoffDelay(attempt);
      expect(d).toBeGreaterThanOrEqual(BACKOFF_BASE_MS * Math.pow(2, attempt));
      expect(d).toBeLessThanOrEqual(BACKOFF_CAP_MS + 1_000);
    }
  });

  it('BACKOFF-02: caps at 60s even for attempt=20', () => {
    expect(backoffDelay(20)).toBeLessThanOrEqual(BACKOFF_CAP_MS + 1_000);
  });

  it('BACKOFF-03: jitter is bounded (<= 30% of delay or 1000ms)', () => {
    for (let i = 0; i < 50; i++) {
      const d = backoffDelay(3); // exp = 8000ms
      expect(d).toBeGreaterThanOrEqual(8_000);
      expect(d).toBeLessThanOrEqual(8_000 + 1_000);
    }
  });
});

describe('WsConnectionManager dispatch and listeners', () => {
  it('DISPATCH-01: notifies channel and wildcard listeners on valid messages', () => {
    const manager = new WsConnectionManager();
    const channelCalls: unknown[] = [];
    const wildcardCalls: unknown[] = [];

    const un1 = manager.on('market.tick', (m) => channelCalls.push(m));
    const un2 = manager.on('*', (m) => wildcardCalls.push(m));

    const listenerMap = (manager as any).messageListeners;
    expect(listenerMap.has('market.tick')).toBe(true);
    expect(listenerMap.has('*')).toBe(true);

    un1();
    un2();
    expect(listenerMap.get('market.tick').size).toBe(0);
    expect(listenerMap.get('*').size).toBe(0);
  });

  it('DISPATCH-02: status listener receives initial and updated statuses', () => {
    const manager = new WsConnectionManager();
    const statuses: string[] = [];

    const unsubscribe = manager.onStatus((s) => statuses.push(s));
    expect(statuses).toEqual(['idle']);

    (manager as any).setStatus('connecting');
    expect(statuses).toEqual(['idle', 'connecting']);

    unsubscribe();
  });
});
