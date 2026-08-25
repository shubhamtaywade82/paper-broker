import { describe, it, expect } from 'vitest';
import { PaperSlippageModel } from '../../src/broker/paper/PaperSlippageModel.js';
import type { PaperBrokerConfig } from '../../src/broker/paper/types.js';

const BASE_CONFIG: PaperBrokerConfig = {
  makerFeeRate: 0.0002,
  takerFeeRate: 0.0004,
  slippageModel: 'NONE',
  ambiguousIntrabarPolicy: 'REJECT_AMBIGUOUS',
  breakevenEnabled: false,
  breakevenTriggerR: 1,
  breakevenOffsetTicks: 1,
  trailingEnabled: false,
  trailingTriggerR: 1,
  trailingDistanceTicks: 1,
  maintenanceMarginRate: 0.005,
  fundingMode: 'DISABLED',
};

describe('PaperSlippageModel (Medium)', () => {
  it('applies zero slippage for NONE', () => {
    const res = PaperSlippageModel.applySlippage(100, 'BUY', { ...BASE_CONFIG, slippageModel: 'NONE' });
    expect(res.fillPrice).toBe(100);
    expect(res.slippageAmount).toBe(0);
  });

  it('applies FIXED_TICKS and BPS slippage in the expected direction', () => {
    const ticks = PaperSlippageModel.applySlippage(100, 'BUY', { ...BASE_CONFIG, slippageModel: 'FIXED_TICKS', slippageFixedTicks: 2 }, 0.5);
    expect(ticks.fillPrice).toBe(101); // 2 ticks * 0.5 = 1, BUY pays more
    expect(ticks.slippageAmount).toBe(1);

    const bps = PaperSlippageModel.applySlippage(100, 'SELL', { ...BASE_CONFIG, slippageModel: 'BPS', slippageBps: 10 });
    expect(bps.fillPrice).toBe(99.9); // 10bps of 100 = 0.1, SELL receives less
    expect(bps.slippageAmount).toBe(0.1);
  });

  it('throws rather than silently returning zero slippage for the unimplemented VOLATILITY model (Medium)', () => {
    // Previously fell through the if/else-if chain with no matching branch,
    // leaving `diff` at its initial 0 — identical to slippageModel: 'NONE',
    // with no error or warning, silently making backtests configured for
    // volatility-based slippage misleadingly optimistic.
    expect(() =>
      PaperSlippageModel.applySlippage(100, 'BUY', { ...BASE_CONFIG, slippageModel: 'VOLATILITY' })
    ).toThrow(/VOLATILITY.*not implemented/);
  });
});
