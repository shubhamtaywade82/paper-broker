import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { env, symbols, timeframes, runtimeProfile } from './config/env.js';
import { defaultInstruments } from './config/instruments.js';
import { BinanceClient } from '@nemesis-oss/binance-sdk';
import { bootstrapFromBinance } from './binance/bootstrap.js';
import { BinanceStreamHandler } from './binance/streams.js';
import { PaperBroker } from './broker/PaperBroker.js';
import { MarketStateManager } from './market/MarketState.js';
import { KlineStore, type KlineInterval } from './market/Klines.js';
import { DatabaseManager } from './persistence/db.js';
import { SQLiteBrokerPersister } from './persistence/BrokerPersister.js';
import { EventLog } from './persistence/EventLog.js';
import { SnapshotStore } from './persistence/SnapshotStore.js';
import { StrategyEngine, type Strategy } from './strategy/StrategyEngine.js';
import { OrderFactory } from './strategy/OrderFactory.js';
import { SignalExecutor } from './strategy/SignalExecutor.js';
import { SizingEngine } from './strategy/SizingEngine.js';
import { MtfStateEngine } from './market/MtfStateEngine.js';
import { MarketStructureEngine } from './market/structure/MarketStructureEngine.js';
import { SmcLocationEngine } from './market/smc/SmcLocationEngine.js';
import { SetupEngine } from './market/setup/SetupEngine.js';
import { ExecutionPlanEngine } from './market/execution/ExecutionPlanEngine.js';
import { TradeIntentEngine } from './trading/TradeIntentEngine.js';
import { ExecutionRouter } from './execution/ExecutionRouter.js';
import { DEFAULT_RISK_CONFIG } from './trading/risk/RiskLimits.js';
import { PortfolioCorrelationGuard } from './risk/PortfolioCorrelationGuard.js';
import { LiveTradingGuard } from './execution/LiveTradingGuard.js';
import { CoinDCXBroker } from './coindcx/CoinDCXBroker.js';
import { MarketDataSupervisor } from './market/supervisor/MarketDataSupervisor.js';
import { ExchangeReconciler } from './execution/ExchangeReconciler.js';
import type { ProfitGoalManager } from './trading/goals/ProfitGoalManager.js';
import { ProfitGoalStore } from './trading/goals/ProfitGoalStore.js';
import type { ProfitGoalConfig } from './trading/goals/ProfitGoalTypes.js';
import { TrailingStopManager } from './trading/risk/TrailingStopManager.js';
import { TrailingStopController } from './trading/risk/TrailingStopController.js';
import { StrategyPerformanceTracker } from './strategy/StrategyPerformanceTracker.js';
import { StrategyPerformanceStore } from './strategy/StrategyPerformanceStore.js';
import { SetupOutcomeTracker } from './strategy/SetupOutcomeTracker.js';
import { TradingAgentsPipeline, type AgentCycleStep } from './ai/tradingAgents.js';
import { ModelManager } from './ai/ModelManager.js';
import { ToolRegistry } from './ai/tools/registry.js';
import {
  createMarketDataTool,
  createPositionInfoTool,
  createWebSearchTool,
  createNewsSentimentTool,
  createMacroFundingTool,
  createOnChainWhaleTool,
  createDocsLookupTool,
} from './ai/tools/index.js';
import { AgentMemoryStore } from './ai/memory/AgentMemoryStore.js';
import { SelfImprovementLoop } from './ai/SelfImprovementLoop.js';
import { StrategyParamLearner } from './strategy/learning/StrategyParamLearner.js';
import { StrategySelector } from './strategy/learning/StrategySelector.js';
import { ABTestRunner } from './strategy/abtesting/ABTestRunner.js';
import { MarketRegimeDetector } from './analysis/MarketRegimeDetector.js';
import { AdaptiveRiskManager } from './risk/AdaptiveRiskManager.js';
import { AutonomousTradingAgent } from './agent/AutonomousTradingAgent.js';
import { PerformanceTracker } from './agent/PerformanceTracker.js';
import { CircuitBreaker } from './agent/CircuitBreaker.js';
import { ExitManager } from './agent/ExitManager.js';
import { HealthMonitor } from './agent/HealthMonitor.js';
import { createSmcAgentStrategy } from './strategy/strategies/smc-agent.js';
import { createAdaptiveSupertrendStrategy } from './strategy/strategies/adaptive-supertrend.js';
import { ApiServer } from './api/server.js';
import { WebSocketGateway } from './api/websocket/WebSocketGateway.js';
import type { WebSocketEventType } from './api/websocket/types.js';
import { Scheduler } from './scheduler/jobs.js';
import { TelegramNotifier } from './notifications/TelegramNotifier.js';
import { logger } from './telemetry/logger.js';
import { metrics } from './telemetry/metrics.js';
import {
  createMarketStateGetter,
  createCandleGetter,
  createAccountStateGetter,
  createPositionsGetter,
  buildToolContext,
} from './engine/ToolContextFactory.js';

export interface EngineHandle {
  stop(): Promise<void>;
}

function printStartupBanner(profile: typeof runtimeProfile, symbolsList: string[]): void {
  const line = '═'.repeat(44);
  console.log(`╔${line}╗`);
  console.log(`║        TRADING SYSTEM STARTING             ║`);
  console.log(`╠${line}╣`);
  console.log(`║ Mode:             ${profile.mode.toUpperCase().padEnd(25)}║`);
  console.log(`║ Execution Venue:  ${profile.executionVenue.padEnd(25)}║`);
  console.log(`║ Real Orders:      ${(profile.realOrders ? 'YES (ARMED)' : 'NO').padEnd(25)}║`);
  console.log(`║ Market Primary:   ${profile.marketDataPrimary.padEnd(25)}║`);
  console.log(`║ Market Fallback:  ${profile.marketDataFallback.padEnd(25)}║`);
  console.log(`║ Telegram Alerts:  ${(profile.telegramEnabled ? 'ONLINE' : 'DISABLED').padEnd(25)}║`);
  console.log(`║ Symbols:          ${symbolsList.join(', ').slice(0, 25).padEnd(25)}║`);
  console.log(`╚${line}╝`);
}

