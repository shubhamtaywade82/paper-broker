import type { Strategy } from '../StrategyEngine.js';
import { highest, lowest, atr } from '../indicators.js';

export interface BreakoutStrategyOptions {
  lookback?: number;
  atrStopMultiplier?: number;
  atrTakeProfitMultiplier?: number;
  symbols?: string[];
  cooldownMs?: number;
}

export function createBreakoutStrategy(options: BreakoutStrategyOptions = {}): Strategy {
  const lookback = options.lookback ?? 20;
  const stopMult = options.atrStopMultiplier ?? 2;
  const tpMult = options.atrTakeProfitMultiplier ?? 4;

  return {
    id: 'breakout-15m',
    name: 'Breakout (15m)',
    enabled: true,
    symbols: options.symbols ?? ['BTCUSDT', 'ETHUSDT'],
    intervals: ['15m'],
    priority: 20,
    cooldownMs: options.cooldownMs ?? 600_000,
    onCandleClose: (ctx, candle) => {
      const candles = ctx.getCandles(candle.symbol, '15m', 60);
      if (candles.length < 30) return null;

      const highs = candles.map((c) => c.high);
      const lows = candles.map((c) => c.low);
      const atrValues = atr(candles, 14);

      const upper = highest(highs, lookback);
      const lower = lowest(lows, lookback);
      const atrNow = atrValues[atrValues.length - 1];

      const upperBand = upper[upper.length - 2];
      const lowerBand = lower[lower.length - 2];
      const prevCandle = candles[candles.length - 2];

      if (upperBand === undefined || lowerBand === undefined || atrNow === undefined || !prevCandle) {
        return null;
      }
      if (!Number.isFinite(upperBand) || !Number.isFinite(lowerBand)) return null;

      const hasLong = (ctx.getPosition(candle.symbol)?.qty ?? 0) > 0;
      const hasShort = (ctx.getPosition(candle.symbol)?.qty ?? 0) < 0;

      const prevClose = prevCandle.close;

      if (candle.close > upperBand && candle.close > prevClose && !hasLong) {
        const features: Record<string, number> = {
          upper: upperBand,
          atr: atrNow,
          breakoutPct: ((candle.close - upperBand) / upperBand) * 100,
        };
        return {
          strategyId: 'breakout-15m',
          symbol: candle.symbol,
          action: 'OPEN_LONG',
          confidence: 0.75,
          stopLossPrice: (candle.close - atrNow * stopMult).toFixed(2),
          takeProfitPrice: (candle.close + atrNow * tpMult).toFixed(2),
          ttlMs: 60_000,
          features,
          reasoning: `Price broke above ${lookback}-period high (${candle.close.toFixed(2)} > ${upperBand.toFixed(2)})`,
        };
      }

      if (candle.close < lowerBand && candle.close < prevClose && !hasShort) {
        const features: Record<string, number> = {
          lower: lowerBand,
          atr: atrNow,
          breakoutPct: ((lowerBand - candle.close) / lowerBand) * 100,
        };
        return {
          strategyId: 'breakout-15m',
          symbol: candle.symbol,
          action: 'OPEN_SHORT',
          confidence: 0.75,
          stopLossPrice: (candle.close + atrNow * stopMult).toFixed(2),
          takeProfitPrice: (candle.close - atrNow * tpMult).toFixed(2),
          ttlMs: 60_000,
          features,
          reasoning: `Price broke below ${lookback}-period low (${candle.close.toFixed(2)} < ${lowerBand.toFixed(2)})`,
        };
      }

      return null;
    },
  };
}