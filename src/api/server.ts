import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
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
import { TradingAgentsPipeline } from '../ai/tradingAgents.js';
import { env } from '../config/env.js';
import { metrics } from '../telemetry/metrics.js';
import { logger } from '../telemetry/logger.js';
import { ReplayEngine } from '../research/replay/ReplayEngine.js';
import { BinanceHistoricalFetcher } from '../research/replay/BinanceHistoricalFetcher.js';
import type { ReplayConfig } from '../research/replay/types.js';
import type { ProfitGoalManager } from '../trading/goals/ProfitGoalManager.js';
import type { StrategyPerformanceTracker } from '../strategy/StrategyPerformanceTracker.js';
import type { LiveTradingGuard } from '../execution/LiveTradingGuard.js';
import type { ExchangeReconciler } from '../execution/ExchangeReconciler.js';
import type { RiskConfig } from '../trading/risk/types.js';
import { DEFAULT_RISK_CONFIG } from '../trading/risk/RiskLimits.js';
import { RateLimiter, DEFAULT_RATE_LIMITS, type RateLimiterOptions, type RateLimitScope } from './RateLimiter.js';

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

const MAX_QUERY_LIMIT = 1000;

/** Clamps a client-supplied `limit` query param into [1, MAX_QUERY_LIMIT], falling back to `def` when absent/invalid. */
function parseLimit(raw: string | undefined, def: number, max = MAX_QUERY_LIMIT): number {
  const n = raw !== undefined ? parseInt(raw, 10) : def;
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

const SYMBOL_PATTERN = /^[A-Z0-9]{2,20}$/;

/** Whitelists symbol values before they are interpolated into outbound Binance proxy URLs. */
function isValidSymbol(symbol: string): boolean {
  return SYMBOL_PATTERN.test(symbol);
}

/** Constant-time string comparison for API key checks (mismatched lengths short-circuit safely). */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

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
  onSetAggressiveMode?: (enabled: boolean) => void;
  getAggressiveMode?: () => boolean;
  onTriggerEvaluation?: () => Promise<number>;
  /** When set, requires `Authorization: Bearer <apiKey>` (or `x-api-key`) on all order/engine/mode control endpoints. */
  apiKey?: string;
  /** When set, `/api/v1/mode/arm` requires a matching `passcode` in the request body. */
  armPasscode?: string;
  /** Profit-goal state, surfaced read-only at `/api/v1/profit-goals`. */
  profitGoals?: ProfitGoalManager;
  /** Per-strategy performance, surfaced at `/api/v1/strategies/performance`. */
  strategyPerformance?: StrategyPerformanceTracker;
  /** The live guard actually in force, so `/api/v1/risk` reports real safe-mode state. */
  liveGuard?: LiveTradingGuard;
  /** The risk limits actually in force, so `/api/v1/risk` stops reporting hardcoded values. */
  riskConfig?: RiskConfig;
  /** Live-mode exchange reconciliation, surfaced at `/api/v1/reconcile`. */
  reconciler?: ExchangeReconciler;
  /**
   * Rate limit tiers. Defaults are generous enough that a 1s-polling dashboard
   * is unaffected. Pass `false` to disable entirely (tests, trusted networks).
   */
  rateLimits?: RateLimiterOptions | false;
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
  private options: ApiServerOptions;
  private backtestInFlight = false;
  private indexHtmlCache?: string;
  private readonly assetCache = new Map<string, Buffer>();
  private rateLimiter?: RateLimiter;

  constructor(options: ApiServerOptions) {
    this.options = options;
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
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 8080;
    if (options.rateLimits !== false) {
      this.rateLimiter = new RateLimiter(options.rateLimits ?? DEFAULT_RATE_LIMITS);
    }

    this.app = Fastify({ logger: false });
  }

  private async init(): Promise<void> {
    await this.app.register(fastifyWebsocket);
    if (!this.options.apiKey) {
      logger.warn('API_KEY not configured — order/engine/mode control endpoints are unauthenticated (assumes trusted/localhost deployment)');
    }
    this.registerRoutes();
  }

  /**
   * Fastify preHandler guarding order submission, kill switch, mode/arm, and engine
   * control routes. No-ops when `apiKey` is unset so local/dev/test deployments keep
   * working without configuration (see PROJECT_STATE.md "No authentication on API yet").
   */
  private requireApiKey = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const expected = this.options.apiKey;
    if (!expected) return;

    const authHeader = request.headers['authorization'];
    const bearer = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;
    const apiKeyHeader = request.headers['x-api-key'];
    const provided = bearer ?? (typeof apiKeyHeader === 'string' ? apiKeyHeader : undefined);

    if (!provided || !safeEqual(provided, expected)) {
      metrics.inc('api_auth_rejections_total');
      reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Valid API key required' });
    }
  };

  /**
   * Which tier a request belongs to. Anything that mutates state — orders, kill
   * switch, mode arming, backtests, quarantine release — is `control`.
   * Everything else is a read.
   */
  private static scopeFor(method: string, url: string): RateLimitScope {
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return 'read';
    void url;
    return 'control';
  }

  /**
   * Global onRequest rate limit. Registered before routes so it also covers
   * unmatched paths — an unauthenticated scanner hammering 404s should still be
   * throttled.
   *
   * The WebSocket upgrade path is exempt: it is one long-lived connection per
   * client, already bounded by WebSocketGateway's own connection limit, and
   * counting it against the read budget would penalise the dashboard for
   * staying connected.
   */
  private registerRateLimit(): void {
    const limiter = this.rateLimiter;
    if (!limiter) return;

    this.app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.url.startsWith('/ws')) return;

      const key = request.ip || 'unknown';
      const scope = ApiServer.scopeFor(request.method, request.url);
      const decision = limiter.check(key, scope);

      if (!decision.allowed) {
        metrics.inc('api_rate_limit_rejections_total');
        reply
          .code(429)
          .header('Retry-After', String(decision.retryAfterSec ?? 1))
          .send({
            error: 'RATE_LIMITED',
            message: `Too many ${scope} requests. Retry in ${decision.retryAfterSec ?? 1}s.`,
          });
      }
    });
  }

  private registerRoutes(): void {
    this.registerRateLimit();
    this.registerWebSocketRoutes();
    this.registerQueryRoutes();
    this.registerBacktestRoutes();
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
    const distPath = path.resolve(process.cwd(), 'dashboard', 'dist');
    const indexPath = path.join(distPath, 'index.html');

    const assetsDir = path.resolve(distPath, 'assets');

    this.app.get('/assets/:file', async (request, reply) => {
      const { file } = request.params as { file: string };
      // Strip any directory components (blocks "../" traversal) and reject
      // anything that still doesn't round-trip to a bare filename.
      const safeName = path.basename(file);
      if (!safeName || safeName === '.' || safeName === '..' || safeName !== file) {
        return reply.code(400).send({ error: 'INVALID_FILE_PARAM' });
      }
      const filePath = path.join(assetsDir, safeName);

      const cached = this.assetCache.get(safeName);
      if (cached) {
        const ext = path.extname(safeName);
        const mimeType = ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
        return reply.type(mimeType).send(cached);
      }

      try {
        const contents = await fs.promises.readFile(filePath);
        this.assetCache.set(safeName, contents);
        const ext = path.extname(safeName);
        const mimeType = ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
        return reply.type(mimeType).send(contents);
      } catch {
        return reply.code(404).send({ error: 'FILE_NOT_FOUND' });
      }
    });

    const readIndexHtml = async (): Promise<string> => {
      if (this.indexHtmlCache !== undefined) return this.indexHtmlCache;
      try {
        this.indexHtmlCache = await fs.promises.readFile(indexPath, 'utf-8');
      } catch {
        this.indexHtmlCache = DASHBOARD_HTML;
      }
      return this.indexHtmlCache;
    };

    this.app.get('/', async (_req, reply) => {
      return reply.type('text/html').send(await readIndexHtml());
    });

    this.app.get('/dashboard', async (_req, reply) => {
      return reply.type('text/html').send(await readIndexHtml());
    });

    this.app.get('/favicon.ico', async (_req, reply) => {
      return reply.status(204).send();
    });

    this.app.get('/api/v1/state/snapshot', async () => {
      const [account, positions, openOrders, recentSignals] = await Promise.all([
        this.broker.getAccount(),
        this.broker.getPositions(),
        this.broker.getOpenOrders(),
        this.signals.list({ limit: 20 }),
      ]);

      return {
        stateVersion: Date.now(),
        serverTimeUtc: new Date().toISOString(),
        mode: this.profile?.mode ?? 'paper',
        liveArmed: this.profile?.liveArmed ?? false,
        realOrders: this.profile?.realOrders ?? false,
        account,
        positions: positions.filter((p) => p.qty !== 0),
        openOrders,
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

    this.app.get('/api/v1/risk', async () => {
      const [account, positions] = await Promise.all([
        this.broker.getAccount(),
        this.broker.getPositions(),
      ]);

      const equity = account?.equity || 10000;
      let totalNotional = 0;
      let totalMarginUsed = 0;
      for (const pos of positions) {
        const notional = Math.abs(pos.qty * (pos.markPrice || pos.entryPrice));
        totalNotional += notional;
        totalMarginUsed += notional / (pos.leverage || 1);
      }

      const exposurePct = equity > 0 ? (totalNotional / equity) * 100 : 0;
      const marginUsagePct = equity > 0 ? (totalMarginUsed / equity) * 100 : 0;

      // These used to be hardcoded literals that drifted from the limits the
      // RiskEngine actually enforces (a documented Medium finding). Report the
      // configuration in force instead.
      const riskConfig = this.options.riskConfig ?? DEFAULT_RISK_CONFIG;
      const dailyLossLimitPct = riskConfig.maxDailyLossPct * 100;
      const dailyLossPct = equity > 0 ? Math.max(0, -(account?.dailyRealizedPnl ?? 0)) / equity * 100 : 0;
      const dailyLossRemainingPct = Math.max(0, dailyLossLimitPct - dailyLossPct);
      const profitGoals = this.options.profitGoals;

      return {
        riskRating: exposurePct > 75 ? 'HIGH' : exposurePct > 40 ? 'MEDIUM' : 'LOW',
        exposurePct: Number(exposurePct.toFixed(2)),
        marginUsagePct: Number(marginUsagePct.toFixed(2)),
        openPositionsCount: positions.filter((p) => p.qty !== 0).length,
        maxOpenPositions: riskConfig.maxOpenPositions,
        dailyLossLimitPct: Number(dailyLossLimitPct.toFixed(2)),
        dailyLossRemainingPct: Number(dailyLossRemainingPct.toFixed(2)),
        safeMode: this.options.liveGuard?.isSafeMode() ?? false,
        liveArmed: this.profile?.liveArmed ?? false,
        mode: this.profile?.mode ?? 'paper',
        limits: {
          maxLeverage: riskConfig.maxLeverage,
          maxRiskPerTradePct: Number((riskConfig.riskPerTradePct * 100).toFixed(2)),
          maxAccountRiskPct: Number((riskConfig.maxAccountRiskPct * 100).toFixed(2)),
          maxPositionsPerSymbol: riskConfig.maxPositionsPerSymbol,
          maxNotionalPerTrade: riskConfig.maxNotionalPerTrade,
        },
        profitGoals: profitGoals
          ? {
              enabled: true,
              riskMultiplier: profitGoals.getCurrentRiskMultiplier(),
              tradingAllowed: profitGoals.isTradingAllowed(Date.now()),
              achieved: profitGoals.getAchievedTargets(),
            }
          : { enabled: false },
        quarantinedStrategies: this.engine.listQuarantined(),
      };
    });

    this.app.get('/api/v1/reconcile', async () => {
      const reconciler = this.options.reconciler;
      if (!reconciler) {
        return { enabled: false, reason: 'No live venue attached; reconciliation does not apply' };
      }
      return {
        enabled: true,
        safeMode: this.options.liveGuard?.isSafeMode() ?? false,
        lastReport: reconciler.getLastReport() ?? null,
      };
    });

    this.app.post('/api/v1/reconcile', { preHandler: this.requireApiKey }, async (_request, reply) => {
      const reconciler = this.options.reconciler;
      if (!reconciler) {
        return reply.code(404).send({ error: 'Reconciliation is not enabled (no live venue attached)' });
      }

      // Re-runs reconciliation and clears safe mode ONLY if it comes back
      // clean. A mismatch leaves trading halted — the operator has to fix the
      // underlying disagreement, not dismiss it.
      const report = await reconciler.reconcileAndResume('MANUAL');
      this.wsGateway.broadcast('reconciliation.report', report);
      return {
        ok: report.ok,
        safeMode: this.options.liveGuard?.isSafeMode() ?? false,
        report,
      };
    });

    this.app.get('/api/v1/profit-goals', async () => {
      const profitGoals = this.options.profitGoals;
      if (!profitGoals) {
        return { enabled: false };
      }
      return {
        enabled: true,
        config: profitGoals.getConfig(),
        state: profitGoals.getState(),
        progress: {
          dailyPct: Number(profitGoals.getDailyProgressPercent().toFixed(2)),
          weeklyPct: Number(profitGoals.getWeeklyProgressPercent().toFixed(2)),
          monthlyPct: Number(profitGoals.getMonthlyProgressPercent().toFixed(2)),
        },
        riskMultiplier: profitGoals.getCurrentRiskMultiplier(),
        tradingAllowed: profitGoals.isTradingAllowed(Date.now()),
        metrics: profitGoals.getMetrics(),
      };
    });

    this.app.get('/api/v1/strategies/performance', async () => {
      const tracker = this.options.strategyPerformance;
      return {
        enabled: Boolean(tracker),
        quarantined: this.engine.listQuarantined(),
        strategies: tracker?.listStats() ?? [],
      };
    });

    this.app.post<{ Params: { id: string } }>(
      '/api/v1/strategies/:id/release',
      { preHandler: this.requireApiKey },
      async (request, reply) => {
        const tracker = this.options.strategyPerformance;
        if (!tracker) {
          return reply.code(404).send({ error: 'Strategy performance tracking is not enabled' });
        }
        const released = tracker.release(request.params.id);
        if (!released) {
          return reply.code(404).send({ error: `Strategy ${request.params.id} is not quarantined` });
        }
        this.wsGateway.broadcast('strategy.performance', {
          strategyId: request.params.id,
          released: true,
          stats: tracker.getStats(request.params.id),
        });
        return { released: true, strategyId: request.params.id };
      }
    );

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
        aggressiveMode: this.options.getAggressiveMode?.() ?? false,
        engineRunning: typeof this.engine?.isRunning === 'function' ? this.engine.isRunning() : false,
        account,
        positions: positions.filter((p) => p.qty !== 0),
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

    this.app.get('/api/v1/klines', async (request, reply) => {
      const query = request.query as { symbol?: string; interval?: string; limit?: string };
      const symbol = (query.symbol || 'SOLUSDT').toUpperCase();
      if (!isValidSymbol(symbol)) {
        return reply.code(400).send({ error: 'INVALID_SYMBOL' });
      }
      const interval = query.interval || '15m';
      const limit = parseLimit(query.limit, 100);
      let cached = this.klines?.getCandles(symbol, interval, limit) ?? [];
      if (cached.length === 0 && this.klines) {
        cached = await this.klines.fetchHistoricalKlines(symbol, interval, limit);
      }
      return cached;
    });

    this.app.get('/api/v1/activity', async (request) => {
      const query = request.query as { limit?: string };
      const limit = parseLimit(query.limit, 20);
      const events = this.events.getEvents({ limit });
      return events.map(e => ({
        id: e.id,
        type: e.type,
        ts: e.ts,
        payload: e.payload,
      }));
    });

    this.app.get('/api/v1/fills', async (request) => {
      const query = request.query as { symbol?: string; limit?: string };
      const limit = parseLimit(query.limit, 100);
      const events = this.events.getEvents({ type: 'FILL_CREATED', limit });
      return events
        .map((e) => e.payload as Record<string, unknown>)
        .filter((f) => !query.symbol || f['symbol'] === query.symbol);
    });

    this.app.get('/api/v1/journal', async (request) => {
      const query = request.query as { symbol?: string; limit?: string };
      const limit = parseLimit(query.limit, 100);

      // signalId is shared between the order that opened a position and the
      // STOP_MARKET order placed alongside it (both come from the same Signal) —
      // that's the only link back to "what was the planned risk on this trade."
      const stopOrders = this.events.raw
        .prepare(`SELECT signal_id, stop_price FROM orders WHERE type = 'STOP_MARKET' AND signal_id IS NOT NULL`)
        .all() as Array<{ signal_id: string; stop_price: string }>;
      const stopPriceBySignal = new Map(stopOrders.map((o) => [o.signal_id, Number(o.stop_price)]));

      const closingFills = this.events
        .getEvents({ type: 'FILL_CREATED', limit: 1000 })
        .map((e) => e.payload as Record<string, unknown>)
        .filter((f) => Number(f['realizedPnl'] ?? 0) !== 0)
        .filter((f) => !query.symbol || f['symbol'] === query.symbol);

      const entries = closingFills.map((f) => {
        const signalId = f['signalId'] as string | undefined;
        const stopPrice = signalId ? stopPriceBySignal.get(signalId) : undefined;
        const entryPrice = Number(f['positionEntryBefore'] ?? 0);
        const exitPrice = Number(f['price'] ?? 0);
        const quantity = Number(f['quantity'] ?? 0);
        const realizedPnl = Number(f['realizedPnl'] ?? 0);
        const riskPerUnit = stopPrice && entryPrice ? Math.abs(entryPrice - stopPrice) : undefined;
        const rMultiple = riskPerUnit && riskPerUnit > 0 ? realizedPnl / (riskPerUnit * quantity) : undefined;

        return {
          id: f['id'],
          symbol: f['symbol'],
          side: f['side'],
          quantity,
          entryPrice,
          exitPrice,
          stopPrice: stopPrice ?? null,
          realizedPnl,
          rMultiple: rMultiple !== undefined ? Number(rMultiple.toFixed(2)) : null,
          fillTsUtc: f['fillTsUtc'],
        };
      });

      return entries.slice(0, limit);
    });

    this.app.get('/api/v1/equity-curve', async (request) => {
      const query = request.query as { limit?: string };
      const limit = parseLimit(query.limit, 100);
      if (!this.snapshots) return [];
      return this.snapshots.queryAccountSnapshots('paper-main', limit);
    });

    this.app.get('/api/v1/win-rate', async () => {
      try {
        const fills = this.events?.getEvents({ type: 'FILL_CREATED', limit: 500 }) ?? [];
        let wins = 0;
        let losses = 0;

        for (const fill of fills) {
          const p = (fill?.payload ?? {}) as Record<string, unknown>;
          const realizedPnl = Number(p['realizedPnl'] || 0);
          if (realizedPnl > 0) wins++;
          else if (realizedPnl < 0) losses++;
        }

        const total = wins + losses;
        return {
          wins,
          losses,
          total,
          winRate: total > 0 ? (wins / total) * 100 : 0,
        };
      } catch {
        return {
          wins: 0,
          losses: 0,
          total: 0,
          winRate: 0,
        };
      }
    });

    this.app.get('/api/v1/orderbook', async (request, reply) => {
      const query = request.query as { symbol?: string; limit?: string };
      const symbol = (query.symbol || 'SOLUSDT').toUpperCase();
      if (!isValidSymbol(symbol)) {
        return reply.code(400).send({ error: 'INVALID_SYMBOL' });
      }
      let binanceLimit = 50;
      const requested = query.limit ? parseInt(query.limit, 10) : 50;
      if (requested <= 5) binanceLimit = 5;
      else if (requested <= 10) binanceLimit = 10;
      else if (requested <= 20) binanceLimit = 20;
      else if (requested <= 50) binanceLimit = 50;
      else if (requested <= 100) binanceLimit = 100;
      const state = this.marketState?.getState(symbol);
      try {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=${binanceLimit}`);
        if (res.ok) {
          const depth = (await res.json()) as { bids?: Array<[string, string]>; asks?: Array<[string, string]> };
          if (Array.isArray(depth.bids) && Array.isArray(depth.asks)) {
            return {
              symbol,
              bid: state?.bid ?? (depth.bids[0] ? parseFloat(depth.bids[0][0]) : 0),
              ask: state?.ask ?? (depth.asks[0] ? parseFloat(depth.asks[0][0]) : 0),
              bidQty: state?.bidQty ?? (depth.bids[0] ? parseFloat(depth.bids[0][1]) : 0),
              askQty: state?.askQty ?? (depth.asks[0] ? parseFloat(depth.asks[0][1]) : 0),
              spread: state?.spread ?? 0,
              last: state?.last ?? 0,
              mark: state?.mark ?? 0,
              bids: depth.bids.map(([p, q]) => [parseFloat(p), parseFloat(q)]),
              asks: depth.asks.map(([p, q]) => [parseFloat(p), parseFloat(q)]),
            };
          }
        }
      } catch {
        // Fall back to market state if network fails
      }
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

    this.app.get('/api/v1/trades', async (request, reply) => {
      const query = request.query as { symbol?: string; limit?: string };
      const symbol = (query.symbol || 'SOLUSDT').toUpperCase();
      if (!isValidSymbol(symbol)) {
        return reply.code(400).send({ error: 'INVALID_SYMBOL' });
      }
      const limit = parseLimit(query.limit, 20, 1000);
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

    this.app.get('/api/v1/agents/health', async () => {
      return {
        status: 'healthy',
        engine: 'TradingAgents Multi-Agent Runtime',
        timestamp: Date.now(),
      };
    });

    this.app.get('/api/v1/agents/config', async () => {
      return {
        localBaseUrl: env.OLLAMA_BASE_URL,
        localModel: env.OLLAMA_MODEL,
        cloudBaseUrl: env.OLLAMA_CLOUD_BASE_URL,
        cloudModel: env.OLLAMA_CLOUD_MODEL,
        configuredAccountsCount: [env.OLLAMA_API_KEY_1, env.OLLAMA_API_KEY_2, env.OLLAMA_API_KEY_3].filter(Boolean).length,
        accounts: [
          {
            id: 1,
            name: 'Cloud Account 1',
            configured: Boolean(env.OLLAMA_API_KEY_1),
            maskedKey: env.OLLAMA_API_KEY_1 ? `••••••••${env.OLLAMA_API_KEY_1.slice(-4)}` : 'Not configured',
            priority: 1,
          },
          {
            id: 2,
            name: 'Cloud Account 2',
            configured: Boolean(env.OLLAMA_API_KEY_2),
            maskedKey: env.OLLAMA_API_KEY_2 ? `••••••••${env.OLLAMA_API_KEY_2.slice(-4)}` : 'Not configured',
            priority: 2,
          },
          {
            id: 3,
            name: 'Cloud Account 3',
            configured: Boolean(env.OLLAMA_API_KEY_3),
            maskedKey: env.OLLAMA_API_KEY_3 ? `••••••••${env.OLLAMA_API_KEY_3.slice(-4)}` : 'Not configured',
            priority: 3,
          },
        ],
        fallback: {
          name: 'Local Ollama Daemon',
          baseUrl: env.OLLAMA_BASE_URL,
          model: env.OLLAMA_MODEL,
          priority: 10,
          status: 'ALWAYS_ACTIVE_FAILOVER',
        },
      };
    });

    this.app.get('/api/v1/agents/cycles', async (request) => {
      const query = request.query as { symbol?: string; limit?: string; offset?: string };
      const limit = parseLimit(query.limit, 20);
      const offset = query.offset ? Math.max(0, parseInt(query.offset, 10) || 0) : 0;
      const cycles = this.events.getAgentCycles({ symbol: query.symbol, limit, offset });
      return { cycles, total: cycles.length };
    });

    this.app.get('/api/v1/agents/cycles/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const cycle = this.events.getAgentCycleById(id);
      if (!cycle) {
        return reply.code(404).send({ error: 'CYCLE_NOT_FOUND', message: `Cycle ${id} not found` });
      }
      return cycle;
    });

    this.app.get('/api/v1/agents/cycles/:id/explain', async (request, reply) => {
      const { id } = request.params as { id: string };
      const cycle = this.events.getAgentCycleById(id);
      if (!cycle) {
        return reply.code(404).send({ error: 'CYCLE_NOT_FOUND', message: `Cycle ${id} not found` });
      }

      const rawDecision = cycle['trader_decision'] as Record<string, unknown> | undefined;
      const rawApproval = cycle['fund_manager_approval'] as Record<string, unknown> | undefined;
      const rawVerdict = cycle['verdict'] as Record<string, unknown> | undefined;

      return {
        cycleId: String(cycle['cycle_id'] || id),
        symbol: String(cycle['symbol'] || ''),
        startedAt: Number(cycle['started_at'] || 0),
        executed: Boolean(cycle['executed']),
        action: String(rawDecision?.['action'] || 'NEUTRAL'),
        summary: String(rawApproval?.['rationale'] || 'No rationale available'),
        debateVerdict: String(rawVerdict?.['rationale'] || 'Inconclusive debate'),
        conviction: Number(rawVerdict?.['conviction'] || 0.5),
        riskOpinions: (cycle['risk_opinions'] as unknown[]) || [],
      };
    });
  }

  private registerBacktestRoutes(): void {
    this.app.get('/api/v1/backtest/history', async (request) => {
      const query = request.query as { limit?: string };
      const limit = parseLimit(query.limit, 20);
      const rows = this.events.raw.prepare(
        'SELECT id, symbol, start_time, end_time, duration_days, initial_equity, final_equity, total_net_pnl, total_return_pct, total_trades, win_rate, profit_factor, max_drawdown, avg_r, created_at_utc FROM backtest_runs ORDER BY created_at_utc DESC LIMIT ?'
      ).all(limit) as Array<Record<string, unknown>>;
      return { runs: rows };
    });

    this.app.get('/api/v1/backtest/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const row = this.events.raw.prepare(
        'SELECT * FROM backtest_runs WHERE id = ?'
      ).get(id) as {
        id: string; symbol: string; start_time: number; end_time: number;
        duration_days: number; initial_equity: number; final_equity: number;
        total_net_pnl: number; total_return_pct: number; total_trades: number;
        win_rate: number; profit_factor: number; max_drawdown: number;
        avg_r: number; created_at_utc: string; config_json: string; report_json: string;
      } | undefined;
      if (!row) {
        return reply.code(404).send({ error: 'BACKTEST_NOT_FOUND' });
      }
      return {
        id: row.id,
        runId: row.id,
        symbol: row.symbol,
        start_time: row.start_time,
        end_time: row.end_time,
        duration_days: row.duration_days,
        initial_equity: row.initial_equity,
        final_equity: row.final_equity,
        total_net_pnl: row.total_net_pnl,
        total_return_pct: row.total_return_pct,
        total_trades: row.total_trades,
        win_rate: row.win_rate,
        profit_factor: row.profit_factor,
        max_drawdown: row.max_drawdown,
        avg_r: row.avg_r,
        created_at_utc: row.created_at_utc,
        config: JSON.parse(row.config_json),
        report: JSON.parse(row.report_json),
      };
    });

    this.app.post('/api/v1/backtest/run', { preHandler: this.requireApiKey }, async (request, reply) => {
      if (this.backtestInFlight) {
        return reply.code(429).send({ error: 'BACKTEST_IN_PROGRESS', message: 'Another backtest run is already in progress' });
      }
      this.backtestInFlight = true;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const symbol = String(body['symbol'] || 'SOLUSDT').toUpperCase();
      if (!isValidSymbol(symbol)) {
        this.backtestInFlight = false;
        return reply.code(400).send({ error: 'INVALID_SYMBOL' });
      }
      const days = Math.min(Math.max(Number(body['days'] || 3), 1), 30);
      const initialEquity = Math.max(Number(body['initialEquity'] || 10000), 100);
      const riskPerTradePct = Math.min(Math.max(Number(body['riskPerTradePct'] || 0.02), 0.005), 0.1);
      const maxDailyLossPct = Math.min(Math.max(Number(body['maxDailyLossPct'] || 0.05), 0.01), 0.2);
      const maxOpenPositions = Math.min(Math.max(Number(body['maxOpenPositions'] || 3), 1), 10);
      const defaultLeverage = Math.min(Math.max(Number(body['defaultLeverage'] || 5), 1), 20);

      const now = Date.now();
      const startTime = now - days * 24 * 60 * 60 * 1000;

      try {
        const dataset = await BinanceHistoricalFetcher.loadSolusdtDataset(days, symbol);

        const config: ReplayConfig = {
          symbol,
          startTime,
          endTime: now,
          initialEquity,
          riskPerTradePct,
          maxDailyLossPct,
          maxOpenPositions,
          defaultLeverage,
          strategyVersion: 'v1',
          minConfluenceScore: 40,
          executionConfig: { minTp1RiskReward: 1.0, minTp2RiskReward: 1.5, minTp3RiskReward: 2.0 },
          paperBrokerConfig: {
            makerFeeRate: 0.0002,
            takerFeeRate: 0.0004, // H-12: aligned with PaperBroker's live-trading default (4bps)
            slippageModel: 'FIXED_TICKS',
            slippageFixedTicks: 1,
            ambiguousIntrabarPolicy: 'CONSERVATIVE',
            breakevenEnabled: true,
            breakevenTriggerR: 1.0,
            breakevenOffsetTicks: 2,
            trailingEnabled: false,
            trailingTriggerR: 2.0,
            trailingDistanceTicks: 5,
            maintenanceMarginRate: 0.005,
            fundingMode: 'DISABLED',
          },
        };

        const report = ReplayEngine.runBacktest(dataset, config);
        const runId = `BT:${symbol}:${now}`;

        this.events.raw.prepare(
          `INSERT INTO backtest_runs (id, symbol, start_time, end_time, duration_days, initial_equity, final_equity, total_net_pnl, total_return_pct, total_trades, win_rate, profit_factor, max_drawdown, avg_r, config_json, report_json, created_at_utc)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          runId, symbol, startTime, now, report.durationDays,
          initialEquity, report.finalEquity, report.totalNetPnl, report.totalReturnPct,
          report.coreMetrics.totalTrades, report.coreMetrics.winRate,
          report.coreMetrics.profitFactor, report.coreMetrics.maxDrawdown,
          report.coreMetrics.averageR,
          JSON.stringify(config),
          JSON.stringify(report),
          new Date(now).toISOString()
        );

        metrics.inc('backtest_runs_total');
        return reply.send({ runId, report });
      } catch (err) {
        logger.error({ error: (err as Error).message }, 'Backtest failed');
        return reply.code(500).send({ error: 'BACKTEST_FAILED', message: (err as Error).message });
      } finally {
        this.backtestInFlight = false;
      }
    });
  }

  private registerCommandRoutes(): void {
    this.app.post('/orders', { preHandler: this.requireApiKey }, async (request, reply) => {
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

    this.app.post('/orders/cancel', { preHandler: this.requireApiKey }, async (request, reply) => {
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

    this.app.post('/orders/cancel-all', { preHandler: this.requireApiKey }, async (request) => {
      const parsed = CancelAllSchema.safeParse(request.body);
      const symbol = parsed.success ? parsed.data.symbol : undefined;
      await this.broker.cancelAllOrders(symbol);
      metrics.inc('orders_cancel_all_total');
      return { canceled: true, symbol: symbol ?? 'all' };
    });

    this.app.post('/api/v1/mode/arm', { preHandler: this.requireApiKey }, async (request, reply) => {
      const parsed = ArmModeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'INVALID_REQUEST' });
      }
      if (this.profile?.mode !== 'live') {
        return reply.code(409).send({ error: 'NOT_LIVE_MODE', message: 'Arming requires TRADING_MODE=live' });
      }
      const requiredPasscode = this.options.armPasscode;
      if (requiredPasscode && (!parsed.data.passcode || !safeEqual(parsed.data.passcode, requiredPasscode))) {
        metrics.inc('api_auth_rejections_total');
        return reply.code(403).send({ error: 'INVALID_PASSCODE', message: 'Live arm passcode missing or incorrect' });
      }
      this.profile.liveArmed = true;
      this.profile.realOrders = true;
      this.wsGateway.broadcast('mode.changed', { mode: this.profile.mode, liveArmed: true });
      return reply.send({ armed: true });
    });

    this.app.post('/api/v1/mode/disarm', { preHandler: this.requireApiKey }, async (_request, reply) => {
      if (this.profile) {
        this.profile.liveArmed = false;
        this.profile.realOrders = false;
        this.wsGateway.broadcast('mode.changed', { mode: this.profile.mode, liveArmed: false });
      }
      return reply.send({ armed: false });
    });

    this.app.post('/api/v1/mode/aggressive', { preHandler: this.requireApiKey }, async (request, reply) => {
      const body = (request.body as { enabled?: boolean } | undefined) ?? {};
      const enabled = body.enabled ?? true;
      this.options.onSetAggressiveMode?.(enabled);
      this.wsGateway.broadcast('mode.aggressive', { aggressive: enabled });
      return reply.send({ aggressive: enabled });
    });

    this.app.post('/api/v1/engine/evaluate', { preHandler: this.requireApiKey }, async (_request, reply) => {
      const evaluated = (await this.options.onTriggerEvaluation?.()) ?? 0;
      return reply.send({ evaluated });
    });

    this.app.post('/engine/start', { preHandler: this.requireApiKey }, async () => {
      await this.engine.start();
      metrics.inc('engine_starts_total');
      return { started: true };
    });

    this.app.post('/engine/stop', { preHandler: this.requireApiKey }, async () => {
      this.engine.stop();
      metrics.inc('engine_stops_total');
      return { stopped: true };
    });

    this.app.post('/engine/kill-switch', { preHandler: this.requireApiKey }, async () => {
      await this.broker.cancelAllOrders();
      this.engine.stop();
      this.wsGateway.broadcast('kill_switch.activated', { activatedAtUtc: new Date().toISOString() });
      metrics.inc('kill_switch_activations_total');
      return { killSwitch: true };
    });

    this.app.post('/api/v1/agents/cycle', { preHandler: this.requireApiKey }, async (request, reply) => {
      const body = (request.body as { symbol?: string; model?: string } | undefined) ?? {};
      const symbol = (body.symbol || 'SOLUSDT').toUpperCase();
      if (!isValidSymbol(symbol)) {
        return reply.code(400).send({ error: 'INVALID_SYMBOL' });
      }
      const state = this.marketState?.getState(symbol);
      const mark = state?.mark ?? 140;
      const lastPrice = state?.last ?? mark;
      const bid = state?.bid ?? lastPrice - 0.02;
      const ask = state?.ask ?? lastPrice + 0.02;
      const spread = state?.spread ?? Math.max(0.01, ask - bid);

      const cloudKeys = [env.OLLAMA_API_KEY_1, env.OLLAMA_API_KEY_2, env.OLLAMA_API_KEY_3].filter(Boolean) as string[];
      const pipeline = new TradingAgentsPipeline({
        model: body.model || env.OLLAMA_MODEL,
        baseUrl: env.OLLAMA_BASE_URL,
        apiKeys: cloudKeys,
        cloudBaseUrl: env.OLLAMA_CLOUD_BASE_URL,
        cloudModel: env.OLLAMA_CLOUD_MODEL,
      });
      try {
        const cycle = await pipeline.runCycle(
          {
            symbol,
            lastPrice,
            bid,
            ask,
            spread,
            mark,
            fundingRate: 0.0001,
            openInterest: 50000,
          },
          (step) => this.wsGateway.broadcast('agent.step', step)
        );

        this.events.logAgentCycle(cycle);
        this.wsGateway.broadcast('agent.cycle', cycle);
        return reply.send(cycle);
      } catch (err) {
        return reply.code(500).send({ error: 'AGENT_CYCLE_FAILED', message: (err as Error).message });
      }
    });
  }

  public getApp(): FastifyInstance {
    return this.app;
  }

  async start(): Promise<void> {
    await this.init();
    if (this.port === 0) {
      await this.app.ready();
    } else {
      await this.app.listen({ host: this.host, port: this.port });
      logger.info(`API server listening on http://${this.host}:${this.port}`);
    }
  }

  async stop(): Promise<void> {
    this.wsGateway.closeAll();
    await this.app.close();
  }
}