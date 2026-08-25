import type { Strategy } from '../StrategyEngine.js';
import { logger } from '../../telemetry/logger.js';

/**
 * C-09 / CONTRACTS.md Section 1 (Execution Contract) documented exception.
 *
 * Every other strategy in this codebase emits a single SignalInput per
 * decision and lets SignalExecutor own sizing/risk validation/submission —
 * "strategies never place orders directly." Grid trading is structurally
 * incompatible with that: a grid ladder is N resting BUY limits and N resting
 * SELL limits placed atomically as one unit, but SignalInput/Signal model
 * exactly one directional trade decision (one action, one quantity, one
 * stop/TP — see SignalActionSchema in signal.ts: OPEN_LONG/OPEN_SHORT/
 * CLOSE_LONG/CLOSE_SHORT/CANCEL_ALL/HOLD). Forcing this strategy through that
 * pipeline would mean returning one SignalInput per candle and building the
 * ladder one level at a time over N candles, which is not grid trading — it's
 * a different, slower, and materially different strategy. That's the kind of
 * "material architecture change" AGENTS.md Section 20 requires stopping and
 * documenting rather than making silently, so this exception is documented
 * here instead of forced through the single-signal pipeline.
 *
 * This strategy is NOT wired into the live engine (see engine.ts) — it is
 * only reachable via BacktestRunner's already-retired `--engine=indicators`
 * CLI path (PROJECT_STATE.md's "Deferred" section). Because it still submits
 * real orders in that path (unlike its sibling classic strategies, which
 * produce zero trades due to missing sizing), it carries its own explicit
 * risk limits rather than relying on the standard pipeline's:
 * - `maxTotalGridNotional` / `maxEquityFraction`: hard caps on the ladder's
 *   combined notional, enforced while placing orders (skips remaining levels
 *   and logs a warning rather than silently exceeding them).
 */
export interface GridStrategyOptions {
  gridLevels?: number;
  gridSpacing?: number;
  baseQty?: number;
  leverage?: number;
  symbols?: string[];
  /** Absolute cap (USDT) on the grid ladder's combined notional across all resting orders. Default 5000, matching PaperBroker's own default maxOrderNotional. */
  maxTotalGridNotional?: number;
  /** Cap on the ladder's combined notional as a fraction of current account equity. Default 0.5 (50%). */
  maxEquityFraction?: number;
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
  const maxTotalGridNotional = options.maxTotalGridNotional ?? 5000;
  const maxEquityFraction = options.maxEquityFraction ?? 0.5;
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
        const account = ctx.getAccount();
        const equity = Number.isFinite(account.equity) ? Math.max(0, account.equity) : 0;
        const notionalCap = Math.min(maxTotalGridNotional, equity * maxEquityFraction);

        let cumulativeNotional = 0;
        let levelsPlaced = 0;
        for (let i = -gridLevels; i <= gridLevels; i++) {
          if (i === 0) continue;

          const price = midPrice * (1 + i * gridSpacing);
          const orderNotional = baseQty * price;

          if (cumulativeNotional + orderNotional > notionalCap) {
            logger.warn(
              { symbol: candle.symbol, notionalCap, cumulativeNotional, levelsPlaced, expectedOrderCount },
              '[GridStrategy] stopped placing ladder orders: max grid notional reached'
            );
            break;
          }

          ctx.submitOrder({
            symbol: candle.symbol,
            side: i > 0 ? 'SELL' : 'BUY',
            type: 'LIMIT',
            quantity: baseQty,
            price,
            leverage,
            timeInForce: 'GTC',
            postOnly: true,
          });

          cumulativeNotional += orderNotional;
          levelsPlaced += 1;
        }

        state.ordersPlaced = true;
        state.lastMidPrice = midPrice;
        symbolState.set(candle.symbol, state);
      }

      return null;
    },
  };
}
