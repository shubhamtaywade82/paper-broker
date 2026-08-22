import { describe, it, expect } from 'vitest';
import { ExecutionPlanEngine } from '../../src/market/execution/ExecutionPlanEngine.js';
import { EntryCalculator } from '../../src/market/execution/EntryCalculator.js';
import { StopLossCalculator } from '../../src/market/execution/StopLossCalculator.js';
import { TakeProfitCalculator } from '../../src/market/execution/TakeProfitCalculator.js';
import { RiskRewardCalculator } from '../../src/market/execution/RiskRewardCalculator.js';
import { ExecutionValidator } from '../../src/market/execution/ExecutionValidator.js';
import type { SetupCandidate } from '../../src/market/setup/types.js';
import type { MultiTimeframeStructureState } from '../../src/market/structure/types.js';
import type { MultiTimeframeSmcContext } from '../../src/market/smc/types.js';
import type { Instrument } from '../../src/broker/types.js';

function makeMockInstrument(symbol = 'SOLUSDT'): Instrument {
  return {
    symbol,
    baseAsset: 'SOL',
    quoteAsset: 'USDT',
    contractType: 'PERPETUAL',
    status: 'TRADING',
    tickSize: '0.01',
    stepSize: '0.001',
    minQty: '0.001',
    minNotional: '5',
    pricePrecision: 2,
    quantityPrecision: 3,
    maintenanceMarginRate: '0.005',
    createdAtUtc: new Date().toISOString(),
    updatedAtUtc: new Date().toISOString(),
  };
}

function makeReadyLongCandidate(t0 = 1700000000000): SetupCandidate {
  return {
    id: `SOLUSDT:LONG:${t0}`,
    symbol: 'SOLUSDT',
    direction: 'LONG',
    setupType: 'SSL_SWEEP_REVERSAL_LONG',
    state: 'READY',
    status: 'READY',
    createdAt: t0,
    updatedAt: t0 + 1_000_000,
    expiresAt: t0 + 10_000_000,
    timeframes: { regime4h: 'BULLISH', bias1h: 'BULLISH', structure15m: 'BULLISH', trigger5m: 'BULLISH' },
    sweepEvidence: {
      id: 'sw1',
      symbol: 'SOLUSDT',
      timeframe: '15m',
      liquidityId: 'l1',
      liquidityType: 'SSL',
      liquidityPrice: 90.0,
      sweepExtreme: 88.0,
      sweepCandleTime: t0,
      confirmationTime: t0 + 900_000,
      sourceCandleTimes: [t0],
      sourceSwingIds: ['s1'],
    },
    structureEvidence: {
      id: 'evt1',
      symbol: 'SOLUSDT',
      timeframe: '15m',
      scope: 'EXTERNAL',
      eventType: 'CHOCH_BULLISH',
      price: 95.0,
      pivotTime: t0,
      confirmationTime: t0 + 1_800_000,
      sourceCandleTime: t0 + 1_800_000,
    },
    fvgEvidence: {
      id: 'fvg1',
      symbol: 'SOLUSDT',
      timeframe: '15m',
      type: 'BULLISH',
      upperPrice: 94.0,
      lowerPrice: 92.0,
      midpoint: 93.0,
      sourceCandleTimes: [t0, t0 + 900_000, t0 + 1_800_000],
      createdAt: t0 + 900_000,
      confirmedAt: t0 + 1_800_000,
      status: 'ACTIVE',
    },
    retestEvidence: { retestCandleTime: t0 + 2_000_000, retestPrice: 93.0 },
    triggerEvidence: { triggerCandleTime: t0 + 2_100_000, triggerType: '5M_CONFIRMATION' },
    confluence: {
      htfAlignmentScore: 20,
      structureScore: 20,
      liquiditySweepScore: 15,
      fvgScore: 10,
      orderBlockScore: 0,
      retestScore: 10,
      triggerScore: 10,
      dataQualityScore: 5,
      totalScore: 90,
      maxScore: 100,
      notes: [],
    },
    sourceCandleTimes: [t0],
    sourceEventIds: ['evt1', 'sw1', 'fvg1'],
  };
}

