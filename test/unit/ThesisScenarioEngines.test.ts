import { describe, it, expect } from 'vitest';
import { ThesisEngine } from '../../src/analysis/ThesisEngine.js';
import { ScenarioEngine } from '../../src/analysis/ScenarioEngine.js';
import { makeBullishContext, makeZone, makePool, makeLiquidityMap } from './helpers/analysisFixtures.js';

// ---------------------------------------------------------------------------
// ThesisEngine
// ---------------------------------------------------------------------------

describe('ThesisEngine', () => {
  const engine = new ThesisEngine();

  it('classifies a fully-stacked bullish market as BULLISH_CONTINUATION', () => {
    const context = makeBullishContext();
    const thesis = engine.deriveThesis(context);

    expect(thesis.type).toBe('BULLISH_CONTINUATION');
    expect(thesis.confidence).toBeGreaterThan(0.7);
    // Reasoning exists for every canonical timeframe (incl. 2h).
    expect(Object.keys(thesis.reasoning).sort()).toEqual(['15m', '2h', '4h', '5m', '1h'].sort());
    expect(thesis.reasoning['2h']).toContain('bullish');
    // Evidence is sorted strongest-first.
    for (let i = 1; i < thesis.rationale.length; i++) {
      expect(thesis.rationale[i - 1]!.weight).toBeGreaterThanOrEqual(thesis.rationale[i]!.weight);
    }
  });

  it('classifies the mirrored bearish stack as BEARISH_CONTINUATION', () => {
    const context = makeBullishContext({
      trends: { '4h': 'BEARISH', '2h': 'BEARISH', '1h': 'BEARISH', '15m': 'BEARISH', '5m': 'BEARISH' },
      bias: { long: 0.1, short: 0.9, final: 'SHORT' },
      regime: { primary: 'BEARISH', confidence: 0.8, behavioral: 'TRENDING_NORMAL' },
      location: { rangePosition: 0.3, position: 'DISCOUNT' },
    });
    const thesis = engine.deriveThesis(context);

    expect(thesis.type).toBe('BEARISH_CONTINUATION');
    expect(thesis.confidence).toBeGreaterThan(0.6);
  });

  it('calls a fresh bearish 15m CHoCH at HTF premium a BEARISH_REVERSAL', () => {
    const context = makeBullishContext({
      trends: { '15m': 'BEARISH', '5m': 'BEARISH' },
      bias: { long: 0.45, short: 0.5, final: 'NEUTRAL' },
      lastEvent15m: 'CHOCH_BEARISH',
      lastEventAge15m: 1,
      location: { rangePosition: 0.85, position: 'DEEP_PREMIUM' },
    });
    const thesis = engine.deriveThesis(context);

    expect(thesis.type).toBe('BEARISH_REVERSAL');
  });

  it('falls back to TRANSITION when HTF is bullish but the range position is mid', () => {
    const context = makeBullishContext({
      trends: { '15m': 'BEARISH', '5m': 'BEARISH' },
      bias: { long: 0.5, short: 0.42, final: 'NEUTRAL' },
      lastEvent15m: 'CHOCH_BEARISH',
      lastEventAge15m: 1,
      location: { rangePosition: 0.5, position: 'EQUILIBRIUM' },
    });
    const thesis = engine.deriveThesis(context);

    expect(thesis.type).toBe('TRANSITION');
  });

  it('classifies a double-RANGE market as RANGE', () => {
    const context = makeBullishContext({
      trends: { '4h': 'RANGE', '2h': 'RANGE', '1h': 'RANGE', '15m': 'RANGE', '5m': 'RANGE' },
      bias: { long: 0.3, short: 0.3, neutral: 0.4, final: 'NEUTRAL' },
      regime: { primary: 'RANGE', confidence: 0.5, behavioral: 'RANGING_LOW_VOL' },
    });
    const thesis = engine.deriveThesis(context);

    expect(thesis.type).toBe('RANGE');
  });

  it('returns NO_CLEAR_THESIS with low confidence when the 1h/15m data is missing', () => {
    const context = makeBullishContext({
      candleCounts: { '1h': 3, '15m': 4 },
      trends: { '4h': 'UNKNOWN', '2h': 'UNKNOWN', '1h': 'UNKNOWN', '15m': 'UNKNOWN', '5m': 'UNKNOWN' },
      bias: { long: 0.34, short: 0.33, neutral: 0.33, final: 'NEUTRAL' },
    });
    const thesis = engine.deriveThesis(context);

    expect(thesis.type).toBe('NO_CLEAR_THESIS');
    expect(thesis.confidence).toBeLessThanOrEqual(0.3);
  });
});

// ---------------------------------------------------------------------------
// ScenarioEngine
// ---------------------------------------------------------------------------

