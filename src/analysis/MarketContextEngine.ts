import {
  CANONICAL_TIMEFRAMES,
  TIMEFRAME_MS,
  TIMEFRAME_ROLES,
  type AnalysisTimeframe,
} from '../market/MtfStateEngine.js';
import type { MarketStructureEngine } from '../market/structure/MarketStructureEngine.js';
import type { ConfirmedSwing, MarketTrend, MultiTimeframeStructureState } from '../market/structure/types.js';
import type { SmcLocationEngine } from '../market/smc/SmcLocationEngine.js';
import type { MtfStateEngine, MultiTimeframeState } from '../market/MtfStateEngine.js';
import type { LiquidityMapEngine } from '../market/liquidity/LiquidityMapEngine.js';
import { atr } from '../strategy/indicators.js';
import type { MarketRegimeDetector } from './MarketRegimeDetector.js';
import type { MarketLocationEngine } from './MarketLocationEngine.js';
import type { ZoneAggregationEngine } from './ZoneAggregationEngine.js';
import type {
  ConfluenceZone,
  DirectionalBias,
  Direction,
  LiquidityMap,
  MarketContext,
  PriceLevel,
  RegimeState,
  StructureAlignmentSummary,
  TimeframeContext,
  TimeframePosition,
  TimeframeStructureSummary,
  VolatilityState,
} from './types.js';

/**
 * Per-timeframe vote weight for the directional bias. Matches the role
 * hierarchy: the 4h regime votes loudest, the 5m trigger least.
 */
const BIAS_WEIGHT: Record<AnalysisTimeframe, number> = {
  '4h': 0.3,
  '2h': 0.2,
  '1h': 0.25,
  '15m': 0.15,
  '5m': 0.1,
};

export interface MarketContextEngineDeps {
  mtfEngine: MtfStateEngine;
  structureEngine: MarketStructureEngine;
  smcEngine: SmcLocationEngine;
  liquidityMapEngine: LiquidityMapEngine;
  zoneAggregationEngine: ZoneAggregationEngine;
  locationEngine: MarketLocationEngine;
  /** Optional behavioral regime detector (volatility/ADX classification). */
  regimeDetector?: MarketRegimeDetector;
}

/**
 * Market Context Engine — the "understanding" layer between the raw market
 * engines and trade execution.
 *
 * It answers: "what is the market doing before we decide whether there is a
 * trade?" — regime, per-timeframe structure/liquidity/zones/position,
 * directional bias, volatility and HTF location — as ONE deterministic
 * object. Everything downstream (thesis, scenarios, confluence, LLM
 * synthesis) reads from this instead of re-deriving facts from candles.
 */
export class MarketContextEngine {
  private deps: MarketContextEngineDeps;

  constructor(deps: MarketContextEngineDeps) {
    this.deps = deps;
  }

  computeContext(symbol: string, asOf = Date.now()): MarketContext {
    const mtf = this.deps.mtfEngine.computeState(symbol, asOf);
    const structure = this.deps.structureEngine.computeMultiTimeframeStructure(symbol, asOf);
    const smc = this.deps.smcEngine.computeMultiTimeframeSmcContext(symbol, asOf);

    const currentPrice = this.currentPrice(mtf, symbol);

    // 1. Zones first (needed by location), then range + liquidity map.
    const zones = this.deps.zoneAggregationEngine.aggregateZones(smc, asOf);
    const rangeHint = this.deriveRangeFromStructure(structure, currentPrice);
    const provisionalLocation = this.deps.locationEngine.computeLocation(
      structure,
      zones,
      null,
      currentPrice,
      rangeHint
    );
    const liquidity = this.deps.liquidityMapEngine.buildLiquidityMap(
      smc,
      currentPrice,
      asOf,
      provisionalLocation.range
    );
    const location = this.deps.locationEngine.computeLocation(
      structure,
      zones,
      liquidity,
      currentPrice,
      rangeHint
    );

    // 2. Per-timeframe contexts.
    const timeframes = {} as Record<AnalysisTimeframe, TimeframeContext>;
    for (const tf of CANONICAL_TIMEFRAMES) {
      timeframes[tf] = this.buildTimeframeContext(
        tf,
        mtf,
        structure,
        smc,
        liquidity,
        asOf
      );
    }

    // 3. Cross-timeframe synthesis.
    const structureSummary = this.summarizeStructure(structure, timeframes);
    const bias = this.computeDirectionalBias(timeframes, location.rangePosition);
    const regime = this.deriveRegime(timeframes, structureSummary, location, mtf, symbol, asOf);
    const volatility = this.assessVolatility(mtf);

    return {
      symbol,
      asOf,
      currentPrice,
      regime,
      timeframes,
      directionalBias: bias,
      structure: structureSummary,
      liquidity,
      zones,
      volatility,
      location,
      nearestLevels: this.buildNearestLevels(location, liquidity, zones, currentPrice),
    };
  }

