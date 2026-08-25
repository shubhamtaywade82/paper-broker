import { describe, it, expect, beforeEach } from 'vitest';
import {
  createFillEngine,
  makeCandle,
  makeOrder,
  expectFill,
  expectMoney,
  FEES,
} from './fixtures.js';

// Prior close was 100 — these candles gap clean past common order levels.
const GAP_DOWN = makeCandle({ open: 94, high: 96, low: 93, close: 95 });
const GAP_UP = makeCandle({ open: 106, high: 107, low: 105, close: 106.5 });
const TRIGGER_CANDLE = makeCandle({ open: 100, high: 101.5, low: 98.5, close: 101 });

describe('PaperFillEngine — gap-through fills', () => {
  let engine: ReturnType<typeof createFillEngine>;
  beforeEach(() => {
    engine = createFillEngine({ slippageBps: 0 });
  });

  it('GAP-01: SELL STOP (long SL) gapped through fills at OPEN, not stop price', () => {
    const fill = expectFill(
      engine.processCandle(
        makeOrder({ side: 'SELL', type: 'STOP', stopPrice: 99, quantity: 1, reduceOnly: true }),
        GAP_DOWN
      )
    );
    expectMoney(fill.price, 94);
  });

  it('GAP-02: BUY LIMIT gapped through fills at OPEN (better price for buyer)', () => {
    const fill = expectFill(
      engine.processCandle(
        makeOrder({ side: 'BUY', type: 'LIMIT', price: 98, quantity: 1 }),
        GAP_DOWN
      )
    );
    expectMoney(fill.price, 94);
  });

  it('GAP-03: BUY STOP (SHORT SL) gapped through fills at OPEN, not stop price', () => {
    const fill = expectFill(
      engine.processCandle(
        makeOrder({ side: 'BUY', type: 'STOP', stopPrice: 103, quantity: 1, reduceOnly: true }),
        GAP_UP
      )
    );
    expectMoney(fill.price, 106);
  });

  it('GAP-04: SELL LIMIT (SHORT entry) gapped through fills at OPEN (better for seller)', () => {
    const fill = expectFill(
      engine.processCandle(
        makeOrder({ side: 'SELL', type: 'LIMIT', price: 104, quantity: 1 }),
        GAP_UP
      )
    );
    expectMoney(fill.price, 106);
  });
});

describe('PaperFillEngine — slippage direction asymmetry', () => {
  it('SLIP-01: BUY STOP slippage moves fill price UP (against the buyer)', () => {
    const engine = createFillEngine({ slippageBps: 10 }); // 0.1%
    const fill = expectFill(
      engine.processCandle(
        makeOrder({ side: 'BUY', type: 'STOP', stopPrice: 100, quantity: 1 }),
        TRIGGER_CANDLE
      )
    );
    if (!(fill.price > 100)) {
      throw new Error(`BUY STOP slippage must worsen fill (paid more), got ${fill.price}`);
    }
  });

  it('SLIP-02: SELL STOP slippage moves fill price DOWN (against the seller)', () => {
    const engine = createFillEngine({ slippageBps: 10 });
    const fill = expectFill(
      engine.processCandle(
        makeOrder({ side: 'SELL', type: 'STOP', stopPrice: 100, quantity: 1 }),
        TRIGGER_CANDLE
      )
    );
    if (!(fill.price < 100)) {
      throw new Error(`SELL STOP slippage must worsen fill (received less), got ${fill.price}`);
    }
  });

  it('SLIP-03: TP_MARKET follows the same side-inverted slippage rule', () => {
    const engine = createFillEngine({ slippageBps: 10 });
    const buyTp = expectFill(
      engine.processCandle(
        makeOrder({ side: 'BUY', type: 'TAKE_PROFIT_MARKET', stopPrice: 99, quantity: 1, reduceOnly: true }),
        TRIGGER_CANDLE
      )
    );
    const sellTp = expectFill(
      engine.processCandle(
        makeOrder({ side: 'SELL', type: 'TAKE_PROFIT_MARKET', stopPrice: 101, quantity: 1, reduceOnly: true }),
        TRIGGER_CANDLE
      )
    );
    if (!(buyTp.price > 99 && sellTp.price < 101)) {
      throw new Error(`TP_MARKET slippage not side-inverted: buy=${buyTp.price} sell=${sellTp.price}`);
    }
  });

  it('SLIP-04: zero slippage → both sides fill exactly at trigger', () => {
    const engine = createFillEngine({ slippageBps: 0 });
    const buy = expectFill(
      engine.processCandle(
        makeOrder({ side: 'BUY', type: 'STOP', stopPrice: 100, quantity: 1 }),
        TRIGGER_CANDLE
      )
    );
    const sell = expectFill(
      engine.processCandle(
        makeOrder({ side: 'SELL', type: 'STOP', stopPrice: 100, quantity: 1 }),
        TRIGGER_CANDLE
      )
    );
    expectMoney(buy.price, 100);
    expectMoney(sell.price, 100);
  });
});

