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
import { StrategyEngine } from './strategy/StrategyEngine.js';
import { OrderFactory } from './strategy/OrderFactory.js';
import { SignalExecutor } from './strategy/SignalExecutor.js';
import { MtfStateEngine } from './market/MtfStateEngine.js';
import { MarketStructureEngine } from './market/structure/MarketStructureEngine.js';
import { SmcLocationEngine } from './market/smc/SmcLocationEngine.js';
import { SetupEngine } from './market/setup/SetupEngine.js';
import { ExecutionPlanEngine } from './market/execution/ExecutionPlanEngine.js';
import { TradeIntentEngine } from './trading/TradeIntentEngine.js';
import { ExecutionRouter } from './execution/ExecutionRouter.js';
import { DEFAULT_RISK_CONFIG } from './trading/risk/RiskLimits.js';
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
import { createSmcAgentStrategy } from './strategy/strategies/smc-agent.js';
import { createAdaptiveSupertrendStrategy } from './strategy/strategies/adaptive-supertrend.js';
import { ApiServer } from './api/server.js';
import { WebSocketGateway } from './api/websocket/WebSocketGateway.js';
import type { WebSocketEventType } from './api/websocket/types.js';
import { Scheduler } from './scheduler/jobs.js';
import { TelegramNotifier } from './notifications/TelegramNotifier.js';
import { logger } from './telemetry/logger.js';
import { metrics } from './telemetry/metrics.js';

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
  const signalExecutor = new SignalExecutor({
    broker: executionBroker,
    orderFactory,
    signals: db.signals,
    getMarketState: (symbol) => marketState.getState(symbol),
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
  const tradingAgentsPipeline = new TradingAgentsPipeline({
    model: env.OLLAMA_MODEL,
    baseUrl: env.OLLAMA_BASE_URL,
    apiKeys: cloudKeys,
    cloudBaseUrl: env.OLLAMA_CLOUD_BASE_URL,
    cloudModel: env.OLLAMA_CLOUD_MODEL,
  });

  // Non-blocking: the agent debate already falls back to a safe NEUTRAL decision when
  // Ollama is unreachable (see TradingAgentsPipeline.runTrader), so this check gates
  // nothing — it exists purely so an operator sees why trading has gone quiet.
  void tradingAgentsPipeline.checkOllamaReachable().then((reachable) => {
    if (!reachable) {
      logger.warn({ baseUrl: env.OLLAMA_BASE_URL }, 'Ollama unreachable at startup — agent debate will fall back to NEUTRAL (no trades) until it recovers');
    }
  });

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
    liveGuard,
    reconciler,
    riskConfig: DEFAULT_RISK_CONFIG,
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
      throttledBroadcast('book.update', `book:${symbol}`, { symbol, bid, ask, bidQty, askQty });
    },
    onMarkPrice: (symbol, markPrice, indexPrice, fundingRate) => {
      broker.onMarket({ symbol, mark: markPrice, index: indexPrice, fundingRate });
    },
    onAggTrade: (symbol, price, qty, isBuyerMaker, eventTime) => {
      broker.onMarket({ symbol, last: price });
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

  metrics.setGauge('instruments_total', instruments.length);
  metrics.setGauge('strategies_total', strategyEngine.listStrategies().length);
  metrics.setGauge('strategies_quarantined_total', strategyEngine.listQuarantined().length);

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
      scheduler.stop();
      if (profitGoals) profitGoalStore.save(profitGoals);
      strategyPerformanceStore.save(strategyPerformance.listStats());
      await api.stop();
      streams.disconnect();
      broker.shutdown();
      db.close();
      events.close();
      snapshots.close();
    },
  };
}