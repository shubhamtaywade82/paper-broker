import type { EventLog } from '../persistence/EventLog.js';
import type { WebSocketGateway } from '../api/websocket/WebSocketGateway.js';
import type { AccountState } from '../broker/types.js';
import type { HealthState } from './HealthMonitor.js';
import { logger } from '../telemetry/logger.js';
import { metrics } from '../telemetry/metrics.js';

export type CircuitBreakerReason =
  | 'MAX_DAILY_LOSS'
  | 'MAX_DRAWDOWN'
  | 'CONSECUTIVE_LOSSES'
  | 'MARKET_UNHEALTHY'
  | 'MODEL_UNREACHABLE'
  | 'OPERATOR_OVERRIDE';

export interface CircuitBreakerConfig {
  /** Max daily realized loss as fraction of equity (e.g. 0.03 = 3%). */
  maxDailyLossPct: number;
  /** Max consecutive losing trades before tripping. */
  maxConsecutiveLosses: number;
  /** Max peak-to-trough drawdown as fraction of peak equity. */
  maxDrawdownPct: number;
  /** How long to stay tripped before auto-clearing (ms). */
  cooldownMs: number;
  /** If true, an unhealthy market/model also trips the breaker. */
  requireHealthyMarket: boolean;
}

export interface CircuitBreakerDeps {
  eventLog: EventLog;
  wsGateway: WebSocketGateway;
  /** Current account state (equity, dailyRealizedPnl, peakEquity, drawdown). */
  getAccount: () => AccountState;
  /** Latest rolling stats from the PerformanceTracker (for consecutive-loss count). */
  getConsecutiveLosses: () => number;
  /** Latest health snapshot from the HealthMonitor. */
  getHealth: () => HealthState;
}

export interface CircuitBreakerState {
  tripped: boolean;
  reason: CircuitBreakerReason | null;
  trippedAt: number;
  /** When the cooldown expires (trippedAt + cooldownMs). 0 if not tripped. */
  cooldownEndsAt: number;
  /** Number of times the breaker has tripped since process start. */
  totalTrips: number;
}

