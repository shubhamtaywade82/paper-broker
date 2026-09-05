import type { AnalysisTimeframe } from '../market/MtfStateEngine.js';
import type { MarketContext, Thesis, ConfluenceGrade, HierarchicalConfluenceBreakdown, ConfluenceFactor } from './types.js';

/**
 * Hierarchical confluence weights (total 100).
 *
 * This is the evolution of the flat "count the signals" ConfluenceScorer
 * into an evidence-quality model: each factor asks a different question,
 * gets a budget proportional to its predictive value, and awards PARTIAL
 * credit for degrees of alignment instead of binary yes/no.
 *
 *   4H regime alignment     15
 *   2H structure            10
 *   1H directional thesis   15
 *   15M structure           15
 *   Liquidity sweep         10
 *   FVG/OB confluence       10
 *   Market location         10
 *   5M trigger              10
 *   R:R                      5
 *   ──────────────────────
 *   Total                  100
 *
 * Grades: 90–100 A+, 80–89 A, 70–79 B, 60–69 C, <60 REJECT.
 */
export const CONFLUENCE_WEIGHTS = {
  HTF_REGIME_4H: 15,
  STRUCTURE_2H: 10,
  THESIS_1H: 15,
  STRUCTURE_15M: 15,
  LIQUIDITY_SWEEP: 10,
  ZONE_CONFLUENCE: 10,
  MARKET_LOCATION: 10,
  TRIGGER_5M: 10,
  RISK_REWARD: 5,
} as const;

export interface HierarchicalConfluenceInput {
  direction: 'LONG' | 'SHORT';
  context: MarketContext;
  thesis: Thesis;
  /** Sweep evidence attached to the candidate (liquidityType as detected). */
  sweep?: {
    liquidityType: 'BSL' | 'SSL' | 'EQUAL_HIGH' | 'EQUAL_LOW';
    timeframe: AnalysisTimeframe;
  } | null;
  /** Candidate has FVG and/or OB zone evidence in its direction. */
  hasDirectionalZone: boolean;
  /** Reward:risk of the candidate's plan (final target basis). */
  rr?: number;
  /** Whether a 5m trigger event (confirmation) has fired. */
  hasTrigger: boolean;
}

