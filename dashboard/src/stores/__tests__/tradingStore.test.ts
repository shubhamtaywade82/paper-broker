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

  it('PNL-01: calculatePositionPnl calculates accurate live PnL and ROE from livePrice', async () => {
    const { calculatePositionPnl } = await import('../../store/useStore.js');
    const pos = {
      symbol: 'BTCUSDT',
      side: 'LONG' as const,
      quantity: 2,
      entryPrice: 50_000,
      markPrice: 50_000,
      unrealizedPnl: 0,
      leverage: 10,
    };

    const res = calculatePositionPnl(pos, { BTCUSDT: 52_000 });
    expect(res.markPrice).toBe(52_000);
    expect(res.unrealizedPnl).toBe(4_000); // (52000 - 50000) * 2 = 4000
    expect(res.roe).toBe(40); // 4000 / (100000 / 10) = 40%
  });

  it('PNL-02: calculateTotalUnrealizedPnl aggregates live position PnLs across symbols', async () => {
    const { calculateTotalUnrealizedPnl } = await import('../../store/useStore.js');
    const positions = [
      {
        symbol: 'BTCUSDT',
        side: 'LONG' as const,
        quantity: 1,
        entryPrice: 50_000,
        markPrice: 50_000,
        unrealizedPnl: 0,
        leverage: 5,
      },
      {
        symbol: 'ETHUSDT',
        side: 'SHORT' as const,
        quantity: 10,
        entryPrice: 3_000,
        markPrice: 3_000,
        unrealizedPnl: 0,
        leverage: 5,
      },
    ];

    const livePrices = {
      BTCUSDT: 51_000, // Long: +1000
      ETHUSDT: 2_900,  // Short: +1000
    };

    const total = calculateTotalUnrealizedPnl(positions, livePrices);
    expect(total).toBe(2_000);
  });

  it('PREC-01: formatPrice and formatCurrency preserve fixed trailing zeros per symbol', async () => {
    const { formatPrice, formatCurrency } = await import('../../store/useStore.js');

    // BTCUSDT: 2 decimals, trailing zero preserved
    expect(formatPrice(78587.7, 'BTCUSDT')).toBe('78,587.70');
    expect(formatCurrency(78587.7, 'BTCUSDT')).toBe('$78,587.70');

    // SOLUSDT: 2 decimals, trailing zero preserved (e.g. 103.8 -> 103.80)
    expect(formatPrice(103.8, 'SOLUSDT')).toBe('103.80');
    expect(formatCurrency(103.8, 'SOLUSDT')).toBe('$103.80');

    // XRPUSDT: 4 decimals, trailing zeros preserved (e.g. 1.38 -> 1.3800)
    expect(formatPrice(1.38, 'XRPUSDT')).toBe('1.3800');
    expect(formatCurrency(1.38, 'XRPUSDT')).toBe('$1.3800');

    // DOGEUSDT: 5 decimals, trailing zeros preserved
    expect(formatPrice(0.23, 'DOGEUSDT')).toBe('0.23000');
    expect(formatCurrency(0.23, 'DOGEUSDT')).toBe('$0.23000');
  });

  it('PREC-02: formatQty preserves fixed quantity precision per symbol', async () => {
    const { formatQty } = await import('../../store/useStore.js');

    // BTC: 3 decimals (e.g. 0.04 -> 0.040)
    expect(formatQty(0.04, 'BTCUSDT')).toBe('0.040');

    // SOL: 2 decimals (e.g. 33.7 -> 33.70)
    expect(formatQty(33.7, 'SOLUSDT')).toBe('33.70');

    // XRP: 1 decimal (e.g. 2534 -> 2,534.0)
    expect(formatQty(2534, 'XRPUSDT')).toBe('2,534.0');

    // DOGE: 0 decimals
    expect(formatQty(100, 'DOGEUSDT')).toBe('100');
  });
});
