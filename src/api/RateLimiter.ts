/**
 * API Rate Limiter
 *
 * Fastify has no built-in rate limiting and `@fastify/rate-limit` is not a
 * dependency here, so this is a small self-contained limiter in the same
 * token-bucket style the repository already uses for Telegram sends
 * (`TokenBucket` in src/notifications/TelegramLimiter.ts).
 *
 * Two tiers, because the endpoints have very different risk and traffic
 * profiles: the dashboard polls read endpoints continuously and must not be
 * throttled in normal use, while control endpoints submit orders, flip the kill
 * switch and arm live trading — those deserve a tight ceiling regardless of how
 * generous the read budget is.
 *
 * Buckets are per client key (IP by default) and pruned once idle, so a long
 * uptime with churning client addresses cannot grow memory without bound.
 */

export interface RateLimitTier {
  /** Maximum burst size. */
  capacity: number;
  /** Sustained refill rate, tokens per second. */
  refillPerSec: number;
}

export interface RateLimiterOptions {
  read: RateLimitTier;
  control: RateLimitTier;
  /** Drop a client's bucket after this long with no requests. */
  idleEvictionMs?: number;
  /** Hard cap on tracked clients; the oldest idle entries are evicted first. */
  maxTrackedClients?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds the caller should wait before retrying. Only set when blocked. */
  retryAfterSec?: number;
  remaining: number;
}

export const DEFAULT_RATE_LIMITS: RateLimiterOptions = {
  // 600/min sustained, 120 burst — a 1s-polling dashboard sits well inside this.
  read: { capacity: 120, refillPerSec: 10 },
  // 60/min sustained, 20 burst — ample for human operation, hostile to scripts.
  control: { capacity: 20, refillPerSec: 1 },
  idleEvictionMs: 10 * 60_000,
  maxTrackedClients: 10_000,
};

interface Bucket {
  tokens: number;
  lastRefillMs: number;
  lastSeenMs: number;
}

export type RateLimitScope = 'read' | 'control';

export class RateLimiter {
  private options: RateLimiterOptions;
  private buckets = new Map<string, Bucket>();

  constructor(options: RateLimiterOptions = DEFAULT_RATE_LIMITS) {
    this.options = options;
  }

  /**
   * Consume one token for `key` in `scope`. Never throws — a limiter that can
   * fail closed on its own bug would take the API down with it.
   */
  check(key: string, scope: RateLimitScope, nowMs = Date.now()): RateLimitDecision {
    const tier = scope === 'control' ? this.options.control : this.options.read;
    const bucketKey = `${scope}:${key}`;

    let bucket = this.buckets.get(bucketKey);
    if (!bucket) {
      bucket = { tokens: tier.capacity, lastRefillMs: nowMs, lastSeenMs: nowMs };
      this.buckets.set(bucketKey, bucket);
    }

    const elapsedSec = Math.max(0, (nowMs - bucket.lastRefillMs) / 1000);
    bucket.tokens = Math.min(tier.capacity, bucket.tokens + elapsedSec * tier.refillPerSec);
    bucket.lastRefillMs = nowMs;
    bucket.lastSeenMs = nowMs;

    // Swept after the insert, not before: sweeping first left the map one over
    // the cap, because the bucket we were about to add was not counted.
    this.evictIdle(nowMs);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, remaining: Math.floor(bucket.tokens) };
    }

    // Time until one whole token is available again.
    const deficit = 1 - bucket.tokens;
    const retryAfterSec = Math.max(1, Math.ceil(deficit / tier.refillPerSec));
    return { allowed: false, retryAfterSec, remaining: 0 };
  }

  /** Number of tracked buckets. Exposed for tests and telemetry. */
  size(): number {
    return this.buckets.size;
  }

  reset(): void {
    this.buckets.clear();
  }

  private evictIdle(nowMs: number): void {
    const idleMs = this.options.idleEvictionMs ?? DEFAULT_RATE_LIMITS.idleEvictionMs!;
    const maxClients = this.options.maxTrackedClients ?? DEFAULT_RATE_LIMITS.maxTrackedClients!;

    // Cheap path: skip the sweep while the map is small and under the cap.
    if (this.buckets.size <= maxClients && this.buckets.size < 128) return;

    for (const [key, bucket] of this.buckets) {
      if (nowMs - bucket.lastSeenMs > idleMs) {
        this.buckets.delete(key);
      }
    }

    // Still over the cap after evicting idle entries: drop the least recently
    // seen until back under it, rather than growing without bound.
    if (this.buckets.size > maxClients) {
      const byAge = [...this.buckets.entries()].sort((a, b) => a[1].lastSeenMs - b[1].lastSeenMs);
      const excess = this.buckets.size - maxClients;
      for (let i = 0; i < excess; i++) {
        const entry = byAge[i];
        if (entry) this.buckets.delete(entry[0]);
      }
    }
  }
}
