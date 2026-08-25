/**
 * Strategy Performance Tracker
 *
 * Closes the feedback loop between realized outcomes and which strategies are
 * allowed to keep trading. Before this, StrategyEngine had no notion of how a
 * strategy was performing: both registered strategies ran always-on at fixed
 * configuration regardless of whether they were making or losing money.
 *
 * Every fill carries the strategyId that produced it and its realized PnL (see
 * PaperBrokerConfig.onFill), which is enough to maintain per-strategy PnL, win
 * rate, and peak-to-trough drawdown. When a strategy breaches its configured
 * limits it is quarantined — StrategyEngine stops routing candles to it — and
 * the decision is surfaced as an event and a metric rather than applied
 * silently.
 *
 * Quarantine is deliberately one-way within a process: re-enabling is an
 * operator action (API/restart), not something the system decides on its own.
 * A strategy that recovers on paper after being shut off for losses has not
 * demonstrated anything — it stopped trading.
 */

import { logger } from '../telemetry/logger.js';
import { metrics } from '../telemetry/metrics.js';

export interface StrategyPerformanceThresholds {
  /** Trades required before quarantine rules apply at all. */
  minTradesBeforeAction: number;
  /** Quarantine once peak-to-trough realized drawdown exceeds this (USDT). */
  maxDrawdownUsdt: number;
  /** Quarantine once win rate falls below this, after minTradesBeforeAction. */
  minWinRate: number;
}

export interface StrategyStats {
  strategyId: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  realizedPnl: number;
  peakPnl: number;
  drawdown: number;
  quarantined: boolean;
  quarantineReason?: string;
  lastTradeAtUtc?: string;
}

export interface StrategyQuarantineEvent {
  strategyId: string;
  reason: string;
  stats: StrategyStats;
}

export const DEFAULT_STRATEGY_THRESHOLDS: StrategyPerformanceThresholds = {
  minTradesBeforeAction: 20,
  maxDrawdownUsdt: 500,
  minWinRate: 0.3,
};

interface MutableStats {
  trades: number;
  wins: number;
  losses: number;
  realizedPnl: number;
  peakPnl: number;
  quarantined: boolean;
  quarantineReason?: string;
  lastTradeAtUtc?: string;
}

export class StrategyPerformanceTracker {
  private thresholds: StrategyPerformanceThresholds;
  private stats = new Map<string, MutableStats>();
  private onQuarantine?: (event: StrategyQuarantineEvent) => void;

  constructor(options?: {
    thresholds?: Partial<StrategyPerformanceThresholds>;
    onQuarantine?: (event: StrategyQuarantineEvent) => void;
  }) {
    this.thresholds = { ...DEFAULT_STRATEGY_THRESHOLDS, ...options?.thresholds };
    this.onQuarantine = options?.onQuarantine;
  }

  /**
   * Record one realized outcome. Only closing fills carry a non-zero realized
   * PnL — an opening fill realizes nothing, so it is not a "trade" for win-rate
   * purposes and is ignored here.
   */
  recordRealizedPnl(strategyId: string, realizedPnl: number, atUtc = new Date().toISOString()): void {
    if (!strategyId || realizedPnl === 0 || !Number.isFinite(realizedPnl)) return;

    const stats = this.getOrCreate(strategyId);
    stats.trades += 1;
    if (realizedPnl > 0) stats.wins += 1;
    else stats.losses += 1;
    stats.realizedPnl += realizedPnl;
    stats.peakPnl = Math.max(stats.peakPnl, stats.realizedPnl);
    stats.lastTradeAtUtc = atUtc;

    metrics.setGauge(`strategy_realized_pnl_usdt{strategy="${strategyId}"}`, stats.realizedPnl);

    this.evaluate(strategyId, stats);
  }

  /** True when the strategy has been shut off for breaching its limits. */
  isQuarantined(strategyId: string): boolean {
    return this.stats.get(strategyId)?.quarantined ?? false;
  }

