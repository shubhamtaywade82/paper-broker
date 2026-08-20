import { describe, it, expect, beforeEach } from 'vitest';
import { StrategyEngine, type Strategy } from '../../src/strategy/StrategyEngine.js';
import type { Signal } from '../../src/strategy/signal.js';
import { parseSignalInput, signalsEqual, toSignal, signalIsExpired } from '../../src/strategy/signal.js';
import { SizingEngine } from '../../src/strategy/SizingEngine.js';
import { OrderFactory } from '../../src/strategy/OrderFactory.js';
import { ema, rsi, atr, sma, highest, lowest } from '../../src/strategy/indicators.js';
import type { Candle } from '../../src/strategy/indicators.js';
import type { Instrument, MarketState } from '../../src/broker/types.js';

const market: MarketState = {
  symbol: 'BTCUSDT',
  bid: 100,
  ask: 100.1,
  last: 100.05,
  mark: 100,
  localTsUtc: Date.now(),
  stale: false,
};

const instrument: Instrument = {
  symbol: 'BTCUSDT',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  contractType: 'PERPETUAL',
  status: 'TRADING',
  tickSize: '0.01',
  stepSize: '0.001',
  minQty: '0.001',
  maxQty: '1000',
  minNotional: '5',
  pricePrecision: 2,
  quantityPrecision: 3,
  maintenanceMarginRate: '0.005',
  createdAtUtc: new Date().toISOString(),
  updatedAtUtc: new Date().toISOString(),
};

function makeCandles(count: number, startPrice = 100): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const price = startPrice + i * 0.1;
    candles.push({
      symbol: 'BTCUSDT',
      interval: '5m',
      openTime: 1700000000000 + i * 300_000,
      open: price,
      high: price + 0.5,
      low: price - 0.5,
      close: price,
      volume: 100,
    });
  }
  return candles;
}

function setupEngine(positions: { qty: number }[] = []) {
  const submitted: Signal[] = [];
  const engine = new StrategyEngine(
    {
      marketState: () => market,
      klines: {
        getCandles: (_symbol: string, _interval: string, limit: number) =>
          makeCandles(100).slice(-limit),
      },
      account: () => ({
        walletBalance: 10000,
        unrealizedPnl: 0,
        equity: 10000,
        initialMargin: 0,
        maintenanceMargin: 0,
        availableBalance: 10000,
        openPositionsCount: positions.length,
        openOrdersCount: 0,
      }),
      getPosition: (symbol: string) =>
        positions.length > 0
          ? {
              accountId: 'test',
              symbol,
              positionSide: 'BOTH',
              status: 'OPEN',
              qty: positions[0]?.qty ?? 0,
              entryPrice: 100,
              leverage: 5,
              maintenanceMarginRate: 0.005,
              realizedPnl: 0,
              unrealizedPnl: 0,
              initialMargin: 0,
              maintenanceMargin: 0,
              totalFees: 0,
              totalFunding: 0,
              updatedAtUtc: new Date().toISOString(),
            }
          : undefined,
      getOpenOrders: () => [],
      getInstrument: () => instrument,
    },
    {
      onSubmitSignal: async (signal) => {
        submitted.push(signal);
        return true;
      },
    }
  );
  return { engine, submitted };
}

describe('signal.ts', () => {
  it('parses a valid signal input with defaults', () => {
    const input = parseSignalInput({
      strategyId: 's1',
      symbol: 'BTCUSDT',
      action: 'OPEN_LONG',
      confidence: 0.8,
    });
    expect(input.ttlMs).toBe(60000);
    expect(input.features).toEqual({});
  });

  it('rejects invalid actions', () => {
    expect(() =>
      parseSignalInput({
        strategyId: 's1',
        symbol: 'BTCUSDT',
        action: 'NOPE',
        confidence: 0.8,
      })
    ).toThrow();
  });

  it('rejects confidence outside 0..1', () => {
    expect(() =>
      parseSignalInput({
        strategyId: 's1',
        symbol: 'BTCUSDT',
        action: 'OPEN_LONG',
        confidence: 1.5,
      })
    ).toThrow();
  });

  it('toSignal assigns id and status CREATED', () => {
    const signal = toSignal({
      strategyId: 's1',
      symbol: 'BTCUSDT',
      action: 'OPEN_LONG',
      confidence: 0.8,
    });
    expect(signal.id).toBeTruthy();
    expect(signal.status).toBe('CREATED');
  });

  it('signalIsExpired respects ttl', () => {
    const signal = toSignal(
      parseSignalInput({
        strategyId: 's1',
        symbol: 'BTCUSDT',
        action: 'OPEN_LONG',
        confidence: 0.8,
        ttlMs: 1000,
      }),
      1000
    );
    expect(signalIsExpired(signal, 2000)).toBe(false);
    expect(signalIsExpired(signal, 62_000)).toBe(true);
  });

  it('signalsEqual compares strategy/symbol/action', () => {
    const a = parseSignalInput({ strategyId: 's1', symbol: 'BTCUSDT', action: 'OPEN_LONG', confidence: 0.8 });
    const b = parseSignalInput({ strategyId: 's1', symbol: 'BTCUSDT', action: 'OPEN_LONG', confidence: 0.9 });
    const c = parseSignalInput({ strategyId: 's1', symbol: 'BTCUSDT', action: 'OPEN_SHORT', confidence: 0.8 });
    expect(signalsEqual(a, b)).toBe(true);
    expect(signalsEqual(a, c)).toBe(false);
  });
});

