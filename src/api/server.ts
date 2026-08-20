import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PaperBroker } from '../broker/PaperBroker.js';
import type { StrategyEngine } from '../strategy/StrategyEngine.js';
import type { SignalRepository } from '../persistence/repositories/SignalRepository.js';
import type { EventLog } from '../persistence/EventLog.js';
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

export interface ApiServerOptions {
  broker: PaperBroker;
  engine: StrategyEngine;
  signals: SignalRepository;
  events: EventLog;
  host?: string;
  port?: number;
}

export class ApiServer {
  private app: FastifyInstance;
  private broker: PaperBroker;
  private engine: StrategyEngine;
  private signals: SignalRepository;
  private events: EventLog;
  private host: string;
  private port: number;
  private startedAt = Date.now();

  constructor(options: ApiServerOptions) {
    this.broker = options.broker;
    this.engine = options.engine;
    this.signals = options.signals;
    this.events = options.events;
    this.host = options.host ?? '0.0.0.0';
    this.port = options.port ?? 8080;

    this.app = Fastify({ logger: false });
    this.registerRoutes();
  }

  private registerRoutes(): void {
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

    this.app.get('/fills', async () => this.broker.getFills());

    this.app.get('/signals', async () => this.signals.list({ limit: 100 }));

    this.app.get('/metrics', async (_request, reply) => {
      return reply
        .type('text/plain')
        .send(metrics.renderPrometheus());
    });

    this.app.post('/orders', async (request, reply) => {
      const parsed = CreateOrderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'INVALID_ORDER', details: parsed.error.flatten() });
      }

      const { quantity, ...rest } = parsed.data;

      try {
        const order = this.broker.submitOrder({
          ...rest,
          quantity,
        });
        this.events.appendOrderEvent({
          eventType: order.status === 'REJECTED' ? 'ORDER_REJECTED' : 'ORDER_ACCEPTED',
          orderId: order.id,
          accountId: order.accountId,
          symbol: order.symbol,
          oldStatus: 'NEW',
          newStatus: order.status,
          reason: order.rejectReason,
          createdAtUtc: order.updatedAtUtc,
        });
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

      const order = this.broker.cancelOrder(parsed.data.orderId);
      if (!order) {
        return reply.code(404).send({ error: 'ORDER_NOT_FOUND' });
      }

      metrics.inc('orders_canceled_total');
      return reply.send(order);
    });

    this.app.post('/orders/cancel-all', async (request) => {
      const parsed = CancelAllSchema.safeParse(request.body);
      const symbol = parsed.success ? parsed.data.symbol : undefined;
      this.broker.cancelAllOrders(symbol);
      metrics.inc('orders_cancel_all_total');
      return { canceled: true, symbol: symbol ?? 'all' };
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
      this.broker.cancelAllOrders();
      this.engine.stop();
      metrics.inc('kill_switch_activations_total');
      return { killSwitch: true };
    });
  }

  async start(): Promise<void> {
    await this.app.listen({ host: this.host, port: this.port });
    logger.info(`API server listening on http://${this.host}:${this.port}`);
  }

  async stop(): Promise<void> {
    await this.app.close();
  }
}