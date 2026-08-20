import type { Strategy } from '../StrategyEngine.js';

export interface GridStrategyOptions {
  symbol?: string;
  gridLevels?: number;
  gridSpacing?: number;
  baseQty?: number;
  leverage?: number;
  symbols?: string[];
}

export function createGridStrategy(options: GridStrategyOptions = {}): Strategy {
  const targetSymbol = options.symbol ?? 'SOLUSDT';
  const gridLevels = options.gridLevels ?? 5;
  const gridSpacing = options.gridSpacing ?? 0.005;
  const baseQty = options.baseQty ?? 0.5;
  const leverage = options.leverage ?? 2;
  let ordersPlaced = false;

  return {
    id: 'grid-15m',
    name: 'Grid (15m)',
    enabled: true,
    symbols: options.symbols ?? [targetSymbol],
    intervals: ['15m'],
    priority: 60,
    cooldownMs: 0,
    onCandleClose: (ctx, candle) => {
      if (candle.symbol !== targetSymbol) return null;
      if (ordersPlaced) return null;

      const market = ctx.getMarket(candle.symbol);
      if (!market?.bid || !market.ask || !market.mark) return null;

      const position = ctx.getPosition(candle.symbol);
      if (position && Math.abs(position.qty) > 0) return null;

      const midPrice = (market.bid + market.ask) / 2;

      for (let i = -gridLevels; i <= gridLevels; i++) {
        if (i === 0) continue;

        ctx.submitOrder({
          symbol: candle.symbol,
          side: i > 0 ? 'SELL' : 'BUY',
          type: 'LIMIT',
          quantity: baseQty,
          price: midPrice * (1 + i * gridSpacing),
          leverage,
          timeInForce: 'GTC',
          postOnly: true,
        });
      }

      ordersPlaced = true;
      return null;
    },
  };
}