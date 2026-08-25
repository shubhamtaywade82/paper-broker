import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { makeCandle } from '../fixtures.js';
import {
  createLiveAdapter,
  createBacktestAdapter,
  type OrderInput,
} from './BrokerAdapter.js';

const FEES = { initialBalance: 10_000, takerBps: 4, makerBps: 2 };

const sideArb = fc.constantFrom<'BUY' | 'SELL'>(['BUY', 'SELL'] as const);
const typeArb = fc.constantFrom<'LIMIT' | 'STOP' | 'TAKE_PROFIT_MARKET'>(
  ['LIMIT', 'STOP', 'TAKE_PROFIT_MARKET'] as const
);

const stepArb = fc.record({
  hasOrder: fc.boolean(),
  order: fc.record({
    side: sideArb,
    type: typeArb,
    offset: fc.integer({ min: -60, max: 60 }),
    qty: fc.integer({ min: 1, max: 5 }),
  }),
  candleUp: fc.integer({ min: 0, max: 80 }),
  candleDown: fc.integer({ min: 0, max: 80 }),
  fundingBps: fc.integer({ min: -3, max: 3 }),
});

describe('Broker parity — randomized differential testing', () => {
  it('PARITY-R1: random scripts process successfully in parallel', () => {
    fc.assert(
      fc.property(
        fc.array(stepArb, { minLength: 2, maxLength: 20 }),
        fc.integer({ min: 1, max: 1000 }),
        (steps, seed) => {
          const live = createLiveAdapter();
          live.reset(FEES);
          const backtest = createBacktestAdapter();
          backtest.reset(FEES);

          let priceTicks = 1000 + (seed % 100);
          steps.forEach((s) => {
            if (s.hasOrder) {
              const o: OrderInput = {
                side: s.order.side,
                type: s.order.type,
                quantity: s.order.qty,
                price: (priceTicks + s.order.offset) / 10,
                stopPrice: (priceTicks + s.order.offset) / 10,
              };
              live.submitOrder(o);
              backtest.submitOrder(o);
            }
            const open = priceTicks / 10;
            const candle = makeCandle({
              open,
              high: (priceTicks + s.candleUp) / 10,
              low: (priceTicks - s.candleDown) / 10,
              close: (priceTicks + Math.floor((s.candleUp - s.candleDown) / 2)) / 10,
              volume: 1000,
            });
            live.onCandle(candle);
            backtest.onCandle(candle);
            if (s.fundingBps !== 0) {
              live.applyFunding('BTCUSDT', s.fundingBps);
              backtest.applyFunding('BTCUSDT', s.fundingBps);
            }
            priceTicks += Math.floor((s.candleUp - s.candleDown) / 2);
          });

          const liveSnap = live.snapshot();
          const btSnap = backtest.snapshot();
          expect(liveSnap.account.balance).toBeGreaterThan(0);
          expect(btSnap.account.balance).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
