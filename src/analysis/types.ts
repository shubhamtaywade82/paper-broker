import type { AnalysisTimeframe, TimeframeRole } from '../market/MtfStateEngine.js';
import type { MarketTrend, StructureEventType } from '../market/structure/types.js';
import type { MarketRegime } from './MarketRegimeDetector.js';

/**
 * Market Intelligence layer — shared contracts.
 *
 * These types define the boundary between the deterministic market engines
 * (structure / SMC / indicators) and everything that reasons over their
 * output: the Market Context Engine, Thesis Engine, Scenario Engine,
 * hierarchical confluence scoring, the autonomous agent, the dashboard and
 * (later) the LLM synthesis layer.
 *
 * Design principles (docs/decisions/0006-market-intelligence-layer.md):
 *  1. Deterministic — the same closed candles produce the same facts.
 *  2. Backtestable — every structure is computed point-in-time via asOf.
 *  3. Agentic — LLMs consume these structured facts, never raw candles, and
 *     are never the source of the measurements themselves.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type Direction = 'BULLISH' | 'BEARISH';

/** A named, price-anchored reference the narrative layer can point at. */
export interface PriceLevel {
  price: number;
  label: string;
  /** Which timeframe the level originates from. */
  timeframe: AnalysisTimeframe | 'composite';
  kind:
    | 'SWING_HIGH'
    | 'SWING_LOW'
    | 'LIQUIDITY'
    | 'ZONE_EDGE'
    | 'EQUILIBRIUM'
    | 'RANGE_HIGH'
    | 'RANGE_LOW';
  /** Distance from current price, in percent (positive always). */
  distancePct: number;
}

// ---------------------------------------------------------------------------
// Zones (unified FVG / OB / supply / demand representation)
// ---------------------------------------------------------------------------

export type ZoneType =
  | 'FVG'
  | 'ORDER_BLOCK'
  | 'SUPPLY'
  | 'DEMAND'
  | 'VAH'
  | 'VAL'
  | 'POC';

export type ZoneStatus = 'ACTIVE' | 'MITIGATED' | 'FILLED' | 'BROKEN';

/**
 * A single (un-merged) zone extracted from the SMC detectors. Zone
 * aggregation merges these into ConfluenceZone objects.
 */
export interface PriceZone {
  id: string;
  symbol: string;
  type: ZoneType;
  direction?: Direction;
  low: number;
  high: number;
  timeframe: AnalysisTimeframe;
  /** 0..100 — detector-derived quality (size, displacement, recency). */
  strength: number;
  status: ZoneStatus;
  touches: number;
  createdAt: number;
  confirmedAt: number;
  /** Midpoint for quick reference. */
  midpoint: number;
}

/**
 * The product of zone aggregation: overlapping FVG/OB/supply/demand zones on
 * one or more timeframes merged into a single confluent area, e.g.
 * "102.68–102.79 CONFLUENCE DEMAND, strength 87".
 */
export interface ConfluenceZone {
  id: string;
  /** Member zone ids that were merged into this zone. */
  sourceZoneIds: string[];
  /** Dominant direction of the merged zone. */
  direction: Direction | 'NEUTRAL';
  low: number;
  high: number;
  midpoint: number;
  /** Highest-weight timeframe contributing to the zone. */
  dominantTimeframe: AnalysisTimeframe;
  /** Every timeframe that contributed. */
  timeframes: AnalysisTimeframe[];
  /** Zone types present in the merge (e.g. ['FVG','ORDER_BLOCK']). */
  types: ZoneType[];
  /** 0..100 confluence quality: overlaps, TF weight, touches, freshness. */
  strength: number;
  status: ZoneStatus;
  touches: number;
  createdAt: number;
  lastConfirmedAt: number;
}

// ---------------------------------------------------------------------------
// Liquidity map
// ---------------------------------------------------------------------------

/**
 * A cluster of resting liquidity (stops) at a price. Derived from the
 * LiquidityDetector's levels (BSL/SSL/EQUAL_HIGH/EQUAL_LOW) but enriched with
 * narrative fields: internal vs external, recency of sweeps, strength.
 */
