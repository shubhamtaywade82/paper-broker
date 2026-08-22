import { describe, it, expect } from 'vitest';
import { createSmcAgentStrategy, tradeSignalToSignalInput } from '../../src/strategy/strategies/smc-agent.js';
import { SetupEngine } from '../../src/market/setup/SetupEngine.js';
import { MtfStateEngine } from '../../src/market/MtfStateEngine.js';
import { MarketStructureEngine } from '../../src/market/structure/MarketStructureEngine.js';
import { SmcLocationEngine } from '../../src/market/smc/SmcLocationEngine.js';
import { ExecutionPlanEngine } from '../../src/market/execution/ExecutionPlanEngine.js';
import { TradeIntentEngine } from '../../src/trading/TradeIntentEngine.js';
import { TradingAgentsPipeline } from '../../src/ai/tradingAgents.js';
import { KlineStore } from '../../src/market/Klines.js';
import { MarketStateManager } from '../../src/market/MarketState.js';
import type { Candle } from '../../src/strategy/indicators.js';
import type { StrategyContext } from '../../src/strategy/StrategyContext.js';
import type { AccountState, Position, Instrument } from '../../src/broker/types.js';
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

function buildFlatCandles(symbol: string, count: number, basePrice: number): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    candles.push({
      symbol, interval: '15m', openTime: i * 900_000, closeTime: i * 900_000 + 899_999,
      open: basePrice, high: basePrice, low: basePrice, close: basePrice, volume: 100,
      isClosed: true,
    } as Candle);
  }
  return candles;
}

function makeStrategyContext(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    strategyId: 'smc-agent-v1',
    getMarket: () => ({
      symbol: 'BTCUSDT', bid: 59990, ask: 60010, spread: 20, last: 60000, mark: 60000,
      fundingRate: 0.0001, openInterest: 500000,
    }),
    getCandles: () => [],
    getAccount: () => ({
      walletBalance: 10000, unrealizedPnl: 0, equity: 10000, initialMargin: 0,
      maintenanceMargin: 0, availableBalance: 10000, totalFees: 0, totalFunding: 0,
      totalRealizedPnl: 0, openPositionsCount: 0, openOrdersCount: 0, dailyRealizedPnl: 0,
    } as AccountState),
    getPosition: () => undefined as Position | undefined,
    getOpenOrders: () => [],
    hasOpenPosition: () => false,
    hasOpenOrder: () => false,
    submitOrder: () => { throw new Error('not used in this test'); },
    ...overrides,
  };
}

const FAKE_INSTRUMENT: Instrument = {
  symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', contractType: 'PERPETUAL', status: 'TRADING',
  tickSize: '0.1', stepSize: '0.001', minQty: '0.001', minNotional: '5',
  pricePrecision: 1, quantityPrecision: 3, maintenanceMarginRate: '0.005',
  createdAtUtc: new Date(0).toISOString(),
};

describe('createSmcAgentStrategy', () => {
  it('returns null when no READY setup exists for the symbol', async () => {
    const klines = new KlineStore(500);
    for (const c of buildFlatCandles('BTCUSDT', 60, 60000)) klines.upsertCandle(c);
    const marketState = new MarketStateManager([FAKE_INSTRUMENT]);
    const structureEngine = new MarketStructureEngine(klines);
    const smcEngine = new SmcLocationEngine(klines, structureEngine);
    const mtfEngine = new MtfStateEngine(klines, marketState);
    const setupEngine = new SetupEngine(mtfEngine, structureEngine, smcEngine);
    const planEngine = new ExecutionPlanEngine();
    const tradeIntentEngine = new TradeIntentEngine();
    const tradingAgentsPipeline = new TradingAgentsPipeline({ model: 'llama3.1:8b' });

    const strategy = createSmcAgentStrategy({
      setupEngine, structureEngine, smcEngine, planEngine, tradeIntentEngine,
      tradingAgentsPipeline, getInstrument: () => FAKE_INSTRUMENT,
    });

    const candle = buildFlatCandles('BTCUSDT', 1, 60000)[0]!;
    const result = await strategy.onCandleClose!(makeStrategyContext(), candle);

    expect(result).toBeNull();
  });

  it('exposes the expected Strategy metadata', () => {
    const strategy = createSmcAgentStrategy({
      setupEngine: {} as SetupEngine, structureEngine: {} as MarketStructureEngine,
      smcEngine: {} as SmcLocationEngine, planEngine: {} as ExecutionPlanEngine,
      tradeIntentEngine: {} as TradeIntentEngine, tradingAgentsPipeline: {} as TradingAgentsPipeline,
      getInstrument: () => undefined, symbols: ['BTCUSDT', 'ETHUSDT'],
    });

    expect(strategy.id).toBe('smc-agent-v1');
    expect(strategy.symbols).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(strategy.intervals).toEqual(['5m']);
    expect(strategy.enabled).toBe(true);
  });
});