function makeMockStructure(): MultiTimeframeStructureState {
  return {
    symbol: 'SOLUSDT',
    asOfTimestamp: 1700000000000,
    timeframes: {
      '4h': { timeframe: '4h', scope: 'EXTERNAL', trend: 'BULLISH', structure: 'HH_HL', swings: [], events: [] },
      '1h': { timeframe: '1h', scope: 'EXTERNAL', trend: 'BULLISH', structure: 'HH_HL', swings: [], events: [] },
      '15m': {
        timeframe: '15m',
        scope: 'EXTERNAL',
        trend: 'BULLISH',
        structure: 'HH_HL',
        swings: [],
        events: [],
        lastConfirmedSwingLow: { id: 'sl1', symbol: 'SOLUSDT', timeframe: '15m', scope: 'EXTERNAL', type: 'LOW', classification: 'HL', price: 88.5, pivotTime: 100, confirmationTime: 200, candleIndex: 1 },
        lastConfirmedSwingHigh: { id: 'sh1', symbol: 'SOLUSDT', timeframe: '15m', scope: 'EXTERNAL', type: 'HIGH', classification: 'HH', price: 106.0, pivotTime: 300, confirmationTime: 400, candleIndex: 2 },
      },
      '5m': { timeframe: '5m', scope: 'EXTERNAL', trend: 'BULLISH', structure: 'HH_HL', swings: [], events: [] },
    },
  };
}

function makeMockSmc(): MultiTimeframeSmcContext {
  return {
    symbol: 'SOLUSDT',
    asOfTimestamp: 1700000000000,
    timeframes: {
      '4h': { timeframe: '4h', liquidityLevels: [{ id: 'b4h', symbol: 'SOLUSDT', timeframe: '4h', type: 'BSL', price: 120.0, sourceSwingIds: [], sourceCandleTimes: [], createdAt: 0, confirmedAt: 0, status: 'ACTIVE' }], sweeps: [], fairValueGaps: [], orderBlocks: [], activeLiquidity: [], activeFvgs: [], activeOrderBlocks: [] },
      '1h': { timeframe: '1h', liquidityLevels: [{ id: 'b1h', symbol: 'SOLUSDT', timeframe: '1h', type: 'BSL', price: 110.0, sourceSwingIds: [], sourceCandleTimes: [], createdAt: 0, confirmedAt: 0, status: 'ACTIVE' }], sweeps: [], fairValueGaps: [], orderBlocks: [], activeLiquidity: [], activeFvgs: [], activeOrderBlocks: [] },
      '15m': { timeframe: '15m', liquidityLevels: [{ id: 'b15m', symbol: 'SOLUSDT', timeframe: '15m', type: 'BSL', price: 102.0, sourceSwingIds: [], sourceCandleTimes: [], createdAt: 0, confirmedAt: 0, status: 'ACTIVE' }], sweeps: [], fairValueGaps: [], orderBlocks: [], activeLiquidity: [], activeFvgs: [], activeOrderBlocks: [] },
      '5m': { timeframe: '5m', liquidityLevels: [], sweeps: [], fairValueGaps: [], orderBlocks: [], activeLiquidity: [], activeFvgs: [], activeOrderBlocks: [] },
    },
  };
}

