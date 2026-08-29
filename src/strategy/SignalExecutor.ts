import type { ExecutionBroker, MarketState } from '../broker/types.js';
import type { Signal } from './signal.js';
import type { OrderFactory } from './OrderFactory.js';
import type { SignalRepository } from '../persistence/repositories/SignalRepository.js';

export interface SignalExecutorDeps {
  /**
   * Widened from PaperBroker to ExecutionBroker so orders can be routed
   * through ExecutionRouter, which applies the mode profile and the live
   * trading guard before anything reaches a venue. The executor must not know
   * or care which broker is behind the interface.
   */
  broker: ExecutionBroker;
  orderFactory: OrderFactory;
  signals: SignalRepository;
  getMarketState: (symbol: string) => MarketState | undefined;
  logger?: {
    warn: (msg: string) => void;
    error: (error: unknown, msg: string) => void;
  };
}

export class SignalExecutor {
  private deps: SignalExecutorDeps;

  constructor(deps: SignalExecutorDeps) {
    this.deps = deps;
  }

  async execute(signal: Signal): Promise<boolean> {
    const { broker, orderFactory, signals, getMarketState } = this.deps;
    const log = this.deps.logger ?? {
      warn: () => undefined,
      error: () => undefined,
    };

    if (signal.action === 'HOLD' || signal.action === 'CANCEL_ALL') {
      return true;
    }

    const position = await broker.getPosition(signal.symbol);
    const market = getMarketState(signal.symbol);

    const entryPrice =
      signal.action === 'CLOSE_LONG' || signal.action === 'OPEN_SHORT'
        ? market?.bid ?? market?.last ?? market?.mark
        : market?.ask ?? market?.last ?? market?.mark;

    if (entryPrice === undefined || !Number.isFinite(entryPrice) || entryPrice <= 0) {
      // H-18: this used to `return true` — StrategyEngine.processSignal treats
      // a truthy return as success and never marks the signal REJECTED or
      // fires onSignalRejected, so a skipped-for-no-price signal looked
      // identical to a genuinely executed one (no order, no rejection event,
      // no metric, ambiguous persisted status). CONTRACTS.md's Signal
      // Validation Contract requires rejection with an explicit reason, never
      // a silent drop.
      log.warn(`[Signal] No price for ${signal.symbol}, skipping order`);
      signals.updateStatus(signal.id, 'REJECTED', undefined, 'NO_MARKET_STATE');
      return false;
    }

    // Partial closes: when `features.closeFraction` is present (0..1), close
    // only that fraction of the current position instead of flattening it.
    // Used by the autonomous agent's ExitManager for downside de-risking
    // (SCALE_OUT). Absent or invalid → 1 (full close) — the historical
    // behaviour every other caller relies on.
    const rawFraction = Number(signal.features['closeFraction'] ?? 1);
    const closeFraction =
      Number.isFinite(rawFraction) && rawFraction > 0 ? Math.min(1, rawFraction) : 1;
    const closeQty =
      signal.action.startsWith('CLOSE') && position
        ? Math.abs(position.qty) * closeFraction
        : 0;
    const openQty = signal.action.startsWith('OPEN')
      ? Number(signal.features['quantity'] ?? 0)
      : 0;
    const leverage = Number(signal.features['leverage'] ?? 5);

    const quantity = closeQty > 0 ? closeQty : openQty;
    if (quantity <= 0) {
      // Same fix as the no-price case above — must not report success for a
      // signal that was never actually submitted to the broker.
      log.warn(`[Signal] Zero quantity for ${signal.symbol} ${signal.action}, skipping`);
      signals.updateStatus(signal.id, 'REJECTED', undefined, 'ZERO_QUANTITY');
      return false;
    }

    const orderCommand = orderFactory.buildOrder({ signal, quantity, leverage }) ?? {
      symbol: signal.symbol,
      side: signal.action === 'OPEN_LONG' || signal.action === 'CLOSE_SHORT' ? 'BUY' : 'SELL',
      type: 'MARKET',
      quantity,
      leverage,
      reduceOnly: signal.action.startsWith('CLOSE'),
      strategyId: signal.strategyId,
      signalId: signal.id,
    };

    try {
      const order = await broker.submitOrder(orderCommand);

      if (order.status === 'REJECTED') {
        log.warn(`[Signal] Order rejected: ${order.rejectReason ?? 'unknown'}`);
        signals.updateStatus(signal.id, 'REJECTED', undefined, order.rejectReason);
        return false;
      }

      signals.updateStatus(signal.id, 'EXECUTED', order.id);

      if (signal.action.startsWith('OPEN')) {
        if (signal.stopLossPrice) {
          const stop = orderFactory.buildStopLossOrder(signal, quantity, leverage);
          if (stop) {
            const stopOrder = await broker.submitOrder(stop);
            if (stopOrder.status === 'REJECTED') {
              log.warn(`[Signal] Stop order rejected: ${stopOrder.rejectReason ?? 'unknown'}`);
            }
          }
        }
        if (signal.takeProfitPrice) {
          const tp = orderFactory.buildTakeProfitOrder(signal, quantity, leverage);
          if (tp) {
            const tpOrder = await broker.submitOrder(tp);
            if (tpOrder.status === 'REJECTED') {
              log.warn(`[Signal] TP order rejected: ${tpOrder.rejectReason ?? 'unknown'}`);
            }
          }
        }
      }

      return true;
    } catch (error) {
      log.error(error, 'Signal order submission failed');
      // updateStatus(id, status, orderId?, rejectReason?) — the reason belongs
      // in the 4th slot; passing it 3rd wrote 'ORDER_SUBMISSION_ERROR' into the
      // signal's order_id column and left reject_reason null.
      signals.updateStatus(signal.id, 'REJECTED', undefined, 'ORDER_SUBMISSION_ERROR');
      return false;
    }
  }
}