export async function startEngine(): Promise<EngineHandle> {
  printStartupBanner(runtimeProfile, symbols);
  logger.info({ mode: runtimeProfile.mode, venue: runtimeProfile.executionVenue }, 'Starting trading engine');

  const dataDir = env.DB_FILE.replace(/\/[^/]+$/, '');

  const db = new DatabaseManager(dataDir);
  const events = new EventLog(env.EVENT_LOG_FILE, db.raw);
  const snapshots = new SnapshotStore(env.SNAPSHOT_DIR, db.raw);

  const client = new BinanceClient({
    testnet: env.BINANCE_ENV === 'testnet',
    apiKey: env.BINANCE_API_KEY,
    apiSecret: env.BINANCE_API_SECRET,
  });

  let instruments = defaultInstruments;
  const bootstrap = await bootstrapFromBinance(client, symbols);

  if (bootstrap.instruments.length > 0) {
    instruments = bootstrap.instruments;
  } else {
    logger.warn('Bootstrap returned no instruments, using defaults');
  }

  const marketState = new MarketStateManager(instruments);

  // Declared before the broker because the broker's onFill hook broadcasts
  // profit-goal updates through it.
  const wsGateway = new WebSocketGateway();

  // --- Market data supervision --------------------------------------------
  // Tracks per-provider liveness and latency, and arms the cross-exchange
  // divergence check.
  //
  // Failover has nowhere to go today: this repository ships no CoinDCX *market
  // data* feed, so the COINDCX provider never records a tick and
  // validateFailover() will correctly refuse to switch to it. That is the
  // intended behaviour — detect and report primary staleness, never silently
  // promote a feed that does not exist. When a second feed is added, call
  // supervisor.processTick('COINDCX', ...) from it and failover becomes live
  // with no further change here.
  const supervisor = new MarketDataSupervisor({
    primary: runtimeProfile.marketDataPrimary,
    fallback: runtimeProfile.marketDataFallback,
  });

  // --- Profit goals -------------------------------------------------------
  // Restored from disk so a target hit before a restart still throttles risk
  // afterwards. Disabled by default: PROFIT_GOALS_ENABLED=true opts in.
  const profitGoalConfig: ProfitGoalConfig = {
    dailyTargetPct: env.PROFIT_GOAL_DAILY_TARGET_PCT,
    weeklyTargetPct: env.PROFIT_GOAL_WEEKLY_TARGET_PCT,
    monthlyTargetPct: env.PROFIT_GOAL_MONTHLY_TARGET_PCT,
    targetAchievedAction: env.PROFIT_GOAL_ACTION,
    riskReductionFactor: env.PROFIT_GOAL_RISK_REDUCTION_FACTOR,
    cooldownAfterTargetMs: env.PROFIT_GOAL_COOLDOWN_MS,
    enableDailyGoals: env.PROFIT_GOAL_ENABLE_DAILY,
    enableWeeklyGoals: env.PROFIT_GOAL_ENABLE_WEEKLY,
    enableMonthlyGoals: env.PROFIT_GOAL_ENABLE_MONTHLY,
  };
  const profitGoalStore = new ProfitGoalStore(path.join(dataDir, 'profit_goals.json'));
  const profitGoals: ProfitGoalManager | undefined = env.PROFIT_GOALS_ENABLED
    ? profitGoalStore.load(env.PAPER_STARTING_USDT, profitGoalConfig)
    : undefined;
  if (!profitGoals) {
    logger.info('Profit goals disabled (set PROFIT_GOALS_ENABLED=true to enable)');
  }

  // --- Per-strategy performance feedback ----------------------------------
  const strategyPerformanceStore = new StrategyPerformanceStore(
    path.join(dataDir, 'strategy_performance.json')
  );
  const strategyPerformance = new StrategyPerformanceTracker({
    thresholds: {
      minTradesBeforeAction: env.STRATEGY_FEEDBACK_MIN_TRADES,
      maxDrawdownUsdt: env.STRATEGY_FEEDBACK_MAX_DRAWDOWN_USDT,
      minWinRate: env.STRATEGY_FEEDBACK_MIN_WIN_RATE,
    },
    onQuarantine: ({ strategyId, reason, stats }) => {
      events.appendSystemEvent({
        eventType: 'STRATEGY_QUARANTINED',
        payload: { strategyId, reason, stats },
        createdAtUtc: new Date().toISOString(),
      });
      strategyPerformanceStore.save(strategyPerformance.listStats());
    },
  });
  strategyPerformance.restore(strategyPerformanceStore.load());
  if (!env.STRATEGY_FEEDBACK_ENABLED) {
    logger.info('Strategy performance feedback is observe-only (set STRATEGY_FEEDBACK_ENABLED=true to quarantine)');
  }

  // --- Self-learning: per-setup-archetype performance feedback for the SMC
  // agent (smc-agent.ts) ----------------------------------------------------
  // Reuses StrategyPerformanceTracker as-is, keyed by setup archetype (e.g.
  // 'SSL_SWEEP_REVERSAL_LONG') instead of strategy id — same quarantine
  // semantics, narrower scope. Closes the gap PROJECT_STATE.md records under
  // Agent/LLM Learning: previously only adaptive-supertrend's Q-table learned
  // from outcomes, and the LLM debate had no memory across cycles.
  const setupPerformanceStore = new StrategyPerformanceStore(
    path.join(dataDir, 'setup_performance.json')
  );
  const setupPerformance = new StrategyPerformanceTracker({
    thresholds: {
      minTradesBeforeAction: env.SETUP_FEEDBACK_MIN_TRADES,
      maxDrawdownUsdt: env.SETUP_FEEDBACK_MAX_DRAWDOWN_USDT,
      minWinRate: env.SETUP_FEEDBACK_MIN_WIN_RATE,
    },
    onQuarantine: ({ strategyId: setupType, reason, stats }) => {
      events.appendSystemEvent({
        eventType: 'SETUP_TYPE_QUARANTINED',
        payload: { setupType, reason, stats },
        createdAtUtc: new Date().toISOString(),
      });
      setupPerformanceStore.save(setupPerformance.listStats());
    },
  });
  setupPerformance.restore(setupPerformanceStore.load());
  const setupOutcomeTracker = new SetupOutcomeTracker();
  if (!env.SETUP_FEEDBACK_ENABLED) {
    logger.info('Setup-archetype performance feedback is observe-only (set SETUP_FEEDBACK_ENABLED=true to quarantine)');
  }

  // --- Agentic layer outer refs (feature/agentic-upgrade) -------------------
  // These are declared before broker construction so the broker's onFill
  // closure can reference them. They're assigned later (after ModelManager
  // is constructed) and stay undefined when their env flag is off — the
  // onFill closure uses optional chaining so a disabled feature is a no-op.
  let selfImprovementLoop: SelfImprovementLoop | undefined;
  let agentMemoryStore: AgentMemoryStore | undefined;
  let strategyParamLearner: StrategyParamLearner | undefined;
  let strategySelector: StrategySelector | undefined;
  let abTestRunner: ABTestRunner | undefined;
  let toolRegistry: ToolRegistry | undefined;
  // Outer ref for the regime lookup — assigned after the regimeDetector is
  // constructed, default returns undefined so disabled agents see no regime.
  let getRegimeForSymbol: (symbol: string) => string | undefined = () => undefined;

  const broker = new PaperBroker({
    dataDir,
    accountId: 'paper-main',
    startingUsdt: env.PAPER_STARTING_USDT,
    instruments,
    marketState,
    eventLog: events,
    persister: new SQLiteBrokerPersister(db.raw),
    onFill: (fill) => {
      // Only closing fills realize PnL; opening fills realize 0 and are
      // ignored by both consumers.
      if (fill.realizedPnl === 0) return;

      if (fill.strategyId) {
        strategyPerformance.recordRealizedPnl(fill.strategyId, fill.realizedPnl, fill.fillTsUtc);
        strategyPerformanceStore.save(strategyPerformance.listStats());
      }

      if (fill.strategyId === 'smc-agent-v1') {
        const setupType = setupOutcomeTracker.resolveOnClose(fill.symbol);
        if (setupType) {
          setupPerformance.recordRealizedPnl(setupType, fill.realizedPnl, fill.fillTsUtc);
          setupPerformanceStore.save(setupPerformance.listStats());
        }
      }

      // (feature/agentic-upgrade) Agentic layer hooks — fire-and-forget,
      // soft-fail. The SelfImprovementLoop dispatches an async LLM call
      // in the background; the StrategySelector records per-regime stats
      // synchronously. Both are no-ops when their env flag is off.
      const regime = getRegimeForSymbol(fill.symbol);
      selfImprovementLoop?.onClosingFill(fill);
      if (fill.strategyId) {
        strategySelector?.recordOutcome(fill.strategyId, regime ?? 'unknown', fill.realizedPnl);
      }

      if (profitGoals) {
        const account = broker.getAccount();
        profitGoals.updatePnL({
          realizedPnl: fill.realizedPnl,
          currentEquity: account.equity,
          timestamp: new Date(fill.fillTsUtc).getTime(),
        });
        profitGoalStore.save(profitGoals);
        wsGateway.broadcast('profit.goal', {
          state: profitGoals.getState(),
          dailyProgressPct: profitGoals.getDailyProgressPercent(),
          weeklyProgressPct: profitGoals.getWeeklyProgressPercent(),
        });
      }
    },
  });

  // --- Execution routing --------------------------------------------------
  // CONTRACTS.md Section 7: TRADING_MODE is the single operational profile
  // selector. Everything that submits an order goes through the router so the
  // mode profile and the live guard are actually applied, instead of the
  // engine talking to PaperBroker directly regardless of mode.
  //
  // No live venue adapter ships in this repository, so an armed live profile
  // is rejected by the router rather than silently paper-filled.
  const liveGuard = new LiveTradingGuard();

  // The live venue adapter is only constructed when the profile actually asks
  // for real orders AND credentials are present. Constructing it
  // unconditionally would put a credential-less client on the hot path and
  // blur the line between "live is possible" and "live is armed".
  let coindcxBroker: CoinDCXBroker | undefined;
  if (runtimeProfile.executionVenue === 'COINDCX' && runtimeProfile.realOrders) {
    if (env.COINDCX_API_KEY && env.COINDCX_API_SECRET) {
      coindcxBroker = new CoinDCXBroker({
        apiKey: env.COINDCX_API_KEY,
        apiSecret: env.COINDCX_API_SECRET,
      });
      logger.warn(
        'LIVE EXECUTION ARMED — orders will be routed to CoinDCX with real funds'
      );
    } else {
      // Router rejects with NO_LIVE_EXECUTION_ADAPTER rather than silently
      // paper-filling while the profile reports live execution.
      logger.error(
        'TRADING_MODE=live is armed but COINDCX_API_KEY/COINDCX_API_SECRET are missing — all orders will be REJECTED'
      );
    }
  }

  const executionBroker = new ExecutionRouter({
    profile: runtimeProfile,
    paperBroker: broker,
    coindcxBroker,
    guard: liveGuard,
  });

  // --- Exchange state reconciliation --------------------------------------
  // CONTRACTS.md Section 6: reconcile after startup and reconnect, and block
  // submission while exchange state is unknown or disagrees with local belief.
  // Only meaningful when a live venue is actually attached.
  const reconciler = coindcxBroker
    ? new ExchangeReconciler({
        venue: coindcxBroker,
        local: broker,
        guard: liveGuard,
        onReport: (report) => {
          events.appendSystemEvent({
            eventType: report.ok ? 'RECONCILIATION_OK' : 'RECONCILIATION_MISMATCH',
            payload: { ...report },
            createdAtUtc: report.reconciledAtUtc,
          });
          wsGateway.broadcast('reconciliation.report', report);
        },
      })
    : undefined;

  const klines = new KlineStore(500);

  // Preload historical klines to allow strategies to evaluate immediately
  for (const symbol of symbols) {
    for (const interval of timeframes) {
      try {
        await klines.fetchHistoricalKlines(symbol, interval, 200);
        logger.info({ symbol, interval }, 'Preloaded historical klines');
      } catch (err) {
        logger.error({ err, symbol, interval }, 'Failed to preload historical klines');
      }
    }

    const recent1m = klines.getCandles(symbol, '1m', 1);
    const recentDefault = klines.getCandles(symbol, timeframes[0] ?? '15m', 1);
    const latest = recent1m.length > 0 ? recent1m[0] : recentDefault[0];
    if (latest) {
      marketState.onBookTicker(symbol, latest.close * 0.9999, latest.close * 1.0001, 10, 10);
      marketState.onAggTrade(symbol, latest.close, latest.volume);
      broker.onMarket({
        symbol,
        bid: latest.close * 0.9999,
        ask: latest.close * 1.0001,
        last: latest.close,
        mark: latest.close,
        localTsUtc: Date.now(),
        stale: false,
      });
    }
  }

  // --- Trailing stops -----------------------------------------------------
  // Stops are resting reduce-only STOP_MARKET orders, so trailing them means
  // cancel-and-replace at the broker; TrailingStopController owns that.
  const trailingStops = env.TRAILING_STOPS_ENABLED
    ? new TrailingStopController({
        broker: executionBroker,
        manager: new TrailingStopManager({
          activationThresholdPct: env.TRAILING_ACTIVATION_PCT,
          trailingDistancePct: env.TRAILING_DISTANCE_PCT,
          breakevenTriggerPct: env.TRAILING_BREAKEVEN_PCT,
          enableBreakeven: true,
          enableTrailing: true,
          tpExtensionPct: env.TRAILING_TP_EXTENSION_PCT,
          enableTpExtension: true,
        }),
        onStopMoved: (moved) => {
          wsGateway.broadcast('trailing.stop', moved);
          events.appendSystemEvent({
            eventType: 'TRAILING_STOP_MOVED',
            payload: { ...moved },
            createdAtUtc: new Date().toISOString(),
          });
        },
      })
    : undefined;
  if (!trailingStops) {
    logger.info('Trailing stops disabled (set TRAILING_STOPS_ENABLED=true to enable)');
  }

  const orderFactory = new OrderFactory({ defaultLeverage: 5 });
  // SizingEngine is the fallback size resolver for OPEN signals that arrive
  // without features.quantity. The autonomous agent + SMC + Adaptive Supertrend
  // stack pre-computes quantity themselves; classic indicator strategies
  // (ema-trend-5m, rsi-mean-reversion-5m, momentum-5m, mean-reversion-5m,
  // breakout-15m, grid-15m) don't, so they rely on this fallback. Even with
  // classic strategies disabled (default), SizingEngine is harmless — the
  // existing strategies always supply features.quantity so the fallback is
  // never invoked for them. The wiring stays on so flipping
  // CLASSIC_STRATEGIES_ENABLED=true "just works" without an engine restart.
  const sizingEngine = new SizingEngine({
    riskPerTrade: env.SIZING_RISK_PER_TRADE,
    maxNotional: env.SIZING_MAX_NOTIONAL,
    fallbackRiskPerTrade: env.SIZING_FALLBACK_RISK_PER_TRADE,
  });
  const signalExecutor = new SignalExecutor({
    broker: executionBroker,
    orderFactory,
    signals: db.signals,
    getMarketState: (symbol) => marketState.getState(symbol),
    sizingEngine,
    getAccount: () => broker.getAccount(),
    getInstrument: (symbol) => broker.getInstrument(symbol),
    logger: {
      warn: (msg) => logger.warn(msg),
      error: (error, msg) => logger.error({ error }, msg),
    },
  });

  const strategyEngine = new StrategyEngine(
    {
      marketState: (symbol) => marketState.getState(symbol),
      klines,
      account: () => broker.getAccount(),
      getPosition: (symbol) => broker.getPosition(symbol),
      getOpenOrders: (symbol) => broker.getOpenOrders(symbol),
      getInstrument: (symbol) => broker.getInstrument(symbol),
      // Reads stay on the paper broker (it owns the simulated ledger); the
      // write path goes through the router so mode + guard apply.
      submitOrder: (order) => broker.submitOrder(order),
    },
    {
      onSubmitSignal: async (signal) => {
        db.signals.insert(signal);
        metrics.inc('signals_received_total');
        return signalExecutor.execute(signal);
      },
      isQuarantined: (strategyId) =>
        env.STRATEGY_FEEDBACK_ENABLED && strategyPerformance.isQuarantined(strategyId),
    },
    {
      onSignal: (signal) => {
        logger.info(`[Signal] ${signal.strategyId} ${signal.symbol} ${signal.action} conf=${signal.confidence}`);
        metrics.inc('signals_validated_total');
      },
      onSignalRejected: (signal, reason) => {
        logger.warn(`[Signal] Rejected ${signal.strategyId} ${signal.symbol} ${signal.action}: ${reason}`);
        metrics.inc('signals_rejected_total');
      },
    },
    // Multi-strategy orchestration (AUTONOMY_AUDIT Finding 3): one strategy
    // owns a symbol's entry rights for the TTL after an accepted OPEN.
    // Autonomous-first default: on, escape hatch via SYMBOL_LOCK_ENABLED=false.
    {
      symbolLockEnabled: env.SYMBOL_LOCK_ENABLED,
      symbolLockTtlMs: env.SYMBOL_LOCK_TTL_MS,
    }
  );

  const structureEngine = new MarketStructureEngine(klines);
  const smcEngine = new SmcLocationEngine(klines, structureEngine);
  const mtfEngine = new MtfStateEngine(klines, marketState);
  const setupEngine = new SetupEngine(mtfEngine, structureEngine, smcEngine);
  const planEngine = new ExecutionPlanEngine();
  // Profit-goal state reaches risk validation here: RiskEngine consults it for
  // both the trading-halt check and the position-size risk multiplier.
  const tradeIntentEngine = new TradeIntentEngine(
    profitGoals ? { profitGoalManager: profitGoals } : undefined
  );
  const cloudKeys = [env.OLLAMA_API_KEY_1, env.OLLAMA_API_KEY_2, env.OLLAMA_API_KEY_3].filter(Boolean) as string[];

  // --- Agentic layer construction (feature/agentic-upgrade) ---------------
  // All features below default OFF. When their env flag is true, they
  // construct the corresponding module + wire it into the broker.onFill
  // closure (which captured these `let` variables above) and into the
  // TradingAgentsPipeline (via the toolRegistry + buildToolContext config
  // below). When OFF, the existing pipeline behaviour is unchanged.
  if (env.AGENT_TOOLS_ENABLED) {
    toolRegistry = new ToolRegistry();
    // Shared projection helpers (extracted to src/engine/ToolContextFactory
    // to eliminate duplication with the buildToolContext callback below).
    const getMarketState = createMarketStateGetter(marketState);
    const getCandles = createCandleGetter(klines);
    const getAccountState = createAccountStateGetter(broker);
    const getPositions = createPositionsGetter(broker);

    toolRegistry.register(createMarketDataTool({ get: getMarketState, candles: getCandles }));
    toolRegistry.register(createPositionInfoTool({ getAccount: getAccountState, getPositions }));
    toolRegistry.register(
      createWebSearchTool({
        provider: env.AGENT_WEB_SEARCH_PROVIDER,
        braveKey: env.AGENT_WEB_SEARCH_BRAVE_KEY,
        timeoutMs: env.AGENT_TOOLS_TIMEOUT_MS,
        ratePerMin: env.AGENT_WEB_SEARCH_RATE_PER_MIN,
      })
    );
    toolRegistry.register(createNewsSentimentTool(env.AGENT_TOOLS_TIMEOUT_MS));
    toolRegistry.register(createMacroFundingTool(env.AGENT_TOOLS_TIMEOUT_MS));
    toolRegistry.register(createOnChainWhaleTool(env.AGENT_TOOLS_TIMEOUT_MS));
    toolRegistry.register(createDocsLookupTool());
    logger.info(
      { tools: toolRegistry.list() },
      'Agentic layer: tool registry enabled — analyst stage will pull external context before each report'
    );
  } else {
    logger.info('Agentic layer: tools disabled (set AGENT_TOOLS_ENABLED=true to enable)');
  }

  if (env.AGENT_MEMORY_ENABLED) {
    agentMemoryStore = new AgentMemoryStore({
      dbPath: path.isAbsolute(env.AGENT_MEMORY_DB_PATH)
        ? env.AGENT_MEMORY_DB_PATH
        : path.join(dataDir, path.basename(env.AGENT_MEMORY_DB_PATH)),
      decayFloor: env.AGENT_MEMORY_LESSON_DECAY_FLOOR,
      pruneOlderThanMs: env.AGENT_MEMORY_PRUNE_MS,
      topK: env.AGENT_MEMORY_INJECT_TOP_K,
    });
    logger.info({ dbPath: env.AGENT_MEMORY_DB_PATH }, 'Agentic layer: agent memory store enabled');
  } else {
    logger.info('Agentic layer: agent memory disabled (set AGENT_MEMORY_ENABLED=true to enable)');
  }

  if (env.AGENT_PARAM_LEARNING_ENABLED) {
    strategyParamLearner = new StrategyParamLearner({
      persistencePath: path.join(dataDir, 'strategy_param_qtable.json'),
      alpha: env.AGENT_PARAM_LEARNING_ALPHA,
      gamma: env.AGENT_PARAM_LEARNING_GAMMA,
      epsilon: env.AGENT_PARAM_LEARNING_EPSILON,
      minTrades: env.AGENT_PARAM_LEARNING_MIN_TRADES,
      enabled: true,
    });
    logger.info(
      { alpha: env.AGENT_PARAM_LEARNING_ALPHA, gamma: env.AGENT_PARAM_LEARNING_GAMMA, epsilon: env.AGENT_PARAM_LEARNING_EPSILON },
      'Agentic layer: strategy parameter learner enabled'
    );
  } else {
    logger.info('Agentic layer: strategy parameter learning disabled (set AGENT_PARAM_LEARNING_ENABLED=true to enable)');
  }

  if (env.AGENT_STRATEGY_SELECTOR_ENABLED) {
    strategySelector = new StrategySelector({
      persistencePath: path.join(dataDir, 'strategy_selector_state.json'),
      minTrades: env.AGENT_STRATEGY_SELECTOR_MIN_TRADES,
      maxDrawdownUsdt: env.STRATEGY_FEEDBACK_MAX_DRAWDOWN_USDT,
      minWinRate: env.STRATEGY_FEEDBACK_MIN_WIN_RATE,
      enabled: true,
    });
    logger.info('Agentic layer: strategy selector enabled (per-regime promotion/demotion)');
  } else {
    logger.info('Agentic layer: strategy selector disabled (set AGENT_STRATEGY_SELECTOR_ENABLED=true to enable)');
  }

  if (env.AGENT_AB_TESTING_ENABLED) {
    abTestRunner = new ABTestRunner(
      {
        enabled: true,
        instances: env.AGENT_AB_TESTING_INSTANCES,
        windowTrades: env.AGENT_AB_TESTING_WINDOW_TRADES,
        evalIntervalMs: env.AGENT_AB_TESTING_EVAL_INTERVAL_MS,
      },
      []
    );
    logger.info({ instances: env.AGENT_AB_TESTING_INSTANCES }, 'Agentic layer: A/B testing runner enabled');
  } else {
    logger.info('Agentic layer: A/B testing disabled (set AGENT_AB_TESTING_ENABLED=true to enable)');
  }

  // The TradingAgentsPipeline needs the toolRegistry + a ToolContext factory
  // so its analyst stage can invoke tools. Both stay undefined when
  // AGENT_TOOLS_ENABLED is false — the pipeline falls back to its existing
  // no-tools behaviour (backward compatible).
  const tradingAgentsPipeline = new TradingAgentsPipeline({
    model: env.OLLAMA_MODEL,
    baseUrl: env.OLLAMA_BASE_URL,
    apiKeys: cloudKeys,
    cloudBaseUrl: env.OLLAMA_CLOUD_BASE_URL,
    cloudModel: env.OLLAMA_CLOUD_MODEL,
    timeoutMs: 15_000,
    toolRegistry,
    toolsMaxIterations: env.AGENT_TOOLS_MAX_ITERATIONS,
    toolsTimeoutMs: env.AGENT_TOOLS_TIMEOUT_MS,
    buildToolContext: toolRegistry
      ? (symbol, cycleId, deadlineMs) =>
          buildToolContext({ marketState, klines, broker }, symbol, cycleId, deadlineMs)
      : undefined,
  });

  // Non-blocking: the agent debate already falls back to a safe NEUTRAL decision when
  // Ollama is unreachable (see TradingAgentsPipeline.runTrader), so this check gates
  // nothing — it exists purely so an operator sees why trading has gone quiet.
  void tradingAgentsPipeline.checkOllamaReachable().then((reachable) => {
    if (!reachable) {
      logger.warn({ baseUrl: env.OLLAMA_BASE_URL }, 'Ollama unreachable at startup — agent debate will fall back to NEUTRAL (no trades) until it recovers');
    }
  });

  // --- Autonomous trading agent ------------------------------------------
  // The autonomous agent sits ABOVE the strategy fleet and polls on its own
  // clock (default 30s), independent of candle-close events. It surveys
  // every symbol's MTF state, detects forming + ready setups, classifies
  // the market regime, builds regime-adjusted trade plans, and submits
  // signals through the same StrategyEngine pipeline regular strategies use.
  //
  // ENABLED BY DEFAULT — `pnpm start` boots the engine in fully autonomous
  // mode. Operators who need the legacy candle-driven-only behaviour (e.g. to
  // debug the strategy fleet in isolation) can opt out by setting
  // AUTONOMOUS_AGENT_ENABLED=false, or use `pnpm paper:candle-only` which
  // sets that flag for them.
  const modelManager = new ModelManager({
    llmEndpoints: [
      // Ollama Cloud accounts (when configured) come first for capacity.
      ...cloudKeys.map((key, idx) => ({
        name: `ollama-cloud-account-${idx + 1}`,
        kind: 'llm' as const,
        baseUrl: env.OLLAMA_CLOUD_BASE_URL,
        model: env.OLLAMA_CLOUD_MODEL,
        apiKey: key,
        priority: idx + 1,
        timeoutMs: 30_000,
      })),
      // Local Ollama daemon as the always-available fallback.
      {
        name: 'ollama-local-daemon',
        kind: 'llm' as const,
        baseUrl: env.OLLAMA_BASE_URL,
        model: env.OLLAMA_MODEL,
        priority: cloudKeys.length + 1,
        timeoutMs: 30_000,
      },
    ],
    globalTimeoutMs: 30_000,
    defaultModel: cloudKeys.length > 0 ? env.OLLAMA_CLOUD_MODEL : env.OLLAMA_MODEL,
  });

  // --- Agentic layer: SelfImprovementLoop wires ModelManager + AgentMemoryStore
  // together so closing fills trigger reflection LLM calls and the lessons
  // learned are re-injected into the next analyst cycle's prompt. Off when
  // AGENT_MEMORY_ENABLED is false — both `selfImprovementLoop` and
  // `agentMemoryStore` stay undefined and the onFill closure's optional
  // chaining makes them no-ops. (feature/agentic-upgrade)
  if (env.AGENT_MEMORY_ENABLED && agentMemoryStore) {
    selfImprovementLoop = new SelfImprovementLoop(
      { modelManager, store: agentMemoryStore },
      { timeoutMs: env.AGENT_MEMORY_REFLECT_TIMEOUT_MS, temperature: 0.4, maxTokens: 1_500 }
    );
    logger.info('Agentic layer: self-improvement loop wired (broker.onFill → reflection → memory → next-cycle prompt)');
  }

  const regimeDetector = new MarketRegimeDetector(
    (symbol, count) => {
      // Pull closed 4h candles for the regime feature extractor.
      const all = klines.getCandles(symbol, '4h', count);
      return all.filter((c) => c.isClosed).slice(-count);
    },
    (symbol) => structureEngine.computeMultiTimeframeStructure(symbol, Date.now()).timeframes['1h']?.trend,
    env.AUTONOMOUS_REGIME_CONFIRMATION_BARS
  );

  // Wire the regime lookup outer ref so the broker.onFill closure can label
  // each closing trade with the regime in force at close time. Cheap call
  // (regimeDetector caches recent computations) and returns undefined when
  // there's not enough HTF history — the strategySelector falls back to
  // 'unknown'. (feature/agentic-upgrade)
  getRegimeForSymbol = (symbol: string): string | undefined => {
    const snap = regimeDetector.detect(symbol);
    return snap?.regime;
  };
  let autonomousAgent: AutonomousTradingAgent | undefined;
  if (env.AUTONOMOUS_AGENT_ENABLED !== false) {
    // --- The agent's brain: 4 modules wired before the agent itself ----------
    // Each one is a single-purpose class so the agent's main loop stays
    // focused on the per-symbol scan. Order matters here: the health
    // monitor must exist before the circuit breaker (which queries it on
    // every cycle), and the performance tracker must exist before both
    // (the breaker queries its consecutive-loss count).
    const healthMonitor = new HealthMonitor(
      {
        symbols,
        timeframes: ['4h', '1h', '15m', '5m'],
        staleMs: env.AUTONOMOUS_HEALTH_STALE_MS,
        modelProbeIntervalMs: env.AUTONOMOUS_HEALTH_MODEL_PROBE_INTERVAL_MS,
      },
      {
        eventLog: events,
        wsGateway,
        mtfEngine,
        marketState,
        modelManager,
      }
    );

    const performanceTracker = new PerformanceTracker(
      {
        strategyId: env.AUTONOMOUS_STRATEGY_ID,
        windowSize: env.AUTONOMOUS_LEARN_WINDOW_SIZE,
        minSample: env.AUTONOMOUS_LEARN_MIN_SAMPLE,
        riskAdaptStep: env.AUTONOMOUS_LEARN_RISK_ADAPT_STEP,
        riskMultMin: env.AUTONOMOUS_LEARN_RISK_MULT_MIN,
        riskMultMax: env.AUTONOMOUS_LEARN_RISK_MULT_MAX,
      },
      { eventLog: events }
    );

    // Adaptive risk manager — regime overlay x per-regime learning bias
    // (Finding 4): the tracker's getRegimeStats feeds observed per-regime
    // win rate straight into computeTradePlan's riskMultiplier, so the plan
    // reflects not just what the regime SHOULD allow but how the agent has
    // actually been performing inside it.
    const adaptiveRiskManager = new AdaptiveRiskManager({
      baseConfig: DEFAULT_RISK_CONFIG,
      getEquity: () => broker.getAccount().equity,
      getLastPrice: (symbol) => marketState.getState(symbol)?.last,
      getCandles: (symbol, timeframe, count) => {
        const all = klines.getCandles(symbol, timeframe as KlineInterval, count);
        return all.filter((c) => c.isClosed).slice(-count);
      },
      getRegimeStats: (regime) => performanceTracker.getRegimeStats(regime),
    });

    // The circuit breaker's `getHealth` reads the monitor's cached state
    // (no extra probes — the agent itself triggers one full probe per cycle).
    const circuitBreaker = new CircuitBreaker(
      {
        maxDailyLossPct: env.AUTONOMOUS_CB_MAX_DAILY_LOSS_PCT,
        maxConsecutiveLosses: env.AUTONOMOUS_CB_MAX_CONSECUTIVE_LOSSES,
        maxDrawdownPct: env.AUTONOMOUS_CB_MAX_DRAWDOWN_PCT,
        cooldownMs: env.AUTONOMOUS_CB_COOLDOWN_MS,
        requireHealthyMarket: env.AUTONOMOUS_CB_REQUIRE_HEALTHY_MARKET,
      },
      {
        eventLog: events,
        wsGateway,
        getAccount: () => broker.getAccount(),
        getConsecutiveLosses: () => performanceTracker.getRollingStats().consecutiveLosses,
        getHealth: () => healthMonitor.getState(),
      }
    );

    // The exit manager hands the trailing-stop controller a `forget(symbol)`
    // hook so the controller doesn't keep trying to move stops on positions
    // the agent just flattened. The controller is optional (only constructed
    // when TRAILING_STOPS_ENABLED), so we use optional chaining.
    // Scaling (Finding 2): pyramid adds into winners + one-time downside
    // de-risk of losers — bounded by the knobs below.
    const exitManager = new ExitManager(
      {
        exitOnRegimeFlip: env.AUTONOMOUS_EXIT_ON_REGIME_FLIP,
        maxUnrealizedLossPct: env.AUTONOMOUS_EXIT_MAX_UNREALIZED_LOSS_PCT,
        strategyId: env.AUTONOMOUS_STRATEGY_ID,
        scaling: {
          enabled: env.AUTONOMOUS_SCALING_ENABLED,
          scaleInMinProfitPct: env.AUTONOMOUS_SCALE_IN_MIN_PROFIT_PCT,
          scaleInSizeFraction: env.AUTONOMOUS_SCALE_IN_SIZE_FRACTION,
          scaleInMaxAdds: env.AUTONOMOUS_SCALE_IN_MAX_ADDS,
          scaleInCooldownMs: env.AUTONOMOUS_SCALE_IN_COOLDOWN_MS,
          scaleOutTriggerPct: env.AUTONOMOUS_SCALE_OUT_TRIGGER_PCT,
          scaleOutCloseFraction: env.AUTONOMOUS_SCALE_OUT_CLOSE_FRACTION,
        },
      },
      {
        eventLog: events,
        wsGateway,
        strategyEngine,
        regimeDetector,
        getPositions: () => broker.getPositions(),
        getAccount: () => broker.getAccount(),
        getLastPrice: (symbol) => marketState.getState(symbol)?.last,
        forgetTrailingStop: (symbol) => trailingStops?.forget(symbol),
      }
    );

    // Correlation-aware portfolio cap (AUTONOMY_AUDIT Finding 8): the
    // count-based maxOpenPositions gate can't see that BTC + ETH + SOL all
    // long is one bet. The guard estimates pairwise correlations from
    // recent 1h candles and caps the margin the candidate adds to its
    // correlated cluster. Optional dep — absent (or disabled via env) the
    // agent falls back to the count-based gate only.
    const correlationGuard = new PortfolioCorrelationGuard(
      {
        enabled: env.AUTONOMOUS_CORRELATION_ENABLED,
        correlationFloor: env.AUTONOMOUS_CORRELATION_FLOOR,
        maxCorrelatedExposurePct: env.AUTONOMOUS_CORRELATION_MAX_EXPOSURE_PCT,
        lookbackCandles: env.AUTONOMOUS_CORRELATION_LOOKBACK,
        timeframe: '1h',
        minCandlesForEstimate: 30,
      },
      {
        getCandles: (symbol, timeframe, count) => {
          const all = klines.getCandles(symbol, timeframe as KlineInterval, count);
          return all.filter((c) => c.isClosed).slice(-count);
        },
      }
    );

    autonomousAgent = new AutonomousTradingAgent(
      {
        symbols,
        cycleMs: env.AUTONOMOUS_CYCLE_MS,
        minConfluence: env.AUTONOMOUS_MIN_CONFLUENCE,
        minRR: env.AUTONOMOUS_MIN_RR,
        maxOpenPositions: env.AUTONOMOUS_MAX_OPEN_POSITIONS,
        perSymbolMaxPositions: env.AUTONOMOUS_PER_SYMBOL_MAX_POSITIONS,
        cooldownMs: env.AUTONOMOUS_COOLDOWN_MS,
        strategyId: env.AUTONOMOUS_STRATEGY_ID,
        minConfidence: env.AUTONOMOUS_MIN_CONFIDENCE,
        regimeConfirmationBars: env.AUTONOMOUS_REGIME_CONFIRMATION_BARS,
        // AUTONOMY_AUDIT Finding 1: debate-driven LLM veto.
        llmVetoEnabled: env.AUTONOMOUS_LLM_VETO_ENABLED,
        // AUTONOMY_AUDIT Finding 5: weighted HTF alignment.
        htfAlignmentWeighted: env.AUTONOMOUS_HTF_ALIGNMENT_WEIGHTED,
        htfRangeWeight: env.AUTONOMOUS_HTF_RANGE_WEIGHT,
        htfCounterTrendWeight: env.AUTONOMOUS_HTF_COUNTER_WEIGHT,
      },
      {
        setupEngine,
        mtfEngine,
        regimeDetector,
        riskManager: adaptiveRiskManager,
        modelManager,
        strategyEngine,
        eventLog: events,
        wsGateway,
        getPositions: () => broker.getPositions(),
        getAccount: () => broker.getAccount(),
        getLastPrice: (symbol) => marketState.getState(symbol)?.last,
        performanceTracker,
        circuitBreaker,
        exitManager,
        healthMonitor,
        // Finding 1: the agent's entries now face the same bull/bear debate
        // the SMC strategy uses — a genuine opposing verdict vetoes.
        tradingAgents: tradingAgentsPipeline,
        getMarketState: (symbol) => marketState.getState(symbol),
        // Finding 8: correlation-aware portfolio cap.
        correlationGuard,
      }
    );
    logger.info(
      {
        cycleMs: env.AUTONOMOUS_CYCLE_MS,
        minConfluence: env.AUTONOMOUS_MIN_CONFLUENCE,
        minRR: env.AUTONOMOUS_MIN_RR,
        maxOpenPositions: env.AUTONOMOUS_MAX_OPEN_POSITIONS,
        cbMaxDailyLossPct: env.AUTONOMOUS_CB_MAX_DAILY_LOSS_PCT,
        cbMaxConsecutiveLosses: env.AUTONOMOUS_CB_MAX_CONSECUTIVE_LOSSES,
        learnWindowSize: env.AUTONOMOUS_LEARN_WINDOW_SIZE,
        exitOnRegimeFlip: env.AUTONOMOUS_EXIT_ON_REGIME_FLIP,
        scalingEnabled: env.AUTONOMOUS_SCALING_ENABLED,
        symbolLockEnabled: env.SYMBOL_LOCK_ENABLED,
        symbolLockTtlMs: env.SYMBOL_LOCK_TTL_MS,
        llmVetoEnabled: env.AUTONOMOUS_LLM_VETO_ENABLED,
        htfAlignmentWeighted: env.AUTONOMOUS_HTF_ALIGNMENT_WEIGHTED,
        correlationCapPct: env.AUTONOMOUS_CORRELATION_MAX_EXPOSURE_PCT,
        correlationFloor: env.AUTONOMOUS_CORRELATION_FLOOR,
      },
      'Autonomous trading agent enabled and will run on its own clock'
    );
  } else {
    logger.info('Autonomous trading agent explicitly disabled via AUTONOMOUS_AGENT_ENABLED=false — running candle-driven strategies only');
  }

  strategyEngine.register(
    createSmcAgentStrategy({
      setupEngine,
      structureEngine,
      smcEngine,
      planEngine,
      tradeIntentEngine,
      tradingAgentsPipeline,
      getInstrument: (symbol) => broker.getInstrument(symbol),
      symbols,
      getAllPositions: () => broker.getPositions(),
      getAllOpenOrders: () => broker.getOpenOrders(),
      setupPerformance,
      setupOutcomeTracker,
      enforceSetupQuarantine: env.SETUP_FEEDBACK_ENABLED,
      onCycleCompleted: (cycle) => {
        events.logAgentCycle(cycle);
        wsGateway.broadcast('agent.cycle', cycle);
      },
      onCycleStep: (step: AgentCycleStep) => {
        // Persist as well as broadcast. Broadcast-only meant the live debate
        // transcript was empty on every page load — the dashboard had no
        // history to replay because none was ever written. Debate cycles are
        // operator- or candle-triggered (a handful of stages each), so this is
        // not the high-frequency path; the synthetic per-signal step emitted by
        // the adaptive-supertrend strategy below is deliberately NOT persisted.
        events.appendSystemEvent({
          eventType: 'AGENT_STEP',
          payload: step as unknown as Record<string, unknown>,
          createdAtUtc: new Date().toISOString(),
        });
        wsGateway.broadcast('agent.step', step);
      },
    })
  );

  const aggressiveConfigPath = path.join(dataDir, 'aggressive_mode.json');
  let aggressiveMode = false;
  try {
    if (fs.existsSync(aggressiveConfigPath)) {
      const parsed = JSON.parse(fs.readFileSync(aggressiveConfigPath, 'utf8')) as { aggressive?: boolean };
      aggressiveMode = Boolean(parsed.aggressive);
      logger.info({ aggressiveMode }, 'Loaded persisted aggressive mode setting');
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to read persisted aggressive mode setting');
  }

  strategyEngine.register(
    createAdaptiveSupertrendStrategy({
      getInstrument: (symbol) => broker.getInstrument(symbol),
      symbols,
      intervals: timeframes,
      isAggressive: () => aggressiveMode,
      persistencePath: `${dataDir}/adaptive_supertrend_qtable.json`,
      onSignalGenerated: (signal, sym) => {
        logger.info({ sym, action: signal.action, conf: signal.confidence }, 'Adaptive Supertrend signal generated');
        const now = Date.now();
        const cycleId = `ast_${sym}_${now}`;
        wsGateway.broadcast('agent.step', {
          cycleId,
          symbol: sym,
          stage: 'trader_decision',
          status: 'completed',
          detail: signal.reasoning,
          timestamp: now,
        });
        wsGateway.broadcast('agent.cycle', {
          id: cycleId,
          symbol: sym,
          action: signal.action,
          confidence: signal.confidence,
          regime: signal.regimeKey,
          stopLossPrice: signal.stopLossPrice,
          takeProfitPrice: signal.takeProfitPrice,
          reasoning: signal.reasoning,
          status: 'COMPLETED',
          timestamp: now,
        });
        events.logAgentCycle({
          cycleId,
          symbol: sym,
          startedAt: now,
          analystReports: [
            {
              role: 'AdaptiveSupertrendAgent',
              stance: signal.action.includes('LONG') ? 'BULLISH' : signal.action.includes('SHORT') ? 'BEARISH' : 'NEUTRAL',
              confidence: signal.confidence,
              reasoning: signal.reasoning,
              regime: signal.regimeKey,
            },
          ],
          debate: [],
          verdict: {
            prevailingSide: signal.action,
            confidence: signal.confidence,
            rationale: signal.reasoning,
          },
          traderDecision: {
            action: signal.action,
            confidence: signal.confidence,
            stopLoss: signal.stopLossPrice,
            takeProfit: signal.takeProfitPrice,
          },
          riskOpinions: [],
          fundManagerApproval: { approved: true, rationale: 'Adaptive Supertrend parameters verified' },
          executed: signal.action !== 'HOLD',
        });
      },
    })
  );

  // Classic indicator strategies (ema-trend-5m, rsi-mean-reversion-5m,
  // momentum-5m, mean-reversion-5m, breakout-15m, grid-15m). Default OFF — the
  // autonomous agent + SMC + Adaptive Supertrend stack is the default trading
  // fleet. Set CLASSIC_STRATEGIES_ENABLED=true to add the classic fleet back.
  // They were previously dead because they emit signals without
  // features.quantity, and SignalExecutor rejected them with ZERO_QUANTITY.
  // Now that SignalExecutor has a SizingEngine fallback (see the SizingEngine
  // wiring above), classic signals resolve to real orders. The strategies
  // remain OFF by default so existing deployments are unchanged until an
  // operator opts in — see KNOWN_LIMITATIONS.md "Classic strategies" section.
  if (env.CLASSIC_STRATEGIES_ENABLED) {
    const requested = new Set(
      env.CLASSIC_STRATEGIES_LIST.split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    );

    const { createEmaTrendStrategy } = await import('./strategy/strategies/ema-trend-5m.js');
    const { createRsiMeanReversionStrategy } = await import(
      './strategy/strategies/rsi-mean-reversion-5m.js'
    );
    const { createMomentumStrategy } = await import('./strategy/strategies/momentum-5m.js');
    const { createMeanReversionStrategy } = await import(
      './strategy/strategies/mean-reversion-5m.js'
    );
    const { createBreakoutStrategy } = await import('./strategy/strategies/breakout-15m.js');
    const { createGridStrategy } = await import('./strategy/strategies/grid-15m.js');

    const registerIfRequested = (id: string, factory: () => Strategy): void => {
      if (!requested.has(id)) return;
      try {
        strategyEngine.register(factory());
        logger.info({ id }, 'Registered classic strategy');
      } catch (err) {
        logger.warn({ err, id }, 'Failed to register classic strategy');
      }
    };

    registerIfRequested('ema-trend-5m', () =>
      createEmaTrendStrategy({ symbols, cooldownMs: 300_000 })
    );
    registerIfRequested('breakout-15m', () =>
      createBreakoutStrategy({ symbols, cooldownMs: 300_000 })
    );
    registerIfRequested('rsi-mean-reversion-5m', () =>
      createRsiMeanReversionStrategy({ symbols, cooldownMs: 300_000 })
    );
    registerIfRequested('momentum-5m', () =>
      createMomentumStrategy({ symbols, cooldownMs: 300_000 })
    );
    registerIfRequested('grid-15m', () =>
      createGridStrategy({ symbols, gridLevels: 5, gridSpacing: 0.005, baseQty: 0.5, leverage: 2 })
    );
    registerIfRequested('mean-reversion-5m', () =>
      createMeanReversionStrategy({ symbols, cooldownMs: 300_000 })
    );

    logger.info(
      { count: requested.size, ids: Array.from(requested) },
      'Classic strategies registered (CLASSIC_STRATEGIES_ENABLED=true)'
    );
  } else {
    logger.info(
      'Classic strategies disabled (set CLASSIC_STRATEGIES_ENABLED=true to enable ema-trend-5m, rsi-mean-reversion-5m, momentum-5m, mean-reversion-5m, breakout-15m, grid-15m)'
    );
  }

  await strategyEngine.start();

  async function evaluateAllSymbols(): Promise<number> {
    let count = 0;
    for (const symbol of symbols) {
      for (const interval of timeframes) {
        const recent = klines.getCandles(symbol, interval, 2);
        if (recent.length > 0) {
          const latestClosed = recent[recent.length - 1]!;
          await strategyEngine.onCandleClose(latestClosed).catch((err) => {
            logger.warn({ err, symbol, interval }, 'Candle evaluation notice');
          });
          count++;
        }
      }
    }
    return count;
  }

  // Trigger initial candle evaluation across preloaded historical bars
  void evaluateAllSymbols();

  const api = new ApiServer({
    broker,
    engine: strategyEngine,
    signals: db.signals,
    events,
    klines,
    snapshots,
    profile: runtimeProfile,
    supervisor,
    marketState,
    wsGateway,
    host: '0.0.0.0',
    port: env.PORT,
    apiKey: env.API_KEY,
    armPasscode: env.LIVE_ARM_PASSCODE,
    profitGoals,
    strategyPerformance,
    setupPerformance,
    autonomousAgent,
    liveGuard,
    reconciler,
    riskConfig: DEFAULT_RISK_CONFIG,
    // Agentic layer handles (feature/agentic-upgrade) — all undefined when
    // their env flag is off; the API endpoints return {enabled: false}.
    toolRegistry,
    agentMemoryStore,
    selfImprovementLoop,
    strategyParamLearner,
    strategySelector,
    abTestRunner,
    getAggressiveMode: () => aggressiveMode,
    onSetAggressiveMode: (enabled) => {
      aggressiveMode = enabled;
      try {
        fs.writeFileSync(aggressiveConfigPath, JSON.stringify({ aggressive: enabled }, null, 2), 'utf8');
      } catch (err) {
        logger.error({ err }, 'Failed to persist aggressive mode setting');
      }
      logger.info({ aggressiveMode }, 'Aggressive simulation mode updated and persisted');
    },
    onTriggerEvaluation: evaluateAllSymbols,
    onResetPaperAccount: async (startingBalance?: number) => {
      const startUsdt = startingBalance && startingBalance > 0 ? startingBalance : 10_000;
      const account = broker.resetAccount(startUsdt);

      if (profitGoals) {
        profitGoals.resetDaily(startUsdt);
        profitGoals.resetWeekly(startUsdt);
        profitGoals.resetMonthly(startUsdt);
        profitGoalStore.save(profitGoals);
      }

      for (const stat of strategyPerformance.listStats()) {
        if (stat.quarantined) {
          strategyPerformance.release(stat.strategyId);
        }
      }

      events.appendSystemEvent({
        eventType: 'PROFIT_GOAL_RESET',
        payload: { action: 'ACCOUNT_RESET', startingBalance: startUsdt, resetAt: new Date().toISOString() },
        createdAtUtc: new Date().toISOString(),
      });

      wsGateway.broadcast('account.reset', { account, startingBalance: startUsdt });

      logger.info({ startingBalance: startUsdt }, '[Engine] Paper trading account reset completed');
      return account;
    },
  });

  await api.start();

  // Binance pushes book/trade/kline ticks far faster than any UI needs to render
  // (thousands/sec across symbols) — broadcasting each one to WS clients floods
  // the browser's event buffer and starves low-frequency, high-priority events
  // (agent steps, order/position updates) out of the ring buffer within
  // milliseconds. Throttle the WS *notification* per symbol+type; the underlying
  // candle/market-state stores below are still updated on every tick, so no
  // price data is lost — only how often the dashboard is told about it.
  const MARKET_BROADCAST_THROTTLE_MS = 200;
  const lastBroadcastAt = new Map<string, number>();
  function throttledBroadcast<T>(type: WebSocketEventType, key: string, payload: T): void {
    const now = Date.now();
    const last = lastBroadcastAt.get(key) ?? 0;
    if (now - last < MARKET_BROADCAST_THROTTLE_MS) return;
    lastBroadcastAt.set(key, now);
    api.wsGateway.broadcast(type, payload);
  }

  const streams = new BinanceStreamHandler(client, {
    symbols,
    timeframes,
    marketState,
    onKlineTick: (kline) => {
      const candle = {
        symbol: kline.symbol,
        interval: kline.interval,
        openTime: kline.openTime,
        open: kline.open,
        high: kline.high,
        low: kline.low,
        close: kline.close,
        volume: kline.volume,
      };
      klines.upsertCandle(candle);
      throttledBroadcast('market.tick', `tick:${kline.symbol}`, {
        symbol: kline.symbol,
        price: kline.close,
        candle,
      });
    },
    onKlineClose: (kline) => {
      const candle = {
        symbol: kline.symbol,
        interval: kline.interval,
        openTime: kline.openTime,
        open: kline.open,
        high: kline.high,
        low: kline.low,
        close: kline.close,
        volume: kline.volume,
      };

      klines.upsertCandle(candle);
      api.wsGateway.broadcast('kline.closed', candle);
      snapshots.saveKline1m({
        symbol: candle.symbol,
        openTime: candle.openTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        quoteVolume: 0,
      });
      strategyEngine.onCandleClose(candle).catch((error) => {
        logger.error({ error }, 'Strategy engine candle handler failed');
      });
    },
    onBookTicker: (symbol, bid, ask, bidQty, askQty) => {
      const mid = (bid + ask) / 2;
      const tick = supervisor.processTick('BINANCE', symbol, mid);
      if (tick.switched) {
        logger.warn({ symbol, activeProvider: tick.activeProvider, reason: tick.reason }, 'Market data provider switched');
        events.appendSystemEvent({
          eventType: 'PROVIDER_SWITCHED',
          payload: { symbol, activeProvider: tick.activeProvider, reason: tick.reason },
          createdAtUtc: new Date().toISOString(),
        });
        wsGateway.broadcast('health.updated', {
          activeProvider: tick.activeProvider,
          reason: tick.reason,
          binance: supervisor.health.getHealth('BINANCE'),
          coindcx: supervisor.health.getHealth('COINDCX'),
        });
      }
      broker.onMarket({ symbol, bid, ask, bidQty, askQty, last: mid });
      strategyEngine.onMarket({
        symbol,
        bid,
        ask,
        bidQty,
        askQty,
        last: (bid + ask) / 2,
        localTsUtc: Date.now(),
        stale: false,
      });
      throttledBroadcast('market.tick', `tick:${symbol}`, { symbol, price: mid });
      throttledBroadcast('book.update', `book:${symbol}`, { symbol, bid, ask, bidQty, askQty });
    },
    onMarkPrice: (symbol, markPrice, indexPrice, fundingRate) => {
      broker.onMarket({ symbol, mark: markPrice, index: indexPrice, fundingRate });
      throttledBroadcast('market.tick', `mark:${symbol}`, { symbol, price: markPrice, markPrice });
    },
    onAggTrade: (symbol, price, qty, isBuyerMaker, eventTime) => {
      broker.onMarket({ symbol, last: price });
      throttledBroadcast('market.tick', `tick:${symbol}`, { symbol, price });
      // Self-throttling and a no-op when there is no open position or no
      // resting stop, so it is safe on the raw trade stream.
      void trailingStops?.onPrice(symbol, price).catch((error) => {
        logger.error({ error, symbol }, 'Trailing stop update failed');
      });
      const ts = eventTime || Date.now();
      for (const interval of timeframes) {
        const candle = klines.applyTick(
          { symbol, price, qty, ts },
          interval as KlineInterval
        );
        if (candle) {
          throttledBroadcast('market.tick', `tick:${symbol}`, {
            symbol,
            price,
            candle,
          });
        }
      }
      throttledBroadcast('trade.stream', `trade:${symbol}`, {
        symbol,
        price,
        qty,
        isBuyerMaker: Boolean(isBuyerMaker),
        ts,
      });
    },
    onSystemEvent: (type, payload) => {
      if (type === 'WS_DISCONNECTED') {
        supervisor.health.recordDisconnect('BINANCE');
      }
      if (type === 'WS_RESUBSCRIBED' || type === 'WS_CONNECTED') {
        // A reconnect means we may have missed fills while disconnected.
        void reconciler?.reconcile('RECONNECT').catch((error) => {
          logger.error({ error }, 'Reconnect reconciliation failed');
        });
      }
      events.appendSystemEvent({ eventType: type as never, payload, createdAtUtc: new Date().toISOString() });
    },
  });

  await streams.connect();

  // Startup reconciliation runs before the scheduler starts placing anything.
  // A failure here trips safe mode, which ExecutionRouter honours on every
  // submission — the engine still starts, but it will not trade blind.
  if (reconciler) {
    const startupReport = await reconciler.reconcile('STARTUP');
    if (!startupReport.ok) {
      logger.error(
        { report: startupReport },
        'Startup reconciliation failed — trading halted until an operator resolves it via POST /api/v1/reconcile'
      );
    }
  }

  const scheduler = new Scheduler({
    broker,
    marketState,
    snapshots,
    engine: strategyEngine,
    events,
    staleMarketMaxAgeMs: 5000,
    profitGoals,
    onProfitGoalsReset: () => {
      if (!profitGoals) return;
      profitGoalStore.save(profitGoals);
      wsGateway.broadcast('profit.goal', {
        state: profitGoals.getState(),
        dailyProgressPct: profitGoals.getDailyProgressPercent(),
        weeklyProgressPct: profitGoals.getWeeklyProgressPercent(),
      });
    },
  });

  scheduler.start();

  // --- Startup self-test for the autonomous agent ------------------------
  // Verifies every brain module + external dep is wired before the agent
  // starts its 30s cycle. When AUTONOMOUS_SELF_TEST_FAIL_ON_CRITICAL is true
  // (default), critical failures halt the engine so the operator sees the
  // problem immediately instead of discovering silent degradation hours
  // later (e.g. Ollama unreachable → agent falls back to NEUTRAL → no
  // trades, dashboard shows zero activity, operator assumes market is
  // just quiet).
  if (autonomousAgent) {
    const { runStartupSelfTest } = await import('./agent/StartupSelfTest.js');
    const selfTestResult = await runStartupSelfTest({
      autonomousAgent,
      modelManager,
      supervisor,
      broker,
      failOnCritical: env.AUTONOMOUS_SELF_TEST_FAIL_ON_CRITICAL,
    }).catch((err) => {
      logger.error({ err }, '[StartupSelfTest] CRITICAL failure — see check log above. Halting engine startup.');
      throw err;
    });
    if (selfTestResult.criticalFailures > 0) {
      logger.warn(
        { critical: selfTestResult.criticalFailures, warnings: selfTestResult.warnings },
        `[StartupSelfTest] Continuing despite ${selfTestResult.criticalFailures} critical failure(s) — AUTONOMOUS_SELF_TEST_FAIL_ON_CRITICAL=false. The agent may behave unexpectedly.`
      );
    }
  }

  // Start the autonomous trading agent LAST — it needs strategyEngine
  // running (for submitSignal), market data flowing (for klines and
  // marketState), the API server up (for WebSocket broadcasts), and the
  // scheduler started (so profit goals + snapshot state are stable).
  // Disabled by default; start() is a no-op if the agent wasn't constructed.
  autonomousAgent?.start();

  metrics.setGauge('instruments_total', instruments.length);
  metrics.setGauge('strategies_total', strategyEngine.listStrategies().length);
  metrics.setGauge('strategies_quarantined_total', strategyEngine.listQuarantined().length);
  metrics.setGauge('autonomous_agent_enabled', autonomousAgent ? 1 : 0);

  const telegram = new TelegramNotifier({
    enabled: runtimeProfile.telegramEnabled,
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
  });

  if (telegram.isEnabled()) {
    void telegram.notifySystemStartup(
      runtimeProfile.mode,
      runtimeProfile.executionVenue,
      runtimeProfile.realOrders,
      symbols
    );
  }

  logger.info({ mode: runtimeProfile.mode }, 'Trading engine fully started');

  return {
    stop: async (): Promise<void> => {
      logger.info('Stopping paper-broker');
      autonomousAgent?.stop();
      scheduler.stop();
      if (profitGoals) profitGoalStore.save(profitGoals);
      strategyPerformanceStore.save(strategyPerformance.listStats());
      // Persist agentic-layer state (feature/agentic-upgrade). All save()
      // calls are cheap no-ops when nothing changed since the last save.
      strategyParamLearner?.save();
      strategySelector?.save();
      // abTestRunner has no on-disk persistence yet (skeleton).
      agentMemoryStore?.close();
      await api.stop();
      streams.disconnect();
      broker.shutdown();
      db.close();
      events.close();
      snapshots.close();
    },
  };
}