import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StrategySelector } from '../../src/strategy/learning/StrategySelector.js';

/**
 * StrategySelector unit tests.
 *
 * Covers:
 *   - disabled selector always returns isEnabled = true
 *   - enabled selector stays enabled when samples below minTrades
 *   - enabled selector demotes a (strategyId, regime) when win rate < floor
 *   - enabled selector demotes a (strategyId, regime) when drawdown > max
 *   - recordOutcome accumulates per-(strategyId, regime) stats
 *   - persistence + reload
 */
let tmpDir: string;
let statePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-selector-test-'));
  statePath = path.join(tmpDir, 'selector_state.json');
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('StrategySelector', () => {
  it('returns true for everything when disabled', () => {
    const sel = new StrategySelector({
      persistencePath: statePath,
      minTrades: 5,
      maxDrawdownUsdt: 100,
      minWinRate: 0.5,
      enabled: false,
    });
    expect(sel.isEnabled('s1', 'r1')).toBe(true);
    expect(sel.getDemotionReason('s1', 'r1')).toBeNull();
  });

  it('stays enabled when samples are below minTrades', () => {
    const sel = new StrategySelector({
      persistencePath: statePath,
      minTrades: 5,
      maxDrawdownUsdt: 100,
      minWinRate: 0.5,
      enabled: true,
    });
    sel.recordOutcome('s1', 'r1', 10); // 1 trade, below 5
    expect(sel.isEnabled('s1', 'r1')).toBe(true);
    expect(sel.getDemotionReason('s1', 'r1')).toBeNull();
  });

  it('demotes a (strategyId, regime) when win rate is below floor', () => {
    const sel = new StrategySelector({
      persistencePath: statePath,
      minTrades: 5,
      maxDrawdownUsdt: 1000,
      minWinRate: 0.5,
      enabled: true,
    });
    // 10 trades, 2 wins, 8 losses — win rate 0.2 < 0.5
    for (let i = 0; i < 2; i++) sel.recordOutcome('s1', 'r1', 10);
    for (let i = 0; i < 8; i++) sel.recordOutcome('s1', 'r1', -5);
    expect(sel.isEnabled('s1', 'r1')).toBe(false);
    const reason = sel.getDemotionReason('s1', 'r1');
    expect(reason).toMatch(/win rate/);
  });

  it('demotes a (strategyId, regime) when drawdown exceeds the max', () => {
    const sel = new StrategySelector({
      persistencePath: statePath,
      minTrades: 5,
      maxDrawdownUsdt: 50,
      minWinRate: 0.0, // disable win-rate check
      enabled: true,
    });
    // Run up +50 then down 100 — drawdown = 100 > 50
    sel.recordOutcome('s1', 'r1', 50);
    for (let i = 0; i < 10; i++) sel.recordOutcome('s1', 'r1', -10);
    expect(sel.isEnabled('s1', 'r1')).toBe(false);
    const reason = sel.getDemotionReason('s1', 'r1');
    expect(reason).toMatch(/drawdown/);
  });

  it('does NOT demote when stats are healthy', () => {
    const sel = new StrategySelector({
      persistencePath: statePath,
      minTrades: 5,
      maxDrawdownUsdt: 50,
      minWinRate: 0.5,
      enabled: true,
    });
    // 10 trades, 8 wins, 2 small losses — win rate 0.8, no drawdown
    for (let i = 0; i < 8; i++) sel.recordOutcome('s1', 'r1', 10);
    for (let i = 0; i < 2; i++) sel.recordOutcome('s1', 'r1', -2);
    expect(sel.isEnabled('s1', 'r1')).toBe(true);
  });

  it('isolates per-(strategyId, regime) — a bad pair does not demote a good pair', () => {
    const sel = new StrategySelector({
      persistencePath: statePath,
      minTrades: 5,
      maxDrawdownUsdt: 1000,
      minWinRate: 0.5,
      enabled: true,
    });
    // s1:r1 bad
    for (let i = 0; i < 5; i++) sel.recordOutcome('s1', 'r1', -5);
    // s2:r2 good
    for (let i = 0; i < 5; i++) sel.recordOutcome('s2', 'r2', 5);
    expect(sel.isEnabled('s1', 'r1')).toBe(false);
    expect(sel.isEnabled('s2', 'r2')).toBe(true);
  });

  it('persists state to disk and reloads it', () => {
    const sel1 = new StrategySelector({
      persistencePath: statePath,
      minTrades: 5,
      maxDrawdownUsdt: 1000,
      minWinRate: 0.5,
      enabled: true,
    });
    for (let i = 0; i < 5; i++) sel1.recordOutcome('s1', 'r1', -5);
    sel1.save();
    expect(fs.existsSync(statePath)).toBe(true);

    const sel2 = new StrategySelector({
      persistencePath: statePath,
      minTrades: 5,
      maxDrawdownUsdt: 1000,
      minWinRate: 0.5,
      enabled: true,
    });
    expect(sel2.isEnabled('s1', 'r1')).toBe(false); // bad pair still demoted after reload
  });

  it('getState surfaces demoted pairs with reasons', () => {
    const sel = new StrategySelector({
      persistencePath: statePath,
      minTrades: 5,
      maxDrawdownUsdt: 1000,
      minWinRate: 0.5,
      enabled: true,
    });
    for (let i = 0; i < 5; i++) sel.recordOutcome('s1', 'r1', -5);
    const state = sel.getState();
    expect(state.demotedPairs.length).toBe(1);
    expect(state.demotedPairs[0]!.strategyId).toBe('s1');
    expect(state.demotedPairs[0]!.regime).toBe('r1');
    expect(state.demotedPairs[0]!.reason).toMatch(/win rate/);
  });
});
