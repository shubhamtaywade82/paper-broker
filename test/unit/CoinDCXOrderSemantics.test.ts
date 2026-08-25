import { describe, it, expect, vi } from 'vitest';
import { CoinDCXBroker } from '../../src/coindcx/CoinDCXBroker.js';
import type { CoinDCXClient } from '@nemesis-oss/coindcx-sdk';

/**
 * These cover the three order-semantics bugs that could only ever surface
 * against a real venue, since PaperBroker models all three correctly.
 */
function makeClient(positions: Array<Record<string, unknown>> = []) {
  const createOrder = vi.fn().mockResolvedValue({ id: 'cdx-1' });
  const createTPSL = vi.fn().mockResolvedValue({ ok: true });
  const exitPosition = vi.fn().mockResolvedValue({ ok: true });
  const getPositions = vi.fn().mockResolvedValue(positions);

  const client = {
    futures: {
      trading: {
        createOrder,
        createTPSL,
        exitPosition,
        getPositions,
        cancelOrder: vi.fn(),
        cancelAllOrders: vi.fn(),
      },
      account: { getWallet: vi.fn().mockResolvedValue({ balance: 1000 }) },
    },
  } as unknown as CoinDCXClient;

  return { client, createOrder, createTPSL, exitPosition, getPositions };
}

const OPEN_LONG = [{ id: 'pos-1', pair: 'B-SOL_USDT', side: 'long', size: 5, entry_price: 100 }];

describe('CoinDCXBroker — take-profit brackets', () => {
  it('never submits a TAKE_PROFIT_MARKET as an immediate market order', async () => {
    const { client, createOrder, createTPSL } = makeClient(OPEN_LONG);
    const broker = new CoinDCXBroker({ client });

    const order = await broker.submitOrder({
      symbol: 'SOLUSDT',
      side: 'SELL',
      type: 'TAKE_PROFIT_MARKET',
      quantity: 5,
      stopPrice: 120,
      reduceOnly: true,
    });

    // The bug: this used to fall through to createOrder as a market_order,
    // closing the position the instant it opened.
    expect(createOrder).not.toHaveBeenCalled();
    expect(createTPSL).toHaveBeenCalledWith({
      position_id: 'pos-1',
      stop_loss: undefined,
      take_profit: 120,
    });
    expect(order.status).toBe('NEW');
  });

  it('routes a stop bracket to stop_loss, not take_profit', async () => {
    const { client, createTPSL } = makeClient(OPEN_LONG);
    const broker = new CoinDCXBroker({ client });

    await broker.submitOrder({
      symbol: 'SOLUSDT',
      side: 'SELL',
      type: 'STOP_MARKET',
      quantity: 5,
      stopPrice: 90,
      reduceOnly: true,
    });

    expect(createTPSL).toHaveBeenCalledWith({
      position_id: 'pos-1',
      stop_loss: 90,
      take_profit: undefined,
    });
  });

  it('rejects a bracket when no position is open', async () => {
    const { client, createTPSL } = makeClient([]);
    const broker = new CoinDCXBroker({ client });

    const order = await broker.submitOrder({
      symbol: 'SOLUSDT',
      side: 'SELL',
      type: 'TAKE_PROFIT_MARKET',
      quantity: 5,
      stopPrice: 120,
      reduceOnly: true,
    });

    expect(order.status).toBe('REJECTED');
    expect(order.rejectReason).toContain('NO_OPEN_POSITION');
    expect(createTPSL).not.toHaveBeenCalled();
  });

  it('rejects a bracket with no trigger price', async () => {
    const { client, createTPSL } = makeClient(OPEN_LONG);
    const broker = new CoinDCXBroker({ client });

    const order = await broker.submitOrder({
      symbol: 'SOLUSDT',
      side: 'SELL',
      type: 'STOP_MARKET',
      quantity: 5,
      reduceOnly: true,
    });

    expect(order.status).toBe('REJECTED');
    expect(order.rejectReason).toContain('MISSING_TRIGGER_PRICE');
    expect(createTPSL).not.toHaveBeenCalled();
  });

  it('rejects a stop used as an entry rather than a reduce-only bracket', async () => {
    const { client } = makeClient(OPEN_LONG);
    const broker = new CoinDCXBroker({ client });

    const order = await broker.submitOrder({
      symbol: 'SOLUSDT',
      side: 'BUY',
      type: 'STOP_MARKET',
      quantity: 5,
      stopPrice: 110,
    });

    expect(order.status).toBe('REJECTED');
    expect(order.rejectReason).toContain('UNSUPPORTED_ENTRY_ORDER_TYPE');
  });
});