/**
 * Self-preservation layer.
 *
 * The circuit breaker is a single boolean the agent consults before every
 * new entry. It trips when ANY of:
 *   - daily realized loss exceeds {@link CircuitBreakerConfig.maxDailyLossPct} * equity
 *   - peak-to-trough drawdown exceeds {@link CircuitBreakerConfig.maxDrawdownPct}
 *   - N consecutive losing trades (from {@link PerformanceTracker})
 *   - market data is unhealthy (if {@link CircuitBreakerConfig.requireHealthyMarket})
 *
 * Once tripped, the agent refuses to open new positions for
 * {@link CircuitBreakerConfig.cooldownMs}. Existing positions continue to be
 * managed by their stops/targets/trailing logic — the breaker is a "no new
 * risk" switch, not a "flatten everything" switch.
 *
 * The breaker does NOT auto-release a quarantined strategy
 * (StrategyPerformanceTracker.release is operator-only by design).
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = {
    tripped: false,
    reason: null,
    trippedAt: 0,
    cooldownEndsAt: 0,
    totalTrips: 0,
  };
  private peakEquity: number;

  constructor(
    private readonly config: CircuitBreakerConfig,
    private readonly deps: CircuitBreakerDeps
  ) {
    // Seed peak equity from the current account so the drawdown check
    // doesn't fire on the very first cycle if the account has had a
    // historical peak already.
    const acct = this.deps.getAccount();
    this.peakEquity = acct.peakEquity ?? acct.equity;
    metrics.setGauge('autonomous_circuit_breaker_active', 0);
  }

  /**
   * Decide whether the agent may submit new entries this cycle. Side-effecting:
   * trips the breaker if any threshold is breached, and auto-clears it once
   * the cooldown elapses.
   */
  check(now = Date.now()): { allowEntries: boolean; reason: CircuitBreakerReason | null } {
    // 1. If tripped, see if cooldown has elapsed.
    if (this.state.tripped) {
      if (now >= this.state.cooldownEndsAt) {
        this.clear(now, 'COOLDOWN_ELAPSED');
      } else {
        return { allowEntries: false, reason: this.state.reason };
      }
    }

    // 2. Pull current state.
    const account = this.deps.getAccount();
    const consecutiveLosses = this.deps.getConsecutiveLosses();
    const health = this.deps.getHealth();

    // 3. Update peak equity (used by drawdown check).
    if (account.equity > this.peakEquity) {
      this.peakEquity = account.equity;
    }

    // 4. Evaluate each threshold. First breach wins.
    const dailyLossPct = this.computeDailyLossPct(account);
    if (dailyLossPct >= this.config.maxDailyLossPct) {
      this.trip('MAX_DAILY_LOSS', now, { dailyLossPct, threshold: this.config.maxDailyLossPct });
      return { allowEntries: false, reason: 'MAX_DAILY_LOSS' };
    }

    const drawdownPct = this.peakEquity > 0 ? Math.max(0, (this.peakEquity - account.equity) / this.peakEquity) : 0;
    if (drawdownPct >= this.config.maxDrawdownPct) {
      this.trip('MAX_DRAWDOWN', now, { drawdownPct, peakEquity: this.peakEquity, equity: account.equity });
      return { allowEntries: false, reason: 'MAX_DRAWDOWN' };
    }

    if (consecutiveLosses >= this.config.maxConsecutiveLosses) {
      this.trip('CONSECUTIVE_LOSSES', now, { consecutiveLosses, threshold: this.config.maxConsecutiveLosses });
      return { allowEntries: false, reason: 'CONSECUTIVE_LOSSES' };
    }

    if (this.config.requireHealthyMarket && !health.healthy) {
      // Only trip if the health monitor reported an actual issue — not just
      // "I haven't probed yet".
      if (health.issues.length > 0) {
        this.trip('MARKET_UNHEALTHY', now, { issues: health.issues });
        return { allowEntries: false, reason: 'MARKET_UNHEALTHY' };
      }
    }

    return { allowEntries: true, reason: null };
  }

  /** Force-trip the breaker (operator override via API). */
  forceTrip(reason: CircuitBreakerReason = 'OPERATOR_OVERRIDE', now = Date.now()): void {
    this.trip(reason, now, { manual: true });
  }

  /** Force-clear the breaker (operator override via API). */
  forceClear(now = Date.now()): void {
    this.clear(now, 'OPERATOR_OVERRIDE');
  }

  getState(): CircuitBreakerState {
    return { ...this.state };
  }

  /**
   * Compute the current daily realized loss as a fraction of equity. The
   * AccountState carries `dailyRealizedPnl?` when the broker tracks it; if
   * it's missing, we fall back to `0` (the breaker can't enforce what the
   * broker doesn't measure — better to skip than to crash).
   */
  private computeDailyLossPct(account: AccountState): number {
    if (typeof account.dailyRealizedPnl !== 'number') return 0;
    if (account.dailyRealizedPnl >= 0) return 0;
    if (account.equity <= 0) return 1;
    return Math.abs(account.dailyRealizedPnl) / account.equity;
  }

  private trip(reason: CircuitBreakerReason, now: number, payload: Record<string, unknown>): void {
    if (this.state.tripped) return; // already tripped — don't double-log
    this.state = {
      tripped: true,
      reason,
      trippedAt: now,
      cooldownEndsAt: now + this.config.cooldownMs,
      totalTrips: this.state.totalTrips + 1,
    };
    metrics.setGauge('autonomous_circuit_breaker_active', 1);
    metrics.inc('autonomous_circuit_breaker_trips_total');
    logger.warn({ reason, ...payload }, 'Circuit breaker tripped — agent will stand aside');
    this.deps.eventLog.appendSystemEvent({
      eventType: 'AUTONOMOUS_CIRCUIT_BREAKER_TRIPPED',
      payload: { reason, cooldownEndsAt: new Date(this.state.cooldownEndsAt).toISOString(), ...payload },
      createdAtUtc: new Date(now).toISOString(),
    });
    this.deps.wsGateway.broadcast('agent.autonomous.circuit_breaker', {
      action: 'tripped',
      reason,
      trippedAt: now,
      cooldownEndsAt: this.state.cooldownEndsAt,
      ...payload,
    });
  }

  private clear(now: number, reason: string): void {
    if (!this.state.tripped) return;
    const prev = this.state;
    this.state = {
      tripped: false,
      reason: null,
      trippedAt: 0,
      cooldownEndsAt: 0,
      totalTrips: this.state.totalTrips,
    };
    metrics.setGauge('autonomous_circuit_breaker_active', 0);
    logger.info({ reason, prev }, 'Circuit breaker cleared — agent will resume entries');
    this.deps.eventLog.appendSystemEvent({
      eventType: 'AUTONOMOUS_CIRCUIT_BREAKER_CLEARED',
      payload: { reason, prevReason: prev.reason, prevTrippedAt: prev.trippedAt },
      createdAtUtc: new Date(now).toISOString(),
    });
    this.deps.wsGateway.broadcast('agent.autonomous.circuit_breaker', {
      action: 'cleared',
      reason,
      clearedAt: now,
    });
  }
}

// Re-export the type so callers don't have to import from HealthMonitor when
// they only need the breaker's view of it.
export type { HealthState };
