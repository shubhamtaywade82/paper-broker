import { describe, it, expect } from 'vitest';
import {
  normalizeBookTicker,
  normalizeAggTrade,
  normalizeMarkPrice,
  normalizeKline,
  normalizeOpenInterest,
  normalizeLongShortRatio,
  normalizeTakerVolume,
  normalizeInstrumentInfo,
  applyToMarketState,
} from '../../src/binance/normalizers.js';
import { KlineStore } from '../../src/market/Klines.js';
import { MarketStateManager } from '../../src/market/MarketState.js';
import type { Instrument, MarketState } from '../../src/broker/types.js';

describe('Binance Market Data Normalizers & Quality Checks', () => {
  it('normalizes valid bookTicker and calculates spread', () => {
    const raw = {
      s: 'SOLUSDT',
      b: '97.50',
      a: '97.55',
      B: '120.5',
      A: '85.2',
      E: 1700000000000,
    };
    const res = normalizeBookTicker(raw);
    expect(res).not.toBeNull();
    expect(res?.symbol).toBe('SOLUSDT');
    expect(res?.bid).toBe(97.5);
    expect(res?.ask).toBe(97.55);
    expect(res?.spread).toBeCloseTo(0.05, 4);
  });

  it('rejects inverted or invalid bookTicker prices', () => {
    // Inverted spread (ask < bid)
    expect(normalizeBookTicker({ s: 'SOLUSDT', b: '98.00', a: '97.00', B: '10', A: '10', E: 1 })).toBeNull();
    // Negative bid
    expect(normalizeBookTicker({ s: 'SOLUSDT', b: '-98.00', a: '99.00', B: '10', A: '10', E: 1 })).toBeNull();
    // Non-numeric
    expect(normalizeBookTicker({ s: 'SOLUSDT', b: 'invalid', a: '99.00', B: '10', A: '10', E: 1 })).toBeNull();
  });

  it('normalizes aggTrade and rejects invalid trades', () => {
    const valid = { s: 'SOLUSDT', p: '97.52', q: '14.5', E: 1700000000100, m: true };
    const res = normalizeAggTrade(valid);
    expect(res?.price).toBe(97.52);
    expect(res?.quantity).toBe(14.5);
    expect(res?.isBuyerMaker).toBe(true);

    // Negative quantity rejected
    expect(normalizeAggTrade({ s: 'SOLUSDT', p: '97.52', q: '-1', E: 1 })).toBeNull();
  });

  it('normalizes markPrice and fundingRate', () => {
    const raw = {
      s: 'SOLUSDT',
      p: '97.54',
      i: '97.51',
      r: '0.0001',
      T: 1700028800000,
      E: 1700000000200,
    };
    const res = normalizeMarkPrice(raw);
    expect(res?.markPrice).toBe(97.54);
    expect(res?.indexPrice).toBe(97.51);
    expect(res?.fundingRate).toBe(0.0001);
    expect(res?.nextFundingTime).toBe(1700028800000);
  });

  it('normalizes klines and validates strict OHLC integrity', () => {
    const valid = {
      k: {
        s: 'SOLUSDT',
        i: '15m',
        t: 1700000000000,
        T: 1700000899999,
        o: '96.0',
        h: '98.0',
        l: '95.5',
        c: '97.5',
        v: '12500',
        q: '1200000',
        n: 450,
        x: true,
      },
    };
    const res = normalizeKline(valid);
    expect(res).not.toBeNull();
    expect(res?.closed).toBe(true);
    expect(res?.high).toBe(98.0);
    expect(res?.low).toBe(95.5);

    // High lower than low -> corrupted candle rejected
    const corrupted = {
      k: {
        s: 'SOLUSDT',
        i: '15m',
        t: 1700000000000,
        T: 1700000899999,
        o: '96.0',
        h: '94.0', // Corrupted!
        l: '95.5',
        c: '97.5',
        v: '100',
        q: '100',
        n: 10,
        x: true,
      },
    };
    expect(normalizeKline(corrupted)).toBeNull();
  });

  it('normalizes derivatives data (Open Interest, L/S Ratio, Taker Volume)', () => {
    const oi = normalizeOpenInterest({ symbol: 'SOLUSDT', openInterest: '8380000', time: 1700000000000 });
    expect(oi?.openInterest).toBe(8380000);

    const ls = normalizeLongShortRatio({ symbol: 'SOLUSDT', longShortRatio: '2.33', longAccount: '0.70', shortAccount: '0.30' });
    expect(ls?.longShortRatio).toBe(2.33);

    const taker = normalizeTakerVolume({ symbol: 'SOLUSDT', buyVol: '50000', sellVol: '30000' });
    expect(taker?.buyVolume).toBe(50000);
    expect(taker?.takerDelta).toBe(20000);
  });

  it('applies normalized data to MarketState with latency and spread', () => {
    const market: MarketState = {
      symbol: 'SOLUSDT',
      localTsUtc: Date.now(),
      stale: true,
    };
    const ticker = normalizeBookTicker({
      s: 'SOLUSDT',
      b: '97.50',
      a: '97.55',
      B: '100',
      A: '100',
      E: Date.now() - 50,
    })!;

    applyToMarketState(market, ticker);
    expect(market.stale).toBe(false);
    expect(market.bid).toBe(97.5);
    expect(market.ask).toBe(97.55);
    expect(market.spread).toBeCloseTo(0.05, 4);
    expect(market.latencyMs).toBeGreaterThanOrEqual(40);
  });

  it('normalizes symbol filter metadata from Binance exchangeInfo', () => {
    const rawSymbolInfo = {
      symbol: 'SOLUSDT',
      baseAsset: 'SOL',
      quoteAsset: 'USDT',
      contractType: 'PERPETUAL',
      status: 'TRADING',
      pricePrecision: 2,
      quantityPrecision: 3,
      filters: [
        { filterType: 'PRICE_FILTER', tickSize: '0.01' },
        { filterType: 'LOT_SIZE', stepSize: '0.001', minQty: '0.001', maxQty: '10000' },
        { filterType: 'MIN_NOTIONAL', notional: '5.0' },
      ],
    };
    const inst = normalizeInstrumentInfo(rawSymbolInfo);
    expect(inst.symbol).toBe('SOLUSDT');
    expect(inst.tickSize).toBe('0.01');
    expect(inst.stepSize).toBe('0.001');
    expect(inst.minNotional).toBe('5.0');
    expect(inst.contractType).toBe('PERPETUAL');
  });

  it('handles KlineStore historical + websocket handoff, replacement, and finalization', () => {
    const store = new KlineStore();
    const t0 = 1699999200000; // aligned to 15m
    // 1. Initial developing candle via tick at t=0
    const dev1 = store.applyTick({ symbol: 'SOLUSDT', price: 97.0, qty: 10, ts: t0 }, '15m');
    expect(dev1?.isClosed).toBe(false);
    expect(dev1?.close).toBe(97.0);

    // 2. Developing candle update at same openTime (t=30s)
    const dev2 = store.applyTick({ symbol: 'SOLUSDT', price: 98.0, qty: 20, ts: t0 + 30000 }, '15m');
    expect(dev2?.high).toBe(98.0);
    expect(dev2?.volume).toBe(30);

    // 3. Finalization on closed kline from websocket
    const closedPayload = {
      k: {
        s: 'SOLUSDT',
        i: '15m',
        t: t0,
        T: t0 + 899999,
        o: '97.0',
        h: '98.5',
        l: '96.5',
        c: '98.2',
        v: '500',
        q: '49000',
        n: 80,
        x: true,
      },
    };
    const closed = normalizeKline(closedPayload);
    store.upsertCandle({ ...closed!, isClosed: closed!.closed });

    const currentSeries = store.getCandles('SOLUSDT', '15m', 10);
    expect(currentSeries.length).toBe(1);
    expect(currentSeries[0]?.close).toBe(98.2);
    expect(currentSeries[0]?.isClosed).toBe(true);
  });

  it('proves zero lookahead leakage with strict point-in-time querying', () => {
    const store = new KlineStore();
    // Add candles for t=0, t=15m, t=30m, t=45m
    const t0 = 1700000000000;
    const t1 = t0 + 900000;
    const t2 = t1 + 900000;
    const t3 = t2 + 900000;

    store.upsertCandle({ symbol: 'SOLUSDT', interval: '15m', openTime: t0, open: 90, high: 92, low: 89, close: 91, volume: 100 });
    store.upsertCandle({ symbol: 'SOLUSDT', interval: '15m', openTime: t1, open: 91, high: 93, low: 90, close: 92, volume: 100 });
    store.upsertCandle({ symbol: 'SOLUSDT', interval: '15m', openTime: t2, open: 92, high: 95, low: 91, close: 94, volume: 100 });
    store.upsertCandle({ symbol: 'SOLUSDT', interval: '15m', openTime: t3, open: 94, high: 98, low: 93, close: 97, volume: 100 });

    // At time t1, evaluation must ONLY see candles at or before t1 (t0 and t1), NEVER t2 or t3
    const asOfT1 = store.getCandlesAsOf('SOLUSDT', '15m', t1, 10);
    expect(asOfT1.length).toBe(2);
    expect(asOfT1.map((c) => c.openTime)).toEqual([t0, t1]);
    expect(asOfT1.some((c) => c.openTime > t1)).toBe(false);
  });

  it('tracks data health state transitions (HEALTHY -> STALE -> INVALID -> DISCONNECTED)', () => {
    const inst: Instrument = {
      symbol: 'SOLUSDT',
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
    const manager = new MarketStateManager([inst]);

    // Unknown symbol -> DISCONNECTED
    expect(manager.getDataHealth('ETHUSDT')).toBe('DISCONNECTED');

    // Fresh valid prices -> HEALTHY
    manager.onBookTicker('SOLUSDT', 97.5, 97.55, 100, 100, String(Date.now()));
    manager.onMarkPrice('SOLUSDT', 97.52, 97.5, 0.0001, String(Date.now() + 28800000), String(Date.now()));
    expect(manager.getDataHealth('SOLUSDT', 5000)).toBe('HEALTHY');

    // Stale age exceeded -> STALE
    manager.markStale(0);
    expect(manager.getDataHealth('SOLUSDT', 5000)).toBe('STALE');
  });

  it('enforces timestamp monotonicity on ticker events', () => {
    const inst: Instrument = {
      symbol: 'SOLUSDT',
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
    const manager = new MarketStateManager([inst]);

    // T1: 12:00:01
    manager.onBookTicker('SOLUSDT', 97.5, 97.55, 10, 10, '1700000001000');
    expect(manager.getState('SOLUSDT')?.lastQualityStatus).toBe('VALID');

    // T2: 12:00:02
    manager.onBookTicker('SOLUSDT', 97.52, 97.57, 10, 10, '1700000002000');
    expect(manager.getState('SOLUSDT')?.lastQualityStatus).toBe('VALID');

    // T3: 12:00:01 (Out of order -> rejected)
    manager.onBookTicker('SOLUSDT', 97.51, 97.56, 10, 10, '1700000001000');
    expect(manager.getState('SOLUSDT')?.lastQualityStatus).toBe('OUT_OF_ORDER');
    // Ensure state remained at T2 price
    expect(manager.getState('SOLUSDT')?.bid).toBe(97.52);
  });

  it('validates future timestamps and allows configured clock skew', () => {
    const now = 1700000000000;
    // Normal timestamp -> valid
    expect(normalizeBookTicker({ s: 'SOLUSDT', b: '97.5', a: '97.6', B: '1', A: '1', E: now - 500 }, now)).not.toBeNull();
    // Acceptable clock skew (+3 seconds) -> valid
    expect(normalizeBookTicker({ s: 'SOLUSDT', b: '97.5', a: '97.6', B: '1', A: '1', E: now + 3000 }, now)).not.toBeNull();
    // Excessive future timestamp (+30 seconds) -> rejected
    expect(normalizeBookTicker({ s: 'SOLUSDT', b: '97.5', a: '97.6', B: '1', A: '1', E: now + 30000 }, now)).toBeNull();
  });

  it('detects missing candle intervals without interpolating or fabricating data', () => {
    const store = new KlineStore();
    const t0 = 1700000000000; // 10:00 (5m)
    const t1 = t0 + 300_000;  // 10:05 (5m)
    const t3 = t0 + 900_000;  // 10:15 (5m) - 10:10 missing!

    store.upsertCandle({ symbol: 'SOLUSDT', interval: '5m', openTime: t0, open: 90, high: 91, low: 89, close: 90.5, volume: 100 });
    store.upsertCandle({ symbol: 'SOLUSDT', interval: '5m', openTime: t1, open: 90.5, high: 92, low: 90, close: 91.5, volume: 100 });
    store.upsertCandle({ symbol: 'SOLUSDT', interval: '5m', openTime: t3, open: 91.5, high: 93, low: 91, close: 92.5, volume: 100 });

    const gaps = store.detectGaps('SOLUSDT', '5m');
    expect(gaps.length).toBe(1);
    expect(gaps[0]?.expectedTime).toBe(t0 + 600_000); // 10:10
    expect(gaps[0]?.missingCount).toBe(1);
  });

  it('preserves independent source timestamps for derivatives data', () => {
    const inst: Instrument = {
      symbol: 'SOLUSDT',
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
    const manager = new MarketStateManager([inst]);

    const oiTs = '2026-08-22T10:00:00.000Z';
    const lsTs = '2026-08-22T10:05:00.000Z';
    const takerTs = '2026-08-22T10:04:30.000Z';

    manager.onDerivatives('SOLUSDT', {
      openInterest: 8500000,
      openInterestTimestampUtc: oiTs,
      longShortRatio: 2.1,
      longShortTimestampUtc: lsTs,
      takerDelta: 15000,
      takerVolumeTimestampUtc: takerTs,
    });

    const state = manager.getState('SOLUSDT');
    expect(state?.openInterestTimestampUtc).toBe(oiTs);
    expect(state?.longShortTimestampUtc).toBe(lsTs);
    expect(state?.takerVolumeTimestampUtc).toBe(takerTs);
    // Preserves individual freshness without conflating timestamps
    expect(state?.openInterestTimestampUtc).not.toBe(state?.longShortTimestampUtc);
  });
});