  // -------------------------------------------------------------------------
  // Per-timeframe context
  // -------------------------------------------------------------------------

  private buildTimeframeContext(
    tf: AnalysisTimeframe,
    mtf: MultiTimeframeState,
    structure: MultiTimeframeStructureState,
    smcCtx: ReturnType<SmcLocationEngine['computeMultiTimeframeSmcContext']>,
    liquidity: LiquidityMap,
    asOf: number
  ): TimeframeContext {
    const s = structure.timeframes[tf];
    const smc = smcCtx.timeframes[tf];
    const tfState = mtf.timeframes[tf];
    const candles = tfState?.closedCandles ?? [];

    const structureSummary = this.timeframeStructureSummary(s?.swings ?? [], s, tf, candles.length, asOf);
    const position = this.timeframePosition(candles, s, asOf);

    const tfZones = this.deps.zoneAggregationEngine.buildTimeframeZones(smc, asOf);

    return {
      timeframe: tf,
      role: TIMEFRAME_ROLES[tf],
      trend: s?.trend ?? 'UNKNOWN',
      lastSwingHigh: s?.lastConfirmedSwingHigh?.price,
      lastSwingLow: s?.lastConfirmedSwingLow?.price,
      structure: structureSummary,
      liquidity: {
        buySide: liquidity.buySide.filter((p) => p.timeframe === tf),
        sellSide: liquidity.sellSide.filter((p) => p.timeframe === tf),
        recentSweeps: liquidity.recentlySwept.filter((sw) => sw.timeframe === tf),
      },
      zones: {
        bullishFvg: tfZones.filter((z) => z.type === 'FVG' && z.direction === 'BULLISH'),
        bearishFvg: tfZones.filter((z) => z.type === 'FVG' && z.direction === 'BEARISH'),
        bullishOb: tfZones.filter((z) => z.type === 'ORDER_BLOCK' && z.direction === 'BULLISH'),
        bearishOb: tfZones.filter((z) => z.type === 'ORDER_BLOCK' && z.direction === 'BEARISH'),
      },
      position,
      candleCount: candles.length,
    };
  }

  private timeframeStructureSummary(
    swings: ConfirmedSwing[],
    s: ReturnType<MarketStructureEngine['getStructureAsOf']> | undefined,
    tf: AnalysisTimeframe,
    candleCount: number,
    asOf: number
  ): TimeframeStructureSummary {
    const recentHighs = swings.filter((x) => x.type === 'HIGH').slice(-2);
    const recentLows = swings.filter((x) => x.type === 'LOW').slice(-2);

    const hh = recentHighs.length === 2 && recentHighs[1]!.price > recentHighs[0]!.price;
    const hl = recentLows.length === 2 && recentLows[1]!.price > recentLows[0]!.price;
    const lh = recentHighs.length === 2 && recentHighs[1]!.price < recentHighs[0]!.price;
    const ll = recentLows.length === 2 && recentLows[1]!.price < recentLows[0]!.price;

    const lastEvent = s?.events[s.events.length - 1];
    const lastEventType = lastEvent?.eventType;

    // Age = how many candles of this TF have closed since the event was
    // confirmed. Deterministic: floor(elapsed / interval), clamped to the
    // candle window we actually have.
    let lastEventAgeBars: number | undefined;
    if (lastEvent) {
      const intervalMs = TIMEFRAME_MS[tf];
      const elapsed = Math.max(0, asOf - lastEvent.confirmationTime);
      lastEventAgeBars = Math.min(candleCount, Math.floor(elapsed / intervalMs));
    }

    const eventDirection: Direction | undefined =
      lastEventType?.endsWith('BULLISH') ? 'BULLISH' :
      lastEventType?.endsWith('BEARISH') ? 'BEARISH' : undefined;

    return { hh, hl, lh, ll, lastEvent: lastEventType, eventDirection, lastEventAgeBars };
  }

