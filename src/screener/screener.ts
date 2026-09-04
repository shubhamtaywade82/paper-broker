import type { BinanceClient } from '@nemesis-oss/binance-sdk';
import type { Candle } from '../strategy/indicators.js';
import { fetchDailyCandles } from './candles.js';
import { resolveUniverse } from './universe.js';
import { computePerformance, classifyHorizons, performanceScore, type PerformanceMetrics, type TradeHorizon } from './performance.js';

/** Below this, a position cannot be entered or exited without moving the
 * price. $1M of average daily notional is a modest floor for a futures pair. */
export const MIN_AVG_TRADED_VALUE = 1_000_000;

const HISTORY_DAYS = 400; // ~250 trading-relevant days plus buffer
const BENCHMARK_SYMBOL = 'BTCUSDT';

export interface ScreenerCandidate {
  symbol: string;
  passed: boolean;
  score: number;
  horizons: TradeHorizon[];
  metrics: PerformanceMetrics;
}

export interface ScreenerResult {
  totalScreened: number;
  totalPassed: number;
  skippedNoHistory: string[];
  skippedFetchFailed: string[];
  candidates: ScreenerCandidate[];
  topPicks: string[];
  screenedAt: number;
}

/** Fetches once, retries once on failure, then gives up — distinguishing a
 * transient fetch problem from a symbol that genuinely has too little
 * history. See the plan's "Deviation from the spec" note for why this
 * distinction needs its own dedicated fetch (candles.ts) rather than reusing
 * KlineStore.fetchHistoricalKlines, which cannot make it. */
async function fetchWithRetry(symbol: string): Promise<Candle[] | 'FETCH_FAILED'> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetchDailyCandles(symbol, HISTORY_DAYS);
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
    }
  }
  return 'FETCH_FAILED';
}

export async function screen(
  client: BinanceClient,
  onProgress: (message: string) => void = () => {},
): Promise<ScreenerResult> {
  const universe = await resolveUniverse(client);
  onProgress(`Resolved ${universe.length} USDT-M perpetuals from the live universe`);

  const benchmarkResult = await fetchWithRetry(BENCHMARK_SYMBOL);
  if (benchmarkResult === 'FETCH_FAILED') {
    throw new Error(`Screener aborted: benchmark (${BENCHMARK_SYMBOL}) candles could not be fetched after retry — every candidate's relative strength depends on this.`);
  }
  const benchmark = benchmarkResult;
  onProgress(`Benchmark loaded: ${benchmark.length} BTCUSDT sessions for relative strength`);

  const candidates: ScreenerCandidate[] = [];
  const skippedNoHistory: string[] = [];
  const skippedFetchFailed: string[] = [];
  let done = 0;

  for (const symbol of universe) {
    const candles = await fetchWithRetry(symbol);
    done++;

    if (candles === 'FETCH_FAILED') {
      skippedFetchFailed.push(symbol);
    } else {
      const metrics = computePerformance(candles, benchmark);
      if (!metrics) {
        skippedNoHistory.push(symbol);
      } else {
        const horizons = classifyHorizons(metrics);
        const liquid = metrics.avgTradedValue >= MIN_AVG_TRADED_VALUE;
        candidates.push({
          symbol,
          passed: liquid && horizons.length > 0,
          score: performanceScore(metrics, horizons),
          horizons,
          metrics,
        });
      }
    }

    if (done % 25 === 0 || done === universe.length) {
      onProgress(`Evaluated ${done}/${universe.length} (${skippedNoHistory.length + skippedFetchFailed.length} skipped)`);
    }
  }

  if (skippedFetchFailed.length > 0) {
    onProgress(`WARNING: ${skippedFetchFailed.length} symbol(s) could not be fetched after retry — `
      + `${skippedFetchFailed.slice(0, 8).join(', ')}${skippedFetchFailed.length > 8 ? '…' : ''}. `
      + 'Excluded, not failed; a re-run may include them.');
  }

  candidates.sort((a, b) => (a.passed !== b.passed ? (a.passed ? -1 : 1) : b.score - a.score));
  const passedList = candidates.filter((c) => c.passed);

  return {
    totalScreened: candidates.length,
    totalPassed: passedList.length,
    skippedNoHistory,
    skippedFetchFailed,
    candidates,
    topPicks: passedList.slice(0, 5).map((c) => c.symbol),
    screenedAt: Date.now(),
  };
}
