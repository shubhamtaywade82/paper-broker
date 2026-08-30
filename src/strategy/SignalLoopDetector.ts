import { logger } from '../telemetry/logger.js';
import { metrics } from '../telemetry/metrics.js';

/**
 * Suppresses a signal that is being re-submitted and re-rejected for the same
 * reason, cycle after cycle, with no possibility of a different outcome.
 *
 * The motivating incident: the agent's scale-in path retried one add 1478
 * times, every cycle, each rejected `duplicate: long position already open`.
 * Every retry cost a signal-repository insert, a broker round-trip, an event
 * log append and a dashboard broadcast, and buried real rejections in noise.
 *
 * Two deliberate differences from a turn-based loop detector:
 *
 *  - **Keyed, not single-slot.** A detector holding one "last signature" is
 *    correct for a sequential agent turn loop, but the engine interleaves five
 *    symbols per cycle, so a single slot would reset on every symbol switch and
 *    never trip. Repeats are counted per signature.
 *  - **It expires.** Suppression lifts by itself after {@link forgetAfterMs}.
 *    This is a throttle, never a latch — a rejection that can never clear on
 *    its own is how the circuit breaker bricked the agent for 2239 cycles.
 *
 * The threshold is deliberately generous because some rejections are meant to
 * be transient: `StrategyEngine.expireSignals()` evicts CREATED entries from
 * the dedup map, so a `duplicate:` rejection is expected to start succeeding
 * once the previous signal expires. Tripping too eagerly would suppress
 * submissions that were about to work.
 */
export class SignalLoopDetector {
  private readonly repeats = new Map<string, { count: number; reason: string; lastAt: number }>();

  constructor(
    private readonly maxRepeats = 5,
    private readonly forgetAfterMs = 600_000
  ) {}

  /**
   * True when this signature has been rejected for the same reason
   * {@link maxRepeats} times in a row and the streak has not yet aged out.
   * Callers should skip submission and surface {@link reasonFor}.
   */
  isLooping(key: string, now = Date.now()): boolean {
    const entry = this.repeats.get(key);
    if (!entry) return false;
    if (now - entry.lastAt >= this.forgetAfterMs) {
      this.repeats.delete(key);
      return false;
    }
    return entry.count >= this.maxRepeats;
  }

  /** Human-readable suppression reason, or undefined when not suppressed. */
  reasonFor(key: string, now = Date.now()): string | undefined {
    if (!this.isLooping(key, now)) return undefined;
    const entry = this.repeats.get(key)!;
    return `submission loop: rejected ${entry.count}x with "${entry.reason}"`;
  }

  /**
   * Record an outcome. Pass the reject reason to count a repeat, or `null` on
   * success / a different outcome, which clears the streak.
   */
  record(key: string, rejectReason: string | null, now = Date.now()): void {
    if (rejectReason === null) {
      this.repeats.delete(key);
      return;
    }

    // Keying is what makes this work across interleaved symbols, but it is also
    // what lets the map grow: scale-in keys embed position identity, so a key
    // that takes one rejection and is never submitted again would otherwise sit
    // there forever. Sweep expired entries on the write path.
    this.pruneExpired(now);

    const entry = this.repeats.get(key);
    // A different reason means the situation changed — restart the count
    // rather than accumulating across unrelated failures.
    if (!entry || entry.reason !== rejectReason || now - entry.lastAt >= this.forgetAfterMs) {
      this.repeats.set(key, { count: 1, reason: rejectReason, lastAt: now });
      return;
    }

    entry.count += 1;
    entry.lastAt = now;

    if (entry.count === this.maxRepeats) {
      metrics.inc('signal_submission_loops_total');
      logger.warn(
        { key, reason: rejectReason, repeats: entry.count, forgetAfterMs: this.forgetAfterMs },
        'Signal submission loop detected — suppressing until it ages out'
      );
    }
  }

  /** Number of streaks currently tracked — exposed so the leak stays testable. */
  get size(): number {
    return this.repeats.size;
  }

  /** Drop all tracked streaks. */
  reset(): void {
    this.repeats.clear();
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.repeats) {
      if (now - entry.lastAt >= this.forgetAfterMs) this.repeats.delete(key);
    }
  }
}
