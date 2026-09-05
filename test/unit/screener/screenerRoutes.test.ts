import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiServer } from '../../../src/api/server.js';
import { DatabaseManager } from '../../../src/persistence/db.js';
import { EventLog } from '../../../src/persistence/EventLog.js';
import type { ExecutionBroker } from '../../../src/broker/types.js';
import type { StrategyEngine } from '../../../src/strategy/StrategyEngine.js';
import type { SignalRepository } from '../../../src/persistence/repositories/SignalRepository.js';
import type { BinanceClient } from '@nemesis-oss/binance-sdk';
import * as screenerModule from '../../../src/screener/screener.js';

// Minimal fixture pattern copied from test/unit/ApiServerEndpoints.test.ts
// ("POST /api/v1/wallets/transfer moves funds between product wallets"):
// a real EventLog backed by a tmp-dir SQLite DB, so getEvents()'s type
// filtering behaves for real instead of needing to be hand-mocked per test.
const mockBroker = {
  submitOrder: vi.fn(),
  cancelOrder: vi.fn(),
  cancelAllOrders: vi.fn(),
  getOpenOrders: vi.fn().mockResolvedValue([]),
  getPositions: vi.fn().mockResolvedValue([]),
  getPosition: vi.fn().mockResolvedValue(undefined),
  getAccount: vi.fn().mockResolvedValue({ walletBalance: 10000, equity: 10000 }),
} as unknown as ExecutionBroker;

const mockEngine = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn(),
  isRunning: vi.fn().mockReturnValue(true),
} as unknown as StrategyEngine;

const mockSignals = {
  list: vi.fn().mockResolvedValue([]),
} as unknown as SignalRepository;

function makeServer(opts: { apiKey?: string; noBinanceClient?: boolean } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-broker-screener-test-'));
  const db = new DatabaseManager(dataDir);
  const events = new EventLog(path.join(dataDir, 'events.jsonl'), db.raw);
  const server = new ApiServer({
    broker: mockBroker,
    engine: mockEngine,
    signals: mockSignals,
    events,
    port: 0,
    apiKey: opts.apiKey,
    binanceClient: opts.noBinanceClient ? undefined : ({} as unknown as BinanceClient),
  });
  return { server, events };
}

describe('screener routes', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it('POST /api/v1/screener/run triggers a scan and returns the result', async () => {
    const fakeResult = {
      totalScreened: 1, totalPassed: 1, skippedNoHistory: [], skippedFetchFailed: [],
      candidates: [], topPicks: ['BTCUSDT'], screenedAt: Date.now(),
    };
    vi.spyOn(screenerModule, 'screen').mockResolvedValue(fakeResult as never);

    const { server } = makeServer({ apiKey: 'test-key' });
    await server.start();
    const app = server.getApp();

    const res = await app.inject({
      method: 'POST', url: '/api/v1/screener/run',
      headers: { 'x-api-key': 'test-key' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ topPicks: ['BTCUSDT'] });
    await server.stop();
  });

  it('POST /api/v1/screener/run rejects a concurrent scan with 429 SCREENER_IN_PROGRESS', async () => {
    let resolveScreen!: (v: unknown) => void;
    vi.spyOn(screenerModule, 'screen').mockImplementation(
      () => new Promise((resolve) => { resolveScreen = resolve; })
    );

    const { server } = makeServer({ apiKey: 'test-key' });
    await server.start();
    const app = server.getApp();

    const firstRequest = app.inject({
      method: 'POST', url: '/api/v1/screener/run',
      headers: { 'x-api-key': 'test-key' },
    });
    await new Promise((r) => setImmediate(r)); // let the first request enter the handler

    const secondRes = await app.inject({
      method: 'POST', url: '/api/v1/screener/run',
      headers: { 'x-api-key': 'test-key' },
    });
    expect(secondRes.statusCode).toBe(429);
    expect(JSON.parse(secondRes.body).error).toBe('SCREENER_IN_PROGRESS');

    resolveScreen({
      totalScreened: 0, totalPassed: 0, skippedNoHistory: [], skippedFetchFailed: [],
      candidates: [], topPicks: [], screenedAt: Date.now(), universeSize: 0,
    });
    const firstRes = await firstRequest;
    expect(firstRes.statusCode).toBe(200);

    await server.stop();
  });

  it('POST /api/v1/screener/run allows a new scan once the previous one finished (even after an error)', async () => {
    vi.spyOn(screenerModule, 'screen').mockRejectedValueOnce(new Error('boom'));

    const { server } = makeServer({ apiKey: 'test-key' });
    await server.start();
    const app = server.getApp();

    const failedRes = await app.inject({
      method: 'POST', url: '/api/v1/screener/run',
      headers: { 'x-api-key': 'test-key' },
    });
    expect(failedRes.statusCode).toBe(500);

    vi.spyOn(screenerModule, 'screen').mockResolvedValueOnce({
      totalScreened: 0, totalPassed: 0, skippedNoHistory: [], skippedFetchFailed: [],
      candidates: [], topPicks: [], screenedAt: Date.now(), universeSize: 0,
    } as never);
    const okRes = await app.inject({
      method: 'POST', url: '/api/v1/screener/run',
      headers: { 'x-api-key': 'test-key' },
    });
    expect(okRes.statusCode).toBe(200);

    await server.stop();
  });

  it('POST /api/v1/screener/run rejects without the API key, matching every other mutating route', async () => {
    const { server } = makeServer({ apiKey: 'test-key' });
    await server.start();
    const app = server.getApp();

    const res = await app.inject({ method: 'POST', url: '/api/v1/screener/run' });
    expect(res.statusCode).toBe(401);
    await server.stop();
  });

  it('GET /api/v1/screener/watchlist returns the latest persisted SCREENER_RESULT event', async () => {
    const fakeResult = { topPicks: ['ETHUSDT'] };
    const { server, events } = makeServer();
    events.append('SCREENER_RESULT', fakeResult, { aggregateType: 'screener' });
    await server.start();
    const app = server.getApp();

    const res = await app.inject({ method: 'GET', url: '/api/v1/screener/watchlist' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ result: fakeResult });
    await server.stop();
  });

  it('GET /api/v1/screener/watchlist returns null/empty when no scan has ever run', async () => {
    const { server } = makeServer();
    await server.start();
    const app = server.getApp();

    const res = await app.inject({ method: 'GET', url: '/api/v1/screener/watchlist' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ result: null });
    await server.stop();
  });

  it('GET /api/v1/screener/activity returns SCREENER_STEP events, matching the /api/v1/agents/steps shape', async () => {
    const { server, events } = makeServer();
    events.append('SCREENER_STEP', { message: 'Scanning BTCUSDT', engine: 'deterministic' }, { aggregateType: 'screener' });
    await server.start();
    const app = server.getApp();

    const res = await app.inject({ method: 'GET', url: '/api/v1/screener/activity' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ steps: [{ message: 'Scanning BTCUSDT', engine: 'deterministic' }] });
    await server.stop();
  });
});
