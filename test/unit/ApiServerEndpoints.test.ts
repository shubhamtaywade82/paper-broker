import { describe, it, expect, vi } from 'vitest';
import { ApiServer } from '../../src/api/server.js';
import { resolveRuntimeProfile } from '../../src/config/modes/resolver.js';
import type { ExecutionBroker, Order } from '../../src/broker/types.js';
import type { StrategyEngine } from '../../src/strategy/StrategyEngine.js';
import type { SignalRepository } from '../../src/persistence/repositories/SignalRepository.js';
import type { EventLog } from '../../src/persistence/EventLog.js';
import { MarketDataSupervisor } from '../../src/market/supervisor/MarketDataSupervisor.js';
import { ErrorNormalizer } from '../../src/notifications/error-pipeline/ErrorNormalizer.js';

describe('ApiServer Dashboard and WebSocket Endpoints', () => {
  const sampleOrder: Order = {
    id: 'ord-123',
    clientOrderId: 'cid-123',
    accountId: 'acc-1',
    symbol: 'SOLUSDT',
    side: 'BUY',
    type: 'LIMIT',
    timeInForce: 'GTC',
    status: 'NEW',
    positionSide: 'BOTH',
    quantity: 5,
    filledQty: 0,
    avgFillPrice: 0,
    leverage: 5,
    reduceOnly: false,
    postOnly: false,
    closePosition: false,
    submittedAtUtc: new Date().toISOString(),
    updatedAtUtc: new Date().toISOString(),
  };

  const mockBroker: ExecutionBroker = {
    submitOrder: vi.fn().mockResolvedValue(sampleOrder),
    cancelOrder: vi.fn().mockResolvedValue(sampleOrder),
    cancelAllOrders: vi.fn().mockResolvedValue(undefined),
    getOpenOrders: vi.fn().mockResolvedValue([sampleOrder]),
    getPositions: vi.fn().mockResolvedValue([]),
    getPosition: vi.fn().mockResolvedValue(undefined),
    getAccount: vi.fn().mockResolvedValue({ walletBalance: 10000, equity: 10000 }),
  };

  const mockEngine = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  } as unknown as StrategyEngine;

  const mockSignals = {
    list: vi.fn().mockResolvedValue([]),
  } as unknown as SignalRepository;

  const mockEvents = {
    appendOrderEvent: vi.fn(),
  } as unknown as EventLog;

  it('GET /api/v1/dashboard returns consolidated system state', async () => {
    const profile = resolveRuntimeProfile({ TRADING_MODE: 'shadow' });
    const supervisor = new MarketDataSupervisor();
    const errorNormalizer = new ErrorNormalizer();
    errorNormalizer.normalize({
      component: 'BinanceWs',
      error: new Error('Stream reconnecting'),
      severity: 'WARNING',
    });

    const server = new ApiServer({
      broker: mockBroker,
      engine: mockEngine,
      signals: mockSignals,
      events: mockEvents,
      profile,
      supervisor,
      errorNormalizer,
    });

    const app = server.getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.mode).toBe('shadow');
    expect(body.account.walletBalance).toBe(10000);
    expect(body.health.activeProvider).toBe('BINANCE');
    expect(body.incidents.length).toBe(1);
    expect(body.incidents[0].component).toBe('BinanceWs');
  });

  it('POST /api/v1/mode/arm arms live trading and broadcasts event', async () => {
    const profile = resolveRuntimeProfile({ TRADING_MODE: 'live', LIVE_TRADING_ARMED: false });
    const server = new ApiServer({
      broker: mockBroker,
      engine: mockEngine,
      signals: mockSignals,
      events: mockEvents,
      profile,
    });

    const app = server.getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/mode/arm',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.armed).toBe(true);
    expect(profile.liveArmed).toBe(true);
  });

  it('POST /orders broadcasts order.updated over WebSocket', async () => {
    const server = new ApiServer({
      broker: mockBroker,
      engine: mockEngine,
      signals: mockSignals,
      events: mockEvents,
    });

    const broadcastSpy = vi.spyOn(server.wsGateway, 'broadcast');
    const app = server.getApp();

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: {
        symbol: 'SOLUSDT',
        side: 'BUY',
        type: 'LIMIT',
        quantity: 5,
        price: 90.0,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(broadcastSpy).toHaveBeenCalledWith('order.updated', expect.objectContaining({ id: 'ord-123' }));
  });
});
