import { describe, it, expect } from 'vitest';
import { PositionSizer } from '../../src/trading/risk/PositionSizer.js';
import type { Instrument } from '../../src/broker/types.js';

function makeMockInstrument(): Instrument {
  return {
    symbol: 'SOLUSDT',
    baseAsset: 'SOL',
    quoteAsset: 'USDT',
    contractType: 'PERPETUAL',
    status: 'TRADING',
    tickSize: '0.01',
    stepSize: '0.001',
    minQty: '0.001',
    maxQty: '10000',
    minNotional: '5.0',
    pricePrecision: 2,
    quantityPrecision: 3,
    maintenanceMarginRate: '0.005',
    createdAtUtc: new Date().toISOString(),
    updatedAtUtc: new Date().toISOString(),
  };
}

describe('Phase 7 — Position Sizer', () => {
  it('calculates exact risk-budgeted position size for Long', () => {
    // Equity: 10,000, Risk: 1% ($100), Entry: 100, SL: 98 -> stopDist = 2
    // Raw quantity = 100 / 2 = 50.0 SOL
    const inst = makeMockInstrument();
    const res = PositionSizer.calculatePositionSize(10000, 0.01, 100, 98, inst, 5);

    expect(res.failureReason).toBeUndefined();
    expect(res.sizing?.quantity).toBe(50.0);
    expect(res.sizing?.riskCapital).toBe(100);
    expect(res.sizing?.positionNotional).toBe(5000);
    expect(res.sizing?.requiredMargin).toBe(1000);
  });

  it('normalizes quantity to instrument stepSize and precision', () => {
    // Equity: 10,000, Risk: 1% ($100), Entry: 75.70, SL: 75.45 -> stopDist = 0.25
    // Raw qty = 100 / 0.25 = 400.0 SOL
    const inst = makeMockInstrument();
    const res = PositionSizer.calculatePositionSize(10000, 0.01, 75.70, 75.45, inst, 5);

    expect(res.failureReason).toBeUndefined();
    expect(res.sizing?.quantity).toBe(400.0);
    expect(res.sizing?.positionNotional).toBe(30280);
  });

  it('rejects zero or negative stop distance', () => {
    const inst = makeMockInstrument();
    const res = PositionSizer.calculatePositionSize(10000, 0.01, 100, 100, inst, 5);
    expect(res.failureReason).toBe('ZERO_STOP_DISTANCE');
  });

  it('rejects sizing below minNotional', () => {
    const inst = makeMockInstrument();
    // Equity: $10, Risk: 1% ($0.10), stopDist: 2 -> qty: 0.05 SOL -> notional: 0.05 * 100 = $5 (exactly 5.0)
    // If equity is $5 -> riskCapital $0.05 -> qty 0.025 -> notional $2.5 < minNotional 5.0
    const res = PositionSizer.calculatePositionSize(5, 0.01, 100, 98, inst, 5);
    expect(res.failureReason).toContain('SUB_MIN_NOTIONAL');
  });
});
