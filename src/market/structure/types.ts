import type { AnalysisTimeframe } from '../MtfStateEngine.js';

export type SwingType = 'HIGH' | 'LOW';
export type SwingClassification = 'HH' | 'HL' | 'LH' | 'LL' | 'EQUAL_HIGH' | 'EQUAL_LOW' | 'UNKNOWN';
export type StructureScope = 'EXTERNAL' | 'INTERNAL';
export type MarketTrend = 'BULLISH' | 'BEARISH' | 'RANGE' | 'UNKNOWN';
export type StructureForm = 'HH_HL' | 'LH_LL' | 'MIXED' | 'RANGE' | 'UNKNOWN';

export type StructureEventType =
  | 'SWING_HIGH_CONFIRMED'
  | 'SWING_LOW_CONFIRMED'
  | 'BOS_BULLISH'
  | 'BOS_BEARISH'
  | 'CHOCH_BULLISH'
  | 'CHOCH_BEARISH';

export interface SwingConfig {
  swingLeftBars: number;
  swingRightBars: number;
  equalTolerancePct?: number;
}

export interface ConfirmedSwing {
  id: string;
  symbol: string;
  timeframe: AnalysisTimeframe;
  scope: StructureScope;
  type: SwingType;
  classification: SwingClassification;
  price: number;
  pivotTime: number;
  confirmationTime: number;
  candleIndex: number;
}

export interface StructureEvent {
  id: string;
  symbol: string;
  timeframe: AnalysisTimeframe;
  scope: StructureScope;
  eventType: StructureEventType;
  price: number;
  brokenSwingPrice?: number;
  brokenSwingTime?: number;
  pivotTime: number;
  confirmationTime: number;
  sourceCandleTime: number;
}

export interface TimeframeStructureState {
  timeframe: AnalysisTimeframe;
  scope: StructureScope;
  trend: MarketTrend;
  structure: StructureForm;
  swings: ConfirmedSwing[];
  events: StructureEvent[];
  lastConfirmedSwingHigh?: ConfirmedSwing;
  lastConfirmedSwingLow?: ConfirmedSwing;
  previousConfirmedSwingHigh?: ConfirmedSwing;
  previousConfirmedSwingLow?: ConfirmedSwing;
  lastStructureEvent?: StructureEvent;
  lastStructureEventTime?: number;
}

export interface MultiTimeframeStructureState {
  symbol: string;
  asOfTimestamp: number;
  timeframes: Record<AnalysisTimeframe, TimeframeStructureState>;
}
