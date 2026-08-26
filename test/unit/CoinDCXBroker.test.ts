import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoinDCXBroker } from '../../src/coindcx/CoinDCXBroker.js';
import type { CoinDCXClient } from '@nemesis-oss/coindcx-sdk';

describe('CoinDCXBroker Live Adapter Order Semantics', () => {
  let mockClient: CoinDCXClient;
  let createOrderMock: ReturnType<typeof vi.fn>;
  let cancelOrderMock: ReturnType<typeof vi.fn>;
  let cancelAllOrdersMock: ReturnType<typeof vi.fn>;
  let getPositionsMock: ReturnType<typeof vi.fn>;
  let createTPSLMock: ReturnType<typeof vi.fn>;
  let exitPositionMock: ReturnType<typeof vi.fn>;
  let getWalletMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createOrderMock = vi.fn().mockResolvedValue({ id: 'ord-coindcx-101' });
    cancelOrderMock = vi.fn().mockResolvedValue({ status: 'success' });
    cancelAllOrdersMock = vi.fn().mockResolvedValue({ status: 'success' });
    createTPSLMock = vi.fn().mockResolvedValue({ status: 'success' });
    exitPositionMock = vi.fn().mockResolvedValue({ status: 'success' });
    getPositionsMock = vi.fn().mockResolvedValue([
      {
        id: 'pos-123',
        pair: 'B-SOL_USDT',
        side: 'long',
        size: '10.5',
        entry_price: '98.5',
        unrealized_pnl: '12.3',
        realized_pnl: '5.0',
        leverage: 5,
        margin: '200',
      },
    ]);
    getWalletMock = vi.fn().mockResolvedValue({
      balance: 10_000,
      unrealized_pnl: 12.3,
      margin: 200,
    });

    mockClient = {
      futures: {
        trading: {
          createOrder: createOrderMock,
          cancelOrder: cancelOrderMock,
          cancelAllOrders: cancelAllOrdersMock,
          getPositions: getPositionsMock,
          createTPSL: createTPSLMock,
          exitPosition: exitPositionMock,
        },
        account: {
          getWallet: getWalletMock,
        },
      },
    } as unknown as CoinDCXClient;
  });

  it('CDX-01: maps LIMIT entry order to createOrder limit_order with explicit price', async () => {
    const broker = new CoinDCXBroker({ client: mockClient });
    const order = await broker.submitOrder({
      symbol: 'SOLUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 5,
      price: 95.0,
      leverage: 5,
    });

    expect(createOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        side: 'buy',
        order_type: 'limit_order',
        base_currency: 'SOL',
        quote_currency: 'USDT',
        target_quantity: 5,
        price: 95.0,
      })
    );
    expect(order.id).toBe('ord-coindcx-101');
    expect(order.status).toBe('NEW');
    expect(order.type).toBe('LIMIT');
  });

  it('CDX-02: routes STOP_MARKET reduce-only order to createTPSL with stop_loss against open position', async () => {
    const broker = new CoinDCXBroker({ client: mockClient });
    const order = await broker.submitOrder({
      symbol: 'SOLUSDT',
      side: 'SELL',
      type: 'STOP_MARKET',
      quantity: 10.5,
      stopPrice: 90.0,
      reduceOnly: true,
    });

    expect(createTPSLMock).toHaveBeenCalledWith(
      expect.objectContaining({
        position_id: 'pos-123',
        stop_loss: 90.0,
        take_profit: undefined,
      })
    );
    expect(order.status).toBe('NEW');
    expect(order.id).toBe('tpsl-pos-123-sl');
  });

  it('CDX-03: routes TAKE_PROFIT_MARKET reduce-only order to createTPSL with take_profit against open position', async () => {
    const broker = new CoinDCXBroker({ client: mockClient });
    const order = await broker.submitOrder({
      symbol: 'SOLUSDT',
      side: 'SELL',
      type: 'TAKE_PROFIT_MARKET',
      quantity: 10.5,
      stopPrice: 115.0,
      reduceOnly: true,
    });

    expect(createTPSLMock).toHaveBeenCalledWith(
      expect.objectContaining({
        position_id: 'pos-123',
        stop_loss: undefined,
        take_profit: 115.0,
      })
    );
    expect(order.status).toBe('NEW');
    expect(order.id).toBe('tpsl-pos-123-tp');
  });

  it('CDX-04: maps MARKET entry order to createOrder market_order', async () => {
    const broker = new CoinDCXBroker({ client: mockClient });
    const order = await broker.submitOrder({
      symbol: 'SOLUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 1.5,
    });

    expect(createOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        side: 'buy',
        order_type: 'market_order',
        base_currency: 'SOL',
        quote_currency: 'USDT',
        target_quantity: 1.5,
      })
    );
    expect(order.status).toBe('NEW');
  });

  it('CDX-05: routes reduce-only MARKET exit to exitPosition when closing full position', async () => {
    const broker = new CoinDCXBroker({ client: mockClient });
    const order = await broker.submitOrder({
      symbol: 'SOLUSDT',
      side: 'SELL',
      type: 'MARKET',
      quantity: 10.5,
      reduceOnly: true,
      closePosition: true,
    });

    expect(exitPositionMock).toHaveBeenCalledWith({
      pair: 'B-SOL_USDT',
    });
    expect(order.status).toBe('NEW');
    expect(order.id).toBe('exit-pos-123');
  });

  it('CDX-06: rejects unsupported partial reduce-only orders safely', async () => {
    const broker = new CoinDCXBroker({ client: mockClient });
    const order = await broker.submitOrder({
      symbol: 'SOLUSDT',
      side: 'SELL',
      type: 'MARKET',
      quantity: 5.0, // Partial reduce of 10.5 size
      reduceOnly: true,
    });

    expect(order.status).toBe('REJECTED');
    expect(order.rejectReason).toContain('PARTIAL_REDUCE_ONLY_UNSUPPORTED');
  });

  it('CDX-07: getPositions normalizes CoinDCX pairs and sides correctly', async () => {
    const broker = new CoinDCXBroker({ client: mockClient });
    const positions = await broker.getPositions();

    expect(positions).toHaveLength(1);
    expect(positions[0]?.symbol).toBe('SOLUSDT');
    expect(positions[0]?.positionSide).toBe('LONG');
    expect(positions[0]?.qty).toBe(10.5);
    expect(positions[0]?.entryPrice).toBe(98.5);
    expect(positions[0]?.unrealizedPnl).toBe(12.3);
  });

  it('CDX-08: getAccount fetches wallet balance and computes equity', async () => {
    const broker = new CoinDCXBroker({ client: mockClient });
    const account = await broker.getAccount();

    expect(account.walletBalance).toBe(10_000);
    expect(account.unrealizedPnl).toBe(12.3);
    expect(account.equity).toBe(10_012.3);
  });
});
