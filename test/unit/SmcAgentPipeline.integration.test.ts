import { describe, it, expect, vi } from 'vitest';
import { createSmcAgentStrategy, type AgentDebatePipeline } from '../../src/strategy/strategies/smc-agent.js';
import { SetupEngine } from '../../src/market/setup/SetupEngine.js';
import { MtfStateEngine } from '../../src/market/MtfStateEngine.js';
import { MarketStructureEngine } from '../../src/market/structure/MarketStructureEngine.js';
import { SmcLocationEngine } from '../../src/market/smc/SmcLocationEngine.js';
import { ExecutionPlanEngine } from '../../src/market/execution/ExecutionPlanEngine.js';
import { TradeIntentEngine } from '../../src/trading/TradeIntentEngine.js';
import { KlineStore } from '../../src/market/Klines.js';
import { MarketStateManager } from '../../src/market/MarketState.js';
import type { CycleRecord } from '../../src/ai/schemas.js';
import type { Candle } from '../../src/strategy/indicators.js';
import type { StrategyContext } from '../../src/strategy/StrategyContext.js';
import type { AccountState, Instrument } from '../../src/broker/types.js';

const SYMBOL = 'BTCUSDT';

const FAKE_INSTRUMENT: Instrument = {
  symbol: SYMBOL, baseAsset: 'BTC', quoteAsset: 'USDT', contractType: 'PERPETUAL', status: 'TRADING',
  tickSize: '0.1', stepSize: '0.001', minQty: '0.001', minNotional: '5',
  pricePrecision: 1, quantityPrecision: 3, maintenanceMarginRate: '0.005',
  createdAtUtc: new Date(0).toISOString(),
};

// [open, high, low, close]
type Ohlc = [number, number, number, number];

function candle(interval: string, position: number, stepMs: number, row: Ohlc): Candle {
  // KlineStore.upsertCandle silently drops any candle with openTime <= 0,
  // so positions are 1-indexed here — position 0 must never map to openTime 0.
  const openTime = (position + 1) * stepMs;
  return {
    symbol: SYMBOL, interval, openTime, closeTime: openTime + stepMs - 1,
    open: row[0], high: row[1], low: row[2], close: row[3], volume: 100, isClosed: true,
  } as Candle;
}

function repeat(row: Ohlc, count: number): Ohlc[] {
  return Array.from({ length: count }, () => row);
}

function buildSeries(interval: string, stepMs: number, rows: Ohlc[]): Candle[] {
  return rows.map((row, i) => candle(interval, i, stepMs, row));
}

const FLAT: Ohlc = [60000, 60050, 59950, 60000];
const FAR_ELEVATED: Ohlc = [65000, 65050, 64950, 65000];

// The 15m sweep-and-reversal sequence: swing high, swing low, an SSL sweep
// that wicks below the swing low and closes back above it, a bullish
// displacement candle, a break-of-structure candle closing above the swing
// high (BOS/CHOCH bullish), the confirming FVG candle, and a retest dip back
// into the FVG. Verified via a standalone harness against the real
// SetupEngine/MarketStructureEngine/SmcLocationEngine/ExecutionPlanEngine to
// reach confluence score 65+ and an EXECUTABLE plan (entry 60625, stop
// 59399.8) before being transcribed here.
const FIFTEEN_MIN_SEQUENCE: Ohlc[] = [
  [60000, 60050, 59950, 60000],
  [60000, 60050, 59950, 60000],
  [60000, 60050, 59950, 60000],
  [60050, 60200, 60050, 60100], // swing high @ 60200
  [60000, 60100, 59950, 60000], // right-context (high < 60200)
  [60000, 60100, 59950, 60000],
  [60000, 60100, 59950, 60000],
  [60000, 60050, 59950, 60000],
  [60000, 60050, 59950, 60000],
  [60000, 60050, 59950, 60000],
  [60000, 60050, 59500, 60000], // swing low @ 59500
  [60000, 60050, 59900, 60000], // right-context (low > 59500)
  [60000, 60050, 59900, 60000],
  [60000, 60050, 59900, 60000],
  [59900, 59950, 59850, 59900], // step-down bridge toward the sweep
  [59900, 59950, 59850, 59900],
  [59900, 59950, 59850, 59900],
  [59600, 59650, 59400, 59600], // SSL sweep: low < 59500, close >= 59500
  [59600, 60350, 59550, 60300], // displacement, FVG c0 (high = 60350)
  [60300, 60850, 59600, 60800], // close 60800 > 60200 -> BOS/CHOCH bullish
                                 // (low kept <= 59650 to avoid an unintended
                                 // earlier FVG against the sweep candle)
  [60800, 61050, 60900, 61000], // FVG c2 (low = 60900 > c0.high) -> bullish FVG
  [61000, 61050, 60600, 60700], // retest dip into the FVG (midpoint 60625)
  // Continue the rally well past entry + 2.5R (~63688) before plateauing.
  // Without this, the first flat candle after the retest becomes a confirmed
  // 15m swing high close to entry; TakeProfitCalculator picks that real
  // level over the synthetic 1.5R/2.5R/3.5R projection for BOTH TP1 and TP2
  // (the swing itself and its derived liquidity level, at the same price),
  // and a nearby swing fails the TP2 R:R >= 2.5 minimum.
  [60700, 62000, 60650, 61950], // rally continuation leg 1
  [61950, 65050, 61900, 65000], // rally continuation leg 2 -> peak high 65050
  ...repeat(FAR_ELEVATED, 3), // plateau confirms the swing high @ 65050
];

