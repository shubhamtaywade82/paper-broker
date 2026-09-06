import type { MarketTrend, StructureEvent } from '../structure/types.js';
import type { FairValueGap, LiquidityLevel, LiquiditySweep, OrderBlock } from '../smc/types.js';
import type { ConfluenceGrade, HierarchicalConfluenceBreakdown } from '../../analysis/types.js';

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

/**
 * Setup lifecycle states.
 *
 * CANONICAL PROGRESSION (market-intelligence layer):
 *   WATCHING → APPROACHING → AT_ZONE → TRIGGER_DETECTED → CONFIRMED →
 *   READY → EXECUTED → MANAGING → COMPLETED
 *
 * LEGACY STATES (LIQUIDITY_INTERACTION, STRUCTURE_CONFIRMATION,
 * ZONE_IDENTIFIED, RETEST, TRIGGERED) remain valid: they are the
 * evidence-driven stages the original Phase-5 state machine produced and are
 * still emitted when the state machine runs without a live price/zone
 * context (see SetupStateMachine.advanceState). Legacy states map onto the
 * canonical progression as follows:
 *   LIQUIDITY_INTERACTION → APPROACHING
 *   STRUCTURE_CONFIRMATION → TRIGGER_DETECTED (structure evidence)
 *   ZONE_IDENTIFIED → AT_ZONE
 *   RETEST → CONFIRMED
 *   TRIGGERED → CONFIRMED
 */
export type SetupState =
  | 'NONE'
  | 'WATCHING'
  | 'APPROACHING'
  | 'AT_ZONE'
  | 'TRIGGER_DETECTED'
  | 'CONFIRMED'
  | 'READY'
  | 'EXECUTED'
  | 'MANAGING'
  | 'COMPLETED'
  // Legacy evidence-driven states (kept for backward compatibility).
  | 'LIQUIDITY_INTERACTION'
  | 'STRUCTURE_CONFIRMATION'
  | 'ZONE_IDENTIFIED'
  | 'RETEST'
  | 'TRIGGERED'
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
    /** 2h structural-context trend (undefined on legacy consumers). */
    structure2h?: MarketTrend;
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

  // --- Market-intelligence layer extensions -------------------------------
  /** Hierarchical (evidence-quality) confluence — set by the qualification stage. */
  hierarchicalConfluence?: HierarchicalConfluenceBreakdown;
  /** Letter grade derived from hierarchicalConfluence.totalScore. */
  grade?: ConfluenceGrade;
  /** Two-stage qualification result (context / thesis / trigger gates). */
  qualification?: SetupQualification;
  /** TradeScenario this setup was generated from (ScenarioEngine id). */
  scenarioId?: string;

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

/**
 * Result of the Stage-2 qualification gates applied on top of Stage-1
 * candidate discovery. Discovery is permissive (any interesting evidence
 * creates a candidate); qualification decides whether it may become a trade.
 */
export interface SetupQualification {
  /** Context gate: regime/volatility/location support trading this symbol. */
  contextQualified: boolean;
  /** Thesis gate: the directional thesis backs the candidate's direction. */
  thesisQualified: boolean;
  /** Trigger gate: an executable trigger exists (or is pending). */
  triggerQualified: boolean;
  /** True when the candidate failed qualification and must not trade. */
  rejected: boolean;
  /** Human-readable reasons for rejection (empty when not rejected). */
  rejectionReasons: string[];
}
