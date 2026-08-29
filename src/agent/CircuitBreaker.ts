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
  /**
   * Size multiplier applied while a consecutive-loss streak is at or above
   * {@link maxConsecutiveLosses}. Consecutive losses dampen risk rather than
   * veto entries — see {@link CircuitBreaker.check}. Default 0.5.
   */
  consecutiveLossDampener?: number;
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
 * The agent consults this before every new entry. It trips — blocking entries
 * for {@link CircuitBreakerConfig.cooldownMs} — on capital-preservation
 * breaches only:
 *   - daily realized loss exceeds {@link CircuitBreakerConfig.maxDailyLossPct} * equity
 *   - peak-to-trough drawdown exceeds {@link CircuitBreakerConfig.maxDrawdownPct}
 *   - market data is unhealthy (if {@link CircuitBreakerConfig.requireHealthyMarket})
 *
 * A consecutive-loss streak does NOT block. It returns a `riskDampener` the
 * agent folds into its runtime risk multiplier, so a losing run shrinks size
 * while the agent keeps analysing and keeps taking gated entries. Entry
 * quality is enforced upstream by the cost-adjusted netRR gate in
 * AdaptiveRiskManager.computeTradePlan.
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
  check(now = Date.now()): {
    allowEntries: boolean;
    reason: CircuitBreakerReason | null;
    /** Multiply the agent's runtime risk multiplier by this. 1 = no dampening. */
    riskDampener: number;
  } {
    // 1. If tripped, see if cooldown has elapsed.
    if (this.state.tripped) {
      if (now >= this.state.cooldownEndsAt) {
        this.clear(now, 'COOLDOWN_ELAPSED');
      } else {
        return { allowEntries: false, reason: this.state.reason, riskDampener: 1 };
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
    // Capital-preservation stops. These are hard: they bound how much the
    // account can lose, and clearing them is an operator decision.
    const dailyLossPct = this.computeDailyLossPct(account);
    if (dailyLossPct >= this.config.maxDailyLossPct) {
      this.trip('MAX_DAILY_LOSS', now, { dailyLossPct, threshold: this.config.maxDailyLossPct });
      return { allowEntries: false, reason: 'MAX_DAILY_LOSS', riskDampener: 1 };
    }

    const drawdownPct = this.peakEquity > 0 ? Math.max(0, (this.peakEquity - account.equity) / this.peakEquity) : 0;
    if (drawdownPct >= this.config.maxDrawdownPct) {
      this.trip('MAX_DRAWDOWN', now, { drawdownPct, peakEquity: this.peakEquity, equity: account.equity });
      return { allowEntries: false, reason: 'MAX_DRAWDOWN', riskDampener: 1 };
    }

    if (this.config.requireHealthyMarket && !health.healthy) {
      // Only trip if the health monitor reported an actual issue — not just
      // "I haven't probed yet".
      if (health.issues.length > 0) {
        this.trip('MARKET_UNHEALTHY', now, { issues: health.issues });
        return { allowEntries: false, reason: 'MARKET_UNHEALTHY', riskDampener: 1 };
      }
    }

    // Consecutive losses DAMPEN size, they do not veto entries.
    //
    // As a veto this was unreleasable: the streak resets only on a win, a win
    // needs an entry, and the veto blocked every entry. Cooldown expiry cleared
    // the latch and the very same check() re-tripped it on the unchanged streak
    // — observed live as 99 trips / 75 clears over 15-minute cycles with the
    // agent standing aside on every symbol for 2239 consecutive cycles. Even
    // forceClear() could not recover it. Entry *quality* is now gated where it
    // belongs, on the cost-adjusted netRR in AdaptiveRiskManager.computeTradePlan;
    // a losing streak means trade smaller, not stop forever.
    const riskDampener =
      consecutiveLosses >= this.config.maxConsecutiveLosses
        ? this.config.consecutiveLossDampener ?? 0.5
        : 1;

    return { allowEntries: true, reason: null, riskDampener };
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
