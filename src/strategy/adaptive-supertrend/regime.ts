import {
  type Candle,
  adx,
  bollingerBands,
  macd,
  rsi,
  atr,
  sma,
} from '../indicators.js';
import type { MarketFeatures, MarketVolatility, TrendStrength, MarketMomentum } from './types.js';

export function extractMarketFeatures(candles: Candle[]): MarketFeatures | null {
  if (candles.length < 35) return null;

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const lastIndex = candles.length - 1;

  const bbRes = bollingerBands(closes, 20, 2);
  const adxRes = adx(candles, 14);
  const rsiRes = rsi(closes, 14);
  const macdRes = macd(closes, 12, 26, 9);
  const atrRes = atr(candles, 14);
  const volSma = sma(volumes, 20);

  const curBw = bbRes.bandWidth[lastIndex] || 0.03;
  const curAdx = adxRes.adx[lastIndex] || 15;
  const curRsi = rsiRes[lastIndex] || 50;
  const curMacdHist = macdRes.histogram[lastIndex] || 0;
  const curAtr = atrRes[lastIndex] || closes[lastIndex]! * 0.01;
  const curVolSma = volSma[lastIndex] || volumes[lastIndex]! || 1;
  const volRatio = curVolSma > 0 ? volumes[lastIndex]! / curVolSma : 1;

  const volatility: MarketVolatility =
    curBw < 0.025 ? 'low' : curBw < 0.06 ? 'medium' : 'high';

  const trendStrength: TrendStrength =
    curAdx < 20 ? 'weak' : curAdx < 35 ? 'medium' : 'strong';

  const momentum: MarketMomentum =
    curRsi < 32 ? 'oversold' : curRsi > 68 ? 'overbought' : 'neutral';

  return {
    volatility,
    trendStrength,
    momentum,
    adx: curAdx,
    bandWidth: curBw,
    rsi: curRsi,
    macdHist: curMacdHist,
    volumeRatio: volRatio,
    atr: curAtr,
  };
}

export function formatRegimeKey(f: MarketFeatures): string {
  return `${f.volatility}_${f.trendStrength}_${f.momentum}`;
}
