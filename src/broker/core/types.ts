// src/broker/core/types.ts
// THE canonical domain model. Both engines consume these types.
// Status spellings follow Binance/live-broker conventions (e.g. CANCELED single-L).

export type OrderSide = 'BUY' | 'SELL';
export type OrderType =
  | 'LIMIT'
  | 'MARKET'
  | 'STOP'
  | 'STOP_MARKET'
  | 'TAKE_PROFIT'
  | 'TAKE_PROFIT_MARKET';
export type OrderStatus =
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'PENDING_CANCEL'
  | 'REJECTED'
  | 'EXPIRED';
export type PositionSide = 'LONG' | 'SHORT';
export type PositionStatus = 'OPEN' | 'CLOSED' | 'LIQUIDATED';
export type FillRole = 'maker' | 'taker';
export type CloseReason =
  | 'manual'
  | 'stop_loss'
  | 'take_profit'
  | 'trailing_stop'
  | 'liquidation'
  | 'timeout'
  | 'strategy_exit'
  | 'market_gap'
  | 'flash_crash'
  | 'funding_spike';

export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
  stopPrice?: number;
  filledQuantity: number;
  status: OrderStatus;
  reduceOnly: boolean;
  strategyId?: string;
  signalId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Fill {
  id: string;
  orderId: string;
  positionId?: string;
  symbol: string;
  side: OrderSide;
  price: number;
  quantity: number;
  fee: number;
  role: FillRole;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface Position {
  id: string;
  symbol: string;
  side: PositionSide;
  status: PositionStatus;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  margin: number;
  maintenanceMargin: number;
  liquidationPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  feesPaid: number;
  fundingPaid: number;
  mfe: number;
  mae: number;
  stopLoss?: number;
  takeProfit?: number;
  closeReason?: CloseReason;
  openedAt: number;
  closedAt?: number;
}

export interface AccountState {
  balance: number;
  equity: number;
  available: number;
  marginUsed: number;
  peakEquity: number;
  maxDrawdown: number;
}