export interface LiquidityPool {
  id: string;
  side: 'BUY_SIDE' | 'SELL_SIDE';
  kind: 'BSL' | 'SSL' | 'EQUAL_HIGH' | 'EQUAL_LOW';
  price: number;
  /** 0..100 — equal-highs clusters and HTF pools score higher. */
  strength: number;
  timeframe: AnalysisTimeframe;
  /**
   * External liquidity sits beyond the current dealing range (engineer-take
   * targets); internal liquidity sits inside it (intrabar draw targets).
   */
  scope: 'EXTERNAL' | 'INTERNAL';
  status: 'ACTIVE' | 'SWEPT' | 'EXPIRED';
  createdAt: number;
  confirmedAt: number;
  sweptAt?: number;
}

export interface LiquiditySweepRecord {
  poolId: string;
  side: 'BUY_SIDE' | 'SELL_SIDE';
  kind: string;
  price: number;
  sweepExtreme: number;
  sweptAt: number;
  timeframe: AnalysisTimeframe;
}

/**
 * The full liquidity narrative for a symbol at a point in time — what a
 * discretionary trader annotates as "liquidity above / below".
 */
export interface LiquidityMap {
  buySide: LiquidityPool[];
  sellSide: LiquidityPool[];
  nearestAbove?: LiquidityPool;
  nearestBelow?: LiquidityPool;
  recentlySwept: LiquiditySweepRecord[];
  externalLiquidity: LiquidityPool[];
  internalLiquidity: LiquidityPool[];
}

// ---------------------------------------------------------------------------
// Volatility
// ---------------------------------------------------------------------------

export interface VolatilityState {
  label: 'LOW' | 'MODERATE' | 'ELEVATED' | 'EXTREME';
  /** ATR(14) in price units on the 1h series. */
  atr1h: number;
  /** ATR as percent of price. */
  atrPct: number;
  /** Current ATR vs its 50-period median (>1 = expanding). */
  expansionRatio: number;
}

// ---------------------------------------------------------------------------
// Per-timeframe context
// ---------------------------------------------------------------------------

export interface TimeframeStructureSummary {
  hh: boolean;
  hl: boolean;
  lh: boolean;
  ll: boolean;
  lastEvent?: StructureEventType;
  eventDirection?: Direction;
  /** Age of the last structure event, in bars of this timeframe. */
  lastEventAgeBars?: number;
}

export interface TimeframeLiquiditySummary {
  buySide: LiquidityPool[];
  sellSide: LiquidityPool[];
  recentSweeps: LiquiditySweepRecord[];
}

export interface TimeframeZoneSummary {
  bullishFvg: PriceZone[];
  bearishFvg: PriceZone[];
  bullishOb: PriceZone[];
  bearishOb: PriceZone[];
}

export interface TimeframePosition {
  relativeToRange: 'DISCOUNT' | 'EQUILIBRIUM' | 'PREMIUM';
  /** 0..1 — where price sits inside the local dealing range (0 = low). */
  rangePosition: number;
  distanceToHighPct: number;
  distanceToLowPct: number;
}

/**
 * One timeframe's slice of the market narrative: what this timeframe's
 * structure, liquidity, zones and position say on their own.
 */
export interface TimeframeContext {
  timeframe: AnalysisTimeframe;
  role: TimeframeRole;
  trend: MarketTrend;
  lastSwingHigh?: number;
  lastSwingLow?: number;
  structure: TimeframeStructureSummary;
  liquidity: TimeframeLiquiditySummary;
  zones: TimeframeZoneSummary;
  position: TimeframePosition;
  /** Number of closed candles available when this context was computed. */
  candleCount: number;
}

// ---------------------------------------------------------------------------
// Market location
// ---------------------------------------------------------------------------

export type MarketPosition =
  | 'DEEP_DISCOUNT'
  | 'DISCOUNT'
  | 'EQUILIBRIUM'
  | 'PREMIUM'
  | 'DEEP_PREMIUM';

/**
 * WHERE price is inside the HTF dealing range — the layer that makes the
 * same bullish BOS mean different things at discount vs at premium.
 */
