# Graph Unification (Phase 1 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live/paper trading loop run the same SMC structure → agent-debate → risk-gated decision pipeline that `ReplayEngine` already validates in backtests, replacing the classic indicator strategies that currently drive live trading.

**Architecture:** A new `Strategy` (`createSmcAgentStrategy`), registered with the existing `StrategyEngine` exactly like today's classic strategies, wraps the already-built `SetupEngine → ExecutionPlanEngine → TradingAgentsPipeline → TradeIntentEngine` chain. `TradeIntentEngine` already owns risk-gating internally (`RiskEngine`), so no new risk-gate abstraction is needed — this plan wires existing pieces together and adds two small adapter functions to bridge type mismatches between the broker's account/position shapes and the risk engine's.

**Tech Stack:** TypeScript, vitest, existing `SetupEngine`/`MtfStateEngine`/`MarketStructureEngine`/`SmcLocationEngine`/`ExecutionPlanEngine`/`TradeIntentEngine`/`TradingAgentsPipeline`/`StrategyEngine`/`SignalExecutor` classes (all pre-existing, none new).

**Spec:** `docs/superpowers/specs/2026-08-22-unified-agentic-pipeline-design.md` §1 (Composition root & graph model). Architectural decision: `docs/decisions/0004-unified-agentic-decision-pipeline.md`.

## Global Constraints

- LLM never bypasses the risk engine (AGENTS.md §6.1) — `TradeIntentEngine.processExecutionPlan()` must run and its `status` must be checked before any signal reaches `SignalExecutor`. An agent-approved trade with `status !== 'PAPER_READY'` MUST NOT execute.
- Agents rank/approve direction and conviction; they do not compute stop-loss, take-profit, or position size — those come from `ExecutionPlanEngine`/`TradeIntentEngine` (AGENTS.md §6.1: LLM must not calculate authoritative execution state).
- No new abstractions: reuse `Strategy`/`StrategyContext`/`SignalInput` exactly as they exist today. Do not create a parallel execution path.
- Functions ≤ 30 lines, files ≤ 300 lines (CODE_QUALITY.md) — split `smc-agent.ts` if the strategy factory grows past this.
- Every deleted file must have zero remaining importers before deletion (verify with grep, not assumption).

---

## Task 1: Risk-engine account/position adapters

**Files:**
- Create: `src/trading/risk/adapters.ts`
- Test: `test/unit/RiskAdapters.test.ts`

**Interfaces:**
- Consumes: `AccountState`, `Position`, `Order` from `src/broker/types.ts`; `AccountState` (aliased `RiskAccountState`), `PortfolioPosition` from `src/trading/risk/types.ts`
- Produces: `toRiskAccountState(account: BrokerAccountState): RiskAccountState`, `toPortfolioPositions(positions: BrokerPosition[], openOrders: Order[]): PortfolioPosition[]` — consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { toRiskAccountState, toPortfolioPositions } from '../../src/trading/risk/adapters.js';
import type { AccountState, Position, Order } from '../../src/broker/types.js';

describe('toRiskAccountState', () => {
  it('maps broker account fields to risk account shape', () => {
    const account: AccountState = {
      walletBalance: 10000,
      unrealizedPnl: 50,
      equity: 10050,
      initialMargin: 500,
      maintenanceMargin: 100,
      availableBalance: 9550,
      totalFees: 20,
      totalFunding: 5,
      totalRealizedPnl: 300,
      openPositionsCount: 1,
      openOrdersCount: 2,
      dailyRealizedPnl: -75,
    };

    const risk = toRiskAccountState(account);

    expect(risk.equity).toBe(10050);
    expect(risk.availableBalance).toBe(9550);
    expect(risk.dailyLoss).toBe(75);
    expect(risk.realizedPnl).toBe(300);
  });

  it('treats a positive dailyRealizedPnl as zero daily loss', () => {
    const account = {
      walletBalance: 10000, unrealizedPnl: 0, equity: 10200, initialMargin: 0,
      maintenanceMargin: 0, availableBalance: 10200, totalFees: 0, totalFunding: 0,
      totalRealizedPnl: 200, openPositionsCount: 0, openOrdersCount: 0, dailyRealizedPnl: 200,
    } as AccountState;

    expect(toRiskAccountState(account).dailyLoss).toBe(0);
  });

  it('defaults to zero daily loss when dailyRealizedPnl is absent', () => {
    const account = {
      walletBalance: 10000, unrealizedPnl: 0, equity: 10000, initialMargin: 0,
      maintenanceMargin: 0, availableBalance: 10000, totalFees: 0, totalFunding: 0,
      totalRealizedPnl: 0, openPositionsCount: 0, openOrdersCount: 0,
    } as AccountState;

    expect(toRiskAccountState(account).dailyLoss).toBe(0);
  });
});

