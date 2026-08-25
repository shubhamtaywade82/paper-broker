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
    if (order.status !== 'NEW' && order.status !== 'PARTIALLY_FILLED') return null;

    if (order.type === 'LIMIT') {
      return this.checkLimitFill(order, candle, config, tickSize);
    }
    if (order.type === 'STOP' || order.type === 'STOP_MARKET') {
      return this.checkStopFill(order, candle, config, tickSize);
    }
    if (order.type === 'TAKE_PROFIT') {
      return this.checkTakeProfitFill(order, candle, config, tickSize, true);
    }
    if (order.type === 'TAKE_PROFIT_MARKET') {
      return this.checkTakeProfitFill(order, candle, config, tickSize, false);
    }
    return null;
  }

  private static calculateFillQty(order: PaperOrder, candle: Candle): number {
    const remainingQty = order.quantity - (order.filledQuantity ?? 0);
    if (remainingQty <= 0) return 0;
    const vol = candle.volume ?? 1000;
    return vol > 0 ? Math.min(remainingQty, vol) : remainingQty;
  }

  private static applyFill(order: PaperOrder, fillQty: number): void {
    order.filledQuantity = (order.filledQuantity ?? 0) + fillQty;
    if (order.filledQuantity >= order.quantity) {
      order.status = 'FILLED';
    } else {
      order.status = 'PARTIALLY_FILLED';
    }
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

    const basePrice =
      order.side === 'BUY' && candle.open < limitPrice
        ? candle.open
        : order.side === 'SELL' && candle.open > limitPrice
        ? candle.open
        : limitPrice;

    const fillQty = this.calculateFillQty(order, candle);
    if (fillQty <= 0) return null;

    const { fillPrice, slippageAmount } = PaperSlippageModel.applySlippage(basePrice, order.side, config, tickSize);
    const fee = PaperFeeModel.calculateFee(fillPrice * fillQty, true, config.makerFeeRate, config.takerFeeRate);

    this.applyFill(order, fillQty);

    return {
      id: `FILL:${order.id}:${candle.openTime}`,
      orderId: order.id,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      price: fillPrice,
      quantity: fillQty,
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
    const stopPrice = order.stopPrice ?? order.price ?? 0;
    if (stopPrice <= 0) return null;

    const isHit = order.side === 'SELL' ? candle.low <= stopPrice : candle.high >= stopPrice;
    if (!isHit) return null;

    const basePrice =
      order.side === 'SELL' && candle.open < stopPrice
        ? candle.open
        : order.side === 'BUY' && candle.open > stopPrice
        ? candle.open
        : stopPrice;

    const fillQty = this.calculateFillQty(order, candle);
    if (fillQty <= 0) return null;

    const { fillPrice, slippageAmount } = PaperSlippageModel.applySlippage(basePrice, order.side, config, tickSize);
    const fee = PaperFeeModel.calculateFee(fillPrice * fillQty, false, config.makerFeeRate, config.takerFeeRate);

    this.applyFill(order, fillQty);

    return {
      id: `FILL:${order.id}:${candle.openTime}`,
      orderId: order.id,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      price: fillPrice,
      quantity: fillQty,
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
    tickSize: number,
    isLimit = true
  ): PaperFill | null {
    const tpPrice = order.price ?? order.stopPrice ?? 0;
    if (tpPrice <= 0) return null;

    const isHit = order.side === 'SELL' ? candle.high >= tpPrice : candle.low <= tpPrice;
    if (!isHit) return null;

    const basePrice =
      order.side === 'SELL' && candle.open > tpPrice
        ? candle.open
        : order.side === 'BUY' && candle.open < tpPrice
        ? candle.open
        : tpPrice;

    const fillQty = this.calculateFillQty(order, candle);
    if (fillQty <= 0) return null;

    const { fillPrice, slippageAmount } = PaperSlippageModel.applySlippage(basePrice, order.side, config, tickSize);
    const fee = PaperFeeModel.calculateFee(fillPrice * fillQty, isLimit, config.makerFeeRate, config.takerFeeRate);

    this.applyFill(order, fillQty);

    return {
      id: `FILL:${order.id}:${candle.openTime}`,
      orderId: order.id,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      price: fillPrice,
      quantity: fillQty,
      fee,
      slippage: slippageAmount,
      isMaker: isLimit,
      timestamp: candle.closeTime ?? candle.openTime,
      positionId: order.positionId,
    };
  }
}
