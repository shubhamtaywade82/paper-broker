#!/usr/bin/env node
import { env, symbols } from './config/env.js';
import { defaultInstruments } from './config/instruments.js';
import { BinanceClient } from '@nemesis-oss/binance-sdk';
import { BinanceStreamHandler } from './binance/streams.js';
import { MarketStateManager } from './market/MarketState.js';
import { startEngine } from './engine.js';
import { runBacktest, type BacktestConfig } from './backtest/BacktestRunner.js';

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

async function runBacktestCmd(): Promise<void> {
  const args = process.argv.slice(3);
  const startStr = args.find(a => a.startsWith('--start='))?.split('=')[1];
  const endStr = args.find(a => a.startsWith('--end='))?.split('=')[1];
  const stratStr = args.find(a => a.startsWith('--strategies='))?.split('=')[1];

  const startTime = startStr ? new Date(startStr).getTime() : Date.now() - 7 * 24 * 60 * 60 * 1000;
  const endTime = endStr ? new Date(endStr).getTime() : Date.now();
  const strategies = stratStr ? stratStr.split(',') : ['all'];

  console.log('='.repeat(60));
  console.log('BACKTEST MODE');
  console.log('='.repeat(60));
  console.log(`Start: ${new Date(startTime).toISOString()}`);
  console.log(`End:   ${new Date(endTime).toISOString()}`);
  console.log(`Strategies: ${strategies.join(', ')}`);
  console.log(`Symbols: ${SYMBOLS.join(', ')}`);
  console.log('='.repeat(60));

  const config: BacktestConfig = {
    dataDir: './data',
    accountId: 'paper-main',
    startingUsdt: env.PAPER_STARTING_USDT,
    symbols: SYMBOLS,
    startTime,
    endTime,
    strategies,
  };

  const result = await runBacktest(config);

  console.log('\n' + '='.repeat(60));
  console.log('BACKTEST RESULTS');
  console.log('='.repeat(60));
  console.log(`Period: ${new Date(result.startTime).toISOString()} → ${new Date(result.endTime).toISOString()}`);
  console.log(`Initial Equity: ${result.initialEquity.toFixed(4)} USDT`);
  console.log(`Final Equity:   ${result.finalEquity.toFixed(4)} USDT`);
  console.log(`Total Return:   ${result.totalReturn.toFixed(4)} USDT (${result.totalReturnPct.toFixed(2)}%)`);
  console.log(`Total Trades:   ${result.totalTrades}`);
  console.log(`Total Fees:     ${result.totalFees.toFixed(4)} USDT`);
  console.log(`Total Realized: ${result.totalRealizedPnl.toFixed(4)} USDT`);
  console.log(`Max Drawdown:   ${result.maxDrawdown.toFixed(4)} USDT (${result.maxDrawdownPct.toFixed(2)}%)`);
  console.log(`Sharpe Ratio:   ${result.sharpeRatio.toFixed(2)}`);
  console.log(`Win Rate:       ${(result.winRate * 100).toFixed(1)}%`);
  console.log(`Profit Factor:  ${result.profitFactor.toFixed(2)}`);
  console.log(`Avg Win:        ${result.avgWin.toFixed(4)} USDT`);
  console.log(`Avg Loss:       ${result.avgLoss.toFixed(4)} USDT`);
  console.log('\nBy Strategy:');
  for (const [strat, stats] of Object.entries(result.byStrategy)) {
    console.log(`  ${strat}: trades=${stats.trades}, pnl=${stats.pnl.toFixed(4)}, winRate=${(stats.winRate * 100).toFixed(1)}%`);
  }
  console.log('='.repeat(60));

  process.exit(0);
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
    await runBacktestCmd();
    break;
  default:
    console.log('Usage: node dist/cli.js <trade|monitor|backtest>');
    console.log('  backtest options: --start=YYYY-MM-DD --end=YYYY-MM-DD --strategies=all|ema-trend,breakout,...');
    process.exit(1);
}