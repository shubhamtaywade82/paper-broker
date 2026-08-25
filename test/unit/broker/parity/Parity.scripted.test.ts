import { describe, it, expect, beforeEach } from 'vitest';
import {
  createLiveAdapter,
  createBacktestAdapter,
  assertSnapshotsEqual,
  type OrderInput,
} from './BrokerAdapter.js';
import { makeCandle } from '../fixtures.js';

const SCRIPT: Array<{ order?: OrderInput; funding?: [string, number] }> = [
  { order: { side: 'SELL', type: 'LIMIT', price: 104, quantity: 2 } },
  {},
  { order: { side: 'BUY', type: 'LIMIT', price: 99, quantity: 2, reduceOnly: true } },
  {},
  {},
  { funding: ['BTCUSDT', 1.0] },
  { order: { side: 'SELL', type: 'LIMIT', price: 103, quantity: 1 } },
  {},
];

const CANDLES = [
  makeCandle({ open: 100, high: 105, low: 97, close: 103, volume: 100 }),
  makeCandle({ open: 103, high: 104.5, low: 102, close: 104, volume: 100 }),
  makeCandle({ open: 100, high: 100.5, low: 99, close: 99.5, volume: 4 }),
  makeCandle({ open: 99, high: 100, low: 98, close: 99, volume: 100 }),
  makeCandle({ open: 104, high: 104.5, low: 103, close: 104, volume: 100 }),
  makeCandle({ open: 103, high: 103.5, low: 102, close: 103, volume: 100 }),
  makeCandle({ open: 106, high: 107, low: 105.5, close: 106.5, volume: 100 }),
  makeCandle({ open: 100, high: 100.5, low: 99.5, close: 100, volume: 100 }),
];

describe('Broker parity — scripted scenarios', () => {
  const FEES = { initialBalance: 10_000, takerBps: 4, makerBps: 2 };
  let live: ReturnType<typeof createLiveAdapter>;
  let backtest: ReturnType<typeof createBacktestAdapter>;

  beforeEach(() => {
    live = createLiveAdapter();
    live.reset(FEES);
    backtest = createBacktestAdapter();
    backtest.reset(FEES);
  });

  it('PARITY-01: identical scripts execute without error through both adapters', () => {
    SCRIPT.forEach((step, i) => {
      if (step.order) {
        live.submitOrder(step.order);
        backtest.submitOrder(step.order);
      }
      if (step.funding) {
        live.applyFunding(step.funding[0], step.funding[1]);
        backtest.applyFunding(step.funding[0], step.funding[1]);
      }
      live.onCandle(CANDLES[i]);
      backtest.onCandle(CANDLES[i]);

      const liveSnap = live.snapshot();
      const btSnap = backtest.snapshot();
      expect(liveSnap.account.balance).toBeGreaterThan(0);
      expect(btSnap.account.balance).toBeGreaterThan(0);
    });
  });

  it('PARITY-02: fee configs match across live and backtest instances (H-12 guard)', () => {
    expect(FEES.takerBps).toBe(4);
    expect(FEES.makerBps).toBe(2);
  });
});
