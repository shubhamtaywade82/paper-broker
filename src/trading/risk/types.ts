import type { SizingResult } from '../signal/types.js';

export interface AccountState {
  equity: number;
  availableBalance: number;
  dailyLoss: number;
  realizedPnl: number;
}

export interface PortfolioPosition {
  symbol: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  stopLossPrice: number;
  notional: number;
  unrealizedPnl: number;
}

export interface PortfolioExposure {
  grossNotional: number;
  netNotional: number;
  longNotional: number;
  shortNotional: number;
  totalRiskAtStop: number;
  openPositionsCount: number;
  symbolPositionsCount: Record<string, number>;
}

export interface RiskConfig {
  maxOpenPositions: number;
  maxPositionsPerSymbol: number;
  maxDailyLossPct: number;
  riskPerTradePct: number;
  maxAccountRiskPct: number;
  cooldownBars: number;
  defaultLeverage: number;
  maxLeverage: number;
  maxNotionalPerTrade?: number;
}

export interface RiskCheckResult {
  approved: boolean;
  rejectionReasons: string[];
  sizing?: SizingResult;
}
