import { CANONICAL_TIMEFRAMES, type AnalysisTimeframe } from '../market/MtfStateEngine.js';
import type { MarketContext, Thesis, ThesisType, Evidence } from './types.js';

export interface ThesisEngineConfig {
  /** Minimum bias score (0..1) for a directional thesis to be declared. */
  minBiasForDirection: number;
  /** Sweep recency window that still supports a reversal thesis (ms). */
  reversalSweepWindowMs: number;
}

export const DEFAULT_THESIS_CONFIG: ThesisEngineConfig = {
  minBiasForDirection: 0.55,
  reversalSweepWindowMs: 6 * 3_600_000,
};

/**
 * Thesis Engine — transforms the MarketContext measurements into the
 * hierarchical directional thesis: the machine equivalent of reading a chart
 * top-down and declaring "4H bullish, 2H bullish recovery, 1H bullish, 15M
 * BOS, 5M retest → BULLISH_CONTINUATION, confidence 0.84".
 *
 * Deterministic rules over structured facts — no candle reading, no LLM.
 */
export class ThesisEngine {
  private config: ThesisEngineConfig;

  constructor(config: ThesisEngineConfig = DEFAULT_THESIS_CONFIG) {
    this.config = config;
  }

  deriveThesis(context: MarketContext): Thesis {
    const { structure, location, liquidity, regime } = context;

    const reasoning = {} as Record<AnalysisTimeframe, string>;
    for (const tf of CANONICAL_TIMEFRAMES) {
      reasoning[tf] = this.describeTimeframe(context, tf);
    }

    const type = this.classifyThesisType(context);
    const confidence = this.confidenceFor(type, context);

    const rationale: Evidence[] = [];

    // Structural alignment evidence (biggest driver).
    for (const tf of CANONICAL_TIMEFRAMES) {
      const trend = structure.trends[tf];
      if (trend === 'BULLISH' || trend === 'BEARISH') {
        const supports = type.startsWith(trend === 'BULLISH' ? 'BULLISH' : 'BEARISH');
        rationale.push({
          source: 'STRUCTURE',
          timeframe: tf,
          statement: `${tf} structure is ${trend.toLowerCase()}${reasoning[tf] ? ` — ${reasoning[tf]}` : ''}`,
          weight: supports ? 0.7 : 0.3,
        });
      }
    }

    // Location coherence.
    const longLocationFit =
      location.position === 'DEEP_DISCOUNT' || location.position === 'DISCOUNT';
    const shortLocationFit =
      location.position === 'DEEP_PREMIUM' || location.position === 'PREMIUM';
    if (type === 'BULLISH_CONTINUATION' || type === 'BULLISH_REVERSAL') {
      rationale.push({
        source: 'LOCATION',
        timeframe: 'composite',
        statement: `Price at ${location.position.toLowerCase()} of the ${location.range.timeframe} dealing range (${(location.rangePosition * 100).toFixed(0)}%)`,
        weight: longLocationFit ? 0.8 : 0.4,
      });
    } else if (type === 'BEARISH_CONTINUATION' || type === 'BEARISH_REVERSAL') {
      rationale.push({
        source: 'LOCATION',
        timeframe: 'composite',
        statement: `Price at ${location.position.toLowerCase()} of the ${location.range.timeframe} dealing range (${(location.rangePosition * 100).toFixed(0)}%)`,
        weight: shortLocationFit ? 0.8 : 0.4,
      });
    }

    // Liquidity narrative.
    if (liquidity.recentlySwept.length > 0) {
      const lastSweep = liquidity.recentlySwept[0]!;
      const bullishSweep = lastSweep.side === 'SELL_SIDE'; // SSL swept → bullish fuel
      rationale.push({
        source: 'LIQUIDITY',
        timeframe: lastSweep.timeframe,
        statement: `${lastSweep.side === 'SELL_SIDE' ? 'Sell-side' : 'Buy-side'} liquidity swept at ${lastSweep.price} (${lastSweep.timeframe}, recent)`,
        weight: bullishSweep && type.startsWith('BULLISH') ? 0.9 : !bullishSweep && type.startsWith('BEARISH') ? 0.9 : 0.5,
      });
    }
    if (liquidity.nearestAbove) {
      rationale.push({
        source: 'LIQUIDITY',
        timeframe: liquidity.nearestAbove.timeframe,
        statement: `Buy-side liquidity resting at ${liquidity.nearestAbove.price} (+${context.location.liquidityDistance.upside.toFixed(2)}%)`,
        weight: type.startsWith('BULLISH') ? 0.6 : 0.4,
      });
    }
    if (liquidity.nearestBelow) {
      rationale.push({
        source: 'LIQUIDITY',
        timeframe: liquidity.nearestBelow.timeframe,
        statement: `Sell-side liquidity resting at ${liquidity.nearestBelow.price} (-${context.location.liquidityDistance.downside.toFixed(2)}%)`,
        weight: type.startsWith('BEARISH') ? 0.6 : 0.4,
      });
    }

    // Regime note.
    rationale.push({
      source: 'REGIME',
      timeframe: 'composite',
      statement: `Primary regime ${regime.primary.toLowerCase()} (confidence ${(regime.confidence * 100).toFixed(0)}%)${regime.behavioral ? `, behavioral: ${regime.behavioral.toLowerCase().replace(/_/g, ' ')}` : ''}`,
      weight: regime.confidence,
    });

    return {
      type,
      confidence,
      reasoning,
      rationale: rationale.sort((a, b) => b.weight - a.weight),
    };
  }

