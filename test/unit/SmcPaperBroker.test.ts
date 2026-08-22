import { describe, it, expect } from 'vitest';
import { SmcPaperBroker } from '../../src/broker/paper/SmcPaperBroker.js';
import type { TradeSignal } from '../../src/trading/signal/types.js';
import type { Candle } from '../../src/strategy/indicators.js';

function makeCandle(low: number, high: number, close = 100, openTime = 1700000000000): Candle {
  return {
    symbol: 'SOLUSDT',
    interval: '5m',
    openTime,
    closeTime: openTime + 300_000,
    open: 100,
    high,
    low,
    close,
    volume: 1000,
    isClosed: true,
  };
}

function makeReadyLongSignal(t0 = 1700000000000): TradeSignal {
  return {
    id: 'SIG:SOL:LONG:1',
    signalKey: `SOLUSDT:SSL_SWEEP_REVERSAL_LONG:${t0}:PLAN1`,
    symbol: 'SOLUSDT',
    market: 'BINANCE_USDM',
    direction: 'LONG',
    status: 'PAPER_READY',
    setupType: 'SSL_SWEEP_REVERSAL_LONG',
    confluenceScore: 88,
    entryPrice: 93.0,
    entryZone: { upper: 94.0, lower: 92.0 },
    stopLossPrice: 88.0,
    stopLossReason: 'SSL extreme minus buffer',
    takeProfits: [
      { level: 1, price: 102.0, allocationPct: 0.33, riskReward: 1.8, reason: '15m BSL' },
      { level: 2, price: 106.0, allocationPct: 0.33, riskReward: 2.6, reason: '15m swing high' },
      { level: 3, price: 110.0, allocationPct: 0.34, riskReward: 3.4, reason: '1h BSL' },
    ],
    riskReward: { tp1: 1.8, tp2: 2.6, tp3: 3.4 },
    sizing: {
      accountEquity: 10000,
      riskPercent: 0.01,
      riskCapital: 100,
      stopDistance: 5.0,
      quantity: 20.0,
      positionNotional: 1860,
      requiredMargin: 372,
      leverage: 5,
    },
    riskRejectionReasons: [],
    createdAt: t0,
    expiresAt: t0 + 10_000_000,
    sourceSetupId: 'SET:1',
    sourceExecutionPlanId: 'PLAN1',
    provenance: {
      setupType: 'SSL_SWEEP_REVERSAL_LONG',
      confluenceScore: 88,
      sourceEventIds: ['evt1'],
      sourceCandleTimes: [t0],
      reasoning: { entry: 'FVG midpoint', stop: 'SSL extreme', targets: 'BSL pools' },
    },
  };
}

describe('Phase 8 — SmcPaperBroker Execution Simulation', () => {
  it('accepts PAPER_READY signals and executes complete Long trade lifecycle through TP1, TP2, and TP3', () => {
    const broker = new SmcPaperBroker(10_000);
    const sig = makeReadyLongSignal();
    const t0 = 1700000000000;

    const sub = broker.submitTradeSignal(sig, t0);
    expect(sub.accepted).toBe(true);

    // Candle 1: Drops to 92.5 -> Fills Limit Entry at 93.0
    broker.processCandle(makeCandle(92.5, 96.0, 95.0, t0 + 300_000));
    const pos1 = broker.getPosition('SOLUSDT');
    expect(pos1?.state).toBe('OPEN');
    expect(pos1?.quantity).toBe(20.0);
    expect(pos1?.averageEntryPrice).toBe(93.0);

    // Candle 2: Rallies to 103.0 -> Hits TP1 (102.0) -> Closes 33% (6.6 SOL) & moves stop to breakeven (93.02)
    broker.processCandle(makeCandle(94.0, 103.0, 101.0, t0 + 600_000));
    expect(pos1?.remainingQuantity).toBe(13.4);
    expect(pos1?.stopLossPrice).toBe(93.02);

    // Candle 3: Rallies to 107.0 -> Hits TP2 (106.0) -> Closes 33% (6.6 SOL)
    broker.processCandle(makeCandle(100.0, 107.0, 105.0, t0 + 900_000));
    expect(pos1?.remainingQuantity).toBe(6.8);

    // Candle 4: Rallies to 111.0 -> Hits TP3 (110.0) -> Closes remaining 34% (6.8 SOL)
    broker.processCandle(makeCandle(104.0, 111.0, 110.5, t0 + 1_200_000));
    expect(pos1?.state).toBe('CLOSED');
    expect(pos1?.remainingQuantity).toBe(0);

    // Check Trade Ledger and Metrics
    const ledger = broker.getLedger();
    expect(ledger.length).toBe(1);
    expect(ledger[0]?.status).toBe('CLOSED');
    expect(ledger[0]?.grossPnl).toBeGreaterThan(200);

    const metrics = broker.getMetrics();
    expect(metrics.totalTrades).toBe(1);
    expect(metrics.winningTrades).toBe(1);
    expect(metrics.winRate).toBe(1.0);

    // Check Trace
    const trace = broker.getTradeTrace(ledger[0]!.tradeId);
    expect(trace).not.toBeNull();
    expect(trace?.signal.symbol).toBe('SOLUSDT');
    expect(trace?.fills.length).toBe(4); // 1 entry + 3 TP fills
  });

  it('executes Short trade lifecycle and closes position cleanly on Stop Loss', () => {
    const broker = new SmcPaperBroker(10_000);
    const t0 = 1700000000000;
    const shortSig: TradeSignal = {
      ...makeReadyLongSignal(t0),
      direction: 'SHORT',
      entryPrice: 100.0,
      stopLossPrice: 105.0,
      takeProfits: [{ level: 1, price: 90.0, allocationPct: 1.0, riskReward: 2.0, reason: 'SSL' }],
      sizing: {
        accountEquity: 10000,
        riskPercent: 0.01,
        riskCapital: 100,
        stopDistance: 5.0,
        quantity: 20.0,
        positionNotional: 2000,
        requiredMargin: 400,
        leverage: 5,
      },
    };

    broker.submitTradeSignal(shortSig, t0);
    // Candle 1: Rallies to 101.0 -> Fills Short Limit Entry at 100.0
    broker.processCandle(makeCandle(98.0, 101.0, 99.0, t0 + 300_000));
    const pos = broker.getPosition('SOLUSDT');
    expect(pos?.state).toBe('OPEN');
    expect(pos?.side).toBe('SHORT');

    // Candle 2: Spikes to 106.0 -> Hits Stop Loss (105.0) -> Closes position with loss
    broker.processCandle(makeCandle(99.0, 106.0, 105.5, t0 + 600_000));
    expect(pos?.state).toBe('CLOSED');
    expect(pos?.lifecycle).toBe('STOPPED');

    const ledger = broker.getLedger();
    expect(ledger[0]?.status).toBe('CLOSED');
    expect(ledger[0]?.exitReason).toBe('STOP_LOSS');
    expect(ledger[0]?.grossPnl).toBe(-100.0); // (100 - 105) * 20 = -100
  });

  it('rejects duplicate signal submissions idempotently', () => {
    const broker = new SmcPaperBroker(10_000);
    const sig = makeReadyLongSignal();

    const sub1 = broker.submitTradeSignal(sig);
    expect(sub1.accepted).toBe(true);

    const sub2 = broker.submitTradeSignal(sig);
    expect(sub2.accepted).toBe(false);
    expect(sub2.reason).toBe('DUPLICATE_SIGNAL_KEY');
  });
});
