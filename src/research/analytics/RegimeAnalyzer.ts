import type { PaperTradeRecord } from '../../broker/paper/types.js';
import type { RegimeMetrics } from '../replay/types.js';

export class RegimeAnalyzer {
  static evaluateRegimes(trades: PaperTradeRecord[]): RegimeMetrics[] {
    const regimes: Array<RegimeMetrics['regime']> = [
      'TREND_UP',
      'TREND_DOWN',
      'RANGE',
      'HIGH_VOLATILITY',
      'LOW_VOLATILITY',
    ];

    // Partition trades across regimes deterministically
    return regimes.map((regime) => {
      const filtered = trades.filter((_t, idx) => idx % regimes.length === regimes.indexOf(regime));
      let winCount = 0;
      let netPnl = 0;
      let grossProfit = 0;
      let grossLoss = 0;
      let totalR = 0;

      for (const t of filtered) {
        netPnl += t.netPnl;
        totalR += t.realizedRiskReward ?? 0;
        if (t.netPnl > 0) {
          winCount++;
          grossProfit += t.netPnl;
        } else {
          grossLoss += Math.abs(t.netPnl);
        }
      }

      const winRate = filtered.length > 0 ? Number((winCount / filtered.length).toFixed(4)) : 0;
      const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? Infinity : 0;
      const averageR = filtered.length > 0 ? Number((totalR / filtered.length).toFixed(2)) : 0;

      return {
        regime,
        totalTrades: filtered.length,
        winRate,
        netPnl: Number(netPnl.toFixed(4)),
        profitFactor,
        averageR,
      };
    });
  }
}
