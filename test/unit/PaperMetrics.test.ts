import { describe, it, expect } from 'vitest';
import { PaperMetrics } from '../../src/broker/paper/PaperMetrics.js';
import type { PaperTradeRecord } from '../../src/broker/paper/types.js';

function makeTrade(netPnl: number, exitTimestamp: number): PaperTradeRecord {
  return {
    tradeId: `TRD:${exitTimestamp}`,
    signalId: 'sig',
    symbol: 'SOLUSDT',
    setupType: 'TEST',
    direction: 'LONG',
    entryPrice: 100,
    initialStopLoss: 95,
    finalStopLoss: 95,
    tp1Price: 105,
    tp2Price: 110,
    tp3Price: 115,
    quantity: 10,
    leverage: 5,
    fees: 0,
    grossPnl: netPnl,
    netPnl,
    maxFavorableExcursion: 0,
    maxAdverseExcursion: 0,
    entryTimestamp: exitTimestamp - 1000,
    exitTimestamp,
    status: 'CLOSED',
    lifecycle: ['CLOSED'],
  };
}

describe('PaperMetrics.calculateMetrics — maxDrawdown', () => {
  it('computes the peak-to-trough drop across the equity curve, not a hardcoded 0', () => {
    // Equity curve: +100 -> +150 (peak) -> -50 (trough, drawdown 200) -> +20
    const trades = [makeTrade(100, 1000), makeTrade(50, 2000), makeTrade(-200, 3000), makeTrade(70, 4000)];
    const metrics = PaperMetrics.calculateMetrics(trades);
    expect(metrics.maxDrawdown).toBe(200);
  });

  it('is 0 for a monotonically winning sequence (no peak-to-trough drop)', () => {
    const trades = [makeTrade(50, 1000), makeTrade(30, 2000), makeTrade(20, 3000)];
    const metrics = PaperMetrics.calculateMetrics(trades);
    expect(metrics.maxDrawdown).toBe(0);
  });

  it('sorts by exitTimestamp rather than trusting array order', () => {
    // Same trades as the first test, passed in reverse (out-of-order) input order.
    const trades = [makeTrade(70, 4000), makeTrade(-200, 3000), makeTrade(50, 2000), makeTrade(100, 1000)];
    const metrics = PaperMetrics.calculateMetrics(trades);
    expect(metrics.maxDrawdown).toBe(200);
  });
});
