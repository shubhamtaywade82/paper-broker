import { describe, it, expect, beforeEach } from 'vitest';
import { useTradingStore } from '../tradingStore.js';
import { useAccountStore } from '../accountStore.js';
import type { Position, Order } from '../../lib/wsContracts.js';

describe('Store isolation & TradingStore (God-store regression)', () => {
  beforeEach(() => {
    useTradingStore.getState().reset();
    useAccountStore.getState().reset();
  });

  const basePosition: Position = {
    id: 'pos-1',
    symbol: 'BTCUSDT',
    side: 'LONG',
    quantity: 1.5,
    entryPrice: 50_000,
    markPrice: 51_000,
    unrealizedPnl: 1500,
    status: 'OPEN',
  };

  it('ISO-01: trading update does not mutate account store state', () => {
    useAccountStore.getState().setSnapshot({
      balance: 10_000,
      equity: 11_500,
      available: 8_500,
      marginUsed: 1_500,
      peakEquity: 12_000,
      dailyPnl: 500,
    });

    const accountBefore = useAccountStore.getState().balance;
    useTradingStore.getState().upsertPosition(basePosition);

    expect(useAccountStore.getState().balance).toBe(accountBefore);
    expect(useTradingStore.getState().positions['pos-1']).toBeDefined();
  });

  it('ISO-02: upsertPosition replaces by id, does not create duplicate entries', () => {
    const store = useTradingStore.getState();
    store.upsertPosition({ ...basePosition, markPrice: 50_500 });
    store.upsertPosition({ ...basePosition, markPrice: 52_000 });

    const positions = useTradingStore.getState().positions;
    expect(Object.keys(positions)).toHaveLength(1);
    expect(positions['pos-1']?.markPrice).toBe(52_000);
  });

  it('ISO-03: removePosition deletes position by id', () => {
    const store = useTradingStore.getState();
    store.upsertPosition(basePosition);
    expect(Object.keys(useTradingStore.getState().positions)).toHaveLength(1);

    store.removePosition('pos-1');
    expect(Object.keys(useTradingStore.getState().positions)).toHaveLength(0);
  });

  it('ISO-04: upsertOrder updates existing order or appends new order', () => {
    const order1: Order = {
      id: 'ord-1',
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'LIMIT',
      status: 'NEW',
      filledQuantity: 0,
    };

    useTradingStore.getState().upsertOrder(order1);
    expect(useTradingStore.getState().openOrders).toHaveLength(1);

    useTradingStore.getState().upsertOrder({ ...order1, status: 'FILLED', filledQuantity: 1 });
    expect(useTradingStore.getState().openOrders).toHaveLength(1);
    expect(useTradingStore.getState().openOrders[0]?.status).toBe('FILLED');

    const order2: Order = {
      id: 'ord-2',
      symbol: 'SOLUSDT',
      side: 'SELL',
      type: 'MARKET',
      status: 'NEW',
      filledQuantity: 0,
    };
    useTradingStore.getState().upsertOrder(order2);
    expect(useTradingStore.getState().openOrders).toHaveLength(2);
  });

  it('ISO-05: pushSignal limits history to 50 items', () => {
    for (let i = 0; i < 60; i++) {
      useTradingStore.getState().pushSignal({
        id: `sig-${i}`,
        symbol: 'BTCUSDT',
        action: 'BUY',
      });
    }

    const signals = useTradingStore.getState().recentSignals;
    expect(signals).toHaveLength(50);
    expect(signals[0]?.id).toBe('sig-59');
  });
});
