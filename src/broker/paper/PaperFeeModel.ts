export class PaperFeeModel {
  static calculateFee(notional: number, isMaker: boolean, makerRate = 0.0002, takerRate = 0.0005): number {
    const rate = isMaker ? makerRate : takerRate;
    return Number((Math.abs(notional) * rate).toFixed(4));
  }
}
