import { describe, it, expect } from 'vitest';
import { tradeSignalToSignalInput } from '../../src/strategy/strategies/smc-agent.js';
import type { TradeSignal } from '../../src/trading/signal/types.js';

function makeTradeSignal(overrides: Partial<TradeSignal> = {}): TradeSignal {
  return {
    id: 'sig1', signalKey: 'BTCUSDT:LONG', symbol: 'BTCUSDT', market: 'BINANCE_USDM',
    direction: 'LONG', status: 'PAPER_READY', setupType: 'BULLISH_CHOCH_RETEST_LONG',
    confluenceScore: 78, entryPrice: 60000, entryZone: { upper: 60100, lower: 59900 },
    stopLossPrice: 58500, stopLossReason: 'Below swing low',
    takeProfits: [{ level: 1, price: 61500, allocationPct: 0.5, riskReward: 1.5, reason: 'TP1' }],
    riskReward: { tp1: 1.5, tp2: 2.5, tp3: 3.0 },
    sizing: { accountEquity: 10000, riskPercent: 0.01, riskCapital: 100, stopDistance: 1500, quantity: 0.0667, positionNotional: 4000, requiredMargin: 800, leverage: 5 },
    riskRejectionReasons: [], createdAt: 1000, expiresAt: 61000,
    sourceSetupId: 'BTCUSDT:LONG:1000', sourceExecutionPlanId: 'PLAN:BTCUSDT:LONG:1000',
    provenance: {} as TradeSignal['provenance'],
    ...overrides,
  };
}

describe('tradeSignalToSignalInput', () => {
  it('maps a PAPER_READY long signal into a SignalInput', () => {
    const input = tradeSignalToSignalInput(makeTradeSignal(), 0.82, 'smc-agent-v1');

    expect(input.strategyId).toBe('smc-agent-v1');
    expect(input.symbol).toBe('BTCUSDT');
    expect(input.action).toBe('OPEN_LONG');
    expect(input.confidence).toBe(0.82);
    expect(input.stopLossPrice).toBe('58500');
    expect(input.takeProfitPrice).toBe('61500');
    expect(input.features.leverage).toBe(5);
    expect(input.features.quantity).toBe(0.0667);
    expect(input.ttlMs).toBe(60000);
  });

  it('maps SHORT direction to OPEN_SHORT', () => {
    const input = tradeSignalToSignalInput(
      makeTradeSignal({ direction: 'SHORT', symbol: 'ETHUSDT' }), 0.7, 'smc-agent-v1'
    );
    expect(input.action).toBe('OPEN_SHORT');
  });

  it('defaults leverage and quantity to 0 when sizing is missing', () => {
    const input = tradeSignalToSignalInput(
      makeTradeSignal({ sizing: undefined }), 0.6, 'smc-agent-v1'
    );
    expect(input.features.leverage).toBe(0);
    expect(input.features.quantity).toBe(0);
  });
});
