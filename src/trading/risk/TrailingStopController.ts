/**
 * Trailing Stop Controller
 *
 * Bridges the pure TrailingStopManager calculation to actual broker state.
 *
 * Stops in this system are real reduce-only STOP_MARKET orders (see
 * SignalExecutor / OrderFactory.buildStopLossOrder), not a field on the
 * position. "Moving a stop" therefore means cancelling the resting stop order
 * and submitting a replacement at the new trigger price. This controller owns
 * that cancel-and-replace, so TrailingStopManager stays a pure function of
 * price and the execution contract ("strategy never places orders directly")
 * is preserved — the controller is execution-layer code, not a strategy.
 */

import type { ExecutionBroker, Order, Position } from '../../broker/types.js';
import { logger } from '../../telemetry/logger.js';
import { metrics } from '../../telemetry/metrics.js';
import type { TrailingStopManager } from './TrailingStopManager.js';
import type { PortfolioPosition } from './types.js';

export interface TrailingStopControllerDeps {
  broker: ExecutionBroker;
  manager: TrailingStopManager;
  /** Minimum gap between stop revisions per symbol. Guards against churn. */
  minUpdateIntervalMs?: number;
  onStopMoved?: (update: TrailingStopMoved) => void;
  onTpMoved?: (update: TrailingTpMoved) => void;
}

export interface TrailingStopMoved {
  symbol: string;
  side: 'LONG' | 'SHORT';
  previousStop: number;
  newStop: number;
  reason: 'BREAKEVEN' | 'TRAILING';
  orderId: string;
}

export interface TrailingTpMoved {
  symbol: string;
  side: 'LONG' | 'SHORT';
  previousTp: number;
  newTp: number;
  reason: 'EXTENDED';
  orderId: string;
}

const DEFAULT_MIN_UPDATE_INTERVAL_MS = 2_000;

function toPortfolioPosition(position: Position, stopLossPrice: number): PortfolioPosition {
  return {
    symbol: position.symbol,
    side: position.qty >= 0 ? 'LONG' : 'SHORT',
    quantity: Math.abs(position.qty),
    entryPrice: position.entryPrice,
    stopLossPrice,
    notional: Math.abs(position.qty) * position.entryPrice,
    unrealizedPnl: position.unrealizedPnl,
  };
}

export class TrailingStopController {
  private broker: ExecutionBroker;
  private manager: TrailingStopManager;
  private minUpdateIntervalMs: number;
  private onStopMoved?: (update: TrailingStopMoved) => void;
  private onTpMoved?: (update: TrailingTpMoved) => void;
  private lastUpdateAt = new Map<string, number>();
  private inFlight = new Set<string>();

  constructor(deps: TrailingStopControllerDeps) {
    this.broker = deps.broker;
    this.manager = deps.manager;
    this.minUpdateIntervalMs = deps.minUpdateIntervalMs ?? DEFAULT_MIN_UPDATE_INTERVAL_MS;
    this.onStopMoved = deps.onStopMoved;
    this.onTpMoved = deps.onTpMoved;
  }

  /**
   * Evaluate one symbol against the current price and move its stop and/or
   * take-profit if the trailing rules call for it. Safe to call on every
   * tick — it self-throttles and is a no-op when there is no open position
   * or no resting stop/TP order. Returns the stop move, if any; a take-profit
   * extension in the same tick is reported via the onTpMoved callback.
   */
  async onPrice(symbol: string, price: number, now = Date.now()): Promise<TrailingStopMoved | null> {
    if (!Number.isFinite(price) || price <= 0) return null;

    // A cancel+submit round trip is not atomic; a second concurrent pass for
    // the same symbol could cancel a replacement we just placed.
    if (this.inFlight.has(symbol)) return null;

    const last = this.lastUpdateAt.get(symbol) ?? 0;
    if (now - last < this.minUpdateIntervalMs) return null;

    const position = await this.broker.getPosition(symbol);
    if (!position || position.qty === 0 || position.status === 'CLOSED') {
      this.forget(symbol);
      return null;
    }

    const openOrders = await this.broker.getOpenOrders(symbol);
    const stopOrder = openOrders.find((o) => o.type === 'STOP_MARKET' && o.reduceOnly);
    const tpOrder = openOrders.find((o) => o.type === 'TAKE_PROFIT_MARKET' && o.reduceOnly);
    if ((!stopOrder || stopOrder.stopPrice === undefined) && (!tpOrder || tpOrder.stopPrice === undefined)) {
      return null;
    }

    this.inFlight.add(symbol);
    try {
      let slMoved: TrailingStopMoved | null = null;
      if (stopOrder && stopOrder.stopPrice !== undefined) {
        slMoved = await this.updateStopOrder(symbol, position, stopOrder, price, now);
      }
      if (tpOrder && tpOrder.stopPrice !== undefined) {
        const tpMoved = await this.updateTpOrder(symbol, position, tpOrder, price, now);
        if (tpMoved) this.lastUpdateAt.set(symbol, now);
      }
      if (slMoved) this.lastUpdateAt.set(symbol, now);
      return slMoved;
    } finally {
      this.inFlight.delete(symbol);
    }
  }

