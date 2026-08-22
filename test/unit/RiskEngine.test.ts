import { describe, it, expect } from 'vitest';
import { RiskEngine } from '../../src/trading/risk/RiskEngine.js';
import type { Instrument } from '../../src/broker/types.js';
import type { TradeSignal } from '../../src/trading/signal/types.js';
import type { AccountState, PortfolioPosition } from '../../src/trading/risk/types.js';

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

function makeMockSignal(): TradeSignal {
  return {
    id: 'SIG:1',
    signalKey: 'SOLUSDT:SSL_SWEEP_REVERSAL_LONG:cand1:plan1',
    symbol: 'SOLUSDT',
    market: 'BINANCE_USDM',
    direction: 'LONG',
    status: 'VALIDATED',
    setupType: 'SSL_SWEEP_REVERSAL_LONG',
    confluenceScore: 85,
    entryPrice: 100,
    entryZone: { upper: 101, lower: 99 },
    stopLossPrice: 98,
    stopLossReason: 'SSL extreme',
    takeProfits: [],
    riskReward: { tp1: 1.8, tp2: 2.8, tp3: 3.8 },
    riskRejectionReasons: [],
    createdAt: 1700000000000,
    expiresAt: 1700010000000,
    sourceSetupId: 'cand1',
    sourceExecutionPlanId: 'plan1',
    provenance: {
      setupType: 'SSL_SWEEP_REVERSAL_LONG',
      confluenceScore: 85,
      sourceEventIds: [],
      sourceCandleTimes: [],
      reasoning: {},
    },
  };
}

describe('Phase 7 — Risk Engine', () => {
  it('approves risk check when all account and exposure limits pass', () => {
    const risk = new RiskEngine();
    const sig = makeMockSignal();
    const account: AccountState = { equity: 10000, availableBalance: 5000, dailyLoss: 0, realizedPnl: 0 };
    const inst = makeMockInstrument();

    const res = risk.validateSignalRisk(sig, account, [], inst);
    expect(res.approved).toBe(true);
    expect(res.rejectionReasons.length).toBe(0);
    expect(res.sizing?.quantity).toBe(50.0);
  });

  it('rejects signal if daily loss limit is reached', () => {
    const risk = new RiskEngine({ maxDailyLossPct: 0.03, maxOpenPositions: 3, maxPositionsPerSymbol: 1, riskPerTradePct: 0.01, maxAccountRiskPct: 0.05, cooldownBars: 3, defaultLeverage: 5, maxLeverage: 10 });
    const sig = makeMockSignal();
    // Daily loss is $350 on $10,000 equity (3.5% >= 3.0%)
    const account: AccountState = { equity: 10000, availableBalance: 5000, dailyLoss: 350, realizedPnl: -350 };

    const res = risk.validateSignalRisk(sig, account, []);
    expect(res.approved).toBe(false);
    expect(res.rejectionReasons).toContain('DAILY_LOSS_LIMIT_REACHED');
  });

  it('rejects signal if maximum open positions count is reached', () => {
    const risk = new RiskEngine({ maxOpenPositions: 2, maxPositionsPerSymbol: 1, maxDailyLossPct: 0.03, riskPerTradePct: 0.01, maxAccountRiskPct: 0.05, cooldownBars: 3, defaultLeverage: 5, maxLeverage: 10 });
    const sig = makeMockSignal();
    const account: AccountState = { equity: 10000, availableBalance: 5000, dailyLoss: 0, realizedPnl: 0 };
    const openPositions: PortfolioPosition[] = [
      { symbol: 'BTCUSDT', side: 'LONG', quantity: 0.1, entryPrice: 60000, stopLossPrice: 59000, notional: 6000, unrealizedPnl: 0 },
      { symbol: 'ETHUSDT', side: 'SHORT', quantity: 1.0, entryPrice: 3000, stopLossPrice: 3100, notional: 3000, unrealizedPnl: 0 },
    ];

    const res = risk.validateSignalRisk(sig, account, openPositions);
    expect(res.approved).toBe(false);
    expect(res.rejectionReasons).toContain('MAX_OPEN_POSITIONS_REACHED');
  });

  it('rejects signal if symbol is in active cooldown', () => {
    const risk = new RiskEngine();
    const sig = makeMockSignal();
    const account: AccountState = { equity: 10000, availableBalance: 5000, dailyLoss: 0, realizedPnl: 0 };
    const cooldowns = new Set(['SOLUSDT']);

    const res = risk.validateSignalRisk(sig, account, [], undefined, new Set(), cooldowns);
    expect(res.approved).toBe(false);
    expect(res.rejectionReasons).toContain('COOLDOWN_ACTIVE');
  });
});
