import { describe, it, expect } from 'vitest';
import { PaperFundingModel } from '../../src/broker/paper/PaperFundingModel.js';
import type { PaperPosition } from '../../src/broker/paper/types.js';

function makeMockPosition(side: 'LONG' | 'SHORT', remainingQuantity = 100, currentMarkPrice = 100): PaperPosition {
  return {
    id: 'P1',
    symbol: 'SOLUSDT',
    side,
    state: 'OPEN',
    quantity: remainingQuantity,
    initialQuantity: remainingQuantity,
    remainingQuantity,
    averageEntryPrice: 100,
    currentMarkPrice,
    liquidationPrice: 80,
    leverage: 5,
    initialMargin: 2000,
    usedMargin: 2000,
    unrealizedPnl: 0,
    realizedPnl: 0,
    fees: 1.0,
    stopLossPrice: 95,
    plannedStopPrice: 95,
    takeProfitPrices: [105, 110, 115],
    highestPriceReached: 100,
    lowestPriceReached: 100,
    openedAt: 1000,
    lifecycle: 'POSITION_OPEN',
    signalKey: 'k1',
    setupId: 's1',
    executionPlanId: 'p1',
  };
}

describe('Phase 8.5 — Paper Funding Model', () => {
  it('charges funding to LONG when funding rate is positive', () => {
    // Long 100 SOL @ $100 = $10,000 notional.
    // Funding rate = +0.01% (+0.0001) -> Long pays $1.00 (-1.00 payment)
    const pos = makeMockPosition('LONG', 100, 100);
    const payment = PaperFundingModel.calculateFundingPayment(pos, 0.0001);
    expect(payment).toBe(-1.0);

    const res = PaperFundingModel.applyFundingToPosition(pos, 0.0001, 2000);
    expect(res.payment).toBe(-1.0);
    expect(pos.realizedPnl).toBe(-1.0);
  });

  it('credits funding to SHORT when funding rate is positive', () => {
    // Short 100 SOL @ $100 = $10,000 notional.
    // Funding rate = +0.01% (+0.0001) -> Short receives $1.00 (+1.00 payment)
    const pos = makeMockPosition('SHORT', 100, 100);
    const payment = PaperFundingModel.calculateFundingPayment(pos, 0.0001);
    expect(payment).toBe(1.0);

    const res = PaperFundingModel.applyFundingToPosition(pos, 0.0001, 2000);
    expect(res.payment).toBe(1.0);
    expect(pos.realizedPnl).toBe(1.0);
  });
});