describe('CoinDCXBroker — reduce-only closes', () => {
  it('closes through exitPosition, not an unflagged createOrder', async () => {
    const { client, createOrder, exitPosition } = makeClient(OPEN_LONG);
    const broker = new CoinDCXBroker({ client });

    const order = await broker.submitOrder({
      symbol: 'SOLUSDT',
      side: 'SELL',
      type: 'MARKET',
      quantity: 5,
      reduceOnly: true,
    });

    // createOrder has no reduce_only field, so routing a close through it
    // would open a new short once the position was already flat.
    expect(createOrder).not.toHaveBeenCalled();
    expect(exitPosition).toHaveBeenCalledWith({ pair: 'B-SOL_USDT' });
    expect(order.status).toBe('NEW');
  });

  it('rejects a reduce-only order when flat rather than opening a new position', async () => {
    const { client, createOrder, exitPosition } = makeClient([]);
    const broker = new CoinDCXBroker({ client });

    const order = await broker.submitOrder({
      symbol: 'SOLUSDT',
      side: 'SELL',
      type: 'MARKET',
      quantity: 5,
      reduceOnly: true,
    });

    expect(order.status).toBe('REJECTED');
    expect(order.rejectReason).toContain('NO_OPEN_POSITION');
    expect(createOrder).not.toHaveBeenCalled();
    expect(exitPosition).not.toHaveBeenCalled();
  });

  it('refuses a partial reduce rather than closing the whole position', async () => {
    const { client, exitPosition } = makeClient(OPEN_LONG);
    const broker = new CoinDCXBroker({ client });

    const order = await broker.submitOrder({
      symbol: 'SOLUSDT',
      side: 'SELL',
      type: 'MARKET',
      quantity: 2, // position is 5
      reduceOnly: true,
    });

    expect(order.status).toBe('REJECTED');
    expect(order.rejectReason).toContain('PARTIAL_REDUCE_ONLY_UNSUPPORTED');
    expect(exitPosition).not.toHaveBeenCalled();
  });
});

describe('CoinDCXBroker — entries', () => {
  it('submits a MARKET entry with no bracket fields set', async () => {
    const { client, createOrder } = makeClient([]);
    const broker = new CoinDCXBroker({ client });

    await broker.submitOrder({ symbol: 'SOLUSDT', side: 'BUY', type: 'MARKET', quantity: 5 });

    expect(createOrder).toHaveBeenCalledTimes(1);
    const payload = createOrder.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.order_type).toBe('market_order');
    expect(payload.base_currency).toBe('SOL');
    expect(payload.take_profit).toBeUndefined();
  });

  it('attaches an entry-carried stop atomically rather than dropping it', async () => {
    const { client, createOrder } = makeClient([]);
    const broker = new CoinDCXBroker({ client });

    await broker.submitOrder({
      symbol: 'SOLUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 5,
      price: 100,
      stopPrice: 95,
    });

    const payload = createOrder.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.stop_loss).toBe(95);
  });

  it('rejects a LIMIT entry with no price instead of sending an invalid payload', async () => {
    const { client, createOrder } = makeClient([]);
    const broker = new CoinDCXBroker({ client });

    const order = await broker.submitOrder({
      symbol: 'SOLUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 5,
    });

    expect(order.status).toBe('REJECTED');
    expect(order.rejectReason).toContain('MISSING_LIMIT_PRICE');
    expect(createOrder).not.toHaveBeenCalled();
  });
});
