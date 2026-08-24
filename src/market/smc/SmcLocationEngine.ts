import type { KlineStore } from '../Klines.js';
import { CANONICAL_TIMEFRAMES, type AnalysisTimeframe } from '../MtfStateEngine.js';
import type { MarketStructureEngine } from '../structure/MarketStructureEngine.js';
import { FvgDetector } from './FvgDetector.js';
import { DEFAULT_SMC_CONFIG, LiquidityDetector } from './LiquidityDetector.js';
import { OrderBlockDetector } from './OrderBlockDetector.js';
import type {
  MultiTimeframeSmcContext,
  SmcConfig,
  SmcTimeframeContext,
} from './types.js';

// C-05: getSmcContextAsOf is called on every candle close with a fresh
// Date.now() as asOfTimestamp, which is part of the cache key (correctness
// requires this — see the "no lookahead" regression this cap avoids, below).
// Without a bound, a 24/7 multi-symbol/multi-timeframe live process grows this
// map forever. Cap it with simple FIFO eviction (oldest-inserted-first, which
// Map iteration order gives for free) rather than collapsing asOfTimestamp out
// of the key entirely: a candle-count/lastCandleTime-only key (as
// MarketStructureEngine's cache uses) looked equivalent at first, but breaks
// zero-lookahead — two different asOfTimestamps that fall within the same
// still-forming last candle can have different confirmedAt-filtered results
// even though the candle set is identical, and collapsing them onto one cache
// entry lets an earlier (pre-confirmation) query's cached miss leak into a
// later query, or vice versa.
const SMC_CACHE_MAX_ENTRIES = 2000;

export class SmcLocationEngine {
  private klineStore: KlineStore;
  private structureEngine: MarketStructureEngine;
  private config: SmcConfig;
  private smcCache = new Map<string, SmcTimeframeContext>();

  constructor(
    klineStore: KlineStore,
    structureEngine: MarketStructureEngine,
    config: SmcConfig = DEFAULT_SMC_CONFIG
  ) {
    this.klineStore = klineStore;
    this.structureEngine = structureEngine;
    this.config = config;
  }

  /** Current cache size — exposed for the C-05 bounded-growth regression test. */
  get cacheSize(): number {
    return this.smcCache.size;
  }

  getSmcContextAsOf(
    symbol: string,
    timeframe: AnalysisTimeframe,
    asOfTimestamp = Date.now(),
    config = this.config
  ): SmcTimeframeContext {
    const rawCandles = this.klineStore.getCandlesAsOf(symbol, timeframe, asOfTimestamp, 500);
    const closedCandles = rawCandles.filter((c) => c.isClosed || (c.closeTime ?? c.openTime) <= asOfTimestamp);
    const last = closedCandles[closedCandles.length - 1];
    const cacheKey = `${symbol}:${timeframe}:${asOfTimestamp}:${last?.openTime ?? 0}:${closedCandles.length}`;
    const cached = this.smcCache.get(cacheKey);
    if (cached) return cached;

    const structure = this.structureEngine.getStructureAsOf(symbol, timeframe, asOfTimestamp);
    const rawLevels = LiquidityDetector.extractLiquidityLevels(structure.swings, config);
    const confirmedLevels = rawLevels.filter((l) => l.confirmedAt <= asOfTimestamp);

    const { sweeps, updatedLevels } = LiquidityDetector.detectSweeps(closedCandles, confirmedLevels);
    const confirmedSweeps = sweeps.filter((s) => s.confirmationTime <= asOfTimestamp);

    const allFvgs = FvgDetector.detectFvgs(closedCandles, symbol, timeframe, config);
    const confirmedFvgs = allFvgs.filter((f) => f.confirmedAt <= asOfTimestamp);

    const allObs = OrderBlockDetector.detectOrderBlocks(closedCandles, structure.events, config);
    const confirmedObs = allObs.filter((o) => o.confirmedAt <= asOfTimestamp);

    const result: SmcTimeframeContext = {
      timeframe,
      liquidityLevels: updatedLevels,
      sweeps: confirmedSweeps,
      fairValueGaps: confirmedFvgs,
      orderBlocks: confirmedObs,
      activeLiquidity: updatedLevels.filter((l) => l.status === 'ACTIVE'),
      activeFvgs: confirmedFvgs.filter((f) => f.status === 'ACTIVE' || f.status === 'PARTIALLY_FILLED'),
      activeOrderBlocks: confirmedObs.filter((o) => o.status === 'ACTIVE'),
    };
    if (this.smcCache.size >= SMC_CACHE_MAX_ENTRIES) {
      const oldestKey = this.smcCache.keys().next().value;
      if (oldestKey !== undefined) this.smcCache.delete(oldestKey);
    }
    this.smcCache.set(cacheKey, result);
    return result;
  }

  computeMultiTimeframeSmcContext(
    symbol: string,
    asOfTimestamp = Date.now(),
    config = this.config
  ): MultiTimeframeSmcContext {
    const timeframes: Partial<Record<AnalysisTimeframe, SmcTimeframeContext>> = {};

    for (const tf of CANONICAL_TIMEFRAMES) {
      timeframes[tf] = this.getSmcContextAsOf(symbol, tf, asOfTimestamp, config);
    }

    return {
      symbol,
      asOfTimestamp,
      timeframes: timeframes as Record<AnalysisTimeframe, SmcTimeframeContext>,
    };
  }
}
