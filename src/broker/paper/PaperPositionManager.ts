import { PaperLiquidation } from './PaperLiquidation.js';
import type { PaperBrokerConfig, PaperFill, PaperPosition } from './types.js';

export class PaperPositionManager {
  static openPosition(
    fill: PaperFill,
    side: 'LONG' | 'SHORT',
    leverage: number,
    stopLossPrice: number,
    takeProfitPrices: number[],
    signalKey: string,
    setupId: string,
    executionPlanId: string,
    maintenanceMarginRate = 0.005
  ): PaperPosition {
    const notional = fill.price * fill.quantity;
    const initialMargin = notional / Math.max(1, leverage);
    const liqPrice = PaperLiquidation.calculateLiquidationPrice(fill.price, side, leverage, maintenanceMarginRate);

    return {
      id: `POS:${fill.orderId}`,
      symbol: fill.symbol,
      side,
      state: 'OPEN',
      quantity: fill.quantity,
      initialQuantity: fill.quantity,
      remainingQuantity: fill.quantity,
      averageEntryPrice: fill.price,
      currentMarkPrice: fill.price,
      liquidationPrice: liqPrice,
      leverage,
      initialMargin: Number(initialMargin.toFixed(2)),
      usedMargin: Number(initialMargin.toFixed(2)),
      unrealizedPnl: 0,
      realizedPnl: 0,
      fees: fill.fee,
      stopLossPrice,
      plannedStopPrice: stopLossPrice,
      takeProfitPrices,
      highestPriceReached: fill.price,
      lowestPriceReached: fill.price,
      openedAt: fill.timestamp,
      lifecycle: 'POSITION_OPEN',
      signalKey,
      setupId,
      executionPlanId,
    };
  }

  static updateMarkPrice(pos: PaperPosition, markPrice: number): void {
    pos.currentMarkPrice = markPrice;
    pos.highestPriceReached = Math.max(pos.highestPriceReached, markPrice);
    pos.lowestPriceReached = Math.min(pos.lowestPriceReached, markPrice);

    const diff = pos.side === 'LONG' ? markPrice - pos.averageEntryPrice : pos.averageEntryPrice - markPrice;
    pos.unrealizedPnl = Number((diff * pos.remainingQuantity).toFixed(4));
  }

  static applyPartialClose(pos: PaperPosition, fill: PaperFill): { realizedGross: number; realizedNet: number } {
    const closeQty = Math.min(pos.remainingQuantity, fill.quantity);
    const diff = pos.side === 'LONG' ? fill.price - pos.averageEntryPrice : pos.averageEntryPrice - fill.price;
    const realizedGross = Number((diff * closeQty).toFixed(4));
    const realizedNet = Number((realizedGross - fill.fee).toFixed(4));

    pos.remainingQuantity = Number((pos.remainingQuantity - closeQty).toFixed(4));
    pos.realizedPnl = Number((pos.realizedPnl + realizedGross).toFixed(4));
    pos.fees = Number((pos.fees + fill.fee).toFixed(4));

    const usedRatio = pos.initialQuantity > 0 ? pos.remainingQuantity / pos.initialQuantity : 0;
    pos.usedMargin = Number((pos.initialMargin * usedRatio).toFixed(2));

    if (pos.remainingQuantity <= 0) {
      pos.state = 'CLOSED';
      pos.closedAt = fill.timestamp;
      pos.lifecycle = 'CLOSED';
    }
    return { realizedGross, realizedNet };
  }

  static moveStopToBreakeven(pos: PaperPosition, offsetTicks = 2, tickSize = 0.01): boolean {
    const offset = offsetTicks * tickSize;
    const newStop = pos.side === 'LONG' ? pos.averageEntryPrice + offset : pos.averageEntryPrice - offset;

    // Must never loosen the stop
    if (pos.side === 'LONG' && newStop <= pos.stopLossPrice) return false;
    if (pos.side === 'SHORT' && newStop >= pos.stopLossPrice) return false;

    pos.stopLossPrice = Number(newStop.toFixed(4));
    pos.lifecycle = 'STOP_MOVED_TO_BREAKEVEN';
    return true;
  }

  static checkLiquidation(pos: PaperPosition, _config?: PaperBrokerConfig): boolean {
    if (pos.state !== 'OPEN') return false;
    const isLiq = pos.side === 'LONG'
      ? pos.currentMarkPrice <= pos.liquidationPrice
      : pos.currentMarkPrice >= pos.liquidationPrice;

    if (isLiq) {
      pos.state = 'CLOSED';
      pos.lifecycle = 'LIQUIDATED';
      pos.realizedPnl = -pos.usedMargin;
      return true;
    }
    return false;
  }
}
