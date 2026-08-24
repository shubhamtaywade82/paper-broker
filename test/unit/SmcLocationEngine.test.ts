import { describe, it, expect } from 'vitest';
import { KlineStore } from '../../src/market/Klines.js';
import { MarketStructureEngine } from '../../src/market/structure/MarketStructureEngine.js';
import { SmcLocationEngine } from '../../src/market/smc/SmcLocationEngine.js';
import { LiquidityDetector } from '../../src/market/smc/LiquidityDetector.js';
import { FvgDetector } from '../../src/market/smc/FvgDetector.js';
import { OrderBlockDetector } from '../../src/market/smc/OrderBlockDetector.js';
import type { Candle } from '../../src/strategy/indicators.js';
import type { ConfirmedSwing, StructureEvent } from '../../src/market/structure/types.js';

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

describe('Phase 4 — Deterministic SMC Location Engine', () => {
  describe('1. Equal Highs & Equal Lows (BSL & SSL)', () => {
    it('detects BSL and SSL from confirmed swings and classifies equal levels within tolerance', () => {
      const t0 = 1700000000000;
      const swings: ConfirmedSwing[] = [
        { id: 's1', symbol: 'SOLUSDT', timeframe: '15m', scope: 'EXTERNAL', type: 'HIGH', classification: 'UNKNOWN', price: 100, pivotTime: t0, confirmationTime: t0 + 10, candleIndex: 0 },
        { id: 's2', symbol: 'SOLUSDT', timeframe: '15m', scope: 'EXTERNAL', type: 'HIGH', classification: 'EQUAL_HIGH', price: 100.04, pivotTime: t0 + 100, confirmationTime: t0 + 110, candleIndex: 5 },
        { id: 's3', symbol: 'SOLUSDT', timeframe: '15m', scope: 'EXTERNAL', type: 'LOW', classification: 'UNKNOWN', price: 80, pivotTime: t0 + 200, confirmationTime: t0 + 210, candleIndex: 10 },
      ];

      const levels = LiquidityDetector.extractLiquidityLevels(swings, { equalLevelTolerancePct: 0.001, obDisplacementThresholdPct: 0.005, obLookbackBars: 5 });
      expect(levels.length).toBe(3);
      expect(levels[0]?.type).toBe('BSL');
      expect(levels[1]?.type).toBe('EQUAL_HIGH');
      expect(levels[2]?.type).toBe('SSL');
    });

    it('does not classify swings as equal levels if outside tolerance', () => {
      const t0 = 1700000000000;
      const swings: ConfirmedSwing[] = [
        { id: 's1', symbol: 'SOLUSDT', timeframe: '15m', scope: 'EXTERNAL', type: 'HIGH', classification: 'UNKNOWN', price: 100, pivotTime: t0, confirmationTime: t0 + 10, candleIndex: 0 },
        { id: 's2', symbol: 'SOLUSDT', timeframe: '15m', scope: 'EXTERNAL', type: 'HIGH', classification: 'HH', price: 105, pivotTime: t0 + 100, confirmationTime: t0 + 110, candleIndex: 5 },
      ];

      const levels = LiquidityDetector.extractLiquidityLevels(swings, { equalLevelTolerancePct: 0.001, obDisplacementThresholdPct: 0.005, obLookbackBars: 5 });
      expect(levels[1]?.type).toBe('BSL');
    });
  });

  describe('2. Liquidity Sweeps', () => {
    it('detects a bullish-side sweep (excursion above BSL with reclaim/close back below)', () => {
      const t0 = 1700000000000;
      const step = 900_000;
      const levels = [
        { id: 'bsl1', symbol: 'SOLUSDT', timeframe: '15m' as const, type: 'BSL' as const, price: 100, sourceSwingIds: ['s1'], sourceCandleTimes: [t0], createdAt: t0, confirmedAt: t0 + step, status: 'ACTIVE' as const },
      ];

      // Candle 1: Trades above 100 (high=103) but closes back at 99 -> SWEEP
      const candles = [
        makeCandle(t0 + 2 * step, 98, 103, 97, 99),
      ];

      const { sweeps, updatedLevels } = LiquidityDetector.detectSweeps(candles, levels);
      expect(sweeps.length).toBe(1);
      expect(sweeps[0]?.liquidityPrice).toBe(100);
      expect(sweeps[0]?.sweepExtreme).toBe(103);
      expect(updatedLevels[0]?.status).toBe('SWEPT');
    });

    it('does not treat breakout without reclaim as a sweep', () => {
      const t0 = 1700000000000;
      const step = 900_000;
      const levels = [
        { id: 'bsl1', symbol: 'SOLUSDT', timeframe: '15m' as const, type: 'BSL' as const, price: 100, sourceSwingIds: ['s1'], sourceCandleTimes: [t0], createdAt: t0, confirmedAt: t0 + step, status: 'ACTIVE' as const },
      ];

      // Candle closes ABOVE 100 (close=104) -> Breakout, not a sweep
      const candles = [
        makeCandle(t0 + 2 * step, 98, 105, 97, 104),
      ];

      const { sweeps } = LiquidityDetector.detectSweeps(candles, levels);
      expect(sweeps.length).toBe(0);
    });
  });

  describe('3. Fair Value Gaps (FVG)', () => {
    it('detects Bullish FVG (C0.high < C2.low) and tracks partial/full mitigation', () => {
      const t0 = 1700000000000;
      const step = 900_000;
      // C0: [100, 102, 98, 101] -> high=102
      // C1: [101, 110, 100, 109] -> strong impulse
      // C2: [109, 115, 106, 114] -> low=106
      // FVG: lower=102, upper=106, mid=104
      // C3: retests to 103 (partial fill)
      // C4: retests to 101 (mitigated)
      const candles = [
        makeCandle(t0, 100, 102, 98, 101),
        makeCandle(t0 + step, 101, 110, 100, 109),
        makeCandle(t0 + 2 * step, 109, 115, 106, 114),
        makeCandle(t0 + 3 * step, 114, 114, 103, 107),
        makeCandle(t0 + 4 * step, 107, 108, 101, 105),
      ];

      const fvgs = FvgDetector.detectFvgs(candles, 'SOLUSDT', '15m');
      expect(fvgs.length).toBe(1);
      expect(fvgs[0]?.type).toBe('BULLISH');
      expect(fvgs[0]?.lowerPrice).toBe(102);
      expect(fvgs[0]?.upperPrice).toBe(106);
      expect(fvgs[0]?.status).toBe('MITIGATED');
    });

    it('detects Bearish FVG (C0.low > C2.high)', () => {
      const t0 = 1700000000000;
      const step = 900_000;
      // C0: [110, 112, 108, 109] -> low=108
      // C1: [109, 109, 98, 99]
      // C2: [99, 104, 95, 96] -> high=104
      // FVG: lower=104, upper=108
      const candles = [
        makeCandle(t0, 110, 112, 108, 109),
        makeCandle(t0 + step, 109, 109, 98, 99),
        makeCandle(t0 + 2 * step, 99, 104, 95, 96),
      ];

      const fvgs = FvgDetector.detectFvgs(candles, 'SOLUSDT', '15m');
      expect(fvgs.length).toBe(1);
      expect(fvgs[0]?.type).toBe('BEARISH');
      expect(fvgs[0]?.lowerPrice).toBe(104);
      expect(fvgs[0]?.upperPrice).toBe(108);
      expect(fvgs[0]?.status).toBe('ACTIVE');
    });
  });

  describe('4. Order Blocks (OB)', () => {
    it('detects Bullish OB associated with displacement and confirmed structure break', () => {
      const t0 = 1700000000000;
      const step = 900_000;
      // Origin: Bearish candle (100 -> 98)
      // Break: Bullish impulse (98 -> 106) breaking previous swing high
      const candles = [
        makeCandle(t0, 100, 101, 97, 98), // Origin candle
        makeCandle(t0 + step, 98, 107, 98, 106), // Displacement break
        makeCandle(t0 + 2 * step, 106, 108, 100, 104), // Retest into origin zone (97..101) -> MITIGATED
      ];

      const events: StructureEvent[] = [
        {
          id: 'evt1',
          symbol: 'SOLUSDT',
          timeframe: '15m',
          scope: 'EXTERNAL',
          eventType: 'BOS_BULLISH',
          price: 106,
          pivotTime: t0,
          confirmationTime: t0 + step + step - 1,
          sourceCandleTime: t0 + step,
        },
      ];

      const obs = OrderBlockDetector.detectOrderBlocks(candles, events, {
        equalLevelTolerancePct: 0.001,
        obDisplacementThresholdPct: 0.01,
        obLookbackBars: 5,
      });

      expect(obs.length).toBe(1);
      expect(obs[0]?.type).toBe('BULLISH');
      expect(obs[0]?.upperPrice).toBe(101);
      expect(obs[0]?.lowerPrice).toBe(97);
      expect(obs[0]?.status).toBe('MITIGATED');
    });

    it('invalidates Bullish OB if a candle closes below the invalidation boundary', () => {
      const t0 = 1700000000000;
      const step = 900_000;
      const candles = [
        makeCandle(t0, 100, 101, 97, 98), // Origin (low=97)
        makeCandle(t0 + step, 98, 107, 98, 106), // Break
        makeCandle(t0 + 2 * step, 106, 106, 92, 94), // Closes below 97 -> INVALIDATED
      ];

      const events: StructureEvent[] = [
        {
          id: 'evt1',
          symbol: 'SOLUSDT',
          timeframe: '15m',
          scope: 'EXTERNAL',
          eventType: 'BOS_BULLISH',
          price: 106,
          pivotTime: t0,
          confirmationTime: t0 + step + step - 1,
          sourceCandleTime: t0 + step,
        },
      ];

      const obs = OrderBlockDetector.detectOrderBlocks(candles, events);
      expect(obs[0]?.status).toBe('INVALIDATED');
    });
  });

  describe('5. Causality, Provenance & Engine Integration', () => {
    it('proves zero lookahead: FVG and OB are invisible prior to their confirmation timestamp', () => {
      const store = new KlineStore();
      const structureEngine = new MarketStructureEngine(store);
      const smcEngine = new SmcLocationEngine(store, structureEngine);
      const t0 = 1699999200000;
      const step = 900_000;

      // C0, C1, C2 form a bullish FVG confirmed on C2 close (t0 + 3*step)
      store.upsertCandle(makeCandle(t0, 100, 102, 98, 101));
      store.upsertCandle(makeCandle(t0 + step, 101, 110, 100, 109));
      store.upsertCandle(makeCandle(t0 + 2 * step, 109, 115, 106, 114));

      // Query before C2 close (during C2 at t0 + 2*step + 100s): FVG must NOT be present
      const earlyContext = smcEngine.getSmcContextAsOf('SOLUSDT', '15m', t0 + 2 * step + 100_000);
      expect(earlyContext.fairValueGaps.length).toBe(0);

      // Query after C2 close: FVG IS present and provenance references all 3 candles
      const confirmedContext = smcEngine.getSmcContextAsOf('SOLUSDT', '15m', t0 + 3 * step);
      expect(confirmedContext.fairValueGaps.length).toBe(1);
      expect(confirmedContext.fairValueGaps[0]?.sourceCandleTimes.length).toBe(3);
    });

    it('computes multi-timeframe SMC location context across 4H, 1H, 15m, 5m', () => {
      const store = new KlineStore();
      const structureEngine = new MarketStructureEngine(store);
      const smcEngine = new SmcLocationEngine(store, structureEngine);
      const asOf = 1700208000000;

      const mtfSmc = smcEngine.computeMultiTimeframeSmcContext('SOLUSDT', asOf);
      expect(mtfSmc.symbol).toBe('SOLUSDT');
      expect(mtfSmc.timeframes['4h']).toBeDefined();
      expect(mtfSmc.timeframes['1h']).toBeDefined();
      expect(mtfSmc.timeframes['15m']).toBeDefined();
      expect(mtfSmc.timeframes['5m']).toBeDefined();
    });

    it('bounds cache growth instead of accumulating one entry per call forever (C-05)', () => {
      const store = new KlineStore();
      const structureEngine = new MarketStructureEngine(store);
      const smcEngine = new SmcLocationEngine(store, structureEngine);
      const t0 = 1700000000000;
      store.upsertCandle(makeCandle(t0, 100, 102, 98, 101));
      store.upsertCandle(makeCandle(t0 + 900_000, 101, 105, 100, 104));

      // Simulate live trading: computeState called on every "tick" with a
      // fresh Date.now()-like timestamp, well past SMC_CACHE_MAX_ENTRIES calls.
      const calls = 2500;
      for (let i = 0; i < calls; i++) {
        smcEngine.getSmcContextAsOf('SOLUSDT', '15m', t0 + 2_000_000 + i);
      }

      expect(smcEngine.cacheSize).toBeLessThanOrEqual(2000);
      expect(smcEngine.cacheSize).toBeGreaterThan(0);
    });
  });
});
