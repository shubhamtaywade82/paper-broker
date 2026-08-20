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
      const market = ctx.getMarket(candle.symbol);
      if (!market?.last || !market.mark) return null;

      if (position && position.qty !== 0) {
        const closeAction = position.qty > 0 ? 'CLOSE_LONG' : 'CLOSE_SHORT';
        const closed = closeAction === 'CLOSE_LONG'
          ? market.last < market.mark
          : market.last > market.mark;
        if (!closed) return null;

        return {
          strategyId: 'momentum-5m',
          symbol: candle.symbol,
          action: closeAction,
          confidence: 0.6,
          ttlMs: 60_000,
          features: { last: market.last, mark: market.mark, premium: market.last - market.mark },
          reasoning: `Momentum exit: ${closeAction} last ${market.last} vs mark ${market.mark}`,
        };
      }

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