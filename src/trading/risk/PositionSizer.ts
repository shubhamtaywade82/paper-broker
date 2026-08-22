import type { Instrument } from '../../broker/types.js';
import type { SizingResult } from '../signal/types.js';

export class PositionSizer {
  static calculatePositionSize(
    accountEquity: number,
    riskPercent: number,
    entryPrice: number,
    stopLossPrice: number,
    instrument?: Instrument,
    leverage = 5
  ): { sizing?: SizingResult; failureReason?: string } {
    if (accountEquity <= 0) return { failureReason: 'NON_POSITIVE_EQUITY' };
    if (riskPercent <= 0 || riskPercent > 1) return { failureReason: 'INVALID_RISK_PERCENT' };

    const stopDistance = Math.abs(entryPrice - stopLossPrice);
    if (stopDistance <= 0) return { failureReason: 'ZERO_STOP_DISTANCE' };

    const riskCapital = accountEquity * riskPercent;
    const riskQuantity = riskCapital / stopDistance;

    const maxNotionalFromMargin = accountEquity * leverage;
    const marginQuantity = maxNotionalFromMargin / entryPrice;
    const rawQuantity = Math.min(riskQuantity, marginQuantity);

    const step = instrument?.stepSize ? Number(instrument.stepSize) : 0.001;
    const precision = instrument?.quantityPrecision ?? 3;
    const quantity = Number((Math.floor(rawQuantity / step) * step).toFixed(precision));

    const minQty = instrument?.minQty ? Number(instrument.minQty) : 0.001;
    if (quantity < minQty) return { failureReason: `SUB_MIN_QTY (qty: ${quantity} < min: ${minQty})` };

    const maxQty = instrument?.maxQty ? Number(instrument.maxQty) : Infinity;
    if (quantity > maxQty) return { failureReason: `EXCEEDS_MAX_QTY (qty: ${quantity} > max: ${maxQty})` };

    const notional = quantity * entryPrice;
    const minNotional = instrument?.minNotional ? Number(instrument.minNotional) : 5.0;
    if (notional < minNotional) {
      return { failureReason: `SUB_MIN_NOTIONAL (notional: ${notional.toFixed(2)} < min: ${minNotional})` };
    }

    const requiredMargin = notional / Math.max(1, leverage);

    return {
      sizing: {
        accountEquity,
        riskPercent,
        riskCapital,
        stopDistance,
        quantity,
        positionNotional: Number(notional.toFixed(2)),
        requiredMargin: Number(requiredMargin.toFixed(2)),
        leverage,
      },
    };
  }
}
