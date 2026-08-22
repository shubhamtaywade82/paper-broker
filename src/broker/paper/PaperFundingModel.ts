import type { PaperPosition } from './types.js';

export interface FundingEvent {
  symbol: string;
  timestamp: number;
  fundingRate: number;
  fundingIntervalMs: number;
}

export class PaperFundingModel {
  static calculateFundingPayment(pos: PaperPosition, fundingRate: number): number {
    const notional = pos.remainingQuantity * pos.currentMarkPrice;
    // Long pays when fundingRate > 0; receives when fundingRate < 0.
    // Short receives when fundingRate > 0; pays when fundingRate < 0.
    if (pos.side === 'LONG') {
      return Number((-1 * notional * fundingRate).toFixed(4));
    }
    return Number((notional * fundingRate).toFixed(4));
  }

  static applyFundingToPosition(
    pos: PaperPosition,
    fundingRate: number,
    timestamp: number
  ): { payment: number; timestamp: number } {
    const payment = this.calculateFundingPayment(pos, fundingRate);
    pos.realizedPnl = Number((pos.realizedPnl + payment).toFixed(4));
    return { payment, timestamp };
  }
}
