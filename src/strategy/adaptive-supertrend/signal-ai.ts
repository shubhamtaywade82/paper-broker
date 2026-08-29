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
    slAtrMult?: number;
    tpAtrMult?: number;
  }): AdaptiveSignal {
    const {
      stDirection,
      isCrossover,
      features,
      params,
      currentPrice,
      supertrendValue,
      minConfidence = 0.55,
      slAtrMult = 1.5,
      tpAtrMult = 2.5,
    } = options;

    const { rsi, macdHist, volumeRatio, atr } = features;

    // Fuzzify Supertrend Direction & Freshness
    // Fresh crossovers get full weight (1.0). Pullbacks near the Supertrend line (<=1.5 ATR)
    // get healthy trend-continuation weight (0.75). Overextended bars decay to prevent buying tops/selling bottoms.
    const distAtr = atr > 0 ? Math.abs(currentPrice - supertrendValue) / atr : 1.0;
    const trendFreshness = isCrossover
      ? 1.0
      : distAtr <= 1.5
      ? 0.75
      : Math.max(0.2, 0.75 - (distAtr - 1.5) * 0.25);

    const stBullish = stDirection === 1 ? trendFreshness : 0;
    const stBearish = stDirection === -1 ? trendFreshness : 0;

    // RSI Momentum (Bullish if RSI > 50 heading up, Bearish if RSI < 50)
    const rsiBullish = this.fuzzyMembership(rsi, 40, 70);
    const rsiBearish = 1 - this.fuzzyMembership(rsi, 30, 60);

    // MACD Histogram Momentum (Positive histogram bullish, negative bearish)
    const macdBullish = this.fuzzyMembership(macdHist, -0.001 * currentPrice, 0.001 * currentPrice);
    const macdBearish = 1 - macdBullish;

    // Volume Confirmation (Baseline 0.5 + boost for high volume)
    const volConfirm = 0.5 + 0.5 * this.fuzzyMembership(volumeRatio, 0.5, 1.5);

    // Weighted Fuzzy Confluence Rule
    const buyStrength = stBullish > 0
      ? 0.55 * stBullish + 0.30 * Math.max(rsiBullish, macdBullish) + 0.15 * volConfirm
      : 0;
    const sellStrength = stBearish > 0
      ? 0.55 * stBearish + 0.30 * Math.max(rsiBearish, macdBearish) + 0.15 * volConfirm
      : 0;

    let action: 'OPEN_LONG' | 'OPEN_SHORT' | 'HOLD' = 'HOLD';
    let confidence = 0;
    let stopLossPrice = 0;
    let takeProfitPrice = 0;

    if (buyStrength > sellStrength && buyStrength >= minConfidence) {
      action = 'OPEN_LONG';
      confidence = Math.round(buyStrength * 100) / 100;
      stopLossPrice = Math.min(supertrendValue, currentPrice - slAtrMult * atr);
      takeProfitPrice = currentPrice + tpAtrMult * atr;
    } else if (sellStrength > buyStrength && sellStrength >= minConfidence) {
      action = 'OPEN_SHORT';
      confidence = Math.round(sellStrength * 100) / 100;
      stopLossPrice = Math.max(supertrendValue, currentPrice + slAtrMult * atr);
      takeProfitPrice = currentPrice - tpAtrMult * atr;
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
