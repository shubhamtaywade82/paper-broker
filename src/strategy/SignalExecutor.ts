import type { PaperBroker } from '../broker/PaperBroker.js';
import type { MarketState } from '../broker/types.js';
import type { Signal } from './signal.js';
import type { OrderFactory } from './OrderFactory.js';
import type { SignalRepository } from '../persistence/repositories/SignalRepository.js';

export interface SignalExecutorDeps {
  broker: PaperBroker;
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

    const position = broker.getPosition(signal.symbol);
    const market = getMarketState(signal.symbol);

    const entryPrice =
      signal.action === 'CLOSE_LONG' || signal.action === 'OPEN_SHORT'
        ? market?.bid ?? market?.last ?? market?.mark
        : market?.ask ?? market?.last ?? market?.mark;

    if (entryPrice === undefined || !Number.isFinite(entryPrice) || entryPrice <= 0) {
      log.warn(`[Signal] No price for ${signal.symbol}, skipping order`);
      return true;
    }

    const closeQty =
      signal.action.startsWith('CLOSE') && position ? Math.abs(position.qty) : 0;
    const openQty = signal.action.startsWith('OPEN')
      ? Number(signal.features['quantity'] ?? 0)
      : 0;
    const leverage = Number(signal.features['leverage'] ?? 5);

    const quantity = closeQty > 0 ? closeQty : openQty;
    if (quantity <= 0) {
      log.warn(`[Signal] Zero quantity for ${signal.symbol} ${signal.action}, skipping`);
      return true;
    }

    const orderCommand = {
      symbol: signal.symbol,
      side: signal.action === 'OPEN_LONG' || signal.action === 'CLOSE_SHORT' ? 'BUY' : 'SELL',
      type: 'MARKET',
      quantity,
      leverage,
      reduceOnly: signal.action.startsWith('CLOSE'),
    } as const;

    try {
      const order = broker.submitOrder(orderCommand);

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
            const stopOrder = broker.submitOrder(stop);
            if (stopOrder.status === 'REJECTED') {
              log.warn(`[Signal] Stop order rejected: ${stopOrder.rejectReason ?? 'unknown'}`);
            }
          }
        }
        if (signal.takeProfitPrice) {
          const tp = orderFactory.buildTakeProfitOrder(signal, quantity, leverage);
          if (tp) {
            const tpOrder = broker.submitOrder(tp);
            if (tpOrder.status === 'REJECTED') {
              log.warn(`[Signal] TP order rejected: ${tpOrder.rejectReason ?? 'unknown'}`);
            }
          }
        }
      }

      return true;
    } catch (error) {
      log.error(error, 'Signal order submission failed');
      signals.updateStatus(signal.id, 'REJECTED', 'ORDER_SUBMISSION_ERROR');
      return false;
    }
  }
}
