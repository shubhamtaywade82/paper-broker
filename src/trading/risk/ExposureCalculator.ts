import type { PortfolioExposure, PortfolioPosition } from './types.js';

export class ExposureCalculator {
  static calculateExposure(positions: PortfolioPosition[]): PortfolioExposure {
    let grossNotional = 0;
    let longNotional = 0;
    let shortNotional = 0;
    let totalRiskAtStop = 0;
    const symbolPositionsCount: Record<string, number> = {};

    for (const pos of positions) {
      grossNotional += pos.notional;
      if (pos.side === 'LONG') {
        longNotional += pos.notional;
      } else {
        shortNotional += pos.notional;
      }

      const riskPerUnit = Math.abs(pos.entryPrice - pos.stopLossPrice);
      totalRiskAtStop += riskPerUnit * pos.quantity;
      symbolPositionsCount[pos.symbol] = (symbolPositionsCount[pos.symbol] ?? 0) + 1;
    }

    return {
      grossNotional: Number(grossNotional.toFixed(2)),
      netNotional: Number((longNotional - shortNotional).toFixed(2)),
      longNotional: Number(longNotional.toFixed(2)),
      shortNotional: Number(shortNotional.toFixed(2)),
      totalRiskAtStop: Number(totalRiskAtStop.toFixed(2)),
      openPositionsCount: positions.length,
      symbolPositionsCount,
    };
  }
}
