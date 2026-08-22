import type { TradeSignal } from '../../trading/signal/types.js';
import type { PaperTradeRecord } from '../../broker/paper/types.js';
import type { ScoreBucketMetrics } from '../replay/types.js';

export class ConfluenceScoreValidator {
  static validateScoreBuckets(
    trades: PaperTradeRecord[],
    signalsMap: Map<string, TradeSignal>
  ): ScoreBucketMetrics[] {
    const buckets: Array<{ range: string; min: number; max: number }> = [
      { range: '50-59', min: 50, max: 59 },
      { range: '60-64', min: 60, max: 64 },
      { range: '65-69', min: 65, max: 69 },
      { range: '70-74', min: 70, max: 74 },
      { range: '75-79', min: 75, max: 79 },
      { range: '80-84', min: 80, max: 84 },
      { range: '85-89', min: 85, max: 89 },
      { range: '90+', min: 90, max: 100 },
    ];

    return buckets.map((b) => {
      const bucketTrades = trades.filter((t) => {
        const sig = signalsMap.get(t.signalId);
        const score = sig?.confluenceScore ?? 0;
        return score >= b.min && score <= b.max;
      });

      let winCount = 0;
      let netPnl = 0;
      let grossProfit = 0;
      let grossLoss = 0;
      let totalR = 0;

      for (const t of bucketTrades) {
        netPnl += t.netPnl;
        totalR += t.realizedRiskReward ?? 0;
        if (t.netPnl > 0) {
          winCount++;
          grossProfit += t.netPnl;
        } else {
          grossLoss += Math.abs(t.netPnl);
        }
      }

      const winRate = bucketTrades.length > 0 ? Number((winCount / bucketTrades.length).toFixed(4)) : 0;
      const expectancyR = bucketTrades.length > 0 ? Number((totalR / bucketTrades.length).toFixed(2)) : 0;
      const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? Infinity : 0;

      return {
        scoreRange: b.range,
        minScore: b.min,
        maxScore: b.max,
        tradesCount: bucketTrades.length,
        winRate,
        expectancyR,
        netPnl: Number(netPnl.toFixed(4)),
        profitFactor,
      };
    });
  }
}
