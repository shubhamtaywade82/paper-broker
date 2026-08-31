export class PaperFeeModel {
  /**
   * Calculate trading fee for a fill.
   *
   * Default rates match Binance USDT-M Perpetual VIP0:
   *   - Maker: 0.02% (0.0002)
   *   - Taker: 0.04% (0.0004)
   *
   * All callers in PaperFillEngine pass explicit rates from config,
   * so these defaults are a safety net for any future call sites.
   */
  static calculateFee(notional: number, isMaker: boolean, makerRate = 0.0002, takerRate = 0.0004): number {
    const rate = isMaker ? makerRate : takerRate;
    return Number((Math.abs(notional) * rate).toFixed(4));
  }
}