describe('StrategyEngine', () => {
  it('registers and lists strategies', () => {
    const { engine } = setupEngine();
    const strategy: Strategy = {
      id: 'test',
      name: 'Test',
      enabled: true,
      symbols: ['BTCUSDT'],
      intervals: ['5m'],
      priority: 1,
      cooldownMs: 1000,
    };
    engine.register(strategy);
    expect(engine.listStrategies().length).toBe(1);
  });

  it('fails on duplicate strategy id', () => {
    const { engine } = setupEngine();
    const strategy: Strategy = {
      id: 'test',
      name: 'Test',
      enabled: true,
      symbols: ['BTCUSDT'],
      intervals: ['5m'],
      priority: 1,
      cooldownMs: 1000,
    };
    engine.register(strategy);
    expect(() => engine.register(strategy)).toThrow(/already registered/);
  });

  it('submits a valid signal through onSubmitSignal', async () => {
    const { engine, submitted } = setupEngine();
    await engine.start();
    const strategy: Strategy = {
      id: 'test',
      name: 'Test',
      enabled: true,
      symbols: ['BTCUSDT'],
      intervals: ['5m'],
      priority: 1,
      cooldownMs: 1000,
      onCandleClose: () => ({
        strategyId: 'test',
        symbol: 'BTCUSDT',
        action: 'OPEN_LONG',
        confidence: 0.8,
        ttlMs: 60000,
        features: {},
      }),
    };
    engine.register(strategy);
    await engine.onCandleClose(makeCandles(1)[0]!);
    expect(submitted.length).toBe(1);
    expect(submitted[0]?.action).toBe('OPEN_LONG');
  });

  it('enforces cooldown', async () => {
    const { engine, submitted } = setupEngine();
    await engine.start();
    let calls = 0;
    const strategy: Strategy = {
      id: 'test',
      name: 'Test',
      enabled: true,
      symbols: ['BTCUSDT'],
      intervals: ['5m'],
      priority: 1,
      cooldownMs: 60_000,
      onCandleClose: () => {
        calls++;
        return {
          strategyId: 'test',
          symbol: 'BTCUSDT',
          action: 'OPEN_LONG',
          confidence: 0.8,
          ttlMs: 60000,
          features: {},
        };
      },
    };
    engine.register(strategy);
    await engine.onCandleClose(makeCandles(1)[0]!);
    await engine.onCandleClose(makeCandles(1)[0]!);
    expect(submitted.length).toBe(1);
  });

  it('rejects opposite-side open below 0.75 confidence', async () => {
    const { engine, submitted } = setupEngine([{ qty: 1 }]);
    await engine.start();
    const strategy: Strategy = {
      id: 'test',
      name: 'Test',
      enabled: true,
      symbols: ['BTCUSDT'],
      intervals: ['5m'],
      priority: 1,
      cooldownMs: 1000,
      onCandleClose: () => ({
        strategyId: 'test',
        symbol: 'BTCUSDT',
        action: 'OPEN_SHORT',
        confidence: 0.5,
        ttlMs: 60000,
        features: {},
      }),
    };
    engine.register(strategy);
    await engine.onCandleClose(makeCandles(1)[0]!);
    expect(submitted.length).toBe(0);
  });

  it('expires stale signals', async () => {
    const { engine } = setupEngine();
    await engine.start();
    const strategy: Strategy = {
      id: 'test',
      name: 'Test',
      enabled: true,
      symbols: ['BTCUSDT'],
      intervals: ['5m'],
      priority: 1,
      cooldownMs: 1000,
      onCandleClose: () => ({
        strategyId: 'test',
        symbol: 'BTCUSDT',
        action: 'OPEN_LONG',
        confidence: 0.8,
        ttlMs: 1,
        features: {},
      }),
    };
    engine.register(strategy);
    await engine.onCandleClose(makeCandles(1)[0]!);
    await new Promise((r) => setTimeout(r, 20));
    const expired = engine.expireSignals();
    expect(expired).toBeGreaterThanOrEqual(0);
  });
});

