import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Decimal } from 'decimal.js';
import {
  createLedger,
  createFillEngine,
  makeOrder,
  makeCandle,
  expectMoney,
  FEES,
} from './fixtures.js';

const tickArb = fc.integer({ min: 1_000, max: 100_000 });
const qtyArb = fc.integer({ min: 1, max: 50 });
const levArb = fc.integer({ min: 2, max: 20 });
const sideArb = fc.constantFrom<'LONG' | 'SHORT'>(['LONG', 'SHORT'] as const);

describe('Financial invariant properties', () => {
  it('P-1: equity conservation — final = initial + ΣgrossPnL − Σfees + Σfunding (random closed trades)', () => {
    const tradeArb = fc.record({
      side: sideArb,
      entry: tickArb,
      exit: tickArb,
      qty: qtyArb,
      fundingMicro: fc.integer({ min: -1000, max: 1000 }),
    });

    fc.assert(
      fc.property(fc.array(tradeArb, { minLength: 1, maxLength: 50 }), (trades) => {
        const ledger = createLedger({ initialBalance: 1_000_000 });
        let expected = new Decimal(1_000_000);

        for (const t of trades) {
          const entry = t.entry / 100;
          const exit = t.exit / 100;
          const funding = t.fundingMicro / 1_000_000;
          const pos = ledger.openPosition({
            symbol: 'BTCUSDT',
            side: t.side,
            entryPrice: entry,
            quantity: t.qty,
            leverage: 1,
          });
          ledger.applyFunding(pos.id, funding);
          ledger.closePosition(pos.id, exit, 'manual');

          const gross =
            t.side === 'LONG'
              ? new Decimal(exit).minus(entry).times(t.qty)
              : new Decimal(entry).minus(exit).times(t.qty);
          const openFee = new Decimal(entry).times(t.qty).times(FEES.takerBps).div(10_000).toDecimalPlaces(4);
          const closeFee = new Decimal(exit).times(t.qty).times(FEES.takerBps).div(10_000).toDecimalPlaces(4);
          const fees = openFee.plus(closeFee);
          const fundingDelta = t.side === 'SHORT' ? funding : -funding;
          expected = expected.plus(gross).minus(fees).plus(fundingDelta);
        }

        expectMoney(ledger.getEquity(), expected, 1e-4);
      }),
      { numRuns: 200 }
    );
  });

  it('P-2: liquidation ordering — survives half-way to bankruptcy, liquidates past it', () => {
    fc.assert(
      fc.property(sideArb, tickArb, levArb, (side, entryTicks, lev) => {
        const entry = entryTicks / 100;
        const ledger = createLedger({ initialBalance: 1_000_000 });
        const pos = ledger.openPosition({
          symbol: 'X',
          side,
          entryPrice: entry,
          quantity: 1,
          leverage: lev,
        });

        const dir = side === 'LONG' ? -1 : 1;
        ledger.markPrice(pos.id, entry * (1 + (dir * 0.5) / lev));
        expect(ledger.getPosition(pos.id).status).not.toBe('LIQUIDATED');

        ledger.markPrice(pos.id, entry * (1 + (dir * 1.5) / lev));
        expect(ledger.getPosition(pos.id).status).toBe('LIQUIDATED');
      }),
      { numRuns: 100 }
    );
  });

  it('P-3: isolated-margin loss cap holds under catastrophic gaps (both sides)', () => {
    fc.assert(
      fc.property(sideArb, tickArb, levArb, (side, entryTicks, lev) => {
        const entry = entryTicks / 100;
        const ledger = createLedger({ initialBalance: 1_000_000 });
        const pos = ledger.openPosition({
          symbol: 'X',
          side,
          entryPrice: entry,
          quantity: 1,
          leverage: lev,
        });
        const catastrophe = side === 'LONG' ? entry * 0.1 : entry * 3;
        ledger.markPrice(pos.id, catastrophe);

        const p = ledger.getPosition(pos.id);
        expect(p.status).toBe('LIQUIDATED');
        const loss = new Decimal(-(p.realizedPnl ?? 0));
        const cap = new Decimal(p.margin).plus(catastrophe * 0.005 + 1.0);
        if (loss.gt(cap)) {
          throw new Error(`Loss cap violated: ${loss} > ${cap} (${side}, lev=${lev})`);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('P-4: MFE/MAE never regress over random price paths', () => {
    fc.assert(
      fc.property(
        sideArb,
        tickArb,
        fc.array(fc.integer({ min: -500, max: 500 }), { minLength: 5, maxLength: 30 }),
        (side, entryTicks, moves) => {
          const entry = entryTicks / 100;
          const ledger = createLedger({ initialBalance: 1_000_000 });
          const pos = ledger.openPosition({
            symbol: 'X',
            side,
            entryPrice: entry,
            quantity: 1,
            leverage: 1,
          });
          let price = entry;
          let prevMfe = 0;
          let prevMae = 0;
          for (const m of moves) {
            price = Math.max(1, price + m / 100);
            ledger.markPrice(pos.id, price);
            const p = ledger.getPosition(pos.id);
            if (p.mfe < prevMfe - 1e-9 || p.mae < prevMae - 1e-9) {
              throw new Error(`Excursion regression at price ${price}`);
            }
            prevMfe = p.mfe;
            prevMae = p.mae;
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('P-5: R-multiple bounds — stop-out = exactly −1R, TP = exactly design RR (zero slippage)', () => {
    fc.assert(
      fc.property(
        tickArb,
        fc.integer({ min: 10, max: 200 }),
        fc.integer({ min: 10, max: 200 }),
        (entryTicks, riskTicks, rewardTicks) => {
          const entry = entryTicks / 100;
          const risk = riskTicks / 100;
          const reward = rewardTicks / 100;
          const ledger = createLedger({ initialBalance: 1_000_000 });

          // SHORT: stop above, TP below
          const shortPos = ledger.openPosition({
            symbol: 'X',
            side: 'SHORT',
            entryPrice: entry,
            quantity: 1,
            leverage: 10,
            stopLoss: entry + risk,
            takeProfit: entry - reward,
          });
          ledger.closePosition(shortPos.id, entry + risk, 'stop_loss');
          const shortStopPnl = ledger.getPosition(shortPos.id).realizedPnl ?? 0;
          expectMoney(shortStopPnl / risk, -1);

          // LONG mirror
          const longPos = ledger.openPosition({
            symbol: 'X',
            side: 'LONG',
            entryPrice: entry,
            quantity: 1,
            leverage: 10,
            stopLoss: entry - risk,
            takeProfit: entry + reward,
          });
          ledger.closePosition(longPos.id, entry - risk, 'stop_loss');
          const longStopPnl = ledger.getPosition(longPos.id).realizedPnl ?? 0;
          expectMoney(longStopPnl / risk, -1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('P-6: slippage invariant — BUY fills >= trigger, SELL fills <= trigger (random candles)', () => {
    const candleArb = fc
      .record({
        o: tickArb,
        up: fc.integer({ min: 0, max: 500 }),
        down: fc.integer({ min: 0, max: 500 }),
      })
      .map(({ o, up, down }) =>
        makeCandle({
          open: o / 100,
          high: (o + up) / 100,
          low: (o - down) / 100,
          close: o / 100,
        })
      );

    fc.assert(
      fc.property(candleArb, fc.integer({ min: -500, max: 500 }), (candle, stopOffsetTicks) => {
        const engine = createFillEngine({ slippageBps: 10 });
        const oTicks = Math.round(candle.open * 100);
        const stop = (oTicks + stopOffsetTicks) / 100;
        if (stop < candle.low || stop > candle.high) return;

        const buy = engine.processCandle(
          makeOrder({ side: 'BUY', type: 'STOP', stopPrice: stop, quantity: 1 }),
          candle
        );
        if (buy && buy.price < stop - 1e-9) {
          throw new Error(`BUY stop fill ${buy.price} improved on trigger ${stop}`);
        }

        const sell = engine.processCandle(
          makeOrder({ side: 'SELL', type: 'STOP', stopPrice: stop, quantity: 1 }),
          candle
        );
        if (sell && sell.price > stop + 1e-9) {
          throw new Error(`SELL stop fill ${sell.price} improved on trigger ${stop}`);
        }
      }),
      { numRuns: 300 }
    );
  });
});
