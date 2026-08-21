import { describe, it, expect, vi } from 'vitest';
import { CoinDCXBroker } from '../../src/coindcx/CoinDCXBroker.js';
import type { CoinDCXClient } from '@nemesis-oss/coindcx-sdk';

describe('CoinDCXBroker', () => {
  it('submits orders and maps parameters to CoinDCX format', async () => {
    const mockCreateOrder = vi.fn().mockResolvedValue({ id: 'cdx-order-123', status: 'open' });
    const mockClient = {
      futures: {
        trading: {
          createOrder: mockCreateOrder,
          cancelOrder: vi.fn(),
          cancelAllOrders: vi.fn(),
          getPositions: vi.fn().mockResolvedValue([]),
        },
        account: {
          getWallet: vi.fn().mockResolvedValue({ balance: 5000, unrealized_pnl: 100, margin: 200 }),
        },
      },
    } as unknown as CoinDCXClient;

    const broker = new CoinDCXBroker({ client: mockClient });

    const order = await broker.submitOrder({
      symbol: 'SOLUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 5,
      price: 89.5,
      leverage: 10,
      stopPrice: 87.0,
      marginType: 'ISOLATED',
    });

    expect(mockCreateOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        side: 'buy',
        order_type: 'limit_order',
        base_currency: 'SOL',
        quote_currency: 'USDT',
        target_quantity: 5,
        price: 89.5,
        leverage: 10,
        stop_loss: 87.0,
        margin_type: 'isolated',
      })
    );

    expect(order.id).toBe('cdx-order-123');
    expect(order.symbol).toBe('SOLUSDT');
    expect(order.status).toBe('NEW');
  });

  it('cancels orders and manages active orders', async () => {
    const mockCancelOrder = vi.fn().mockResolvedValue({ success: true });
    const mockCreateOrder = vi.fn().mockResolvedValue({ id: 'cdx-order-456' });
    const mockClient = {
      futures: {
        trading: {
          createOrder: mockCreateOrder,
          cancelOrder: mockCancelOrder,
          cancelAllOrders: vi.fn(),
          getPositions: vi.fn().mockResolvedValue([]),
        },
        account: {
          getWallet: vi.fn().mockResolvedValue({ balance: 1000 }),
        },
      },
    } as unknown as CoinDCXClient;

    const broker = new CoinDCXBroker({ client: mockClient });

    await broker.submitOrder({
      symbol: 'ETHUSDT',
      side: 'SELL',
      type: 'MARKET',
      quantity: 1,
    });

    const openOrdersBefore = await broker.getOpenOrders('ETHUSDT');
    expect(openOrdersBefore.length).toBe(1);

    const canceled = await broker.cancelOrder('cdx-order-456');
    expect(canceled?.status).toBe('CANCELED');

    const openOrdersAfter = await broker.getOpenOrders('ETHUSDT');
    expect(openOrdersAfter.length).toBe(0);
  });

  it('retrieves positions and maps to canonical format', async () => {
    const mockPositions = [
      {
        id: 'pos-1',
        pair: 'B-SOL_USDT',
        size: 10,
        side: 'long',
        entry_price: 88.0,
        unrealized_pnl: 35.5,
        realized_pnl: 12.0,
        leverage: 5,
        margin: 176.0,
      },
    ];

    const mockClient = {
      futures: {
        trading: {
          createOrder: vi.fn(),
          cancelOrder: vi.fn(),
          cancelAllOrders: vi.fn(),
          getPositions: vi.fn().mockResolvedValue(mockPositions),
        },
        account: {
          getWallet: vi.fn().mockResolvedValue({ balance: 2500, unrealized_pnl: 35.5 }),
        },
      },
    } as unknown as CoinDCXClient;

    const broker = new CoinDCXBroker({ client: mockClient });
    const positions = await broker.getPositions();

    expect(positions.length).toBe(1);
    expect(positions[0].symbol).toBe('SOLUSDT');
    expect(positions[0].positionSide).toBe('LONG');
    expect(positions[0].qty).toBe(10);
    expect(positions[0].entryPrice).toBe(88.0);
    expect(positions[0].unrealizedPnl).toBe(35.5);

    const account = await broker.getAccount();
    expect(account.walletBalance).toBe(2500);
    expect(account.equity).toBe(2535.5);
  });
});
