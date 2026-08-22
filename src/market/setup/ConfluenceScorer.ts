import type { ConfluenceBreakdown, SetupCandidate, SetupConfig } from './types.js';

export const DEFAULT_SETUP_CONFIG: SetupConfig = {
  minConfluenceScore: 65,
  maxCandleAgeBars: 30,
  htfWeight: 20,
  structureWeight: 20,
  sweepWeight: 15,
  fvgWeight: 10,
  obWeight: 10,
  retestWeight: 10,
  triggerWeight: 10,
  dataQualityWeight: 5,
};

export class ConfluenceScorer {
  static evaluateConfluence(
    candidate: Partial<SetupCandidate>,
    config = DEFAULT_SETUP_CONFIG,
    isDataHealthy = true
  ): ConfluenceBreakdown {
    const notes: string[] = [];
    const dir = candidate.direction;

    const htf = this.scoreHtf(candidate, dir, config.htfWeight, notes);
    const struct = this.scoreStructure(candidate, dir, config.structureWeight, notes);
    const sweep = this.scoreSweep(candidate, dir, config.sweepWeight, notes);
    const fvg = candidate.fvgEvidence ? config.fvgWeight : 0;
    if (fvg) notes.push(`FVG confluence (+${fvg})`);
    const ob = candidate.orderBlockEvidence ? config.obWeight : 0;
    if (ob) notes.push(`Order Block confluence (+${ob})`);
    const retest = candidate.retestEvidence ? config.retestWeight : 0;
    if (retest) notes.push(`Zone retest confirmed (+${retest})`);
    const trigger = candidate.triggerEvidence ? config.triggerWeight : 0;
    if (trigger) notes.push(`5m trigger confirmed (+${trigger})`);
    const dataQ = isDataHealthy ? config.dataQualityWeight : 0;
    if (dataQ) notes.push(`Market data synchronized (+${dataQ})`);

    const total = htf + struct + sweep + fvg + ob + retest + trigger + dataQ;
    return {
      htfAlignmentScore: htf,
      structureScore: struct,
      liquiditySweepScore: sweep,
      fvgScore: fvg,
      orderBlockScore: ob,
      retestScore: retest,
      triggerScore: trigger,
      dataQualityScore: dataQ,
      totalScore: total,
      maxScore: 100,
      notes,
    };
  }

  private static scoreHtf(cand: Partial<SetupCandidate>, dir?: string, weight = 20, notes: string[] = []): number {
    const tf = cand.timeframes;
    if (!tf || !dir) return 0;
    const isBull = dir === 'LONG';
    const htfTarget = isBull ? 'BULLISH' : 'BEARISH';
    let pts = 0;
    if (tf.regime4h === htfTarget) pts += weight / 2;
    if (tf.bias1h === htfTarget) pts += weight / 2;
    if (pts > 0) notes.push(`HTF alignment ${pts}/${weight} (+${pts})`);
    return pts;
  }

  private static scoreStructure(cand: Partial<SetupCandidate>, dir?: string, weight = 20, notes: string[] = []): number {
    const tf = cand.timeframes;
    if (!tf || !dir) return 0;
    const isBull = dir === 'LONG';
    const target = isBull ? 'BULLISH' : 'BEARISH';
    if (tf.structure15m === target || cand.structureEvidence) {
      notes.push(`15m structure confirmation (+${weight})`);
      return weight;
    }
    return 0;
  }

  private static scoreSweep(cand: Partial<SetupCandidate>, dir?: string, weight = 15, notes: string[] = []): number {
    if (!cand.sweepEvidence) return 0;
    const isBull = dir === 'LONG';
    const expectedType = isBull ? 'SSL' : 'BSL';
    if (cand.sweepEvidence.liquidityType === expectedType || cand.sweepEvidence.liquidityType.includes(expectedType)) {
      notes.push(`${expectedType} liquidity sweep verified (+${weight})`);
      return weight;
    }
    return 0;
  }
}