describe('ScenarioEngine', () => {
  const engine = new ScenarioEngine();

  it('generates retest-continuation + breakout-retest + conditional rejection for a bullish thesis', () => {
    const context = makeBullishContext();
    const thesis = { type: 'BULLISH_CONTINUATION' as const, confidence: 0.84, reasoning: {}, rationale: [] };
    const scenarios = engine.generateScenarios(context, thesis);

    const types = scenarios.map((s) => s.type);
    expect(types).toContain('RETEST_CONTINUATION');
    expect(types).toContain('BREAKOUT_RETEST');
    expect(types).toContain('LIQUIDITY_REJECTION');

    const retest = scenarios.find((s) => s.type === 'RETEST_CONTINUATION')!;
    expect(retest.direction).toBe('LONG');
    // Entry zone = the demand confluence just below price.
    expect(retest.entry!.zone.lower).toBeCloseTo(102.68, 2);
    expect(retest.entry!.zone.upper).toBeCloseTo(102.79, 2);
    // Invalidation below the zone's protective edge.
    expect(retest.invalidation).toBeLessThan(102.68);
    // Targets come from the liquidity map above price.
    expect(retest.targets.length).toBeGreaterThanOrEqual(2);
    expect(retest.targets[0]!.price).toBe(103.4);
    expect(retest.rr).toBeGreaterThan(0);

    const breakout = scenarios.find((s) => s.type === 'BREAKOUT_RETEST')!;
    expect(breakout.entry!.trigger!.level).toBe(103.4); // nearest buy-side
    expect(breakout.status).toBe('WATCHING');
  });

  it('marks the retest scenario ARMED when price is already inside the zone', () => {
    const context = makeBullishContext({ currentPrice: 102.72 });
    const thesis = { type: 'BULLISH_CONTINUATION' as const, confidence: 0.8, reasoning: {}, rationale: [] };
    const scenarios = engine.generateScenarios(context, thesis);

    const retest = scenarios.find((s) => s.type === 'RETEST_CONTINUATION')!;
    expect(retest.status).toBe('ARMED');
  });

  it('mirrors the family for a bearish thesis (supply retest + breakdown + sweep-long conditional)', () => {
    const context = makeBullishContext({
      trends: { '4h': 'BEARISH', '2h': 'BEARISH', '1h': 'BEARISH', '15m': 'BEARISH', '5m': 'BEARISH' },
      bias: { long: 0.1, short: 0.9, final: 'SHORT' },
      regime: { primary: 'BEARISH', confidence: 0.8, behavioral: 'TRENDING_NORMAL' },
      zones: [makeZone({ direction: 'BEARISH', low: 104.2, high: 104.4 })],
      liquidity: makeLiquidityMap({
        buySide: [makePool({ id: 'B1', side: 'BUY_SIDE', kind: 'BSL', price: 106, timeframe: '1h' })],
        sellSide: [makePool({ id: 'S1', side: 'SELL_SIDE', kind: 'SSL', price: 101, timeframe: '1h' })],
        nearestAbove: makePool({ id: 'B1', side: 'BUY_SIDE', kind: 'BSL', price: 106, timeframe: '1h' }),
        nearestBelow: makePool({ id: 'S1', side: 'SELL_SIDE', kind: 'SSL', price: 101, timeframe: '1h' }),
      }),
      location: { rangePosition: 0.3, position: 'DISCOUNT' },
    });
    const thesis = { type: 'BEARISH_CONTINUATION' as const, confidence: 0.8, reasoning: {}, rationale: [] };
    const scenarios = engine.generateScenarios(context, thesis);

    const retest = scenarios.find((s) => s.type === 'RETEST_CONTINUATION')!;
    expect(retest.direction).toBe('SHORT');
    expect(retest.entry!.zone.lower).toBeCloseTo(104.2, 2);
    expect(retest.invalidation).toBeGreaterThan(104.4);

    const sweepLong = scenarios.find((s) => s.type === 'LIQUIDITY_REJECTION')!;
    expect(sweepLong.direction).toBe('LONG'); // counter-thesis conditional
    expect(sweepLong.status).toBe('CONDITIONAL');
  });

  it('produces range-rotation scenarios in both directions for a RANGE thesis', () => {
    const context = makeBullishContext({
      trends: { '4h': 'RANGE', '2h': 'RANGE', '1h': 'RANGE', '15m': 'RANGE', '5m': 'RANGE' },
      bias: { long: 0.34, short: 0.33, neutral: 0.33, final: 'NEUTRAL' },
      regime: { primary: 'RANGE', confidence: 0.5, behavioral: 'RANGING_LOW_VOL' },
    });
    const thesis = { type: 'RANGE' as const, confidence: 0.5, reasoning: {}, rationale: [] };
    const scenarios = engine.generateScenarios(context, thesis);

    const rotations = scenarios.filter((s) => s.type === 'RANGE_ROTATION');
    expect(rotations).toHaveLength(2);
    expect(rotations.map((r) => r.direction).sort()).toEqual(['LONG', 'SHORT']);
  });

  it('returns only NO_TRADE for an unclear thesis, and no preferred scenario', () => {
    const context = makeBullishContext();
    const thesis = { type: 'NO_CLEAR_THESIS' as const, confidence: 0.2, reasoning: {}, rationale: [] };
    const scenarios = engine.generateScenarios(context, thesis);

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]!.type).toBe('NO_TRADE');
    expect(engine.pickPreferred(scenarios, thesis)).toBeUndefined();
  });

  it('picks the highest-alignment directional scenario as preferred', () => {
    const context = makeBullishContext();
    const thesis = { type: 'BULLISH_CONTINUATION' as const, confidence: 0.84, reasoning: {}, rationale: [] };
    const scenarios = engine.generateScenarios(context, thesis);
    const preferred = engine.pickPreferred(scenarios, thesis);

    expect(preferred).toBeDefined();
    expect(preferred!.direction).toBe('LONG');
    expect(preferred!.type).toBe('RETEST_CONTINUATION');
  });
});
