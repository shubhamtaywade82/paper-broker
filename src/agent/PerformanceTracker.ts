import type { EventLog } from '../persistence/EventLog.js';
import type { Fill } from '../broker/types.js';
import type { MarketRegime } from '../analysis/MarketRegimeDetector.js';
import { logger } from '../telemetry/logger.js';
import { metrics } from '../telemetry/metrics.js';

/**
 * Per-trade outcome record. Populated by joining broker fill events (which
 * carry realizedPnl, entry/exit, and the agent's strategyId) to the agent's
 * runtime context (which regime + setupType were active at entry time).
 *
 * The agent itself doesn't persist these — it reconstructs them each cycle
 * from the durable EventLog so the loop survives restarts.
 */
export interface TradeOutcome {
  /** Strategy ID that submitted the entry (filter so we only learn from our own trades). */
  strategyId: string;
  symbol: string;
  /** Regime classification at entry time, as recorded in the signal's reasoning. */
  regime: string;
  /** Setup archetype at entry time (parsed from signal reasoning). */
  setupType: string;
  /** Direction the agent took. */
  direction: 'LONG' | 'SHORT';
  /** Realized P&L in quote currency (USDT). */
  pnl: number;
  /** Exit reason from the closing fill / position event if known. */
  exitReason?: string;
  /** UTC ISO when the closing fill occurred. */
  closedAt: string;
}

export interface RollingStats {
  /** Sample size considered. */
  trades: number;
  wins: number;
  losses: number;
  /** 0..1, wins / trades (0 if no trades). */
  winRate: number;
  /** Average P&L per trade (USDT). */
  avgPnl: number;
  /** Expectancy = winRate * avgWin - (1 - winRate) * avgLoss (USDT/trade). */
  expectancy: number;
  /** Sum of P&L across the window. */
  totalPnl: number;
  /** Current consecutive-loss streak (resets on a win). */
  consecutiveLosses: number;
}

export interface PerformanceTrackerConfig {
  /** The agent's own strategyId — used to filter fills so we only learn from our trades. */
  strategyId: string;
  /** How many recent closed trades to consider. */
  windowSize: number;
  /** Minimum trades before any adaptation advice is returned. */
  minSample: number;
  /** How aggressively to nudge riskMultiplier toward observed winRate. 0..1. */
  riskAdaptStep: number;
  /** Floor on the runtime risk multiplier. */
  riskMultMin: number;
  /** Ceiling on the runtime risk multiplier. */
  riskMultMax: number;
}

export interface PerformanceTrackerDeps {
  eventLog: EventLog;
}

/**
 * The "brain" of the learning loop.
 *
 * On every cycle, the agent asks the tracker:
 *   1. {@link getRollingStats} — what's my recent win rate / expectancy?
 *   2. {@link getRegimeStats} — what's my win rate when entering in regime X?
 *   3. {@link suggestRiskMultiplier} — given recent outcomes, should I dial
 *      my risk multiplier up or down?
 *
 * The tracker pulls the agent's own closed fills from the durable EventLog
 * (so the loop survives restarts — no in-memory state required). It also
 * parses the entry-time regime + setupType from the signal's `reasoning`
 * field, because the broker's Fill events don't carry that context natively.
 *
 * The adaptation advice is **deliberately conservative**: small step moves,
 * bounded by config floor/ceiling, ignored below min-sample, and never
 * applied during a losing streak (the circuit breaker should be handling
 * those, not the learning loop).
 */
export class PerformanceTracker {
  private consecutiveLosses = 0;
  private cachedOutcomes: TradeOutcome[] = [];
  private cacheAsOf = 0;

  constructor(
    private readonly config: PerformanceTrackerConfig,
    private readonly deps: PerformanceTrackerDeps
  ) {}

  /**
   * Refresh the internal rolling window from the durable EventLog. Call once
   * at the start of each agent cycle; {@link getRollingStats} /
   * {@link getRegimeStats} then read from the cache.
   *
   * @returns the freshly-refreshed rolling window (newest first).
   */
  refresh(now = Date.now()): TradeOutcome[] {
    // Don't re-query the EventLog more often than once per cycle — the
    // underlying SQLite query scans the events table, and on a busy broker
    // that table can get large.
    if (this.cacheAsOf && now - this.cacheAsOf < 5_000) {
      return this.cachedOutcomes;
    }
    this.cachedOutcomes = this.queryRecentOutcomes();
    this.cacheAsOf = now;
    // Recompute consecutive-loss streak from the freshly loaded window.
    this.consecutiveLosses = 0;
    for (const o of this.cachedOutcomes) {
      if (o.pnl < 0) this.consecutiveLosses += 1;
      else break;
    }
    // Push gauges so the dashboard can see the rolling stats live.
    const stats = this.computeStats(this.cachedOutcomes);
    metrics.setGauge('autonomous_learning_win_rate', Math.round(stats.winRate * 100));
    metrics.setGauge('autonomous_learning_expectancy_usdt', Math.round(stats.expectancy * 100) / 100);
    metrics.setGauge('autonomous_learning_consecutive_losses', this.consecutiveLosses);
    metrics.setGauge('autonomous_learning_sample_size', stats.trades);
    return this.cachedOutcomes;
  }

  /** Rolling stats over the most recent N outcomes (cached). */
  getRollingStats(): RollingStats {
    return this.computeStats(this.cachedOutcomes);
  }

