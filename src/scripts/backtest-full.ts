#!/usr/bin/env node
/**
 * Backtest Runner for Multiple Strategies
 * 
 * This script runs comprehensive backtests on SOLUSDT, ETHUSDT, and XRPUSDT
 * using multiple strategies across different timeframes (1m, 5m, 15m).
 * 
 * Usage:
 *   npm run backtest:full -- --start=2022-01-01 --end=2024-12-31
 *   npm run backtest:full -- --strategies=ema-trend,breakout,rsi-mr
 */

import { resolve } from 'path';
import { env } from '../config/env.js';
import { defaultInstruments } from '../config/instruments.js';
import { BinanceClient } from '@nemesis-oss/binance-sdk';
import { DatabaseManager } from '../persistence/db.js';
import { runBacktest, type BacktestConfig } from '../backtest/BacktestRunner.js';

interface BacktestSummary {
  strategy: string;
  symbol: string;
  timeframe: string;
  totalReturnPct: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
}

const SYMBOLS = ['SOLUSDT', 'ETHUSDT', 'XRPUSDT'];
const TIMEFRAMES = ['1m', '5m', '15m'];
const STRATEGIES = ['ema-trend', 'breakout', 'rsi-mr', 'momentum', 'grid', 'mean-reversion'];

async function downloadHistoricalData(
  client: BinanceClient,
  symbol: string,
  startTime: number,
  endTime: number,
  db: DatabaseManager
): Promise<void> {
  console.log(`[Data] Downloading ${symbol} data from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);

  const intervals = ['1m', '5m', '15m'];
  
  for (const interval of intervals) {
    let currentStart = startTime;
    let totalKlines = 0;

    while (currentStart < endTime) {
      try {
        const klines = await client.futures.klines({
          symbol,
          interval,
          startTime: currentStart,
          endTime: Math.min(currentStart + 1000 * 60 * 60 * 24 * 7, endTime), // 7 days at a time
          limit: 1000,
        });

        if (klines.length === 0) break;

        const insertStmt = db.raw.prepare(`
          INSERT OR REPLACE INTO klines_1m (symbol, open_time_utc, open, high, low, close, volume)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        for (const kline of klines) {
          const openTime = new Date(kline.startTime).toISOString();
          insertStmt.run(
            symbol,
            openTime,
            String(kline.open),
            String(kline.high),
            String(kline.low),
            String(kline.close),
            String(kline.volume)
          );
          totalKlines++;
        }

        currentStart = klines[klines.length - 1].endTime + 1;
        
        if (totalKlines % 5000 === 0) {
          console.log(`[Data] ${symbol} ${interval}: Downloaded ${totalKlines} klines...`);
        }
      } catch (error) {
        console.error(`[Data] Error downloading ${symbol} ${interval}:`, error);
        break;
      }
    }

    console.log(`[Data] ${symbol} ${interval}: Total ${totalKlines} klines downloaded`);
  }
}