  // -------------------------------------------------------------------------
  // Classification rules
  // -------------------------------------------------------------------------

  private classifyThesisType(context: MarketContext): ThesisType {
    const { structure, directionalBias, location, liquidity } = context;

    const htf = structure.trends['4h'];
    const mid = structure.trends['2h'];
    const thesis = structure.trends['1h'];
    const setup = structure.trends['15m'];
    const trigger = structure.trends['5m'];

    // Fully stacked — every timeframe agrees: pure continuation.
    if (structure.fullyStacked && (directionalBias.final === 'LONG' || directionalBias.final === 'SHORT')) {
      return directionalBias.final === 'LONG' ? 'BULLISH_CONTINUATION' : 'BEARISH_CONTINUATION';
    }

    // HTF trend intact + majority agreement: continuation with lower conviction.
    if (htf === 'BULLISH' && directionalBias.long >= this.config.minBiasForDirection && directionalBias.long > directionalBias.short) {
      // Bullish HTF + LTF fresh bearish CHOCH at premium → correction / reversal in progress.
      if (this.isFreshLtfBearishFlip(context) && location.rangePosition > 0.6) {
        return 'BEARISH_REVERSAL';
      }
      return 'BULLISH_CONTINUATION';
    }
    if (htf === 'BEARISH' && directionalBias.short >= this.config.minBiasForDirection && directionalBias.short > directionalBias.long) {
      if (this.isFreshLtfBullishFlip(context) && location.rangePosition < 0.4) {
        return 'BULLISH_REVERSAL';
      }
      return 'BEARISH_CONTINUATION';
    }

    // HTF bullish but mid/thesis broken down heavily — HTF correction.
    if (htf === 'BULLISH' && this.isFreshLtfBearishFlip(context)) {
      return location.rangePosition > 0.6 ? 'BEARISH_REVERSAL' : 'TRANSITION';
    }
    if (htf === 'BEARISH' && this.isFreshLtfBullishFlip(context)) {
      return location.rangePosition < 0.4 ? 'BULLISH_REVERSAL' : 'TRANSITION';
    }

    // Range conditions: HTF ranging, or balanced bias inside a defined range.
    if (htf === 'RANGE' && mid === 'RANGE') return 'RANGE';
    if (
      Math.abs(directionalBias.long - directionalBias.short) < 0.15 &&
      location.range.high / location.range.low - 1 < 0.15
    ) {
      return 'RANGE';
    }

    // Everything else: conflicting evidence, insufficient data or churn.
    if (this.hasInsufficientData(context)) return 'NO_CLEAR_THESIS';
    if (regimeTransitionLikely(structure.trends)) return 'TRANSITION';

    void thesis; void setup; void trigger; void liquidity;
    return 'NO_CLEAR_THESIS';
  }

  private isFreshLtfBearishFlip(context: MarketContext): boolean {
    const ev = context.timeframes['15m']?.structure;
    if (!ev) return false;
    const isBearishChoch =
      ev.lastEvent === 'CHOCH_BEARISH' || ev.lastEvent === 'BOS_BEARISH';
    if (!isBearishChoch) return false;
    if (ev.lastEventAgeBars === undefined) return true;
    return ev.lastEventAgeBars <= 4;
  }

