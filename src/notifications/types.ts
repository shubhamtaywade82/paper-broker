export type NotificationLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export interface BaseNotification {
  level: NotificationLevel;
  title: string;
  message: string;
  timestampUtc?: string;
  metadata?: Record<string, unknown>;
}

export interface TradeNotification {
  symbol: string;
  side: 'BUY' | 'SELL' | 'LONG' | 'SHORT';
  type: string;
  price: number;
  quantity: number;
  mode: string;
  orderId?: string;
  strategyId?: string;
  stopLoss?: number;
  takeProfit?: number;
}

export interface PositionUpdateNotification {
  symbol: string;
  side: string;
  entryPrice: number;
  currentPrice: number;
  pnlPct: number;
  pnlUsd?: number;
  status: 'OPEN' | 'BREAKEVEN' | 'TP_HIT' | 'SL_HIT' | 'CLOSED';
  reason?: string;
}

export interface HealthNotification {
  provider: string;
  status: string;
  reason?: string;
  actionTaken?: string;
}
