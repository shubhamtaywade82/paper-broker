import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { z } from 'zod';
import type { ExecutionBroker } from '../broker/types.js';
import type { StrategyEngine } from '../strategy/StrategyEngine.js';
import type { SignalRepository } from '../persistence/repositories/SignalRepository.js';
import type { EventLog } from '../persistence/EventLog.js';
import type { RuntimeProfile } from '../config/modes/types.js';
import type { MarketDataSupervisor } from '../market/supervisor/MarketDataSupervisor.js';
import type { ErrorNormalizer } from '../notifications/error-pipeline/ErrorNormalizer.js';
import type { KlineStore } from '../market/Klines.js';
import type { SnapshotStore } from '../persistence/SnapshotStore.js';
import type { MarketStateManager } from '../market/MarketState.js';
import type { WebSocket } from 'ws';
import { DASHBOARD_HTML } from './dashboardHtml.js';
import { WebSocketGateway } from './websocket/WebSocketGateway.js';
import { metrics } from '../telemetry/metrics.js';
import { logger } from '../telemetry/logger.js';

const CreateOrderSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  type: z.enum(['MARKET', 'LIMIT', 'STOP_MARKET', 'TAKE_PROFIT_MARKET']),
  quantity: z.number().positive(),
  price: z.number().positive().optional(),
  stopPrice: z.number().positive().optional(),
  reduceOnly: z.boolean().optional(),
  postOnly: z.boolean().optional(),
  leverage: z.number().int().positive().optional(),
  strategyId: z.string().optional(),
});

const CancelOrderSchema = z.object({
  orderId: z.string().min(1),
});

const CancelAllSchema = z.object({
  symbol: z.string().optional(),
});

const ArmModeSchema = z.object({
  passcode: z.string().min(1).optional(),
});

export interface ApiServerOptions {
  broker: ExecutionBroker;
  engine: StrategyEngine;
  signals: SignalRepository;
  events: EventLog;
  klines?: KlineStore;
  snapshots?: SnapshotStore;
  profile?: RuntimeProfile;
  supervisor?: MarketDataSupervisor;
  errorNormalizer?: ErrorNormalizer;
  marketState?: MarketStateManager;
  wsGateway?: WebSocketGateway;
  host?: string;
  port?: number;
}

export class ApiServer {
  private app: FastifyInstance;
  private broker: ExecutionBroker;
  private engine: StrategyEngine;
  private signals: SignalRepository;
  private events: EventLog;
  private klines?: KlineStore;
  private snapshots?: SnapshotStore;
  private profile?: RuntimeProfile;
  private supervisor?: MarketDataSupervisor;
  private errorNormalizer?: ErrorNormalizer;
  private marketState?: MarketStateManager;
  public readonly wsGateway: WebSocketGateway;
  private host: string;
  private port: number;
  private startedAt = Date.now();

  constructor(options: ApiServerOptions) {
    this.broker = options.broker;
    this.engine = options.engine;
    this.signals = options.signals;
    this.events = options.events;
    this.klines = options.klines;
    this.snapshots = options.snapshots;
    this.profile = options.profile;
    this.supervisor = options.supervisor;
    this.errorNormalizer = options.errorNormalizer;
    this.marketState = options.marketState;
    this.wsGateway = options.wsGateway ?? new WebSocketGateway();
    this.host = options.host ?? '0.0.0.0';
    this.port = options.port ?? 8080;

    this.app = Fastify({ logger: false });
  }

  private async init(): Promise<void> {
    await this.app.register(fastifyWebsocket);
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.registerWebSocketRoutes();
    this.registerQueryRoutes();
    this.registerCommandRoutes();
    this.registerDashboardRoutes();
  }

  private registerWebSocketRoutes(): void {
    this.app.get('/ws', { websocket: true }, (connection: unknown) => {
      const socket = (connection as { socket?: WebSocket }).socket ?? (connection as WebSocket);
      if (socket) {
        this.wsGateway.addClient(socket);
      }
    });
  }

