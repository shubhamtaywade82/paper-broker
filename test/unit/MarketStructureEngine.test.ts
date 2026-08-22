import { describe, it, expect } from 'vitest';
import { KlineStore } from '../../src/market/Klines.js';
import { MarketStructureEngine } from '../../src/market/structure/MarketStructureEngine.js';
import { SwingDetector } from '../../src/market/structure/SwingDetector.js';
import { StructureClassifier } from '../../src/market/structure/StructureClassifier.js';
import type { Candle } from '../../src/strategy/indicators.js';

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

describe('Phase 3 — Deterministic Market Structure Engine', () => {
  describe('1. Swing Detection & Confirmation', () => {
    it('detects basic swing high and low with configurable pivot length', () => {
      const t0 = 1700000000000;
      const step = 900_000;
      // 7 candles with peak at index 3 (high=110) and trough at index 5 (low=90)
      const candles: Candle[] = [
        makeCandle(t0, 100, 102, 98, 101),
        makeCandle(t0 + step, 101, 105, 100, 104),
        makeCandle(t0 + 2 * step, 104, 107, 103, 106),
        makeCandle(t0 + 3 * step, 106, 110, 105, 108), // Pivot High
        makeCandle(t0 + 4 * step, 108, 106, 95, 96),
        makeCandle(t0 + 5 * step, 96, 98, 90, 92),     // Pivot Low
        makeCandle(t0 + 6 * step, 92, 97, 91, 95),
        makeCandle(t0 + 7 * step, 95, 99, 94, 98),
        makeCandle(t0 + 8 * step, 98, 102, 97, 101),
      ];

      const swings = SwingDetector.detectSwings(candles, 'SOLUSDT', '15m', { swingLeftBars: 2, swingRightBars: 2 });
      expect(swings.length).toBe(2);

      const sh = swings.find((s) => s.type === 'HIGH')!;
      expect(sh.price).toBe(110);
      expect(sh.pivotTime).toBe(t0 + 3 * step);
      // Confirmed on close of index 5 (3 + 2 right bars)
      expect(sh.confirmationTime).toBe(candles[5]!.closeTime);

      const sl = swings.find((s) => s.type === 'LOW')!;
      expect(sl.price).toBe(90);
      expect(sl.pivotTime).toBe(t0 + 5 * step);
      // Confirmed on close of index 7 (5 + 2 right bars)
      expect(sl.confirmationTime).toBe(candles[7]!.closeTime);
    });

    it('does not confirm a swing if right-side bars are insufficient', () => {
      const t0 = 1700000000000;
      const step = 900_000;
      // 4 candles with highest at index 3, but rightBars=2 requires 2 bars to the right (only 0 exist)
      const candles: Candle[] = [
        makeCandle(t0, 100, 102, 98, 101),
        makeCandle(t0 + step, 101, 105, 100, 104),
        makeCandle(t0 + 2 * step, 104, 107, 103, 106),
        makeCandle(t0 + 3 * step, 106, 115, 105, 114), // Candidate peak
      ];

      const swings = SwingDetector.detectSwings(candles, 'SOLUSDT', '15m', { swingLeftBars: 2, swingRightBars: 2 });
      expect(swings.length).toBe(0);
    });

    it('classifies equal highs and equal lows within tolerance', () => {
      const t0 = 1700000000000;
      const step = 900_000;
      const candles: Candle[] = [
        makeCandle(t0, 100, 105, 98, 102),
        makeCandle(t0 + step, 102, 110, 101, 108), // SH1 = 110
        makeCandle(t0 + 2 * step, 108, 104, 98, 100),
        makeCandle(t0 + 3 * step, 100, 103, 95, 96),
        makeCandle(t0 + 4 * step, 96, 107, 95, 105),
        makeCandle(t0 + 5 * step, 105, 110.01, 104, 108), // SH2 = 110.01 (within 0.05% tol)
        makeCandle(t0 + 6 * step, 108, 105, 100, 102),
        makeCandle(t0 + 7 * step, 102, 104, 99, 101),
      ];

      const swings = SwingDetector.detectSwings(candles, 'SOLUSDT', '15m', { swingLeftBars: 1, swingRightBars: 1, equalTolerancePct: 0.001 });
      const highs = swings.filter((s) => s.type === 'HIGH');
      expect(highs.length).toBe(2);
      expect(highs[1]!.classification).toBe('EQUAL_HIGH');
    });
  });

  describe('2. Trend & Structure Classification', () => {
    it('classifies sequential HH and HL as BULLISH (HH_HL)', () => {
      const t0 = 1700000000000;
      const swings = [
        { id: '1', symbol: 'SOLUSDT', timeframe: '15m' as const, scope: 'EXTERNAL' as const, type: 'HIGH' as const, classification: 'UNKNOWN' as const, price: 100, pivotTime: t0, confirmationTime: t0 + 10, candleIndex: 1 },
        { id: '2', symbol: 'SOLUSDT', timeframe: '15m' as const, scope: 'EXTERNAL' as const, type: 'LOW' as const, classification: 'UNKNOWN' as const, price: 90, pivotTime: t0 + 20, confirmationTime: t0 + 30, candleIndex: 2 },
        { id: '3', symbol: 'SOLUSDT', timeframe: '15m' as const, scope: 'EXTERNAL' as const, type: 'HIGH' as const, classification: 'HH' as const, price: 110, pivotTime: t0 + 40, confirmationTime: t0 + 50, candleIndex: 3 },
        { id: '4', symbol: 'SOLUSDT', timeframe: '15m' as const, scope: 'EXTERNAL' as const, type: 'LOW' as const, classification: 'HL' as const, price: 95, pivotTime: t0 + 60, confirmationTime: t0 + 70, candleIndex: 4 },
      ];

      const res = StructureClassifier.evaluateTrendAndStructure(swings);
      expect(res.trend).toBe('BULLISH');
      expect(res.structure).toBe('HH_HL');
    });

    it('classifies sequential LH and LL as BEARISH (LH_LL)', () => {
      const t0 = 1700000000000;
      const swings = [
        { id: '1', symbol: 'SOLUSDT', timeframe: '15m' as const, scope: 'EXTERNAL' as const, type: 'HIGH' as const, classification: 'UNKNOWN' as const, price: 110, pivotTime: t0, confirmationTime: t0 + 10, candleIndex: 1 },
        { id: '2', symbol: 'SOLUSDT', timeframe: '15m' as const, scope: 'EXTERNAL' as const, type: 'LOW' as const, classification: 'UNKNOWN' as const, price: 95, pivotTime: t0 + 20, confirmationTime: t0 + 30, candleIndex: 2 },
        { id: '3', symbol: 'SOLUSDT', timeframe: '15m' as const, scope: 'EXTERNAL' as const, type: 'HIGH' as const, classification: 'LH' as const, price: 105, pivotTime: t0 + 40, confirmationTime: t0 + 50, candleIndex: 3 },
        { id: '4', symbol: 'SOLUSDT', timeframe: '15m' as const, scope: 'EXTERNAL' as const, type: 'LOW' as const, classification: 'LL' as const, price: 85, pivotTime: t0 + 60, confirmationTime: t0 + 70, candleIndex: 4 },
      ];

      const res = StructureClassifier.evaluateTrendAndStructure(swings);
      expect(res.trend).toBe('BEARISH');
      expect(res.structure).toBe('LH_LL');
    });
  });

  describe('3. BOS vs CHoCH Detection', () => {
    it('detects close-confirmed bullish BOS and ignores wick-only crosses', () => {
      const t0 = 1700000000000;
      const step = 900_000;
      const swings = [
        { id: 'sh1', symbol: 'SOLUSDT', timeframe: '15m' as const, scope: 'EXTERNAL' as const, type: 'HIGH' as const, classification: 'HH' as const, price: 100, pivotTime: t0, confirmationTime: t0 + 2 * step, candleIndex: 1 },
      ];

      // Candle 1: Wick breaches 100 (high=102) but close=98 -> NO BOS
      // Candle 2: Close breaches 100 (close=103) -> BULLISH BOS
      const candles: Candle[] = [
        makeCandle(t0 + 3 * step, 95, 102, 94, 98),  // Wick only
        makeCandle(t0 + 4 * step, 98, 104, 97, 103), // Close break
      ];

      const breaks = StructureClassifier.detectBreaks(candles, swings);
      expect(breaks.length).toBe(1);
      expect(breaks[0]?.eventType).toBe('BOS_BULLISH');
      expect(breaks[0]?.brokenSwingPrice).toBe(100);
      expect(breaks[0]?.price).toBe(103);
    });

    it('detects CHoCH on reversal against established trend', () => {
      const t0 = 1700000000000;
      const step = 900_000;
      // Established bearish trend: LH at 100
      const swings = [
        { id: 'sh0', symbol: 'SOLUSDT', timeframe: '15m' as const, scope: 'EXTERNAL' as const, type: 'HIGH' as const, classification: 'UNKNOWN' as const, price: 110, pivotTime: t0, confirmationTime: t0 + step, candleIndex: 0 },
        { id: 'sl0', symbol: 'SOLUSDT', timeframe: '15m' as const, scope: 'EXTERNAL' as const, type: 'LOW' as const, classification: 'UNKNOWN' as const, price: 90, pivotTime: t0 + 2 * step, confirmationTime: t0 + 3 * step, candleIndex: 2 },
        { id: 'sh1', symbol: 'SOLUSDT', timeframe: '15m' as const, scope: 'EXTERNAL' as const, type: 'HIGH' as const, classification: 'LH' as const, price: 100, pivotTime: t0 + 4 * step, confirmationTime: t0 + 5 * step, candleIndex: 4 },
      ];

      // Candle closes above LH (100) -> Bullish CHoCH
      const candles: Candle[] = [
        makeCandle(t0 + 6 * step, 98, 104, 97, 103),
      ];

      const breaks = StructureClassifier.detectBreaks(candles, swings);
      expect(breaks.length).toBe(1);
      expect(breaks[0]?.eventType).toBe('CHOCH_BULLISH');
      expect(breaks[0]?.brokenSwingPrice).toBe(100);
    });
  });

  describe('4. Point-in-Time Causality & Engine Integration', () => {
    it('proves zero lookahead: swing is invisible prior to its confirmation timestamp', () => {
      const store = new KlineStore();
      const engine = new MarketStructureEngine(store, { swingLeftBars: 1, swingRightBars: 1 });
      const t0 = 1700000000000;
      const step = 900_000;

      // Candle 0 (10:00): 100
      // Candle 1 (10:15): High 110 (Peak)
      // Candle 2 (10:30): 102 (Confirms Candle 1 peak on close at 10:45)
      store.upsertCandle(makeCandle(t0, 100, 102, 98, 100));
      store.upsertCandle(makeCandle(t0 + step, 100, 110, 99, 105)); // Peak formed
      store.upsertCandle(makeCandle(t0 + 2 * step, 105, 103, 101, 102)); // Confirming bar

      // Query at 10:20 (during peak candle): Peak is NOT confirmed yet
      const asOf1020 = engine.getStructureAsOf('SOLUSDT', '15m', t0 + step + 300_000);
      expect(asOf1020.swings.length).toBe(0);
      expect(asOf1020.lastConfirmedSwingHigh).toBeUndefined();

      // Query at 10:50 (after confirmation on candle 2 close): Peak IS confirmed
      const asOf1050 = engine.getStructureAsOf('SOLUSDT', '15m', t0 + 3 * step);
      expect(asOf1050.swings.length).toBe(1);
      expect(asOf1050.lastConfirmedSwingHigh?.price).toBe(110);
      expect(asOf1050.lastConfirmedSwingHigh?.pivotTime).toBe(t0 + step);
    });

    it('computes independent multi-timeframe structure across 4h, 1h, 15m, 5m', () => {
      const store = new KlineStore();
      const engine = new MarketStructureEngine(store);
      const asOf = 1700208000000;

      const mtf = engine.computeMultiTimeframeStructure('SOLUSDT', asOf);
      expect(mtf.symbol).toBe('SOLUSDT');
      expect(mtf.timeframes['4h']).toBeDefined();
      expect(mtf.timeframes['1h']).toBeDefined();
      expect(mtf.timeframes['15m']).toBeDefined();
      expect(mtf.timeframes['5m']).toBeDefined();
    });

    it('maintains strict live/historical parity (same input = exact same output)', () => {
      const store1 = new KlineStore();
      const store2 = new KlineStore();
      const t0 = 1699999200000; // Aligned to 15m boundary
      const step = 900_000;

      const candles = [
        makeCandle(t0, 100, 102, 98, 101),
        makeCandle(t0 + step, 101, 110, 100, 108),
        makeCandle(t0 + 2 * step, 108, 105, 95, 96),
        makeCandle(t0 + 3 * step, 96, 98, 90, 92),
        makeCandle(t0 + 4 * step, 92, 104, 91, 103),
      ];

      // Store 1: batch populated (historical replay)
      for (const c of candles) store1.upsertCandle(c);

      // Store 2: tick by tick + finalized (live processing)
      for (const c of candles) {
        store2.applyTick({ symbol: c.symbol, price: c.close, qty: c.volume, ts: c.openTime }, '15m');
        store2.upsertCandle(c);
      }

      const engine1 = new MarketStructureEngine(store1, { swingLeftBars: 1, swingRightBars: 1 });
      const engine2 = new MarketStructureEngine(store2, { swingLeftBars: 1, swingRightBars: 1 });

      const state1 = engine1.getStructureAsOf('SOLUSDT', '15m', t0 + 5 * step);
      const state2 = engine2.getStructureAsOf('SOLUSDT', '15m', t0 + 5 * step);

      expect(state1.trend).toBe(state2.trend);
      expect(state1.structure).toBe(state2.structure);
      expect(state1.swings.length).toBe(state2.swings.length);
      expect(state1.events.length).toBe(state2.events.length);
      expect(state1.lastConfirmedSwingHigh?.price).toBe(state2.lastConfirmedSwingHigh?.price);
      expect(state1.lastConfirmedSwingLow?.price).toBe(state2.lastConfirmedSwingLow?.price);
    });
  });
});
