import type { Candle } from '../../strategy/indicators.js';
import { PaperFeeModel } from './PaperFeeModel.js';
import { PaperSlippageModel } from './PaperSlippageModel.js';
import type { PaperBrokerConfig, PaperFill, PaperOrder } from './types.js';

export class PaperFillEngine {
  static evaluateOrderFill(
    order: PaperOrder,
    candle: Candle,
    config: PaperBrokerConfig,
    tickSize = 0.01
  ): PaperFill | null {
    if (order.status !== 'PENDING' && order.status !== 'NEW') return null;

    if (order.type === 'LIMIT') {
      return this.checkLimitFill(order, candle, config, tickSize);
    }
    if (order.type === 'STOP') {
      return this.checkStopFill(order, candle, config, tickSize);
    }
    if (order.type === 'TAKE_PROFIT') {
      return this.checkTakeProfitFill(order, candle, config, tickSize);
    }
    return null;
  }

  private static checkLimitFill(
    order: PaperOrder,
    candle: Candle,
    config: PaperBrokerConfig,
    tickSize: number
  ): PaperFill | null {
    const limitPrice = order.price ?? 0;
    if (limitPrice <= 0) return null;

    const isHit = order.side === 'BUY' ? candle.low <= limitPrice : candle.high >= limitPrice;
    if (!isHit) return null;

    const { fillPrice, slippageAmount } = PaperSlippageModel.applySlippage(limitPrice, order.side, config, tickSize);
    const fee = PaperFeeModel.calculateFee(fillPrice * order.quantity, true, config.makerFeeRate, config.takerFeeRate);

    return {
      id: `FILL:${order.id}:${candle.openTime}`,
      orderId: order.id,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      price: fillPrice,
      quantity: order.quantity,
      fee,
      slippage: slippageAmount,
      isMaker: true,
      timestamp: candle.closeTime ?? candle.openTime,
      positionId: order.positionId,
    };
  }

  private static checkStopFill(
    order: PaperOrder,
    candle: Candle,
    config: PaperBrokerConfig,
    tickSize: number
  ): PaperFill | null {
    const stopPrice = order.stopPrice ?? 0;
    if (stopPrice <= 0) return null;

    const isHit = order.side === 'SELL' ? candle.low <= stopPrice : candle.high >= stopPrice;
    if (!isHit) return null;

    const { fillPrice, slippageAmount } = PaperSlippageModel.applySlippage(stopPrice, order.side, config, tickSize);
    const fee = PaperFeeModel.calculateFee(fillPrice * order.quantity, false, config.makerFeeRate, config.takerFeeRate);

    return {
      id: `FILL:${order.id}:${candle.openTime}`,
      orderId: order.id,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      price: fillPrice,
      quantity: order.quantity,
      fee,
      slippage: slippageAmount,
      isMaker: false,
      timestamp: candle.closeTime ?? candle.openTime,
      positionId: order.positionId,
    };
  }

  private static checkTakeProfitFill(
    order: PaperOrder,
    candle: Candle,
    config: PaperBrokerConfig,
    tickSize: number
  ): PaperFill | null {
    const tpPrice = order.price ?? 0;
    if (tpPrice <= 0) return null;

    const isHit = order.side === 'SELL' ? candle.high >= tpPrice : candle.low <= tpPrice;
    if (!isHit) return null;

    const { fillPrice, slippageAmount } = PaperSlippageModel.applySlippage(tpPrice, order.side, config, tickSize);
    const fee = PaperFeeModel.calculateFee(fillPrice * order.quantity, true, config.makerFeeRate, config.takerFeeRate);

    return {
      id: `FILL:${order.id}:${candle.openTime}`,
      orderId: order.id,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      price: fillPrice,
      quantity: order.quantity,
      fee,
      slippage: slippageAmount,
      isMaker: true,
      timestamp: candle.closeTime ?? candle.openTime,
      positionId: order.positionId,
    };
  }
}
