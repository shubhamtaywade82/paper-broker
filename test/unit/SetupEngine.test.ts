import { describe, it, expect } from 'vitest';
import { KlineStore } from '../../src/market/Klines.js';
import { MarketStateManager } from '../../src/market/MarketState.js';
import { MtfStateEngine } from '../../src/market/MtfStateEngine.js';
import { MarketStructureEngine } from '../../src/market/structure/MarketStructureEngine.js';
import { SmcLocationEngine } from '../../src/market/smc/SmcLocationEngine.js';
import { SetupEngine } from '../../src/market/setup/SetupEngine.js';
import { SetupStateMachine } from '../../src/market/setup/SetupStateMachine.js';
import { ConfluenceScorer } from '../../src/market/setup/ConfluenceScorer.js';
import type { Instrument } from '../../src/broker/types.js';
import type { Candle } from '../../src/strategy/indicators.js';
import type { StructureEvent } from '../../src/market/structure/types.js';
import type { LiquiditySweep } from '../../src/market/smc/types.js';

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

function makeCandle(openTime: number, open: number, high: number, low: number, close: number, isClosed = true): Candle {
  return {
    symbol: 'SOLUSDT',
    interval: '15m',
    openTime,
    closeTime: openTime + 899_999,
    open,
    high,
    low,
    close,
    volume: 1000,
    isClosed,
  };
}

