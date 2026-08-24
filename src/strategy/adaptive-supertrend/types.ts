export type MarketVolatility = 'low' | 'medium' | 'high';
export type TrendStrength = 'weak' | 'medium' | 'strong';
export type MarketMomentum = 'oversold' | 'neutral' | 'overbought';

export interface MarketFeatures {
  volatility: MarketVolatility;
  trendStrength: TrendStrength;
  momentum: MarketMomentum;
  adx: number;
  bandWidth: number;
  rsi: number;
  macdHist: number;
  volumeRatio: number;
  atr: number;
}

export interface SupertrendParams {
  atrPeriod: number;
  multiplier: number;
}

export interface AdaptiveSignal {
  action: 'OPEN_LONG' | 'OPEN_SHORT' | 'HOLD';
  confidence: number;
  params: SupertrendParams;
  currentPrice: number;
  supertrendValue: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  reasoning: string;
  regimeKey: string;
}
