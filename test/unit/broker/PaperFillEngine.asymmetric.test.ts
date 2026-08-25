import { describe, it, expect, beforeEach } from 'vitest';
import {
  createFillEngine,
  makeCandle,
  makeOrder,
  expectFill,
  expectNoFill,
  expectMoney,
} from './fixtures.js';

// Every trigger level below is chosen so the LONG rule and the
// SHORT rule give OPPOSITE answers on this candle.
const CANDLE = makeCandle({ open: 100, high: 105, low: 97, close: 103 });

describe('PaperFillEngine — asymmetric fill matrix', () => {
  // Zero slippage so fill prices assert exactly; direction tests live in the gaps suite.
  let engine: ReturnType<typeof createFillEngine>;
  beforeEach(() => {
    engine = createFillEngine({ slippageBps: 0 });
  });

  describe('positive fills', () => {
    it('FILL-01: BUY LIMIT (long entry) fills at limit when low <= price', () => {
      const fill = expectFill(
        engine.processCandle(
          makeOrder({ side: 'BUY', type: 'LIMIT', price: 98, quantity: 1 }),
          CANDLE
        )
      );
      expectMoney(fill.price, 98);
      expect(fill.role).toBe('maker');
    });

    it('FILL-02: SELL LIMIT (SHORT entry) fills at limit when high >= price', () => {
      const fill = expectFill(
        engine.processCandle(
          makeOrder({ side: 'SELL', type: 'LIMIT', price: 104, quantity: 1 }),
          CANDLE
        )
      );
      expectMoney(fill.price, 104);
      expect(fill.role).toBe('maker');
    });

    it('FILL-03: BUY STOP (SHORT stop-loss / breakout) triggers when high >= stop', () => {
      const fill = expectFill(
        engine.processCandle(
          makeOrder({ side: 'BUY', type: 'STOP', stopPrice: 103, quantity: 1 }),
          CANDLE
        )
      );
      expectMoney(fill.price, 103);
      expect(fill.role).toBe('taker');
    });

    it('FILL-04: SELL STOP (long stop-loss) triggers when low <= stop', () => {
      const fill = expectFill(
        engine.processCandle(
          makeOrder({ side: 'SELL', type: 'STOP', stopPrice: 99, quantity: 1 }),
          CANDLE
        )
      );
      expectMoney(fill.price, 99);
      expect(fill.role).toBe('taker');
    });

    it('FILL-05: TAKE_PROFIT BUY (SHORT TP limit) fills when low <= tp', () => {
      const fill = expectFill(
        engine.processCandle(
          makeOrder({ side: 'BUY', type: 'TAKE_PROFIT', price: 98, quantity: 1, reduceOnly: true }),
          CANDLE
        )
      );
      expectMoney(fill.price, 98);
      expect(fill.role).toBe('maker');
    });

    it('FILL-06: TAKE_PROFIT SELL (long TP limit) fills when high >= tp', () => {
      const fill = expectFill(
        engine.processCandle(
          makeOrder({ side: 'SELL', type: 'TAKE_PROFIT', price: 104, quantity: 1, reduceOnly: true }),
          CANDLE
        )
      );
      expectMoney(fill.price, 104);
      expect(fill.role).toBe('maker');
    });

    it('FILL-07: TAKE_PROFIT_MARKET BUY (SHORT TP market) triggers when low <= tp', () => {
      const fill = expectFill(
        engine.processCandle(
          makeOrder({ side: 'BUY', type: 'TAKE_PROFIT_MARKET', stopPrice: 98, quantity: 1, reduceOnly: true }),
          CANDLE
        )
      );
      expectMoney(fill.price, 98);
      expect(fill.role).toBe('taker');
    });

    it('FILL-08: TAKE_PROFIT_MARKET SELL (long TP market) triggers when high >= tp', () => {
      const fill = expectFill(
        engine.processCandle(
          makeOrder({ side: 'SELL', type: 'TAKE_PROFIT_MARKET', stopPrice: 104, quantity: 1, reduceOnly: true }),
          CANDLE
        )
      );
      expectMoney(fill.price, 104);
      expect(fill.role).toBe('taker');
    });
  });

  describe('no-fill boundaries', () => {
    it('FILL-09: BUY LIMIT @96 stays resting (low 97 > 96)', () => {
      expectNoFill(
        engine.processCandle(
          makeOrder({ side: 'BUY', type: 'LIMIT', price: 96, quantity: 1 }),
          CANDLE
        )
      );
    });

    it('FILL-10: SELL LIMIT @106 stays resting (high 105 < 106)', () => {
      expectNoFill(
        engine.processCandle(
          makeOrder({ side: 'SELL', type: 'LIMIT', price: 106, quantity: 1 }),
          CANDLE
        )
      );
    });

    it('FILL-11: BUY STOP @106 not triggered (high 105 < 106)', () => {
      expectNoFill(
        engine.processCandle(
          makeOrder({ side: 'BUY', type: 'STOP', stopPrice: 106, quantity: 1 }),
          CANDLE
        )
      );
    });

    it('FILL-12: SELL STOP @96 not triggered (low 97 > 96)', () => {
      expectNoFill(
        engine.processCandle(
          makeOrder({ side: 'SELL', type: 'STOP', stopPrice: 96, quantity: 1 }),
          CANDLE
        )
      );
    });
  });

  describe('inversion guards', () => {
    it('FILL-13: SELL STOP must NOT trigger on high >= stop when low > stop', () => {
      const candle = makeCandle({ open: 101, high: 103, low: 101, close: 102 });
      expectNoFill(
        engine.processCandle(
          makeOrder({ side: 'SELL', type: 'STOP', stopPrice: 100.5, quantity: 1 }),
          candle
        )
      );
    });

    it('FILL-14: BUY STOP must NOT trigger on low <= stop when high < stop', () => {
      const candle = makeCandle({ open: 98, high: 99.5, low: 97, close: 99 });
      expectNoFill(
        engine.processCandle(
          makeOrder({ side: 'BUY', type: 'STOP', stopPrice: 101, quantity: 1 }),
          candle
        )
      );
    });

    it('FILL-15: BUY LIMIT must NOT fill on high >= price when low > price', () => {
      const candle = makeCandle({ open: 101, high: 103, low: 101, close: 102 });
      expectNoFill(
        engine.processCandle(
          makeOrder({ side: 'BUY', type: 'LIMIT', price: 100.5, quantity: 1 }),
          candle
        )
      );
    });

    it('FILL-16: SELL LIMIT must NOT fill on low <= price when high < price', () => {
      const candle = makeCandle({ open: 103, high: 104, low: 102, close: 103.5 });
      expectNoFill(
        engine.processCandle(
          makeOrder({ side: 'SELL', type: 'LIMIT', price: 104.5, quantity: 1 }),
          candle
        )
      );
    });
  });
});
