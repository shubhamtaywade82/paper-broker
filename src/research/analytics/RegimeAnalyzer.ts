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

    const regimeGroups = new Map<RegimeMetrics['regime'], PaperTradeRecord[]>();
    for (const r of regimes) {
      regimeGroups.set(r, []);
    }

    for (const t of trades) {
      const regime = this.classifyTradeRegime(t);
      regimeGroups.get(regime)?.push(t);
    }

    return regimes.map((regime) => {
      const filtered = regimeGroups.get(regime) ?? [];
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

  private static classifyTradeRegime(t: PaperTradeRecord): RegimeMetrics['regime'] {
    const st = (t.setupType ?? '').toUpperCase();
    const riskDist = Math.abs(t.entryPrice - t.initialStopLoss);

    // High volatility if adverse excursion exceeds 1.5x risk distance
    if (riskDist > 0 && t.maxAdverseExcursion > riskDist * 1.5) {
      return 'HIGH_VOLATILITY';
    }

    // Range / liquidity sweep setups
    if (st.includes('SWEEP') || st.includes('RANGE') || st.includes('EQUAL')) {
      return 'RANGE';
    }

    // Trend continuation / trend setups
    if (st.includes('CHOCH_CONTINUATION') || st.includes('BOS') || st.includes('TREND')) {
      return t.direction === 'LONG' ? 'TREND_UP' : 'TREND_DOWN';
    }

    // Directional fallback
    if (t.direction === 'LONG') return 'TREND_UP';
    if (t.direction === 'SHORT') return 'TREND_DOWN';

    return 'RANGE';
  }
}
