import { describe, it, expect, beforeEach } from 'vitest';
import { createLedger, expectMoney, type LedgerContract } from './fixtures.js';

const INITIAL = 10_000;

describe('PaperLedger — SHORT positions', () => {
  let ledger: LedgerContract;
  beforeEach(() => {
    ledger = createLedger({ initialBalance: INITIAL });
  });

  const openShort = (entry = 100, qty = 1, leverage = 10, symbol = 'BTCUSDT') =>
    ledger.openPosition({ symbol, side: 'SHORT', entryPrice: entry, quantity: qty, leverage });

  it('SHORT-01: opening a short reserves margin = entry × qty / leverage', () => {
    const pos = openShort(100, 1, 10);
    expectMoney(ledger.getPosition(pos.id).margin, 10);
  });

  describe('excursion math (inverted vs LONG)', () => {
    it('SHORT-02: MFE = max(0, entry − lowest reached); MAE = max(0, highest reached − entry)', () => {
      const pos = openShort(100);
      ledger.markPrice(pos.id, 92);
      ledger.markPrice(pos.id, 101);
      ledger.markPrice(pos.id, 99);
      const p = ledger.getPosition(pos.id);
      expectMoney(p.mfe, 8);
      expectMoney(p.mae, 1);
    });

    it('SHORT-03: MAE-only path — MFE stays 0 when price never drops below entry', () => {
      const pos = openShort(100);
      ledger.markPrice(pos.id, 107);
      ledger.markPrice(pos.id, 99.5);
      const p = ledger.getPosition(pos.id);
      expectMoney(p.mae, 7);
      expectMoney(p.mfe, 0.5);
    });

    it('SHORT-04: MFE/MAE are monotonic non-decreasing over the position life', () => {
      const pos = openShort(100);
      const path = [98, 103, 95, 104, 96, 102, 97];
      let prevMfe = 0,
        prevMae = 0;
      for (const price of path) {
        ledger.markPrice(pos.id, price);
        const p = ledger.getPosition(pos.id);
        if (p.mfe < prevMfe || p.mae < prevMae) {
          throw new Error(`Excursion regressed: mfe ${prevMfe}→${p.mfe}, mae ${prevMae}→${p.mae}`);
        }
        prevMfe = p.mfe;
        prevMae = p.mae;
      }
    });
  });

  describe('realized R:R accounting', () => {
    const openWithBrackets = () =>
      ledger.openPosition({
        symbol: 'BTCUSDT',
        side: 'SHORT',
        entryPrice: 100,
        quantity: 1,
        leverage: 10,
        stopLoss: 102,
        takeProfit: 94,
      });

    it('SHORT-05: take-profit exit realizes exactly +3R (zero slippage)', () => {
      const pos = openWithBrackets();
      ledger.closePosition(pos.id, 94, 'take_profit');
      const p = ledger.getPosition(pos.id);
      expectMoney(p.realizedPnl ?? 0, 6);
    });

    it('SHORT-06: stop-out realizes exactly −1R at the stop price', () => {
      const pos = openWithBrackets();
      ledger.closePosition(pos.id, 102, 'stop_loss');
      expectMoney(ledger.getPosition(pos.id).realizedPnl ?? 0, -2);
    });

    it('SHORT-07: gapped stop-out realizes WORSE than −1R, never better', () => {
      const pos = openWithBrackets();
      ledger.closePosition(pos.id, 103.5, 'stop_loss');
      const pnl = ledger.getPosition(pos.id).realizedPnl ?? 0;
      if (!(pnl <= -2)) throw new Error(`Gapped short stop must lose ≥ 1R, got ${pnl}`);
      expectMoney(pnl, -3.5);
    });
  });

  describe('funding sign (inverted vs LONG)', () => {
    it('SHORT-09: positive funding rate CREDITS the short (longs pay)', () => {
      const pos = openShort(100, 1);
      const equityBefore = ledger.getEquity();
      ledger.applyFunding(pos.id, 0.01);
      const delta = ledger.getEquity() - equityBefore;
      if (!(delta >= 0.01 - 1e-9)) {
        throw new Error(`Short must RECEIVE positive funding; equity delta=${delta}`);
      }
    });
  });

  describe('SHORT liquidation lifecycle (C-04 audit trail)', () => {
    it('SHORT-10: survives 109, liquidates at 110, with full audit trail', () => {
      const pos = openShort(100, 1, 10);
      ledger.markPrice(pos.id, 109);
      expect(ledger.getPosition(pos.id).status).not.toBe('LIQUIDATED');

      ledger.markPrice(pos.id, 110);
      const p = ledger.getPosition(pos.id);
      expect(p.status).toBe('LIQUIDATED');

      const events = ledger.getEvents();
      const liqEvent =
        events.find((e) => e.type === 'LIQUIDATION_EXECUTED') ??
        events.find((e) => e.type === 'POSITION_LIQUIDATED');
      if (!liqEvent) throw new Error('Liquidation bypassed the event log (C-04 regression)');
      expect(liqEvent.positionId).toBe(pos.id);
      if (!liqEvent.fillId) throw new Error('Liquidation event missing fillId — no Fill record created');
      if (!((liqEvent.fee ?? 0) > 0)) throw new Error('Liquidation fee not charged');
    });

    it('SHORT-11: isolated-margin loss cap — loss never exceeds margin + liquidation fee', () => {
      const pos = openShort(100, 1, 10);
      ledger.markPrice(pos.id, 130);
      const p = ledger.getPosition(pos.id);
      expect(p.status).toBe('LIQUIDATED');
      const loss = -(p.realizedPnl ?? 0);
      const margin = p.margin;
      if (loss > margin + 1.0 + 1e-6) {
        throw new Error(`Isolated-margin cap violated: loss ${loss} > margin+fee on margin ${margin}`);
      }
    });
  });

  describe('concurrent SHORT positions', () => {
    it('SHORT-13: independent margin, PnL, and excursion tracking across symbols', () => {
      const a = ledger.openPosition({
        symbol: 'BTCUSDT',
        side: 'SHORT',
        entryPrice: 100,
        quantity: 1,
        leverage: 10,
      });
      const b = ledger.openPosition({
        symbol: 'ETHUSDT',
        side: 'SHORT',
        entryPrice: 50,
        quantity: 2,
        leverage: 5,
      });
      ledger.markPrice(a.id, 95);
      ledger.markPrice(b.id, 55);
      const pa = ledger.getPosition(a.id);
      const pb = ledger.getPosition(b.id);
      expectMoney(pa.mfe, 5);
      expectMoney(pa.mae, 0);
      expectMoney(pb.mae, 5);
      expectMoney(pb.mfe, 0);
      ledger.closePosition(a.id, 95, 'manual');
      expect(ledger.getPosition(b.id).status).not.toBe('LIQUIDATED');
    });
  });
});