export interface MarketLocation {
  /** Dealing range used for the premium/discount evaluation. */
  range: {
    high: number;
    low: number;
    equilibrium: number;
    /** Timeframe the range was derived from. */
    timeframe: AnalysisTimeframe;
  };
  position: MarketPosition;
  /** 0..1 inside the range (0 = range low, 1 = range high). */
  rangePosition: number;
  nearbyZones: ConfluenceZone[];
  liquidityDistance: {
    /** Percent distance to the nearest buy-side (above) pool. */
    upside: number;
    /** Percent distance to the nearest sell-side (below) pool. */
    downside: number;
  };
}

// ---------------------------------------------------------------------------
// Market context (the "what is the market doing" object)
// ---------------------------------------------------------------------------

export interface RegimeState {
  /** Coarse primary narrative regime derived from HTF structure + location. */
  primary: 'BULLISH' | 'BEARISH' | 'RANGE' | 'TRANSITION';
  /** 0..1 confidence in the classification. */
  confidence: number;
  /** Volatility/behavioral regime from MarketRegimeDetector (raw label). */
  behavioral: MarketRegime | null;
}

export interface StructureAlignmentSummary {
  /** Per-timeframe trend labels, high → low. */
  trends: Record<AnalysisTimeframe, MarketTrend | undefined>;
  /** Number of timeframes aligned with the net directional bias. */
  alignedCount: number;
  /** Timeframes conflicting with the net bias. */
  conflicting: AnalysisTimeframe[];
  /** True when 4h → 5m all point the same direction (stacked alignment). */
  fullyStacked: boolean;
  lastEvents: Record<AnalysisTimeframe, StructureEventType | undefined>;
}

export interface DirectionalBias {
  /** 0..1 score for each side. */
  long: number;
  short: number;
  neutral: number;
  final: 'LONG' | 'SHORT' | 'NEUTRAL';
}

/**
 * The Market Context Engine's output: a single, deterministic answer to
 * "what is the market doing before we decide whether there is a trade?".
 */
export interface MarketContext {
  symbol: string;
  asOf: number;
  /** Price the whole narrative is anchored to (LTF close with data). */
  currentPrice: number;

  regime: RegimeState;
  timeframes: Record<AnalysisTimeframe, TimeframeContext>;
  directionalBias: DirectionalBias;
  structure: StructureAlignmentSummary;
  liquidity: LiquidityMap;
  /** Merged confluence zones across all timeframes, sorted by strength. */
  zones: ConfluenceZone[];
  volatility: VolatilityState;
  location: MarketLocation;
  nearestLevels: PriceLevel[];
}

// ---------------------------------------------------------------------------
// Thesis
// ---------------------------------------------------------------------------

export type ThesisType =
  | 'BULLISH_CONTINUATION'
  | 'BULLISH_REVERSAL'
  | 'BEARISH_CONTINUATION'
  | 'BEARISH_REVERSAL'
  | 'RANGE'
  | 'TRANSITION'
  | 'NO_CLEAR_THESIS';

/** One scored reason backing a thesis / scenario / setup decision. */
export interface Evidence {
  source:
    | 'STRUCTURE'
    | 'LIQUIDITY'
    | 'ZONES'
    | 'LOCATION'
    | 'REGIME'
    | 'VOLATILITY'
    | 'TRIGGER'
    | 'RISK';
  timeframe: AnalysisTimeframe | 'composite';
  statement: string;
  /** 0..1 how strongly this piece of evidence supports the conclusion. */
  weight: number;
}

/**
 * The directional thesis — the machine equivalent of
 * "4H bullish, 2H bullish recovery, 1H bullish, 15M BOS, 5M retest".
 */
