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

describe('ExecutionRouter — live mode without an adapter', () => {
  function makePaperBroker(): ExecutionBroker & { submitOrder: ReturnType<typeof vi.fn> } {
    return {
      submitOrder: vi.fn().mockResolvedValue({
        id: 'paper-1',
        clientOrderId: 'cid-paper-1',
        accountId: 'paper-main',
        symbol: 'SOLUSDT',
        side: 'BUY',
        type: 'MARKET',
        timeInForce: 'GTC',
        status: 'FILLED',
        positionSide: 'LONG',
        quantity: 1,
        filledQty: 1,
        avgFillPrice: 100,
        leverage: 1,
        reduceOnly: false,
        postOnly: false,
        closePosition: false,
        submittedAtUtc: new Date().toISOString(),
        updatedAtUtc: new Date().toISOString(),
      } satisfies Order),
      cancelOrder: vi.fn(),
      cancelAllOrders: vi.fn(),
      getOpenOrders: vi.fn().mockResolvedValue([]),
      getPositions: vi.fn().mockResolvedValue([]),
      getPosition: vi.fn(),
      getAccount: vi.fn().mockResolvedValue({ walletBalance: 10000, equity: 10000 }),
    } as unknown as ExecutionBroker & { submitOrder: ReturnType<typeof vi.fn> };
  }

  it('REJECTS orders when live is armed but no live venue adapter is registered', async () => {
    const profile = resolveRuntimeProfile({
      TRADING_MODE: 'live',
      LIVE_TRADING_ARMED: true,
      COINDCX_API_KEY: 'k',
      COINDCX_API_SECRET: 's',
    });
    expect(profile.realOrders).toBe(true);

    const paperBroker = makePaperBroker();
    // No coindcxBroker supplied — this is the shipped configuration.
    const router = new ExecutionRouter({ profile, paperBroker });

    const order = await router.submitOrder({
      symbol: 'SOLUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 1,
    });

    // The critical property: it must NOT silently paper-fill while the profile
    // reports live execution.
    expect(order.status).toBe('REJECTED');
    expect(order.rejectReason).toContain('NO_LIVE_EXECUTION_ADAPTER');
    expect(paperBroker.submitOrder).not.toHaveBeenCalled();
  });

  it('reports the guard reason, not the adapter reason, when live is disarmed', async () => {
    const profile = resolveRuntimeProfile({ TRADING_MODE: 'live', LIVE_TRADING_ARMED: false });
    const paperBroker = makePaperBroker();
    const router = new ExecutionRouter({ profile, paperBroker });

    const order = await router.submitOrder({
      symbol: 'SOLUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 1,
    });

    expect(order.status).toBe('REJECTED');
    expect(order.rejectReason).toContain('LIVE_TRADING_DISARMED');
  });

  it('routes to a live adapter when one IS registered and armed', async () => {
    const profile = resolveRuntimeProfile({
      TRADING_MODE: 'live',
      LIVE_TRADING_ARMED: true,
      COINDCX_API_KEY: 'k',
      COINDCX_API_SECRET: 's',
    });
    const paperBroker = makePaperBroker();
    const coindcxBroker = makePaperBroker();

    const router = new ExecutionRouter({ profile, paperBroker, coindcxBroker });
    await router.submitOrder({ symbol: 'SOLUSDT', side: 'BUY', type: 'MARKET', quantity: 1 });

    expect(coindcxBroker.submitOrder).toHaveBeenCalledTimes(1);
    expect(paperBroker.submitOrder).not.toHaveBeenCalled();
  });
});
