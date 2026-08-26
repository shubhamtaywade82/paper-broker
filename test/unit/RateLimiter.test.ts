import { describe, expect, it } from 'vitest';
import { RateLimiter, type RateLimiterOptions } from '../../src/api/RateLimiter.js';

const T0 = 1_700_000_000_000;

const OPTS: RateLimiterOptions = {
  read: { capacity: 5, refillPerSec: 1 },
  control: { capacity: 2, refillPerSec: 0.5 },
  idleEvictionMs: 60_000,
  maxTrackedClients: 100,
};

describe('RateLimiter', () => {
  it('allows requests up to the burst capacity', () => {
    const limiter = new RateLimiter(OPTS);
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('1.2.3.4', 'read', T0).allowed).toBe(true);
    }
    expect(limiter.check('1.2.3.4', 'read', T0).allowed).toBe(false);
  });

  it('reports a usable Retry-After when blocked', () => {
    const limiter = new RateLimiter(OPTS);
    for (let i = 0; i < 5; i++) limiter.check('1.2.3.4', 'read', T0);

    const blocked = limiter.check('1.2.3.4', 'read', T0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(blocked.remaining).toBe(0);
  });

  it('refills over time', () => {
    const limiter = new RateLimiter(OPTS);
    for (let i = 0; i < 5; i++) limiter.check('1.2.3.4', 'read', T0);
    expect(limiter.check('1.2.3.4', 'read', T0).allowed).toBe(false);

    // 1 token/sec — three seconds buys three requests, not four.
    expect(limiter.check('1.2.3.4', 'read', T0 + 3000).allowed).toBe(true);
    expect(limiter.check('1.2.3.4', 'read', T0 + 3000).allowed).toBe(true);
    expect(limiter.check('1.2.3.4', 'read', T0 + 3000).allowed).toBe(true);
    expect(limiter.check('1.2.3.4', 'read', T0 + 3000).allowed).toBe(false);
  });

  it('never refills beyond capacity', () => {
    const limiter = new RateLimiter(OPTS);
    limiter.check('1.2.3.4', 'read', T0);

    // A long idle gap must not grant an unbounded burst.
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('1.2.3.4', 'read', T0 + 3_600_000).allowed).toBe(true);
    }
    expect(limiter.check('1.2.3.4', 'read', T0 + 3_600_000).allowed).toBe(false);
  });

  it('keeps read and control budgets independent', () => {
    const limiter = new RateLimiter(OPTS);
    for (let i = 0; i < 5; i++) limiter.check('1.2.3.4', 'read', T0);
    expect(limiter.check('1.2.3.4', 'read', T0).allowed).toBe(false);

    // Exhausting reads must not lock an operator out of control endpoints.
    expect(limiter.check('1.2.3.4', 'control', T0).allowed).toBe(true);
  });

  it('holds control endpoints to a tighter ceiling', () => {
    const limiter = new RateLimiter(OPTS);
    expect(limiter.check('1.2.3.4', 'control', T0).allowed).toBe(true);
    expect(limiter.check('1.2.3.4', 'control', T0).allowed).toBe(true);
    expect(limiter.check('1.2.3.4', 'control', T0).allowed).toBe(false);
  });

  it('tracks clients independently', () => {
    const limiter = new RateLimiter(OPTS);
    for (let i = 0; i < 5; i++) limiter.check('1.1.1.1', 'read', T0);
    expect(limiter.check('1.1.1.1', 'read', T0).allowed).toBe(false);

    // One noisy client must not throttle everybody else.
    expect(limiter.check('2.2.2.2', 'read', T0).allowed).toBe(true);
  });

  it('evicts idle buckets so memory cannot grow without bound', () => {
    // Cap high enough that idle eviction, not the cap, is what is under test.
    const limiter = new RateLimiter({ ...OPTS, maxTrackedClients: 10_000 });
    for (let i = 0; i < 200; i++) limiter.check(`10.0.0.${i}`, 'read', T0);
    expect(limiter.size()).toBe(200);

    // Well past the idle window: the sweep should clear them.
    limiter.check('10.0.1.1', 'read', T0 + 600_000);
    expect(limiter.size()).toBe(1);
  });

  it('caps tracked clients even when none are idle', () => {
    const limiter = new RateLimiter({ ...OPTS, maxTrackedClients: 50, idleEvictionMs: 10 * 60_000 });
    for (let i = 0; i < 300; i++) limiter.check(`10.0.0.${i}`, 'read', T0);

    expect(limiter.size()).toBeLessThanOrEqual(50);
  });

  it('resets cleanly', () => {
    const limiter = new RateLimiter(OPTS);
    for (let i = 0; i < 5; i++) limiter.check('1.2.3.4', 'read', T0);
    limiter.reset();

    expect(limiter.size()).toBe(0);
    expect(limiter.check('1.2.3.4', 'read', T0).allowed).toBe(true);
  });
});
