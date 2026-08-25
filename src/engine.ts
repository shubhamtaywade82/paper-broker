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

  const broker = new PaperBroker({
    dataDir,
    accountId: 'paper-main',
    startingUsdt: env.PAPER_STARTING_USDT,
    instruments,
    marketState,
    eventLog: events,
    persister: new SQLiteBrokerPersister(db.raw),
  });
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

  const orderFactory = new OrderFactory({ defaultLeverage: 5 });
  const signalExecutor = new SignalExecutor({
    broker,
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
      submitOrder: (order) => broker.submitOrder(order),
    },
    {
      onSubmitSignal: async (signal) => {
        db.signals.insert(signal);
        metrics.inc('signals_received_total');
        return signalExecutor.execute(signal);
      },
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
  const tradeIntentEngine = new TradeIntentEngine();
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

  const wsGateway = new WebSocketGateway();

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
    marketState,
    wsGateway,
    host: '0.0.0.0',
    port: env.PORT,
    apiKey: env.API_KEY,
    armPasscode: env.LIVE_ARM_PASSCODE,
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
      broker.onMarket({ symbol, bid, ask, bidQty, askQty, last: (bid + ask) / 2 });
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
      events.appendSystemEvent({ eventType: type as never, payload, createdAtUtc: new Date().toISOString() });
    },
  });

  await streams.connect();

  const scheduler = new Scheduler({
    broker,
    marketState,
    snapshots,
    engine: strategyEngine,
    events,
    staleMarketMaxAgeMs: 5000,
  });

  scheduler.start();

  metrics.setGauge('instruments_total', instruments.length);
  metrics.setGauge('strategies_total', strategyEngine.listStrategies().length);

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
      await api.stop();
      streams.disconnect();
      broker.shutdown();
      db.close();
      events.close();
      snapshots.close();
    },
  };
}