async function runSingleBacktest(
  symbol: string,
  strategy: string,
  startTime: number,
  endTime: number,
  dataDir: string
): Promise<BacktestSummary | null> {
  try {
    const config: BacktestConfig = {
      dataDir,
      accountId: `paper-${strategy}-${symbol}`,
      startingUsdt: 10000,
      symbols: [symbol],
      startTime,
      endTime,
      strategies: [strategy],
      takerFeeRate: 0.0004,
      makerFeeRate: 0.0002,
      marketSlippageBps: 2,
    };

    const result = await runBacktest(config);

    return {
      strategy,
      symbol,
      timeframe: 'multi',
      totalReturnPct: result.totalReturnPct,
      sharpeRatio: result.sharpeRatio,
      maxDrawdownPct: result.maxDrawdownPct,
      winRate: result.winRate,
      profitFactor: result.profitFactor,
      totalTrades: result.totalTrades,
    };
  } catch (error) {
    console.error(`[Backtest] Error running ${strategy} on ${symbol}:`, error);
    return null;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(3);
  const startStr = args.find(a => a.startsWith('--start='))?.split('=')[1];
  const endStr = args.find(a => a.startsWith('--end='))?.split('=')[1];
  const stratStr = args.find(a => a.startsWith('--strategies='))?.split('=')[1];
  const symbolArg = args.find(a => a.startsWith('--symbol='))?.split('=')[1];

  // Default to 2 years of data if not specified
  const startTime = startStr ? new Date(startStr).getTime() : Date.now() - 2 * 365 * 24 * 60 * 60 * 1000;
  const endTime = endStr ? new Date(endStr).getTime() : Date.now();
  const strategies = stratStr ? stratStr.split(',') : STRATEGIES;
  const targetSymbols = symbolArg ? [symbolArg] : SYMBOLS;

  console.log('='.repeat(80));
  console.log('COMPREHENSIVE BACKTEST ANALYSIS');
  console.log('='.repeat(80));
  console.log(`Period: ${new Date(startTime).toISOString()} → ${new Date(endTime).toISOString()}`);
  console.log(`Duration: ${((endTime - startTime) / (1000 * 60 * 60 * 24)).toFixed(0)} days`);
  console.log(`Symbols: ${targetSymbols.join(', ')}`);
  console.log(`Strategies: ${strategies.join(', ')}`);
  console.log('='.repeat(80));

  const dataDir = './data/backtest';
  const db = new DatabaseManager(dataDir);

  try {
    // Initialize database tables
    db.raw.exec(`
      CREATE TABLE IF NOT EXISTS klines_1m (
        symbol TEXT NOT NULL,
        open_time_utc TEXT NOT NULL,
        open TEXT NOT NULL,
        high TEXT NOT NULL,
        low TEXT NOT NULL,
        close TEXT NOT NULL,
        volume TEXT NOT NULL,
        PRIMARY KEY (symbol, open_time_utc)
      )
    `);

    // Download historical data from Binance
    console.log('\n[Phase 1] Downloading historical data from Binance Futures...');
    const client = new BinanceClient({
      testnet: false,
      apiKey: env.BINANCE_API_KEY || '',
      apiSecret: env.BINANCE_API_SECRET || '',
    });

    for (const symbol of targetSymbols) {
      await downloadHistoricalData(client, symbol, startTime, endTime, db);
    }

    // Run backtests for each strategy and symbol combination
    console.log('\n[Phase 2] Running backtests...');
    const results: BacktestSummary[] = [];

    for (const strategy of strategies) {
      console.log(`\n--- Strategy: ${strategy} ---`);
      
      for (const symbol of targetSymbols) {
        console.log(`Running ${strategy} on ${symbol}...`);
        const result = await runSingleBacktest(symbol, strategy, startTime, endTime, dataDir);
        if (result) {
          results.push(result);
          console.log(`  Return: ${result.totalReturnPct.toFixed(2)}%, Sharpe: ${result.sharpeRatio.toFixed(2)}, MaxDD: ${result.maxDrawdownPct.toFixed(2)}%, Trades: ${result.totalTrades}`);
        }
      }
    }

    // Display summary table
    console.log('\n' + '='.repeat(80));
    console.log('BACKTEST RESULTS SUMMARY');
    console.log('='.repeat(80));
    console.log(
      'Strategy'.padEnd(20),
      'Symbol'.padEnd(12),
      'Return %'.padEnd(12),
      'Sharpe'.padEnd(10),
      'MaxDD %'.padEnd(10),
      'Win Rate'.padEnd(10),
      'Profit F'.padEnd(10),
      'Trades'.padEnd(8)
    );
    console.log('-'.repeat(80));

    // Sort by return percentage
    results.sort((a, b) => b.totalReturnPct - a.totalReturnPct);

    for (const r of results) {
      console.log(
        r.strategy.padEnd(20),
        r.symbol.padEnd(12),
        r.totalReturnPct.toFixed(2).padEnd(12),
        r.sharpeRatio.toFixed(2).padEnd(10),
        r.maxDrawdownPct.toFixed(2).padEnd(10),
        (r.winRate * 100).toFixed(1).padEnd(10),
        r.profitFactor.toFixed(2).padEnd(10),
        String(r.totalTrades).padEnd(8)
      );
    }

    console.log('='.repeat(80));

    // Identify best performing strategies
    console.log('\nTOP PERFORMING STRATEGIES (by Return %)');
    console.log('-'.repeat(80));
    const top3 = results.slice(0, 3);
    top3.forEach((r, i) => {
      console.log(`${i + 1}. ${r.strategy} on ${r.symbol}: ${r.totalReturnPct.toFixed(2)}% return, Sharpe ${r.sharpeRatio.toFixed(2)}`);
    });

    // Identify most consistent strategies (by Sharpe Ratio)
    console.log('\nMOST CONSISTENT STRATEGIES (by Sharpe Ratio)');
    console.log('-'.repeat(80));
    const bySharpe = [...results].sort((a, b) => b.sharpeRatio - a.sharpeRatio).slice(0, 3);
    bySharpe.forEach((r, i) => {
      console.log(`${i + 1}. ${r.strategy} on ${r.symbol}: Sharpe ${r.sharpeRatio.toFixed(2)}, Return ${r.totalReturnPct.toFixed(2)}%`);
    });

    // Identify lowest drawdown strategies
    console.log('\nLOWEST DRAWDOWN STRATEGIES');
    console.log('-'.repeat(80));
    const byDrawdown = [...results].sort((a, b) => a.maxDrawdownPct - b.maxDrawdownPct).slice(0, 3);
    byDrawdown.forEach((r, i) => {
      console.log(`${i + 1}. ${r.strategy} on ${r.symbol}: MaxDD ${r.maxDrawdownPct.toFixed(2)}%, Return ${r.totalReturnPct.toFixed(2)}%`);
    });

    // Recommendations for paper trading automation
    console.log('\n' + '='.repeat(80));
    console.log('RECOMMENDATIONS FOR PAPER TRADING AUTOMATION');
    console.log('='.repeat(80));

    const qualifiedStrategies = results.filter(r => 
      r.totalReturnPct > 10 && 
      r.sharpeRatio > 0.5 && 
      r.maxDrawdownPct < 30 &&
      r.totalTrades > 10
    );

    if (qualifiedStrategies.length > 0) {
      console.log('\nStrategies meeting minimum criteria (>10% return, Sharpe >0.5, MaxDD <30%, >10 trades):');
      qualifiedStrategies.forEach(r => {
        console.log(`  ✓ ${r.strategy} on ${r.symbol}`);
      });

      console.log('\nSuggested automation approach:');
      console.log('1. Start with the top 2-3 strategies per symbol');
      console.log('2. Use position sizing to limit risk per trade to 0.5-1%');
      console.log('3. Monitor live performance vs backtest for 2-4 weeks');
      console.log('4. Adjust parameters if live deviates significantly from backtest');
    } else {
      console.log('\nNo strategies met all minimum criteria. Consider:');
      console.log('1. Extending the backtest period');
      console.log('2. Adjusting strategy parameters');
      console.log('3. Combining multiple strategies for diversification');
    }

  } catch (error) {
    console.error('[Error]', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

main().catch(console.error);
