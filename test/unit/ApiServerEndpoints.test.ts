import { describe, it, expect, vi } from 'vitest';
import { ApiServer } from '../../src/api/server.js';
import { resolveRuntimeProfile } from '../../src/config/modes/resolver.js';
import type { ExecutionBroker, Order } from '../../src/broker/types.js';
import type { StrategyEngine } from '../../src/strategy/StrategyEngine.js';
import type { SignalRepository } from '../../src/persistence/repositories/SignalRepository.js';
import type { EventLog } from '../../src/persistence/EventLog.js';
import { MarketDataSupervisor } from '../../src/market/supervisor/MarketDataSupervisor.js';
import { ErrorNormalizer } from '../../src/notifications/error-pipeline/ErrorNormalizer.js';
import { TradingAgentsPipeline } from '../../src/ai/tradingAgents.js';

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
    logAgentCycle: vi.fn(),
    getAgentCycles: vi.fn().mockReturnValue([{ cycleId: 'cycle-123', symbol: 'SOLUSDT', timestamp: Date.now() }]),
    getAgentCycleById: vi.fn().mockReturnValue({
      cycle_id: 'cycle-123',
      symbol: 'SOLUSDT',
      started_at: Date.now(),
      executed: 1,
      trader_decision: { action: 'LONG' },
      fund_manager_approval: { rationale: 'Approved long trade' },
      verdict: { rationale: 'Bullish consensus', conviction: 0.8 },
      risk_opinions: [],
    }),
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
      port: 0,
    });

    await server.start();
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

    const riskRes = await app.inject({
      method: 'GET',
      url: '/api/v1/risk',
    });
    expect(riskRes.statusCode).toBe(200);
    const riskBody = JSON.parse(riskRes.body);
    expect(riskBody.riskRating).toBeDefined();
    expect(riskBody.exposurePct).toBeDefined();
    expect(riskBody.limits.maxLeverage).toBe(10);

    const snapshotRes = await app.inject({
      method: 'GET',
      url: '/api/v1/state/snapshot',
    });
    expect(snapshotRes.statusCode).toBe(200);
    const snapBody = JSON.parse(snapshotRes.body);
    expect(snapBody.stateVersion).toBeDefined();
    expect(snapBody.account.walletBalance).toBe(10000);

    await server.stop();
  });

  it('POST /api/v1/mode/arm arms live trading and broadcasts event', async () => {
    const profile = resolveRuntimeProfile({ TRADING_MODE: 'live', LIVE_TRADING_ARMED: false });
    const server = new ApiServer({
      broker: mockBroker,
      engine: mockEngine,
      signals: mockSignals,
      events: mockEvents,
      profile,
      port: 0,
    });

    await server.start();
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
    await server.stop();
  });

  it('POST /orders broadcasts order.updated over WebSocket', async () => {
    const server = new ApiServer({
      broker: mockBroker,
      engine: mockEngine,
      signals: mockSignals,
      events: mockEvents,
      port: 0,
    });

    await server.start();
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
    await server.stop();
  });

  it('GET /api/v1/trades returns array of trades safely', async () => {
    const server = new ApiServer({
      broker: mockBroker,
      engine: mockEngine,
      signals: mockSignals,
      events: mockEvents,
      port: 0,
    });

    await server.start();
    const app = server.getApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/trades?symbol=SOLUSDT&limit=5',
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(Array.isArray(data)).toBe(true);
    await server.stop();
  });

  it('GET /api/v1/tickers returns ticker data safely', async () => {
    const server = new ApiServer({
      broker: mockBroker,
      engine: mockEngine,
      signals: mockSignals,
      events: mockEvents,
      port: 0,
    });

    await server.start();
    const app = server.getApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tickers',
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(Array.isArray(data)).toBe(true);
    await server.stop();
  });

  it('GET /api/v1/orderbook returns orderbook depth safely', async () => {
    const server = new ApiServer({
      broker: mockBroker,
      engine: mockEngine,
      signals: mockSignals,
      events: mockEvents,
      port: 0,
    });

    await server.start();
    const app = server.getApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/orderbook?symbol=SOLUSDT&limit=12',
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    if (data) {
      expect(data.symbol).toBe('SOLUSDT');
    }
    await server.stop();
  });

  it('GET /api/v1/agents/health returns agent engine status', async () => {
    const server = new ApiServer({
      broker: mockBroker,
      engine: mockEngine,
      signals: mockSignals,
      events: mockEvents,
      port: 0,
    });

    await server.start();
    const app = server.getApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/health',
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.status).toBe('healthy');
    expect(data.engine).toContain('TradingAgents');
    await server.stop();
  });

  it('POST /api/v1/agents/cycle and GET /api/v1/agents/cycles work end-to-end', async () => {
    vi.spyOn(TradingAgentsPipeline.prototype, 'runCycle').mockResolvedValueOnce({
      cycleId: 'cycle-123',
      symbol: 'SOLUSDT',
      timestamp: Date.now(),
      status: 'COMPLETED',
      analystReports: [],
      bullishCase: { prevailingSide: 'BULL', rationale: 'Strong support', conviction: 0.8 },
      bearishCase: { prevailingSide: 'BEAR', rationale: 'Resistance ahead', conviction: 0.5 },
      debateVerdict: { prevailingSide: 'BULL', rationale: 'Long setup', conviction: 0.8 },
      traderDecision: { symbol: 'SOLUSDT', action: 'LONG', leverage: 3, sizePct: 0.1, stopLoss: 139, takeProfit: 148, rationale: 'Long', confidence: 0.8 },
      riskOpinions: [],
      fundManagerApproval: { approved: true, finalDecision: { symbol: 'SOLUSDT', action: 'LONG', leverage: 3, sizePct: 0.1, stopLoss: 139, takeProfit: 148, rationale: 'Long', confidence: 0.8 }, rationale: 'Approved' },
    });

    const server = new ApiServer({
      broker: mockBroker,
      engine: mockEngine,
      signals: mockSignals,
      events: mockEvents,
      port: 0,
    });

    await server.start();
    const app = server.getApp();

    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/cycle',
      payload: { symbol: 'SOLUSDT' },
    });

    expect(postRes.statusCode).toBe(200);
    const cycle = JSON.parse(postRes.body);
    expect(cycle.symbol).toBe('SOLUSDT');
    expect(cycle.cycleId).toBeDefined();

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/cycles?symbol=SOLUSDT',
    });
    expect(listRes.statusCode).toBe(200);
    const list = JSON.parse(listRes.body);
    expect(list.cycles.length).toBeGreaterThan(0);

    const explainRes = await app.inject({
      method: 'GET',
      url: `/api/v1/agents/cycles/${cycle.cycleId}/explain`,
    });
    expect(explainRes.statusCode).toBe(200);
    const explanation = JSON.parse(explainRes.body);
    expect(explanation.cycleId).toBe(cycle.cycleId);
    expect(explanation.summary).toBeDefined();

    await server.stop();
  });
});
