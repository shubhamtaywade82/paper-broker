#!/usr/bin/env node
/**
 * Download Historical Klines from Binance Futures
 * 
 * Usage:
 *   npm run download:klines -- --symbol=SOLUSDT --start=2022-01-01 --end=2024-12-31
 */

import { env } from '../config/env.js';
import { BinanceClient } from '@nemesis-oss/binance-sdk';
import { DatabaseManager } from '../persistence/db.js';

async function downloadKlines(
  client: BinanceClient,
  symbol: string,
  startTime: number,
  endTime: number,
  db: DatabaseManager
): Promise<number> {
  console.log(`[Data] Downloading ${symbol} from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);

  let totalInserted = 0;
  const insertStmt = db.raw.prepare(`
    INSERT OR REPLACE INTO klines_1m (symbol, open_time_utc, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // Download 1m data in chunks
  let currentStart = startTime;
  
  while (currentStart < endTime) {
    const chunkEnd = Math.min(currentStart + 7 * 24 * 60 * 60 * 1000, endTime); // 7 days max per request
    
    try {
      const klines = await client.futures.klines({
        symbol,
        interval: '1m',
        startTime: currentStart,
        endTime: chunkEnd,
        limit: 1000,
      });

      if (klines.length === 0) {
        currentStart = chunkEnd;
        continue;
      }

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
        totalInserted++;
      }

      currentStart = klines[klines.length - 1].endTime + 1;
      
      if (totalInserted % 10000 === 0) {
        console.log(`[Data] ${symbol}: ${totalInserted} klines downloaded...`);
      }
    } catch (error: any) {
      console.error(`[Data] Error downloading ${symbol}:`, error.message);
      if (error.code === 429 || error.response?.status === 429) {
        console.log('[Data] Rate limited, waiting 5 seconds...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        break;
      }
    }
  }

  return totalInserted;
}

async function main(): Promise<void> {
  const args = process.argv.slice(3);
  const symbolArg = args.find(a => a.startsWith('--symbol='))?.split('=')[1];
  const startStr = args.find(a => a.startsWith('--start='))?.split('=')[1];
  const endStr = args.find(a => a.startsWith('--end='))?.split('=')[1];

  const symbols = symbolArg ? [symbolArg] : ['SOLUSDT', 'ETHUSDT', 'XRPUSDT'];
  const startTime = startStr ? new Date(startStr).getTime() : Date.now() - 30 * 24 * 60 * 60 * 1000;
  const endTime = endStr ? new Date(endStr).getTime() : Date.now();

  console.log('='.repeat(60));
  console.log('BINANCE FUTURES HISTORICAL DATA DOWNLOADER');
  console.log('='.repeat(60));
  console.log(`Symbols: ${symbols.join(', ')}`);
  console.log(`Period: ${new Date(startTime).toISOString()} → ${new Date(endTime).toISOString()}`);
  console.log('='.repeat(60));

  const dataDir = './data/backtest';
  const db = new DatabaseManager(dataDir);

  // Create klines table
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

  const client = new BinanceClient({
    testnet: false,
    apiKey: env.BINANCE_API_KEY || '',
    apiSecret: env.BINANCE_API_SECRET || '',
  });

  let grandTotal = 0;
  for (const symbol of symbols) {
    const count = await downloadKlines(client, symbol, startTime, endTime, db);
    console.log(`[Data] ${symbol}: Total ${count} klines saved`);
    grandTotal += count;
  }

  console.log('\n' + '='.repeat(60));
  console.log(`GRAND TOTAL: ${grandTotal} klines downloaded`);
  console.log('='.repeat(60));

  db.close();
  process.exit(0);
}

main().catch(console.error);
