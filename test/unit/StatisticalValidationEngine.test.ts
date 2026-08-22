import { describe, it, expect } from 'vitest';
import { StatisticalValidationEngine } from '../../src/research/analytics/StatisticalValidationEngine.js';
import type { PaperTradeRecord } from '../../src/broker/paper/types.js';

function makeMockTrade(id: string, netPnl: number, realizedRiskReward: number): PaperTradeRecord {
  return {
    tradeId: `T:${id}`,
    signalId: `S:${id}`,
    symbol: 'SOLUSDT',
    setupType: 'SSL_SWEEP_REVERSAL_LONG',
    direction: 'LONG',
    entryPrice: 100,
    exitPrice: 105,
    initialStopLoss: 95,
    finalStopLoss: 95,
    tp1Price: 105,
    tp2Price: 110,
    tp3Price: 115,
    quantity: 10,
    leverage: 5,
    fees: 1.0,
    grossPnl: netPnl + 1.0,
    netPnl,
    maxFavorableExcursion: 6.0,
    maxAdverseExcursion: 1.0,
    entryTimestamp: 1000,
    exitTimestamp: 5000,
    exitReason: netPnl > 0 ? 'TAKE_PROFIT' : 'STOP_LOSS',
    durationMs: 4000,
    plannedRiskReward: 2.0,
    realizedRiskReward,
    status: 'CLOSED',
    lifecycle: ['POSITION_OPEN', 'CLOSED'],
  };
}

describe('Phase 9 — Statistical Validation Engine', () => {
  it('classifies sample size confidence accurately', () => {
    // 10 trades -> INSUFFICIENT_SAMPLE
    const trades10 = Array.from({ length: 10 }, (_, i) => makeMockTrade(`${i}`, 100, 2.0));
    const res10 = StatisticalValidationEngine.validateTrades(trades10, 100);
    expect(res10.confidenceGrade).toBe('INSUFFICIENT_SAMPLE');
    expect(res10.sampleSize).toBe(10);

    // 40 trades -> LOW_CONFIDENCE
    const trades40 = Array.from({ length: 40 }, (_, i) => makeMockTrade(`${i}`, 100, 2.0));
    const res40 = StatisticalValidationEngine.validateTrades(trades40, 100);
    expect(res40.confidenceGrade).toBe('LOW_CONFIDENCE');

    // 150 trades -> MODERATE
    const trades150 = Array.from({ length: 150 }, (_, i) => makeMockTrade(`${i}`, 100, 2.0));
    const res150 = StatisticalValidationEngine.validateTrades(trades150, 100);
    expect(res150.confidenceGrade).toBe('MODERATE');

    // 350 trades -> STRONGER_SAMPLE
    const trades350 = Array.from({ length: 350 }, (_, i) => makeMockTrade(`${i}`, 100, 2.0));
    const res350 = StatisticalValidationEngine.validateTrades(trades350, 100);
    expect(res350.confidenceGrade).toBe('STRONGER_SAMPLE');
  });

  it('calculates bootstrap confidence intervals and statistical significance', () => {
    // 50 consistently winning trades
    const trades = Array.from({ length: 50 }, (_, i) => makeMockTrade(`${i}`, i % 5 === 0 ? -50 : 150, i % 5 === 0 ? -0.5 : 1.5));
    const res = StatisticalValidationEngine.validateTrades(trades, 200);

    expect(res.meanNetR).toBeGreaterThan(0.5);
    expect(res.meanNetRConfidenceInterval[0]).toBeGreaterThan(0);
    expect(res.meanNetRConfidenceInterval[1]).toBeGreaterThan(res.meanNetRConfidenceInterval[0]);
    expect(res.pValueMeanRGreaterThanZero).toBeLessThan(0.05);
    expect(res.isStatisticallySignificant).toBe(true);
  });
});
