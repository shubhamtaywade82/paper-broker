import type { ExecutionPlan } from '../../market/execution/types.js';
import type { SetupDirection } from '../../market/setup/types.js';

export type SignalStatus = 'DETECTED' | 'VALIDATED' | 'RISK_CHECKED' | 'PAPER_READY' | 'RISK_REJECTED' | 'AVOID' | 'EXPIRED';

export interface TakeProfitAllocation {
  level: number;
  price: number;
  allocationPct: number;
  riskReward: number;
  reason: string;
}

export interface SizingResult {
  accountEquity: number;
  riskPercent: number;
  riskCapital: number;
  stopDistance: number;
  quantity: number;
  positionNotional: number;
  requiredMargin: number;
  leverage: number;
}

export interface TradeSignal {
  id: string;
  signalKey: string;
  symbol: string;
  market: 'BINANCE_USDM';
  direction: SetupDirection;
  status: SignalStatus;
  setupType: string;
  confluenceScore: number;
  entryPrice: number;
  entryZone: { upper: number; lower: number };
  stopLossPrice: number;
  stopLossReason: string;
  takeProfits: TakeProfitAllocation[];
  riskReward: { tp1: number; tp2: number; tp3: number };
  sizing?: SizingResult;
  riskRejectionReasons: string[];
  createdAt: number;
  expiresAt: number;
  sourceSetupId: string;
  sourceExecutionPlanId: string;
  provenance: ExecutionPlan['provenance'];
}
