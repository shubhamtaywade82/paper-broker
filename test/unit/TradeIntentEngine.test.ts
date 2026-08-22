import { describe, it, expect } from 'vitest';
import { TradeIntentEngine } from '../../src/trading/TradeIntentEngine.js';
import type { ExecutionPlan } from '../../src/market/execution/types.js';
import type { Instrument } from '../../src/broker/types.js';
import type { AccountState } from '../../src/trading/risk/types.js';

function makeMockInstrument(): Instrument {
  return {
    symbol: 'SOLUSDT',
    baseAsset: 'SOL',
    quoteAsset: 'USDT',
    contractType: 'PERPETUAL',
    status: 'TRADING',
    tickSize: '0.01',
    stepSize: '0.001',
    minQty: '0.001',
    maxQty: '10000',
    minNotional: '5.0',
    pricePrecision: 2,
    quantityPrecision: 3,
    maintenanceMarginRate: '0.005',
    createdAtUtc: new Date().toISOString(),
    updatedAtUtc: new Date().toISOString(),
  };
}

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
    validationFailures: status === 'AVOID' ? ['R:R too low'] : [],
    provenance: {
      setupType: 'SSL_SWEEP_REVERSAL_LONG',
      confluenceScore: 88,
      sourceEventIds: ['evt1'],
      sourceCandleTimes: [1700000000000],
      reasoning: { entry: 'FVG', stop: 'SSL', targets: 'BSL' },
    },
  };
}

describe('Phase 7 — Trade Intent Engine', () => {
  it('transitions EXECUTABLE ExecutionPlan to PAPER_READY with full risk sizing', () => {
    const engine = new TradeIntentEngine();
    const plan = makeMockExecutionPlan('EXECUTABLE');
    const account: AccountState = { equity: 10000, availableBalance: 5000, dailyLoss: 0, realizedPnl: 0 };
    const inst = makeMockInstrument();

    const signal = engine.processExecutionPlan(plan, account, [], inst, 1700000000000);
    expect(signal.status).toBe('PAPER_READY');
    expect(signal.sizing?.quantity).toBe(400.0);
    expect(signal.sizing?.riskCapital).toBe(100);
    expect(signal.riskRejectionReasons.length).toBe(0);
  });

  it('prevents duplicate signals from generating multiple entries', () => {
    const engine = new TradeIntentEngine();
    const plan = makeMockExecutionPlan('EXECUTABLE');
    const account: AccountState = { equity: 10000, availableBalance: 5000, dailyLoss: 0, realizedPnl: 0 };
    const inst = makeMockInstrument();

    const sig1 = engine.processExecutionPlan(plan, account, [], inst, 1700000000000);
    expect(sig1.status).toBe('PAPER_READY');

    // Duplicate call with exact same plan key
    const sig2 = engine.processExecutionPlan(plan, account, [], inst, 1700000000000 + 300_000);
    expect(sig2.status).toBe('AVOID');
    expect(sig2.riskRejectionReasons).toContain('DUPLICATE_SIGNAL');
  });

  it('returns RISK_REJECTED when account margin is insufficient', () => {
    const engine = new TradeIntentEngine();
    const plan = makeMockExecutionPlan('EXECUTABLE');
    // Available balance is only $50, required margin is $6,056 ($30,280 / 5x)
    const account: AccountState = { equity: 10000, availableBalance: 50, dailyLoss: 0, realizedPnl: 0 };
    const inst = makeMockInstrument();

    const signal = engine.processExecutionPlan(plan, account, [], inst, 1700000000000);
    expect(signal.status).toBe('RISK_REJECTED');
    expect(signal.riskRejectionReasons).toContain('INSUFFICIENT_MARGIN');
  });
});
