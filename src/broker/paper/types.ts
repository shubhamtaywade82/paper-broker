import type { TradeSignal } from '../../trading/signal/types.js';
import type { OrderStatus, OrderType } from '../core/types.js';

export type PaperOrderType = OrderType;
export type PaperOrderStatus = OrderStatus;
export type PaperPositionState = 'FLAT' | 'OPEN' | 'CLOSING' | 'CLOSED';

export type PaperTradeLifecycle =
  | 'SIGNAL_RECEIVED'
  | 'ORDER_ACCEPTED'
  | 'WAITING_FOR_ENTRY'
  | 'ENTRY_FILLED'
  | 'POSITION_OPEN'
  | 'TP1_PARTIAL'
  | 'TP2_PARTIAL'
  | 'TP3_REACHED'
  | 'BREAKEVEN_ARMED'
  | 'STOP_MOVED_TO_BREAKEVEN'
  | 'STOPPED'
  | 'CLOSED'
  | 'LIQUIDATED';

export interface PaperBrokerConfig {
  makerFeeRate: number;
  takerFeeRate: number;
  slippageModel: 'NONE' | 'FIXED_TICKS' | 'BPS' | 'VOLATILITY';
  slippageFixedTicks?: number;
  slippageBps?: number;
  ambiguousIntrabarPolicy: 'REJECT_AMBIGUOUS' | 'CONSERVATIVE' | 'OPTIMISTIC';
  breakevenEnabled: boolean;
  breakevenTriggerR: number;
  breakevenOffsetTicks: number;
  trailingEnabled: boolean;
  trailingTriggerR: number;
  trailingDistanceTicks: number;
  maintenanceMarginRate: number;
  fundingMode: 'DISABLED' | 'CANONICAL_ONLY' | 'SYNTHETIC_TEST';
}

export interface PaperOrder {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: PaperOrderType;
  quantity: number;
  filledQuantity: number;
  price?: number;
  stopPrice?: number;
  reduceOnly: boolean;
  status: PaperOrderStatus;
  createdAt: number;
  updatedAt: number;
  signalKey: string;
  setupId: string;
  executionPlanId: string;
  positionId?: string;
  targetLevel?: number;
}

export interface PaperFill {
  id: string;
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  fee: number;
  slippage: number;
  isMaker: boolean;
  timestamp: number;
  positionId?: string;
}

export interface PaperPosition {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  state: PaperPositionState;
  quantity: number;
  initialQuantity: number;
  remainingQuantity: number;
  averageEntryPrice: number;
  currentMarkPrice: number;
  liquidationPrice: number;
  leverage: number;
  initialMargin: number;
  usedMargin: number;
  unrealizedPnl: number;
  realizedPnl: number;
  fees: number;
  stopLossPrice: number;
  plannedStopPrice: number;
  takeProfitPrices: number[];
  highestPriceReached: number;
  lowestPriceReached: number;
  openedAt: number;
  closedAt?: number;
  lifecycle: PaperTradeLifecycle;
  signalKey: string;
  setupId: string;
  executionPlanId: string;
}

export interface PaperAccountState {
  balance: number;
  equity: number;
  availableBalance: number;
  usedMargin: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalFees: number;
}

export interface PaperTradeRecord {
  tradeId: string;
  signalId: string;
  symbol: string;
  setupType: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice?: number;
  initialStopLoss: number;
  finalStopLoss: number;
  tp1Price: number;
  tp2Price: number;
  tp3Price: number;
  quantity: number;
  leverage: number;
  fees: number;
  grossPnl: number;
  netPnl: number;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
  entryTimestamp: number;
  exitTimestamp?: number;
  exitReason?: string;
  durationMs?: number;
  plannedRiskReward: number;
  realizedRiskReward?: number;
  status: 'OPEN' | 'CLOSED' | 'STOPPED' | 'TAKE_PROFIT' | 'LIQUIDATED' | 'CANCELED';
  lifecycle: PaperTradeLifecycle[];
}

export interface TradeTrace {
  tradeRecord: PaperTradeRecord;
  signal: TradeSignal;
  orders: PaperOrder[];
  fills: PaperFill[];
  position: PaperPosition;
  events: Array<{ timestamp: number; type: string; payload: unknown }>;
}
