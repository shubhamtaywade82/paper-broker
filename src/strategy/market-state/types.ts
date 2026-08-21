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

export type TradingEventType =
  | 'CANDLE_CLOSED'
  | 'TRADE'
  | 'DEPTH_UPDATE'
  | 'MARK_PRICE'
  | 'LIQUIDATION'
  | 'FUNDING_UPDATED'
  | 'OPEN_INTEREST_UPDATED'
  | 'SWING_CONFIRMED'
  | 'BOS'
  | 'CHOCH'
  | 'LIQUIDITY_SWEEP'
  | 'DISPLACEMENT'
  | 'REGIME_CHANGED'
  | 'SETUP_CREATED'
  | 'SETUP_ARMED'
  | 'SETUP_INVALIDATED'
  | 'SETUP_EXPIRED'
  | 'ENTRY_INTENT'
  | 'CONTINUATION_INTENT'
  | 'EXIT_INTENT'
  | 'ADD_INTENT'
  | 'REDUCE_INTENT'
  | 'REVERSE_INTENT'
  | 'RISK_APPROVED'
  | 'RISK_REJECTED'
  | 'ORDER_SUBMITTED'
  | 'ORDER_ACCEPTED'
  | 'ORDER_FILLED'
  | 'PARTIAL_FILL'
  | 'ORDER_CANCELED'
  | 'ORDER_REJECTED'
  | 'POSITION_OPENED'
  | 'POSITION_INCREASED'
  | 'POSITION_REDUCED'
  | 'BREAKEVEN_ARMED'
  | 'TRAIL_ARMED'
  | 'POSITION_CLOSED';

export interface TradingEvent<TPayload = unknown> {
  id: string;
  type: TradingEventType;
  symbol: string;
  timestamp: number;
  source: string;
  sequence: number;
  payload: TPayload;
}

export interface CandleClosedPayload {
  candle: Candle;
}

export interface StructureEventPayload {
  event: StructureEvent;
}

export interface LiquiditySweepPayload {
  sweep: LiquiditySweep;
}

export interface DisplacementPayload {
  displacement: DisplacementEvent;
}

export interface RegimeChangedPayload {
  previous: Bias;
  current: Bias;
  snapshot: MarketStateSnapshot;
}

export type SetupLifecycleStatus = 'WATCHING' | 'TRIGGER_ARMED' | 'INVALID' | 'EXPIRED' | 'INTENT_EMITTED';

export interface SetupLifecyclePayload {
  setup: TradeSetup;
  status: SetupLifecycleStatus;
  reason?: string;
}

export type ExitReason =
  | 'STOP_LOSS'
  | 'TAKE_PROFIT'
  | 'TRAILING_STOP'
  | 'STRUCTURE_BREAK'
  | 'REGIME_FLIP'
  | 'LIQUIDITY_TARGET'
  | 'TIME_STOP'
  | 'FLOW_REVERSAL'
  | 'RISK_LIMIT'
  | 'MANUAL';

export type PositionAction = 'OPEN' | 'ADD' | 'REDUCE' | 'HOLD' | 'CLOSE' | 'REVERSE';
export type PositionLifecycleState = 'FLAT' | 'PENDING_ENTRY' | 'LONG' | 'SHORT' | 'EXIT_PENDING';

export interface IntentPayload {
  setupId?: string;
  symbol: string;
  direction?: Direction;
  action: PositionAction;
  reason: SetupType | ExitReason;
  entryZone?: { low: number; high: number };
  invalidation?: number;
  targets?: number[];
  confidence: number;
  evidence: TradeSetup['evidence'];
}

export interface PositionLifecyclePayload {
  previous: PositionLifecycleState;
  current: PositionLifecycleState;
  action: PositionAction;
  reason: string;
}
