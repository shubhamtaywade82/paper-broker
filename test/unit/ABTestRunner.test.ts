import { describe, it, expect } from 'vitest';
import { ABTestRunner } from '../../src/strategy/abtesting/ABTestRunner.js';

/**
 * ABTestRunner unit tests.
 *
 * Skeleton-class tests — the parallel-instance hosting is not yet wired,
 * so these tests cover the evaluation contract: recordOutcome → evaluate
 * promotes the highest-avg instance.
 */
describe('ABTestRunner', () => {
  it('returns null promotedInstanceId when disabled', () => {
    const runner = new ABTestRunner({
      enabled: false,
      instances: 2,
      windowTrades: 10,
      evalIntervalMs: 60_000,
    });
    runner.recordOutcome('ab-1', { ts: Date.now(), symbol: 'BTCUSDT', strategyId: 's1', pnlUsdt: 5 });
    const result = runner.evaluate();
    expect(result.promotedInstanceId).toBeNull();
  });

  it('returns null promotedInstanceId when no instance has enough samples', () => {
    const runner = new ABTestRunner({
      enabled: true,
      instances: 2,
      windowTrades: 10,
      evalIntervalMs: 60_000,
    });
    runner.recordOutcome('ab-1', { ts: Date.now(), symbol: 'BTCUSDT', strategyId: 's1', pnlUsdt: 5 });
    const result = runner.evaluate();
    expect(result.promotedInstanceId).toBeNull();
    expect(result.summary).toMatch(/no instance has enough samples/);
  });

  it('promotes the instance with the highest avg pnl', () => {
    const runner = new ABTestRunner({
      enabled: true,
      instances: 2,
      windowTrades: 50,
      evalIntervalMs: 60_000,
    });
    // ab-1 averages +2.5/trade; ab-2 averages -1/trade
    for (let i = 0; i < 12; i++) {
      runner.recordOutcome('ab-1', { ts: Date.now(), symbol: 'BTCUSDT', strategyId: 's1', pnlUsdt: 2.5 });
    }
    for (let i = 0; i < 12; i++) {
      runner.recordOutcome('ab-2', { ts: Date.now(), symbol: 'BTCUSDT', strategyId: 's1', pnlUsdt: -1 });
    }
    const result = runner.evaluate();
    expect(result.promotedInstanceId).toBe('ab-1');
    expect(result.summary).toMatch(/promoted ab-1/);
  });

  it('keeps only the last windowTrades outcomes per instance', () => {
    const runner = new ABTestRunner({
      enabled: true,
      instances: 1,
      windowTrades: 5,
      evalIntervalMs: 60_000,
    });
    for (let i = 0; i < 20; i++) {
      runner.recordOutcome('ab-1', { ts: Date.now(), symbol: 'BTCUSDT', strategyId: 's1', pnlUsdt: i });
    }
    const state = runner.getState();
    const inst = state.instances[0]!;
    expect(inst.outcomes.length).toBe(5);
    // Last 5 outcomes were 15, 16, 17, 18, 19 — sum 85
    const sum = inst.outcomes.reduce((a, o) => a + o.pnlUsdt, 0);
    expect(sum).toBe(15 + 16 + 17 + 18 + 19);
  });

  it('getState returns the full snapshot for the API', () => {
    const runner = new ABTestRunner({
      enabled: true,
      instances: 2,
      windowTrades: 10,
      evalIntervalMs: 60_000,
    });
    const state = runner.getState();
    expect(state.config.enabled).toBe(true);
    expect(state.instances.length).toBe(2);
    expect(state.promotedInstanceId).toBeNull();
    expect(state.lastEvalAt).toBeNull();
  });

  it('ignores outcomes for unknown instance ids (with a warning, not a throw)', () => {
    const runner = new ABTestRunner({
      enabled: true,
      instances: 2,
      windowTrades: 10,
      evalIntervalMs: 60_000,
    });
    runner.recordOutcome('nonexistent', { ts: Date.now(), symbol: 'BTCUSDT', strategyId: 's1', pnlUsdt: 5 });
    const state = runner.getState();
    for (const inst of state.instances) {
      expect(inst.outcomes.length).toBe(0);
    }
  });
});
