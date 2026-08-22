export class PaperLiquidation {
  static calculateLiquidationPrice(
    entryPrice: number,
    side: 'LONG' | 'SHORT',
    leverage: number,
    maintenanceMarginRate = 0.005
  ): number {
    const lev = Math.max(1, leverage);
    if (side === 'LONG') {
      const liq = entryPrice * (1 - 1 / lev + maintenanceMarginRate);
      return Number(Math.max(0, liq).toFixed(4));
    }
    const liq = entryPrice * (1 + 1 / lev - maintenanceMarginRate);
    return Number(liq.toFixed(4));
  }
}
