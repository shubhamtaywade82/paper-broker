import type { MarketFeatures, SupertrendParams, AdaptiveSignal } from './types.js';
import { formatRegimeKey } from './regime.js';

export class FuzzySignalAI {
  private fuzzyMembership(value: number, min: number, max: number): number {
    if (value <= min) return 0;
    if (value >= max) return 1;
    return (value - min) / (max - min);
  }

  public generateSignal(options: {
    stDirection: number;
    isCrossover: boolean;
    features: MarketFeatures;
    params: SupertrendParams;
    currentPrice: number;
    supertrendValue: number;
    minConfidence?: number;
  }): AdaptiveSignal {
    const {
      stDirection,
      isCrossover,
      features,
      params,
      currentPrice,
      supertrendValue,
      minConfidence = 0.55,
    } = options;

    const { rsi, macdHist, volumeRatio, atr } = features;

    // Fuzzify Supertrend Direction & Freshness
    const stBullish = stDirection === 1 ? (isCrossover ? 1.0 : 0.8) : 0;
    const stBearish = stDirection === -1 ? (isCrossover ? 1.0 : 0.8) : 0;

    // RSI Membership (Bullish if oversold recovery, Bearish if overbought breakdown)
    const rsiBullish = 1 - this.fuzzyMembership(rsi, 30, 70);
    const rsiBearish = this.fuzzyMembership(rsi, 30, 70);

    // MACD Histogram Momentum (Positive histogram bullish)
    const macdBullish = this.fuzzyMembership(macdHist, -0.002 * currentPrice, 0.002 * currentPrice);
    const macdBearish = 1 - macdBullish;

    // Volume Confirmation (Ratio > 1.0 confirms institutional interest)
    const volConfirm = this.fuzzyMembership(volumeRatio, 0.7, 1.6);

    // Fuzzy Confluence Rule
    const buyStrength = Math.min(stBullish, Math.max(rsiBullish, macdBullish), volConfirm);
    const sellStrength = Math.min(stBearish, Math.max(rsiBearish, macdBearish), volConfirm);

    let action: 'OPEN_LONG' | 'OPEN_SHORT' | 'HOLD' = 'HOLD';
    let confidence = 0;
    let stopLossPrice = 0;
    let takeProfitPrice = 0;

    if (buyStrength > sellStrength && buyStrength >= minConfidence) {
      action = 'OPEN_LONG';
      confidence = Math.round(buyStrength * 100) / 100;
      stopLossPrice = Math.min(supertrendValue, currentPrice - 1.5 * atr);
      takeProfitPrice = currentPrice + 2.5 * atr;
    } else if (sellStrength > buyStrength && sellStrength >= minConfidence) {
      action = 'OPEN_SHORT';
      confidence = Math.round(sellStrength * 100) / 100;
      stopLossPrice = Math.max(supertrendValue, currentPrice + 1.5 * atr);
      takeProfitPrice = currentPrice - 2.5 * atr;
    }

    const regimeKey = formatRegimeKey(features);
    const reasoning = `[AdaptiveSupertrend] dir=${stDirection === 1 ? 'BULL' : 'BEAR'} conf=${(
      confidence * 100
    ).toFixed(0)}% atrP=${params.atrPeriod} mult=${params.multiplier} regime=${regimeKey}`;

    return {
      action,
      confidence,
      params,
      currentPrice,
      supertrendValue,
      stopLossPrice,
      takeProfitPrice,
      reasoning,
      regimeKey,
    };
  }
}
