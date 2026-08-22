import 'dotenv/config';
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
import { TradingAgentsPipeline } from './ai/tradingAgents.js';
import { createSmcAgentStrategy } from './strategy/strategies/smc-agent.js';
import { ApiServer } from './api/server.js';
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
  const events = new EventLog(env.EVENT_LOG_FILE);
  const snapshots = new SnapshotStore(env.SNAPSHOT_DIR);

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
  const tradingAgentsPipeline = new TradingAgentsPipeline({
    model: env.OLLAMA_MODEL,
    baseUrl: env.OLLAMA_BASE_URL,
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
    })
  );

  await strategyEngine.start();

  const api = new ApiServer({
    broker,
    engine: strategyEngine,
    signals: db.signals,
    events,
    klines,
    snapshots,
    profile: runtimeProfile,
    marketState,
    host: '0.0.0.0',
    port: env.PORT,
  });

  await api.start();

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
      api.wsGateway.broadcast('market.tick', {
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
      api.wsGateway.broadcast('book.update', { symbol, bid, ask, bidQty, askQty });
    },
    onAggTrade: (symbol, price, qty, isBuyerMaker, eventTime) => {
      const ts = eventTime || Date.now();
      for (const interval of timeframes) {
        const candle = klines.applyTick(
          { symbol, price, qty, ts },
          interval as KlineInterval
        );
        if (candle) {
          api.wsGateway.broadcast('market.tick', {
            symbol,
            price,
            candle,
          });
        }
      }
      api.wsGateway.broadcast('trade.stream', {
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