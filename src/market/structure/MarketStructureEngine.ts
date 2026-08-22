import type { KlineStore } from '../Klines.js';
import { CANONICAL_TIMEFRAMES, type AnalysisTimeframe } from '../MtfStateEngine.js';
import { StructureClassifier } from './StructureClassifier.js';
import { DEFAULT_SWING_CONFIG, SwingDetector } from './SwingDetector.js';
import type {
  MultiTimeframeStructureState,
  StructureScope,
  SwingConfig,
  TimeframeStructureState,
} from './types.js';

interface StructureCacheEntry {
  lastCandleTime?: number;
  candleCount: number;
  state: TimeframeStructureState;
}

export class MarketStructureEngine {
  private klineStore: KlineStore;
  private config: SwingConfig;
  private structureCache = new Map<string, StructureCacheEntry>();

  constructor(klineStore: KlineStore, config: SwingConfig = DEFAULT_SWING_CONFIG) {
    this.klineStore = klineStore;
    this.config = config;
  }

  getStructureAsOf(
    symbol: string,
    timeframe: AnalysisTimeframe,
    asOfTimestamp = Date.now(),
    scope: StructureScope = 'EXTERNAL',
    config = this.config
  ): TimeframeStructureState {
    const rawCandles = this.klineStore.getCandlesAsOf(symbol, timeframe, asOfTimestamp, 500);
    const closedCandles = rawCandles.filter((c) => (c.closeTime ?? c.openTime) <= asOfTimestamp);
    const last = closedCandles[closedCandles.length - 1];
    const cacheKey = `${symbol}:${timeframe}:${scope}`;
    const cached = this.structureCache.get(cacheKey);
    if (cached && cached.lastCandleTime === last?.openTime && cached.candleCount === closedCandles.length) {
      return cached.state;
    }

    const allSwings = SwingDetector.detectSwings(closedCandles, symbol, timeframe, config, scope);
    const confirmedSwings = allSwings.filter((s) => s.confirmationTime <= asOfTimestamp);

    const allEvents = StructureClassifier.detectBreaks(closedCandles, confirmedSwings, scope);
    const confirmedEvents = allEvents.filter((e) => e.confirmationTime <= asOfTimestamp);

    const { trend, structure } = StructureClassifier.evaluateTrendAndStructure(confirmedSwings, confirmedEvents);

    const highs = confirmedSwings.filter((s) => s.type === 'HIGH');
    const lows = confirmedSwings.filter((s) => s.type === 'LOW');
    const lastEvent = confirmedEvents[confirmedEvents.length - 1];

    const result: TimeframeStructureState = {
      timeframe,
      scope,
      trend,
      structure,
      swings: confirmedSwings,
      events: confirmedEvents,
      lastConfirmedSwingHigh: highs[highs.length - 1],
      lastConfirmedSwingLow: lows[lows.length - 1],
      previousConfirmedSwingHigh: highs[highs.length - 2],
      previousConfirmedSwingLow: lows[lows.length - 2],
      lastStructureEvent: lastEvent,
      lastStructureEventTime: lastEvent?.confirmationTime,
    };
    this.structureCache.set(cacheKey, { lastCandleTime: last?.openTime, candleCount: closedCandles.length, state: result });
    return result;
  }

  computeMultiTimeframeStructure(
    symbol: string,
    asOfTimestamp = Date.now(),
    scope: StructureScope = 'EXTERNAL',
    config = this.config
  ): MultiTimeframeStructureState {
    const timeframes: Partial<Record<AnalysisTimeframe, TimeframeStructureState>> = {};

    for (const tf of CANONICAL_TIMEFRAMES) {
      timeframes[tf] = this.getStructureAsOf(symbol, tf, asOfTimestamp, scope, config);
    }

    return {
      symbol,
      asOfTimestamp,
      timeframes: timeframes as Record<AnalysisTimeframe, TimeframeStructureState>,
    };
  }
}