  private timeframePosition(
    candles: Array<{ high: number; low: number; close: number }>,
    s: ReturnType<MarketStructureEngine['getStructureAsOf']> | undefined,
    _asOf: number
  ): TimeframePosition {
    const recent = candles.slice(-30);
    if (recent.length === 0) {
      return {
        relativeToRange: 'EQUILIBRIUM',
        rangePosition: 0.5,
        distanceToHighPct: Number.NaN,
        distanceToLowPct: Number.NaN,
      };
    }

    const swingHigh = s?.lastConfirmedSwingHigh?.price;
    const swingLow = s?.lastConfirmedSwingLow?.price;
    const windowHigh = Math.max(...recent.map((c) => c.high));
    const windowLow = Math.min(...recent.map((c) => c.low));
    const price = recent[recent.length - 1]!.close;

    // Prefer structure swings when they bracket the window; else window range.
    const high = typeof swingHigh === 'number' && swingHigh >= windowHigh ? swingHigh : windowHigh;
    const low = typeof swingLow === 'number' && swingLow <= windowLow ? swingLow : windowLow;
    const span = high - low;
    const rangePosition = span > 0 ? (price - low) / span : 0.5;

    return {
      relativeToRange:
        rangePosition < 0.4 ? 'DISCOUNT' : rangePosition > 0.6 ? 'PREMIUM' : 'EQUILIBRIUM',
      rangePosition,
      distanceToHighPct: ((high - price) / price) * 100,
      distanceToLowPct: ((price - low) / price) * 100,
    };
  }

  // -------------------------------------------------------------------------
  // Cross-timeframe synthesis
  // -------------------------------------------------------------------------

  private summarizeStructure(
    structure: MultiTimeframeStructureState,
    timeframes: Record<AnalysisTimeframe, TimeframeContext>
  ): StructureAlignmentSummary {
    const trends = {} as StructureAlignmentSummary['trends'];
    const lastEvents = {} as StructureAlignmentSummary['lastEvents'];
    for (const tf of CANONICAL_TIMEFRAMES) {
      trends[tf] = structure.timeframes[tf]?.trend;
      lastEvents[tf] = timeframes[tf]?.structure.lastEvent;
    }

    const bullVotes = CANONICAL_TIMEFRAMES.filter((tf) => trends[tf] === 'BULLISH').length;
    const bearVotes = CANONICAL_TIMEFRAMES.filter((tf) => trends[tf] === 'BEARISH').length;
    const net: Direction = bullVotes >= bearVotes ? 'BULLISH' : 'BEARISH';

    const alignedCount = CANONICAL_TIMEFRAMES.filter((tf) => trends[tf] === net).length;
    const conflicting = CANONICAL_TIMEFRAMES.filter(
      (tf) => trends[tf] && trends[tf] !== net && trends[tf] !== 'UNKNOWN'
    );
    const fullyStacked = alignedCount === CANONICAL_TIMEFRAMES.length;

    return { trends, alignedCount, conflicting, fullyStacked, lastEvents };
  }