// A small SSL sweep on the 5m series, independent of the 15m sequence,
// just to produce triggerEvidence (smc5m.sweeps.length > 0).
const FIVE_MIN_SEQUENCE: Ohlc[] = [
  [60000, 60050, 59950, 60000],
  [60000, 60050, 59950, 60000],
  [60000, 60050, 59950, 60000],
  [60000, 60050, 59950, 60000],
  [60000, 60050, 59700, 60000], // swing low
  [60000, 60050, 59900, 60000],
  [60000, 60050, 59900, 60000],
  [60000, 60050, 59900, 60000],
  [60000, 60050, 59900, 60000],
  [60000, 60050, 59900, 60000],
  [59750, 59800, 59600, 59750], // SSL sweep on 5m
];

// Leading/trailing flat padding sized so every timeframe's series is
// contiguous (no gaps) from its first candle through a shared `asOf`, and
// long enough to clear MtfStateEngine.MIN_CLOSED_CANDLES per timeframe, so
// MtfStateEngine reports isFullySynchronized: true.
const LEAD_15M = 100;
const TRAIL_15M = 320 - LEAD_15M - FIFTEEN_MIN_SEQUENCE.length; // 320 total 15m candles
const LEAD_5M = 100;
const TRAIL_5M = 960 - LEAD_5M - FIVE_MIN_SEQUENCE.length; // 960 total 5m candles -> asOf = 288,000,000

function build15mCandles(): Candle[] {
  const rows: Ohlc[] = [...repeat(FLAT, LEAD_15M), ...FIFTEEN_MIN_SEQUENCE, ...repeat(FAR_ELEVATED, TRAIL_15M)];
  return buildSeries('15m', 900_000, rows);
}

function build5mCandles(): Candle[] {
  const rows: Ohlc[] = [...repeat(FLAT, LEAD_5M), ...FIVE_MIN_SEQUENCE, ...repeat(FLAT, TRAIL_5M)];
  return buildSeries('5m', 300_000, rows);
}

function build1hCandles(): Candle[] {
  return buildSeries('1h', 3_600_000, repeat(FLAT, 80));
}

function build4hCandles(): Candle[] {
  return buildSeries('4h', 14_400_000, repeat(FLAT, 20));
}

function makeContext(equity: number): StrategyContext {
  const account: AccountState = {
    walletBalance: equity, unrealizedPnl: 0, equity, initialMargin: 0, maintenanceMargin: 0,
    availableBalance: equity, totalFees: 0, totalFunding: 0, totalRealizedPnl: 0,
    openPositionsCount: 0, openOrdersCount: 0, dailyRealizedPnl: 0,
  };
  return {
    strategyId: 'smc-agent-v1',
    getMarket: () => ({
      symbol: SYMBOL, bid: 60790, ask: 60810, spread: 20, last: 60800, mark: 60800,
      fundingRate: 0.0001, openInterest: 500000,
    }),
    getCandles: () => [],
    getAccount: () => account,
    getPosition: () => undefined,
    getOpenOrders: () => [],
    hasOpenPosition: () => false,
    hasOpenOrder: () => false,
    submitOrder: () => { throw new Error('not used'); },
  };
}

