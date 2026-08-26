import { describe, expect, it } from 'vitest';
import { PaperLiquidation, type LeverageBracket } from '../../src/broker/paper/PaperLiquidation.js';

const BRACKETS: LeverageBracket[] = [
  { notionalCap: 10_000, maintenanceMarginRate: 0.005, maintenanceAmount: 0 },
  { notionalCap: 50_000, maintenanceMarginRate: 0.01, maintenanceAmount: 50 },
  { notionalCap: 250_000, maintenanceMarginRate: 0.02, maintenanceAmount: 550 },
];

describe('PaperLiquidation.selectBracket', () => {
  it('falls back to a single tier from the given rate when no brackets exist', () => {
    const bracket = PaperLiquidation.selectBracket(1_000_000, undefined, 0.004);
    expect(bracket.maintenanceMarginRate).toBe(0.004);
    expect(bracket.maintenanceAmount).toBe(0);
  });

  it('selects by notional, inclusive of the cap', () => {
    expect(PaperLiquidation.selectBracket(5_000, BRACKETS, 0.005).maintenanceMarginRate).toBe(0.005);
    expect(PaperLiquidation.selectBracket(10_000, BRACKETS, 0.005).maintenanceMarginRate).toBe(0.005);
    expect(PaperLiquidation.selectBracket(10_001, BRACKETS, 0.005).maintenanceMarginRate).toBe(0.01);
    expect(PaperLiquidation.selectBracket(60_000, BRACKETS, 0.005).maintenanceMarginRate).toBe(0.02);
  });

  it('applies the widest bracket above the largest cap', () => {
    expect(PaperLiquidation.selectBracket(9_000_000, BRACKETS, 0.005).maintenanceMarginRate).toBe(0.02);
  });

  it('tolerates an unordered bracket table', () => {
    const shuffled = [BRACKETS[2]!, BRACKETS[0]!, BRACKETS[1]!];
    expect(PaperLiquidation.selectBracket(5_000, shuffled, 0.005).maintenanceMarginRate).toBe(0.005);
  });
});

describe('PaperLiquidation.calculateLiquidationPrice', () => {
  it('keeps the original positional signature working', () => {
    const price = PaperLiquidation.calculateLiquidationPrice(100, 'LONG', 10, 0.005);
    expect(price).toBeGreaterThan(0);
    expect(price).toBeLessThan(100);
  });

  it('puts a LONG liquidation below entry and a SHORT above', () => {
    const long = PaperLiquidation.calculateLiquidationPrice({ entryPrice: 100, side: 'LONG', leverage: 10 });
    const short = PaperLiquidation.calculateLiquidationPrice({ entryPrice: 100, side: 'SHORT', leverage: 10 });

    expect(long).toBeLessThan(100);
    expect(short).toBeGreaterThan(100);
  });

  it('moves liquidation closer to entry as leverage rises', () => {
    const low = PaperLiquidation.calculateLiquidationPrice({ entryPrice: 100, side: 'LONG', leverage: 2 });
    const high = PaperLiquidation.calculateLiquidationPrice({ entryPrice: 100, side: 'LONG', leverage: 20 });

    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThan(100);
  });

  it('accounts for fees already charged — the old model ignored them', () => {
    const base = { entryPrice: 100, side: 'LONG' as const, leverage: 10, quantity: 10 };
    const feeless = PaperLiquidation.calculateLiquidationPrice(base);
    const withFees = PaperLiquidation.calculateLiquidationPrice({ ...base, fees: 20 });

    // Fees are gone from the margin balance, so a LONG liquidates sooner,
    // i.e. at a HIGHER price.
    expect(withFees).toBeGreaterThan(feeless);
  });

  it('accounts for funding already paid', () => {
    const base = { entryPrice: 100, side: 'SHORT' as const, leverage: 10, quantity: 10 };
    const noFunding = PaperLiquidation.calculateLiquidationPrice(base);
    const withFunding = PaperLiquidation.calculateLiquidationPrice({ ...base, funding: 20 });

    // A SHORT liquidates sooner at a LOWER price once funding has drained margin.
    expect(withFunding).toBeLessThan(noFunding);
  });

  it('liquidates a larger position sooner under a higher bracket', () => {
    const small = PaperLiquidation.calculateLiquidationPrice({
      entryPrice: 100,
      side: 'LONG',
      leverage: 10,
      quantity: 50, // 5,000 notional -> 0.5% tier
      brackets: BRACKETS,
    });
    const large = PaperLiquidation.calculateLiquidationPrice({
      entryPrice: 100,
      side: 'LONG',
      leverage: 10,
      quantity: 1_000, // 100,000 notional -> 2% tier
      brackets: BRACKETS,
    });

    // This is the whole point of tiering: identical entry and leverage, but the
    // larger position carries a higher maintenance requirement.
    expect(large).toBeGreaterThan(small);
  });

  it('respects a supplied initialMargin over the leverage-derived default', () => {
    const base = { entryPrice: 100, side: 'LONG' as const, leverage: 10, quantity: 10 };
    const derived = PaperLiquidation.calculateLiquidationPrice(base);
    const overCollateralised = PaperLiquidation.calculateLiquidationPrice({ ...base, initialMargin: 500 });

    // More margin posted than leverage implies -> more room before liquidation.
    expect(overCollateralised).toBeLessThan(derived);
  });

  it('never returns a negative price', () => {
    const price = PaperLiquidation.calculateLiquidationPrice({
      entryPrice: 100,
      side: 'LONG',
      leverage: 1,
      quantity: 1,
      fees: 0,
    });
    expect(price).toBeGreaterThanOrEqual(0);
  });

  it('returns 0 for a non-positive or non-finite entry price', () => {
    expect(PaperLiquidation.calculateLiquidationPrice({ entryPrice: 0, side: 'LONG', leverage: 5 })).toBe(0);
    expect(PaperLiquidation.calculateLiquidationPrice({ entryPrice: Number.NaN, side: 'LONG', leverage: 5 })).toBe(0);
  });
});