  private registerQueryRoutes(): void {
    this.app.get('/health', async () => ({
      status: 'ok',
      uptimeMs: Date.now() - this.startedAt,
      startedAt: new Date(this.startedAt).toISOString(),
    }));

    this.app.get('/account', async () => this.broker.getAccount());
    this.app.get('/positions', async () => this.broker.getPositions());
    this.app.get('/orders', async (request) => {
      const query = request.query as { symbol?: string };
      return this.broker.getOpenOrders(query.symbol);
    });
    this.app.get('/signals', async () => this.signals.list({ limit: 100 }));
    this.app.get('/metrics', async (_req, reply) => {
      return reply.type('text/plain').send(metrics.renderPrometheus());
    });
  }

  private registerDashboardRoutes(): void {
    this.app.get('/', async (_req, reply) => {
      return reply.type('text/html').send(DASHBOARD_HTML);
    });

    this.app.get('/dashboard', async (_req, reply) => {
      return reply.type('text/html').send(DASHBOARD_HTML);
    });

    this.app.get('/favicon.ico', async (_req, reply) => {
      return reply.status(204).send();
    });

    this.app.get('/api/v1/dashboard', async () => {
      const [account, positions, recentSignals] = await Promise.all([
        this.broker.getAccount(),
        this.broker.getPositions(),
        this.signals.list({ limit: 10 }),
      ]);

      return {
        mode: this.profile?.mode ?? 'paper',
        liveArmed: this.profile?.liveArmed ?? false,
        realOrders: this.profile?.realOrders ?? false,
        account,
        positions,
        signals: recentSignals,
        health: {
          uptimeMs: Date.now() - this.startedAt,
          activeProvider: this.supervisor?.getActiveProvider() ?? 'BINANCE',
          binance: this.supervisor?.health.getHealth('BINANCE'),
          coindcx: this.supervisor?.health.getHealth('COINDCX'),
        },
        incidents: this.errorNormalizer?.getRecentIncidents(10) ?? [],
      };
    });

    this.app.get('/api/v1/health/providers', async () => ({
      activeProvider: this.supervisor?.getActiveProvider() ?? 'BINANCE',
      binance: this.supervisor?.health.getHealth('BINANCE'),
      coindcx: this.supervisor?.health.getHealth('COINDCX'),
    }));

    this.app.get('/api/v1/incidents', async () => ({
      incidents: this.errorNormalizer?.getRecentIncidents(50) ?? [],
    }));

    this.app.get('/api/v1/klines', async (request) => {
      const query = request.query as { symbol?: string; interval?: string; limit?: string };
      const symbol = query.symbol || 'SOLUSDT';
      const interval = query.interval || '15m';
      const limit = query.limit ? parseInt(query.limit, 10) : 100;
      let cached = this.klines?.getCandles(symbol, interval, limit) ?? [];
      if (cached.length === 0 && this.klines) {
        cached = await this.klines.fetchHistoricalKlines(symbol, interval, limit);
      }
      return cached;
    });

    this.app.get('/api/v1/activity', async (request) => {
      const query = request.query as { limit?: string };
      const limit = query.limit ? parseInt(query.limit, 10) : 20;
      const events = this.events.getEvents({ limit });
      return events.map(e => ({
        id: e.id,
        type: e.type,
        ts: e.ts,
        payload: e.payload,
      }));
    });

    this.app.get('/api/v1/equity-curve', async (request) => {
      const query = request.query as { limit?: string };
      const limit = query.limit ? parseInt(query.limit, 10) : 100;
      if (!this.snapshots) return [];
      return this.snapshots.queryAccountSnapshots('paper-main', limit);
    });

    this.app.get('/api/v1/win-rate', async () => {
      const fills = this.events.getEvents({ type: 'FILL_CREATED', limit: 500 });
      let wins = 0;
      let losses = 0;
      const tradePnl = new Map<string, number>();

      for (const fill of fills) {
        const p = fill.payload as Record<string, unknown>;
        const orderId = String(p['orderId'] || '');
        const side = String(p['side'] || '');
        const qty = Number(p['quantity'] || p['qty'] || 0);
        const price = Number(p['price'] || 0);
        if (!orderId || !price) continue;

        const current = tradePnl.get(orderId) ?? 0;
        tradePnl.set(orderId, current + (side === 'BUY' ? -price * qty : price * qty));
      }

      for (const [, pnl] of tradePnl) {
        if (pnl > 0) wins++;
        else if (pnl < 0) losses++;
      }

      const total = wins + losses;
      return {
        wins,
        losses,
        total,
        winRate: total > 0 ? (wins / total) * 100 : 0,
      };
    });

    this.app.get('/api/v1/orderbook', async (request) => {
      const query = request.query as { symbol?: string };
      const symbol = query.symbol || 'SOLUSDT';
      if (!this.marketState) return null;
      const state = this.marketState.getState(symbol);
      if (!state) return null;
      return {
        symbol,
        bid: state.bid,
        ask: state.ask,
        bidQty: state.bidQty,
        askQty: state.askQty,
        spread: state.spread,
        last: state.last,
        mark: state.mark,
      };
    });

    this.app.get('/api/v1/trades', async (request) => {
      const query = request.query as { symbol?: string; limit?: string };
      const symbol = query.symbol || 'SOLUSDT';
      const limit = query.limit ? parseInt(query.limit, 10) : 20;
      try {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/trades?symbol=${symbol}&limit=${limit}`);
        if (!res.ok) return [];
        const data = (await res.json()) as Array<{ price: string; qty: string; time: number; isBuyerMaker: boolean }>;
        if (!Array.isArray(data)) return [];
        return data.map((t) => ({
          price: parseFloat(t.price),
          qty: parseFloat(t.qty),
          ts: t.time,
          isBuyerMaker: t.isBuyerMaker,
        }));
      } catch {
        return [];
      }
    });

    this.app.get('/api/v1/tickers', async () => {
      try {
        const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
        if (!res.ok) return [];
        return await res.json();
      } catch {
        return [];
      }
    });
  }

  private registerCommandRoutes(): void {
    this.app.post('/orders', async (request, reply) => {
      const parsed = CreateOrderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'INVALID_ORDER', details: parsed.error.flatten() });
      }

      try {
        const order = await this.broker.submitOrder(parsed.data);
        this.wsGateway.broadcast('order.updated', order);
        metrics.inc('orders_submitted_total');
        return reply.code(order.status === 'REJECTED' ? 400 : 201).send(order);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        return reply.code(400).send({ error: 'ORDER_FAILED', message });
      }
    });

    this.app.post('/orders/cancel', async (request, reply) => {
      const parsed = CancelOrderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
      }

      const order = await this.broker.cancelOrder(parsed.data.orderId);
      if (!order) {
        return reply.code(404).send({ error: 'ORDER_NOT_FOUND' });
      }
      this.wsGateway.broadcast('order.updated', order);
      metrics.inc('orders_canceled_total');
      return reply.send(order);
    });

    this.app.post('/orders/cancel-all', async (request) => {
      const parsed = CancelAllSchema.safeParse(request.body);
      const symbol = parsed.success ? parsed.data.symbol : undefined;
      await this.broker.cancelAllOrders(symbol);
      metrics.inc('orders_cancel_all_total');
      return { canceled: true, symbol: symbol ?? 'all' };
    });

    this.app.post('/api/v1/mode/arm', async (request, reply) => {
      const parsed = ArmModeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'INVALID_REQUEST' });
      }
      if (this.profile) {
        this.profile.liveArmed = true;
      }
      this.wsGateway.broadcast('mode.changed', { mode: this.profile?.mode, liveArmed: true });
      return reply.send({ armed: true });
    });

    this.app.post('/engine/start', async () => {
      await this.engine.start();
      metrics.inc('engine_starts_total');
      return { started: true };
    });

    this.app.post('/engine/stop', async () => {
      this.engine.stop();
      metrics.inc('engine_stops_total');
      return { stopped: true };
    });

    this.app.post('/engine/kill-switch', async () => {
      await this.broker.cancelAllOrders();
      this.engine.stop();
      this.wsGateway.broadcast('kill_switch.activated', { activatedAtUtc: new Date().toISOString() });
      metrics.inc('kill_switch_activations_total');
      return { killSwitch: true };
    });
  }

  public getApp(): FastifyInstance {
    return this.app;
  }

  async start(): Promise<void> {
    await this.init();
    await this.app.listen({ host: this.host, port: this.port });
    logger.info(`API server listening on http://${this.host}:${this.port}`);
  }

  async stop(): Promise<void> {
    this.wsGateway.closeAll();
    await this.app.close();
  }
}