import type { SetupCandidate, SetupDirection } from '../setup/types.js';

export type ExecutionPlanStatus = 'EXECUTABLE' | 'AVOID';

export type InvalidationType =
  | 'STRUCTURE_BREAK'
  | 'ZONE_INVALIDATION'
  | 'SWEEP_FAILURE'
  | 'HTF_INVALIDATION'
  | 'DATA_INVALIDATION'
  | 'RR_INSUFFICIENT'
  | 'EXPIRED';

export interface TakeProfitTarget {
  level: 1 | 2 | 3;
  price: number;
  riskReward: number;
  rewardDistance: number;
  liquidityId?: string;
  reason: string;
}

export interface InvalidationPlan {
  price: number;
  reason: string;
  invalidationType: InvalidationType;
}

export interface ExecutionPlanConfig {
  minTp1RiskReward: number;
  minTp2RiskReward: number;
  minTp3RiskReward: number;
  tickBufferMultiplier: number;
  maxCandleAgeBars: number;
}

export interface ExecutionPlan {
  id: string;
  symbol: string;
  setupCandidateId: string;
  direction: SetupDirection;
  status: ExecutionPlanStatus;
  entryPrice: number;
  entryZone: { upper: number; lower: number };
  stopLossPrice: number;
  stopLossReason: string;
  takeProfitLevels: TakeProfitTarget[];
  riskReward: { tp1: number; tp2: number; tp3: number };
  riskDistance: number;
  rewardDistance: number;
  invalidation: InvalidationPlan;
  createdAt: number;
  expiresAt: number;
  validationFailures: string[];
  provenance: {
    setupType: SetupCandidate['setupType'];
    confluenceScore: number;
    sourceEventIds: string[];
    sourceCandleTimes: number[];
    reasoning: Record<string, string>;
  };
}
