import type { PaperTradeRecord } from '../../broker/paper/types.js';
import type { SampleConfidenceLevel, StatisticalValidationResult } from '../replay/types.js';

export class StatisticalValidationEngine {
  static validateTrades(trades: PaperTradeRecord[], bootstrapIterations = 2000): StatisticalValidationResult {
    const n = trades.length;
    const grade = this.classifySampleSize(n);
    if (n === 0) return this.emptyResult(grade);

    const rMultiples = trades.map((t) => t.realizedRiskReward ?? 0);
    const meanR = Number((rMultiples.reduce((a, b) => a + b, 0) / n).toFixed(4));

    const { meanRCi, winRateCi, pfCi, bootstrapPVale } = this.runBootstrap(trades, bootstrapIterations);
    const { tStat } = this.calculateTStatistic(rMultiples, meanR, n);

    const isSignificant = n >= 30 && bootstrapPVale < 0.05 && meanRCi[0] > 0;

    return {
      sampleSize: n,
      confidenceGrade: grade,
      meanNetR: meanR,
      meanNetRConfidenceInterval: meanRCi,
      winRateConfidenceInterval: winRateCi,
      profitFactorConfidenceInterval: pfCi,
      tStatistic: tStat,
      pValueMeanRGreaterThanZero: bootstrapPVale,
      isStatisticallySignificant: isSignificant,
    };
  }

  private static classifySampleSize(n: number): SampleConfidenceLevel {
    if (n < 30) return 'INSUFFICIENT_SAMPLE';
    if (n < 100) return 'LOW_CONFIDENCE';
    if (n < 300) return 'MODERATE';
    return 'STRONGER_SAMPLE';
  }

  private static calculateTStatistic(rList: number[], mean: number, n: number): { tStat: number } {
    if (n <= 1) return { tStat: 0 };
    const variance = rList.reduce((acc, r) => acc + Math.pow(r - mean, 2), 0) / (n - 1);
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) return { tStat: 0 };
    const t = Number(((mean / (stdDev / Math.sqrt(n)))).toFixed(2));
    return { tStat: t };
  }

  private static runBootstrap(
    trades: PaperTradeRecord[],
    iterations: number
  ): { meanRCi: [number, number]; winRateCi: [number, number]; pfCi: [number, number]; bootstrapPVale: number } {
    const meanRs: number[] = [];
    const winRates: number[] = [];
    const pfs: number[] = [];
    let nonPositiveCount = 0;

    for (let i = 0; i < iterations; i++) {
      const sample = this.resampleWithReplacement(trades, i);
      const { mR, wr, pf } = this.evaluateSample(sample);
      meanRs.push(mR);
      winRates.push(wr);
      pfs.push(pf);
      if (mR <= 0) nonPositiveCount++;
    }

    meanRs.sort((a, b) => a - b);
    winRates.sort((a, b) => a - b);
    pfs.sort((a, b) => a - b);

    const lowIdx = Math.floor(iterations * 0.025);
    const highIdx = Math.floor(iterations * 0.975);

    return {
      meanRCi: [Number(meanRs[lowIdx]!.toFixed(2)), Number(meanRs[highIdx]!.toFixed(2))],
      winRateCi: [Number(winRates[lowIdx]!.toFixed(4)), Number(winRates[highIdx]!.toFixed(4))],
      pfCi: [Number(pfs[lowIdx]!.toFixed(2)), Number(pfs[highIdx]!.toFixed(2))],
      bootstrapPVale: Number((nonPositiveCount / iterations).toFixed(4)),
    };
  }

  private static evaluateSample(sample: PaperTradeRecord[]): { mR: number; wr: number; pf: number } {
    let sumR = 0;
    let wins = 0;
    let grossP = 0;
    let grossL = 0;

    for (const t of sample) {
      sumR += t.realizedRiskReward ?? 0;
      if (t.netPnl > 0) {
        wins++;
        grossP += t.netPnl;
      } else {
        grossL += Math.abs(t.netPnl);
      }
    }
    const n = sample.length;
    return {
      mR: n > 0 ? sumR / n : 0,
      wr: n > 0 ? wins / n : 0,
      pf: grossL > 0 ? grossP / grossL : grossP > 0 ? 10 : 0,
    };
  }

  private static resampleWithReplacement(arr: PaperTradeRecord[], seed: number): PaperTradeRecord[] {
    const res: PaperTradeRecord[] = [];
    const n = arr.length;
    let s = seed + 7;
    for (let i = 0; i < n; i++) {
      s = (s * 9301 + 49297) % 233280;
      const idx = Math.floor((s / 233280) * n);
      res.push(arr[idx]!);
    }
    return res;
  }

  private static emptyResult(grade: SampleConfidenceLevel): StatisticalValidationResult {
    return {
      sampleSize: 0,
      confidenceGrade: grade,
      meanNetR: 0,
      meanNetRConfidenceInterval: [0, 0],
      winRateConfidenceInterval: [0, 0],
      profitFactorConfidenceInterval: [0, 0],
      tStatistic: 0,
      pValueMeanRGreaterThanZero: 1.0,
      isStatisticallySignificant: false,
    };
  }
}
