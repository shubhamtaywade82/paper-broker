import { describe, expect, it } from 'vitest';
import { TrailingStopManager } from '../../src/trading/risk/TrailingStopManager.js';
import type { TrailingStopConfig } from '../../src/trading/risk/TrailingStopManager.js';
import { DEFAULT_TRAILING_STOP_CONFIG } from '../../src/trading/risk/TrailingStopManager.js';
import type { PortfolioPosition } from '../../src/trading/risk/types.js';

const T0 = 1_700_000_000_000;

function makeConfig(overrides: Partial<TrailingStopConfig> = {}): TrailingStopConfig {
  return { ...DEFAULT_TRAILING_STOP_CONFIG, ...overrides };
}

function longPosition(overrides: Partial<PortfolioPosition> = {}): PortfolioPosition {
  return {
    symbol: 'SOLUSDT',
    side: 'LONG',
    quantity: 10,
    entryPrice: 100,
    stopLossPrice: 95,
    notional: 1000,
    unrealizedPnl: 0,
    ...overrides,
  };
}

function shortPosition(overrides: Partial<PortfolioPosition> = {}): PortfolioPosition {
  return {
    symbol: 'SOLUSDT',
    side: 'SHORT',
    quantity: 10,
    entryPrice: 100,
    stopLossPrice: 105,
    notional: 1000,
    unrealizedPnl: 0,
    ...overrides,
  };
}

describe('TrailingStopManager', () => {
  it('leaves the stop alone while the position is below the breakeven trigger', () => {
    const mgr = new TrailingStopManager();
    const res = mgr.updateStopLoss(longPosition(), 100.5, T0);

    expect(res.stopUpdated).toBe(false);
    expect(res.reason).toBe('NO_CHANGE');
    expect(res.newStop).toBe(95);
    expect(res.currentUnrealizedPnlPct).toBeCloseTo(0.005, 6);
  });

  it('never moves a losing LONG stop to breakeven', () => {
    const mgr = new TrailingStopManager();

    // 2% underwater — the same magnitude as a winning move, but the wrong direction.
    const res = mgr.updateStopLoss(longPosition(), 98, T0);

    expect(res.stopUpdated).toBe(false);
    expect(res.reason).toBe('NO_CHANGE');
    expect(res.newStop).toBe(95);
    expect(res.currentUnrealizedPnlPct).toBeCloseTo(-0.02, 6);
  });

  it('never moves a losing SHORT stop to breakeven', () => {
    const mgr = new TrailingStopManager();

    const res = mgr.updateStopLoss(shortPosition(), 102, T0);

    expect(res.stopUpdated).toBe(false);
    expect(res.reason).toBe('NO_CHANGE');
    expect(res.newStop).toBe(105);
    expect(res.currentUnrealizedPnlPct).toBeCloseTo(-0.02, 6);
  });

  it('moves a winning LONG stop to breakeven plus a fee buffer', () => {
    const mgr = new TrailingStopManager(makeConfig({ enableTrailing: false }));

    const res = mgr.updateStopLoss(longPosition(), 101, T0);

    expect(res.stopUpdated).toBe(true);
    expect(res.reason).toBe('BREAKEVEN');
    expect(res.newStop).toBeCloseTo(100.1, 6);
    expect(res.currentUnrealizedPnlPct).toBeCloseTo(0.01, 6);
  });

  it('moves a winning SHORT stop to breakeven below entry', () => {
    const mgr = new TrailingStopManager(makeConfig({ enableTrailing: false }));

    const res = mgr.updateStopLoss(shortPosition(), 99, T0);

    expect(res.stopUpdated).toBe(true);
    expect(res.reason).toBe('BREAKEVEN');
    expect(res.newStop).toBeCloseTo(99.9, 6);
  });

  it('trails a LONG stop behind the highest price seen', () => {
    const mgr = new TrailingStopManager(makeConfig({ enableBreakeven: false }));

    const res = mgr.updateStopLoss(longPosition(), 110, T0);

    expect(res.stopUpdated).toBe(true);
    expect(res.reason).toBe('TRAILING');
    expect(res.highestFavorablePrice).toBe(110);
    // 110 * (1 - 0.015)
    expect(res.newStop).toBeCloseTo(108.35, 6);
  });

  it('trails a SHORT stop above the lowest price seen', () => {
    const mgr = new TrailingStopManager(makeConfig({ enableBreakeven: false }));

    const res = mgr.updateStopLoss(shortPosition(), 90, T0);

    expect(res.stopUpdated).toBe(true);
    expect(res.reason).toBe('TRAILING');
    expect(res.highestFavorablePrice).toBe(90);
    // 90 * (1 + 0.015)
    expect(res.newStop).toBeCloseTo(91.35, 6);
    // The new stop must lock in profit for the short, i.e. sit below entry.
    expect(res.newStop).toBeLessThan(90 * 1.02);
  });

  it('ratchets the LONG stop one way only as price pulls back', () => {
    const mgr = new TrailingStopManager(makeConfig({ enableBreakeven: false }));
    const position = longPosition();

    const up = mgr.updateStopLoss(position, 110, T0);
    expect(up.newStop).toBeCloseTo(108.35, 6);

    // Price retraces but stays above the activation threshold: stop must not loosen.
    const pullback = mgr.updateStopLoss({ ...position, stopLossPrice: up.newStop }, 105, T0 + 1000);
    expect(pullback.stopUpdated).toBe(false);
    expect(pullback.reason).toBe('NO_CHANGE');
    expect(pullback.newStop).toBeCloseTo(108.35, 6);
    expect(pullback.highestFavorablePrice).toBe(110);
  });

  it('ratchets the SHORT stop one way only as price bounces', () => {
    const mgr = new TrailingStopManager(makeConfig({ enableBreakeven: false }));
    const position = shortPosition();

    const down = mgr.updateStopLoss(position, 90, T0);
    expect(down.newStop).toBeCloseTo(91.35, 6);

    const bounce = mgr.updateStopLoss({ ...position, stopLossPrice: down.newStop }, 95, T0 + 1000);
    expect(bounce.stopUpdated).toBe(false);
    expect(bounce.newStop).toBeCloseTo(91.35, 6);
    expect(bounce.highestFavorablePrice).toBe(90);
  });

  it('reaches trailing on the next tick when the resting stop is already past breakeven', () => {
    // Simulates a tracker rebuilt after restart against a broker stop that
    // had already trailed above the freshly-computed breakeven price.
    const mgr = new TrailingStopManager();
    const position = longPosition({ stopLossPrice: 100.5 });

    const first = mgr.updateStopLoss(position, 110, T0);
    expect(first.stopUpdated).toBe(false);
    expect(first.reason).toBe('NO_CHANGE');

    const second = mgr.updateStopLoss(position, 110, T0 + 1000);
    expect(second.stopUpdated).toBe(true);
    expect(second.reason).toBe('TRAILING');
    expect(second.newStop).toBeCloseTo(108.35, 6);
  });

  it('drops the tracker once the position is closed', () => {
    const mgr = new TrailingStopManager(makeConfig({ enableBreakeven: false }));

    mgr.updateStopLoss(longPosition(), 110, T0);
    expect(mgr.getTrackerInfo('SOLUSDT', 'LONG')?.highestFavorablePrice).toBe(110);

    mgr.onPositionClosed('SOLUSDT', 'LONG');
    expect(mgr.getTrackerInfo('SOLUSDT', 'LONG')).toBeUndefined();
  });
});