export interface Thesis {
  type: ThesisType;
  confidence: number;
  /** Per-timeframe human-readable reasoning. */
  reasoning: Record<AnalysisTimeframe, string>;
  /** Scored evidence list, strongest first. */
  rationale: Evidence[];
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export type ScenarioType =
  | 'RETEST_CONTINUATION'
  | 'BREAKOUT_RETEST'
  | 'LIQUIDITY_REJECTION'
  | 'REVERSAL'
  | 'RANGE_ROTATION'
  | 'NO_TRADE';

export type ScenarioStatus = 'WATCHING' | 'ARMED' | 'CONDITIONAL' | 'INVALID' | 'EXPIRED';

export interface ScenarioTrigger {
  kind: 'PRICE_LEVEL' | 'ZONE_RETEST' | 'SWEEP_AND_CHOCH' | 'STRUCTURE_EVENT';
  /** Price that must trade for the trigger to fire. */
  level: number;
  /** Inclusive band around the level. */
  band: { upper: number; lower: number };
  description: string;
  /** Optional confirmation required after the trigger level trades. */
  confirmation?: string;
}

export interface TradeScenario {
  id: string;
  symbol: string;
  type: ScenarioType;
  direction: 'LONG' | 'SHORT' | 'NONE';
  status: ScenarioStatus;
  /** 0..1 — how well the scenario fits the current thesis. */
  alignment: number;
  entry?: {
    zone: { upper: number; lower: number };
    trigger?: ScenarioTrigger;
  };
  invalidation: number;
  invalidationReason: string;
  targets: Array<{ price: number; label: string }>;
  /** Reward:risk to the final target, computed from the zone midpoint. */
  rr: number;
  narrative: string;
  evidence: Evidence[];
  /** Back-reference for setups generated from this scenario. */
  linkedSetupIds: string[];
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Hierarchical confluence
// ---------------------------------------------------------------------------

export type ConfluenceGrade = 'A+' | 'A' | 'B' | 'C' | 'REJECT';

export interface ConfluenceFactor {
  factor:
    | 'HTF_REGIME_4H'
    | 'STRUCTURE_2H'
    | 'THESIS_1H'
    | 'STRUCTURE_15M'
    | 'LIQUIDITY_SWEEP'
    | 'ZONE_CONFLUENCE'
    | 'MARKET_LOCATION'
    | 'TRIGGER_5M'
    | 'RISK_REWARD';
  weight: number;
  awarded: number;
  note: string;
}

export interface HierarchicalConfluenceBreakdown {
  factors: ConfluenceFactor[];
  totalScore: number;
  maxScore: number;
  grade: ConfluenceGrade;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Final analysis object (what the agent / dashboard / LLM consume)
// ---------------------------------------------------------------------------

export type ExecutionState = 'WAIT' | 'READY' | 'EXECUTE';

export interface AnalysisExecution {
  state: ExecutionState;
  /** The setup/trigger to wait for when state is WAIT. */
  trigger?: ScenarioTrigger;
  setupId?: string;
  note: string;
}

export interface AnalysisRiskEnvelope {
  /** Price at which the preferred scenario's thesis is wrong. */
  invalidation: number;
  /** Max fraction of equity to risk on the preferred scenario (0..1). */
  maxRiskPercent: number;
  /** Optional structural stop suggested by the scenario. */
  structuralStop?: number;
}

/**
 * The final, machine-readable equivalent of a full discretionary chart
 * analysis: regime, per-timeframe narrative, bias, key levels, thesis,
 * ranked scenarios, execution state and risk envelope.
 */
export interface MarketAnalysis {
  symbol: string;
  asOf: number;
  dataQuality: {
    /** Overall MTF sync status at computation time. */
    mtfSynchronized: boolean;
    overallSyncStatus: string;
    /** Timeframes excluded from scoring due to missing/degraded data. */
    degradedTimeframes: AnalysisTimeframe[];
  };
  marketState: {
    regime: string;
    regimeConfidence: number;
    volatility: string;
    location: string;
  };
  timeframeAnalysis: Record<AnalysisTimeframe, TimeframeContext>;
  directionalBias: DirectionalBias;
  keyLevels: {
    resistance: PriceLevel[];
    support: PriceLevel[];
    liquidityAbove: PriceLevel[];
    liquidityBelow: PriceLevel[];
  };
  thesis: Thesis;
  scenarios: TradeScenario[];
  preferredScenarioId?: string;
  execution: AnalysisExecution;
  risk: AnalysisRiskEnvelope;
  /** Current price the analysis was anchored to. */
  currentPrice: number;
}
