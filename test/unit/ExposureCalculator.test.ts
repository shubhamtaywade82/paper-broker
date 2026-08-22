import { describe, it, expect } from 'vitest';
import { ExposureCalculator } from '../../src/trading/risk/ExposureCalculator.js';
import type { PortfolioPosition } from '../../src/trading/risk/types.js';

describe('Phase 7 — Exposure Calculator', () => {
  it('calculates gross, net, directional and risk-at-stop exposures', () => {
    const positions: PortfolioPosition[] = [
      { symbol: 'SOLUSDT', side: 'LONG', quantity: 100, entryPrice: 100, stopLossPrice: 98, notional: 10000, unrealizedPnl: 200 },
      { symbol: 'BTCUSDT', side: 'SHORT', quantity: 0.5, entryPrice: 60000, stopLossPrice: 61000, notional: 30000, unrealizedPnl: -100 },
    ];

    const exp = ExposureCalculator.calculateExposure(positions);
    expect(exp.grossNotional).toBe(40000);
    expect(exp.longNotional).toBe(10000);
    expect(exp.shortNotional).toBe(30000);
    expect(exp.netNotional).toBe(-20000);
    // SOL risk = 100 * 2 = 200; BTC risk = 0.5 * 1000 = 500 -> total = 700
    expect(exp.totalRiskAtStop).toBe(700);
    expect(exp.openPositionsCount).toBe(2);
    expect(exp.symbolPositionsCount['SOLUSDT']).toBe(1);
    expect(exp.symbolPositionsCount['BTCUSDT']).toBe(1);
  });
});
