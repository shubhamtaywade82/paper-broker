import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaperBroker } from '../../src/broker/PaperBroker.js';
import { SignalExecutor } from '../../src/strategy/SignalExecutor.js';
import { OrderFactory } from '../../src/strategy/OrderFactory.js';
import { toSignal, parseSignalInput } from '../../src/strategy/signal.js';
import type { Signal } from '../../src/strategy/signal.js';
import { DatabaseManager } from '../../src/persistence/db.js';
import type { Instrument, MarketState } from '../../src/broker/types.js';

const BTC: Instrument = {
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

const market: MarketState = {
  symbol: 'BTCUSDT',
  bid: 100,
  ask: 100.1,
  last: 100.05,
  mark: 100,
  localTsUtc: Date.now(),
  stale: false,
};

function makeSignal(action: Signal['action'], extra: Partial<Signal> = {}): Signal {
  return toSignal({
    strategyId: 'test',
    symbol: 'BTCUSDT',
    action,
    confidence: 0.8,
    stopLossPrice: '95',
    takeProfitPrice: '110',
    ttlMs: 60_000,
    features: {},
    ...extra,
  });
}

async function run(
  db: DatabaseManager,
  executor: SignalExecutor,
  action: Signal['action'],
  extra: Partial<Signal> = {}
): Promise<Signal> {
  const signal = makeSignal(action, extra);
  db.signals.insert(signal);
  await executor.execute(signal);
  return signal;
}

describe('SignalExecutor', () => {
  let broker: PaperBroker;
  let db: DatabaseManager;
  let executor: SignalExecutor;

  beforeEach(() => {
    broker = new PaperBroker({
      dataDir: '/tmp/paper-broker-signal-test',
      accountId: 'test-account',
      startingUsdt: 10000,
      instruments: [BTC],
    });
    broker.onMarket(market);

    db = new DatabaseManager('/tmp/paper-broker-signal-test');

    executor = new SignalExecutor({
      broker,
      orderFactory: new OrderFactory({ defaultLeverage: 5 }),
      signals: db.signals,
      getMarketState: () => market,
    });
  });

  it('opens a long position from OPEN_LONG and marks the signal EXECUTED', async () => {
    const signal = await run(db, executor, 'OPEN_LONG', { features: { quantity: 9.803, leverage: 5 } });

    const position = broker.getPosition('BTCUSDT');
    expect(position?.qty).toBeGreaterThan(0);

    const row = db.signals.findById(signal.id);
    expect(row?.status).toBe('EXECUTED');
    expect(row?.orderId).toBeTruthy();
  });

  it('closes the position from CLOSE_LONG using position size', async () => {
    broker.onMarket(market);
    broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.1,
      leverage: 5,
    });

    await run(db, executor, 'CLOSE_LONG');

    expect(broker.getPosition('BTCUSDT')?.qty).toBe(0);
  });

  it('is a no-op for HOLD', async () => {
    const signal = await run(db, executor, 'HOLD');

    expect(broker.getOpenOrders().length).toBe(0);
    expect(db.signals.findById(signal.id)?.status).toBe('CREATED');
  });

  it('skips CLOSE_LONG with no position and marks the signal REJECTED (H-18)', async () => {
    // H-18: a signal that resolves to zero quantity (nothing to close, no
    // position) previously left the persisted status as 'CREATED' and
    // reported success to the caller — indistinguishable from a genuinely
    // executed signal. It must be explicitly REJECTED instead (same fix as
    // the missing-price case).
    const signal = await run(db, executor, 'CLOSE_LONG');

    const row = db.signals.findById(signal.id);
    expect(row?.status).toBe('REJECTED');
    expect(row?.rejectReason).toBe('ZERO_QUANTITY');
  });

  it('skips OPEN_LONG with no market price and marks the signal REJECTED (H-18)', async () => {
    // H-18: execute() used to `return true` here — StrategyEngine treats a
    // truthy return as success (no rejection event, no metric, and the
    // persisted signal status was left ambiguous) even though no order was
    // ever submitted to the broker.
    const noMarketExecutor = new SignalExecutor({
      broker,
      orderFactory: new OrderFactory({ defaultLeverage: 5 }),
      signals: db.signals,
      getMarketState: () => undefined,
    });

    const signal = makeSignal('OPEN_LONG', { features: { quantity: 1, leverage: 5 } });
    db.signals.insert(signal);
    const accepted = await noMarketExecutor.execute(signal);

    expect(accepted).toBe(false);
    const row = db.signals.findById(signal.id);
    expect(row?.status).toBe('REJECTED');
    expect(row?.rejectReason).toBe('NO_MARKET_STATE');
    expect(broker.getOpenOrders().length).toBe(0);
  });

  it('marks the signal REJECTED when the broker rejects', async () => {
    vi.spyOn(broker, 'submitOrder').mockReturnValue({
      id: 'rej-1',
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.1,
      price: undefined,
      stopPrice: undefined,
      timeInForce: 'GTC',
      reduceOnly: false,
      leverage: 5,
      status: 'REJECTED',
      rejectReason: 'MAX_ORDER_NOTIONAL_EXCEEDED',
      createdAtUtc: new Date().toISOString(),
      updatedAtUtc: new Date().toISOString(),
      signalId: undefined,
    });

    const signal = await run(db, executor, 'OPEN_LONG', { features: { quantity: 9.803, leverage: 5 } });

    const row = db.signals.findById(signal.id);
    expect(row?.status).toBe('REJECTED');
    expect(row?.rejectReason).toBe('MAX_ORDER_NOTIONAL_EXCEEDED');
  });

  it('places a stop-loss bracket after opening', async () => {
    await run(db, executor, 'OPEN_LONG', { features: { quantity: 9.803, leverage: 5 } });

    const openOrders = broker.getOpenOrders();
    expect(openOrders.length).toBe(2);
    const stopOrder = openOrders.find((o) => o.type === 'STOP_MARKET');
    expect(stopOrder).toBeDefined();
    expect(stopOrder?.stopPrice).toBe(95);
    expect(stopOrder?.reduceOnly).toBe(true);

    const tpOrder = openOrders.find((o) => o.type === 'TAKE_PROFIT_MARKET');
    expect(tpOrder).toBeDefined();
    expect(tpOrder?.stopPrice).toBe(110);
    expect(tpOrder?.reduceOnly).toBe(true);
  });

  it('uses the quantity and leverage from signal.features, not a sizing engine', async () => {
    const signal = toSignal(
      parseSignalInput({
        strategyId: 'test',
        symbol: 'BTCUSDT',
        action: 'OPEN_LONG',
        confidence: 0.8,
        stopLossPrice: '95',
        features: { quantity: 0.25, leverage: 4 },
      })
    );
    db.signals.insert(signal);

    const result = await executor.execute(signal);

    expect(result).toBe(true);
    const position = broker.getPosition('BTCUSDT');
    expect(position?.qty).toBe(0.25);
    expect(position?.leverage).toBe(4);

    const stopOrder = broker.getOpenOrders()[0];
    expect(stopOrder?.quantity).toBe(0.25);
    expect(stopOrder?.leverage).toBe(4);
  });

  it('preserves strategyId and signalId on the submitted market order and fill', async () => {
    const signal = toSignal(
      parseSignalInput({
        strategyId: 'test-strategy-123',
        symbol: 'BTCUSDT',
        action: 'OPEN_LONG',
        confidence: 0.85,
        features: { quantity: 1.0, leverage: 3 },
      })
    );
    db.signals.insert(signal);

    const result = await executor.execute(signal);
    expect(result).toBe(true);

    const fills = broker.getFills();
    const openFill = fills.find((f) => f.symbol === 'BTCUSDT');
    expect(openFill).toBeDefined();
    expect(openFill?.strategyId).toBe('test-strategy-123');
    expect(openFill?.signalId).toBe(signal.id);
  });
});