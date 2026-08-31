/**
 * Shared factories for building agentic-layer tool contexts.
 *
 * Extracted from engine.ts to eliminate the copy-paste duplication between
 * the `createMarketDataTool`/`createPositionInfoTool` registrations and
 * the `TradingAgentsPipeline.buildToolContext` callback. Both previously
 * contained identical market-state and account-state projection closures.
 *
 * CONVENTTS.md §3: the engine remains the single composition root —
 * this module is pure-function helper with no side effects or mutable state.
 */

import type { PaperBroker } from '../broker/PaperBroker.js';
import type { MarketStateManager } from '../market/MarketState.js';
import type { KlineStore, KlineInterval } from '../market/Klines.js';
import type { ToolContext } from '../ai/tools/types.js';
import { logger } from '../telemetry/logger.js';

export interface ToolContextDeps {
  marketState: MarketStateManager;
  klines: KlineStore;
  broker: PaperBroker;
}

/** Project a MarketStateManager snapshot into the lean shape tools expect. */
export function createMarketStateGetter(marketState: MarketStateManager) {
  return (sym: string) => {
    const s = marketState.getState(sym);
    if (!s) return undefined;
    return {
      symbol: s.symbol,
      bid: s.bid ?? 0,
      ask: s.ask ?? 0,
      last: s.last ?? 0,
      mark: s.mark ?? 0,
      spread: s.spread ?? 0,
      fundingRate: s.fundingRate,
      openInterest: s.openInterest,
      ts: new Date(s.localTsUtc).getTime(),
      stale: s.spread === undefined,
    };
  };
}

/** Project kline data into the lean shape tools expect. */
export function createCandleGetter(klines: KlineStore) {
  return (sym: string, tf: string, count: number) =>
    klines.getCandles(sym, tf as KlineInterval, count).map((c) => ({
      openTime: c.openTime,
      closeTime: c.closeTime ?? c.openTime,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      isClosed: c.isClosed ?? false,
    }));
}

/** Project broker account state into the lean shape tools expect. */
export function createAccountStateGetter(broker: PaperBroker) {
  return () => {
    const a = broker.getAccount();
    return {
      equity: a.equity,
      walletBalance: a.walletBalance,
      availableBalance: a.availableBalance,
      totalUnrealizedPnl: a.unrealizedPnl,
      totalRealizedPnl: a.totalRealizedPnl,
      totalFees: a.totalFees,
      totalFunding: a.totalFunding,
      liquidations: a.liquidations,
    };
  };
}

/** Project broker positions into the lean shape tools expect. */
export function createPositionsGetter(broker: PaperBroker) {
  return () =>
    broker.getPositions().map((p) => ({
      symbol: p.symbol,
      side: (p.positionSide === 'LONG' ? 'LONG' : p.positionSide === 'SHORT' ? 'SHORT' : 'FLAT') as 'LONG' | 'SHORT' | 'FLAT',
      quantity: p.qty,
      entryPrice: p.entryPrice,
      unrealizedPnl: p.unrealizedPnl,
      realizedPnl: p.realizedPnl,
      leverage: p.leverage,
      openedAt: p.openedAtUtc ? new Date(p.openedAtUtc).getTime() : 0,
    }));
}

/** Build a complete ToolContext for the TradingAgentsPipeline. */
export function buildToolContext(
  deps: ToolContextDeps,
  symbol: string,
  cycleId: string,
  deadlineMs: number,
): ToolContext {
  const getMarketState = createMarketStateGetter(deps.marketState);
  const getCandles = createCandleGetter(deps.klines);
  const getAccountState = createAccountStateGetter(deps.broker);
  const getPositions = createPositionsGetter(deps.broker);

  return {
    symbol,
    cycleId,
    deadlineMs,
    marketState: {
      get: getMarketState,
      candles: getCandles,
    },
    accountState: {
      get: getAccountState,
      positions: getPositions,
    },
    logger: {
      info: (msg, meta) => logger.info(meta ?? {}, `[tool] ${msg}`),
      warn: (msg, meta) => logger.warn(meta ?? {}, `[tool] ${msg}`),
      error: (msg, meta) => logger.error(meta ?? {}, `[tool] ${msg}`),
    },
  };
}
