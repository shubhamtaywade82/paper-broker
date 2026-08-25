import { Decimal } from 'decimal.js';

export interface FeeModelConfig {
  takerBps: number;
  makerBps: number;
}

export const DEFAULT_FEE_CONFIG: FeeModelConfig = {
  takerBps: 4,
  makerBps: 2,
};

export class PaperFeeModel {
  readonly cfg: FeeModelConfig;

  constructor(cfg: Partial<FeeModelConfig> = {}) {
    this.cfg = {
      takerBps: cfg.takerBps ?? DEFAULT_FEE_CONFIG.takerBps,
      makerBps: cfg.makerBps ?? DEFAULT_FEE_CONFIG.makerBps,
    };
  }

  compute(role: 'maker' | 'taker', price: number, quantity: number): number {
    const bps = role === 'maker' ? this.cfg.makerBps : this.cfg.takerBps;
    return new Decimal(price).times(quantity).times(bps).div(10_000).toDecimalPlaces(4).toNumber();
  }

  /** Static helper for legacy callers */
  static calculateFee(
    notional: number,
    isMaker: boolean,
    makerRate = DEFAULT_FEE_CONFIG.makerBps / 10_000,
    takerRate = DEFAULT_FEE_CONFIG.takerBps / 10_000
  ): number {
    const rate = isMaker ? makerRate : takerRate;
    return Number((Math.abs(notional) * rate).toFixed(4));
  }

  /** Composition-root guard: both engines must share fee semantics (H-12). */
  assertEqual(other: PaperFeeModel): void {
    if (this.cfg.takerBps !== other.cfg.takerBps || this.cfg.makerBps !== other.cfg.makerBps) {
      throw new Error(
        `FeeModel divergence: live (${this.cfg.makerBps}/${this.cfg.takerBps} bps) vs other (${other.cfg.makerBps}/${other.cfg.takerBps} bps)`
      );
    }
  }
}