describe('toPortfolioPositions', () => {
  it('maps an open long position with a matching stop order', () => {
    const positions: Position[] = [{
      accountId: 'paper-main', symbol: 'BTCUSDT', positionSide: 'LONG', status: 'OPEN',
      qty: 0.5, entryPrice: 60000, unrealizedPnl: 100, realizedPnl: 0, leverage: 5,
      initialMargin: 6000, maintenanceMargin: 300, maintenanceMarginRate: 0.05,
    } as Position];
    const orders: Order[] = [{
      id: 'o1', clientOrderId: 'c1', accountId: 'paper-main', symbol: 'BTCUSDT',
      side: 'SELL', type: 'STOP_MARKET', timeInForce: 'GTC', status: 'NEW',
      positionSide: 'LONG', quantity: 0.5, filledQty: 0, stopPrice: 58500,
      avgFillPrice: 0, leverage: 5, reduceOnly: true, postOnly: false, closePosition: false,
    } as Order];

    const result = toPortfolioPositions(positions, orders);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      symbol: 'BTCUSDT', side: 'LONG', quantity: 0.5, entryPrice: 60000,
      stopLossPrice: 58500, unrealizedPnl: 100,
    });
  });

  it('falls back to entry price when no matching stop order exists', () => {
    const positions: Position[] = [{
      accountId: 'paper-main', symbol: 'ETHUSDT', positionSide: 'SHORT', status: 'OPEN',
      qty: -2, entryPrice: 3000, unrealizedPnl: -10, realizedPnl: 0, leverage: 3,
      initialMargin: 2000, maintenanceMargin: 100, maintenanceMarginRate: 0.05,
    } as Position];

    const result = toPortfolioPositions(positions, []);

    expect(result[0]?.side).toBe('SHORT');
    expect(result[0]?.stopLossPrice).toBe(3000);
    expect(result[0]?.quantity).toBe(2);
  });

  it('excludes closed positions', () => {
    const positions: Position[] = [{
      accountId: 'paper-main', symbol: 'SOLUSDT', positionSide: 'LONG', status: 'CLOSED',
      qty: 0, entryPrice: 140, unrealizedPnl: 0, realizedPnl: 20, leverage: 5,
      initialMargin: 0, maintenanceMargin: 0, maintenanceMarginRate: 0.05,
    } as Position];

    expect(toPortfolioPositions(positions, [])).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/unit/RiskAdapters.test.ts`
Expected: FAIL — `src/trading/risk/adapters.ts` does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
import type { AccountState as BrokerAccountState, Order, Position as BrokerPosition } from '../../broker/types.js';
import type { AccountState as RiskAccountState, PortfolioPosition } from './types.js';

export function toRiskAccountState(account: BrokerAccountState): RiskAccountState {
  return {
    equity: account.equity,
    availableBalance: account.availableBalance,
    dailyLoss: Math.max(0, -(account.dailyRealizedPnl ?? 0)),
    realizedPnl: account.totalRealizedPnl,
  };
}

export function toPortfolioPositions(
  positions: BrokerPosition[],
  openOrders: Order[]
): PortfolioPosition[] {
  return positions
    .filter((p) => p.status === 'OPEN')
    .map((p) => {
      const stopOrder = openOrders.find(
        (o) => o.symbol === p.symbol && o.type === 'STOP_MARKET' && o.reduceOnly
      );
      return {
        symbol: p.symbol,
        side: p.qty >= 0 ? 'LONG' : 'SHORT',
        quantity: Math.abs(p.qty),
        entryPrice: p.entryPrice,
        stopLossPrice: stopOrder?.stopPrice ?? p.entryPrice,
        notional: Math.abs(p.qty) * (p.markPrice ?? p.entryPrice),
        unrealizedPnl: p.unrealizedPnl,
      };
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/unit/RiskAdapters.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/trading/risk/adapters.ts test/unit/RiskAdapters.test.ts
git commit -m "feat(risk): add broker-to-risk-engine account/position adapters"
```

---

## Task 2: TradeSignal → SignalInput mapper

**Files:**
- Create: `src/strategy/strategies/smc-agent.ts` (mapper function only in this task; strategy factory added in Task 3)
- Test: `test/unit/SmcAgentStrategy.test.ts`

**Interfaces:**
- Consumes: `TradeSignal` from `src/trading/signal/types.ts`; `SignalInput`, `parseSignalInput` from `src/strategy/signal.ts`
- Produces: `tradeSignalToSignalInput(ts: TradeSignal, agentConfidence: number, strategyId: string): SignalInput` — consumed by Task 3.

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/SmcAgentStrategy.test.ts`
Expected: FAIL — `src/strategy/strategies/smc-agent.ts` does not exist.

- [ ] **Step 3: Write the minimal implementation**

```typescript
import type { TradeSignal } from '../../trading/signal/types.js';
import { parseSignalInput, type SignalInput } from '../signal.js';

export function tradeSignalToSignalInput(
  ts: TradeSignal,
  agentConfidence: number,
  strategyId: string
): SignalInput {
  const action = ts.direction === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT';
  const firstTakeProfit = ts.takeProfits[0]?.price ?? ts.entryPrice;

  return parseSignalInput({
    strategyId,
    symbol: ts.symbol,
    action,
    confidence: agentConfidence,
    stopLossPrice: String(ts.stopLossPrice),
    takeProfitPrice: String(firstTakeProfit),
    reasoning: `[${ts.setupType}] confluence=${ts.confluenceScore}`,
    ttlMs: Math.max(1000, ts.expiresAt - ts.createdAt),
    features: {
      leverage: ts.sizing?.leverage ?? 0,
      quantity: ts.sizing?.quantity ?? 0,
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/unit/SmcAgentStrategy.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/strategy/strategies/smc-agent.ts test/unit/SmcAgentStrategy.test.ts
git commit -m "feat(strategy): add TradeSignal to SignalInput mapper for the SMC agent strategy"
```

---

## Task 3: `createSmcAgentStrategy` factory

**Files:**
- Modify: `src/strategy/strategies/smc-agent.ts` (append to Task 2's file)
- Modify: `test/unit/SmcAgentStrategy.test.ts` (append)

**Interfaces:**
- Consumes: `Strategy`, `StrategyContext` from `src/strategy/StrategyEngine.ts` / `StrategyContext.ts`; `SetupEngine` (`getReadySetups`), `MarketStructureEngine` (`computeMultiTimeframeStructure`), `SmcLocationEngine` (`computeMultiTimeframeSmcContext`), `ExecutionPlanEngine` (`generateExecutionPlan`), `TradeIntentEngine` (`processExecutionPlan`), `TradingAgentsPipeline` (`runCycle`) — all pre-existing; `Instrument` from `src/broker/types.ts`; `toRiskAccountState`, `toPortfolioPositions` from Task 1; `tradeSignalToSignalInput` from Task 2.
- Produces: `createSmcAgentStrategy(deps: SmcAgentStrategyDeps): Strategy` — consumed by Task 5 (`engine.ts` registration).

- [ ] **Step 1: Write the failing tests**

```typescript
// Append to test/unit/SmcAgentStrategy.test.ts
import { createSmcAgentStrategy } from '../../src/strategy/strategies/smc-agent.js';
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/unit/SmcAgentStrategy.test.ts`
Expected: FAIL — `createSmcAgentStrategy` is not exported.

- [ ] **Step 3: Write the implementation**

```typescript
// Append to src/strategy/strategies/smc-agent.ts
import type { Strategy, StrategyContext } from '../StrategyEngine.js';
import type { SetupEngine } from '../../market/setup/SetupEngine.js';
import type { MarketStructureEngine } from '../../market/structure/MarketStructureEngine.js';
import type { SmcLocationEngine } from '../../market/smc/SmcLocationEngine.js';
import type { ExecutionPlanEngine } from '../../market/execution/ExecutionPlanEngine.js';
import type { TradeIntentEngine } from '../../trading/TradeIntentEngine.js';
import type { TradingAgentsPipeline } from '../../ai/tradingAgents.js';
import type { Instrument, Position } from '../../broker/types.js';
import { toRiskAccountState, toPortfolioPositions } from '../../trading/risk/adapters.js';

const STRATEGY_ID = 'smc-agent-v1';

export interface SmcAgentStrategyDeps {
  setupEngine: SetupEngine;
  structureEngine: MarketStructureEngine;
  smcEngine: SmcLocationEngine;
  planEngine: ExecutionPlanEngine;
  tradeIntentEngine: TradeIntentEngine;
  tradingAgentsPipeline: TradingAgentsPipeline;
  getInstrument: (symbol: string) => Instrument | undefined;
  symbols?: string[];
}

export function createSmcAgentStrategy(deps: SmcAgentStrategyDeps): Strategy {
  return {
    id: STRATEGY_ID,
    name: 'SMC Structure + Multi-Agent Debate',
    enabled: true,
    symbols: deps.symbols ?? ['BTCUSDT', 'ETHUSDT'],
    intervals: ['5m'],
    priority: 10,
    cooldownMs: 300_000,
    onCandleClose: (ctx, candle) => evaluateCandle(deps, ctx, candle.symbol, candle.openTime),
  };
}

async function evaluateCandle(
  deps: SmcAgentStrategyDeps,
  ctx: StrategyContext,
  symbol: string,
  asOf: number
) {
  const setups = deps.setupEngine.getReadySetups(symbol, asOf);
  const candidate = setups.find((s) => s.direction !== 'AVOID');
  if (!candidate) return null;

  const structure = deps.structureEngine.computeMultiTimeframeStructure(symbol, asOf);
  const smc = deps.smcEngine.computeMultiTimeframeSmcContext(symbol, asOf);
  const instrument = deps.getInstrument(symbol);
  const plan = deps.planEngine.generateExecutionPlan(candidate, structure, smc, instrument, asOf, true);
  if (plan.status !== 'EXECUTABLE') return null;

  const market = ctx.getMarket(symbol);
  if (!market || market.bid === undefined || market.ask === undefined || market.last === undefined || market.mark === undefined) {
    return null;
  }
  const account = ctx.getAccount();

  const cycle = await deps.tradingAgentsPipeline.runCycle({
    symbol,
    lastPrice: market.last,
    bid: market.bid,
    ask: market.ask,
    spread: market.spread ?? market.ask - market.bid,
    mark: market.mark,
    fundingRate: market.fundingRate,
    openInterest: market.openInterest,
    accountEquity: account.equity,
    availableBalance: account.availableBalance,
  });

  if (!cycle.fundManagerApproval.approved) return null;
  const agentDirection = cycle.fundManagerApproval.finalDecision.action;
  if (agentDirection === 'NEUTRAL' || agentDirection !== candidate.direction) return null;

  const riskAccount = toRiskAccountState(account);
  const currentPosition = ctx.getPosition(symbol);
  const riskPositions = toPortfolioPositions(
    currentPosition ? [currentPosition] : ([] as Position[]),
    ctx.getOpenOrders(symbol)
  );

  const tradeSignal = deps.tradeIntentEngine.processExecutionPlan(plan, riskAccount, riskPositions, instrument, asOf);
  if (tradeSignal.status !== 'PAPER_READY') return null;

  return tradeSignalToSignalInput(tradeSignal, cycle.traderDecision.confidence, STRATEGY_ID);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/unit/SmcAgentStrategy.test.ts`
Expected: PASS (5 tests total in file)

- [ ] **Step 5: Commit**

```bash
git add src/strategy/strategies/smc-agent.ts test/unit/SmcAgentStrategy.test.ts
git commit -m "feat(strategy): add createSmcAgentStrategy wiring setup->plan->agents->risk gate"
```

---

## Task 4: Drop `SizingEngine` from `SignalExecutor`

**Files:**
- Modify: `src/strategy/SignalExecutor.ts`
- Modify: `test/unit/SignalExecutor.test.ts`

**Interfaces:**
- Consumes: `signal.features.quantity`, `signal.features.leverage` (both `number`, populated by Task 2's mapper) instead of `SizingEngine.sizePosition()`.
- Produces: `SignalExecutorDeps` without a `sizing` field — this is a breaking change to `engine.ts`'s construction call, fixed in Task 6.

- [ ] **Step 1: Read the current test file**

Run: `cat test/unit/SignalExecutor.test.ts`

Find every place a `SignalExecutorDeps` object is constructed (look for a `sizing:` key, likely a mock object with a `sizePosition` method) and every `Signal` fixture passed to `execute()`.

- [ ] **Step 2: Update the test file**

For each `SignalExecutorDeps` construction: delete the `sizing:` property entirely.

For each test that opens a position (action `OPEN_LONG`/`OPEN_SHORT`) and previously relied on the `sizing` mock to produce a quantity: add `features: { quantity: <value>, leverage: <value> }` to that test's `Signal` fixture, using the same numeric quantity/leverage the old `sizePosition` mock used to return, so the test's assertions on submitted order quantity keep passing unchanged.

Add one new test:

```typescript
it('uses the quantity and leverage from signal.features, not a sizing engine', async () => {
  const broker = makeBroker(); // use this file's existing broker test double
  const signals = makeSignalRepository(); // use this file's existing repository test double
  const executor = new SignalExecutor({
    broker, orderFactory: new OrderFactory(), signals,
    getMarketState: () => ({ symbol: 'BTCUSDT', bid: 59990, ask: 60010 }),
  });

  const signal = toSignal(parseSignalInput({
    strategyId: 'smc-agent-v1', symbol: 'BTCUSDT', action: 'OPEN_LONG', confidence: 0.8,
    stopLossPrice: '58500', features: { quantity: 0.25, leverage: 4 },
  }));

  const result = await executor.execute(signal);

  expect(result).toBe(true);
  const submitted = broker.getOpenOrders('BTCUSDT')[0];
  expect(submitted?.quantity).toBe(0.25);
  expect(submitted?.leverage).toBe(4);
});
```

(Use this file's existing `makeBroker`/`makeSignalRepository`/import style — match whatever test-double pattern the file already uses; do not introduce a new mocking approach.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run test/unit/SignalExecutor.test.ts`
Expected: FAIL — `SignalExecutorDeps` still requires `sizing` per the current source, or the new test fails because `execute()` still calls `sizing.sizePosition()`.

- [ ] **Step 4: Update `SignalExecutor.ts`**

```typescript
import type { PaperBroker } from '../broker/PaperBroker.js';
import type { MarketState } from '../broker/types.js';
import type { Signal } from './signal.js';
import type { OrderFactory } from './OrderFactory.js';
import type { SignalRepository } from '../persistence/repositories/SignalRepository.js';

export interface SignalExecutorDeps {
  broker: PaperBroker;
  orderFactory: OrderFactory;
  signals: SignalRepository;
  getMarketState: (symbol: string) => MarketState | undefined;
  logger?: {
    warn: (msg: string) => void;
    error: (error: unknown, msg: string) => void;
  };
}

export class SignalExecutor {
  private deps: SignalExecutorDeps;

  constructor(deps: SignalExecutorDeps) {
    this.deps = deps;
  }

  async execute(signal: Signal): Promise<boolean> {
    const { broker, orderFactory, signals, getMarketState } = this.deps;
    const log = this.deps.logger ?? {
      warn: () => undefined,
      error: () => undefined,
    };

    if (signal.action === 'HOLD' || signal.action === 'CANCEL_ALL') {
      return true;
    }

    const position = broker.getPosition(signal.symbol);
    const market = getMarketState(signal.symbol);

    const entryPrice =
      signal.action === 'CLOSE_LONG' || signal.action === 'OPEN_SHORT'
        ? market?.bid
        : market?.ask;

    if (entryPrice === undefined) {
      log.warn(`[Signal] No price for ${signal.symbol}, skipping order`);
      return true;
    }

    const closeQty =
      signal.action.startsWith('CLOSE') && position ? Math.abs(position.qty) : 0;
    const openQty = signal.action.startsWith('OPEN')
      ? Number(signal.features.quantity ?? 0)
      : 0;
    const leverage = Number(signal.features.leverage ?? 5);

    const quantity = closeQty > 0 ? closeQty : openQty;
    if (quantity <= 0) {
      log.warn(`[Signal] Zero quantity for ${signal.symbol} ${signal.action}, skipping`);
      return true;
    }

    const orderCommand = {
      symbol: signal.symbol,
      side: signal.action === 'OPEN_LONG' || signal.action === 'CLOSE_SHORT' ? 'BUY' : 'SELL',
      type: 'MARKET',
      quantity,
      leverage,
      reduceOnly: signal.action.startsWith('CLOSE'),
    } as const;

    try {
      const order = broker.submitOrder(orderCommand);

      if (order.status === 'REJECTED') {
        log.warn(`[Signal] Order rejected: ${order.rejectReason ?? 'unknown'}`);
        signals.updateStatus(signal.id, 'REJECTED', undefined, order.rejectReason);
        return false;
      }

      signals.updateStatus(signal.id, 'EXECUTED', order.id);

      if (signal.action.startsWith('OPEN') && signal.stopLossPrice) {
        const stop = orderFactory.buildStopLossOrder(signal, quantity, leverage);
        if (stop) {
          const stopOrder = broker.submitOrder(stop);
          if (stopOrder.status === 'REJECTED') {
            log.warn(`[Signal] Stop order rejected: ${stopOrder.rejectReason ?? 'unknown'}`);
          }
        }
      }

      return true;
    } catch (error) {
      log.error(error, 'Signal order submission failed');
      signals.updateStatus(signal.id, 'REJECTED', 'ORDER_SUBMISSION_ERROR');
      return false;
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/unit/SignalExecutor.test.ts`
Expected: PASS (all existing tests plus the new one)

- [ ] **Step 6: Commit**

```bash
git add src/strategy/SignalExecutor.ts test/unit/SignalExecutor.test.ts
git commit -m "refactor(strategy): SignalExecutor sources quantity/leverage from signal.features"
```

---

## Task 5: Wire the SMC agent strategy into `engine.ts`, remove classic strategies

**Files:**
- Modify: `src/engine.ts`

**Interfaces:**
- Consumes: `createSmcAgentStrategy` (Task 3), `SetupEngine`/`MtfStateEngine`/`MarketStructureEngine`/`SmcLocationEngine`/`ExecutionPlanEngine`/`TradeIntentEngine`/`TradingAgentsPipeline` (all pre-existing).
- Produces: the live loop now registers exactly one strategy (`smc-agent-v1`) instead of seven.

- [ ] **Step 1: Remove classic strategy and sizing imports**

In `src/engine.ts`, delete these import lines:

```typescript
import { SizingEngine } from './strategy/SizingEngine.js';
import { createEmaTrendStrategy } from './strategy/strategies/ema-trend-5m.js';
import { createBreakoutStrategy } from './strategy/strategies/breakout-15m.js';
import { createRsiMeanReversionStrategy } from './strategy/strategies/rsi-mean-reversion-5m.js';
import { createMomentumStrategy } from './strategy/strategies/momentum-5m.js';
import { createGridStrategy } from './strategy/strategies/grid-15m.js';
import { createMeanReversionStrategy } from './strategy/strategies/mean-reversion-5m.js';
import { createOllamaTrendStrategy } from './strategy/strategies/ollama-trend-5m.js';
import { OllamaSignalGenerator } from './ai/ollama.js';
```

Add:

```typescript
import { MtfStateEngine } from './market/MtfStateEngine.js';
import { MarketStructureEngine } from './market/structure/MarketStructureEngine.js';
import { SmcLocationEngine } from './market/smc/SmcLocationEngine.js';
import { SetupEngine } from './market/setup/SetupEngine.js';
import { ExecutionPlanEngine } from './market/execution/ExecutionPlanEngine.js';
import { TradeIntentEngine } from './trading/TradeIntentEngine.js';
import { TradingAgentsPipeline } from './ai/tradingAgents.js';
import { createSmcAgentStrategy } from './strategy/strategies/smc-agent.js';
```

- [ ] **Step 2: Replace the sizing/order-factory block**

Find:

```typescript
  const sizing = new SizingEngine({
    riskPerTrade: 0.005,
    maxNotional: 5000,
    fallbackRiskPerTrade: 0.1,
  });
  const orderFactory = new OrderFactory({ defaultLeverage: 5 });
  const signalExecutor = new SignalExecutor({
    broker,
    sizing,
    orderFactory,
    signals: db.signals,
    getMarketState: (symbol) => marketState.getState(symbol),
    logger: {
      warn: (msg) => logger.warn(msg),
      error: (error, msg) => logger.error({ error }, msg),
    },
  });
```

Replace with:

```typescript
  const orderFactory = new OrderFactory({ defaultLeverage: 5 });
  const signalExecutor = new SignalExecutor({
    broker,
    orderFactory,
    signals: db.signals,
    getMarketState: (symbol) => marketState.getState(symbol),
    logger: {
      warn: (msg) => logger.warn(msg),
      error: (error, msg) => logger.error({ error }, msg),
    },
  });
```

- [ ] **Step 3: Replace the strategy registration block**

Find (spans from `strategyEngine.register(createEmaTrendStrategy...` through the `else { logger.warn('Ollama not reachable...') }` block, roughly lines 148-190):

```typescript
  strategyEngine.register(
    createEmaTrendStrategy({ /* ... */ })
  );
  strategyEngine.register(
    createBreakoutStrategy({ /* ... */ })
  );
  strategyEngine.register(
    createRsiMeanReversionStrategy({ /* ... */ })
  );
  strategyEngine.register(createMomentumStrategy({ symbols }));
  strategyEngine.register(createGridStrategy({ symbols }));
  strategyEngine.register(createMeanReversionStrategy({ symbols }));

  const ollamaGenerator = new OllamaSignalGenerator({
    baseUrl: env.OLLAMA_BASE_URL,
    model: env.OLLAMA_MODEL,
  });
  const ollamaAvailable = await ollamaGenerator.ping();
  if (ollamaAvailable) {
    strategyEngine.register(
      createOllamaTrendStrategy({ generator: ollamaGenerator, symbols })
    );
    logger.info({ model: env.OLLAMA_MODEL }, 'Registered Ollama trend strategy');
  } else {
    logger.warn('Ollama not reachable, skipping Ollama trend strategy');
  }
```

Replace with:

```typescript
  const structureEngine = new MarketStructureEngine(klines);
  const smcEngine = new SmcLocationEngine(klines, structureEngine);
  const mtfEngine = new MtfStateEngine(klines, marketState);
  const setupEngine = new SetupEngine(mtfEngine, structureEngine, smcEngine);
  const planEngine = new ExecutionPlanEngine();
  const tradeIntentEngine = new TradeIntentEngine();
  const tradingAgentsPipeline = new TradingAgentsPipeline({
    model: env.OLLAMA_MODEL,
    baseUrl: env.OLLAMA_BASE_URL,
  });

  strategyEngine.register(
    createSmcAgentStrategy({
      setupEngine,
      structureEngine,
      smcEngine,
      planEngine,
      tradeIntentEngine,
      tradingAgentsPipeline,
      getInstrument: (symbol) => broker.getInstrument(symbol),
      symbols,
    })
  );
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS — no references to deleted imports remain in `engine.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/engine.ts
git commit -m "feat(engine): register the SMC agent strategy, remove classic strategies from the live loop"
```

---

## Task 6: Delete the orphaned Ollama signal generator

> **Revised during execution (see ledger, Task 6 entry, 2026-08-23).** The
> original version of this task also deleted the 7 classic strategy files,
> `SizingEngine.ts`, and `src/backtest/BacktestRunner.ts`. That was wrong:
> `src/cli.ts`'s `backtest` subcommand still imports `BacktestRunner.ts`,
> which in turn imports the classic strategies and `SizingEngine` — deleting
> them here would break the CLI's only backtest path with no replacement.
> The repoint of `cli.ts` to `ReplayEngine` (spec §3, "Backtest
> unification") is Plan 2 of 4, not this plan. This task now deletes only
> the file nothing else references: `src/ai/ollama.ts`. The classic
> strategies, `SizingEngine.ts`, and `BacktestRunner.ts` stay on disk —
> unused by the live engine (Task 5 already stopped registering them) but
> still compiled and still serving `cli.ts`'s backtest command — until
> Plan 2 makes the whole trio safe to delete together.
>
> **Second revision (same day):** `src/strategy/strategies/ollama-trend-5m.ts`
> imports `OllamaSignalGenerator` from `ai/ollama.ts` (type-only, but
> `tsconfig.json` has no path exclusions so it still fails typecheck on
> deletion). Verified `BacktestRunner.ts` does NOT import
> `ollama-trend-5m.ts` (only the 6 non-Ollama classic strategies) and
> nothing else references `createOllamaTrendStrategy` — it is not part of
> the `BacktestRunner`/`cli.ts` cluster, so it's safe to delete alongside
> `ai/ollama.ts` in this same task.

**Files:**
- Delete: `src/ai/ollama.ts`, `src/strategy/strategies/ollama-trend-5m.ts`
- Modify or delete (investigate first): `test/unit/TelegramNotifier.test.ts` — only if it actually references `OllamaSignalGenerator`/`ai/ollama`, which is likely a false-positive grep match; `test/unit/PortedStrategies.test.ts` — only if it has a test specifically for `createOllamaTrendStrategy`

**Interfaces:** None — this task only removes now-unreferenced files.

- [ ] **Step 1: Confirm nothing outside these two files still imports them**

Run: `grep -rln "OllamaSignalGenerator\|ai/ollama\.js\|ollama-trend-5m\|createOllamaTrendStrategy" src test scripts`

Task 5 already removed `engine.ts`'s only reference. Confirm the only remaining hits are `src/ai/ollama.ts` and `src/strategy/strategies/ollama-trend-5m.ts` themselves, plus, possibly, dedicated test files for either (check for `test/unit/OllamaSignalGenerator.test.ts` or a `createOllamaTrendStrategy`-specific block inside `test/unit/PortedStrategies.test.ts` — delete/trim only what's dedicated to these two files). If any other file appears, stop and read it before proceeding — do not delete something still in use.

- [ ] **Step 2: Delete the files**

```bash
git rm src/ai/ollama.ts src/strategy/strategies/ollama-trend-5m.ts
```

If Step 1 found dedicated test coverage for either, remove that too (delete the file if it tests only these, or remove just the relevant test block if the file covers other things too).

- [ ] **Step 3: Handle `test/unit/TelegramNotifier.test.ts`**

Run: `grep -n "Ollama" test/unit/TelegramNotifier.test.ts`

This file's earlier grep match is almost certainly incidental (e.g. a symbol list or unrelated substring), not an actual import of `ai/ollama.ts` — `TelegramNotifier` has no dependency on it. If the grep above returns nothing, no change needed. If it does return an actual import, remove just that reference.

- [ ] **Step 4: Run the full test suite and typecheck**

Run: `pnpm typecheck && pnpm vitest run`
Expected: PASS — no import errors, no orphaned test failures. Note: `src/strategy/strategies/*` classic strategy files, `SizingEngine.ts`, and `BacktestRunner.ts` remain in the tree and still compile/test cleanly — they are simply unused by `engine.ts` after Task 5, not deleted.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(ai): delete orphaned OllamaSignalGenerator

Superseded by TradingAgentsPipeline, wired into engine.ts via
createSmcAgentStrategy (Task 5). The classic indicator strategies,
SizingEngine, and BacktestRunner remain — cli.ts's backtest command
still depends on them until Plan 2 (backtest unification) repoints
it to ReplayEngine. Per docs/decisions/0004-unified-agentic-decision-pipeline.md."
```

---

## Task 7: Integration test — structure → agents → risk gate

> **Revised during execution (see ledger, Task 7 entry, 2026-08-23).** Round
> 1 found this task's original premise false: `TradingAgentsPipeline`'s
> offline fallback (`src/ai/tradingAgents.ts:188-197`, used whenever no
> Ollama server is reachable, which is this test environment) hardcodes
> `{action: 'NEUTRAL', confidence: 0}` regardless of market facts — it is
> not "deterministic given market facts" as originally assumed, it's a
> constant. `runFundManager`'s `approved` check is therefore *always*
> `false` offline, and `evaluateCandle` gates on that before ever calling
> `TradeIntentEngine`. No end-to-end test through `onCandleClose` can reach
> the risk gate in this environment — not a fixture problem, a structural
> one. (This is correct, safety-first behavior for the real system — LLM
> unreachable should mean NO_TRADE, not a guess — it just makes this
> specific test premise unworkable as originally written.)
>
> Round 1 also found the original fixture (flat candles with one differing
> candle near the end) never produces a `SetupCandidate` at all —
> `SwingDetector` needs real strict-inequality pivots with confirming bars
> on both sides, and `KlineStore.upsertCandle` silently drops any candle
> with `openTime <= 0`, which was shifting every array index by one.
>
> **Ruling:** add a narrow DI seam. Widen
> `SmcAgentStrategyDeps.tradingAgentsPipeline`'s type from the concrete
> `TradingAgentsPipeline` class to a minimal structural interface
> (`runCycle` only) in `src/strategy/strategies/smc-agent.ts` — this is a
> type-only change; `TradingAgentsPipeline` already satisfies it
> structurally, so `engine.ts`'s real instance needs no change and no
> production behavior changes. This lets Task 7's test supply a fake
> agent-debate result to isolate what it actually needs to prove (risk-gate
> ordering), without touching `evaluateCandle`'s gate order or
> `tradingAgents.ts`'s fallback logic — both of which were explicitly
> rejected as fix targets (see ledger: reordering the gates contradicts the
> brainstormed design decision that risk is the *final* gate after agents;
> making the offline fallback approve trades based on a heuristic is a
> worse safety property than always defaulting to NEUTRAL).

**Files:**
- Modify: `src/strategy/strategies/smc-agent.ts` — add the structural interface, widen one field's type (small, additive, no behavior change)
- Create: `test/unit/SmcAgentPipeline.integration.test.ts`

**Interfaces:**
- Produces: `AgentDebatePipeline` (exported from `src/strategy/strategies/smc-agent.ts`): `{ runCycle(ctx: MarketFactContext): Promise<CycleRecord> }`. `SmcAgentStrategyDeps.tradingAgentsPipeline` changes from `TradingAgentsPipeline` to `AgentDebatePipeline`.

This test proves the risk gate blocks even when the fund manager approves, and that a healthy setup with sufficient equity produces a signal — using a fake `AgentDebatePipeline` that returns a fixed, approved `CycleRecord` (so the test isolates risk-gate ordering from `TradingAgentsPipeline`'s own LLM-dependent correctness, which is already covered by `test/unit/TradingAgentsPipeline.test.ts`) and a real candle fixture verified to produce an `EXECUTABLE` plan.

- [ ] **Step 1: Add the `AgentDebatePipeline` seam to `smc-agent.ts`**

In `src/strategy/strategies/smc-agent.ts`, add this exported interface near the top (after the existing imports) and change one field's type:

```typescript
import type { MarketFactContext, TradingAgentsPipeline } from '../../ai/tradingAgents.js';
import type { CycleRecord } from '../../ai/schemas.js';

export interface AgentDebatePipeline {
  runCycle(ctx: MarketFactContext): Promise<CycleRecord>;
}
```

In `SmcAgentStrategyDeps`, change:

```typescript
tradingAgentsPipeline: TradingAgentsPipeline;
```

to:

```typescript
tradingAgentsPipeline: AgentDebatePipeline;
```

`TradingAgentsPipeline` already has exactly this `runCycle` signature, so it satisfies `AgentDebatePipeline` structurally — `engine.ts`'s real instantiation (`new TradingAgentsPipeline({...})`, from Task 5) needs no change and no behavior changes. Run `pnpm typecheck` after this edit alone to confirm `engine.ts` still compiles clean before writing the test.

- [ ] **Step 2: Write the test**

The candle fixture must produce a real `SetupCandidate` reaching `status: 'READY'` with confluence ≥ 65 (`DEFAULT_SETUP_CONFIG.minConfluenceScore`), and an `EXECUTABLE` `ExecutionPlan` — not just "any candles," since `SwingDetector` requires genuine strict-inequality pivots with confirming bars on both sides (flat/repeated candles never register). Build a 15m series with, in order: a swing high, a swing low, a sweep below the swing low that closes back above it (SSL sweep — liquidity grab), a strong bullish displacement candle immediately after (creates a bullish FVG), a break of structure candle closing above the swing high (BOS/CHOCH bullish), and a retest candle dipping back into the FVG. Mirror a small SSL sweep on the 5m series for `triggerEvidence`. Two pitfalls to avoid, both hard-won: `KlineStore.upsertCandle` (`src/market/Klines.ts`) silently drops any candle with `openTime <= 0` — anchor indices at `(i + 1) * stepMs`, not `i * stepMs`, so no candle lands at 0. And `SetupEngine` picks the *first* matching FVG via `.find(...)`, not the best one — keep any earlier candles' highs/lows tight enough that only the intended candle triple satisfies the gap condition, or an unrelated earlier FVG gets picked instead and produces a nonsensical entry price. Provide enough leading flat 4h/1h/15m/5m history before this sequence to satisfy `MIN_CLOSED_CANDLES` per timeframe (`src/market/MtfStateEngine.ts`) so `MtfStateEngine` reports `isFullySynchronized`.

Write a fake `AgentDebatePipeline`:

```typescript
import type { AgentDebatePipeline } from '../../src/strategy/strategies/smc-agent.js';
import type { CycleRecord } from '../../src/ai/schemas.js';

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
```

Write the two tests using `createSmcAgentStrategy` with real `SetupEngine`/`MtfStateEngine`/`MarketStructureEngine`/`SmcLocationEngine`/`ExecutionPlanEngine`/`TradeIntentEngine` (no fakes for any of these — they are what this test proves) and the fake `AgentDebatePipeline` above (matching the setup candidate's real direction) in place of a real `TradingAgentsPipeline`:

1. **`does not produce a signal when the risk engine rejects due to insufficient equity`** — same account/context construction pattern as before (`equity: 1`), asserting `result` is `null`. With the fake pipeline always approving, a `null` result here can only mean the risk gate rejected — this is the property the whole task exists to prove.
2. **`produces a signal when structure, agents, and risk all agree the trade is sound`** — `equity: 10000`, asserting `result` is non-null and its `strategyId`/`action`/`features.quantity` are sane. Because the fixture is now engineered (not incidental) to produce a real `EXECUTABLE` plan and the fake pipeline always approves, this test should reliably produce a signal — if it doesn't, that's a real finding to report, not something to route around with an `if (result)` guard.

- [ ] **Step 3: Run the tests**

Run: `pnpm vitest run test/unit/SmcAgentPipeline.integration.test.ts`
Expected: PASS, both tests, for the real reasons stated in their names — not vacuously. Verify this yourself: temporarily log or assert `setupEngine.getReadySetups(...)` and `plan.status` inside the test while developing it, to confirm the fixture actually reaches a READY setup and an EXECUTABLE plan before trusting a `null`/non-`null` result. Remove any such debug logging before committing.

The first test (insufficient equity) MUST pass for the reason it claims — if it doesn't, or if you can't confirm the fixture reaches `EXECUTABLE` at all, this is a stop-the-line issue per AGENTS.md §6.2, not something to route around.

- [ ] **Step 4: If either test fails or passes vacuously, debug before proceeding**

If the fixture doesn't reach a READY setup / EXECUTABLE plan: re-check the pitfalls in Step 2 (openTime<=0 drop, first-match FVG selection, insufficient leading history for `MIN_CLOSED_CANDLES`). If the fixture is confirmed correct but the insufficient-equity test still doesn't reject: read `TradeIntentEngine.processExecutionPlan` and `RiskEngine.validateSignalRisk` to confirm `maxAccountRiskPct`/`riskPerTradePct` actually reject a 1 USDT account. Do not weaken either test's assertions to force a pass — this test's entire purpose is to fail loudly if the risk gate doesn't work.

- [ ] **Step 5: Run full typecheck, lint, and suite**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`
Expected: all PASS — confirms the Step 1 interface widening didn't break `engine.ts` or anything else.

- [ ] **Step 6: Commit**

```bash
git add src/strategy/strategies/smc-agent.ts test/unit/SmcAgentPipeline.integration.test.ts
git commit -m "test(strategy): integration-test the structure->agents->risk-gate pipeline

Adds an AgentDebatePipeline seam (structural interface, no behavior
change to TradingAgentsPipeline or engine.ts) so this test can isolate
risk-gate ordering from the LLM debate's own correctness, which
TradingAgentsPipeline's offline fallback cannot reach unconditionally
(see docs/superpowers/plans/2026-08-22-graph-unification.md ledger,
Task 7)."
```

---

## Task 8: Full verification

- [ ] **Step 1: Run complete verification**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build`
Expected: all four PASS.

- [ ] **Step 2: Manual smoke check of `engine.ts` wiring**

Run: `pnpm dev` (or `tsx src/index.ts` per this repo's dev script) briefly, confirm the startup banner prints, no unhandled promise rejection or import error appears, and `strategyEngine.listStrategies()` (via logs or a temporary `console.log`) shows exactly one strategy: `smc-agent-v1`. Stop the process (Ctrl+C) once confirmed — this phase does not require a live trading session, only confirming boot succeeds.

- [ ] **Step 3: Update PROJECT_STATE.md**

Per AGENTS.md §24, update the "Agent / LLM" and "Current Capabilities" tables: `Agent loop` moves from `partial` to `implemented` (TradingAgentsPipeline now drives live signals, not just the manual `/api/v1/agents/cycle` endpoint), classic strategy bullet points are removed, `SMC concepts` moves from "In Progress" to "Implemented" for the live path.

- [ ] **Step 4: Final commit**

```bash
git add PROJECT_STATE.md
git commit -m "docs: update PROJECT_STATE.md for the unified SMC+agent live pipeline"
```
