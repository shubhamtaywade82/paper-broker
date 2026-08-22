import type { Candle } from '../strategy/indicators.js';
import { floorToInterval, type KlineInterval, type KlineStore } from './Klines.js';
import type { DataHealthState, MarketStateManager } from './MarketState.js';

export type AnalysisTimeframe = '4h' | '1h' | '15m' | '5m';

export const CANONICAL_TIMEFRAMES: readonly AnalysisTimeframe[] = ['4h', '1h', '15m', '5m'] as const;

export const TIMEFRAME_MS: Record<AnalysisTimeframe, number> = {
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
};

export const MIN_CLOSED_CANDLES: Record<AnalysisTimeframe, number> = {
  '4h': 20,
  '1h': 30,
  '15m': 50,
  '5m': 50,
};

export type TimeframeSyncStatus = 'SYNCHRONIZED' | 'DEGRADED' | 'STALE' | 'MISSING_DATA' | 'NOT_READY';
export type OverallSyncStatus = 'SYNCHRONIZED' | 'DEGRADED' | 'STALE' | 'MISSING_DATA' | 'NOT_READY';

export interface TimeframeState {
  timeframe: AnalysisTimeframe;
  lastClosedCandle?: Candle;
  previousClosedCandle?: Candle;
  currentDevelopingCandle?: Candle;
  closedCandles: Candle[];
  candleCount: number;
  lastClosedTime?: number;
  dataHealth: DataHealthState;
  syncStatus: TimeframeSyncStatus;
  isSynchronized: boolean;
}

export interface MultiTimeframeState {
  symbol: string;
  asOfTimestamp: number;
  timeframes: Record<AnalysisTimeframe, TimeframeState>;
  overallSyncStatus: OverallSyncStatus;
  isFullySynchronized: boolean;
}

export class MtfStateEngine {
  private klineStore: KlineStore;
  private marketStateManager?: MarketStateManager;

  constructor(klineStore: KlineStore, marketStateManager?: MarketStateManager) {
    this.klineStore = klineStore;
    this.marketStateManager = marketStateManager;
  }

  computeState(symbol: string, asOfTimestamp = Date.now()): MultiTimeframeState {
    const timeframes: Partial<Record<AnalysisTimeframe, TimeframeState>> = {};
    let allSynchronized = true;
    let worstStatus: OverallSyncStatus = 'SYNCHRONIZED';

    for (const tf of CANONICAL_TIMEFRAMES) {
      const tfState = this.computeTimeframeState(symbol, tf, asOfTimestamp);
      timeframes[tf] = tfState;
      if (!tfState.isSynchronized) {
        allSynchronized = false;
      }
      worstStatus = this.resolveWorstStatus(worstStatus, tfState.syncStatus);
    }

    return {
      symbol,
      asOfTimestamp,
      timeframes: timeframes as Record<AnalysisTimeframe, TimeframeState>,
      overallSyncStatus: allSynchronized ? 'SYNCHRONIZED' : worstStatus,
      isFullySynchronized: allSynchronized,
    };
  }

  computeTimeframeState(symbol: string, tf: AnalysisTimeframe, asOf: number): TimeframeState {
    const intervalMs = TIMEFRAME_MS[tf];
    const rawCandles = this.klineStore.getCandlesAsOf(symbol, tf, asOf, 500);
    const { closed, developing } = this.partitionCandles(rawCandles, intervalMs, asOf);
    const dataHealth = this.marketStateManager?.getDataHealth(symbol) ?? 'HEALTHY';
    const syncStatus = this.evaluateSyncStatus(symbol, tf, closed, asOf, dataHealth);
    const isSynchronized = syncStatus === 'SYNCHRONIZED';

    return {
      timeframe: tf,
      lastClosedCandle: closed[closed.length - 1],
      previousClosedCandle: closed[closed.length - 2],
      currentDevelopingCandle: developing,
      closedCandles: closed,
      candleCount: closed.length,
      lastClosedTime: closed[closed.length - 1]?.openTime,
      dataHealth,
      syncStatus,
      isSynchronized,
    };
  }

  private partitionCandles(candles: Candle[], intervalMs: number, asOf: number): { closed: Candle[]; developing?: Candle } {
    const closed: Candle[] = [];
    let developing: Candle | undefined;

    for (const c of candles) {
      const isPastInterval = c.openTime + intervalMs <= asOf;
      if (c.isClosed || isPastInterval) {
        closed.push(c);
      } else if (c.openTime <= asOf) {
        developing = c;
      }
    }
    return { closed, developing };
  }

  private evaluateSyncStatus(
    symbol: string,
    tf: AnalysisTimeframe,
    closed: Candle[],
    asOf: number,
    health: DataHealthState
  ): TimeframeSyncStatus {
    if (health === 'DISCONNECTED') return 'MISSING_DATA';
    if (health === 'INVALID') return 'DEGRADED';
    if (closed.length === 0) return 'MISSING_DATA';
    if (closed.length < MIN_CLOSED_CANDLES[tf]) return 'NOT_READY';

    const last = closed[closed.length - 1]!;
    const intervalMs = TIMEFRAME_MS[tf];
    if (asOf - (last.openTime + intervalMs) > intervalMs * 3) return 'STALE';
    if (this.klineStore.detectGaps(symbol, tf as KlineInterval).length > 0) return 'DEGRADED';

    return 'SYNCHRONIZED';
  }

  private resolveWorstStatus(current: OverallSyncStatus, next: TimeframeSyncStatus): OverallSyncStatus {
    const priority: Record<OverallSyncStatus, number> = {
      MISSING_DATA: 5,
      NOT_READY: 4,
      STALE: 3,
      DEGRADED: 2,
      SYNCHRONIZED: 1,
    };
    return priority[next] > priority[current] ? next : current;
  }

  static isChildIntervalContained(childOpenTime: number, childTf: AnalysisTimeframe, parentOpenTime: number, parentTf: AnalysisTimeframe): boolean {
    const parentFloor = floorToInterval(childOpenTime, parentTf as KlineInterval);
    return parentFloor === parentOpenTime;
  }
}