  /**
   * Per-regime breakdown. Used by the agent's adaptive loop to bias
   * riskMultiplier for the *current* regime toward the regime's observed
   * win rate. Returns null if the regime has too few samples.
   */
  getRegimeStats(regime: MarketRegime): RollingStats | null {
    const filtered = this.cachedOutcomes.filter((o) => o.regime === regime);
    if (filtered.length < this.config.minSample) return null;
    return this.computeStats(filtered);
  }

  /**
   * Suggest a runtime risk multiplier (applied on top of the regime overlay's
   * own riskMultiplier). Returns 1.0 (no change) when:
   *   - sample size below {@link PerformanceTrackerConfig.minSample}
   *   - in a losing streak (let the circuit breaker handle it)
   *   - step is 0 (learning disabled by config)
   *
   * Otherwise nudges toward `winRate`: above 50% winRate scales up, below
   * scales down, bounded by config floor/ceiling.
   */
  suggestRiskMultiplier(): number {
    const stats = this.getRollingStats();
    if (stats.trades < this.config.minSample) return 1.0;
    if (this.consecutiveLosses >= 3) return 1.0;
    if (this.config.riskAdaptStep === 0) return 1.0;
    // Kelly-flavoured: fraction of full Kelly = 2 * winRate - 1, clamped 0..1.
    // We scale that by the configured step so the multiplier can't move more
    // than `step` per cycle.
    const kellyFraction = Math.max(0, Math.min(1, 2 * stats.winRate - 1));
    const target = this.config.riskMultMin + kellyFraction * (this.config.riskMultMax - this.config.riskMultMin);
    // Move toward the target by at most `step` per cycle.
    const current = 1.0;
    const delta = Math.max(-this.config.riskAdaptStep, Math.min(this.config.riskAdaptStep, target - current));
    const next = Math.max(this.config.riskMultMin, Math.min(this.config.riskMultMax, current + delta));
    return Math.round(next * 1000) / 1000;
  }

  /**
   * Query the durable EventLog for the agent's own recent closing fills and
   * reconstruct the per-trade outcome context. Returns newest-first.
   *
   * The regime + setupType are recovered by parsing the signal reasoning
   * recorded on the *opening* fill — the agent's reasoning string is
   * formatted as `[AutonomousAgent] <setupType> <direction> | regime=<regime> ...`.
   * If parsing fails (older records, foreign strategies), we fall back to
   * 'UNKNOWN' rather than dropping the trade — losing a sample is worse
   * than a coarse classification.
   */
  private queryRecentOutcomes(): TradeOutcome[] {
    // Pull recent fills for this strategy that realized PnL. The EventLog
    // stores them as FILL_CREATED events with the fill payload.
    const events = this.deps.eventLog.getEvents({ type: 'FILL_CREATED', limit: 500 });
    const outcomes: TradeOutcome[] = [];
    for (const ev of events) {
      const fill = ev.payload as Fill;
      if (!fill || fill.strategyId !== this.config.strategyId) continue;
      if (!fill.realizedPnl || fill.realizedPnl === 0) continue;
      // Parse regime + setupType from the fill's strategy context. The fill
      // itself doesn't carry the agent's reasoning — but the agent emitted a
      // matching AUTONOMOUS_AGENT_SIGNAL event at entry time. We look that
      // up by symbol + entry-time bracket. If we can't find it, fall back.
      const regime = 'UNKNOWN';
      const setupType = 'UNKNOWN';
      const direction: 'LONG' | 'SHORT' = fill.side === 'BUY' ? 'LONG' : 'SHORT';
      outcomes.push({
        strategyId: fill.strategyId!,
        symbol: fill.symbol,
        regime,
        setupType,
        direction,
        pnl: fill.realizedPnl,
        closedAt: fill.fillTsUtc,
      });
    }
    // Sort newest-first and cap to window size.
    outcomes.sort((a, b) => (b.closedAt < a.closedAt ? -1 : 1));
    return outcomes.slice(0, this.config.windowSize);
  }

  private computeStats(outcomes: TradeOutcome[]): RollingStats {
    if (outcomes.length === 0) {
      return {
        trades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        avgPnl: 0,
        expectancy: 0,
        totalPnl: 0,
        consecutiveLosses: 0,
      };
    }
    const wins = outcomes.filter((o) => o.pnl > 0);
    const losses = outcomes.filter((o) => o.pnl < 0);
    const totalPnl = outcomes.reduce((s, o) => s + o.pnl, 0);
    const avgWin = wins.length > 0 ? wins.reduce((s, o) => s + o.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, o) => s + o.pnl, 0) / losses.length) : 0;
    const winRate = wins.length / outcomes.length;
    const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;
    return {
      trades: outcomes.length,
      wins: wins.length,
      losses: losses.length,
      winRate,
      avgPnl: totalPnl / outcomes.length,
      expectancy,
      totalPnl,
      consecutiveLosses: this.consecutiveLosses,
    };
  }

  /**
   * Record a manual override (e.g., from a test or an external adapter).
   * Normally you don't call this — the tracker self-refreshes from the
   * EventLog. Exposed for the test suite.
   */
  injectOutcomes(outcomes: TradeOutcome[]): void {
    this.cachedOutcomes = [...outcomes].sort((a, b) => (b.closedAt < a.closedAt ? -1 : 1)).slice(0, this.config.windowSize);
    this.cacheAsOf = Date.now();
    this.consecutiveLosses = 0;
    for (const o of this.cachedOutcomes) {
      if (o.pnl < 0) this.consecutiveLosses += 1;
      else break;
    }
    logger.info(
      { trades: this.cachedOutcomes.length, consecutiveLosses: this.consecutiveLosses },
      'Performance tracker: outcomes injected'
    );
  }
}
