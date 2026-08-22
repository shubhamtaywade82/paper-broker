import type { MarketTrend, StructureEvent } from '../structure/types.js';
import type { FairValueGap, LiquidityLevel, LiquiditySweep, OrderBlock } from '../smc/types.js';

export type SetupDirection = 'LONG' | 'SHORT' | 'AVOID';

export type SetupArchetype =
  | 'SSL_SWEEP_REVERSAL_LONG'
  | 'BULLISH_CHOCH_RETEST_LONG'
  | 'BULLISH_BOS_CONTINUATION_LONG'
  | 'BSL_SWEEP_REVERSAL_SHORT'
  | 'BEARISH_CHOCH_RETEST_SHORT'
  | 'BEARISH_BOS_CONTINUATION_SHORT'
  | 'AVOID_CONFLICTING_MTF'
  | 'AVOID_NO_LOCATION'
  | 'AVOID_DATA_DEGRADED'
  | 'AVOID_INVALIDATED'
  | 'AVOID_EXPIRED';

export type SetupState =
  | 'NONE'
  | 'WATCHING'
  | 'LIQUIDITY_INTERACTION'
  | 'STRUCTURE_CONFIRMATION'
  | 'ZONE_IDENTIFIED'
  | 'RETEST'
  | 'TRIGGERED'
  | 'READY'
  | 'INVALIDATED'
  | 'EXPIRED';

export interface ConfluenceBreakdown {
  htfAlignmentScore: number;
  structureScore: number;
  liquiditySweepScore: number;
  fvgScore: number;
  orderBlockScore: number;
  retestScore: number;
  triggerScore: number;
  dataQualityScore: number;
  totalScore: number;
  maxScore: number;
  notes: string[];
}

export interface SetupCandidate {
  id: string;
  symbol: string;
  direction: SetupDirection;
  setupType: SetupArchetype;
  state: SetupState;
  createdAt: number;
  updatedAt: number;
  confirmedAt?: number;
  invalidatedAt?: number;
  expiresAt: number;
  timeframes: {
    regime4h: MarketTrend;
    bias1h: MarketTrend;
    structure15m: MarketTrend;
    trigger5m: MarketTrend;
  };
  structureEvidence?: StructureEvent;
  liquidityEvidence?: LiquidityLevel;
  sweepEvidence?: LiquiditySweep;
  fvgEvidence?: FairValueGap;
  orderBlockEvidence?: OrderBlock;
  retestEvidence?: { retestCandleTime: number; retestPrice: number };
  triggerEvidence?: { triggerCandleTime: number; triggerType: string };
  confluence: ConfluenceBreakdown;
  invalidationReason?: string;
  status: 'ACTIVE' | 'READY' | 'INVALIDATED' | 'EXPIRED';
  sourceCandleTimes: number[];
  sourceEventIds: string[];
  // Extension hook for Phase 6 entry/sl/tp
  executionPlan?: {
    entryZone?: { upper: number; lower: number };
    stopZone?: { price: number; reason: string };
    targetZones?: Array<{ level: number; price: number }>;
    riskRewardRatio?: number;
  };
}

export interface SetupConfig {
  minConfluenceScore: number;
  maxCandleAgeBars: number;
  htfWeight: number;
  structureWeight: number;
  sweepWeight: number;
  fvgWeight: number;
  obWeight: number;
  retestWeight: number;
  triggerWeight: number;
  dataQualityWeight: number;
}
