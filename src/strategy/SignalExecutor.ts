import type { PaperBroker } from '../broker/PaperBroker.js';
import type { MarketState } from '../broker/types.js';
import type { Signal } from './signal.js';
import type { SizingEngine } from './SizingEngine.js';
import type { OrderFactory } from './OrderFactory.js';
import type { SignalRepository } from '../persistence/repositories/SignalRepository.js';

export interface SignalExecutorDeps {
  broker: PaperBroker;
  sizing: SizingEngine;
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
    const { broker, sizing, orderFactory, signals, getMarketState } = this.deps;
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
        ? market?.bid
        : market?.ask;

    if (entryPrice === undefined) {
      log.warn(`[Signal] No price for ${signal.symbol}, skipping order`);
      return true;
    }

    const closeQty =
      signal.action.startsWith('CLOSE') && position ? Math.abs(position.qty) : 0;

    const instrument = broker.getInstrument(signal.symbol);
    const sized =
      signal.action.startsWith('OPEN') && instrument
        ? sizing.sizePosition({
            account: broker.getAccount(),
            instrument,
            entryPrice,
            stopLossPrice: signal.stopLossPrice ? Number(signal.stopLossPrice) : undefined,
          })
        : null;

    const quantity = closeQty > 0 ? closeQty : (sized?.quantity ?? 0);
    if (quantity <= 0) {
      log.warn(`[Signal] Zero quantity for ${signal.symbol} ${signal.action}, skipping`);
      return true;
    }

    const orderCommand = {
      symbol: signal.symbol,
      side: signal.action === 'OPEN_LONG' || signal.action === 'CLOSE_SHORT' ? 'BUY' : 'SELL',
      type: 'MARKET',
      quantity,
      leverage: 5,
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

      if (sized && signal.stopLossPrice) {
        const stop = orderFactory.buildStopLossOrder(signal, quantity);
        if (stop) {
          const stopOrder = broker.submitOrder(stop);
          if (stopOrder.status === 'REJECTED') {
            log.warn(`[Signal] Stop order rejected: ${stopOrder.rejectReason ?? 'unknown'}`);
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