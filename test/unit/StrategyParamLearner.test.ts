import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StrategyParamLearner } from '../../src/strategy/learning/StrategyParamLearner.js';

/**
 * StrategyParamLearner unit tests.
 *
 * Covers:
 *   - disabled learner returns defaultValue
 *   - enabled learner returns defaultValue when no samples
 *   - enabled learner returns defaultValue when samples < minTrades
 *   - ε-greedy exploitation: returns the best-avg candidate once enough
 *     samples exist
 *   - recordOutcome updates the running avg
 *   - persistence to disk survives reload
 */
let tmpDir: string;
let qtablePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'param-learner-test-'));
  qtablePath = path.join(tmpDir, 'qtable.json');
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('StrategyParamLearner', () => {
  it('returns the default when disabled', () => {
    const learner = new StrategyParamLearner({
      persistencePath: qtablePath,
      alpha: 0.1,
      gamma: 0.9,
      epsilon: 0,
      minTrades: 5,
      enabled: false,
    });
    const picked = learner.select('smc-agent-v1', 'trending_up', 'minConfluence', [65, 70, 75], 70);
    expect(picked).toBe(70);
  });

  it('returns the default when no samples exist', () => {
    const learner = new StrategyParamLearner({
      persistencePath: qtablePath,
      alpha: 0.1,
      gamma: 0.9,
      epsilon: 0,
      minTrades: 3,
      enabled: true,
    });
    const picked = learner.select('smc-agent-v1', 'trending_up', 'minConfluence', [65, 70, 75], 70);
    expect(picked).toBe(70);
  });

  it('returns the default when samples are below minTrades', () => {
    const learner = new StrategyParamLearner({
      persistencePath: qtablePath,
      alpha: 0.5,
      gamma: 0.9,
      epsilon: 0,
      minTrades: 5,
      enabled: true,
    });
    // Record only 2 outcomes (below the 5-trade floor)
    learner.recordOutcome('smc-agent-v1', 'trending_up', 'minConfluence', 70, 1.0);
    learner.recordOutcome('smc-agent-v1', 'trending_up', 'minConfluence', 70, 1.0);
    const picked = learner.select('smc-agent-v1', 'trending_up', 'minConfluence', [65, 70, 75], 65);
    expect(picked).toBe(65); // not enough samples yet → default
  });

  it('exploits the best-avg candidate once enough samples exist (ε=0)', () => {
    const learner = new StrategyParamLearner({
      persistencePath: qtablePath,
      alpha: 0.5,
      gamma: 0.9,
      epsilon: 0, // pure exploitation
      minTrades: 3,
      enabled: true,
    });
    // 70 has positive reward; 65 has negative; 75 neutral
    for (let i = 0; i < 4; i++) learner.recordOutcome('smc-agent-v1', 'trending_up', 'minConfluence', 70, 1.0);
    for (let i = 0; i < 4; i++) learner.recordOutcome('smc-agent-v1', 'trending_up', 'minConfluence', 65, -1.0);
    for (let i = 0; i < 4; i++) learner.recordOutcome('smc-agent-v1', 'trending_up', 'minConfluence', 75, 0.0);
    const picked = learner.select('smc-agent-v1', 'trending_up', 'minConfluence', [65, 70, 75], 65);
    expect(picked).toBe(70); // best avg reward
  });

  it('recordOutcome updates the running average via α-weighted update', () => {
    const learner = new StrategyParamLearner({
      persistencePath: qtablePath,
      alpha: 0.5,
      gamma: 0,
      epsilon: 0,
      minTrades: 1,
      enabled: true,
    });
    learner.recordOutcome('s1', 'r1', 'p1', 10, 1.0);
    learner.recordOutcome('s1', 'r1', 'p1', 10, -1.0);
    const stats = learner.listParamStats('s1', 'r1', 'p1');
    expect(stats).not.toBeNull();
    const cell = stats!.cells.find((c) => c.paramValueKey === '10');
    expect(cell).toBeDefined();
    expect(cell!.count).toBe(2);
    // α=0.5 update:
    //   step 1: avg = 0 + 0.5*(1.0 - 0)   = 0.5
    //   step 2: avg = 0.5 + 0.5*(-1.0 - 0.5) = 0.5 - 0.75 = -0.25
    expect(cell!.avg).toBeCloseTo(-0.25, 5);
  });

  it('persists the Q-table to disk and reloads it', () => {
    const learner1 = new StrategyParamLearner({
      persistencePath: qtablePath,
      alpha: 0.5,
      gamma: 0.9,
      epsilon: 0,
      minTrades: 1,
      enabled: true,
    });
    learner1.recordOutcome('s1', 'r1', 'p1', 10, 1.0);
    learner1.save();
    expect(fs.existsSync(qtablePath)).toBe(true);

    const learner2 = new StrategyParamLearner({
      persistencePath: qtablePath,
      alpha: 0.5,
      gamma: 0.9,
      epsilon: 0,
      minTrades: 1,
      enabled: true,
    });
    const stats = learner2.listParamStats('s1', 'r1', 'p1');
    expect(stats).not.toBeNull();
    expect(stats!.cells.length).toBe(1);
    expect(stats!.cells[0]!.count).toBe(1);
  });

  it('listAllStats returns all (strategyId, regime, paramKey) entries', () => {
    const learner = new StrategyParamLearner({
      persistencePath: qtablePath,
      alpha: 0.5,
      gamma: 0.9,
      epsilon: 0,
      minTrades: 1,
      enabled: true,
    });
    learner.recordOutcome('s1', 'r1', 'p1', 10, 1.0);
    learner.recordOutcome('s2', 'r2', 'p2', 20, 2.0);
    const all = learner.listAllStats();
    expect(all.length).toBe(2);
  });

  it('save() is a no-op when nothing has changed since the last save', () => {
    const learner = new StrategyParamLearner({
      persistencePath: qtablePath,
      alpha: 0.5,
      gamma: 0.9,
      epsilon: 0,
      minTrades: 1,
      enabled: true,
    });
    learner.save();
    expect(fs.existsSync(qtablePath)).toBe(false); // never written
  });
});
