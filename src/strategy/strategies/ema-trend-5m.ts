import type { Strategy } from '../StrategyEngine.js';
import { ema, rsi, atr } from '../indicators.js';

export interface EmaTrendStrategyOptions {
  fastPeriod?: number;
  slowPeriod?: number;
  rsiUpper?: number;
  rsiLower?: number;
  symbols?: string[];
  cooldownMs?: number;
}

export function createEmaTrendStrategy(options: EmaTrendStrategyOptions = {}): Strategy {
  const fastPeriod = options.fastPeriod ?? 9;
  const slowPeriod = options.slowPeriod ?? 21;
  const rsiUpper = options.rsiUpper ?? 70;
  const rsiLower = options.rsiLower ?? 30;

  return {
    id: 'ema-trend-5m',
    name: 'EMA Trend (5m)',
    enabled: true,
    symbols: options.symbols ?? ['BTCUSDT', 'ETHUSDT'],
    intervals: ['5m'],
    priority: 10,
    cooldownMs: options.cooldownMs ?? 300_000,
    onCandleClose: (ctx, candle) => {
      const candles = ctx.getCandles(candle.symbol, '5m', 120);
      if (candles.length < 60) return null;

      const closes = candles.map((c) => c.close);
      const emaFast = ema(closes, fastPeriod);
      const emaSlow = ema(closes, slowPeriod);
      const rsiValues = rsi(closes, 14);
      const atrValues = atr(candles, 14);

      const fast = emaFast[emaFast.length - 1];
      const slow = emaSlow[emaSlow.length - 1];
      const rsiNow = rsiValues[rsiValues.length - 1];
      const atrNow = atrValues[atrValues.length - 1];

      if (fast === undefined || slow === undefined || rsiNow === undefined || atrNow === undefined) {
        return null;
      }
      if (!Number.isFinite(fast) || !Number.isFinite(slow)) return null;

      const price = candle.close;
      const hasLong = ctx.hasOpenPosition(candle.symbol) && (ctx.getPosition(candle.symbol)?.qty ?? 0) > 0;
      const hasShort = ctx.hasOpenPosition(candle.symbol) && (ctx.getPosition(candle.symbol)?.qty ?? 0) < 0;

      if (fast > slow && rsiNow < rsiUpper && !hasLong) {
        const features: Record<string, number> = { emaFast: fast, emaSlow: slow, rsi: rsiNow, atr: atrNow };
        return {
          strategyId: 'ema-trend-5m',
          symbol: candle.symbol,
          action: 'OPEN_LONG',
          confidence: 0.7,
          stopLossPrice: (price - atrNow * 1.5).toFixed(2),
          takeProfitPrice: (price + atrNow * 3).toFixed(2),
          ttlMs: 60_000,
          features,
          reasoning: `EMA9 crossed above EMA21 (${fast.toFixed(2)} > ${slow.toFixed(2)}), RSI ${rsiNow.toFixed(1)}`,
        };
      }

      if (fast < slow && rsiNow > rsiLower && !hasShort) {
        const features: Record<string, number> = { emaFast: fast, emaSlow: slow, rsi: rsiNow, atr: atrNow };
        return {
          strategyId: 'ema-trend-5m',
          symbol: candle.symbol,
          action: 'OPEN_SHORT',
          confidence: 0.7,
          stopLossPrice: (price + atrNow * 1.5).toFixed(2),
          takeProfitPrice: (price - atrNow * 3).toFixed(2),
          ttlMs: 60_000,
          features,
          reasoning: `EMA9 crossed below EMA21 (${fast.toFixed(2)} < ${slow.toFixed(2)}), RSI ${rsiNow.toFixed(1)}`,
        };
      }

      if (fast > slow && hasShort) {
        const features: Record<string, number> = { emaFast: fast, emaSlow: slow, rsi: rsiNow };
        return {
          strategyId: 'ema-trend-5m',
          symbol: candle.symbol,
          action: 'CLOSE_SHORT',
          confidence: 0.8,
          ttlMs: 60_000,
          features,
          reasoning: 'Uptrend resumed, closing short',
        };
      }

      if (fast < slow && hasLong) {
        const features: Record<string, number> = { emaFast: fast, emaSlow: slow, rsi: rsiNow };
        return {
          strategyId: 'ema-trend-5m',
          symbol: candle.symbol,
          action: 'CLOSE_LONG',
          confidence: 0.8,
          ttlMs: 60_000,
          features,
          reasoning: 'Downtrend resumed, closing long',
        };
      }

      return null;
    },
  };
}