import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProfitGoalStore } from '../../src/trading/goals/ProfitGoalStore.js';
import { ProfitGoalManager } from '../../src/trading/goals/ProfitGoalManager.js';
import { DEFAULT_PROFIT_GOAL_CONFIG } from '../../src/trading/goals/ProfitGoalTypes.js';
import { StrategyPerformanceStore } from '../../src/strategy/StrategyPerformanceStore.js';
import { StrategyPerformanceTracker } from '../../src/strategy/StrategyPerformanceTracker.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-broker-store-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('ProfitGoalStore', () => {
  it('returns a fresh manager when no state file exists', () => {
    const store = new ProfitGoalStore(path.join(dir, 'nope.json'));
    const manager = store.load(10_000, DEFAULT_PROFIT_GOAL_CONFIG);

    expect(manager.getCurrentRiskMultiplier()).toBe(1);
    expect(manager.isAnyTargetAchieved()).toBe(false);
  });

  it('round-trips an achieved target across a save/load cycle', () => {
    const file = path.join(dir, 'goals.json');
    const store = new ProfitGoalStore(file);

    const manager = new ProfitGoalManager(10_000, DEFAULT_PROFIT_GOAL_CONFIG);
    manager.updatePnL({ realizedPnl: 250, currentEquity: 10_250, timestamp: 1_700_000_000_000 });
    store.save(manager);

    // This is the property that matters: a restart must not silently re-arm
    // full risk after a target was hit.
    const restored = store.load(10_000, DEFAULT_PROFIT_GOAL_CONFIG);
    expect(restored.getAchievedTargets().daily).toBe(true);
    expect(restored.getCurrentRiskMultiplier()).toBe(0.5);
  });

  it('falls back to a fresh manager on a corrupt state file', () => {
    const file = path.join(dir, 'goals.json');
    fs.writeFileSync(file, '{ not valid json', 'utf8');

    const manager = new ProfitGoalStore(file).load(10_000, DEFAULT_PROFIT_GOAL_CONFIG);
    expect(manager.getCurrentRiskMultiplier()).toBe(1);
  });

  it('creates the parent directory when saving', () => {
    const file = path.join(dir, 'nested', 'deep', 'goals.json');
    new ProfitGoalStore(file).save(new ProfitGoalManager(10_000, DEFAULT_PROFIT_GOAL_CONFIG));

    expect(fs.existsSync(file)).toBe(true);
  });
});

describe('StrategyPerformanceStore', () => {
  it('returns an empty list when no file exists', () => {
    expect(new StrategyPerformanceStore(path.join(dir, 'nope.json')).load()).toEqual([]);
  });

  it('round-trips a quarantine across a save/load cycle', () => {
    const file = path.join(dir, 'perf.json');
    const store = new StrategyPerformanceStore(file);

    const tracker = new StrategyPerformanceTracker({
      thresholds: { minTradesBeforeAction: 2, maxDrawdownUsdt: 10, minWinRate: 0.5 },
    });
    tracker.recordRealizedPnl('alpha', -50);
    tracker.recordRealizedPnl('alpha', -50);
    expect(tracker.isQuarantined('alpha')).toBe(true);

    store.save(tracker.listStats());

    // Bouncing the process must not re-enable a strategy shut off for losses.
    const restored = new StrategyPerformanceTracker();
    restored.restore(store.load());
    expect(restored.isQuarantined('alpha')).toBe(true);
  });

  it('falls back to an empty list on corrupt or non-array content', () => {
    const file = path.join(dir, 'perf.json');

    fs.writeFileSync(file, 'not json at all', 'utf8');
    expect(new StrategyPerformanceStore(file).load()).toEqual([]);

    fs.writeFileSync(file, '{"unexpected":"object"}', 'utf8');
    expect(new StrategyPerformanceStore(file).load()).toEqual([]);
  });
});
