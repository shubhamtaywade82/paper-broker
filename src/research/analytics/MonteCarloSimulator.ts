import type { PaperTradeRecord } from '../../broker/paper/types.js';
import type { MonteCarloSimulationResult } from '../replay/types.js';

export class MonteCarloSimulator {
  static runSimulation(
    trades: PaperTradeRecord[],
    initialEquity = 10_000,
    iterations = 1000
  ): MonteCarloSimulationResult {
    if (trades.length === 0) return this.emptyResult(iterations);

    const pnlList = trades.map((t) => t.netPnl);
    const simulatedPnls: number[] = [];
    const maxDrawdowns: number[] = [];
    let ruinCount = 0;
    const maxLossStreaks: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const shuffled = this.deterministicShuffle(pnlList, i);
      const { finalEquity, maxDd, maxLossStreak } = this.evaluateSequence(shuffled, initialEquity);

      simulatedPnls.push(finalEquity - initialEquity);
      maxDrawdowns.push(maxDd);
      maxLossStreaks.push(maxLossStreak);
      if (finalEquity <= 0) ruinCount++;
    }

    simulatedPnls.sort((a, b) => a - b);
    maxDrawdowns.sort((a, b) => a - b);
    maxLossStreaks.sort((a, b) => a - b);

    return {
      iterations,
      meanNetPnl: Number((simulatedPnls.reduce((a, b) => a + b, 0) / iterations).toFixed(4)),
      medianNetPnl: Number(simulatedPnls[Math.floor(iterations * 0.5)]!.toFixed(4)),
      p05NetPnl: Number(simulatedPnls[Math.floor(iterations * 0.05)]!.toFixed(4)),
      p95NetPnl: Number(simulatedPnls[Math.floor(iterations * 0.95)]!.toFixed(4)),
      maxDrawdownMean: Number((maxDrawdowns.reduce((a, b) => a + b, 0) / iterations).toFixed(4)),
      maxDrawdownP95: Number(maxDrawdowns[Math.floor(iterations * 0.95)]!.toFixed(4)),
      maxDrawdownP99: Number(maxDrawdowns[Math.floor(iterations * 0.99)]!.toFixed(4)),
      probabilityOfRuin: Number((ruinCount / iterations).toFixed(4)),
      maxConsecutiveLossesMean: Number((maxLossStreaks.reduce((a, b) => a + b, 0) / iterations).toFixed(2)),
      maxConsecutiveLossesP99: maxLossStreaks[Math.floor(iterations * 0.99)]!,
    };
  }

  private static evaluateSequence(
    pnlSequence: number[],
    initialEquity: number
  ): { finalEquity: number; maxDd: number; maxLossStreak: number } {
    let equity = initialEquity;
    let peak = initialEquity;
    let maxDd = 0;
    let currentLossStreak = 0;
    let maxLossStreak = 0;

    for (const pnl of pnlSequence) {
      equity += pnl;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDd) maxDd = dd;

      if (pnl < 0) {
        currentLossStreak++;
        if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
      } else {
        currentLossStreak = 0;
      }
    }
    return { finalEquity: equity, maxDd, maxLossStreak };
  }

  private static deterministicShuffle(arr: number[], seed: number): number[] {
    const copy = [...arr];
    let s = seed + 1;
    for (let i = copy.length - 1; i > 0; i--) {
      s = (s * 9301 + 49297) % 233280;
      const j = Math.floor((s / 233280) * (i + 1));
      const temp = copy[i]!;
      copy[i] = copy[j]!;
      copy[j] = temp;
    }
    return copy;
  }

  private static emptyResult(iterations: number): MonteCarloSimulationResult {
    return {
      iterations,
      meanNetPnl: 0,
      medianNetPnl: 0,
      p05NetPnl: 0,
      p95NetPnl: 0,
      maxDrawdownMean: 0,
      maxDrawdownP95: 0,
      maxDrawdownP99: 0,
      probabilityOfRuin: 0,
      maxConsecutiveLossesMean: 0,
      maxConsecutiveLossesP99: 0,
    };
  }
}
