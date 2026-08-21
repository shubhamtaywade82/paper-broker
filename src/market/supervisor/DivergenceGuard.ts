import type { MarketDataProviderType } from '../../broker/types.js';
import type { PriceDivergenceResult } from './types.js';

export interface DivergenceGuardOptions {
  maxDivergenceBps?: number;
}

export class DivergenceGuard {
  private maxDivergenceBps: number;
  private prices = new Map<string, Map<MarketDataProviderType, number>>();

  constructor(options?: DivergenceGuardOptions) {
    this.maxDivergenceBps = options?.maxDivergenceBps ?? 50; // 50 bps = 0.5%
  }

  public recordPrice(symbol: string, provider: MarketDataProviderType, price: number): PriceDivergenceResult {
    let symbolMap = this.prices.get(symbol);
    if (!symbolMap) {
      symbolMap = new Map<MarketDataProviderType, number>();
      this.prices.set(symbol, symbolMap);
    }
    symbolMap.set(provider, price);

    return this.checkDivergence(symbol);
  }

  public checkDivergence(symbol: string): PriceDivergenceResult {
    const symbolMap = this.prices.get(symbol);
    if (!symbolMap) {
      return { symbol, divergenceBps: 0, isDivergent: false };
    }

    const binancePrice = symbolMap.get('BINANCE');
    const coindcxPrice = symbolMap.get('COINDCX');

    if (binancePrice === undefined || coindcxPrice === undefined || binancePrice <= 0) {
      return {
        symbol,
        binancePrice,
        coindcxPrice,
        divergenceBps: 0,
        isDivergent: false,
      };
    }

    const diff = Math.abs(binancePrice - coindcxPrice);
    const divergenceBps = Math.round((diff / binancePrice) * 10000);
    const isDivergent = divergenceBps > this.maxDivergenceBps;

    return {
      symbol,
      binancePrice,
      coindcxPrice,
      divergenceBps,
      isDivergent,
    };
  }

  public shouldHaltNewEntries(symbol: string): boolean {
    return this.checkDivergence(symbol).isDivergent;
  }
}
