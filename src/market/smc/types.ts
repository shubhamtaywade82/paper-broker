import type { AnalysisTimeframe } from '../MtfStateEngine.js';

export type LiquidityType = 'BSL' | 'SSL' | 'EQUAL_HIGH' | 'EQUAL_LOW';
export type LiquidityStatus = 'ACTIVE' | 'SWEPT' | 'EXPIRED';
export type FvgType = 'BULLISH' | 'BEARISH';
export type FvgStatus = 'ACTIVE' | 'PARTIALLY_FILLED' | 'MITIGATED' | 'INVALIDATED';
export type ObType = 'BULLISH' | 'BEARISH';
export type ObStatus = 'ACTIVE' | 'MITIGATED' | 'INVALIDATED';

export interface SmcConfig {
  equalLevelTolerancePct: number;
  fvgMinSizePct?: number;
  obDisplacementThresholdPct: number;
  obLookbackBars: number;
  liquidityExpiryBars?: number;
}

export interface LiquidityLevel {
  id: string;
  symbol: string;
  timeframe: AnalysisTimeframe;
  type: LiquidityType;
  price: number;
  sourceSwingIds: string[];
  sourceCandleTimes: number[];
  createdAt: number;
  confirmedAt: number;
  status: LiquidityStatus;
}

export interface LiquiditySweep {
  id: string;
  symbol: string;
  timeframe: AnalysisTimeframe;
  liquidityId: string;
  liquidityType: LiquidityType;
  liquidityPrice: number;
  sweepExtreme: number;
  sweepCandleTime: number;
  confirmationTime: number;
  sourceCandleTimes: number[];
  sourceSwingIds: string[];
}

export interface FairValueGap {
  id: string;
  symbol: string;
  timeframe: AnalysisTimeframe;
  type: FvgType;
  upperPrice: number;
  lowerPrice: number;
  midpoint: number;
  sourceCandleTimes: number[];
  createdAt: number;
  confirmedAt: number;
  status: FvgStatus;
  mitigatedAt?: number;
  mitigationPrice?: number;
}

export interface OrderBlock {
  id: string;
  symbol: string;
  timeframe: AnalysisTimeframe;
  type: ObType;
  upperPrice: number;
  lowerPrice: number;
  invalidationPrice: number;
  originCandleTime: number;
  displacementCandleTime: number;
  confirmedStructureEventId: string;
  sourceCandleTimes: number[];
  createdAt: number;
  confirmedAt: number;
  status: ObStatus;
  mitigatedAt?: number;
  invalidatedAt?: number;
}

export interface SmcTimeframeContext {
  timeframe: AnalysisTimeframe;
  liquidityLevels: LiquidityLevel[];
  sweeps: LiquiditySweep[];
  fairValueGaps: FairValueGap[];
  orderBlocks: OrderBlock[];
  activeLiquidity: LiquidityLevel[];
  activeFvgs: FairValueGap[];
  activeOrderBlocks: OrderBlock[];
}

export interface MultiTimeframeSmcContext {
  symbol: string;
  asOfTimestamp: number;
  timeframes: Record<AnalysisTimeframe, SmcTimeframeContext>;
}
