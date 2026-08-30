import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../telemetry/logger.js';

/**
 * StrategySelector
 * =================
 *
 * Per-regime strategy promotion/demotion. Wraps the existing
 * StrategyPerformanceTracker (which quarantines a strategy globally on
 * drawdown) with regime-aware granularity: a strategy that loses money in
 * `trending_up` but wins in `ranging` is demoted for the former only, not
 * the latter.
 *
 * Track record keyed by (strategyId, regime) with min-trades + max-drawdown
 * + min-win-rate thresholds, persisted to data/strategy_selector_state.json.
 *
 * Integration with StrategyEngine: when the engine asks "is strategyId
 * allowed to submit a signal right now?", it calls `isEnabled(strategyId, regime)`.
 * The selector returns false if the (strategyId, regime) pair is in
 * `regimeQuarantine`. This is a strict superset of the existing global
 * quarantine — the existing check still runs first.
 *
 * Off by default (AGENT_STRATEGY_SELECTOR_ENABLED=true). When off,
 * `isEnabled()` always returns true — the existing global quarantine is the
 * only gate. Operators who want to disable a strategy globally can still do
 * so via the existing quarantine release endpoint.
 */

export interface StrategySelectorConfig {
  persistencePath: string;
  minTrades: number;
  maxDrawdownUsdt: number;
  minWinRate: number;
  enabled: boolean;
}

interface RegimeStats {
  trades: number;
  wins: number;
  sumPnl: number;
  maxDrawdownUsdt: number;
  /** High-water mark of sumPnl — used to compute drawdown from peak. */
  peakPnl: number;
}

type RegimeStatsMap = Map<string, RegimeStats>; // key = `${strategyId}:${regime}`

interface PersistedShape {
  [strategyId: string]: {
    [regime: string]: RegimeStats;
  };
}

export interface StrategySelectorState {
  config: StrategySelectorConfig;
  demotedPairs: Array<{ strategyId: string; regime: string; reason: string; stats: RegimeStats }>;
}

export class StrategySelector {
  private config: StrategySelectorConfig;
  private stats: RegimeStatsMap = new Map();
  private dirty = false;

  constructor(config: StrategySelectorConfig) {
    this.config = config;
    this.load();
  }

  /**
   * Record the realized PnL of a closed trade attributed to (strategyId, regime).
   * Updates the per-regime rolling track record. Does NOT mutate broker state.
   */
  recordOutcome(strategyId: string, regime: string, pnlUsdt: number): void {
    if (!this.config.enabled) return;
    const key = `${strategyId}:${regime}`;
    const stats = this.stats.get(key) ?? { trades: 0, wins: 0, sumPnl: 0, maxDrawdownUsdt: 0, peakPnl: 0 };

    stats.trades += 1;
    if (pnlUsdt > 0) stats.wins += 1;
    stats.sumPnl += pnlUsdt;
    if (stats.sumPnl > stats.peakPnl) stats.peakPnl = stats.sumPnl;
    const drawdown = stats.peakPnl - stats.sumPnl;
    if (drawdown > stats.maxDrawdownUsdt) stats.maxDrawdownUsdt = drawdown;

    this.stats.set(key, stats);
    this.dirty = true;
  }

  /**
   * Returns false when (strategyId, regime) is regime-quarantined. Returns
   * true otherwise — including when the selector is disabled (the global
   * StrategyPerformanceTracker quarantine is the only gate in that case).
   */
  isEnabled(strategyId: string, regime: string): boolean {
    if (!this.config.enabled) return true;
    const key = `${strategyId}:${regime}`;
    const stats = this.stats.get(key);
    if (!stats) return true;
    if (stats.trades < this.config.minTrades) return true;

    const winRate = stats.wins / stats.trades;
    if (stats.maxDrawdownUsdt > this.config.maxDrawdownUsdt) return false;
    if (winRate < this.config.minWinRate) return false;
    return true;
  }

  /**
   * Returns the reason a (strategyId, regime) is demoted, or null when it's
   * not demoted. Used by the API to surface the demotion logic to operators.
   */
  getDemotionReason(strategyId: string, regime: string): string | null {
    if (!this.config.enabled) return null;
    const key = `${strategyId}:${regime}`;
    const stats = this.stats.get(key);
    if (!stats || stats.trades < this.config.minTrades) return null;
    const winRate = stats.wins / stats.trades;
    if (stats.maxDrawdownUsdt > this.config.maxDrawdownUsdt) {
      return `drawdown ${stats.maxDrawdownUsdt.toFixed(2)} > ${this.config.maxDrawdownUsdt} (trades=${stats.trades})`;
    }
    if (winRate < this.config.minWinRate) {
      return `win rate ${(winRate * 100).toFixed(1)}% < ${(this.config.minWinRate * 100).toFixed(1)}% (trades=${stats.trades})`;
    }
    return null;
  }

  /** Persist the per-regime stats to disk. No-op when nothing changed. */
  save(): void {
    if (!this.dirty) return;
    try {
      const dir = path.dirname(this.config.persistencePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const shape: PersistedShape = {};
      for (const [key, stats] of this.stats.entries()) {
        const [strategyId, regime] = key.split(':');
        if (!strategyId || !regime) continue;
        shape[strategyId] ??= {};
        shape[strategyId][regime] = stats;
      }
      fs.writeFileSync(this.config.persistencePath, JSON.stringify(shape, null, 2));
      this.dirty = false;
    } catch (err) {
      logger.warn({ err, path: this.config.persistencePath }, '[StrategySelector] failed to persist');
    }
  }

  load(): void {
    try {
      if (!fs.existsSync(this.config.persistencePath)) {
        this.stats = new Map();
        return;
      }
      const raw = fs.readFileSync(this.config.persistencePath, 'utf8');
      const shape = JSON.parse(raw) as PersistedShape;
      const map: RegimeStatsMap = new Map();
      for (const [strategyId, regimes] of Object.entries(shape)) {
        for (const [regime, stats] of Object.entries(regimes)) {
          map.set(`${strategyId}:${regime}`, stats);
        }
      }
      this.stats = map;
    } catch (err) {
      logger.warn({ err, path: this.config.persistencePath }, '[StrategySelector] failed to load, starting empty');
      this.stats = new Map();
    }
  }

  /** Snapshot for /api/v1/strategy-selector. */
  getState(): StrategySelectorState {
    const demotedPairs: StrategySelectorState['demotedPairs'] = [];
    for (const [key, stats] of this.stats.entries()) {
      const [strategyId, regime] = key.split(':');
      if (!strategyId || !regime) continue;
      const reason = this.getDemotionReason(strategyId, regime);
      if (reason) {
        demotedPairs.push({ strategyId, regime, reason, stats });
      }
    }
    return { config: this.config, demotedPairs };
  }
}
