import { describe, it, expect } from 'vitest';
import { HierarchicalConfluenceScorer, CONFLUENCE_WEIGHTS, gradeFor } from '../../src/analysis/HierarchicalConfluenceScorer.js';
import { makeBullishContext, makeZone } from './helpers/analysisFixtures.js';
import type { Thesis } from '../../src/analysis/types.js';

function makeThesis(type: Thesis['type'], confidence = 0.8): Thesis {
  return { type, confidence, reasoning: {}, rationale: [] };
}

describe('HierarchicalConfluenceScorer', () => {
  const scorer = new HierarchicalConfluenceScorer();

  const perfectInput = {
    direction: 'LONG' as const,
    context: makeBullishContext({
      location: { position: 'DEEP_DISCOUNT' as const, rangePosition: 0.12 },
      lastEvent15m: 'CHOCH_BULLISH' as const,
      lastEventAge15m: 1,
      zones: [makeZone({ strength: 100 })],
    }),
    thesis: makeThesis('BULLISH_CONTINUATION', 0.9),
    sweep: { liquidityType: 'SSL' as const, timeframe: '1h' as const },
    hasDirectionalZone: true,
    rr: 4.2,
    hasTrigger: true,
  };

  it('awards the full 100 for perfectly stacked evidence', () => {
    const result = scorer.score(perfectInput);
    expect(result.maxScore).toBe(100);
    expect(result.totalScore).toBe(100);
    expect(result.grade).toBe('A+');
    expect(result.factors).toHaveLength(9);
    // Weights sum to exactly 100.
    const weightSum = result.factors.reduce((s, f) => s + f.weight, 0);
    expect(weightSum).toBe(100);
  });

  it('scores a counter-evidence LONG as REJECT', () => {
    const result = scorer.score({
      direction: 'LONG',
      context: makeBullishContext({
        trends: { '4h': 'BEARISH', '2h': 'BEARISH', '1h': 'BEARISH', '15m': 'BEARISH', '5m': 'BEARISH' },
        location: { position: 'DEEP_PREMIUM', rangePosition: 0.95 },
      }),
      thesis: makeThesis('BEARISH_CONTINUATION'),
      sweep: { liquidityType: 'BSL', timeframe: '15m' }, // wrong side
      hasDirectionalZone: false,
      rr: 0.5,
      hasTrigger: false,
    });

    expect(result.totalScore).toBeLessThan(60);
    expect(result.grade).toBe('REJECT');
  });

  it('gives CHoCH 15m structure full weight and BOS 80%', () => {
    const choch = scorer.score({
      ...perfectInput,
      context: makeBullishContext({ lastEvent15m: 'CHOCH_BULLISH', lastEventAge15m: 1 }),
    });
    const bos = scorer.score({
      ...perfectInput,
      context: makeBullishContext({ lastEvent15m: 'BOS_BULLISH', lastEventAge15m: 1 }),
    });

    const chochStruct = choch.factors.find((f) => f.factor === 'STRUCTURE_15M')!;
    const bosStruct = bos.factors.find((f) => f.factor === 'STRUCTURE_15M')!;
    expect(chochStruct.awarded).toBe(CONFLUENCE_WEIGHTS.STRUCTURE_15M);
    expect(bosStruct.awarded).toBe(Math.round(CONFLUENCE_WEIGHTS.STRUCTURE_15M * 0.8));
    expect(choch.totalScore).toBeGreaterThan(bos.totalScore);
  });

  it('penalises stale structure events', () => {
    const fresh = scorer.score({ ...perfectInput, context: makeBullishContext({ lastEventAge15m: 2 }) });
    const stale = scorer.score({ ...perfectInput, context: makeBullishContext({ lastEventAge15m: 20 }) });

    const freshStruct = fresh.factors.find((f) => f.factor === 'STRUCTURE_15M')!;
    const staleStruct = stale.factors.find((f) => f.factor === 'STRUCTURE_15M')!;
    // BOS base (80% = 12) decays 20% when stale.
    expect(staleStruct.awarded).toBeLessThan(freshStruct.awarded);
  });

  it('awards location credit by depth: deep discount > discount > equilibrium > premium', () => {
    const scores = [
      scorer.score({ ...perfectInput, context: makeBullishContext({ location: { position: 'DEEP_DISCOUNT', rangePosition: 0.1 } }) }),
      scorer.score({ ...perfectInput, context: makeBullishContext({ location: { position: 'DISCOUNT', rangePosition: 0.35 } }) }),
      scorer.score({ ...perfectInput, context: makeBullishContext({ location: { position: 'EQUILIBRIUM', rangePosition: 0.5 } }) }),
      scorer.score({ ...perfectInput, context: makeBullishContext({ location: { position: 'PREMIUM', rangePosition: 0.7 } }) }),
    ];

    const loc = scores.map((s) => s.factors.find((f) => f.factor === 'MARKET_LOCATION')!.awarded);
    expect(loc[0]).toBeGreaterThan(loc[1]);
    expect(loc[1]).toBeGreaterThan(loc[2]);
    expect(loc[2]).toBeGreaterThan(loc[3]);
  });

  it('drops the R:R factor to zero without a plan and partially credits moderate RR', () => {
    const none = scorer.score({ ...perfectInput, rr: undefined });
    const moderate = scorer.score({ ...perfectInput, rr: 2.0 });
    const great = scorer.score({ ...perfectInput, rr: 4.0 });

    expect(none.factors.find((f) => f.factor === 'RISK_REWARD')!.awarded).toBe(0);
    expect(moderate.factors.find((f) => f.factor === 'RISK_REWARD')!.awarded).toBeGreaterThan(0);
    expect(great.factors.find((f) => f.factor === 'RISK_REWARD')!.awarded).toBe(CONFLUENCE_WEIGHTS.RISK_REWARD);
  });

  it('maps score bands to grades', () => {
    expect(gradeFor(100)).toBe('A+');
    expect(gradeFor(90)).toBe('A+');
    expect(gradeFor(89)).toBe('A');
    expect(gradeFor(80)).toBe('A');
    expect(gradeFor(79)).toBe('B');
    expect(gradeFor(70)).toBe('B');
    expect(gradeFor(69)).toBe('C');
    expect(gradeFor(60)).toBe('C');
    expect(gradeFor(59)).toBe('REJECT');
    expect(gradeFor(0)).toBe('REJECT');
  });

  it('gives a reversal setup partial 2h credit when the 2h still disagrees', () => {
    const result = scorer.score({
      ...perfectInput,
      thesis: makeThesis('BULLISH_REVERSAL', 0.7),
      context: makeBullishContext({ trends: { '2h': 'BEARISH' } }),
    });

    const f2h = result.factors.find((f) => f.factor === 'STRUCTURE_2H')!;
    expect(f2h.awarded).toBe(Math.round(CONFLUENCE_WEIGHTS.STRUCTURE_2H * 0.5));
  });
});
