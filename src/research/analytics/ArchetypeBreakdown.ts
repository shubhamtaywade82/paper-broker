import type { PaperTradeRecord } from '../../broker/paper/types.js';
import type { ArchetypeMetrics } from '../replay/types.js';

export class ArchetypeBreakdown {
  static evaluateArchetypes(trades: PaperTradeRecord[]): ArchetypeMetrics[] {
    const groups = new Map<string, PaperTradeRecord[]>();

    for (const t of trades) {
      const list = groups.get(t.setupType) ?? [];
      list.push(t);
      groups.set(t.setupType, list);
    }

    const results: ArchetypeMetrics[] = [];
    for (const [archetype, list] of groups.entries()) {
      let winCount = 0;
      let lossCount = 0;
      let netPnl = 0;
      let grossProfit = 0;
      let grossLoss = 0;
      let totalR = 0;
      let totalMfe = 0;
      let totalMae = 0;
      let totalDuration = 0;

      for (const t of list) {
        netPnl += t.netPnl;
        totalR += t.realizedRiskReward ?? 0;
        totalMfe += t.maxFavorableExcursion;
        totalMae += t.maxAdverseExcursion;
        totalDuration += t.durationMs ?? 0;

        if (t.netPnl > 0) {
          winCount++;
          grossProfit += t.netPnl;
        } else {
          lossCount++;
          grossLoss += Math.abs(t.netPnl);
        }
      }

      const winRate = list.length > 0 ? Number((winCount / list.length).toFixed(4)) : 0;
      const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? Infinity : 0;
      const averageR = list.length > 0 ? Number((totalR / list.length).toFixed(2)) : 0;

      results.push({
        archetype,
        totalTrades: list.length,
        winningTrades: winCount,
        losingTrades: lossCount,
        winRate,
        netPnl: Number(netPnl.toFixed(4)),
        profitFactor,
        averageR,
        averageMfe: Number((totalMfe / list.length).toFixed(4)),
        averageMae: Number((totalMae / list.length).toFixed(4)),
        averageDurationMs: Math.round(totalDuration / list.length),
      });
    }

    return results.sort((a, b) => b.netPnl - a.netPnl);
  }
}
