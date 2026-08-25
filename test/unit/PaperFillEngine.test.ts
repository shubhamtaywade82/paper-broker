import { describe, it, expect } from 'vitest';
import { PaperFillEngine } from '../../src/broker/paper/PaperFillEngine.js';
import { DEFAULT_PAPER_CONFIG } from '../../src/broker/paper/SmcPaperBroker.js';
import type { PaperOrder } from '../../src/broker/paper/types.js';
import type { Candle } from '../../src/strategy/indicators.js';

function makeCandle(low: number, high: number, close = 100, openTime = 1700000000000): Candle {
  return {
    symbol: 'SOLUSDT',
    interval: '5m',
    openTime,
    closeTime: openTime + 300_000,
    open: 100,
    high,
    low,
    close,
    volume: 1000,
    isClosed: true,
  };
}

describe('Phase 8 — Paper Fill Engine', () => {
  it('fills BUY LIMIT when candle.low <= limitPrice', () => {
    const order: PaperOrder = {
      id: 'O1',
      clientOrderId: 'C1',
      symbol: 'SOLUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 10,
      filledQuantity: 0,
      price: 95.0,
      reduceOnly: false,
      status: 'NEW',
      createdAt: 100,
      updatedAt: 100,
      signalKey: 'k1',
      setupId: 's1',
      executionPlanId: 'p1',
    };

    const candle = makeCandle(94.5, 102.0);
    const fill = PaperFillEngine.evaluateOrderFill(order, candle, DEFAULT_PAPER_CONFIG);

    expect(fill).not.toBeNull();
    expect(fill?.price).toBe(95.0);
    expect(fill?.quantity).toBe(10);
    expect(fill?.isMaker).toBe(true);
  });

  it('does not fill BUY LIMIT when candle.low > limitPrice', () => {
    const order: PaperOrder = {
      id: 'O2',
      clientOrderId: 'C2',
      symbol: 'SOLUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 10,
      filledQuantity: 0,
      price: 95.0,
      reduceOnly: false,
      status: 'NEW',
      createdAt: 100,
      updatedAt: 100,
      signalKey: 'k2',
      setupId: 's2',
      executionPlanId: 'p2',
    };

    const candle = makeCandle(96.0, 102.0);
    const fill = PaperFillEngine.evaluateOrderFill(order, candle, DEFAULT_PAPER_CONFIG);
    expect(fill).toBeNull();
  });

  it('fills STOP order when price triggers stop threshold', () => {
    const order: PaperOrder = {
      id: 'O3',
      clientOrderId: 'C3',
      symbol: 'SOLUSDT',
      side: 'SELL',
      type: 'STOP',
      quantity: 10,
      filledQuantity: 0,
      stopPrice: 90.0,
      reduceOnly: true,
      status: 'NEW',
      createdAt: 100,
      updatedAt: 100,
      signalKey: 'k3',
      setupId: 's3',
      executionPlanId: 'p3',
    };

    const candle = makeCandle(89.0, 95.0);
    const fill = PaperFillEngine.evaluateOrderFill(order, candle, DEFAULT_PAPER_CONFIG);

    expect(fill).not.toBeNull();
    expect(fill?.price).toBe(90.0);
    expect(fill?.isMaker).toBe(false); // Stop orders are taker
  });
});
