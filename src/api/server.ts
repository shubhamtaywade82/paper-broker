import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { z } from 'zod';
import { ulid } from 'ulid';
import type { AccountState, ExecutionBroker, Fill } from '../broker/types.js';
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
import type { AutonomousTradingAgent } from '../agent/AutonomousTradingAgent.js';
import type { LiveTradingGuard } from '../execution/LiveTradingGuard.js';
import type { ExchangeReconciler } from '../execution/ExchangeReconciler.js';
import type { RiskConfig } from '../trading/risk/types.js';
import { DEFAULT_RISK_CONFIG } from '../trading/risk/RiskLimits.js';
import { RateLimiter, DEFAULT_RATE_LIMITS, type RateLimiterOptions, type RateLimitScope } from './RateLimiter.js';
// Agentic layer imports (feature/agentic-upgrade)
import type { ToolRegistry } from '../ai/tools/registry.js';
import type { AgentMemoryStore } from '../ai/memory/AgentMemoryStore.js';
import type { SelfImprovementLoop } from '../ai/SelfImprovementLoop.js';
import type { StrategyParamLearner } from '../strategy/learning/StrategyParamLearner.js';
import type { StrategySelector } from '../strategy/learning/StrategySelector.js';
import type { ABTestRunner } from '../strategy/abtesting/ABTestRunner.js';
import type { BinanceClient } from '@nemesis-oss/binance-sdk';

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

export interface OllamaModelInfo {
  name: string;
  isCloud: boolean;
  size?: number;
}

