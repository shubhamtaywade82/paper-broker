import { describe, it, expect } from 'vitest';
import { SignalEngine } from '../../src/trading/signal/SignalEngine.js';
import type { ExecutionPlan } from '../../src/market/execution/types.js';

function makeMockExecutionPlan(status: ExecutionPlan['status'] = 'EXECUTABLE'): ExecutionPlan {
  return {
    id: 'PLAN:SOLUSDT:1',
    symbol: 'SOLUSDT',
    setupCandidateId: 'CAND:1',
    direction: 'LONG',
    status,
    entryPrice: 75.70,
    entryZone: { upper: 76.0, lower: 75.40 },
    stopLossPrice: 75.45,
    stopLossReason: 'SSL extreme minus buffer',
    takeProfitLevels: [
      { level: 1, price: 76.10, riskReward: 1.6, rewardDistance: 0.40, reason: '15m BSL' },
      { level: 2, price: 76.40, riskReward: 2.8, rewardDistance: 0.70, reason: '15m swing high' },
      { level: 3, price: 76.80, riskReward: 4.4, rewardDistance: 1.10, reason: '1h BSL' },
    ],
    riskReward: { tp1: 1.6, tp2: 2.8, tp3: 4.4 },
    riskDistance: 0.25,
    rewardDistance: 0.40,
    invalidation: { price: 75.45, reason: 'OB invalidation', invalidationType: 'ZONE_INVALIDATION' },
    createdAt: 1700000000000,
    expiresAt: 1700010000000,
    validationFailures: status === 'AVOID' ? ['TP1 R:R insufficient'] : [],
    provenance: {
      setupType: 'SSL_SWEEP_REVERSAL_LONG',
      confluenceScore: 88,
      sourceEventIds: ['evt1', 'sw1'],
      sourceCandleTimes: [1700000000000],
      reasoning: { entry: 'FVG equilibrium', stop: 'SSL extreme', targets: 'BSL pools' },
    },
  };
}

describe('Phase 7 — Signal Engine', () => {
  it('translates EXECUTABLE ExecutionPlan into VALIDATED TradeSignal with TP allocations', () => {
    const plan = makeMockExecutionPlan('EXECUTABLE');
    const signal = SignalEngine.translatePlan(plan, 1700000000000);

    expect(signal.id).toBe('SIG:PLAN:SOLUSDT:1');
    expect(signal.status).toBe('VALIDATED');
    expect(signal.symbol).toBe('SOLUSDT');
    expect(signal.direction).toBe('LONG');
    expect(signal.takeProfits.length).toBe(3);
    expect(signal.takeProfits[0]?.allocationPct).toBe(0.33);
    expect(signal.takeProfits[1]?.allocationPct).toBe(0.33);
    expect(signal.takeProfits[2]?.allocationPct).toBe(0.34);
    expect(signal.provenance.confluenceScore).toBe(88);
  });

  it('translates AVOID ExecutionPlan into AVOID TradeSignal with rejection reasons', () => {
    const plan = makeMockExecutionPlan('AVOID');
    const signal = SignalEngine.translatePlan(plan, 1700000000000);

    expect(signal.status).toBe('AVOID');
    expect(signal.riskRejectionReasons).toContain('TP1 R:R insufficient');
  });
});
