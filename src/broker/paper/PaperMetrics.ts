import type { PaperTradeRecord } from './types.js';

export interface PerformanceMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netPnL: number;
  totalFees: number;
  profitFactor: number;
  averageR: number;
  maxDrawdown: number;
  averageTrade: number;
  averageWinner: number;
  averageLoser: number;
  largestWinner: number;
  largestLoser: number;
  averageHoldingTimeMs: number;
}

export class PaperMetrics {
  static calculateMetrics(trades: PaperTradeRecord[]): PerformanceMetrics {
    const closed = trades.filter((t) => t.status === 'CLOSED' || t.status === 'LIQUIDATED' || t.status === 'STOPPED');
    if (closed.length === 0) return this.emptyMetrics();

    let grossProfit = 0;
    let grossLoss = 0;
    let totalFees = 0;
    let totalR = 0;
    let totalDuration = 0;
    let winningCount = 0;
    let losingCount = 0;
    let largestWinner = 0;
    let largestLoser = 0;

    for (const t of closed) {
      totalFees += t.fees;
      totalR += t.realizedRiskReward ?? 0;
      totalDuration += t.durationMs ?? 0;

      if (t.netPnl > 0) {
        winningCount++;
        grossProfit += t.netPnl;
        largestWinner = Math.max(largestWinner, t.netPnl);
      } else {
        losingCount++;
        grossLoss += Math.abs(t.netPnl);
        largestLoser = Math.max(largestLoser, Math.abs(t.netPnl));
      }
    }

    const netPnL = Number((grossProfit - grossLoss).toFixed(4));
    const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? Infinity : 0;
    const winRate = Number((winningCount / closed.length).toFixed(4));

    return {
      totalTrades: closed.length,
      winningTrades: winningCount,
      losingTrades: losingCount,
      winRate,
      grossProfit: Number(grossProfit.toFixed(4)),
      grossLoss: Number(grossLoss.toFixed(4)),
      netPnL,
      totalFees: Number(totalFees.toFixed(4)),
      profitFactor,
      averageR: Number((totalR / closed.length).toFixed(2)),
      maxDrawdown: 0,
      averageTrade: Number((netPnL / closed.length).toFixed(4)),
      averageWinner: winningCount > 0 ? Number((grossProfit / winningCount).toFixed(4)) : 0,
      averageLoser: losingCount > 0 ? Number((grossLoss / losingCount).toFixed(4)) : 0,
      largestWinner: Number(largestWinner.toFixed(4)),
      largestLoser: Number(largestLoser.toFixed(4)),
      averageHoldingTimeMs: Math.round(totalDuration / closed.length),
    };
  }

  private static emptyMetrics(): PerformanceMetrics {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      grossProfit: 0,
      grossLoss: 0,
      netPnL: 0,
      totalFees: 0,
      profitFactor: 0,
      averageR: 0,
      maxDrawdown: 0,
      averageTrade: 0,
      averageWinner: 0,
      averageLoser: 0,
      largestWinner: 0,
      largestLoser: 0,
      averageHoldingTimeMs: 0,
    };
  }
}