/** Queries the local Ollama daemon for available models, filtering out non-completion models. */
async function fetchOllamaModels(baseUrl: string, defaultModel: string): Promise<OllamaModelInfo[]> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = (await res.json()) as {
        models?: Array<{ name: string; size?: number; details?: { family?: string }; capabilities?: string[] }>;
      };
      const list: OllamaModelInfo[] = (data.models ?? [])
        .filter((m) => !m.name.includes('embed') && m.details?.family !== 'bert' && m.details?.family !== 'nomic-bert')
        .map((m) => ({
          name: m.name,
          isCloud: m.name.includes(':cloud') || m.name.endsWith(':cloud'),
          size: m.size,
        }));
      if (list.length > 0) {
        if (!list.some((m) => m.name === defaultModel)) {
          list.unshift({ name: defaultModel, isCloud: defaultModel.includes(':cloud') });
        }
        return list;
      }
    }
  } catch {
    // Degrade gracefully to configured defaults when Ollama is unreachable
  }
  return [
    { name: defaultModel, isCloud: defaultModel.includes(':cloud') },
    { name: 'qwen3.5:4b', isCloud: false },
    { name: 'gemma4:cloud', isCloud: true },
  ];
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
  onResetPaperAccount?: (startingBalance?: number) => Promise<AccountState> | AccountState;
  /** When set, requires `Authorization: Bearer <apiKey>` (or `x-api-key`) on all order/engine/mode control endpoints. */
  apiKey?: string;
  /** When set, `/api/v1/mode/arm` requires a matching `passcode` in the request body. */
  armPasscode?: string;
  /** Profit-goal state, surfaced read-only at `/api/v1/profit-goals`. */
  profitGoals?: ProfitGoalManager;
  /** Per-strategy performance, surfaced at `/api/v1/strategies/performance`. */
  strategyPerformance?: StrategyPerformanceTracker;
  /**
   * Per-setup-archetype performance for the SMC agent's self-learning
   * memory (src/strategy/strategies/smc-agent.ts), surfaced read-only at
   * `/api/v1/setups/performance` and releasable at
   * `/api/v1/setups/:id/release`. Same tracker class as strategyPerformance,
   * keyed by setup type instead of strategy id.
   */
  setupPerformance?: StrategyPerformanceTracker;
  /**
   * The autonomous trading agent instance (if enabled), surfaced read-only
   * at `/api/v1/autonomous/snapshot` so the dashboard can bootstrap its UI
   * on mount instead of waiting up to one full cycle (default 30s) for the
   * first WS broadcast. Returns the latest cycle summary, breaker state,
   * health snapshot, runtime risk multiplier, and rolling win rate.
   */
  autonomousAgent?: AutonomousTradingAgent;
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

  // --- Agentic layer (feature/agentic-upgrade) ---------------------------
  // All optional + surfaced read-only at /api/v1/agent/* + /api/v1/ab-tests
  // + /api/v1/strategy-selector. None mutate broker state.
  /** Tool registry for the LLM analyst stage (when AGENT_TOOLS_ENABLED). */
  toolRegistry?: ToolRegistry;
  /** Agent memory store (when AGENT_MEMORY_ENABLED). */
  agentMemoryStore?: AgentMemoryStore;
  /** Self-improvement loop handle (for the /api/v1/agent/decay endpoint). */
  selfImprovementLoop?: SelfImprovementLoop;
  /** Strategy parameter learner (when AGENT_PARAM_LEARNING_ENABLED). */
  strategyParamLearner?: StrategyParamLearner;
  /** Per-regime strategy selector (when AGENT_STRATEGY_SELECTOR_ENABLED). */
  strategySelector?: StrategySelector;
  /** A/B testing runner (when AGENT_AB_TESTING_ENABLED). */
  abTestRunner?: ABTestRunner;
  /** Used by the screener routes for live universe resolution
   * (exchangeInfo()) — optional so ApiServer can still construct in tests
   * or contexts with no Binance client available. */
  binanceClient?: BinanceClient;
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
  private binanceClient?: BinanceClient;

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
    this.binanceClient = options.binanceClient;
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
    this.registerAgenticLayerRoutes();
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

      // Report what the broker actually holds — a fabricated 10000 here made the
      // risk endpoint show healthy utilisation for an account it could not read.
      const equity = Number.isFinite(account?.equity) ? account.equity : 0;
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

    this.app.get('/api/v1/setups/performance', async () => {
      const tracker = this.options.setupPerformance;
      return {
        enabled: Boolean(tracker),
        setups: tracker?.listStats() ?? [],
      };
    });

    this.app.post<{ Params: { id: string } }>(
      '/api/v1/setups/:id/release',
      { preHandler: this.requireApiKey },
      async (request, reply) => {
        const tracker = this.options.setupPerformance;
        if (!tracker) {
          return reply.code(404).send({ error: 'Setup performance tracking is not enabled' });
        }
        const released = tracker.release(request.params.id);
        if (!released) {
          return reply.code(404).send({ error: `Setup type ${request.params.id} is not quarantined` });
        }
        this.wsGateway.broadcast('setup.performance', {
          setupType: request.params.id,
          released: true,
          stats: tracker.getStats(request.params.id),
        });
        return { released: true, setupType: request.params.id };
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

    // Read-only snapshot of the autonomous trading agent's current state.
    // Returns the latest cycle summary (or null if no cycle has run yet),
    // brain-module state (breaker + health), and the learning loop's
    // runtime dial. The dashboard calls this once on mount to bootstrap
    // before the first WS broadcast arrives — see autonomousStore.ts.
    this.app.get('/api/v1/autonomous/snapshot', async () => {
      const agent = this.options.autonomousAgent;
      if (!agent) {
        return {
          enabled: false,
          reason: 'AUTONOMOUS_AGENT_ENABLED=false or agent not wired',
        };
      }
      const snap = agent.getSnapshot();
      const exitEvents = this.events?.getEvents({ type: 'AUTONOMOUS_EXIT_SIGNAL', limit: 20 }) ?? [];
      const learningEvents = this.events?.getEvents({ type: 'AUTONOMOUS_LEARNING_PARAMETER_ADJUSTED', limit: 20 }) ?? [];
      const regimeEvents = this.events?.getEvents({ type: 'AUTONOMOUS_REGIME_CHANGE', limit: 20 }) ?? [];
      const signalEvents = this.events?.getEvents({ type: 'AUTONOMOUS_AGENT_SIGNAL', limit: 20 }) ?? [];
      const rejectedEvents = this.events?.getEvents({ type: 'AUTONOMOUS_AGENT_REJECTED', limit: 20 }) ?? [];

      return {
        enabled: true,
        running: snap.running,
        latestCycle: snap.latestCycle,
        runtimeRiskMultiplier: snap.runtimeRiskMultiplier,
        rollingWinRate: snap.rollingWinRate,
        rollingSampleSize: snap.rollingSampleSize,
        breaker: snap.breaker,
        health: snap.health,
        perSymbol: snap.perSymbol,
        forming: snap.formingSetups,
        exits: exitEvents.map((e) => e.payload),
        learning: learningEvents.map((e) => e.payload),
        regimes: regimeEvents.map((e) => e.payload),
        signals: signalEvents.map((e) => e.payload),
        rejections: rejectedEvents.map((e) => e.payload),
      };
    });

    this.app.get('/api/v1/incidents', async () => ({
      incidents: this.errorNormalizer?.getRecentIncidents(50) ?? [],
    }));

    this.app.get('/api/v1/klines', async (request, reply) => {
      const query = request.query as { symbol?: string; interval?: string; limit?: string; before?: string };
      const symbol = (query.symbol || 'SOLUSDT').toUpperCase();
      if (!isValidSymbol(symbol)) {
        return reply.code(400).send({ error: 'INVALID_SYMBOL' });
      }
      const interval = query.interval || '15m';
      const limit = parseLimit(query.limit, 100);

      if (query.before) {
        const beforeTs = Number(query.before);
        if (Number.isFinite(beforeTs) && beforeTs > 0) {
          return await this.klines?.fetchHistoricalKlinesBefore(symbol, interval, beforeTs, limit) ?? [];
        }
      }

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

    // Recent persisted debate steps, newest-first — lets the dashboard replay
    // the transcript after a reload instead of showing an empty feed until the
    // next cycle happens to run. Same shape as the `agent.step` WS broadcast so
    // the client can feed both into one list.
    this.app.get('/api/v1/agents/steps', async (request) => {
      const query = request.query as { symbol?: string; limit?: string };
      const limit = parseLimit(query.limit, 100);
      // event_type is indexed (idx_events_type_time), so this is a range scan
      // rather than a walk of the whole events table.
      const events = this.events.getEvents({ type: 'AGENT_STEP', limit });
      const steps = events
        .map((e) => e.payload as Record<string, unknown>)
        .filter((p) => !query.symbol || p['symbol'] === query.symbol);
      return { steps };
    });

    this.app.get('/api/v1/fills', async (request) => {
      const query = request.query as { symbol?: string; limit?: string };
      const limit = parseLimit(query.limit, 100);
      if (this.broker && 'getFills' in this.broker && typeof this.broker.getFills === 'function') {
        const fills = await this.broker.getFills(query.symbol);
        return [...fills].reverse().slice(0, limit);
      }
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

      let allFills: Fill[] = [];
      if (this.broker && 'getFills' in this.broker && typeof this.broker.getFills === 'function') {
        allFills = await this.broker.getFills(query.symbol);
      } else {
        allFills = this.events
          .getEvents({ type: 'FILL_CREATED', limit: 1000 })
          .map((e) => e.payload as Fill);
      }

      const closingFills = [...allFills]
        .reverse()
        .filter((f) => Number(f.realizedPnl ?? 0) !== 0)
        .filter((f) => !query.symbol || f.symbol === query.symbol);

      const entries = closingFills.map((f) => {
        const signalId = f.signalId;
        const stopPrice = signalId ? stopPriceBySignal.get(signalId) : undefined;
        const entryPrice = Number(f.positionEntryBefore ?? 0);
        const exitPrice = Number(f.price ?? 0);
        const quantity = Number(f.quantity ?? 0);
        const realizedPnl = Number(f.realizedPnl ?? 0);
        const riskPerUnit = stopPrice && entryPrice ? Math.abs(entryPrice - stopPrice) : undefined;
        const rMultiple = riskPerUnit && riskPerUnit > 0 ? realizedPnl / (riskPerUnit * quantity) : undefined;

        return {
          id: f.id,
          symbol: f.symbol,
          side: f.side,
          quantity,
          entryPrice,
          exitPrice,
          stopPrice: stopPrice ?? null,
          realizedPnl,
          rMultiple: rMultiple !== undefined ? Number(rMultiple.toFixed(2)) : null,
          fillTsUtc: f.fillTsUtc,
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
        let fills: Array<{ realizedPnl?: number }> = [];
        if (this.broker && 'getFills' in this.broker && typeof this.broker.getFills === 'function') {
          fills = await this.broker.getFills();
        } else {
          fills = (this.events?.getEvents({ type: 'FILL_CREATED', limit: 500 }) ?? []).map((e) => (e.payload ?? {}) as { realizedPnl?: number });
        }
        let wins = 0;
        let losses = 0;

        for (const fill of fills) {
          const realizedPnl = Number(fill.realizedPnl || 0);
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

    this.app.get('/api/v1/history/transactions', async (request) => {
      const query = request.query as {
        period?: string;
        type?: string;
        limit?: string;
        offset?: string;
        accountId?: string;
      };
      const limit = parseLimit(query.limit, 50);
      const offset = query.offset ? Math.max(0, parseInt(query.offset, 10) || 0) : 0;
      const accountId = query.accountId || 'paper-main';

      let sql = 'SELECT * FROM transactions WHERE account_id = ?';
      const params: (string | number)[] = [accountId];

      if (query.type) {
        sql += ' AND transaction_type = ?';
        params.push(query.type);
      }

      if (query.period) {
        const now = Date.now();
        let startTime = 0;
        if (query.period === '7D') {
          startTime = now - 7 * 24 * 60 * 60 * 1000;
        } else if (query.period === '30D') {
          startTime = now - 30 * 24 * 60 * 60 * 1000;
        } else if (query.period === 'FY27') {
          startTime = new Date('2026-04-01T00:00:00.000Z').getTime();
        }
        if (startTime > 0) {
          sql += ' AND created_at_utc >= ?';
          params.push(new Date(startTime).toISOString());
        }
      }

      sql += ' ORDER BY created_at_utc DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const rows = this.events.raw.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      return {
        transactions: rows.map((r) => ({
          ...r,
          amount: parseFloat(String(r['amount'] || '0')),
          fee: parseFloat(String(r['fee'] || '0')),
          grossPnl: r['gross_pnl'] !== null ? parseFloat(String(r['gross_pnl'])) : null,
          netPnl: r['net_pnl'] !== null ? parseFloat(String(r['net_pnl'])) : null,
          balanceAfter: parseFloat(String(r['balance_after'] || '0')),
          metadata: r['metadata'] ? JSON.parse(String(r['metadata'])) : null,
        })),
      };
    });

    this.app.get('/api/v1/history/pnl-summary', async (request) => {
      const query = request.query as { accountId?: string };
      const accountId = query.accountId || 'paper-main';

      const computeForPeriod = (period: string, startTimeIso?: string) => {
        let sql = `
          SELECT 
            COUNT(*) as total_transactions,
            COALESCE(SUM(CAST(fee AS REAL)), 0) as total_fees,
            COALESCE(SUM(CAST(gross_pnl AS REAL)), 0) as total_gross_pnl,
            COALESCE(SUM(CAST(net_pnl AS REAL)), 0) as total_net_pnl
          FROM transactions
          WHERE account_id = ? AND transaction_type = 'CLOSE_POSITION'
        `;
        const params: (string | number)[] = [accountId];
        if (startTimeIso) {
          sql += ' AND created_at_utc >= ?';
          params.push(startTimeIso);
        }
        const row = this.events.raw.prepare(sql).get(...params) as {
          total_transactions: number;
          total_fees: number;
          total_gross_pnl: number;
          total_net_pnl: number;
        };
        return {
          period,
          totalClosedTrades: Number(row.total_transactions || 0),
          totalFees: Number(row.total_fees || 0),
          grossPnl: Number(row.total_gross_pnl || 0),
          netPnl: Number(row.total_net_pnl || 0),
        };
      };

      const now = Date.now();
      return {
        '7D': computeForPeriod('7D', new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()),
        '30D': computeForPeriod('30D', new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()),
        FY27: computeForPeriod('FY27', '2026-04-01T00:00:00.000Z'),
        ALL: computeForPeriod('ALL'),
      };
    });

    this.app.get('/api/v1/ledger', async (request) => {
      const query = request.query as { accountId?: string; limit?: string };
      const limit = parseLimit(query.limit, 100);
      const accountId = query.accountId || 'paper-main';
      const rows = this.events.raw
        .prepare('SELECT * FROM ledger_entries WHERE account_id = ? ORDER BY created_at_utc DESC LIMIT ?')
        .all(accountId, limit) as Array<Record<string, unknown>>;
      return {
        entries: rows.map((r) => ({
          ...r,
          amount: parseFloat(String(r['amount'] || '0')),
          balanceAfter: r['balance_after'] !== null ? parseFloat(String(r['balance_after'])) : null,
        })),
      };
    });

    this.app.get('/api/v1/wallets', async (request) => {
      const query = request.query as { accountId?: string };
      const accountId = query.accountId || 'paper-main';
      const account = await this.broker.getAccount();

      // Ensure standard product wallets exist
      const products = ['FUTURES', 'SPOT', 'OPTIONS', 'EARN'] as const;
      const getWalletStmt = this.events.raw.prepare(
        'SELECT * FROM wallets WHERE account_id = ? AND product_type = ? AND currency = ?'
      );
      const upsertWalletStmt = this.events.raw.prepare(`
        INSERT INTO wallets (account_id, product_type, currency, free, locked, updated_at_utc)
        VALUES (@accountId, @productType, @currency, @free, @locked, @updatedAtUtc)
        ON CONFLICT(account_id, product_type, currency) DO UPDATE SET
          free = excluded.free,
          locked = excluded.locked,
          updated_at_utc = excluded.updated_at_utc
      `);

      for (const prod of products) {
        const existing = getWalletStmt.get(accountId, prod, 'USDT');
        if (!existing) {
          upsertWalletStmt.run({
            accountId,
            productType: prod,
            currency: 'USDT',
            free: prod === 'FUTURES' ? String(account.availableBalance) : '0',
            locked: prod === 'FUTURES' ? String(account.initialMargin) : '0',
            updatedAtUtc: new Date().toISOString(),
          });
        } else if (prod === 'FUTURES') {
          upsertWalletStmt.run({
            accountId,
            productType: prod,
            currency: 'USDT',
            free: String(account.availableBalance),
            locked: String(account.initialMargin),
            updatedAtUtc: new Date().toISOString(),
          });
        }
      }

      const rows = this.events.raw
        .prepare('SELECT * FROM wallets WHERE account_id = ? ORDER BY product_type')
        .all(accountId) as Array<Record<string, unknown>>;

      return {
        wallets: rows.map((r) => ({
          accountId: r['account_id'],
          productType: r['product_type'],
          currency: r['currency'],
          free: parseFloat(String(r['free'] || '0')),
          locked: parseFloat(String(r['locked'] || '0')),
          totalFees: parseFloat(String(r['total_fees'] || '0')),
          totalFunding: parseFloat(String(r['total_funding'] || '0')),
          totalRealizedPnl: parseFloat(String(r['total_realized_pnl'] || '0')),
          updatedAtUtc: r['updated_at_utc'],
        })),
      };
    });

    this.app.post('/api/v1/wallets/transfer', async (request, reply) => {
      const body = request.body as {
        fromProduct?: string;
        toProduct?: string;
        currency?: string;
        amount?: number;
        accountId?: string;
      };

      const fromProduct = (body.fromProduct || '').toUpperCase();
      const toProduct = (body.toProduct || '').toUpperCase();
      const currency = (body.currency || 'USDT').toUpperCase();
      const amount = Number(body.amount);
      const accountId = body.accountId || 'paper-main';

      const validProducts = new Set(['SPOT', 'FUTURES', 'OPTIONS', 'EARN']);
      if (!validProducts.has(fromProduct) || !validProducts.has(toProduct) || fromProduct === toProduct) {
        return reply.code(400).send({ error: 'INVALID_TRANSFER_PRODUCTS' });
      }
      if (!amount || amount <= 0 || Number.isNaN(amount)) {
        return reply.code(400).send({ error: 'INVALID_TRANSFER_AMOUNT' });
      }

      // Check balance
      let fromFree = 0;
      if (fromProduct === 'FUTURES') {
        const account = await this.broker.getAccount();
        fromFree = account.availableBalance;
      } else {
        const row = this.events.raw
          .prepare('SELECT free FROM wallets WHERE account_id = ? AND product_type = ? AND currency = ?')
          .get(accountId, fromProduct, currency) as { free: string } | undefined;
        fromFree = row ? parseFloat(row.free || '0') : 0;
      }

      if (fromFree < amount) {
        return reply.code(400).send({
          error: 'INSUFFICIENT_FUNDS',
          message: `Available free balance in ${fromProduct} is ${fromFree} ${currency}, required ${amount}`,
        });
      }

      // Execute transfer in SQLite and adjust broker balance if futures
      const nowIso = new Date().toISOString();
      const txId = ulid();

      if (fromProduct === 'FUTURES') {
        this.broker.adjustWalletBalance?.(-amount);
      } else {
        this.events.raw.prepare(`
          UPDATE wallets SET free = CAST((CAST(free AS REAL) - ?) AS TEXT), updated_at_utc = ?
          WHERE account_id = ? AND product_type = ? AND currency = ?
        `).run(amount, nowIso, accountId, fromProduct, currency);
      }

      if (toProduct === 'FUTURES') {
        this.broker.adjustWalletBalance?.(amount);
      } else {
        this.events.raw.prepare(`
          INSERT INTO wallets (account_id, product_type, currency, free, locked, updated_at_utc)
          VALUES (?, ?, ?, CAST(? AS TEXT), '0', ?)
          ON CONFLICT(account_id, product_type, currency) DO UPDATE SET
            free = CAST((CAST(free AS REAL) + excluded.free) AS TEXT),
            updated_at_utc = excluded.updated_at_utc
        `).run(accountId, toProduct, currency, amount, nowIso);
      }

      // Log transaction
      const accountAfter = await this.broker.getAccount();
      this.events.raw.prepare(`
        INSERT INTO transactions (
          id, account_id, product_type, transaction_type, currency,
          amount, fee, balance_after, metadata, created_at_utc
        ) VALUES (?, ?, ?, 'INTERNAL_TRANSFER', ?, ?, '0', ?, ?, ?)
      `).run(
        txId,
        accountId,
        fromProduct,
        currency,
        String(amount),
        String(accountAfter.walletBalance),
        JSON.stringify({ fromProduct, toProduct, currency, amount }),
        nowIso
      );

      return {
        success: true,
        transferId: txId,
        fromProduct,
        toProduct,
        currency,
        amount,
        timestamp: nowIso,
      };
    });

    this.app.get('/api/v1/portfolio/valuation', async (request) => {
      const query = request.query as { accountId?: string };
      const accountId = query.accountId || 'paper-main';
      const account = await this.broker.getAccount();

      const inrRate = parseFloat(process.env['USDT_INR_RATE'] || '89.50');

      const rows = this.events.raw
        .prepare('SELECT product_type, free, locked FROM wallets WHERE account_id = ?')
        .all(accountId) as Array<{ product_type: string; free: string; locked: string }>;

      const walletBalances: Record<string, number> = {
        FUTURES: account.equity,
        SPOT: 0,
        OPTIONS: 0,
        EARN: 0,
      };

      for (const row of rows) {
        if (row.product_type !== 'FUTURES') {
          const total = parseFloat(row.free || '0') + parseFloat(row.locked || '0');
          walletBalances[row.product_type] = total;
        }
      }

      const totalEquityUsdt = Object.values(walletBalances).reduce((sum, val) => sum + val, 0);

      const futuresVal = walletBalances['FUTURES'] ?? 0;
      const spotVal = walletBalances['SPOT'] ?? 0;
      const optionsVal = walletBalances['OPTIONS'] ?? 0;
      const earnVal = walletBalances['EARN'] ?? 0;

      return {
        baseCurrency: 'USDT',
        displayCurrency: 'INR',
        exchangeRate: inrRate,
        totalEquityUsdt,
        totalEquityInr: totalEquityUsdt * inrRate,
        totalBalanceUsdt: account.walletBalance,
        totalBalanceInr: account.walletBalance * inrRate,
        unrealizedPnlUsdt: account.unrealizedPnl,
        unrealizedPnlInr: account.unrealizedPnl * inrRate,
        products: {
          futures: { usdt: futuresVal, inr: futuresVal * inrRate },
          spot: { usdt: spotVal, inr: spotVal * inrRate },
          options: { usdt: optionsVal, inr: optionsVal * inrRate },
          earn: { usdt: earnVal, inr: earnVal * inrRate },
        },
        updatedAtUtc: new Date().toISOString(),
      };
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
      const cloudKeys = [env.OLLAMA_API_KEY_1, env.OLLAMA_API_KEY_2, env.OLLAMA_API_KEY_3].filter(Boolean) as string[];
      const hasCloudKey = cloudKeys.length > 0;
      const defaultModel = hasCloudKey ? env.OLLAMA_CLOUD_MODEL : env.OLLAMA_MODEL;
      return {
        localBaseUrl: env.OLLAMA_BASE_URL,
        localModel: env.OLLAMA_MODEL,
        cloudBaseUrl: env.OLLAMA_CLOUD_BASE_URL,
        cloudModel: env.OLLAMA_CLOUD_MODEL,
        defaultModel,
        hasCloudKey,
        configuredAccountsCount: cloudKeys.length,
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

    this.app.get('/api/v1/agents/models', async () => {
      const cloudKeys = [env.OLLAMA_API_KEY_1, env.OLLAMA_API_KEY_2, env.OLLAMA_API_KEY_3].filter(Boolean) as string[];
      const hasCloudKey = cloudKeys.length > 0;
      const defaultModel = hasCloudKey ? env.OLLAMA_CLOUD_MODEL : env.OLLAMA_MODEL;
      const models = await fetchOllamaModels(env.OLLAMA_BASE_URL, defaultModel);
      return {
        models,
        defaultModel,
        localModel: env.OLLAMA_MODEL,
        cloudModel: env.OLLAMA_CLOUD_MODEL,
        hasCloudKey,
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

  /**
   * Agentic layer routes (feature/agentic-upgrade).
   *
   * All routes below are read-only GETs (no API key required — same pattern
   * as /api/v1/strategies/performance) EXCEPT the A/B evaluate endpoint,
   * which mutates state (promotes an instance) and therefore requires the
   * API key (same pattern as /api/v1/strategies/:id/release).
   *
   * Every endpoint returns `{ enabled: boolean, ... }` so the dashboard can
   * gracefully render the "feature is off" state.
   */
  private registerAgenticLayerRoutes(): void {
    // --- Tools -------------------------------------------------------------
    this.app.get('/api/v1/agent/tools', async () => {
      const registry = this.options.toolRegistry;
      return {
        enabled: Boolean(registry),
        tools: registry?.list() ?? [],
        catalog: registry?.catalog() ?? [],
        recentCalls: registry?.recentCalls(50) ?? [],
      };
    });

    // --- Agent memory ------------------------------------------------------
    this.app.get('/api/v1/agent/memory', async () => {
      const store = this.options.agentMemoryStore;
      return {
        enabled: Boolean(store),
        lessons: store?.listLessons(200) ?? [],
      };
    });

    this.app.get('/api/v1/agent/reflections', async (request) => {
      const query = request.query as { limit?: string };
      const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50)));
      const store = this.options.agentMemoryStore;
      return {
        enabled: Boolean(store),
        reflections: store?.recentReflections(limit) ?? [],
      };
    });

    /**
     * Manually trigger lesson decay + reflection pruning. Operator-only,
     * requires API key. Useful when the operator wants to immediately
     * retire a noisy lesson without waiting for the next cycle.
     */
    this.app.post(
      '/api/v1/agent/decay',
      { preHandler: this.requireApiKey },
      async () => {
        const loop = this.options.selfImprovementLoop;
        if (!loop) return { enabled: false, message: 'agent memory not enabled' };
        const result = loop.runDecayAndPrune();
        return { enabled: true, ...result };
      }
    );

    // --- Strategy parameter learner --------------------------------------
    this.app.get('/api/v1/agent/param-learning', async (request) => {
      const learner = this.options.strategyParamLearner;
      const query = request.query as { strategyId?: string; regime?: string; paramKey?: string; full?: string };
      if (!learner) return { enabled: false, cells: [] };

      if (query.strategyId && query.regime && query.paramKey) {
        return {
          enabled: true,
          stats: learner.listParamStats(query.strategyId, query.regime, query.paramKey),
        };
      }
      return {
        enabled: true,
        stats: query.full === 'true' ? learner.listAllStats() : learner.listAllStats().slice(0, 50),
      };
    });

    // --- Strategy selector ------------------------------------------------
    this.app.get('/api/v1/strategy-selector', async () => {
      const selector = this.options.strategySelector;
      if (!selector) return { enabled: false, demotedPairs: [] };
      return selector.getState();
    });

    // --- A/B testing ------------------------------------------------------
    this.app.get('/api/v1/ab-tests', async () => {
      const runner = this.options.abTestRunner;
      if (!runner) return { enabled: false, instances: [], promotedInstanceId: null };
      return runner.getState();
    });

    this.app.post(
      '/api/v1/ab-tests/evaluate',
      { preHandler: this.requireApiKey },
      async () => {
        const runner = this.options.abTestRunner;
        if (!runner) return { enabled: false, promotedInstanceId: null, summary: 'A/B testing not enabled' };
        const result = runner.evaluate();
        return { enabled: true, ...result };
      }
    );
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

    this.app.post('/api/v1/account/reset', { preHandler: this.requireApiKey }, async (request, reply) => {
      if (this.options.profile?.mode === 'live') {
        return reply.code(400).send({
          error: 'CANNOT_RESET_LIVE_ACCOUNT',
          message: 'Account reset is only available in paper trading mode.',
        });
      }

      const body = (request.body as { startingBalance?: number } | undefined) ?? {};
      const startingBalance =
        typeof body.startingBalance === 'number' && body.startingBalance > 0
          ? body.startingBalance
          : 1_000;

      let account: AccountState;
      if (this.options.onResetPaperAccount) {
        account = await this.options.onResetPaperAccount(startingBalance);
      } else if ('resetAccount' in this.broker && typeof (this.broker as unknown as { resetAccount: (val?: number) => AccountState }).resetAccount === 'function') {
        account = await (this.broker as unknown as { resetAccount: (val?: number) => Promise<AccountState> | AccountState }).resetAccount(startingBalance);
      } else {
        return reply.code(501).send({
          error: 'RESET_NOT_SUPPORTED',
          message: 'The current broker implementation does not support account resets.',
        });
      }

      return {
        success: true,
        message: `Paper trading account reset to $${startingBalance.toLocaleString()} successfully.`,
        account,
      };
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
      const defaultModel = cloudKeys.length > 0 ? env.OLLAMA_CLOUD_MODEL : env.OLLAMA_MODEL;
      const pipeline = new TradingAgentsPipeline({
        model: body.model || defaultModel,
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
          (step) => {
            // Same as engine.ts's onCycleStep: persist so the transcript can be
            // replayed after a reload, then broadcast for live viewers.
            this.events.appendSystemEvent({
              eventType: 'AGENT_STEP',
              payload: step as unknown as Record<string, unknown>,
              createdAtUtc: new Date().toISOString(),
            });
            this.wsGateway.broadcast('agent.step', step);
          }
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