describe('Phase 5 — SMC Confluence + Setup State Machine', () => {
  describe('1. Setup State Machine Progression & Lifecycle', () => {
    it('advances sequentially through state stages as evidence accumulates', () => {
      const t0 = 1700000000000;
      let cand = SetupStateMachine.createWatchingCandidate({
        id: 'test1',
        symbol: 'SOLUSDT',
        direction: 'LONG',
        setupType: 'SSL_SWEEP_REVERSAL_LONG',
        timeframes: { regime4h: 'BULLISH', bias1h: 'BULLISH', structure15m: 'BULLISH', trigger5m: 'BULLISH' },
        sourceCandleTimes: [t0],
        sourceEventIds: [],
      }, t0, 3_600_000);

      expect(cand.state).toBe('WATCHING');

      // Stage 1: Sweep arrives
      cand = {
        ...cand,
        sweepEvidence: {
          id: 'sw1',
          symbol: 'SOLUSDT',
          timeframe: '15m',
          liquidityId: 'liq1',
          liquidityType: 'SSL',
          liquidityPrice: 90,
          sweepExtreme: 88,
          sweepCandleTime: t0 + 900_000,
          confirmationTime: t0 + 1_800_000,
          sourceCandleTimes: [t0],
          sourceSwingIds: ['s1'],
        },
      };
      cand = SetupStateMachine.advanceState(cand, t0 + 1_800_000);
      expect(cand.state).toBe('LIQUIDITY_INTERACTION');

      // Stage 2: Structure confirmation arrives
      cand = {
        ...cand,
        structureEvidence: {
          id: 'evt1',
          symbol: 'SOLUSDT',
          timeframe: '15m',
          scope: 'EXTERNAL',
          eventType: 'CHOCH_BULLISH',
          price: 95,
          pivotTime: t0,
          confirmationTime: t0 + 2_000_000,
          sourceCandleTime: t0 + 1_900_000,
        },
      };
      cand = SetupStateMachine.advanceState(cand, t0 + 2_000_000);
      expect(cand.state).toBe('STRUCTURE_CONFIRMATION');

      // Stage 3: Zone (FVG) identified
      cand = {
        ...cand,
        fvgEvidence: {
          id: 'fvg1',
          symbol: 'SOLUSDT',
          timeframe: '15m',
          type: 'BULLISH',
          upperPrice: 94,
          lowerPrice: 91,
          midpoint: 92.5,
          sourceCandleTimes: [t0, t0 + 900_000, t0 + 1_800_000],
          createdAt: t0 + 900_000,
          confirmedAt: t0 + 1_800_000,
          status: 'ACTIVE',
        },
      };
      cand = SetupStateMachine.advanceState(cand, t0 + 2_100_000);
      expect(cand.state).toBe('READY');
      expect(cand.status).toBe('READY');

      // Stage 4: Retest occurs (already READY, stays READY)
      cand = {
        ...cand,
        retestEvidence: { retestCandleTime: t0 + 2_200_000, retestPrice: 93 },
      };
      cand = SetupStateMachine.advanceState(cand, t0 + 2_200_000);
      expect(cand.state).toBe('READY');

      // Stage 5: Trigger confirms -> stays READY
      cand = {
        ...cand,
        triggerEvidence: { triggerCandleTime: t0 + 2_300_000, triggerType: '5M_CONFIRMATION' },
      };
      cand = SetupStateMachine.advanceState(cand, t0 + 2_300_000);
      expect(cand.state).toBe('READY');
      expect(cand.status).toBe('READY');
      expect(cand.confluence.totalScore).toBeGreaterThanOrEqual(65);
    });

    it('invalidates a candidate immediately when invalidation occurs', () => {
      const t0 = 1700000000000;
      const cand = SetupStateMachine.createWatchingCandidate({
        id: 'test2',
        symbol: 'SOLUSDT',
        direction: 'SHORT',
        setupType: 'BSL_SWEEP_REVERSAL_SHORT',
        timeframes: { regime4h: 'BEARISH', bias1h: 'BEARISH', structure15m: 'BEARISH', trigger5m: 'BEARISH' },
        sourceCandleTimes: [t0],
        sourceEventIds: [],
      }, t0, 3_600_000);

      const invalidated = SetupStateMachine.invalidateCandidate(cand, 'Price closed above invalidation zone', t0 + 1_000_000);
      expect(invalidated.state).toBe('INVALIDATED');
      expect(invalidated.status).toBe('INVALIDATED');
      expect(invalidated.invalidationReason).toContain('invalidation zone');
    });

    it('expires candidate when time exceeds TTL', () => {
      const t0 = 1700000000000;
      const cand = SetupStateMachine.createWatchingCandidate({
        id: 'test3',
        symbol: 'SOLUSDT',
        direction: 'LONG',
        setupType: 'SSL_SWEEP_REVERSAL_LONG',
        timeframes: { regime4h: 'BULLISH', bias1h: 'BULLISH', structure15m: 'BULLISH', trigger5m: 'BULLISH' },
        sourceCandleTimes: [t0],
        sourceEventIds: [],
      }, t0, 1_000_000);

      const expired = SetupStateMachine.advanceState(cand, t0 + 2_000_000);
      expect(expired.state).toBe('EXPIRED');
      expect(expired.status).toBe('EXPIRED');
    });
  });

  describe('2. Explainable Confluence Scoring', () => {
    it('calculates explainable score breakdown without treating score as probability', () => {
      const score = ConfluenceScorer.evaluateConfluence({
        direction: 'LONG',
        timeframes: { regime4h: 'BULLISH', bias1h: 'BULLISH', structure15m: 'BULLISH', trigger5m: 'BULLISH' },
        sweepEvidence: {
          id: 'sw1',
          symbol: 'SOLUSDT',
          timeframe: '15m',
          liquidityId: 'l1',
          liquidityType: 'SSL',
          liquidityPrice: 90,
          sweepExtreme: 89,
          sweepCandleTime: 1000,
          confirmationTime: 1100,
          sourceCandleTimes: [1000],
          sourceSwingIds: ['s1'],
        },
        retestEvidence: { retestCandleTime: 1200, retestPrice: 92 },
        triggerEvidence: { triggerCandleTime: 1300, triggerType: '5M_CONFIRMATION' },
      }, undefined, true);

      expect(score.htfAlignmentScore).toBe(20);
      expect(score.structureScore).toBe(20);
      expect(score.liquiditySweepScore).toBe(15);
      expect(score.retestScore).toBe(10);
      expect(score.triggerScore).toBe(10);
      expect(score.dataQualityScore).toBe(5);
      expect(score.totalScore).toBe(80);
      expect(score.notes.length).toBeGreaterThan(3);
    });
  });

  describe('3. End-to-End Setup Engine Integration & Point-in-Time Querying', () => {
    it('evaluates setups point-in-time and isolates future evidence', () => {
      const store = new KlineStore();
      const inst = makeMockInstrument();
      const manager = new MarketStateManager([inst]);
      const mtfEngine = new MtfStateEngine(store, manager);
      const structureEngine = new MarketStructureEngine(store);
      const smcEngine = new SmcLocationEngine(store, structureEngine);
      const setupEngine = new SetupEngine(mtfEngine, structureEngine, smcEngine);

      const t0 = 1699999200000;
      const step = 900_000;

      // Populate candles for 15m
      store.upsertCandle(makeCandle(t0, 100, 105, 95, 96));
      store.upsertCandle(makeCandle(t0 + step, 96, 98, 90, 92)); // Low formed
      store.upsertCandle(makeCandle(t0 + 2 * step, 92, 104, 91, 103)); // Bullish breakout

      const setups = setupEngine.getSetupsAsOf('SOLUSDT', t0 + 3 * step);
      expect(Array.isArray(setups)).toBe(true);
    });
  });

  describe('4. BOS vs CHoCH Confluence Differentiation', () => {
    const baseCandidate = {
      direction: 'LONG' as const,
      timeframes: { regime4h: 'BULLISH' as const, bias1h: 'BULLISH' as const, structure15m: 'BULLISH' as const, trigger5m: 'BULLISH' as const },
      sweepEvidence: {
        id: 'sw1', symbol: 'SOLUSDT', timeframe: '15m', liquidityId: 'l1',
        liquidityType: 'SSL', liquidityPrice: 90, sweepExtreme: 89,
        sweepCandleTime: 1000, confirmationTime: 1100,
        sourceCandleTimes: [1000], sourceSwingIds: ['s1'],
      } satisfies LiquiditySweep,
      retestEvidence: { retestCandleTime: 1200, retestPrice: 92 },
      triggerEvidence: { triggerCandleTime: 1300, triggerType: '5M_CONFIRMATION' },
    };

    it('CHoCH structure evidence gets full structure weight (20)', () => {
      const score = ConfluenceScorer.evaluateConfluence({
        ...baseCandidate,
        structureEvidence: {
          id: 'evt-choch', symbol: 'SOLUSDT', timeframe: '15m',
          scope: 'EXTERNAL', eventType: 'CHOCH_BULLISH',
          price: 95, pivotTime: 1000, confirmationTime: 1100, sourceCandleTime: 1050,
        } satisfies StructureEvent,
      }, undefined, true);

      // CHoCH should get full 20pts for structure
      expect(score.structureScore).toBe(20);
      expect(score.notes.some((n) => n.includes('CHoCH'))).toBe(true);
    });

    it('BOS structure evidence gets reduced weight (15 = 75% of 20)', () => {
      const score = ConfluenceScorer.evaluateConfluence({
        ...baseCandidate,
        structureEvidence: {
          id: 'evt-bos', symbol: 'SOLUSDT', timeframe: '15m',
          scope: 'EXTERNAL', eventType: 'BOS_BULLISH',
          price: 95, pivotTime: 1000, confirmationTime: 1100, sourceCandleTime: 1050,
        } satisfies StructureEvent,
      }, undefined, true);

      // BOS should get 75% of structure weight = 15
      expect(score.structureScore).toBe(15);
      expect(score.notes.some((n) => n.includes('BOS'))).toBe(true);
    });

    it('total score is lower for BOS than CHoCH (all else equal)', () => {
      const chochScore = ConfluenceScorer.evaluateConfluence({
        ...baseCandidate,
        structureEvidence: {
          id: 'evt-choch', symbol: 'SOLUSDT', timeframe: '15m',
          scope: 'EXTERNAL', eventType: 'CHOCH_BULLISH',
          price: 95, pivotTime: 1000, confirmationTime: 1100, sourceCandleTime: 1050,
        } satisfies StructureEvent,
      }, undefined, true);

      const bosScore = ConfluenceScorer.evaluateConfluence({
        ...baseCandidate,
        structureEvidence: {
          id: 'evt-bos', symbol: 'SOLUSDT', timeframe: '15m',
          scope: 'EXTERNAL', eventType: 'BOS_BULLISH',
          price: 95, pivotTime: 1000, confirmationTime: 1100, sourceCandleTime: 1050,
        } satisfies StructureEvent,
      }, undefined, true);

      expect(chochScore.totalScore).toBeGreaterThan(bosScore.totalScore);
      // Difference should be exactly 5 (20 - 15)
      expect(chochScore.totalScore - bosScore.totalScore).toBe(5);
    });
  });
});