export class HierarchicalConfluenceScorer {
  score(input: HierarchicalConfluenceInput): HierarchicalConfluenceBreakdown {
    const { direction, context, thesis } = input;
    const bullish = direction === 'LONG';
    const targetTrend = bullish ? 'BULLISH' : 'BEARISH';

    const factors: ConfluenceFactor[] = [];
    const notes: string[] = [];

    // --- 1. 4H regime alignment (15) --------------------------------------
    const t4h = context.timeframes['4h']?.trend;
    let f4h = 0;
    if (t4h === targetTrend) f4h = CONFLUENCE_WEIGHTS.HTF_REGIME_4H;
    else if (t4h === 'RANGE' || t4h === 'UNKNOWN') f4h = Math.round(CONFLUENCE_WEIGHTS.HTF_REGIME_4H * 0.4);
    // Counter-trend continuation candidates still earn location credit below;
    // here they earn nothing — the macro disagrees.
    factors.push({
      factor: 'HTF_REGIME_4H',
      weight: CONFLUENCE_WEIGHTS.HTF_REGIME_4H,
      awarded: f4h,
      note: `4h regime ${t4h?.toLowerCase() ?? 'unknown'} vs ${bullish ? 'long' : 'short'}`,
    });

    // --- 2. 2H structure (10) ----------------------------------------------
    const t2h = context.timeframes['2h']?.trend;
    let f2h = 0;
    if (t2h === targetTrend) f2h = CONFLUENCE_WEIGHTS.STRUCTURE_2H;
    else if (t2h === 'RANGE' || t2h === 'UNKNOWN') f2h = Math.round(CONFLUENCE_WEIGHTS.STRUCTURE_2H * 0.4);
    else if (isReversalThesis(thesis, direction)) f2h = Math.round(CONFLUENCE_WEIGHTS.STRUCTURE_2H * 0.5);
    factors.push({
      factor: 'STRUCTURE_2H',
      weight: CONFLUENCE_WEIGHTS.STRUCTURE_2H,
      awarded: f2h,
      note: `2h structure ${t2h?.toLowerCase() ?? 'unknown'}${isReversalThesis(thesis, direction) ? ' (reversal archetype: partial credit)' : ''}`,
    });

    // --- 3. 1H directional thesis (15) --------------------------------------
    const thesisMatches =
      (bullish && (thesis.type === 'BULLISH_CONTINUATION' || thesis.type === 'BULLISH_REVERSAL')) ||
      (!bullish && (thesis.type === 'BEARISH_CONTINUATION' || thesis.type === 'BEARISH_REVERSAL'));
    let f1h = 0;
    if (thesisMatches) {
      const t1h = context.timeframes['1h']?.trend;
      f1h = t1h === targetTrend
        ? CONFLUENCE_WEIGHTS.THESIS_1H
        : Math.round(CONFLUENCE_WEIGHTS.THESIS_1H * 0.7); // thesis right, 1h lagging
    } else if (thesis.type === 'TRANSITION') {
      f1h = Math.round(CONFLUENCE_WEIGHTS.THESIS_1H * 0.25);
    }
    factors.push({
      factor: 'THESIS_1H',
      weight: CONFLUENCE_WEIGHTS.THESIS_1H,
      awarded: f1h,
      note: thesisMatches
        ? `1h thesis ${thesis.type} @ ${(thesis.confidence * 100).toFixed(0)}%`
        : `1h thesis ${thesis.type} does not back ${direction}`,
    });

    // --- 4. 15M structure (15) ----------------------------------------------
    const s15 = context.timeframes['15m']?.structure;
    let f15 = 0;
    const ev15 = s15?.lastEvent;
    if (ev15) {
      const evBullish = ev15.endsWith('BULLISH');
      const matchesDirection = bullish ? evBullish : !evBullish;
      const isChoch = ev15.includes('CHOCH');
      const isBos = ev15.includes('BOS');
      const fresh = (s15?.lastEventAgeBars ?? 99) <= 6;

      if (matchesDirection && isChoch) f15 = CONFLUENCE_WEIGHTS.STRUCTURE_15M;
      else if (matchesDirection && isBos) f15 = Math.round(CONFLUENCE_WEIGHTS.STRUCTURE_15M * 0.8);
      else if (matchesDirection) f15 = Math.round(CONFLUENCE_WEIGHTS.STRUCTURE_15M * 0.5);

      if (matchesDirection && !fresh) f15 = Math.round(f15 * 0.8); // stale event
    } else if (s15 && ((bullish && s15.hl) || (!bullish && s15.lh))) {
      f15 = Math.round(CONFLUENCE_WEIGHTS.STRUCTURE_15M * 0.4);
    }
    factors.push({
      factor: 'STRUCTURE_15M',
      weight: CONFLUENCE_WEIGHTS.STRUCTURE_15M,
      awarded: f15,
      note: ev15 ? `15m ${ev15}${(s15?.lastEventAgeBars ?? 0) <= 6 ? ' (fresh)' : ' (stale)'}` : '15m no structure event',
    });

    // --- 5. Liquidity sweep (10) --------------------------------------------
    let fSweep = 0;
    if (input.sweep) {
      const sweepIsSellSide = input.sweep.liquidityType === 'SSL' || input.sweep.liquidityType === 'EQUAL_LOW';
      const sweepMatches = bullish ? sweepIsSellSide : !sweepIsSellSide;
      const sweepTfWeight = context.timeframes[input.sweep.timeframe] ? 1 : 0.7;
      if (sweepMatches) {
        fSweep = Math.round(CONFLUENCE_WEIGHTS.LIQUIDITY_SWEEP * (sweepTfWeight * 0.4 + 0.6));
      } else {
        // Wrong-side sweep is actively negative context but not double-punished.
        fSweep = 0;
        notes.push('Sweep evidence is on the wrong side of the candidate');
      }
    }
    factors.push({
      factor: 'LIQUIDITY_SWEEP',
      weight: CONFLUENCE_WEIGHTS.LIQUIDITY_SWEEP,
      awarded: fSweep,
      note: input.sweep ? `${input.sweep.liquidityType} sweep on ${input.sweep.timeframe}` : 'no sweep evidence',
    });

    // --- 6. FVG/OB confluence (10) ------------------------------------------
    let fZone = 0;
    if (input.hasDirectionalZone) {
      const nearby = context.zones.filter(
        (z) =>
          (z.direction === (bullish ? 'BULLISH' : 'BEARISH') || z.direction === 'NEUTRAL') &&
          z.status !== 'BROKEN'
      );
      const best = nearby[0]?.strength ?? 50;
      fZone = Math.round(CONFLUENCE_WEIGHTS.ZONE_CONFLUENCE * (0.5 + (best / 100) * 0.5));
    }
    factors.push({
      factor: 'ZONE_CONFLUENCE',
      weight: CONFLUENCE_WEIGHTS.ZONE_CONFLUENCE,
      awarded: fZone,
      note: input.hasDirectionalZone ? 'directional FVG/OB zone present' : 'no directional zone',
    });

    // --- 7. Market location (10) --------------------------------------------
    const pos = context.location.position;
    const rangePos = context.location.rangePosition;
    let fLoc = 0;
    if (bullish) {
      if (pos === 'DEEP_DISCOUNT') fLoc = CONFLUENCE_WEIGHTS.MARKET_LOCATION;
      else if (pos === 'DISCOUNT') fLoc = Math.round(CONFLUENCE_WEIGHTS.MARKET_LOCATION * 0.8);
      else if (pos === 'EQUILIBRIUM') fLoc = Math.round(CONFLUENCE_WEIGHTS.MARKET_LOCATION * 0.5);
      else if (pos === 'PREMIUM') fLoc = Math.round(CONFLUENCE_WEIGHTS.MARKET_LOCATION * 0.25);
      // DEEP_PREMIUM long: 0 — the location actively argues against it.
    } else {
      if (pos === 'DEEP_PREMIUM') fLoc = CONFLUENCE_WEIGHTS.MARKET_LOCATION;
      else if (pos === 'PREMIUM') fLoc = Math.round(CONFLUENCE_WEIGHTS.MARKET_LOCATION * 0.8);
      else if (pos === 'EQUILIBRIUM') fLoc = Math.round(CONFLUENCE_WEIGHTS.MARKET_LOCATION * 0.5);
      else if (pos === 'DISCOUNT') fLoc = Math.round(CONFLUENCE_WEIGHTS.MARKET_LOCATION * 0.25);
    }
    factors.push({
      factor: 'MARKET_LOCATION',
      weight: CONFLUENCE_WEIGHTS.MARKET_LOCATION,
      awarded: fLoc,
      note: `${pos.toLowerCase()} (${(rangePos * 100).toFixed(0)}% of ${context.location.range.timeframe} range)`,
    });

    // --- 8. 5M trigger (10) ---------------------------------------------------
    const fTrig = input.hasTrigger ? CONFLUENCE_WEIGHTS.TRIGGER_5M : 0;
    factors.push({
      factor: 'TRIGGER_5M',
      weight: CONFLUENCE_WEIGHTS.TRIGGER_5M,
      awarded: fTrig,
      note: input.hasTrigger ? '5m trigger confirmed' : '5m trigger pending',
    });

    // --- 9. R:R (5) ------------------------------------------------------------
    const rr = input.rr ?? 0;
    let fRr = 0;
    if (rr >= 3.5) fRr = CONFLUENCE_WEIGHTS.RISK_REWARD;
    else if (rr >= 2.5) fRr = Math.round(CONFLUENCE_WEIGHTS.RISK_REWARD * 0.8);
    else if (rr >= 1.8) fRr = Math.round(CONFLUENCE_WEIGHTS.RISK_REWARD * 0.6);
    else if (rr >= 1.2) fRr = Math.round(CONFLUENCE_WEIGHTS.RISK_REWARD * 0.3);
    factors.push({
      factor: 'RISK_REWARD',
      weight: CONFLUENCE_WEIGHTS.RISK_REWARD,
      awarded: fRr,
      note: `R:R ${rr ? rr.toFixed(2) : 'n/a'}`,
    });

    const totalScore = factors.reduce((s, f) => s + f.awarded, 0);
    const grade = gradeFor(totalScore);

    return { factors, totalScore, maxScore: 100, grade, notes };
  }
}

export function gradeFor(score: number): ConfluenceGrade {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'REJECT';
}

export function isReversalThesis(thesis: Thesis, direction: 'LONG' | 'SHORT'): boolean {
  return direction === 'LONG'
    ? thesis.type === 'BULLISH_REVERSAL'
    : thesis.type === 'BEARISH_REVERSAL';
}