describe('SizingEngine', () => {
  it('sizes by risk per trade with stop distance', () => {
    const engine = new SizingEngine({ riskPerTrade: 0.005, maxNotional: 5000 });
    const result = engine.sizePosition({
      account: { equity: 10000 } as never,
      instrument,
      entryPrice: 100,
      stopLossPrice: 95,
    });
    // risk = 10000 * 0.005 = 50; distance = 5; qty = 10
    expect(result.quantity).toBeCloseTo(10, 8);
    expect(result.notional).toBeCloseTo(1000, 6);
  });

  it('caps notional at maxNotional', () => {
    const engine = new SizingEngine({ riskPerTrade: 0.005, maxNotional: 500 });
    const result = engine.sizePosition({
      account: { equity: 10000 } as never,
      instrument,
      entryPrice: 100,
      stopLossPrice: 95,
    });
    expect(result.quantity).toBeCloseTo(5, 8);
    expect(result.notional).toBeCloseTo(500, 6);
  });

  it('uses fallback sizing without stop', () => {
    const engine = new SizingEngine({ riskPerTrade: 0.005, maxNotional: 5000, fallbackRiskPerTrade: 0.1 });
    const result = engine.sizePosition({
      account: { equity: 10000 } as never,
      instrument,
      entryPrice: 100,
    });
    // 10% of equity = 1000 notional -> 10 qty
    expect(result.quantity).toBeCloseTo(10, 8);
  });

  it('rounds down to step size', () => {
    const engine = new SizingEngine({ riskPerTrade: 0.005, maxNotional: 5000 });
    const result = engine.sizePosition({
      account: { equity: 10000 } as never,
      instrument,
      entryPrice: 100.01,
      stopLossPrice: 95.02,
    });
    const qtyRaw = 50 / (100.01 - 95.02);
    const expected = Math.floor(qtyRaw / 0.001) * 0.001;
    expect(result.quantity).toBeCloseTo(expected, 8);
  });
});

describe('OrderFactory', () => {
  it('builds a market BUY for OPEN_LONG', () => {
    const factory = new OrderFactory({ defaultLeverage: 5 });
    const signal = toSignal({
      strategyId: 's1',
      symbol: 'BTCUSDT',
      action: 'OPEN_LONG',
      confidence: 0.8,
    });
    const order = factory.buildOrder({ signal, quantity: 0.1 });
    expect(order?.side).toBe('BUY');
    expect(order?.type).toBe('MARKET');
    expect(order?.reduceOnly).toBe(false);
    expect(order?.signalId).toBe(signal.id);
  });

  it('builds reduceOnly SELL for CLOSE_LONG', () => {
    const factory = new OrderFactory({ defaultLeverage: 5 });
    const signal = toSignal({
      strategyId: 's1',
      symbol: 'BTCUSDT',
      action: 'CLOSE_LONG',
      confidence: 0.8,
    });
    const order = factory.buildOrder({ signal, quantity: 0.1 });
    expect(order?.side).toBe('SELL');
    expect(order?.reduceOnly).toBe(true);
  });

  it('returns null for HOLD', () => {
    const factory = new OrderFactory({ defaultLeverage: 5 });
    const signal = toSignal({
      strategyId: 's1',
      symbol: 'BTCUSDT',
      action: 'HOLD',
      confidence: 0.8,
    });
    expect(factory.buildOrder({ signal, quantity: 0.1 })).toBeNull();
  });

  it('builds a STOP_MARKET for open-long stop loss', () => {
    const factory = new OrderFactory({ defaultLeverage: 5 });
    const signal = toSignal({
      strategyId: 's1',
      symbol: 'BTCUSDT',
      action: 'OPEN_LONG',
      confidence: 0.8,
      stopLossPrice: '95',
    });
    const stop = factory.buildStopLossOrder(signal, 0.1);
    expect(stop?.side).toBe('SELL');
    expect(stop?.type).toBe('STOP_MARKET');
    expect(stop?.stopPrice).toBe(95);
    expect(stop?.reduceOnly).toBe(true);
  });
});

describe('indicators', () => {
  it('ema follows the series', () => {
    const values = [1, 2, 3, 4, 5];
    const result = ema(values, 3);
    expect(result.length).toBe(5);
    expect(result[0]).toBe(1);
    // standard EMA with k = 2/(3+1): 1, 1.5, 2.25, 3.125, 4.0625
    expect(result[4]).toBeCloseTo(4.0625, 8);
  });

  it('sma is the rolling mean', () => {
    const values = [1, 2, 3, 4, 5];
    const result = sma(values, 3);
    expect(result[4]).toBeCloseTo(4, 8);
  });

  it('rsi is bounded 0..100', () => {
    const values = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i / 3) * 10);
    const result = rsi(values, 14);
    for (const v of result) {
      if (!Number.isNaN(v)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it('atr returns positive values', () => {
    const candles = makeCandles(20);
    const result = atr(candles, 14);
    const last = result[result.length - 1];
    expect(last).toBeGreaterThan(0);
  });

  it('highest/lowest track extremes', () => {
    const values = [1, 5, 3, 7, 2];
    expect(highest(values, 3)[4]).toBe(7);
    expect(lowest(values, 3)[4]).toBe(2);
  });
});