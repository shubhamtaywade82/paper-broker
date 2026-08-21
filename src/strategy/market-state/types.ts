import type { Candle } from '../indicators.js';

export type Direction = 'LONG' | 'SHORT';
export type Bias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type StructureTrend = 'UP' | 'DOWN' | 'RANGE';
export type SetupType = 'REVERSAL' | 'CONTINUATION' | 'BREAKOUT_RETEST' | 'LIQUIDITY_REVERSAL';
export type SetupTrigger = 'MARKET' | 'LIMIT' | 'CONFIRMATION';
export type SetupGrade = 'NO_TRADE' | 'WATCH' | 'CANDIDATE' | 'TRADEABLE' | 'HIGH_CONVICTION';

export interface SwingPoint {
  kind: 'HIGH' | 'LOW';
  index: number;
  time: number;
  price: number;
}

export interface StructureEvent {
  type: 'HH' | 'HL' | 'LH' | 'LL' | 'BOS_UP' | 'BOS_DOWN' | 'CHOCH_UP' | 'CHOCH_DOWN';
  index: number;
  time: number;
  price: number;
}

export interface LiquiditySweep {
  side: 'SELL_SIDE' | 'BUY_SIDE';
  sweptSwing: SwingPoint;
  index: number;
  time: number;
  wickExtreme: number;
  close: number;
}

export interface DisplacementEvent {
  direction: Bias;
  index: number;
  time: number;
  atrMultiple: number;
  volumeZScore: number;
  closeLocation: number;
  score: number;
}

export interface FlowContext {
  openInterest?: 'RISING' | 'FALLING' | 'FLAT';
  openInterestPriceState?: 'LONG_PARTICIPATION' | 'SHORT_COVERING' | 'SHORT_PARTICIPATION' | 'LONG_LIQUIDATION' | 'NEUTRAL';
  takerDelta?: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  takerDeltaRatio?: number;
  funding?: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
}

export interface MarketStructureState {
  trend: StructureTrend;
  lastSwingHigh?: SwingPoint;
  lastSwingLow?: SwingPoint;
  higherHigh: boolean;
  higherLow: boolean;
  lowerHigh: boolean;
  lowerLow: boolean;
  bos: false | 'UP' | 'DOWN';
  choch: false | 'UP' | 'DOWN';
  events: StructureEvent[];
}

export interface MarketStateSnapshot {
  symbol: string;
  timeframe: string;
  regime: Bias;
  candles: Candle[];
  swings: SwingPoint[];
  structure: MarketStructureState;
  liquidity: {
    sellSideSweep: boolean;
    buySideSweep: boolean;
    latestSweep?: LiquiditySweep;
    nearestSellLiquidity?: number;
    nearestBuyLiquidity?: number;
  };
  displacement: {
    bullish: boolean;
    bearish: boolean;
    latest?: DisplacementEvent;
  };
  flow: FlowContext;
  location: {
    premiumDiscount: 'PREMIUM' | 'DISCOUNT' | 'EQUILIBRIUM' | 'UNKNOWN';
    distanceFromImpulse?: number;
  };
}

export interface TradeSetup {
  id: string;
  symbol: string;
  direction: Direction;
  type: SetupType;
  timeframe: string;
  entry: { min: number; max: number; trigger: SetupTrigger };
  invalidation: { price: number; reason: string };
  targets: number[];
  score: number;
  grade: SetupGrade;
  evidence: {
    structure: string[];
    liquidity: string[];
    flow: string[];
    volume: string[];
    derivatives: string[];
  };
}
