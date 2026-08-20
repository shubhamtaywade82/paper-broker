#!/usr/bin/env node
import { env, symbols } from './config/env.js';
import { defaultInstruments } from './config/instruments.js';
import { BinanceClient } from '@nemesis-oss/binance-sdk';
import { BinanceStreamHandler } from './binance/streams.js';
import { MarketStateManager } from './market/MarketState.js';
import { startEngine } from './engine.js';

const SYMBOLS = symbols;
const TIMEFRAMES = ['1m', '5m', '15m'];

async function runTrade(): Promise<void> {
  console.log('='.repeat(60));
  console.log('CRYPTO FUTURES PAPER TRADING ENGINE');
  console.log('='.repeat(60));
  console.log(`Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`Timeframes: ${TIMEFRAMES.join(', ')}`);
  console.log(`Starting USDT: ${env.PAPER_STARTING_USDT}`);
  console.log('='.repeat(60));

  const engine = await startEngine();

  console.log('[Main] Engine started. Press Ctrl+C to stop.');

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[Main] Received ${signal}, shutting down...`);
    await engine.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function runMonitor(): Promise<void> {
  console.log('[Monitor] Connecting to Binance Futures WebSocket...');

  const client = new BinanceClient({
    testnet: env.BINANCE_ENV === 'testnet',
    apiKey: env.BINANCE_API_KEY,
    apiSecret: env.BINANCE_API_SECRET,
  });

  const marketState = new MarketStateManager(defaultInstruments);

  const streams = new BinanceStreamHandler(client, {
    symbols: SYMBOLS,
    timeframes: TIMEFRAMES,
    marketState,
    onSystemEvent: (type, payload) => {
      console.log(`[System] ${type}:`, payload);
    },
  });

  await streams.connect();

  console.log('[Monitor] Connected. Press Ctrl+C to stop.');

  const stop = async (signal: string): Promise<void> => {
    console.log(`\n[Monitor] Received ${signal}, shutting down...`);
    streams.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

async function runBacktest(): Promise<void> {
  console.log('Backtest mode - not yet implemented');
  console.log('Use the PaperBroker directly for backtesting with historical data');
}

const command = process.argv[2] ?? 'trade';

switch (command) {
  case 'trade':
    await runTrade();
    break;
  case 'monitor':
    await runMonitor();
    break;
  case 'backtest':
    await runBacktest();
    break;
  default:
    console.log('Usage: node dist/cli.js <trade|monitor|backtest>');
    process.exit(1);
}