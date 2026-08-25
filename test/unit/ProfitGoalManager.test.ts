import { describe, expect, it } from 'vitest';
import { ProfitGoalManager } from '../../src/trading/goals/ProfitGoalManager.js';
import type { ProfitGoalConfig } from '../../src/trading/goals/ProfitGoalTypes.js';
import { DEFAULT_PROFIT_GOAL_CONFIG } from '../../src/trading/goals/ProfitGoalTypes.js';

const T0 = 1_700_000_000_000;

function makeConfig(overrides: Partial<ProfitGoalConfig> = {}): ProfitGoalConfig {
  return { ...DEFAULT_PROFIT_GOAL_CONFIG, ...overrides };
}

describe('ProfitGoalManager', () => {
  it('starts at full risk with no target achieved', () => {
    const mgr = new ProfitGoalManager(10_000);

    expect(mgr.getCurrentRiskMultiplier()).toBe(1.0);
    expect(mgr.isAnyTargetAchieved()).toBe(false);
    expect(mgr.isTradingAllowed(T0)).toBe(true);
  });

  it('marks the daily target achieved and halves risk under REDUCE_RISK', () => {
    const mgr = new ProfitGoalManager(10_000, makeConfig({ targetAchievedAction: 'REDUCE_RISK' }));

    // 2% of 10,000 = 200
    mgr.updatePnL({ realizedPnl: 200, currentEquity: 10_200, timestamp: T0 });

    expect(mgr.getAchievedTargets().daily).toBe(true);
    expect(mgr.getCurrentRiskMultiplier()).toBe(0.5);
    expect(mgr.getState().dailyTargetAchievedAt).toBe(T0);
  });

  it('does not mark the target achieved below the threshold', () => {
    const mgr = new ProfitGoalManager(10_000);

    mgr.updatePnL({ realizedPnl: 199.99, currentEquity: 10_199.99, timestamp: T0 });

    expect(mgr.isAnyTargetAchieved()).toBe(false);
    expect(mgr.getCurrentRiskMultiplier()).toBe(1.0);
  });

  it('blocks trading during the post-target cooldown and resumes after it', () => {
    const mgr = new ProfitGoalManager(
      10_000,
      makeConfig({ cooldownAfterTargetMs: 3_600_000, enableWeeklyGoals: false })
    );

    mgr.updatePnL({ realizedPnl: 250, currentEquity: 10_250, timestamp: T0 });

    expect(mgr.isTradingAllowed(T0 + 60_000)).toBe(false);
    expect(mgr.isTradingAllowed(T0 + 3_600_000)).toBe(true);
  });

  it('halts trading outright under STOP_TRADING', () => {
    const mgr = new ProfitGoalManager(
      10_000,
      makeConfig({ targetAchievedAction: 'STOP_TRADING', cooldownAfterTargetMs: 0 })
    );

    mgr.updatePnL({ realizedPnl: 250, currentEquity: 10_250, timestamp: T0 });

    expect(mgr.getCurrentRiskMultiplier()).toBe(0);
    expect(mgr.isTradingAllowed(T0 + 86_400_000)).toBe(false);
  });

  it('records the closing day PnL in history and clears daily state on reset', () => {
    const mgr = new ProfitGoalManager(10_000);

    mgr.updatePnL({ realizedPnl: 250, currentEquity: 10_250, timestamp: T0 });
    mgr.resetDaily(10_250);

    const state = mgr.getState();
    expect(state.dailyPnL).toBe(0);
    expect(state.dailyStartingEquity).toBe(10_250);
    expect(state.dailyTargetAchieved).toBe(false);
    expect(state.dailyTargetAchievedAt).toBeUndefined();
    expect(mgr.getCurrentRiskMultiplier()).toBe(1.0);

    // The closed day is recorded with the PnL it actually finished on, not the reset zero.
    const metrics = mgr.getMetrics();
    expect(metrics.totalDaysTraded).toBe(1);
    expect(metrics.daysTargetAchieved).toBe(1);
    expect(metrics.profitOnTargetDays).toBe(250);
  });

  it('reports progress toward the daily target', () => {
    const mgr = new ProfitGoalManager(10_000);

    mgr.updatePnL({ realizedPnl: 100, currentEquity: 10_100, timestamp: T0 });

    // 100 of a 200 target
    expect(mgr.getDailyProgressPercent()).toBeCloseTo(50, 6);
  });

  it('round-trips through toJSON/fromJSON', () => {
    const mgr = new ProfitGoalManager(10_000);
    mgr.updatePnL({ realizedPnl: 250, currentEquity: 10_250, timestamp: T0 });

    const restored = ProfitGoalManager.fromJSON(JSON.stringify(mgr.toJSON()));

    expect(restored.getState()).toEqual(mgr.getState());
    expect(restored.getConfig()).toEqual(mgr.getConfig());
    expect(restored.getCurrentRiskMultiplier()).toBe(0.5);
  });
});