function makeApprovingAgentPipeline(direction: 'LONG' | 'SHORT'): AgentDebatePipeline {
  return {
    async runCycle(ctx): Promise<CycleRecord> {
      const decision = {
        symbol: ctx.symbol, action: direction, leverage: 3, sizePct: 0.1,
        rationale: 'Fixed test decision', confidence: 0.9,
      };
      return {
        cycleId: `test-cycle-${ctx.symbol}`, symbol: ctx.symbol, startedAt: Date.now(),
        analystReports: [], debate: [],
        verdict: { prevailingSide: direction === 'LONG' ? 'BULL' : 'BEAR', rationale: 'test', conviction: 0.9 },
        traderDecision: decision,
        riskOpinions: [{ persona: 'SAFE', verdict: 'APPROVE', rationale: 'test' }],
        fundManagerApproval: { approved: true, finalDecision: decision, rationale: 'test approval' },
        executed: false,
      };
    },
  };
}

function buildPipeline() {
  const klines = new KlineStore(1000);
  for (const c of [...build4hCandles(), ...build1hCandles(), ...build15mCandles(), ...build5mCandles()]) {
    klines.upsertCandle(c);
  }
  const marketState = new MarketStateManager([FAKE_INSTRUMENT]);
  const structureEngine = new MarketStructureEngine(klines);
  const smcEngine = new SmcLocationEngine(klines, structureEngine);
  const mtfEngine = new MtfStateEngine(klines, marketState);
  const setupEngine = new SetupEngine(mtfEngine, structureEngine, smcEngine);
  const planEngine = new ExecutionPlanEngine();
  return { setupEngine, structureEngine, smcEngine, planEngine };
}

describe('SMC agent strategy — structure to agents to risk gate', () => {
  it('does not produce a signal when the risk engine rejects due to insufficient equity', async () => {
    const { setupEngine, structureEngine, smcEngine, planEngine } = buildPipeline();
    const tradeIntentEngine = new TradeIntentEngine();
    const onCycleCompleted = vi.fn();

    const strategy = createSmcAgentStrategy({
      setupEngine, structureEngine, smcEngine, planEngine, tradeIntentEngine,
      tradingAgentsPipeline: makeApprovingAgentPipeline('LONG'),
      getInstrument: () => FAKE_INSTRUMENT,
      onCycleCompleted,
    });

    const candles5m = build5mCandles();
    const currentCandle = candles5m[candles5m.length - 1]!;
    // Equity of 1 USDT cannot fund even the minimum position at this stop
    // distance. The fake pipeline always approves LONG, so a null result
    // here can only be the risk gate rejecting the trade.
    const result = await strategy.onCandleClose!(makeContext(1), currentCandle);

    expect(result).toBeNull();
    // The agent still ran and reasoned about this candle even though the
    // downstream risk gate vetoed it — that cycle must still surface on the
    // dashboard (agent_cycles + WS broadcast), not disappear silently.
    expect(onCycleCompleted).toHaveBeenCalledTimes(1);
    expect(onCycleCompleted.mock.calls[0]![0].cycleId).toBe('test-cycle-BTCUSDT');
  });

  it('produces a signal when structure, agents, and risk all agree the trade is sound', async () => {
    const { setupEngine, structureEngine, smcEngine, planEngine } = buildPipeline();
    const tradeIntentEngine = new TradeIntentEngine();

    const strategy = createSmcAgentStrategy({
      setupEngine, structureEngine, smcEngine, planEngine, tradeIntentEngine,
      tradingAgentsPipeline: makeApprovingAgentPipeline('LONG'),
      getInstrument: () => FAKE_INSTRUMENT,
    });

    const candles5m = build5mCandles();
    const currentCandle = candles5m[candles5m.length - 1]!;
    const result = await strategy.onCandleClose!(makeContext(10000), currentCandle);

    expect(result).not.toBeNull();
    expect(result!.strategyId).toBe('smc-agent-v1');
    expect(['OPEN_LONG', 'OPEN_SHORT']).toContain(result!.action);
    expect(Number(result!.features.quantity)).toBeGreaterThan(0);
  });
});