  private async updateStopOrder(
    symbol: string,
    position: Position,
    stopOrder: Order,
    price: number,
    now: number
  ): Promise<TrailingStopMoved | null> {
    const portfolioPosition = toPortfolioPosition(position, stopOrder.stopPrice as number);
    const result = this.manager.updateStopLoss(portfolioPosition, price, now);
    if (!result.stopUpdated || result.reason === 'NO_CHANGE') return null;

    try {
      const replacement = await this.submitReplacementOrder(stopOrder, result.newStop, 'TRAILING_STOP_REPLACED');
      if (!replacement) return null;

      metrics.inc('trailing_stop_updates_total');
      const moved: TrailingStopMoved = {
        symbol,
        side: portfolioPosition.side,
        previousStop: result.previousStop,
        newStop: result.newStop,
        reason: result.reason,
        orderId: replacement.id,
      };
      logger.info(moved, '[TrailingStopController] Stop order moved');
      this.onStopMoved?.(moved);
      return moved;
    } catch (error) {
      logger.error(
        { symbol, error: error instanceof Error ? error.message : error },
        '[TrailingStopController] Failed to move stop order'
      );
      metrics.inc('trailing_stop_errors_total');
      return null;
    }
  }

  private async updateTpOrder(
    symbol: string,
    position: Position,
    tpOrder: Order,
    price: number,
    now: number
  ): Promise<TrailingTpMoved | null> {
    const portfolioPosition = toPortfolioPosition(position, tpOrder.stopPrice as number);
    const result = this.manager.updateTakeProfit(portfolioPosition, tpOrder.stopPrice as number, price, now);
    if (!result.tpUpdated || result.reason === 'NO_CHANGE') return null;

    try {
      const replacement = await this.submitReplacementOrder(tpOrder, result.newTp, 'TRAILING_TP_REPLACED');
      if (!replacement) return null;

      metrics.inc('trailing_tp_updates_total');
      const moved: TrailingTpMoved = {
        symbol,
        side: portfolioPosition.side,
        previousTp: result.previousTp,
        newTp: result.newTp,
        reason: result.reason,
        orderId: replacement.id,
      };
      logger.info(moved, '[TrailingStopController] Take-profit order moved');
      this.onTpMoved?.(moved);
      return moved;
    } catch (error) {
      logger.error(
        { symbol, error: error instanceof Error ? error.message : error },
        '[TrailingStopController] Failed to move take-profit order'
      );
      metrics.inc('trailing_tp_errors_total');
      return null;
    }
  }

  /** Drop per-symbol tracking once a position is flat. */
  forget(symbol: string): void {
    this.lastUpdateAt.delete(symbol);
    this.manager.onPositionClosed(symbol, 'LONG');
    this.manager.onPositionClosed(symbol, 'SHORT');
  }

  /**
   * Cancel the resting order and place its replacement (a moved stop or an
   * extended take-profit). The old order is only cancelled once we know the
   * replacement was accepted, so a rejected replacement can never leave the
   * position unprotected or untargeted.
   */
  private async submitReplacementOrder(
    existing: Order,
    newTriggerPrice: number,
    cancelReason: string
  ): Promise<Order | null> {
    const replacement = await this.broker.submitOrder({
      symbol: existing.symbol,
      side: existing.side,
      type: existing.type,
      quantity: existing.quantity - existing.filledQty,
      stopPrice: newTriggerPrice,
      leverage: existing.leverage,
      strategyId: existing.strategyId,
      signalId: existing.signalId,
      reduceOnly: true,
      workingType: 'MARK_PRICE',
    });

    if (replacement.status === 'REJECTED') {
      logger.warn(
        { symbol: existing.symbol, reason: replacement.rejectReason },
        '[TrailingStopController] Replacement order rejected, keeping original'
      );
      return null;
    }

    await this.broker.cancelOrder(existing.id, cancelReason);
    return replacement;
  }
}
