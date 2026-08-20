import type {
  OrderCommand,
  OrderSide,
  OrderType,
} from '../broker/types.js';
import type { Signal } from './signal.js';

export interface OrderFactoryConfig {
  defaultLeverage: number;
}

export interface BuildOrderParams {
  signal: Signal;
  quantity: number;
  leverage?: number;
}

export class OrderFactory {
  private config: OrderFactoryConfig;

  constructor(config: Partial<OrderFactoryConfig> = {}) {
    this.config = {
      defaultLeverage: 5,
      ...config,
    };
  }

  buildOrder(params: BuildOrderParams): OrderCommand | null {
    const { signal, quantity } = params;

    if (signal.action === 'HOLD' || signal.action === 'CANCEL_ALL') return null;

    const leverage = params.leverage ?? this.config.defaultLeverage;
    const base: Omit<OrderCommand, 'side' | 'type' | 'reduceOnly'> = {
      symbol: signal.symbol,
      quantity,
      leverage,
      strategyId: signal.strategyId,
      signalId: signal.id,
    };

    switch (signal.action) {
      case 'OPEN_LONG':
        return {
          ...base,
          side: 'BUY',
          type: 'MARKET',
          reduceOnly: false,
        };

      case 'OPEN_SHORT':
        return {
          ...base,
          side: 'SELL',
          type: 'MARKET',
          reduceOnly: false,
        };

      case 'CLOSE_LONG':
        return {
          ...base,
          side: 'SELL',
          type: 'MARKET',
          reduceOnly: true,
        };

      case 'CLOSE_SHORT':
        return {
          ...base,
          side: 'BUY',
          type: 'MARKET',
          reduceOnly: true,
        };

      default:
        return null;
    }
  }

  buildStopLossOrder(signal: Signal, quantity: number, leverage?: number): OrderCommand | null {
    if (!signal.stopLossPrice) return null;

    const common = {
      symbol: signal.symbol,
      quantity,
      leverage: leverage ?? this.config.defaultLeverage,
      strategyId: signal.strategyId,
      signalId: signal.id,
      reduceOnly: true,
      workingType: 'MARK_PRICE' as const,
    };

    if (signal.action === 'OPEN_LONG') {
      return {
        ...common,
        side: 'SELL' as OrderSide,
        type: 'STOP_MARKET' as OrderType,
        stopPrice: Number(signal.stopLossPrice),
      };
    }

    if (signal.action === 'OPEN_SHORT') {
      return {
        ...common,
        side: 'BUY' as OrderSide,
        type: 'STOP_MARKET' as OrderType,
        stopPrice: Number(signal.stopLossPrice),
      };
    }

    return null;
  }
}