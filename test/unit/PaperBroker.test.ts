import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaperBroker } from '../../src/broker/PaperBroker.js';
import type { Instrument, OrderEventSink } from '../../src/broker/types.js';

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

function createBroker() {
  return new PaperBroker({
    dataDir: '/tmp/paper-broker-test',
    accountId: 'test-account',
    startingUsdt: 10000,
    instruments: [BTC],
    takerFeeRate: 0.0004,
    makerFeeRate: 0.0002,
  });
}

describe('PaperBroker', () => {
  let broker: PaperBroker;

  beforeEach(() => {
    broker = createBroker();
  });

  it('starts with the configured balance', () => {
    const account = broker.getAccount();
    expect(account.walletBalance).toBe(10000);
    expect(account.equity).toBe(10000);
    expect(account.availableBalance).toBe(10000);
  });

  it('rejects orders for unknown symbols', () => {
    expect(() =>
      broker.submitOrder({
        symbol: 'FAKEUSDT',
        side: 'BUY',
        type: 'MARKET',
        quantity: 1,
      })
    ).toThrow('Unknown instrument');
  });

  it('rejects orders when no market data is available', () => {
    const order = broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 1,
    });
    expect(order.status).toBe('REJECTED');
    expect(order.rejectReason).toBe('NO_MARKET_STATE');
  });

  it('opens a long position and realizes the fee', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      localTsUtc: Date.now(),
      stale: false,
    });

    const order = broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.1,
      leverage: 5,
    });

    expect(order.status).toBe('FILLED');

    const position = broker.getPosition('BTCUSDT');
    expect(position?.qty).toBeCloseTo(0.1, 10);
    expect(position?.entryPrice).toBeCloseTo(100.12, 2); // ask 100.1 + 2bps slippage

    const account = broker.getAccount();
    expect(account.walletBalance).toBeCloseTo(10000 - 0.1 * 100.12 * 0.0004, 6);
    expect(account.openPositionsCount).toBe(1);
  });

  it('closes a position and realizes PnL', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      localTsUtc: Date.now(),
      stale: false,
    });

    broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.1,
      leverage: 5,
    });

    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 110,
      ask: 110.1,
      last: 110.05,
      mark: 110,
      localTsUtc: Date.now(),
      stale: false,
    });

    const close = broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'SELL',
      type: 'MARKET',
      quantity: 0.1,
      reduceOnly: true,
      leverage: 5,
    });

    expect(close.status).toBe('FILLED');

    const position = broker.getPosition('BTCUSDT');
    expect(position?.qty).toBe(0);

    const account = broker.getAccount();
    expect(account.totalRealizedPnl).toBeGreaterThan(0);
    expect(account.openPositionsCount).toBe(1); // position record stays (qty 0)
  });

  it('rejects reduce-only orders that would increase position', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      localTsUtc: Date.now(),
      stale: false,
    });

    broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.1,
      leverage: 5,
    });

    const bad = broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.1,
      reduceOnly: true,
      leverage: 5,
    });

    expect(bad.status).toBe('REJECTED');
    expect(bad.rejectReason).toBe('REDUCE_ONLY_WOULD_INCREASE');
  });

  it('rejects orders exceeding max notional', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      localTsUtc: Date.now(),
      stale: false,
    });

    const order = broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 100, // 100 * 100 = 10000 > maxOrderNotional 5000
      leverage: 5,
    });

    expect(order.status).toBe('REJECTED');
    expect(order.rejectReason).toBe('MAX_ORDER_NOTIONAL_EXCEEDED');
  });

  it('places a limit order that rests and fills later', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      localTsUtc: Date.now(),
      stale: false,
    });

    const limit = broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 0.06,
      price: 99,
      leverage: 5,
    });

    expect(limit.status).toBe('NEW');
    expect(broker.getOpenOrders().length).toBe(1);

    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 98,
      ask: 98.5,
      last: 98.2,
      mark: 98.3,
      localTsUtc: Date.now(),
      stale: false,
    });

    expect(limit.status).toBe('FILLED');
    expect(broker.getPosition('BTCUSDT')?.qty).toBeCloseTo(0.06, 10);
  });

  it('cancels open orders', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      localTsUtc: Date.now(),
      stale: false,
    });

    const limit = broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 0.06,
      price: 99,
      leverage: 5,
    });

    broker.cancelOrder(limit.id);
    expect(limit.status).toBe('CANCELED');
    expect(broker.getOpenOrders().length).toBe(0);
  });

  it('applies funding to open positions', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      fundingRate: 0.001,
      nextFundingTimeUtc: String(Date.now() + 3600000),
      localTsUtc: Date.now(),
      stale: false,
    });

    broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.1,
      leverage: 5,
    });

    broker.applyFunding();

    // funding payment = qty * mark * rate = 0.1 * 100 * 0.001 = 0.01 (long pays positive rate)
    expect(broker.getAccount().totalFunding).toBeCloseTo(0.01, 8);
  });

  it('emits order, fill, and position events to the event sink', () => {
    const sink: OrderEventSink = {
      appendOrderEvent: vi.fn(),
      appendFill: vi.fn(),
      appendPositionEvent: vi.fn(),
      appendFundingPayment: vi.fn(),
    };

    const brokerWithSink = new PaperBroker({
      dataDir: '/tmp/paper-broker-test',
      accountId: 'test-account',
      startingUsdt: 10000,
      instruments: [BTC],
      eventLog: sink,
    });

    brokerWithSink.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      localTsUtc: Date.now(),
      stale: false,
    });

    brokerWithSink.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.1,
      leverage: 5,
    });

    expect(sink.appendOrderEvent).toHaveBeenCalled();
    expect(sink.appendFill).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'BTCUSDT', side: 'BUY' })
    );
    expect(sink.appendPositionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'OPEN', qtyAfter: 0.1 })
    );
  });

  it('records correct position qty before/after on fills', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      localTsUtc: Date.now(),
      stale: false,
    });

    broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.1,
      leverage: 5,
    });

    const fill = broker.getFills()[0];
    expect(fill?.positionQtyBefore).toBe(0);
    expect(fill?.positionQtyAfter).toBeCloseTo(0.1, 10);
    expect(fill?.positionEntryAfter).toBeCloseTo(100.12, 2);
  });

  it('accumulates per-position fees across fills', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      localTsUtc: Date.now(),
      stale: false,
    });

    broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.1,
      leverage: 5,
    });
    broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.1,
      leverage: 5,
    });

    const fees = broker.getFills().reduce((sum, f) => sum + f.fee, 0);
    expect(broker.getPosition('BTCUSDT')?.totalFees).toBeCloseTo(fees, 10);
    expect(broker.getPosition('BTCUSDT')?.qty).toBeCloseTo(0.2, 10);
  });
});