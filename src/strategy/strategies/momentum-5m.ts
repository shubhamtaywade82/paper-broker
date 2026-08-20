import type { Strategy } from '../StrategyEngine.js';

export interface MomentumStrategyOptions {
  symbols?: string[];
  cooldownMs?: number;
}

export function createMomentumStrategy(options: MomentumStrategyOptions = {}): Strategy {
  const targetSymbols = options.symbols ?? ['SOLUSDT'];
  const cooldownMs = options.cooldownMs ?? 300_000;
  const lastSignalAt = new Map<string, number>();

  return {
    id: 'momentum-5m',
    name: 'Momentum (5m)',
    enabled: true,
    symbols: targetSymbols,
    intervals: ['5m'],
    priority: 50,
    cooldownMs,
    onCandleClose: (ctx, candle) => {
      if (!targetSymbols.includes(candle.symbol)) return null;

      const now = Date.now();
      const lastAt = lastSignalAt.get(candle.symbol) ?? 0;
      if (now - lastAt < cooldownMs) return null;

      const account = ctx.getAccount();
      if (account.availableBalance < 100) return null;

      const position = ctx.getPosition(candle.symbol);
      const market = ctx.getMarket(candle.symbol);
      if (!market?.last || !market.mark) return null;

      const premium = market.last - market.mark;

      if (position && position.qty !== 0) {
        const closeAction = position.qty > 0 ? 'CLOSE_LONG' : 'CLOSE_SHORT';
        const shouldClose = position.qty > 0 ? premium < 0 : premium > 0;
        if (!shouldClose) return null;

        lastSignalAt.set(candle.symbol, now);
        return {
          strategyId: 'momentum-5m',
          symbol: candle.symbol,
          action: closeAction,
          confidence: 0.6,
          ttlMs: 60_000,
          features: { last: market.last, mark: market.mark, premium },
          reasoning: `Momentum exit: ${closeAction} premium ${premium.toFixed(4)}`,
        };
      }

      if (premium > 0) {
        lastSignalAt.set(candle.symbol, now);
        return {
          strategyId: 'momentum-5m',
          symbol: candle.symbol,
          action: 'OPEN_LONG',
          confidence: 0.6,
          ttlMs: 60_000,
          features: { last: market.last, mark: market.mark, premium },
          reasoning: `Momentum: last > mark (premium ${premium.toFixed(4)})`,
        };
      }

      if (premium < 0) {
        lastSignalAt.set(candle.symbol, now);
        return {
          strategyId: 'momentum-5m',
          symbol: candle.symbol,
          action: 'OPEN_SHORT',
          confidence: 0.6,
          ttlMs: 60_000,
          features: { last: market.last, mark: market.mark, premium },
          reasoning: `Momentum: last < mark (premium ${premium.toFixed(4)})`,
        };
      }

      return null;
    },
  };
}