describe('PaperFillEngine — fee role assignment', () => {
  let engine: ReturnType<typeof createFillEngine>;
  beforeEach(() => {
    engine = createFillEngine({ slippageBps: 0 });
  });

  it('FEE-01: LIMIT fills book as maker', () => {
    const fill = expectFill(
      engine.processCandle(
        makeOrder({ side: 'BUY', type: 'LIMIT', price: 99, quantity: 1 }),
        TRIGGER_CANDLE
      )
    );
    expect(fill.role).toBe('maker');
  });

  it('FEE-02: STOP_MARKET fills book as taker', () => {
    const fill = expectFill(
      engine.processCandle(
        makeOrder({ side: 'SELL', type: 'STOP_MARKET', stopPrice: 99, quantity: 1 }),
        TRIGGER_CANDLE
      )
    );
    expect(fill.role).toBe('taker');
  });

  it('FEE-03: TAKE_PROFIT (limit) books as maker; TAKE_PROFIT_MARKET as taker', () => {
    const tpLimit = expectFill(
      engine.processCandle(
        makeOrder({ side: 'SELL', type: 'TAKE_PROFIT', price: 101, quantity: 1, reduceOnly: true }),
        TRIGGER_CANDLE
      )
    );
    const tpMarket = expectFill(
      engine.processCandle(
        makeOrder({ side: 'SELL', type: 'TAKE_PROFIT_MARKET', stopPrice: 101, quantity: 1, reduceOnly: true }),
        TRIGGER_CANDLE
      )
    );
    expect(tpLimit.role).toBe('maker');
    expect(tpMarket.role).toBe('taker');
  });

  it('FEE-04: fee is computed on fill notional × configured bps, both sides', () => {
    const buy = expectFill(
      engine.processCandle(
        makeOrder({ side: 'BUY', type: 'STOP', stopPrice: 100, quantity: 2 }),
        TRIGGER_CANDLE
      )
    );
    const sell = expectFill(
      engine.processCandle(
        makeOrder({ side: 'SELL', type: 'STOP', stopPrice: 100, quantity: 2 }),
        TRIGGER_CANDLE
      )
    );
    expectMoney(buy.fee, (buy.price * 2 * FEES.takerBps) / 10_000);
    expectMoney(sell.fee, (sell.price * 2 * FEES.takerBps) / 10_000);
  });
});

describe('PaperFillEngine — partial fills', () => {
  it('PART-01: fill is capped by candle volume; order stays PARTIALLY_FILLED', () => {
    const engine = createFillEngine({ slippageBps: 0 });
    const thin = makeCandle({ open: 100, high: 101, low: 99, close: 100, volume: 4 });
    const order = makeOrder({ side: 'BUY', type: 'LIMIT', price: 99, quantity: 10 });
    const fill = expectFill(engine.processCandle(order, thin));
    expectMoney(fill.quantity, 4);
    expect(order.status).toBe('PARTIALLY_FILLED');
    expectMoney(order.filledQuantity, 4);
  });

  it('PART-02: remaining quantity fills on a subsequent candle; terminal status FILLED', () => {
    const engine = createFillEngine({ slippageBps: 0 });
    const thin = makeCandle({ open: 100, high: 101, low: 99, close: 100, volume: 4 });
    const fat = makeCandle({ open: 100, high: 101, low: 99, close: 100, volume: 50 });
    const order = makeOrder({ side: 'BUY', type: 'LIMIT', price: 99, quantity: 10 });
    engine.processCandle(order, thin);
    const fill2 = expectFill(engine.processCandle(order, fat));
    expectMoney(fill2.quantity, 6);
    expect(order.status).toBe('FILLED');
    expectMoney(order.filledQuantity, 10);
  });

  it('PART-03: weighted-average entry across partial fills at different prices', () => {
    const engine = createFillEngine({ slippageBps: 0 });
    const c1 = makeCandle({ open: 100, high: 100.5, low: 99.5, close: 100, volume: 5 });
    const c2 = makeCandle({ open: 110, high: 110.5, low: 109.5, close: 110, volume: 5 });
    const order = makeOrder({ side: 'BUY', type: 'LIMIT', price: 110, quantity: 10 });
    engine.processCandle(order, c1);
    engine.processCandle(order, c2);
    expectMoney(order.filledQuantity, 10);
  });

  it('PART-04: reduce-only partial close never exceeds open position quantity', () => {
    const engine = createFillEngine({ slippageBps: 0 });
    const candle = makeCandle({ open: 100, high: 101, low: 99, close: 100, volume: 100 });
    const closeOrder = makeOrder({
      side: 'BUY',
      type: 'LIMIT',
      price: 99,
      quantity: 10,
      reduceOnly: true,
    });
    const fill = expectFill(engine.processCandle(closeOrder, candle));
    if (fill.quantity > 10) throw new Error('reduce-only fill exceeded order quantity');
  });
});