  getStats(strategyId: string): StrategyStats | undefined {
    const stats = this.stats.get(strategyId);
    return stats ? this.toPublic(strategyId, stats) : undefined;
  }

  listStats(): StrategyStats[] {
    return [...this.stats.entries()].map(([id, stats]) => this.toPublic(id, stats));
  }

  /** Operator override — lift a quarantine and reset the drawdown baseline. */
  release(strategyId: string): boolean {
    const stats = this.stats.get(strategyId);
    if (!stats?.quarantined) return false;
    stats.quarantined = false;
    stats.quarantineReason = undefined;
    stats.peakPnl = stats.realizedPnl;
    logger.info({ strategyId }, '[StrategyPerformance] Quarantine released by operator');
    metrics.setGauge(`strategy_quarantined{strategy="${strategyId}"}`, 0);
    return true;
  }

  /** Restore previously persisted stats (see StrategyPerformanceStore). */
  restore(snapshot: StrategyStats[]): void {
    for (const entry of snapshot) {
      this.stats.set(entry.strategyId, {
        trades: entry.trades,
        wins: entry.wins,
        losses: entry.losses,
        realizedPnl: entry.realizedPnl,
        peakPnl: entry.peakPnl,
        quarantined: entry.quarantined,
        quarantineReason: entry.quarantineReason,
        lastTradeAtUtc: entry.lastTradeAtUtc,
      });
      if (entry.quarantined) {
        metrics.setGauge(`strategy_quarantined{strategy="${entry.strategyId}"}`, 1);
      }
    }
  }

  private evaluate(strategyId: string, stats: MutableStats): void {
    if (stats.quarantined) return;
    if (stats.trades < this.thresholds.minTradesBeforeAction) return;

    const drawdown = stats.peakPnl - stats.realizedPnl;
    const winRate = stats.trades === 0 ? 0 : stats.wins / stats.trades;

    let reason: string | undefined;
    if (drawdown > this.thresholds.maxDrawdownUsdt) {
      reason = `DRAWDOWN_EXCEEDED: ${drawdown.toFixed(2)} USDT from peak > ${this.thresholds.maxDrawdownUsdt}`;
    } else if (winRate < this.thresholds.minWinRate) {
      reason = `WIN_RATE_BELOW_FLOOR: ${(winRate * 100).toFixed(1)}% < ${(this.thresholds.minWinRate * 100).toFixed(1)}%`;
    }

    if (!reason) return;

    stats.quarantined = true;
    stats.quarantineReason = reason;
    metrics.setGauge(`strategy_quarantined{strategy="${strategyId}"}`, 1);
    metrics.inc('strategy_quarantines_total');

    const publicStats = this.toPublic(strategyId, stats);
    logger.warn({ strategyId, reason, stats: publicStats }, '[StrategyPerformance] Strategy quarantined');
    this.onQuarantine?.({ strategyId, reason, stats: publicStats });
  }

  private getOrCreate(strategyId: string): MutableStats {
    let stats = this.stats.get(strategyId);
    if (!stats) {
      stats = { trades: 0, wins: 0, losses: 0, realizedPnl: 0, peakPnl: 0, quarantined: false };
      this.stats.set(strategyId, stats);
    }
    return stats;
  }

  private toPublic(strategyId: string, stats: MutableStats): StrategyStats {
    return {
      strategyId,
      trades: stats.trades,
      wins: stats.wins,
      losses: stats.losses,
      winRate: stats.trades === 0 ? 0 : stats.wins / stats.trades,
      realizedPnl: stats.realizedPnl,
      peakPnl: stats.peakPnl,
      drawdown: stats.peakPnl - stats.realizedPnl,
      quarantined: stats.quarantined,
      quarantineReason: stats.quarantineReason,
      lastTradeAtUtc: stats.lastTradeAtUtc,
    };
  }
}
