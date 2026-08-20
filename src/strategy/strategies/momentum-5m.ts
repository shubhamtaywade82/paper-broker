import type { Strategy } from '../StrategyEngine.js';

export interface MomentumStrategyOptions {
  symbol?: string;
  symbols?: string[];
  cooldownMs?: number;
}

export function createMomentumStrategy(options: MomentumStrategyOptions = {}): Strategy {
  const targetSymbol = options.symbol ?? 'SOLUSDT';

  return {
    id: 'momentum-5m',
    name: 'Momentum (5m)',
    enabled: true,
    symbols: options.symbols ?? [targetSymbol],
    intervals: ['5m'],
    priority: 50,
    cooldownMs: options.cooldownMs ?? 300_000,
    onCandleClose: (ctx, candle) => {
      if (candle.symbol !== targetSymbol) return null;

      const account = ctx.getAccount();
      if (account.availableBalance < 100) return null;

      const position = ctx.getPosition(candle.symbol);
      if (position && position.qty !== 0) return null;

      const market = ctx.getMarket(candle.symbol);
      if (!market?.last || !market.mark) return null;

      if (market.last > market.mark) {
        return {
          strategyId: 'momentum-5m',
          symbol: candle.symbol,
          action: 'OPEN_LONG',
          confidence: 0.6,
          ttlMs: 60_000,
          features: { last: market.last, mark: market.mark, premium: market.last - market.mark },
          reasoning: `Momentum: last ${market.last} > mark ${market.mark}`,
        };
      }

      if (market.last < market.mark) {
        return {
          strategyId: 'momentum-5m',
          symbol: candle.symbol,
          action: 'OPEN_SHORT',
          confidence: 0.6,
          ttlMs: 60_000,
          features: { last: market.last, mark: market.mark, premium: market.last - market.mark },
          reasoning: `Momentum: last ${market.last} < mark ${market.mark}`,
        };
      }

      return null;
    },
  };
}