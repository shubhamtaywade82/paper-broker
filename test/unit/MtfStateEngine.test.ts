import { describe, it, expect } from 'vitest';
import { KlineStore } from '../../src/market/Klines.js';
import { MarketStateManager } from '../../src/market/MarketState.js';
import {
  MtfStateEngine,
  TIMEFRAME_MS,
  MIN_CLOSED_CANDLES,
  type AnalysisTimeframe,
} from '../../src/market/MtfStateEngine.js';
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

function populateCandles(
  store: KlineStore,
  symbol: string,
  tf: AnalysisTimeframe,
  count: number,
  startTs = 1700000000000,
  basePrice = 100
): number {
  const intervalMs = TIMEFRAME_MS[tf];
  let currentTs = startTs;
  for (let i = 0; i < count; i++) {
    store.upsertCandle({
      symbol,
      interval: tf,
      openTime: currentTs,
      closeTime: currentTs + intervalMs - 1,
      open: basePrice + i * 0.1,
      high: basePrice + i * 0.1 + 1,
      low: basePrice + i * 0.1 - 1,
      close: basePrice + i * 0.1 + 0.5,
      volume: 1000,
      isClosed: true,
    });
    currentTs += intervalMs;
  }
  return currentTs;
}

describe('Phase 2 — Multi-Timeframe State Synchronization Engine', () => {
  it('computes isolated timeframe states for 4h, 2h, 1h, 15m, and 5m', () => {
    const store = new KlineStore();
    const inst = makeMockInstrument();
    const manager = new MarketStateManager([inst]);
    const engine = new MtfStateEngine(store, manager);

    // End time aligned to 4H boundary
    const endTs = 1700208000000;
    // Populate backward from endTs so all timeframes finish at endTs
    populateCandles(store, 'SOLUSDT', '4h', MIN_CLOSED_CANDLES['4h'], endTs - MIN_CLOSED_CANDLES['4h'] * TIMEFRAME_MS['4h']);
    populateCandles(store, 'SOLUSDT', '2h', MIN_CLOSED_CANDLES['2h'], endTs - MIN_CLOSED_CANDLES['2h'] * TIMEFRAME_MS['2h']);
    populateCandles(store, 'SOLUSDT', '1h', MIN_CLOSED_CANDLES['1h'], endTs - MIN_CLOSED_CANDLES['1h'] * TIMEFRAME_MS['1h']);
    populateCandles(store, 'SOLUSDT', '15m', MIN_CLOSED_CANDLES['15m'], endTs - MIN_CLOSED_CANDLES['15m'] * TIMEFRAME_MS['15m']);
    populateCandles(store, 'SOLUSDT', '5m', MIN_CLOSED_CANDLES['5m'], endTs - MIN_CLOSED_CANDLES['5m'] * TIMEFRAME_MS['5m']);

    manager.onBookTicker('SOLUSDT', 105, 105.05, 100, 100, String(endTs));
    manager.onMarkPrice('SOLUSDT', 105.02, 105, 0.0001, String(endTs + 28800000), String(endTs));

    const state = engine.computeState('SOLUSDT', endTs);
    expect(state.symbol).toBe('SOLUSDT');
    expect(state.timeframes['4h'].candleCount).toBe(MIN_CLOSED_CANDLES['4h']);
    expect(state.timeframes['2h'].candleCount).toBe(MIN_CLOSED_CANDLES['2h']);
    expect(state.timeframes['1h'].candleCount).toBe(MIN_CLOSED_CANDLES['1h']);
    expect(state.timeframes['15m'].candleCount).toBe(MIN_CLOSED_CANDLES['15m']);
    expect(state.timeframes['5m'].candleCount).toBe(MIN_CLOSED_CANDLES['5m']);
    expect(state.isFullySynchronized).toBe(true);
    expect(state.overallSyncStatus).toBe('SYNCHRONIZED');
  });

  it('treats a missing 2h series as MISSING_DATA and degrades the overall state', () => {
    const store = new KlineStore();
    const engine = new MtfStateEngine(store);
    const endTs = 1700208000000;

    // Everything EXCEPT 2h.
    populateCandles(store, 'SOLUSDT', '4h', MIN_CLOSED_CANDLES['4h'], endTs - MIN_CLOSED_CANDLES['4h'] * TIMEFRAME_MS['4h']);
    populateCandles(store, 'SOLUSDT', '1h', MIN_CLOSED_CANDLES['1h'], endTs - MIN_CLOSED_CANDLES['1h'] * TIMEFRAME_MS['1h']);
    populateCandles(store, 'SOLUSDT', '15m', MIN_CLOSED_CANDLES['15m'], endTs - MIN_CLOSED_CANDLES['15m'] * TIMEFRAME_MS['15m']);
    populateCandles(store, 'SOLUSDT', '5m', MIN_CLOSED_CANDLES['5m'], endTs - MIN_CLOSED_CANDLES['5m'] * TIMEFRAME_MS['5m']);

    const state = engine.computeState('SOLUSDT', endTs);
    expect(state.timeframes['2h'].syncStatus).toBe('MISSING_DATA');
    expect(state.isFullySynchronized).toBe(false);
    expect(state.overallSyncStatus).toBe('MISSING_DATA');
  });

  it('strictly separates developing candles from confirmed closed candles', () => {
    const store = new KlineStore();
    const engine = new MtfStateEngine(store);
    const t0 = 1700000400000;

    // Add 50 closed 5m candles
    populateCandles(store, 'SOLUSDT', '5m', 50, t0);
    const devOpen = t0 + 50 * 300_000;

    // Add a developing 5m candle
    store.upsertCandle({
      symbol: 'SOLUSDT',
      interval: '5m',
      openTime: devOpen,
      closeTime: devOpen + 299_999,
      open: 110,
      high: 115,
      low: 109,
      close: 114,
      volume: 50,
      isClosed: false,
    });

    // Query halfway through the developing candle (devOpen + 100s)
    const asOf = devOpen + 100_000;
    const tfState = engine.computeTimeframeState('SOLUSDT', '5m', asOf);

    expect(tfState.closedCandles.length).toBe(50);
    expect(tfState.currentDevelopingCandle).toBeDefined();
    expect(tfState.currentDevelopingCandle?.close).toBe(114);
    // Developing candle must NOT alter lastClosedCandle
    expect(tfState.lastClosedCandle?.openTime).toBe(devOpen - 300_000);
    expect(tfState.lastClosedCandle?.isClosed).toBe(true);
  });

  it('marks state NOT_READY on restart when history is below minimum threshold', () => {
    const store = new KlineStore();
    const engine = new MtfStateEngine(store);

    // Populate only 5 4H candles (minimum is 20)
    const end = populateCandles(store, 'SOLUSDT', '4h', 5, 1700000400000);
    const tfState = engine.computeTimeframeState('SOLUSDT', '4h', end);

    expect(tfState.syncStatus).toBe('NOT_READY');
    expect(tfState.isSynchronized).toBe(false);
  });

  it('detects STALE and DEGRADED timeframe states', () => {
    const store = new KlineStore();
    const engine = new MtfStateEngine(store);

    const t0 = 1700000400000;
    const end = populateCandles(store, 'SOLUSDT', '15m', 50, t0);

    // Query 5 hours after last 15m candle (stale threshold is 3 intervals = 45m)
    const staleAsOf = end + 5 * 3_600_000;
    const staleState = engine.computeTimeframeState('SOLUSDT', '15m', staleAsOf);
    expect(staleState.syncStatus).toBe('STALE');
    expect(staleState.isSynchronized).toBe(false);
  });

  it('enforces overall MTF status degradation if any single timeframe fails', () => {
    const store = new KlineStore();
    const engine = new MtfStateEngine(store);
    const endTs = 1700208000000;

    // 4h, 1h, 5m have enough candles, but 15m has 0
    populateCandles(store, 'SOLUSDT', '4h', 20, endTs - 20 * TIMEFRAME_MS['4h']);
    populateCandles(store, 'SOLUSDT', '1h', 30, endTs - 30 * TIMEFRAME_MS['1h']);
    populateCandles(store, 'SOLUSDT', '5m', 50, endTs - 50 * TIMEFRAME_MS['5m']);

    const state = engine.computeState('SOLUSDT', endTs);
    expect(state.timeframes['15m'].syncStatus).toBe('MISSING_DATA');
    expect(state.isFullySynchronized).toBe(false);
    expect(state.overallSyncStatus).toBe('MISSING_DATA');
  });

  it('verifies parent-child interval containment', () => {
    // Base 1H aligned: 1700006400000
    const parent1h = 1700006400000;
    const child15m = parent1h + 15 * 60_000;
    const nextParent1h = parent1h + 3_600_000;

    expect(MtfStateEngine.isChildIntervalContained(child15m, '15m', parent1h, '1h')).toBe(true);
    expect(MtfStateEngine.isChildIntervalContained(child15m, '15m', nextParent1h, '1h')).toBe(false);
  });

  it('proves MTF causality: future dramatic 4H move is invisible prior to its closure', () => {
    const store = new KlineStore();
    const engine = new MtfStateEngine(store);
    const t0 = 1700006400000;

    // 20 normal 4H candles (100 -> 102)
    populateCandles(store, 'SOLUSDT', '4h', 20, t0, 100);
    const t21 = t0 + 20 * 14_400_000;

    // 21st candle at t21 has a massive spike from 100 to 250
    store.upsertCandle({
      symbol: 'SOLUSDT',
      interval: '4h',
      openTime: t21,
      closeTime: t21 + 14_399_999,
      open: 102,
      high: 250,
      low: 101,
      close: 245,
      volume: 50000,
      isClosed: false,
    });

    // Query analysis at t21 + 1 hour (before 4H close)
    const analysisTs = t21 + 3_600_000;
    const mtf = engine.computeState('SOLUSDT', analysisTs);

    // 4H last confirmed closed candle must NOT contain the 250 spike
    expect(mtf.timeframes['4h'].lastClosedCandle?.high).toBeLessThan(110);
    expect(mtf.timeframes['4h'].lastClosedCandle?.openTime).toBe(t21 - 14_400_000);

    // Developing candle contains the current move
    expect(mtf.timeframes['4h'].currentDevelopingCandle?.high).toBe(250);
  });

  it('seamlessly transitions from REST historical snapshot to WebSocket live updates', () => {
    const store = new KlineStore();
    const engine = new MtfStateEngine(store);
    const t0 = 1700000400000; // aligned to 5m

    // 1. REST historical load (50 candles)
    populateCandles(store, 'SOLUSDT', '5m', 50, t0, 100);
    const lastHistoricalOpen = t0 + 49 * 300_000;

    // 2. WebSocket tick develops next candle (open = t0 + 50 * 300_000)
    const nextOpen = lastHistoricalOpen + 300_000;
    store.applyTick({ symbol: 'SOLUSDT', price: 105.5, qty: 10, ts: nextOpen + 10_000 }, '5m');

    let state = engine.computeTimeframeState('SOLUSDT', '5m', nextOpen + 20_000);
    expect(state.candleCount).toBe(50);
    expect(state.currentDevelopingCandle?.close).toBe(105.5);

    // 3. WebSocket closed event arrives for this candle
    store.upsertCandle({
      symbol: 'SOLUSDT',
      interval: '5m',
      openTime: nextOpen,
      closeTime: nextOpen + 299_999,
      open: 105.5,
      high: 106.0,
      low: 105.0,
      close: 105.8,
      volume: 500,
      isClosed: true,
    });

    state = engine.computeTimeframeState('SOLUSDT', '5m', nextOpen + 300_000);
    expect(state.candleCount).toBe(51);
    expect(state.lastClosedCandle?.openTime).toBe(nextOpen);
    expect(state.lastClosedCandle?.close).toBe(105.8);
  });
});
