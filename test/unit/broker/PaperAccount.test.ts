import { describe, it, expect } from 'vitest';
import { PaperAccount } from '../../../src/broker/paper/PaperAccount.js';
import type { PaperPosition } from '../../../src/broker/paper/types.js';

function makePosition(overrides: Partial<PaperPosition> = {}): PaperPosition {
  return {
    id: 'pos-1',
    symbol: 'BTCUSDT',
    side: 'LONG',
    state: 'OPEN',
    quantity: 1,
    initialQuantity: 1,
    remainingQuantity: 1,
    averageEntryPrice: 100,
    currentMarkPrice: 100,
    liquidationPrice: 0,
    leverage: 5,
    initialMargin: 20,
    usedMargin: 20,
    unrealizedPnl: 0,
    realizedPnl: 0,
    fees: 0,
    stopLossPrice: 0,
    plannedStopPrice: 0,
    takeProfitPrices: [],
    highestPriceReached: 100,
    lowestPriceReached: 100,
    openedAt: 0,
    lifecycle: 'POSITION_OPEN',
    signalKey: 'k',
    setupId: 's',
    executionPlanId: 'p',
    ...overrides,
  };
}

describe('PaperAccount', () => {
  it('starts flat: balance === equity === availableBalance, no margin held', () => {
    const acc = new PaperAccount(10_000);
    const state = acc.getAccountState([]);
    expect(state.balance).toBe(10_000);
    expect(state.equity).toBe(10_000);
    expect(state.availableBalance).toBe(10_000);
    expect(state.usedMargin).toBe(0);
    expect(state.unrealizedPnl).toBe(0);
  });

  it('charges a fee against balance, equity and availableBalance together', () => {
    const acc = new PaperAccount(10_000);
    acc.chargeFee(4);
    const state = acc.getAccountState([]);
    expect(state.balance).toBe(9996);
    expect(state.equity).toBe(9996);
    expect(state.totalFees).toBe(4);
  });

  it('credits realized PnL into balance (and thus equity)', () => {
    const acc = new PaperAccount(10_000);
    acc.creditRealizedPnl(-250);
    const state = acc.getAccountState([]);
    expect(state.balance).toBe(9750);
    expect(state.equity).toBe(9750);
    expect(state.realizedPnl).toBe(-250);
  });

  it('folds an open position into usedMargin and unrealizedPnl, equity = balance + unrealizedPnl', () => {
    const acc = new PaperAccount(10_000);
    const pos = makePosition({ usedMargin: 200, unrealizedPnl: 300 });
    const state = acc.getAccountState([pos]);
    expect(state.usedMargin).toBe(200);
    expect(state.unrealizedPnl).toBe(300);
    expect(state.equity).toBe(10_300); // balance(10000) + unrealizedPnl(300)
    expect(state.availableBalance).toBe(10_100); // equity(10300) - usedMargin(200)
  });

  // Regression test for the bug fixed in PaperAccount.ts: availableBalance
  // used to be `balance - usedMargin`, silently dropping unrealizedPnl —
  // it overstated free margin on any losing position.
  it('subtracts unrealized loss from availableBalance, not just usedMargin', () => {
    const acc = new PaperAccount(10_000);
    const pos = makePosition({ usedMargin: 200, unrealizedPnl: -500 });
    const state = acc.getAccountState([pos]);
    expect(state.equity).toBe(9500); // 10000 + (-500)
    expect(state.availableBalance).toBe(9300); // equity(9500) - usedMargin(200)
    expect(state.availableBalance).not.toBe(9800); // the pre-fix (wrong) value
  });

  it('floors availableBalance at 0 when usedMargin plus losses exceed equity', () => {
    const acc = new PaperAccount(1_000);
    const pos = makePosition({ usedMargin: 900, unrealizedPnl: -300 });
    const state = acc.getAccountState([pos]);
    expect(state.equity).toBe(700);
    expect(state.availableBalance).toBe(0); // max(0, 700 - 900)
  });

  it('sums usedMargin/unrealizedPnl across multiple open positions and ignores closed ones', () => {
    const acc = new PaperAccount(10_000);
    const open1 = makePosition({ id: 'a', usedMargin: 100, unrealizedPnl: 50 });
    const open2 = makePosition({ id: 'b', usedMargin: 150, unrealizedPnl: -20 });
    const closed = makePosition({ id: 'c', state: 'CLOSED', usedMargin: 999, unrealizedPnl: 999 });
    const state = acc.getAccountState([open1, open2, closed]);
    expect(state.usedMargin).toBe(250);
    expect(state.unrealizedPnl).toBe(30);
    expect(state.equity).toBe(10_030);
    expect(state.availableBalance).toBe(9780); // 10030 - 250
  });

  it('reset() restores initial balance and zeroes fees/realizedPnl', () => {
    const acc = new PaperAccount(10_000);
    acc.chargeFee(4);
    acc.creditRealizedPnl(-100);
    acc.reset(5_000);
    const state = acc.getAccountState([]);
    expect(state.balance).toBe(5_000);
    expect(state.equity).toBe(5_000);
    expect(state.totalFees).toBe(0);
    expect(state.realizedPnl).toBe(0);
  });
});
