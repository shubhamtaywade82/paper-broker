import { describe, it, expect } from 'vitest';
import { PerformanceAnalyzer } from '../../src/research/analytics/PerformanceAnalyzer.js';
import { ArchetypeBreakdown } from '../../src/research/analytics/ArchetypeBreakdown.js';
import { ConfluenceScoreValidator } from '../../src/research/analytics/ConfluenceScoreValidator.js';
import { RegimeAnalyzer } from '../../src/research/analytics/RegimeAnalyzer.js';
import { MonteCarloSimulator } from '../../src/research/analytics/MonteCarloSimulator.js';
import { WalkForwardValidator } from '../../src/research/analytics/WalkForwardValidator.js';
import type { PaperTradeRecord } from '../../src/broker/paper/types.js';
import type { TradeSignal } from '../../src/trading/signal/types.js';
import type { Candle } from '../../src/strategy/indicators.js';

function makeMockTrade(
  tradeId: string,
  setupType: string,
  direction: 'LONG' | 'SHORT',
  netPnl: number,
  realizedRiskReward = 2.0
): PaperTradeRecord {
  return {
    tradeId,
    signalId: `SIG:${tradeId}`,
    symbol: 'SOLUSDT',
    setupType,
    direction,
    entryPrice: 100,
    exitPrice: direction === 'LONG' ? 105 : 95,
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

describe('Phase 9 — Research Analytics Engine', () => {
  it('analyzes core performance and calculates max drawdown accurately', () => {
    const trades: PaperTradeRecord[] = [
      makeMockTrade('T1', 'SSL_SWEEP_REVERSAL_LONG', 'LONG', 200, 2.0),
      makeMockTrade('T2', 'SSL_SWEEP_REVERSAL_LONG', 'LONG', -100, -1.0),
      makeMockTrade('T3', 'BSL_SWEEP_REVERSAL_SHORT', 'SHORT', 300, 3.0),
    ];

    const perf = PerformanceAnalyzer.analyzeTrades(trades);
    expect(perf.totalTrades).toBe(3);
    expect(perf.winningTrades).toBe(2);
    expect(perf.losingTrades).toBe(1);
    expect(perf.netPnL).toBe(400);
    expect(perf.maxDrawdown).toBe(100);
  });

  it('evaluates archetype performance breakdowns independently', () => {
    const trades: PaperTradeRecord[] = [
      makeMockTrade('T1', 'SSL_SWEEP_REVERSAL_LONG', 'LONG', 200, 2.0),
      makeMockTrade('T2', 'SSL_SWEEP_REVERSAL_LONG', 'LONG', 150, 1.5),
      makeMockTrade('T3', 'BSL_SWEEP_REVERSAL_SHORT', 'SHORT', -100, -1.0),
    ];

    const archetypes = ArchetypeBreakdown.evaluateArchetypes(trades);
    expect(archetypes.length).toBe(2);

    const sslLong = archetypes.find((a) => a.archetype === 'SSL_SWEEP_REVERSAL_LONG');
    expect(sslLong?.winRate).toBe(1.0);
    expect(sslLong?.netPnl).toBe(350);

    const bslShort = archetypes.find((a) => a.archetype === 'BSL_SWEEP_REVERSAL_SHORT');
    expect(bslShort?.winRate).toBe(0);
    expect(bslShort?.netPnl).toBe(-100);
  });

  it('validates predictive performance across confluence score buckets', () => {
    const trades: PaperTradeRecord[] = [
      makeMockTrade('T1', 'SSL_SWEEP_REVERSAL_LONG', 'LONG', 200, 2.0),
      makeMockTrade('T2', 'SSL_SWEEP_REVERSAL_LONG', 'LONG', -100, -1.0),
    ];
    const signalsMap = new Map<string, TradeSignal>([
      ['SIG:T1', { confluenceScore: 88 } as TradeSignal],
      ['SIG:T2', { confluenceScore: 65 } as TradeSignal],
    ]);

    const buckets = ConfluenceScoreValidator.validateScoreBuckets(trades, signalsMap);
    const b85 = buckets.find((b) => b.scoreRange === '85-89');
    const b65 = buckets.find((b) => b.scoreRange === '65-69');

    expect(b85?.tradesCount).toBe(1);
    expect(b85?.winRate).toBe(1.0);
    expect(b65?.tradesCount).toBe(1);
    expect(b65?.winRate).toBe(0);
  });

  it('classifies trade performance by market regime accurately', () => {
    const trades: PaperTradeRecord[] = [
      makeMockTrade('T1', 'CHOCH_CONTINUATION_LONG', 'LONG', 200, 2.0),
      makeMockTrade('T2', 'CHOCH_CONTINUATION_SHORT', 'SHORT', -100, -1.0),
      makeMockTrade('T3', 'SSL_SWEEP_REVERSAL_LONG', 'LONG', 150, 1.5),
    ];

    const regimes = RegimeAnalyzer.evaluateRegimes(trades);
    expect(regimes.length).toBe(5);

    const trendUp = regimes.find((r) => r.regime === 'TREND_UP');
    const trendDown = regimes.find((r) => r.regime === 'TREND_DOWN');
    const range = regimes.find((r) => r.regime === 'RANGE');

    expect(trendUp?.totalTrades).toBe(1);
    expect(trendUp?.netPnl).toBe(200);

    expect(trendDown?.totalTrades).toBe(1);
    expect(trendDown?.netPnl).toBe(-100);

    expect(range?.totalTrades).toBe(1);
    expect(range?.netPnl).toBe(150);
  });

  it('runs Monte Carlo simulations and derives drawdown confidence intervals', () => {
    const trades: PaperTradeRecord[] = [
      makeMockTrade('T1', 'SSL_SWEEP_REVERSAL_LONG', 'LONG', 200),
      makeMockTrade('T2', 'SSL_SWEEP_REVERSAL_LONG', 'LONG', -100),
      makeMockTrade('T3', 'BSL_SWEEP_REVERSAL_SHORT', 'SHORT', 150),
    ];

    const mc = MonteCarloSimulator.runSimulation(trades, 10_000, 100);
    expect(mc.iterations).toBe(100);
    expect(mc.meanNetPnl).toBe(250);
    expect(mc.probabilityOfRuin).toBe(0);
    expect(mc.maxDrawdownP95).toBeGreaterThanOrEqual(100);
  });

  it('generates sequential walk-forward splits', () => {
    const t0 = 1700000000000;
    const hour = 3600_000;
    const candles: Candle[] = [];

    // Create 100 hours of candles
    for (let i = 0; i < 100; i++) {
      candles.push({
        symbol: 'SOLUSDT',
        interval: '1h',
        openTime: t0 + i * hour,
        closeTime: t0 + (i + 1) * hour - 1,
        open: 100,
        high: 105,
        low: 95,
        close: 102,
        volume: 100,
        isClosed: true,
      });
    }

    const windows = WalkForwardValidator.generateWindows(candles, 40 * hour, 10 * hour, 10 * hour);
    expect(windows.length).toBeGreaterThan(0);
    expect(windows[0]?.trainCandles.length).toBe(40);
    expect(windows[0]?.validationCandles.length).toBe(10);
    expect(windows[0]?.testCandles.length).toBe(10);
  });
});
