import type { PaperTradeRecord } from '../../broker/paper/types.js';
import { PaperMetrics, type PerformanceMetrics } from '../../broker/paper/PaperMetrics.js';

export class PerformanceAnalyzer {
  static analyzeTrades(trades: PaperTradeRecord[]): PerformanceMetrics {
    const base = PaperMetrics.calculateMetrics(trades);
    const maxDrawdown = this.calculateMaxDrawdown(trades);
    return {
      ...base,
      maxDrawdown,
    };
  }

  private static calculateMaxDrawdown(trades: PaperTradeRecord[]): number {
    let peak = 0;
    let running = 0;
    let maxDd = 0;

    for (const t of trades) {
      running += t.netPnl;
      if (running > peak) peak = running;
      const dd = peak - running;
      if (dd > maxDd) maxDd = dd;
    }
    return Number(maxDd.toFixed(4));
  }
}
