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
    } else if (config.slippageModel === 'VOLATILITY') {
      // Medium finding: 'VOLATILITY' is a declared PaperBrokerConfig option
      // but was never implemented — falling through this if/else-if chain
      // silently left `diff` at 0, identical to slippageModel: 'NONE', with
      // no error or warning. A backtest configured for volatility-based
      // slippage would silently get zero slippage instead, producing
      // misleadingly optimistic results. Fail loudly instead of guessing
      // (AGENTS.md: "prefer safe failure to guessing") until this is
      // actually implemented — it needs ATR/volatility data this static
      // method doesn't currently receive, a signature change beyond this fix.
      throw new Error(
        "PaperSlippageModel: slippageModel 'VOLATILITY' is not implemented. Use 'NONE', 'FIXED_TICKS', or 'BPS'."
      );
    }

    const fillPrice = side === 'BUY' ? expectedPrice + diff : expectedPrice - diff;
    return {
      fillPrice: Number(fillPrice.toFixed(4)),
      slippageAmount: Number(diff.toFixed(4)),
    };
  }
}