  private computeDirectionalBias(
    timeframes: Record<AnalysisTimeframe, TimeframeContext>,
    rangePosition: number
  ): DirectionalBias {
    let long = 0;
    let short = 0;
    let neutral = 0;

    for (const tf of CANONICAL_TIMEFRAMES) {
      const ctx = timeframes[tf];
      const w = BIAS_WEIGHT[tf];
      const trend = ctx?.trend ?? 'UNKNOWN';

      if (trend === 'BULLISH') long += w;
      else if (trend === 'BEARISH') short += w;
      else neutral += w * 0.6;

      // Last structure event nudges its timeframe's vote.
      const evDir = ctx?.structure.eventDirection;
      const eventBonus = w * 0.25;
      if (evDir === 'BULLISH') long += eventBonus;
      else if (evDir === 'BEARISH') short += eventBonus;

      // HTF discount/premium tilts the bias slightly (mean reversion pull).
      if (tf === '4h') {
        if (rangePosition < 0.35) long += 0.05;
        else if (rangePosition > 0.65) short += 0.05;
      }
    }

    const total = long + short + neutral || 1;
    const longScore = long / total;
    const shortScore = short / total;
    const neutralScore = neutral / total;

    const final: DirectionalBias['final'] =
      longScore >= 0.55 && longScore > shortScore * 1.5
        ? 'LONG'
        : shortScore >= 0.55 && shortScore > longScore * 1.5
          ? 'SHORT'
          : 'NEUTRAL';

    return { long: round3(longScore), short: round3(shortScore), neutral: round3(neutralScore), final };
  }

  private deriveRegime(
    timeframes: Record<AnalysisTimeframe, TimeframeContext>,
    structure: StructureAlignmentSummary,
    location: ReturnType<MarketLocationEngine['computeLocation']>,
    mtf: MultiTimeframeState,
    symbol: string,
    asOf: number
  ): RegimeState {
    const htf = timeframes['4h']?.trend ?? 'UNKNOWN';
    const mid = timeframes['2h']?.trend ?? 'UNKNOWN';
    const ltf = timeframes['1h']?.trend ?? 'UNKNOWN';

    let primary: RegimeState['primary'];
    if (htf === 'RANGE' || (htf === 'UNKNOWN' && mid === 'RANGE')) {
      primary = 'RANGE';
    } else if (htf === mid && mid === ltf && (htf === 'BULLISH' || htf === 'BEARISH')) {
      primary = htf;
    } else if (
      (htf === 'BULLISH' || htf === 'BEARISH') &&
      (mid === htf || ltf === htf)
    ) {
      // HTF trend intact, at least one lower TF confirms → still the regime,
      // the other TF is a pullback within it.
      primary = htf;
    } else {
      primary = 'TRANSITION';
    }

    // Confidence: breadth of structural agreement + location coherence.
    let confidence = 0.3;
    confidence += structure.alignedCount * 0.12;
    if (structure.fullyStacked) confidence += 0.1;
    if (primary !== 'TRANSITION' && structure.trends['4h'] === primary) confidence += 0.08;
    if (primary === 'TRANSITION') confidence -= 0.1;

    const behavioral = this.deps.regimeDetector?.detect(symbol, mtf, asOf)?.regime ?? null;

    return {
      primary,
      confidence: Math.max(0, Math.min(1, round3(confidence))),
      behavioral,
    };
  }

  private assessVolatility(mtf: MultiTimeframeState): VolatilityState {
    const candles = mtf.timeframes['1h']?.closedCandles ?? [];
    if (candles.length < 20) {
      return { label: 'MODERATE', atr1h: Number.NaN, atrPct: Number.NaN, expansionRatio: Number.NaN };
    }

    const atrSeries = atr(candles, 14);
    const lastIdx = candles.length - 1;
    const raw = atrSeries[lastIdx];
    const atrVal = Number.isFinite(raw) && raw! > 0 ? raw! : 0;
    const price = candles[lastIdx]!.close;
    const atrPct = price > 0 ? (atrVal / price) * 100 : Number.NaN;

    // Expansion ratio vs median of the last 50 computable ATR values.
    const finite = atrSeries.filter((v) => Number.isFinite(v) && v! > 0) as number[];
    const window = finite.slice(-50);
    const median = window.length ? medianOf(window) : atrVal;
    const expansionRatio = median > 0 ? atrVal / median : Number.NaN;

    let label: VolatilityState['label'] = 'MODERATE';
    if (Number.isFinite(atrPct)) {
      if (atrPct < 0.25) label = 'LOW';
      else if (atrPct < 0.8) label = 'MODERATE';
      else if (atrPct < 1.8) label = 'ELEVATED';
      else label = 'EXTREME';
    }

    return { label, atr1h: atrVal, atrPct: round3(atrPct), expansionRatio: round3(expansionRatio) };
  }

