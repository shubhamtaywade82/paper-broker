import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BacktestRunner } from '../../src/backtest/BacktestRunner.js';
import type { Candle } from '../../src/strategy/indicators.js';

/**
 * Regression: getCandles() used to be `series.slice(-limit)` on a cache that
 * loadKlines() fills with the ENTIRE dataset before the replay starts, so a
 * strategy asking for candles at replay minute 5 received the last bars of the
 * backtest. Every indicator computed during a backtest was reading the future.
 */
describe('BacktestRunner look-ahead', () => {
  const dirs: string[] = [];

  function createRunner(): BacktestRunner {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backtest-lookahead-'));
    dirs.push(dataDir);
    return new BacktestRunner({
      dataDir,
      accountId: 'lookahead-test',
      startingUsdt: 10_000,
      symbols: ['BTCUSDT'],
      startTime: 0,
      endTime: 60_000 * 100,
      strategies: [],
    });
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function make1mSeries(count: number): Candle[] {
    return Array.from({ length: count }, (_, i) => ({
      symbol: 'BTCUSDT',
      interval: '1m',
      openTime: i * 60_000,
      open: 100 + i,
      high: 100 + i,
      low: 100 + i,
      close: 100 + i,
      volume: 1,
    }));
  }

  it('never returns a candle that closes after the current replay timestamp', () => {
    const runner = createRunner();
    const internals = runner as unknown as {
      candleCache: Map<string, Candle[]>;
      replayTs: number;
      getCandles: (symbol: string, interval: string, limit: number) => Candle[];
    };
    internals.candleCache.set('BTCUSDT:1m', make1mSeries(200));

    // Replay sitting at minute 10: minutes 0..9 have closed, minute 10 has not.
    internals.replayTs = 10 * 60_000;
    const visible = internals.getCandles('BTCUSDT', '1m', 50);

    expect(visible).toHaveLength(10);
    expect(visible.at(-1)!.openTime).toBe(9 * 60_000);
    expect(visible.at(-1)!.close).toBe(109);
    for (const candle of visible) {
      expect(candle.openTime + 60_000).toBeLessThanOrEqual(internals.replayTs);
    }

    runner.close();
  });

  it('honours the requested limit against the visible window', () => {
    const runner = createRunner();
    const internals = runner as unknown as {
      candleCache: Map<string, Candle[]>;
      replayTs: number;
      getCandles: (symbol: string, interval: string, limit: number) => Candle[];
    };
    internals.candleCache.set('BTCUSDT:1m', make1mSeries(200));
    internals.replayTs = 100 * 60_000;

    const visible = internals.getCandles('BTCUSDT', '1m', 20);

    expect(visible).toHaveLength(20);
    expect(visible[0]!.openTime).toBe(80 * 60_000);
    expect(visible.at(-1)!.openTime).toBe(99 * 60_000);

    runner.close();
  });

  it('returns nothing before the first candle has closed', () => {
    const runner = createRunner();
    const internals = runner as unknown as {
      candleCache: Map<string, Candle[]>;
      replayTs: number;
      getCandles: (symbol: string, interval: string, limit: number) => Candle[];
    };
    internals.candleCache.set('BTCUSDT:1m', make1mSeries(200));
    internals.replayTs = 0;

    expect(internals.getCandles('BTCUSDT', '1m', 50)).toEqual([]);

    runner.close();
  });
});
