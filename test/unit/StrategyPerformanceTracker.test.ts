import { describe, expect, it, vi } from 'vitest';
import {
  StrategyPerformanceTracker,
  type StrategyQuarantineEvent,
} from '../../src/strategy/StrategyPerformanceTracker.js';

const THRESHOLDS = { minTradesBeforeAction: 4, maxDrawdownUsdt: 100, minWinRate: 0.5 };

describe('StrategyPerformanceTracker', () => {
  it('ignores fills that realize nothing', () => {
    const tracker = new StrategyPerformanceTracker({ thresholds: THRESHOLDS });
    tracker.recordRealizedPnl('alpha', 0);

    expect(tracker.getStats('alpha')).toBeUndefined();
  });

  it('accumulates PnL, wins and losses per strategy', () => {
    const tracker = new StrategyPerformanceTracker({ thresholds: THRESHOLDS });
    tracker.recordRealizedPnl('alpha', 50);
    tracker.recordRealizedPnl('alpha', -20);
    tracker.recordRealizedPnl('beta', 10);

    const alpha = tracker.getStats('alpha');
    expect(alpha?.trades).toBe(2);
    expect(alpha?.wins).toBe(1);
    expect(alpha?.losses).toBe(1);
    expect(alpha?.realizedPnl).toBe(30);
    expect(alpha?.winRate).toBeCloseTo(0.5, 6);

    // Strategies are tracked independently.
    expect(tracker.getStats('beta')?.realizedPnl).toBe(10);
  });

  it('does not act before the minimum trade count', () => {
    const tracker = new StrategyPerformanceTracker({ thresholds: THRESHOLDS });
    // A catastrophic drawdown, but only 3 trades.
    tracker.recordRealizedPnl('alpha', 500);
    tracker.recordRealizedPnl('alpha', -400);
    tracker.recordRealizedPnl('alpha', -300);

    expect(tracker.isQuarantined('alpha')).toBe(false);
  });

  it('quarantines a strategy that gives back more than the drawdown limit', () => {
    const events: StrategyQuarantineEvent[] = [];
    const tracker = new StrategyPerformanceTracker({
      thresholds: THRESHOLDS,
      onQuarantine: (e) => events.push(e),
    });

    tracker.recordRealizedPnl('alpha', 100);
    tracker.recordRealizedPnl('alpha', 100); // peak 200
    tracker.recordRealizedPnl('alpha', 50);  // peak 250
    tracker.recordRealizedPnl('alpha', -150); // drawdown 150 > 100

    expect(tracker.isQuarantined('alpha')).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]?.reason).toContain('DRAWDOWN_EXCEEDED');
  });

  it('quarantines a strategy whose win rate falls below the floor', () => {
    const tracker = new StrategyPerformanceTracker({ thresholds: THRESHOLDS });
    // 4 trades, 1 win — 25% < 50% floor, and drawdown stays under the limit.
    tracker.recordRealizedPnl('alpha', 10);
    tracker.recordRealizedPnl('alpha', -5);
    tracker.recordRealizedPnl('alpha', -5);
    tracker.recordRealizedPnl('alpha', -5);

    expect(tracker.isQuarantined('alpha')).toBe(true);
    expect(tracker.getStats('alpha')?.quarantineReason).toContain('WIN_RATE_BELOW_FLOOR');
  });

  it('leaves a profitable, accurate strategy alone', () => {
    const tracker = new StrategyPerformanceTracker({ thresholds: THRESHOLDS });
    for (let i = 0; i < 10; i++) tracker.recordRealizedPnl('alpha', 25);

    expect(tracker.isQuarantined('alpha')).toBe(false);
    expect(tracker.getStats('alpha')?.drawdown).toBe(0);
  });

  it('stops re-firing the quarantine callback once quarantined', () => {
    const onQuarantine = vi.fn();
    const tracker = new StrategyPerformanceTracker({ thresholds: THRESHOLDS, onQuarantine });

    for (let i = 0; i < 8; i++) tracker.recordRealizedPnl('alpha', -10);

    expect(tracker.isQuarantined('alpha')).toBe(true);
    expect(onQuarantine).toHaveBeenCalledTimes(1);
  });

  it('releases a quarantine and resets the drawdown baseline', () => {
    const tracker = new StrategyPerformanceTracker({ thresholds: THRESHOLDS });
    for (let i = 0; i < 8; i++) tracker.recordRealizedPnl('alpha', -10);
    expect(tracker.isQuarantined('alpha')).toBe(true);

    expect(tracker.release('alpha')).toBe(true);
    expect(tracker.isQuarantined('alpha')).toBe(false);
    expect(tracker.getStats('alpha')?.drawdown).toBe(0);

    // Releasing something that is not quarantined is a no-op.
    expect(tracker.release('alpha')).toBe(false);
    expect(tracker.release('nonexistent')).toBe(false);
  });

  it('round-trips stats through restore, preserving quarantine state', () => {
    const tracker = new StrategyPerformanceTracker({ thresholds: THRESHOLDS });
    for (let i = 0; i < 8; i++) tracker.recordRealizedPnl('alpha', -10);
    const snapshot = tracker.listStats();

    const restored = new StrategyPerformanceTracker({ thresholds: THRESHOLDS });
    restored.restore(snapshot);

    expect(restored.isQuarantined('alpha')).toBe(true);
    expect(restored.getStats('alpha')?.realizedPnl).toBe(-80);
  });
});
