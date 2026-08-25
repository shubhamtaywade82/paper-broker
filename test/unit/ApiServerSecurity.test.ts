import { describe, it, expect, vi } from 'vitest';
import { ApiServer } from '../../src/api/server.js';
import type { ExecutionBroker, Order } from '../../src/broker/types.js';
import type { StrategyEngine } from '../../src/strategy/StrategyEngine.js';
import type { SignalRepository } from '../../src/persistence/repositories/SignalRepository.js';
import type { EventLog } from '../../src/persistence/EventLog.js';
import { resolveRuntimeProfile } from '../../src/config/modes/resolver.js';

describe('ApiServer security hardening', () => {
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
    isRunning: vi.fn().mockReturnValue(true),
  } as unknown as StrategyEngine;

  const mockSignals = {
    list: vi.fn().mockResolvedValue([]),
  } as unknown as SignalRepository;

  function makeMockEvents() {
    return {
      appendOrderEvent: vi.fn(),
      logAgentCycle: vi.fn(),
      getEvents: vi.fn().mockReturnValue([]),
      getAgentCycles: vi.fn().mockReturnValue([]),
      getAgentCycleById: vi.fn().mockReturnValue(undefined),
    } as unknown as EventLog;
  }

  describe('C-01: API key authentication', () => {
    it('rejects order submission without an API key when one is configured', async () => {
      const server = new ApiServer({
        broker: mockBroker,
        engine: mockEngine,
        signals: mockSignals,
        events: makeMockEvents(),
        port: 0,
        apiKey: 'test-secret-key-1234567890',
      });
      await server.start();
      const app = server.getApp();

      const res = await app.inject({
        method: 'POST',
        url: '/orders',
        payload: { symbol: 'SOLUSDT', side: 'BUY', type: 'LIMIT', quantity: 5, price: 90 },
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('UNAUTHORIZED');
      await server.stop();
    });

    it('rejects order submission with an incorrect API key', async () => {
      const server = new ApiServer({
        broker: mockBroker,
        engine: mockEngine,
        signals: mockSignals,
        events: makeMockEvents(),
        port: 0,
        apiKey: 'test-secret-key-1234567890',
      });
      await server.start();
      const app = server.getApp();

      const res = await app.inject({
        method: 'POST',
        url: '/orders',
        headers: { authorization: 'Bearer wrong-key' },
        payload: { symbol: 'SOLUSDT', side: 'BUY', type: 'LIMIT', quantity: 5, price: 90 },
      });
      expect(res.statusCode).toBe(401);
      await server.stop();
    });

    it('accepts order submission with the correct API key via Authorization header', async () => {
      const server = new ApiServer({
        broker: mockBroker,
        engine: mockEngine,
        signals: mockSignals,
        events: makeMockEvents(),
        port: 0,
        apiKey: 'test-secret-key-1234567890',
      });
      await server.start();
      const app = server.getApp();

      const res = await app.inject({
        method: 'POST',
        url: '/orders',
        headers: { authorization: 'Bearer test-secret-key-1234567890' },
        payload: { symbol: 'SOLUSDT', side: 'BUY', type: 'LIMIT', quantity: 5, price: 90 },
      });
      expect(res.statusCode).toBe(201);
      await server.stop();
    });

    it('accepts requests with the correct key via x-api-key header', async () => {
      const server = new ApiServer({
        broker: mockBroker,
        engine: mockEngine,
        signals: mockSignals,
        events: makeMockEvents(),
        port: 0,
        apiKey: 'test-secret-key-1234567890',
      });
      await server.start();
      const app = server.getApp();

      const res = await app.inject({
        method: 'POST',
        url: '/engine/kill-switch',
        headers: { 'x-api-key': 'test-secret-key-1234567890' },
      });
      expect(res.statusCode).toBe(200);
      await server.stop();
    });

    it('rejects kill-switch and mode/arm without a key when configured', async () => {
      const profile = resolveRuntimeProfile({ TRADING_MODE: 'live', LIVE_TRADING_ARMED: false });
      const server = new ApiServer({
        broker: mockBroker,
        engine: mockEngine,
        signals: mockSignals,
        events: makeMockEvents(),
        profile,
        port: 0,
        apiKey: 'test-secret-key-1234567890',
      });
      await server.start();
      const app = server.getApp();

      const killRes = await app.inject({ method: 'POST', url: '/engine/kill-switch' });
      expect(killRes.statusCode).toBe(401);

      const armRes = await app.inject({ method: 'POST', url: '/api/v1/mode/arm', payload: {} });
      expect(armRes.statusCode).toBe(401);
      expect(profile.liveArmed).toBe(false);
      await server.stop();
    });

    it('leaves endpoints open when no API key is configured (backward compatible)', async () => {
      const server = new ApiServer({
        broker: mockBroker,
        engine: mockEngine,
        signals: mockSignals,
        events: makeMockEvents(),
        port: 0,
      });
      await server.start();
      const app = server.getApp();

      const res = await app.inject({ method: 'POST', url: '/engine/kill-switch' });
      expect(res.statusCode).toBe(200);
      await server.stop();
    });
  });

  describe('C-01: live-arm passcode', () => {
    it('rejects arming when passcode is required but missing/incorrect', async () => {
      const profile = resolveRuntimeProfile({ TRADING_MODE: 'live', LIVE_TRADING_ARMED: false });
      const server = new ApiServer({
        broker: mockBroker,
        engine: mockEngine,
        signals: mockSignals,
        events: makeMockEvents(),
        profile,
        port: 0,
        armPasscode: 'correct-horse-battery-staple',
      });
      await server.start();
      const app = server.getApp();

      const noPasscodeRes = await app.inject({ method: 'POST', url: '/api/v1/mode/arm', payload: {} });
      expect(noPasscodeRes.statusCode).toBe(403);
      expect(profile.liveArmed).toBe(false);

      const wrongPasscodeRes = await app.inject({
        method: 'POST',
        url: '/api/v1/mode/arm',
        payload: { passcode: 'wrong' },
      });
      expect(wrongPasscodeRes.statusCode).toBe(403);
      expect(profile.liveArmed).toBe(false);

      const correctRes = await app.inject({
        method: 'POST',
        url: '/api/v1/mode/arm',
        payload: { passcode: 'correct-horse-battery-staple' },
      });
      expect(correctRes.statusCode).toBe(200);
      expect(profile.liveArmed).toBe(true);
      await server.stop();
    });
  });

  describe('C-02: path traversal in /assets/:file', () => {
    it('rejects traversal sequences instead of leaking arbitrary files', async () => {
      const server = new ApiServer({
        broker: mockBroker,
        engine: mockEngine,
        signals: mockSignals,
        events: makeMockEvents(),
        port: 0,
      });
      await server.start();
      const app = server.getApp();

      const res = await app.inject({
        method: 'GET',
        url: '/assets/' + encodeURIComponent('../../package.json'),
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toBe('INVALID_FILE_PARAM');
      expect(res.body).not.toContain('"name": "paper-broker"');
      await server.stop();
    });

    it('returns 404 (not a leaked file) for a plain nonexistent asset name', async () => {
      const server = new ApiServer({
        broker: mockBroker,
        engine: mockEngine,
        signals: mockSignals,
        events: makeMockEvents(),
        port: 0,
      });
      await server.start();
      const app = server.getApp();

      const res = await app.inject({ method: 'GET', url: '/assets/does-not-exist.js' });
      expect(res.statusCode).toBe(404);
      await server.stop();
    });
  });

  describe('H-01: query limit clamping', () => {
    it('clamps an oversized limit param on /api/v1/activity', async () => {
      const mockEvents = makeMockEvents();
      const server = new ApiServer({
        broker: mockBroker,
        engine: mockEngine,
        signals: mockSignals,
        events: mockEvents,
        port: 0,
      });
      await server.start();
      const app = server.getApp();

      const res = await app.inject({ method: 'GET', url: '/api/v1/activity?limit=999999999' });
      expect(res.statusCode).toBe(200);
      expect(mockEvents.getEvents).toHaveBeenCalledWith({ limit: 1000 });
      await server.stop();
    });
  });

  describe('H-02: symbol validation on Binance proxy endpoints', () => {
    it('rejects malformed symbol on /api/v1/orderbook', async () => {
      const server = new ApiServer({
        broker: mockBroker,
        engine: mockEngine,
        signals: mockSignals,
        events: makeMockEvents(),
        port: 0,
      });
      await server.start();
      const app = server.getApp();

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/orderbook?symbol=' + encodeURIComponent('SOL&foo=bar'),
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toBe('INVALID_SYMBOL');
      await server.stop();
    });

    it('rejects malformed symbol on /api/v1/trades', async () => {
      const server = new ApiServer({
        broker: mockBroker,
        engine: mockEngine,
        signals: mockSignals,
        events: makeMockEvents(),
        port: 0,
      });
      await server.start();
      const app = server.getApp();

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/trades?symbol=' + encodeURIComponent('../../etc'),
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toBe('INVALID_SYMBOL');
      await server.stop();
    });
  });
});
