import type { Strategy } from '../StrategyEngine.js';

export interface GridStrategyOptions {
  gridLevels?: number;
  gridSpacing?: number;
  baseQty?: number;
  leverage?: number;
  symbols?: string[];
}

interface GridSymbolState {
  ordersPlaced: boolean;
  lastMidPrice: number;
}

export function createGridStrategy(options: GridStrategyOptions = {}): Strategy {
  const targetSymbols = options.symbols ?? ['SOLUSDT'];
  const gridLevels = options.gridLevels ?? 5;
  const gridSpacing = options.gridSpacing ?? 0.005;
  const baseQty = options.baseQty ?? 0.5;
  const leverage = options.leverage ?? 2;
  const symbolState = new Map<string, GridSymbolState>();

  return {
    id: 'grid-15m',
    name: 'Grid (15m)',
    enabled: true,
    symbols: targetSymbols,
    intervals: ['15m'],
    priority: 60,
    cooldownMs: 0,
    onCandleClose: (ctx, candle) => {
      if (!targetSymbols.includes(candle.symbol)) return null;

      const market = ctx.getMarket(candle.symbol);
      if (!market?.bid || !market.ask || !market.mark) return null;

      const position = ctx.getPosition(candle.symbol);
      if (position && Math.abs(position.qty) > 0) return null;

      const midPrice = (market.bid + market.ask) / 2;
      const state = symbolState.get(candle.symbol) ?? { ordersPlaced: false, lastMidPrice: 0 };

      const openOrders = ctx.getOpenOrders(candle.symbol);
      const gridOrders = openOrders.filter(o => o.type === 'LIMIT' && o.postOnly);
      const expectedOrderCount = gridLevels * 2;

      if (gridOrders.length >= expectedOrderCount) {
        state.ordersPlaced = true;
        state.lastMidPrice = midPrice;
        symbolState.set(candle.symbol, state);
        return null;
      }

      if (state.ordersPlaced && Math.abs(midPrice - state.lastMidPrice) / midPrice > gridSpacing) {
        state.ordersPlaced = false;
      }

      if (!state.ordersPlaced) {
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

        state.ordersPlaced = true;
        state.lastMidPrice = midPrice;
        symbolState.set(candle.symbol, state);
      }

      return null;
    },
  };
}