  private isFreshLtfBullishFlip(context: MarketContext): boolean {
    const ev = context.timeframes['15m']?.structure;
    if (!ev) return false;
    const isBullishFlip =
      ev.lastEvent === 'CHOCH_BULLISH' || ev.lastEvent === 'BOS_BULLISH';
    if (!isBullishFlip) return false;
    if (ev.lastEventAgeBars === undefined) return true;
    return ev.lastEventAgeBars <= 4;
  }

  private hasInsufficientData(context: MarketContext): boolean {
    // Need at least the 1h layer for any real thesis.
    const critical: AnalysisTimeframe[] = ['1h', '15m'];
    return critical.some((tf) => (context.timeframes[tf]?.candleCount ?? 0) < 10);
  }

  // -------------------------------------------------------------------------
  // Confidence + description
  // -------------------------------------------------------------------------

  private confidenceFor(type: ThesisType, context: MarketContext): number {
    if (type === 'NO_CLEAR_THESIS') return 0.2;
    if (type === 'TRANSITION') return 0.3;

    let c = 0.35;

    // Structural breadth.
    c += context.structure.alignedCount * 0.09;
    if (context.structure.fullyStacked) c += 0.08;

    // Bias sharpness.
    if (type.startsWith('BULLISH')) c += context.directionalBias.long * 0.25;
    else if (type.startsWith('BEARISH')) c += context.directionalBias.short * 0.25;
    else c += context.directionalBias.neutral * 0.1;

    // Location fit.
    const longFit = context.location.rangePosition < 0.45;
    const shortFit = context.location.rangePosition > 0.55;
    if (type.startsWith('BULLISH') && longFit) c += 0.08;
    if (type.startsWith('BEARISH') && shortFit) c += 0.08;
    // Continuation at the wrong extreme of the range is riskier.
    if (type === 'BULLISH_CONTINUATION' && context.location.rangePosition > 0.8) c -= 0.12;
    if (type === 'BEARISH_CONTINUATION' && context.location.rangePosition < 0.2) c -= 0.12;

    // Liquidity fit: swept-into-direction is strong fuel.
    const swept = context.liquidity.recentlySwept[0];
    if (swept) {
      if (type.startsWith('BULLISH') && swept.side === 'SELL_SIDE') c += 0.08;
      else if (type.startsWith('BEARISH') && swept.side === 'BUY_SIDE') c += 0.08;
    }

    return Math.max(0.05, Math.min(0.97, round3(c)));
  }

  private describeTimeframe(context: MarketContext, tf: AnalysisTimeframe): string {
    const ctx = context.timeframes[tf];
    if (!ctx || ctx.candleCount === 0) return 'no data';

    const trendWord =
      ctx.trend === 'BULLISH' ? 'bullish' :
      ctx.trend === 'BEARISH' ? 'bearish' :
      ctx.trend === 'RANGE' ? 'ranging' : 'unknown';

    const parts: string[] = [`${trendWord} structure`];

    if (ctx.structure.hh && ctx.structure.hl) parts.push('HH+HL');
    else if (ctx.structure.lh && ctx.structure.ll) parts.push('LH+LL');

    if (ctx.structure.lastEvent) {
      const eventName = ctx.structure.lastEvent
        .replace('CHOCH_', 'CHOCH ')
        .replace('BOS_', 'BOS ')
        .toLowerCase();
      const age = ctx.structure.lastEventAgeBars;
      parts.push(`last event ${eventName}${age !== undefined ? ` (${age} bars ago)` : ''}`);
    }

    if (ctx.liquidity.recentSweeps.length > 0) {
      const sw = ctx.liquidity.recentSweeps[0]!;
      parts.push(`${sw.side === 'SELL_SIDE' ? 'SSL' : 'BSL'} swept @ ${sw.price}`);
    }

    const pos = ctx.position.relativeToRange.toLowerCase();
    parts.push(`price in ${pos}`);

    return parts.join(', ');
  }
}

function regimeTransitionLikely(trends: Record<AnalysisTimeframe, string | undefined>): boolean {
  const real = CANONICAL_TIMEFRAMES.map((tf) => trends[tf]).filter(
    (t): t is 'BULLISH' | 'BEARISH' | 'RANGE' => t === 'BULLISH' || t === 'BEARISH' || t === 'RANGE'
  );
  if (real.length < 3) return false;
  const uniq = new Set(real);
  return uniq.size >= 3;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
