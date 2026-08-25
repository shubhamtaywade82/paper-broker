import type { Strategy } from '../StrategyEngine.js';

// Medium finding: this strategy's emitted signals carry no `features.quantity`,
// so SignalExecutor (which sizes/risk-gates upstream, not per-strategy — see
// PROJECT_STATE.md) rejects every OPEN_LONG/OPEN_SHORT it produces with
// ZERO_QUANTITY (H-18 made this an explicit rejection instead of a silent
// no-op). This is not an oversight to patch here: PROJECT_STATE.md's
// "Deferred" section documents this strategy as retired pending a future
// sizing/risk-gate unification, reachable only via cli.ts's --engine=indicators
// flag, not a working alternative to the live --engine=smc path. Adding
// ad-hoc sizing directly in this file would bypass that documented
// architecture rather than complete it.
export interface MeanReversionStrategyOptions {
  lookbackPeriods?: number;
  symbols?: string[];
  cooldownMs?: number;
}

export function createMeanReversionStrategy(options: MeanReversionStrategyOptions = {}): Strategy {
  const targetSymbols = options.symbols ?? ['ETHUSDT'];
  const lookbackPeriods = options.lookbackPeriods ?? 20;
  const cooldownMs = options.cooldownMs ?? 300_000;
  const lastSignalAt = new Map<string, number>();

  return {
    id: 'mean-reversion-5m',
    name: 'Mean Reversion (5m)',
    enabled: true,
    symbols: targetSymbols,
    intervals: ['5m'],
    priority: 55,
    cooldownMs,
    onCandleClose: (ctx, candle) => {
      if (!targetSymbols.includes(candle.symbol)) return null;

      const now = Date.now();
      const lastAt = lastSignalAt.get(candle.symbol) ?? 0;
      if (now - lastAt < cooldownMs) return null;

      const market = ctx.getMarket(candle.symbol);
      if (!market?.mark) return null;

      const position = ctx.getPosition(candle.symbol);
      if (position && position.qty !== 0) return null;

      const candles = ctx.getCandles(candle.symbol, '5m', lookbackPeriods);
      if (candles.length < lookbackPeriods) return null;

      const marks = candles.map((c) => c.close);
      const mean = marks.reduce((a, b) => a + b, 0) / marks.length;
      const std = Math.sqrt(
        marks.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / marks.length
      );
      if (std === 0) return null;

      const upperBand = mean + 2 * std;
      const lowerBand = mean - 2 * std;
      const price = market.mark;

      if (price <= lowerBand) {
        lastSignalAt.set(candle.symbol, now);
        return {
          strategyId: 'mean-reversion-5m',
          symbol: candle.symbol,
          action: 'OPEN_LONG',
          confidence: 0.65,
          ttlMs: 60_000,
          features: { price, mean, std, upperBand, lowerBand },
          reasoning: `Mean reversion BUY: price ${price.toFixed(2)} <= lowerBand ${lowerBand.toFixed(2)}`,
        };
      }

      if (price >= upperBand) {
        lastSignalAt.set(candle.symbol, now);
        return {
          strategyId: 'mean-reversion-5m',
          symbol: candle.symbol,
          action: 'OPEN_SHORT',
          confidence: 0.65,
          ttlMs: 60_000,
          features: { price, mean, std, upperBand, lowerBand },
          reasoning: `Mean reversion SELL: price ${price.toFixed(2)} >= upperBand ${upperBand.toFixed(2)}`,
        };
      }

      return null;
    },
  };
}