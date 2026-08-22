import type { PaperBrokerConfig } from './types.js';

export class PaperSlippageModel {
  static applySlippage(
    expectedPrice: number,
    side: 'BUY' | 'SELL',
    config: PaperBrokerConfig,
    tickSize = 0.01
  ): { fillPrice: number; slippageAmount: number } {
    if (config.slippageModel === 'NONE') {
      return { fillPrice: expectedPrice, slippageAmount: 0 };
    }

    let diff = 0;
    if (config.slippageModel === 'FIXED_TICKS') {
      diff = (config.slippageFixedTicks ?? 1) * tickSize;
    } else if (config.slippageModel === 'BPS') {
      diff = expectedPrice * ((config.slippageBps ?? 5) / 10_000);
    }

    const fillPrice = side === 'BUY' ? expectedPrice + diff : expectedPrice - diff;
    return {
      fillPrice: Number(fillPrice.toFixed(4)),
      slippageAmount: Number(diff.toFixed(4)),
    };
  }
}
