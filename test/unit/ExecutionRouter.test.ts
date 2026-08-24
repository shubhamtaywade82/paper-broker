import { describe, it, expect, vi } from 'vitest';
import { ExecutionRouter } from '../../src/execution/ExecutionRouter.js';
import { resolveRuntimeProfile } from '../../src/config/modes/resolver.js';
import type { ExecutionBroker, OrderCommand, Order } from '../../src/broker/types.js';

describe('ExecutionRouter', () => {
  const sampleOrder: Order = {
    id: 'test-order-1',
    clientOrderId: 'cid-1',
    accountId: 'acc-1',
    symbol: 'SOLUSDT',
    side: 'BUY',
    type: 'MARKET',
    timeInForce: 'GTC',
    status: 'FILLED',
    positionSide: 'LONG',
    quantity: 1,
    filledQty: 1,
    avgFillPrice: 90.0,
    leverage: 1,
    reduceOnly: false,
    postOnly: false,
    closePosition: false,
    submittedAtUtc: new Date().toISOString(),
    updatedAtUtc: new Date().toISOString(),
  };

  const sampleCommand: OrderCommand = {
    symbol: 'SOLUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 1,
  };

  it('routes to paperBroker in paper mode', async () => {
    const mockPaperBroker: ExecutionBroker = {
      submitOrder: vi.fn().mockResolvedValue(sampleOrder),
      cancelOrder: vi.fn(),
      cancelAllOrders: vi.fn(),
      getOpenOrders: vi.fn().mockResolvedValue([]),
      getPositions: vi.fn().mockResolvedValue([]),
      getPosition: vi.fn(),
      getAccount: vi.fn().mockResolvedValue({ walletBalance: 10000, equity: 10000 }),
    };

    const profile = resolveRuntimeProfile({ TRADING_MODE: 'paper' });
    const router = new ExecutionRouter({
      profile,
      paperBroker: mockPaperBroker,
    });

    const res = await router.submitOrder(sampleCommand);
    expect(mockPaperBroker.submitOrder).toHaveBeenCalledWith(sampleCommand);
    expect(res.status).toBe('FILLED');
  });

  it('rejects live orders when disarmed and does not call broker', async () => {
    const mockCoinDCXBroker: ExecutionBroker = {
      submitOrder: vi.fn(),
      cancelOrder: vi.fn(),
      cancelAllOrders: vi.fn(),
      getOpenOrders: vi.fn(),
      getPositions: vi.fn(),
      getPosition: vi.fn(),
      getAccount: vi.fn(),
    };

    const profile = resolveRuntimeProfile({
      TRADING_MODE: 'live',
      LIVE_TRADING_ARMED: false,
    });

    const router = new ExecutionRouter({
      profile,
      paperBroker: mockCoinDCXBroker,
      coindcxBroker: mockCoinDCXBroker,
    });

    const res = await router.submitOrder(sampleCommand);
    expect(res.status).toBe('REJECTED');
    expect(res.rejectReason).toContain('LIVE_TRADING_DISARMED');
    expect(mockCoinDCXBroker.submitOrder).not.toHaveBeenCalled();
  });

  it('routes to coindcxBroker in live mode when armed', async () => {
    const mockCoinDCXBroker: ExecutionBroker = {
      submitOrder: vi.fn().mockResolvedValue(sampleOrder),
      cancelOrder: vi.fn(),
      cancelAllOrders: vi.fn(),
      getOpenOrders: vi.fn(),
      getPositions: vi.fn(),
      getPosition: vi.fn(),
      getAccount: vi.fn(),
    };

    const profile = resolveRuntimeProfile({
      TRADING_MODE: 'live',
      LIVE_TRADING_ARMED: true,
    });

    const router = new ExecutionRouter({
      profile,
      paperBroker: mockCoinDCXBroker,
      coindcxBroker: mockCoinDCXBroker,
    });

    const res = await router.submitOrder(sampleCommand);
    expect(mockCoinDCXBroker.submitOrder).toHaveBeenCalledWith(sampleCommand);
    expect(res.status).toBe('FILLED');
  });

  it('does not route reads/cancels to coindcxBroker when liveArmed but realOrders is false', async () => {
    const mockCoinDCXBroker: ExecutionBroker = {
      submitOrder: vi.fn(),
      cancelOrder: vi.fn(),
      cancelAllOrders: vi.fn(),
      getOpenOrders: vi.fn(),
      getPositions: vi.fn(),
      getPosition: vi.fn(),
      getAccount: vi.fn(),
    };
    const mockPaperBroker: ExecutionBroker = {
      submitOrder: vi.fn(),
      cancelOrder: vi.fn(),
      cancelAllOrders: vi.fn(),
      getOpenOrders: vi.fn(),
      getPositions: vi.fn().mockResolvedValue([]),
      getPosition: vi.fn(),
      getAccount: vi.fn(),
    };

    const profile = resolveRuntimeProfile({ TRADING_MODE: 'live', LIVE_TRADING_ARMED: false });
    profile.liveArmed = true; // e.g. a stale/desynced runtime arm flag

    const router = new ExecutionRouter({
      profile,
      paperBroker: mockPaperBroker,
      coindcxBroker: mockCoinDCXBroker,
    });

    await router.getPositions();
    expect(mockPaperBroker.getPositions).toHaveBeenCalled();
    expect(mockCoinDCXBroker.getPositions).not.toHaveBeenCalled();
  });
});