  private buildNearestLevels(
    location: ReturnType<MarketLocationEngine['computeLocation']>,
    liquidity: LiquidityMap,
    zones: ConfluenceZone[],
    currentPrice: number
  ): PriceLevel[] {
    const levels: PriceLevel[] = [];
    const dist = (p: number) => (Math.abs(p - currentPrice) / currentPrice) * 100;

    if (liquidity.nearestAbove) {
      levels.push({
        price: liquidity.nearestAbove.price,
        label: `Nearest buy-side liquidity (${liquidity.nearestAbove.timeframe})`,
        timeframe: liquidity.nearestAbove.timeframe,
        kind: 'LIQUIDITY',
        distancePct: round3(dist(liquidity.nearestAbove.price)),
      });
    }
    if (liquidity.nearestBelow) {
      levels.push({
        price: liquidity.nearestBelow.price,
        label: `Nearest sell-side liquidity (${liquidity.nearestBelow.timeframe})`,
        timeframe: liquidity.nearestBelow.timeframe,
        kind: 'LIQUIDITY',
        distancePct: round3(dist(liquidity.nearestBelow.price)),
      });
    }

    levels.push({
      price: location.range.high,
      label: `Dealing range high (${location.range.timeframe})`,
      timeframe: location.range.timeframe,
      kind: 'RANGE_HIGH',
      distancePct: round3(dist(location.range.high)),
    });
    levels.push({
      price: location.range.low,
      label: `Dealing range low (${location.range.timeframe})`,
      timeframe: location.range.timeframe,
      kind: 'RANGE_LOW',
      distancePct: round3(dist(location.range.low)),
    });
    levels.push({
      price: location.range.equilibrium,
      label: `Range equilibrium (${location.range.timeframe})`,
      timeframe: location.range.timeframe,
      kind: 'EQUILIBRIUM',
      distancePct: round3(dist(location.range.equilibrium)),
    });

    for (const z of zones.slice(0, 4)) {
      const edge = z.low > currentPrice ? z.low : z.high < currentPrice ? z.high : z.midpoint;
      levels.push({
        price: edge,
        label: `${z.direction === 'BULLISH' ? 'Demand' : z.direction === 'BEARISH' ? 'Supply' : 'Mixed'} zone (${z.dominantTimeframe}, str ${z.strength})`,
        timeframe: z.dominantTimeframe,
        kind: 'ZONE_EDGE',
        distancePct: round3(dist(edge)),
      });
    }

    return levels.sort((a, b) => a.distancePct - b.distancePct).slice(0, 10);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private currentPrice(mtf: MultiTimeframeState, _symbol: string): number {
    // Lowest-timeframe close that actually has data — 5m → 15m → 1h → 2h → 4h.
    for (const tf of [...CANONICAL_TIMEFRAMES].reverse()) {
      const last = mtf.timeframes[tf]?.lastClosedCandle;
      if (last) return last.close;
    }
    return 0;
  }

  private deriveRangeFromStructure(
    structure: MultiTimeframeStructureState,
    currentPrice: number
  ): { high: number; low: number; timeframe: AnalysisTimeframe } {
    return this.deps.locationEngine.deriveRange(structure, currentPrice);
  }
}

function round3(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

// Re-exported for downstream consumers that want the trend type without
// importing the structure module directly.
export type { MarketTrend };
