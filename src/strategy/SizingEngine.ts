import { Decimal } from 'decimal.js';
import type { Instrument } from '../broker/types.js';

/**
 * Minimal account shape SizingEngine needs. Only `equity` is used — risk per
 * trade is computed as a fraction of equity. Kept narrow so callers (e.g.
 * SignalExecutor's fallback resolver) can pass a partial account view
 * without constructing the full AccountState aggregate.
 */
export interface SizingAccount {
  equity: number;
}

export interface SizingConfig {
  riskPerTrade: number;
  maxNotional: number;
  fallbackRiskPerTrade?: number;
}

export interface SizeResult {
  quantity: number;
  notional: number;
  reason: string;
}

const D = (v: string | number | Decimal) => new Decimal(v);

function roundStep(value: Decimal, stepSize: Decimal): Decimal {
  return value.div(stepSize).floor().mul(stepSize);
}

export class SizingEngine {
  private riskPerTrade: number;
  private maxNotional: number;
  private fallbackRiskPerTrade: number;

  constructor(config: Partial<SizingConfig> = {}) {
    this.riskPerTrade = config.riskPerTrade ?? 0.005;
    this.maxNotional = config.maxNotional ?? 5000;
    this.fallbackRiskPerTrade = config.fallbackRiskPerTrade ?? 0.1;
  }

  sizePosition(params: {
    account: SizingAccount;
    instrument: Instrument;
    entryPrice: number;
    stopLossPrice?: number;
  }): SizeResult {
    const { account, instrument, entryPrice, stopLossPrice } = params;

    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      throw new Error('Invalid entry price');
    }

    let quantity: Decimal;

    if (stopLossPrice !== undefined && Number.isFinite(stopLossPrice) && stopLossPrice > 0) {
      const stopDistance = D(entryPrice).sub(stopLossPrice).abs();
      if (stopDistance.lte(0)) {
        quantity = D(0);
      } else {
        const riskAmount = D(account.equity).mul(this.riskPerTrade);
        quantity = riskAmount.div(stopDistance);
      }
    } else {
      const fallbackNotional = D(account.equity).mul(this.fallbackRiskPerTrade);
      quantity = fallbackNotional.div(entryPrice);
    }

    const notional = D(quantity).mul(entryPrice);
    const maxNotional = D(this.maxNotional);

    if (notional.gt(maxNotional)) {
      quantity = maxNotional.div(entryPrice);
    }

    const stepSize = D(instrument.stepSize);
    const minQty = D(instrument.minQty);
    const minNotional = D(instrument.minNotional);

    quantity = roundStep(quantity, stepSize);

    if (quantity.lt(minQty)) {
      quantity = roundStep(minQty, stepSize);
    }

    const finalNotional = D(quantity).mul(entryPrice);

    if (finalNotional.lt(minNotional) || quantity.lte(0)) {
      throw new Error(
        `Position too small: notional ${finalNotional.toFixed(2)} < minNotional ${minNotional.toFixed(2)}`
      );
    }

    return {
      quantity: quantity.toNumber(),
      notional: finalNotional.toNumber(),
      reason:
        stopLossPrice !== undefined
          ? `risk-based: ${this.riskPerTrade * 100}% of equity / stop distance`
          : `fallback: ${this.fallbackRiskPerTrade * 100}% of equity notional`,
    };
  }

  sizeClose(positionQty: number, reduceQty?: number): number {
    const qty = reduceQty ?? Math.abs(positionQty);
    return Math.min(Math.abs(positionQty), qty);
  }
}