describe('Phase 6 — Execution Plan Engine', () => {
  it('derives equilibrium entry from FVG zone', () => {
    const cand = makeReadyLongCandidate();
    const inst = makeMockInstrument();
    const entry = EntryCalculator.calculateEntry(cand, inst);

    expect(entry?.entryPrice).toBe(93.0);
    expect(entry?.entryZone.upper).toBe(94.0);
    expect(entry?.entryZone.lower).toBe(92.0);
  });

  it('calculates structural stop loss from sweep extreme minus tick buffer', () => {
    const cand = makeReadyLongCandidate();
    const struct = makeMockStructure();
    const inst = makeMockInstrument();
    const sl = StopLossCalculator.calculateStopLoss(cand, struct, inst, 2);

    // sweepExtreme is 88.0, tickSize is 0.01, 2 ticks buffer = 0.02 -> 87.98
    expect(sl?.stopLossPrice).toBe(87.98);
    expect(sl?.stopLossReason).toContain('SSL sweep extreme (88)');
  });

  it('discovers structural take profit targets from opposing BSL pools', () => {
    const cand = makeReadyLongCandidate();
    const struct = makeMockStructure();
    const smc = makeMockSmc();
    const inst = makeMockInstrument();
    const tps = TakeProfitCalculator.calculateTakeProfits(cand, 93.0, 5.02, struct, smc, inst);

    expect(tps.length).toBe(3);
    expect(tps[0]?.price).toBe(102.0); // 15m BSL
    expect(tps[1]?.price).toBe(106.0); // 15m swing high
    expect(tps[2]?.price).toBe(110.0); // 1h BSL
  });

  it('generates an EXECUTABLE execution plan when all hard gates pass', () => {
    const engine = new ExecutionPlanEngine();
    const cand = makeReadyLongCandidate();
    const struct = makeMockStructure();
    const smc = makeMockSmc();
    const inst = makeMockInstrument();

    const plan = engine.generateExecutionPlan(cand, struct, smc, inst, 1700000000000, true);
    expect(plan.status).toBe('EXECUTABLE');
    expect(plan.entryPrice).toBe(93.0);
    expect(plan.stopLossPrice).toBe(87.98);
    expect(plan.riskReward.tp1).toBeGreaterThanOrEqual(1.5);
    expect(plan.validationFailures.length).toBe(0);
    expect(plan.provenance.confluenceScore).toBe(90);
  });

  it('enforces hard gate: rejects candidate with status AVOID if candidate is not in READY state', () => {
    const engine = new ExecutionPlanEngine();
    const cand = { ...makeReadyLongCandidate(), state: 'WATCHING' as const, status: 'ACTIVE' as const };
    const struct = makeMockStructure();
    const smc = makeMockSmc();
    const inst = makeMockInstrument();

    const plan = engine.generateExecutionPlan(cand, struct, smc, inst, 1700000000000, true);
    expect(plan.status).toBe('AVOID');
    expect(plan.validationFailures).toContain('Setup candidate is not in READY state (current: ACTIVE)');
  });

  it('enforces hard gate: rejects candidate if market data is degraded', () => {
    const engine = new ExecutionPlanEngine();
    const cand = makeReadyLongCandidate();
    const struct = makeMockStructure();
    const smc = makeMockSmc();
    const inst = makeMockInstrument();

    const plan = engine.generateExecutionPlan(cand, struct, smc, inst, 1700000000000, false);
    expect(plan.status).toBe('AVOID');
    expect(plan.validationFailures).toContain('Market data is desynchronized, stale, or degraded');
  });

  it('enforces hard gate: rejects candidate if risk/reward is insufficient', () => {
    const engine = new ExecutionPlanEngine();
    const cand = makeReadyLongCandidate();
    const struct = makeMockStructure();
    // Smc with very low TP1 target (94.0 -> reward 1.0 vs risk 5.02 = 0.2R)
    const smc: MultiTimeframeSmcContext = {
      symbol: 'SOLUSDT',
      asOfTimestamp: 1700000000000,
      timeframes: {
        '4h': { timeframe: '4h', liquidityLevels: [], sweeps: [], fairValueGaps: [], orderBlocks: [], activeLiquidity: [], activeFvgs: [], activeOrderBlocks: [] },
        '1h': { timeframe: '1h', liquidityLevels: [], sweeps: [], fairValueGaps: [], orderBlocks: [], activeLiquidity: [], activeFvgs: [], activeOrderBlocks: [] },
        '15m': { timeframe: '15m', liquidityLevels: [{ id: 'b1', symbol: 'SOLUSDT', timeframe: '15m', type: 'BSL', price: 94.0, sourceSwingIds: [], sourceCandleTimes: [], createdAt: 0, confirmedAt: 0, status: 'ACTIVE' }], sweeps: [], fairValueGaps: [], orderBlocks: [], activeLiquidity: [], activeFvgs: [], activeOrderBlocks: [] },
        '5m': { timeframe: '5m', liquidityLevels: [], sweeps: [], fairValueGaps: [], orderBlocks: [], activeLiquidity: [], activeFvgs: [], activeOrderBlocks: [] },
      },
    };
    const inst = makeMockInstrument();

    const plan = engine.generateExecutionPlan(cand, struct, smc, inst, 1700000000000, true);
    expect(plan.status).toBe('AVOID');
    expect(plan.validationFailures.some((f) => f.includes('TP1 R:R'))).toBe(true);
  });
});
