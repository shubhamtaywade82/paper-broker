import type { Instrument } from '../../broker/types.js';
import type { PaperBrokerConfig, PaperTradeRecord } from '../../broker/paper/types.js';
import type { PerformanceMetrics } from '../../broker/paper/PaperMetrics.js';
import type { Candle } from '../../strategy/indicators.js';

export interface HistoricalFundingRate {
  timestamp: number;
  fundingRate: number;
}

export interface HistoricalDataset {
  symbol: string;
  candles4h: Candle[];
  candles1h: Candle[];
  candles15m: Candle[];
  candles5m: Candle[];
  candles1m?: Candle[];
  fundingRates?: HistoricalFundingRate[];
  instrument?: Instrument;
}

export interface ReplayConfig {
  symbol: string;
  startTime: number;
  endTime: number;
  initialEquity: number;
  riskPerTradePct: number;
  maxDailyLossPct: number;
  maxOpenPositions: number;
  defaultLeverage: number;
  paperBrokerConfig: PaperBrokerConfig;
  strategyVersion: string;
}

export interface ArchetypeMetrics {
  archetype: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  averageR: number;
  averageMfe: number;
  averageMae: number;
  averageDurationMs: number;
}

export interface ScoreBucketMetrics {
  scoreRange: string;
  minScore: number;
  maxScore: number;
  tradesCount: number;
  winRate: number;
  expectancyR: number;
  netPnl: number;
  profitFactor: number;
}

export interface RegimeMetrics {
  regime: 'TREND_UP' | 'TREND_DOWN' | 'RANGE' | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY';
  totalTrades: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  averageR: number;
}

export interface MonteCarloSimulationResult {
  iterations: number;
  meanNetPnl: number;
  medianNetPnl: number;
  p05NetPnl: number;
  p95NetPnl: number;
  maxDrawdownMean: number;
  maxDrawdownP95: number;
  maxDrawdownP99: number;
  probabilityOfRuin: number;
  maxConsecutiveLossesMean: number;
  maxConsecutiveLossesP99: number;
}

export interface BacktestReport {
  id: string;
  symbol: string;
  configHash: string;
  startTime: number;
  endTime: number;
  durationDays: number;
  initialEquity: number;
  finalEquity: number;
  totalNetPnl: number;
  totalReturnPct: number;
  coreMetrics: PerformanceMetrics;
  archetypeBreakdown: ArchetypeMetrics[];
  scoreBucketValidation: ScoreBucketMetrics[];
  regimePerformance: RegimeMetrics[];
  monteCarlo: MonteCarloSimulationResult;
  trades: PaperTradeRecord[];
  generatedAt: number;
}
