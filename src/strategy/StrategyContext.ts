import type {
  AccountState,
  MarketState,
  Order,
  OrderCommand,
  Position,
} from '../broker/types.js';
import type { Candle } from './indicators.js';

export interface KlineStore {
  getCandles(symbol: string, interval: string, limit: number): Candle[];
}

export interface StrategyContext {
  strategyId: string;

  getMarket(symbol: string): MarketState | undefined;

  getCandles(symbol: string, interval: string, limit: number): Candle[];

  getAccount(): AccountState;

  getPosition(symbol: string): Position | undefined;

  getOpenOrders(symbol?: string): Order[];

  hasOpenPosition(symbol: string): boolean;

  hasOpenOrder(symbol?: string): boolean;

  submitOrder(order: OrderCommand): Order;
}

export function createStrategyContext(
  strategyId: string,
  marketState: (symbol: string) => MarketState | undefined,
  klines: KlineStore,
  account: () => AccountState,
  positions: (symbol: string) => Position | undefined,
  openOrders: (symbol?: string) => Order[],
  submitOrder: (order: OrderCommand) => Order
): StrategyContext {
  return {
    strategyId,
    getMarket: marketState,
    getCandles: (symbol, interval, limit) => klines.getCandles(symbol, interval, limit),
    getAccount: account,
    getPosition: positions,
    getOpenOrders: openOrders,
    hasOpenPosition: (symbol) => {
      const position = positions(symbol);
      return !!position && position.qty !== 0;
    },
    hasOpenOrder: (symbol) => openOrders(symbol).length > 0,
    submitOrder,
  };
}