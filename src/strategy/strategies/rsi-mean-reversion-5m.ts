import type { Strategy } from '../StrategyEngine.js';
import { rsi, atr } from '../indicators.js';

export interface RsiMeanReversionStrategyOptions {
  oversold?: number;
  overbought?: number;
  neutralHigh?: number;
  neutralLow?: number;
  symbols?: string[];
  cooldownMs?: number;
}

export function createRsiMeanReversionStrategy(options: RsiMeanReversionStrategyOptions = {}): Strategy {
  const oversold = options.oversold ?? 30;
  const overbought = options.overbought ?? 70;
  const neutralHigh = options.neutralHigh ?? 55;
  const neutralLow = options.neutralLow ?? 45;

  return {
    id: 'rsi-mean-reversion-5m',
    name: 'RSI Mean Reversion (5m)',
    enabled: true,
    symbols: options.symbols ?? ['BTCUSDT', 'ETHUSDT'],
    intervals: ['5m'],
    priority: 30,
    cooldownMs: options.cooldownMs ?? 300_000,
    onCandleClose: (ctx, candle) => {
      const candles = ctx.getCandles(candle.symbol, '5m', 80);
      if (candles.length < 40) return null;

      const closes = candles.map((c) => c.close);
      const rsiValues = rsi(closes, 14);
      const atrValues = atr(candles, 14);

      const rsiNow = rsiValues[rsiValues.length - 1];
      const rsiPrev = rsiValues[rsiValues.length - 2];
      const atrNow = atrValues[atrValues.length - 1];

      if (rsiNow === undefined || rsiPrev === undefined || atrNow === undefined) return null;
      if (!Number.isFinite(rsiNow) || !Number.isFinite(rsiPrev)) return null;

      const hasLong = (ctx.getPosition(candle.symbol)?.qty ?? 0) > 0;
      const hasShort = (ctx.getPosition(candle.symbol)?.qty ?? 0) < 0;

      if (rsiNow < oversold && rsiNow > rsiPrev && !hasLong) {
        const features: Record<string, number> = { rsi: rsiNow, rsiPrev, atr: atrNow };
        return {
          strategyId: 'rsi-mean-reversion-5m',
          symbol: candle.symbol,
          action: 'OPEN_LONG',
          confidence: 0.72,
          stopLossPrice: (candle.close - atrNow * 1.5).toFixed(2),
          takeProfitPrice: (candle.close + atrNow * 2.5).toFixed(2),
          ttlMs: 60_000,
          features,
          reasoning: `RSI oversold ${rsiNow.toFixed(1)} and turning up from ${rsiPrev.toFixed(1)}`,
        };
      }

      if (rsiNow > overbought && rsiNow < rsiPrev && !hasShort) {
        const features: Record<string, number> = { rsi: rsiNow, rsiPrev, atr: atrNow };
        return {
          strategyId: 'rsi-mean-reversion-5m',
          symbol: candle.symbol,
          action: 'OPEN_SHORT',
          confidence: 0.72,
          stopLossPrice: (candle.close + atrNow * 1.5).toFixed(2),
          takeProfitPrice: (candle.close - atrNow * 2.5).toFixed(2),
          ttlMs: 60_000,
          features,
          reasoning: `RSI overbought ${rsiNow.toFixed(1)} and turning down from ${rsiPrev.toFixed(1)}`,
        };
      }

      if (rsiNow > neutralHigh && hasLong) {
        const features: Record<string, number> = { rsi: rsiNow };
        return {
          strategyId: 'rsi-mean-reversion-5m',
          symbol: candle.symbol,
          action: 'CLOSE_LONG',
          confidence: 0.8,
          ttlMs: 60_000,
          features,
          reasoning: `RSI back to neutral ${rsiNow.toFixed(1)}, taking profit on mean reversion`,
        };
      }

      if (rsiNow < neutralLow && hasShort) {
        const features: Record<string, number> = { rsi: rsiNow };
        return {
          strategyId: 'rsi-mean-reversion-5m',
          symbol: candle.symbol,
          action: 'CLOSE_SHORT',
          confidence: 0.8,
          ttlMs: 60_000,
          features,
          reasoning: `RSI back to neutral ${rsiNow.toFixed(1)}, taking profit on mean reversion`,
        };
      }

      return null;
    },
  };
}