import { describe, it, expect, vi } from 'vitest';
import { KlineStore } from '../../src/market/Klines.js';
import { MarketStateManager } from '../../src/market/MarketState.js';
import { MtfStateEngine, TIMEFRAME_MS, type AnalysisTimeframe } from '../../src/market/MtfStateEngine.js';
import { MarketStructureEngine } from '../../src/market/structure/MarketStructureEngine.js';
import { SmcLocationEngine } from '../../src/market/smc/SmcLocationEngine.js';
import { SetupEngine } from '../../src/market/setup/SetupEngine.js';
import { MarketRegimeDetector } from '../../src/analysis/MarketRegimeDetector.js';
import { AdaptiveRiskManager } from '../../src/risk/AdaptiveRiskManager.js';
import { AutonomousTradingAgent } from '../../src/agent/AutonomousTradingAgent.js';
import { PerformanceTracker } from '../../src/agent/PerformanceTracker.js';
import { CircuitBreaker } from '../../src/agent/CircuitBreaker.js';
import { ExitManager, type ScalingConfig } from '../../src/agent/ExitManager.js';
import { HealthMonitor } from '../../src/agent/HealthMonitor.js';
import { StrategyEngine } from '../../src/strategy/StrategyEngine.js';
import { DEFAULT_RISK_CONFIG } from '../../src/trading/risk/RiskLimits.js';
import { ModelManager } from '../../src/ai/ModelManager.js';
import type { AccountState, Position, Instrument } from '../../src/broker/types.js';
import type { Signal, SignalInput } from '../../src/strategy/signal.js';
import { EventLog } from '../../src/persistence/EventLog.js';
import { WebSocketGateway } from '../../src/api/websocket/WebSocketGateway.js';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function makeMockInstrument(symbol = 'SOLUSDT'): Instrument {
  return {
    symbol,
    baseAsset: 'SOL',
    quoteAsset: 'USDT',
    contractType: 'PERPETUAL',
    status: 'TRADING',
    tickSize: '0.01',
    stepSize: '0.001',
    minQty: '0.001',
    minNotional: '5',
    pricePrecision: 2,
    quantityPrecision: 3,
    maintenanceMarginRate: '0.005',
    createdAtUtc: new Date().toISOString(),
    updatedAtUtc: new Date().toISOString(),
  };
}

/**
 * Generate synthetic 4h candles that trend strongly upward — the regime
 * classifier should label this TRENDING_STRONG.
 */
function populateTrendingUp(store: KlineStore, symbol: string, tf: AnalysisTimeframe, count: number, startTs = 1700000000000, basePrice = 100): number {
  const intervalMs = TIMEFRAME_MS[tf];
  let currentTs = startTs;
  for (let i = 0; i < count; i++) {
    const close = basePrice + i * 1.5;
    store.upsertCandle({
      symbol,
      interval: tf,
      openTime: currentTs,
      closeTime: currentTs + intervalMs - 1,
      open: close - 1,
      high: close + 1.5,
      low: close - 2,
      close,
      volume: 1500 + i * 10,
      isClosed: true,
    });
    currentTs += intervalMs;
  }
  return currentTs;
}

function makeEventLog(): EventLog {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-broker-test-'));
  const db = new Database(path.join(tmp, 'paper.sqlite3'));
  return new EventLog(path.join(tmp, 'events.jsonl'), db);
}

function makeFakeAccount(equity = 10000, dailyRealizedPnl = 0): AccountState {
  return {
    walletBalance: equity,
    unrealizedPnl: 0,
    equity,
    initialMargin: 0,
    maintenanceMargin: 0,
    availableBalance: equity,
    totalFees: 0,
    totalFunding: 0,
    totalRealizedPnl: 0,
    openPositionsCount: 0,
    openOrdersCount: 0,
    dailyRealizedPnl,
    liquidations: 0,
  };
}

/**
 * Build all four "brain" modules with mock-friendly deps. Returns the modules
 * plus the mock state they share so the test can drive outcomes (e.g.
 * inject performance outcomes, trip the breaker, etc.) from one place.
 */
function makeBrainModules(opts: {
  symbols: string[];
  eventLog: EventLog;
  wsGateway: WebSocketGateway;
  store: KlineStore;
  structureEngine: MarketStructureEngine;
  marketState: MarketStateManager;
  mtfEngine: MtfStateEngine;
  strategyEngine: StrategyEngine;
  regimeDetector: MarketRegimeDetector;
  modelManager: ModelManager;
  getAccount: () => AccountState;
  getPositions: () => Position[];
  getLastPrice: (symbol: string) => number | undefined;
  /** Optional position-scaling config (Finding 2) — absent = scaling disabled. */
  scaling?: ScalingConfig;
}) {
  const performanceTracker = new PerformanceTracker(
    {
      strategyId: 'autonomous-agent-test',
      windowSize: 30,
      minSample: 3,
      riskAdaptStep: 0.1,
      riskMultMin: 0.5,
      riskMultMax: 1.5,
    },
    { eventLog: opts.eventLog }
  );

  const healthMonitor = new HealthMonitor(
    {
      symbols: opts.symbols,
      timeframes: ['4h', '1h', '15m', '5m'] as const,
      staleMs: 60_000,
      modelProbeIntervalMs: 0, // disable model probes in tests
    },
    {
      eventLog: opts.eventLog,
      wsGateway: opts.wsGateway,
      mtfEngine: opts.mtfEngine,
      marketState: opts.marketState,
      modelManager: opts.modelManager,
    }
  );

  const circuitBreaker = new CircuitBreaker(
    {
      maxDailyLossPct: 0.03,
      maxConsecutiveLosses: 3,
      maxDrawdownPct: 0.08,
      cooldownMs: 1_000,
      requireHealthyMarket: false, // don't trip on test-fixture stale data
    },
    {
      eventLog: opts.eventLog,
      wsGateway: opts.wsGateway,
      getAccount: opts.getAccount,
      getConsecutiveLosses: () => performanceTracker.getRollingStats().consecutiveLosses,
      getHealth: () => healthMonitor.getState(),
    }
  );

  const exitManager = new ExitManager(
    {
      exitOnRegimeFlip: true,
      maxUnrealizedLossPct: 0.02,
      strategyId: 'autonomous-agent-test',
      ...(opts.scaling ? { scaling: opts.scaling } : {}),
    },
    {
      eventLog: opts.eventLog,
      wsGateway: opts.wsGateway,
      strategyEngine: opts.strategyEngine,
      regimeDetector: opts.regimeDetector,
      getPositions: opts.getPositions,
      getAccount: opts.getAccount,
      getLastPrice: opts.getLastPrice,
      forgetTrailingStop: vi.fn(),
    }
  );

  return { performanceTracker, circuitBreaker, exitManager, healthMonitor };
}

describe('MarketRegimeDetector', () => {
  it('classifies a strong uptrend as TRENDING_STRONG', () => {
    const store = new KlineStore(500);
    const marketState = new MarketStateManager([makeMockInstrument()]);
    const mtfEngine = new MtfStateEngine(store, marketState);
    const structureEngine = new MarketStructureEngine(store);

    const asOf = populateTrendingUp(store, 'SOLUSDT', '4h', 50);

    const detector = new MarketRegimeDetector(
      (sym, count) => store.getCandles(sym, '4h', count).filter((c) => c.isClosed).slice(-count),
      (sym) => structureEngine.computeMultiTimeframeStructure(sym, asOf).timeframes['1h']?.trend,
      3
    );

    const snap = detector.detect('SOLUSDT', undefined, asOf);
    expect(snap).not.toBeNull();
    expect(snap!.regime).toBe('TRENDING_STRONG');
    expect(snap!.confidence).toBeGreaterThan(50);
  });

  it('returns a sensible adaptation for every regime', () => {
    const store = new KlineStore(500);
    const structureEngine = new MarketStructureEngine(store);
    const detector = new MarketRegimeDetector(
      () => [],
      () => 'RANGE',
      3
    );
    const regimes = [
      'TRENDING_STRONG',
      'TRENDING_NORMAL',
      'RANGING_LOW_VOL',
      'RANGING_HIGH_VOL',
      'VOLATILE_BREAKOUT',
      'TRANSITIONING',
    ] as const;
    for (const r of regimes) {
      const a = detector.getAdaptation(r);
      expect(a.regime).toBe(r);
      expect(a.minRR).toBeGreaterThan(0);
      expect(a.maxLeverage).toBeGreaterThanOrEqual(1);
      expect(a.rationale.length).toBeGreaterThan(0);
    }
  });
});

describe('AdaptiveRiskManager', () => {
  it('builds a trade plan that clears the regime min RR for a strong trend', () => {
    const store = new KlineStore(500);
    populateTrendingUp(store, 'SOLUSDT', '1h', 50);
    const detector = new MarketRegimeDetector(
      () => store.getCandles('SOLUSDT', '4h', 100).filter((c) => c.isClosed).slice(-100),
      () => 'BULLISH',
      3
    );
    const adaptation = detector.getAdaptation('TRENDING_STRONG');

    const rm = new AdaptiveRiskManager({
      baseConfig: DEFAULT_RISK_CONFIG,
      getEquity: () => 10000,
      getLastPrice: () => 150,
      getCandles: (sym, _tf, count) => store.getCandles(sym, '1h', count).filter((c) => c.isClosed).slice(-count),
    });

    const plan = rm.computeTradePlan('SOLUSDT', 'LONG', adaptation, '1h');
    expect(plan).not.toBeNull();
    expect(plan!.stopLossPrice).toBeLessThan(plan!.entryPrice);
    expect(plan!.takeProfitPrice).toBeGreaterThan(plan!.entryPrice);
    expect(plan!.rr).toBeGreaterThanOrEqual(adaptation.minRR);
    expect(plan!.leverage).toBeLessThanOrEqual(DEFAULT_RISK_CONFIG.maxLeverage);
    expect(plan!.leverage).toBeLessThanOrEqual(adaptation.maxLeverage);
  });

  it('reports TRANSITIONING as not tradeable', () => {
    const rm = new AdaptiveRiskManager({
      baseConfig: DEFAULT_RISK_CONFIG,
      getEquity: () => 10000,
      getLastPrice: () => 100,
      getCandles: () => [],
    });
    expect(rm.isTradeable('TRANSITIONING')).toBe(false);
    expect(rm.isTradeable('TRENDING_STRONG')).toBe(true);
  });
});

// =============================================================================
// NEW: tests for the four "brain" modules
// =============================================================================

describe('PerformanceTracker', () => {
  it('reports zero stats when no outcomes have been recorded', () => {
    const eventLog = makeEventLog();
    const tracker = new PerformanceTracker(
      { strategyId: 'autonomous-agent-test', windowSize: 30, minSample: 3, riskAdaptStep: 0.1, riskMultMin: 0.5, riskMultMax: 1.5 },
      { eventLog }
    );
    tracker.refresh();
    const stats = tracker.getRollingStats();
    expect(stats.trades).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.expectancy).toBe(0);
  });

  it('computes win rate, expectancy, and consecutive losses from injected outcomes', () => {
    const eventLog = makeEventLog();
    const tracker = new PerformanceTracker(
      { strategyId: 'autonomous-agent-test', windowSize: 30, minSample: 3, riskAdaptStep: 0.1, riskMultMin: 0.5, riskMultMax: 1.5 },
      { eventLog }
    );
    // 3 wins, 2 losses, with the latest 2 being losses (consecutive).
    tracker.injectOutcomes([
      { strategyId: 'autonomous-agent-test', symbol: 'SOLUSDT', regime: 'TRENDING_STRONG', setupType: 'X', direction: 'LONG', pnl: 100, closedAt: '2026-01-01T00:00:00.000Z' },
      { strategyId: 'autonomous-agent-test', symbol: 'SOLUSDT', regime: 'TRENDING_STRONG', setupType: 'X', direction: 'LONG', pnl: 50, closedAt: '2026-01-02T00:00:00.000Z' },
      { strategyId: 'autonomous-agent-test', symbol: 'SOLUSDT', regime: 'TRENDING_STRONG', setupType: 'X', direction: 'LONG', pnl: 80, closedAt: '2026-01-03T00:00:00.000Z' },
      { strategyId: 'autonomous-agent-test', symbol: 'SOLUSDT', regime: 'TRENDING_STRONG', setupType: 'X', direction: 'LONG', pnl: -40, closedAt: '2026-01-04T00:00:00.000Z' },
      { strategyId: 'autonomous-agent-test', symbol: 'SOLUSDT', regime: 'TRENDING_STRONG', setupType: 'X', direction: 'LONG', pnl: -60, closedAt: '2026-01-05T00:00:00.000Z' },
    ]);
    const stats = tracker.getRollingStats();
    expect(stats.trades).toBe(5);
    expect(stats.wins).toBe(3);
    expect(stats.losses).toBe(2);
    expect(stats.winRate).toBeCloseTo(0.6, 2);
    expect(stats.consecutiveLosses).toBe(2);
    // Expectancy = 0.6 * 76.67 - 0.4 * 50 = 46 - 20 = ~26
    expect(stats.expectancy).toBeGreaterThan(20);
    expect(stats.expectancy).toBeLessThan(30);
  });

  it('suggests a risk multiplier above 1 when winning, returns 1 when sample too small', () => {
    const eventLog = makeEventLog();
    const tracker = new PerformanceTracker(
      { strategyId: 'autonomous-agent-test', windowSize: 30, minSample: 3, riskAdaptStep: 0.1, riskMultMin: 0.5, riskMultMax: 1.5 },
      { eventLog }
    );
    // Small sample → no adjustment.
    tracker.injectOutcomes([
      { strategyId: 'autonomous-agent-test', symbol: 'SOLUSDT', regime: 'TRENDING_STRONG', setupType: 'X', direction: 'LONG', pnl: 10, closedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(tracker.suggestRiskMultiplier()).toBe(1.0);

    // 5 wins, 0 losses → winRate = 1.0 → kelly = 1.0 → target = max.
    tracker.injectOutcomes([
      { strategyId: 'autonomous-agent-test', symbol: 'SOLUSDT', regime: 'TRENDING_STRONG', setupType: 'X', direction: 'LONG', pnl: 10, closedAt: '2026-01-05T00:00:00.000Z' },
      { strategyId: 'autonomous-agent-test', symbol: 'SOLUSDT', regime: 'TRENDING_STRONG', setupType: 'X', direction: 'LONG', pnl: 10, closedAt: '2026-01-04T00:00:00.000Z' },
      { strategyId: 'autonomous-agent-test', symbol: 'SOLUSDT', regime: 'TRENDING_STRONG', setupType: 'X', direction: 'LONG', pnl: 10, closedAt: '2026-01-03T00:00:00.000Z' },
      { strategyId: 'autonomous-agent-test', symbol: 'SOLUSDT', regime: 'TRENDING_STRONG', setupType: 'X', direction: 'LONG', pnl: 10, closedAt: '2026-01-02T00:00:00.000Z' },
      { strategyId: 'autonomous-agent-test', symbol: 'SOLUSDT', regime: 'TRENDING_STRONG', setupType: 'X', direction: 'LONG', pnl: 10, closedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const suggested = tracker.suggestRiskMultiplier();
    // With step 0.1, max move from 1.0 is +0.1, capped at max=1.5.
    expect(suggested).toBeGreaterThan(1.0);
    expect(suggested).toBeLessThanOrEqual(1.5);
  });

  it('does not adjust during a 3+ losing streak', () => {
    const eventLog = makeEventLog();
    const tracker = new PerformanceTracker(
      { strategyId: 'autonomous-agent-test', windowSize: 30, minSample: 3, riskAdaptStep: 0.1, riskMultMin: 0.5, riskMultMax: 1.5 },
      { eventLog }
    );
    tracker.injectOutcomes([
      { strategyId: 'autonomous-agent-test', symbol: 'SOLUSDT', regime: 'TRENDING_STRONG', setupType: 'X', direction: 'LONG', pnl: -10, closedAt: '2026-01-03T00:00:00.000Z' },
      { strategyId: 'autonomous-agent-test', symbol: 'SOLUSDT', regime: 'TRENDING_STRONG', setupType: 'X', direction: 'LONG', pnl: -10, closedAt: '2026-01-02T00:00:00.000Z' },
      { strategyId: 'autonomous-agent-test', symbol: 'SOLUSDT', regime: 'TRENDING_STRONG', setupType: 'X', direction: 'LONG', pnl: -10, closedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(tracker.suggestRiskMultiplier()).toBe(1.0);
  });
});

describe('CircuitBreaker', () => {
  it('allows entries when all thresholds are within bounds', () => {
    const eventLog = makeEventLog();
    const wsGateway = { broadcast: vi.fn() } as unknown as WebSocketGateway;
    const breaker = new CircuitBreaker(
      { maxDailyLossPct: 0.03, maxConsecutiveLosses: 3, maxDrawdownPct: 0.08, cooldownMs: 1_000, requireHealthyMarket: false },
      {
        eventLog,
        wsGateway,
        getAccount: () => makeFakeAccount(10000, 0),
        getConsecutiveLosses: () => 0,
        getHealth: () => ({ healthy: true, issues: [], lastCheckedAt: 0 }),
      }
    );
    const result = breaker.check(1000);
    expect(result.allowEntries).toBe(true);
    expect(breaker.getState().tripped).toBe(false);
  });

  it('trips on daily loss exceeding threshold', () => {
    const eventLog = makeEventLog();
    const wsGateway = { broadcast: vi.fn() } as unknown as WebSocketGateway;
    const breaker = new CircuitBreaker(
      { maxDailyLossPct: 0.03, maxConsecutiveLosses: 3, maxDrawdownPct: 0.08, cooldownMs: 60_000, requireHealthyMarket: false },
      {
        eventLog,
        wsGateway,
        // 400 loss on 10000 equity = 4% — exceeds 3% threshold.
        getAccount: () => makeFakeAccount(10000, -400),
        getConsecutiveLosses: () => 0,
        getHealth: () => ({ healthy: true, issues: [], lastCheckedAt: 0 }),
      }
    );
    const result = breaker.check(1000);
    expect(result.allowEntries).toBe(false);
    expect(result.reason).toBe('MAX_DAILY_LOSS');
    expect(breaker.getState().tripped).toBe(true);
    // Broadcast called with tripped action.
    const calls = wsGateway.broadcast.mock.calls as Array<[string, unknown]>;
    const tripCall = calls.find((c) => c[0] === 'agent.autonomous.circuit_breaker');
    expect(tripCall).toBeDefined();
    expect((tripCall![1] as { action: string }).action).toBe('tripped');
  });

  it('trips on consecutive losses', () => {
    const eventLog = makeEventLog();
    const wsGateway = { broadcast: vi.fn() } as unknown as WebSocketGateway;
    const breaker = new CircuitBreaker(
      { maxDailyLossPct: 0.03, maxConsecutiveLosses: 3, maxDrawdownPct: 0.08, cooldownMs: 60_000, requireHealthyMarket: false },
      {
        eventLog,
        wsGateway,
        getAccount: () => makeFakeAccount(10000, 0),
        getConsecutiveLosses: () => 3,
        getHealth: () => ({ healthy: true, issues: [], lastCheckedAt: 0 }),
      }
    );
    const result = breaker.check(1000);
    expect(result.allowEntries).toBe(false);
    expect(result.reason).toBe('CONSECUTIVE_LOSSES');
  });

  it('auto-clears after the cooldown elapses', () => {
    const eventLog = makeEventLog();
    const wsGateway = { broadcast: vi.fn() } as unknown as WebSocketGateway;
    const breaker = new CircuitBreaker(
      { maxDailyLossPct: 0.03, maxConsecutiveLosses: 3, maxDrawdownPct: 0.08, cooldownMs: 1_000, requireHealthyMarket: false },
      {
        eventLog,
        wsGateway,
        // Trip via daily loss at t=1000.
        getAccount: () => makeFakeAccount(10000, -400),
        getConsecutiveLosses: () => 0,
        getHealth: () => ({ healthy: true, issues: [], lastCheckedAt: 0 }),
      }
    );
    // Trip at t=1000.
    expect(breaker.check(1000).allowEntries).toBe(false);
    // At t=1500 still tripped (cooldown = 1000, ends at 2000).
    expect(breaker.check(1500).allowEntries).toBe(false);
    // Conditions now clear (account no longer in loss) AND cooldown elapsed.
    const breakerClear = new CircuitBreaker(
      { maxDailyLossPct: 0.03, maxConsecutiveLosses: 3, maxDrawdownPct: 0.08, cooldownMs: 1_000, requireHealthyMarket: false },
      {
        eventLog,
        wsGateway,
        getAccount: () => makeFakeAccount(10000, 0),
        getConsecutiveLosses: () => 0,
        getHealth: () => ({ healthy: true, issues: [], lastCheckedAt: 0 }),
      }
    );
    // Force trip on this new breaker first so we can exercise auto-clear.
    breakerClear.forceTrip('OPERATOR_OVERRIDE', 1000);
    expect(breakerClear.getState().tripped).toBe(true);
    // Past cooldown with no breaches → auto-clear.
    const result = breakerClear.check(3000);
    expect(result.allowEntries).toBe(true);
  });

  it('force-trip and force-clear are explicit', () => {
    const eventLog = makeEventLog();
    const wsGateway = { broadcast: vi.fn() } as unknown as WebSocketGateway;
    const breaker = new CircuitBreaker(
      { maxDailyLossPct: 0.03, maxConsecutiveLosses: 3, maxDrawdownPct: 0.08, cooldownMs: 60_000, requireHealthyMarket: false },
      {
        eventLog,
        wsGateway,
        getAccount: () => makeFakeAccount(10000, 0),
        getConsecutiveLosses: () => 0,
        getHealth: () => ({ healthy: true, issues: [], lastCheckedAt: 0 }),
      }
    );
    breaker.forceTrip('OPERATOR_OVERRIDE', 1000);
    expect(breaker.getState().tripped).toBe(true);
    expect(breaker.getState().reason).toBe('OPERATOR_OVERRIDE');
    breaker.forceClear(2000);
    expect(breaker.getState().tripped).toBe(false);
  });
});

describe('ExitManager', () => {
  it('exits when unrealized loss exceeds max pct of equity', () => {
    const eventLog = makeEventLog();
    const wsGateway = { broadcast: vi.fn() } as unknown as WebSocketGateway;
    const store = new KlineStore(500);
    populateTrendingUp(store, 'SOLUSDT', '4h', 60);
    populateTrendingUp(store, 'SOLUSDT', '1h', 60);
    const detector = new MarketRegimeDetector(
      () => store.getCandles('SOLUSDT', '4h', 100).filter((c) => c.isClosed).slice(-100),
      () => 'BULLISH',
      3
    );
    const submitted: SignalInput[] = [];
    const strategyEngine = {
      async submitSignal(input: SignalInput): Promise<Signal | null> {
        submitted.push(input);
        return { ...input, id: 'test-sig-id', ts: Date.now(), status: 'EXECUTED' } as Signal;
      },
      isRunning: () => true,
    } as unknown as StrategyEngine;

    const em = new ExitManager(
      { exitOnRegimeFlip: false, maxUnrealizedLossPct: 0.02, strategyId: 'autonomous-agent-test' },
      {
        eventLog,
        wsGateway,
        strategyEngine,
        regimeDetector: detector,
        getPositions: () => [],
        getAccount: () => makeFakeAccount(10000, 0),
        getLastPrice: () => 100,
        forgetTrailingStop: vi.fn(),
      }
    );

    // LONG 1 SOL at entry 150, current price 100 → unrealized = -50 USDT = -0.5% of 10000 equity.
    // 0.5% < 2%, so should HOLD.
    const position1: Position = {
      accountId: 'a', symbol: 'SOLUSDT', positionSide: 'BOTH', status: 'OPEN', qty: 1, entryPrice: 150,
      unrealizedPnl: -50, realizedPnl: 0, leverage: 5, initialMargin: 30, maintenanceMargin: 1,
      maintenanceMarginRate: 0.005, totalFees: 0, totalFunding: 0, updatedAtUtc: new Date().toISOString(),
    };
    const decision1 = em.evaluateOne(position1, new Map(), makeFakeAccount(10000, 0), Date.now());
    expect(decision1.action).toBe('HOLD');

    // Now make it big enough to breach: qty=10 at entry 150, last=100 → unrealized = -500 = 5% of 10000.
    // Breach 2% threshold → EXIT_NOW.
    const position2: Position = { ...position1, qty: 10, unrealizedPnl: -500 };
    const decision2 = em.evaluateOne(position2, new Map(), makeFakeAccount(10000, 0), Date.now());
    expect(decision2.action).toBe('EXIT_NOW');
    expect(decision2.reason).toBe('UNREALIZED_LOSS_BREACH');
  });

  it('forgets the trailing stop after submitting a close signal', async () => {
    const eventLog = makeEventLog();
    const wsGateway = { broadcast: vi.fn() } as unknown as WebSocketGateway;
    const store = new KlineStore(500);
    populateTrendingUp(store, 'SOLUSDT', '4h', 60);
    const detector = new MarketRegimeDetector(
      () => store.getCandles('SOLUSDT', '4h', 100).filter((c) => c.isClosed).slice(-100),
      () => 'BULLISH',
      3
    );
    const strategyEngine = {
      async submitSignal(input: SignalInput): Promise<Signal | null> {
        return { ...input, id: 'test-sig-id', ts: Date.now(), status: 'EXECUTED' } as Signal;
      },
      isRunning: () => true,
    } as unknown as StrategyEngine;
    const forgetFn = vi.fn();
    const em = new ExitManager(
      { exitOnRegimeFlip: false, maxUnrealizedLossPct: 0.01, strategyId: 'autonomous-agent-test' },
      {
        eventLog,
        wsGateway,
        strategyEngine,
        regimeDetector: detector,
        getPositions: () => [
          {
            accountId: 'a', symbol: 'SOLUSDT', positionSide: 'BOTH', status: 'OPEN', qty: 10, entryPrice: 150,
            unrealizedPnl: -500, realizedPnl: 0, leverage: 5, initialMargin: 30, maintenanceMargin: 1,
            maintenanceMarginRate: 0.005, totalFees: 0, totalFunding: 0, updatedAtUtc: new Date().toISOString(),
          },
        ],
        getAccount: () => makeFakeAccount(10000, 0),
        getLastPrice: () => 100,
        forgetTrailingStop: forgetFn,
      }
    );

    const decisions = await em.evaluateExits(new Map(), 'test-cycle', Date.now());
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.action).toBe('EXIT_NOW');
    // Forget must have been called once for the symbol.
    expect(forgetFn).toHaveBeenCalledTimes(1);
    expect(forgetFn).toHaveBeenCalledWith('SOLUSDT');
  });
});

describe('HealthMonitor', () => {
  it('reports healthy when all probes are green', async () => {
    const eventLog = makeEventLog();
    const wsGateway = { broadcast: vi.fn() } as unknown as WebSocketGateway;
    const store = new KlineStore(500);
    const instrument = makeMockInstrument();
    const marketState = new MarketStateManager([instrument]);
    const mtfEngine = new MtfStateEngine(store, marketState);
    // Populate all timeframes so syncStatus is SYNCHRONIZED.
    for (const tf of ['4h', '1h', '15m', '5m'] as AnalysisTimeframe[]) {
      populateTrendingUp(store, 'SOLUSDT', tf, 60);
    }
    // Push a fresh market-state tick so isStale returns false.
    marketState.onBookTicker('SOLUSDT', 100, 100.05, 0, 0);
    marketState.onAggTrade('SOLUSDT', 100, 0);
    marketState.onMarkPrice('SOLUSDT', 100, 100, 0);
    const modelManager = {
      isReachable: vi.fn().mockResolvedValue(true),
    } as unknown as ModelManager;

    const monitor = new HealthMonitor(
      { symbols: ['SOLUSDT'], timeframes: [], staleMs: 60_000, modelProbeIntervalMs: 0 },
      { eventLog, wsGateway, mtfEngine, marketState, modelManager }
    );
    const state = await monitor.check();
    expect(state.healthy).toBe(true);
    expect(state.issues).toHaveLength(0);
  });

  it('reports an issue when market state is stale', async () => {
    const eventLog = makeEventLog();
    const wsGateway = { broadcast: vi.fn() } as unknown as WebSocketGateway;
    const store = new KlineStore(500);
    const instrument = makeMockInstrument();
    const marketState = new MarketStateManager([instrument]);
    const mtfEngine = new MtfStateEngine(store, marketState);
    // No tick pushed → isStale returns true.
    const modelManager = {
      isReachable: vi.fn().mockResolvedValue(true),
    } as unknown as ModelManager;

    const monitor = new HealthMonitor(
      // 60s staleness threshold — but the market state was never updated, so it IS stale.
      { symbols: ['SOLUSDT'], timeframes: [], staleMs: 60_000, modelProbeIntervalMs: 0 },
      { eventLog, wsGateway, mtfEngine, marketState, modelManager }
    );
    const state = await monitor.check();
    expect(state.healthy).toBe(false);
    expect(state.issues.some((i) => i.kind === 'MARKET_STATE_STALE')).toBe(true);
  });

  it('reports model unreachable when isReachable returns false', async () => {
    const eventLog = makeEventLog();
    const wsGateway = { broadcast: vi.fn() } as unknown as WebSocketGateway;
    const store = new KlineStore(500);
    const instrument = makeMockInstrument();
    const marketState = new MarketStateManager([instrument]);
    const mtfEngine = new MtfStateEngine(store, marketState);
    for (const tf of ['4h', '1h', '15m', '5m'] as AnalysisTimeframe[]) {
      populateTrendingUp(store, 'SOLUSDT', tf, 60);
    }
    marketState.onBookTicker('SOLUSDT', 100.0, 100.05, 0, 0);
    marketState.onAggTrade('SOLUSDT', 100.0, 0);
    marketState.onMarkPrice('SOLUSDT', 100.0, 100.0, 0);
    const modelManager = {
      isReachable: vi.fn().mockResolvedValue(false),
    } as unknown as ModelManager;

    const monitor = new HealthMonitor(
      { symbols: ['SOLUSDT'], timeframes: [], staleMs: 60_000, modelProbeIntervalMs: 1 },
      { eventLog, wsGateway, mtfEngine, marketState, modelManager }
    );
    const state = await monitor.check();
    expect(state.healthy).toBe(false);
    expect(state.issues.some((i) => i.kind === 'MODEL_UNREACHABLE')).toBe(true);
  });
});

// =============================================================================
// End-to-end: the agent runs a full cycle with the brain modules wired
// =============================================================================

describe('AutonomousTradingAgent (with brain modules wired)', () => {
  it('runs a full cycle with all four brain modules attached and emits the cycle summary', async () => {
    const store = new KlineStore(500);
    const marketState = new MarketStateManager([makeMockInstrument()]);
    const mtfEngine = new MtfStateEngine(store, marketState);
    const structureEngine = new MarketStructureEngine(store);
    const smcEngine = new SmcLocationEngine(store, structureEngine);
    const setupEngine = new SetupEngine(mtfEngine, structureEngine, smcEngine);

    for (const tf of ['4h', '1h', '15m', '5m'] as AnalysisTimeframe[]) {
      populateTrendingUp(store, 'SOLUSDT', tf, 60);
    }
    marketState.onBookTicker('SOLUSDT', 150.0, 150.05, 0, 0);
    marketState.onAggTrade('SOLUSDT', 150.0, 0);
    marketState.onMarkPrice('SOLUSDT', 150.0, 150.0, 0);

    const detector = new MarketRegimeDetector(
      (sym, count) => store.getCandles(sym, '4h', count).filter((c) => c.isClosed).slice(-count),
      (sym) => structureEngine.computeMultiTimeframeStructure(sym, Date.now()).timeframes['1h']?.trend,
      3
    );
    const riskManager = new AdaptiveRiskManager({
      baseConfig: DEFAULT_RISK_CONFIG,
      getEquity: () => 10000,
      getLastPrice: () => 150,
      getCandles: (sym, _tf, count) => store.getCandles(sym, '1h', count).filter((c) => c.isClosed).slice(-count),
    });
    const modelManager = new ModelManager({
      llmEndpoints: [{ name: 'fake', kind: 'llm', baseUrl: 'http://127.0.0.1:0', model: 'qwen3.5:2b', priority: 1, timeoutMs: 1000 }],
    });

    const submittedSignals: SignalInput[] = [];
    const strategyEngine = {
      async submitSignal(input: SignalInput): Promise<Signal | null> {
        submittedSignals.push(input);
        return null;
      },
      isRunning: () => true,
    } as unknown as StrategyEngine;

    const eventLog = makeEventLog();
    const wsBroadcast = vi.fn();
    const wsGateway = { broadcast: wsBroadcast } as unknown as WebSocketGateway;

    const account = makeFakeAccount(10000, 0);

    const brain = makeBrainModules({
      symbols: ['SOLUSDT'],
      eventLog,
      wsGateway,
      store,
      structureEngine,
      marketState,
      mtfEngine,
      strategyEngine,
      regimeDetector: detector,
      modelManager,
      getAccount: () => account,
      getPositions: () => [],
      getLastPrice: () => 150,
    });

    const agent = new AutonomousTradingAgent(
      {
        symbols: ['SOLUSDT'],
        cycleMs: 60_000,
        minConfluence: 65,
        minRR: 1.5,
        maxOpenPositions: 3,
        perSymbolMaxPositions: 1,
        cooldownMs: 60_000,
        strategyId: 'autonomous-agent-test',
        minConfidence: 0.4,
        regimeConfirmationBars: 1,
      },
      {
        setupEngine,
        mtfEngine,
        regimeDetector: detector,
        riskManager,
        modelManager,
        strategyEngine,
        eventLog,
        wsGateway,
        getPositions: () => [],
        getAccount: () => account,
        getLastPrice: () => 150,
        performanceTracker: brain.performanceTracker,
        circuitBreaker: brain.circuitBreaker,
        exitManager: brain.exitManager,
        healthMonitor: brain.healthMonitor,
      }
    );

    const summary = await agent.runCycle();

    expect(summary.symbolsScanned).toBe(1);
    expect(summary.cycleId).toMatch(/^autonomous_\d+$/);
    expect(summary.decisions).toHaveLength(1);
    // Brain-module fields are present.
    expect(summary).toHaveProperty('circuitBreakerTripped');
    expect(summary).toHaveProperty('health');
    expect(summary).toHaveProperty('exits');
    expect(summary).toHaveProperty('runtimeRiskMultiplier');
    expect(summary).toHaveProperty('rollingWinRate');
    // The agent must have broadcast at least the cycle summary.
    const calls = wsBroadcast.mock.calls as Array<[string, unknown]>;
    const cycleCall = calls.find((c) => c[0] === 'agent.autonomous.cycle');
    expect(cycleCall).toBeDefined();
    expect(submittedSignals).toHaveLength(0);
    expect(summary.signalsSubmitted).toBe(0);
    // Cycle-completed event persisted to the event log.
    const events = eventLog.getEvents({ type: 'AUTONOMOUS_CYCLE_COMPLETED', limit: 5 });
    expect(events.length).toBeGreaterThanOrEqual(1);

    // Started/stopped events via start()/stop().
    agent.start();
    const startedEvents = eventLog.getEvents({ type: 'AUTONOMOUS_AGENT_STARTED', limit: 5 });
    expect(startedEvents.length).toBeGreaterThanOrEqual(1);
    agent.stop();
    const stoppedEvents = eventLog.getEvents({ type: 'AUTONOMOUS_AGENT_STOPPED', limit: 5 });
    expect(stoppedEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('stands aside when the circuit breaker is tripped', async () => {
    const store = new KlineStore(500);
    const marketState = new MarketStateManager([makeMockInstrument()]);
    const mtfEngine = new MtfStateEngine(store, marketState);
    const structureEngine = new MarketStructureEngine(store);
    const smcEngine = new SmcLocationEngine(store, structureEngine);
    const setupEngine = new SetupEngine(mtfEngine, structureEngine, smcEngine);
    for (const tf of ['4h', '1h', '15m', '5m'] as AnalysisTimeframe[]) {
      populateTrendingUp(store, 'SOLUSDT', tf, 60);
    }
    marketState.onBookTicker('SOLUSDT', 150.0, 150.05, 0, 0);
    marketState.onAggTrade('SOLUSDT', 150.0, 0);
    marketState.onMarkPrice('SOLUSDT', 150.0, 150.0, 0);

    const detector = new MarketRegimeDetector(
      (sym, count) => store.getCandles(sym, '4h', count).filter((c) => c.isClosed).slice(-count),
      (sym) => structureEngine.computeMultiTimeframeStructure(sym, Date.now()).timeframes['1h']?.trend,
      3
    );
    const riskManager = new AdaptiveRiskManager({
      baseConfig: DEFAULT_RISK_CONFIG,
      getEquity: () => 10000,
      getLastPrice: () => 150,
      getCandles: (sym, _tf, count) => store.getCandles(sym, '1h', count).filter((c) => c.isClosed).slice(-count),
    });
    const modelManager = new ModelManager({
      llmEndpoints: [{ name: 'fake', kind: 'llm', baseUrl: 'http://127.0.0.1:0', model: 'qwen3.5:2b', priority: 1, timeoutMs: 1000 }],
    });

    const strategyEngine = {
      async submitSignal(): Promise<Signal | null> { return null; },
      isRunning: () => true,
    } as unknown as StrategyEngine;
    const eventLog = makeEventLog();
    const wsGateway = { broadcast: vi.fn() } as unknown as WebSocketGateway;
    const account = makeFakeAccount(10000, 0);

    const brain = makeBrainModules({
      symbols: ['SOLUSDT'],
      eventLog,
      wsGateway,
      store,
      structureEngine,
      marketState,
      mtfEngine,
      strategyEngine,
      regimeDetector: detector,
      modelManager,
      getAccount: () => account,
      getPositions: () => [],
      getLastPrice: () => 150,
    });
    // Trip the breaker before running the cycle.
    brain.circuitBreaker.forceTrip('OPERATOR_OVERRIDE');

    const agent = new AutonomousTradingAgent(
      {
        symbols: ['SOLUSDT'], cycleMs: 60_000, minConfluence: 65, minRR: 1.5,
        maxOpenPositions: 3, perSymbolMaxPositions: 1, cooldownMs: 60_000,
        strategyId: 'autonomous-agent-test', minConfidence: 0.4, regimeConfirmationBars: 1,
      },
      {
        setupEngine, mtfEngine, regimeDetector: detector, riskManager, modelManager,
        strategyEngine, eventLog, wsGateway,
        getPositions: () => [], getAccount: () => account, getLastPrice: () => 150,
        performanceTracker: brain.performanceTracker, circuitBreaker: brain.circuitBreaker,
        exitManager: brain.exitManager, healthMonitor: brain.healthMonitor,
      }
    );

    const summary = await agent.runCycle();
    expect(summary.circuitBreakerTripped).toBe(true);
    expect(summary.decisions[0]?.action).toBe('STAND_ASIDE');
    expect(summary.decisions[0]?.reason).toContain('Circuit breaker tripped');
    expect(summary.signalsSubmitted).toBe(0);
    // Breaker-trip event persisted.
    const trips = eventLog.getEvents({ type: 'AUTONOMOUS_CIRCUIT_BREAKER_TRIPPED', limit: 5 });
    expect(trips.length).toBeGreaterThanOrEqual(1);
  });

  it('stands aside when regime is TRANSITIONING (with brain modules attached)', async () => {
    const store = new KlineStore(500);
    const marketState = new MarketStateManager([makeMockInstrument()]);
    const mtfEngine = new MtfStateEngine(store, marketState);
    const structureEngine = new MarketStructureEngine(store);
    const smcEngine = new SmcLocationEngine(store, structureEngine);
    const setupEngine = new SetupEngine(mtfEngine, structureEngine, smcEngine);

    // Very few candles → regime detector returns null → symState.regime stays null → TRANSITIONING.
    for (const tf of ['4h', '1h', '15m', '5m'] as AnalysisTimeframe[]) {
      populateTrendingUp(store, 'SOLUSDT', tf, 5);
    }
    marketState.onBookTicker('SOLUSDT', 100.0, 100.05, 0, 0);
    marketState.onAggTrade('SOLUSDT', 100.0, 0);
    marketState.onMarkPrice('SOLUSDT', 100.0, 100.0, 0);

    const detector = new MarketRegimeDetector(
      (sym, count) => store.getCandles(sym, '4h', count).filter((c) => c.isClosed).slice(-count),
      () => undefined,
      3
    );
    const riskManager = new AdaptiveRiskManager({
      baseConfig: DEFAULT_RISK_CONFIG,
      getEquity: () => 10000,
      getLastPrice: () => 100,
      getCandles: (sym, _tf, count) => store.getCandles(sym, '1h', count).filter((c) => c.isClosed).slice(-count),
    });
    const modelManager = new ModelManager({
      llmEndpoints: [{ name: 'fake', kind: 'llm', baseUrl: 'http://127.0.0.1:0', model: 'qwen3.5:2b', priority: 1, timeoutMs: 1000 }],
    });
    const strategyEngine = { async submitSignal() { return null; }, isRunning: () => true } as unknown as StrategyEngine;
    const eventLog = makeEventLog();
    const wsGateway = { broadcast: vi.fn() } as unknown as WebSocketGateway;
    const account = makeFakeAccount(10000, 0);

    const brain = makeBrainModules({
      symbols: ['SOLUSDT'],
      eventLog,
      wsGateway,
      store,
      structureEngine,
      marketState,
      mtfEngine,
      strategyEngine,
      regimeDetector: detector,
      modelManager,
      getAccount: () => account,
      getPositions: () => [],
      getLastPrice: () => 100,
    });

    const agent = new AutonomousTradingAgent(
      {
        symbols: ['SOLUSDT'], cycleMs: 60_000, minConfluence: 65, minRR: 1.5,
        maxOpenPositions: 3, perSymbolMaxPositions: 1, cooldownMs: 60_000,
        strategyId: 'autonomous-agent-test', minConfidence: 0.4, regimeConfirmationBars: 1,
      },
      {
        setupEngine, mtfEngine, regimeDetector: detector, riskManager, modelManager,
        strategyEngine, eventLog, wsGateway,
        getPositions: () => [], getAccount: () => account, getLastPrice: () => 100,
        performanceTracker: brain.performanceTracker, circuitBreaker: brain.circuitBreaker,
        exitManager: brain.exitManager, healthMonitor: brain.healthMonitor,
      }
    );

    const summary = await agent.runCycle();
    expect(summary.signalsSubmitted).toBe(0);
    // Either MONITOR (no READY setup) or STAND_ASIDE (TRANSITIONING regime).
    expect(['MONITOR', 'STAND_ASIDE']).toContain(summary.decisions[0]?.action);
  });

  it('evaluates a scale-in for in-position symbols when scaling is enabled (Finding 2)', async () => {
    const store = new KlineStore(500);
    const marketState = new MarketStateManager([makeMockInstrument()]);
    const mtfEngine = new MtfStateEngine(store, marketState);
    const structureEngine = new MarketStructureEngine(store);
    const smcEngine = new SmcLocationEngine(store, structureEngine);
    const setupEngine = new SetupEngine(mtfEngine, structureEngine, smcEngine);
    for (const tf of ['4h', '1h', '15m', '5m'] as AnalysisTimeframe[]) {
      populateTrendingUp(store, 'SOLUSDT', tf, 60);
    }
    marketState.onBookTicker('SOLUSDT', 150.0, 150.05, 0, 0);
    marketState.onAggTrade('SOLUSDT', 150.0, 0);
    marketState.onMarkPrice('SOLUSDT', 150.0, 150.0, 0);

    const detector = new MarketRegimeDetector(
      (sym, count) => store.getCandles(sym, '4h', count).filter((c) => c.isClosed).slice(-count),
      () => 'BULLISH',
      3
    );
    const riskManager = new AdaptiveRiskManager({
      baseConfig: DEFAULT_RISK_CONFIG,
      getEquity: () => 10000,
      getLastPrice: () => 150,
      getCandles: (sym, _tf, count) => store.getCandles(sym, '1h', count).filter((c) => c.isClosed).slice(-count),
    });
    const modelManager = new ModelManager({
      llmEndpoints: [{ name: 'fake', kind: 'llm', baseUrl: 'http://127.0.0.1:0', model: 'qwen3.5:2b', priority: 1, timeoutMs: 1000 }],
    });

    const submittedSignals: SignalInput[] = [];
    const strategyEngine = {
      async submitSignal(input: SignalInput): Promise<Signal | null> {
        submittedSignals.push(input);
        return { ...input, id: 'sig-scale-1', ts: Date.now(), status: 'EXECUTED' } as Signal;
      },
      isRunning: () => true,
    } as unknown as StrategyEngine;

    const eventLog = makeEventLog();
    const wsGateway = { broadcast: vi.fn() } as unknown as WebSocketGateway;
    const account = makeFakeAccount(10000, 0);

    // Open LONG position: qty 10 @ entry 150, last 150 → 0% unrealized.
    const openPosition: Position = {
      accountId: 'a', symbol: 'SOLUSDT', positionSide: 'BOTH', status: 'OPEN', qty: 10, entryPrice: 150,
      unrealizedPnl: 0, realizedPnl: 0, leverage: 5, initialMargin: 30, maintenanceMargin: 1,
      maintenanceMarginRate: 0.005, totalFees: 0, totalFunding: 0,
      openedAtUtc: '2026-01-01T00:00:00.000Z', updatedAtUtc: new Date().toISOString(),
    } as Position;

    const brain = makeBrainModules({
      symbols: ['SOLUSDT'],
      eventLog,
      wsGateway,
      store,
      structureEngine,
      marketState,
      mtfEngine,
      strategyEngine,
      regimeDetector: detector,
      modelManager,
      getAccount: () => account,
      getPositions: () => [openPosition],
      getLastPrice: () => 150,
      // Scaling enabled — the in-position branch must run the scale-in
      // evaluation. With 0% unrealized profit the profit gate blocks the
      // add, which is exactly what the decision reason should show.
      scaling: {
        enabled: true,
        scaleInMinProfitPct: 0.01,
        scaleInSizeFraction: 0.5,
        scaleInMaxAdds: 1,
        scaleInCooldownMs: 900_000,
        scaleOutTriggerPct: 0.01,
        scaleOutCloseFraction: 0.5,
      },
    });

    const agent = new AutonomousTradingAgent(
      {
        symbols: ['SOLUSDT'], cycleMs: 60_000, minConfluence: 65, minRR: 1.5,
        maxOpenPositions: 3, perSymbolMaxPositions: 1, cooldownMs: 60_000,
        strategyId: 'autonomous-agent-test', minConfidence: 0.4, regimeConfirmationBars: 1,
      },
      {
        setupEngine, mtfEngine, regimeDetector: detector, riskManager, modelManager,
        strategyEngine, eventLog, wsGateway,
        getPositions: () => [openPosition], getAccount: () => account, getLastPrice: () => 150,
        performanceTracker: brain.performanceTracker, circuitBreaker: brain.circuitBreaker,
        exitManager: brain.exitManager, healthMonitor: brain.healthMonitor,
      }
    );

    const summary = await agent.runCycle();
    const decision = summary.decisions[0]!;
    expect(decision.action).toBe('IN_POSITION');
    // The scale-in evaluation ran and reported the profit-gate rejection —
    // proof the in-position branch now consults the scaling brain instead of
    // just recording "already in position".
    expect(decision.reason).toMatch(/scale-in threshold/i);
    // No add signal was submitted (profit gate blocked it).
    expect(submittedSignals).toHaveLength(0);
  });

  it('stands aside before the confidence probe when another strategy holds the symbol lock (Finding 3)', async () => {
    const store = new KlineStore(500);
    const marketState = new MarketStateManager([makeMockInstrument()]);
    const mtfEngine = new MtfStateEngine(store, marketState);
    const structureEngine = new MarketStructureEngine(store);
    const smcEngine = new SmcLocationEngine(store, structureEngine);
    const setupEngine = new SetupEngine(mtfEngine, structureEngine, smcEngine);
    for (const tf of ['4h', '1h', '15m', '5m'] as AnalysisTimeframe[]) {
      populateTrendingUp(store, 'SOLUSDT', tf, 60);
    }
    marketState.onBookTicker('SOLUSDT', 150.0, 150.05, 0, 0);
    marketState.onAggTrade('SOLUSDT', 150.0, 0);
    marketState.onMarkPrice('SOLUSDT', 150.0, 150.0, 0);

    const detector = new MarketRegimeDetector(
      (sym, count) => store.getCandles(sym, '4h', count).filter((c) => c.isClosed).slice(-count),
      () => 'BULLISH',
      3
    );
    const riskManager = new AdaptiveRiskManager({
      baseConfig: DEFAULT_RISK_CONFIG,
      getEquity: () => 10000,
      getLastPrice: () => 150,
      getCandles: (sym, _tf, count) => store.getCandles(sym, '1h', count).filter((c) => c.isClosed).slice(-count),
    });
    const modelManager = new ModelManager({
      llmEndpoints: [{ name: 'fake', kind: 'llm', baseUrl: 'http://127.0.0.1:0', model: 'qwen3.5:2b', priority: 1, timeoutMs: 1000 }],
    });

    const probeSpy = vi.fn();
    const submittedSignals: SignalInput[] = [];
    const strategyEngine = {
      async submitSignal(input: SignalInput): Promise<Signal | null> {
        submittedSignals.push(input);
        return { ...input, id: 'sig-lock-1', ts: Date.now(), status: 'EXECUTED' } as Signal;
      },
      isRunning: () => true,
      // smc-agent holds the entry lock on SOLUSDT.
      getSymbolLock: () => ({
        symbol: 'SOLUSDT',
        strategyId: 'smc-agent',
        acquiredAt: Date.now() - 1000,
        until: Date.now() + 240_000,
      }),
    } as unknown as StrategyEngine;

    const eventLog = makeEventLog();
    const wsGateway = { broadcast: vi.fn() } as unknown as WebSocketGateway;
    const account = makeFakeAccount(10000, 0);

    const brain = makeBrainModules({
      symbols: ['SOLUSDT'],
      eventLog,
      wsGateway,
      store,
      structureEngine,
      marketState,
      mtfEngine,
      strategyEngine,
      regimeDetector: detector,
      modelManager,
      getAccount: () => account,
      getPositions: () => [],
      getLastPrice: () => 150,
    });

    // Fabricate a READY long setup so the cycle gets past the confluence and
    // HTF-alignment gates and reaches the symbol-lock gate.
    const readySetup = {
      id: 'setup-ready-1',
      symbol: 'SOLUSDT',
      direction: 'LONG',
      setupType: 'SSL_SWEEP_REVERSAL_LONG',
      state: 'TRIGGERED',
      createdAt: 1,
      updatedAt: 1,
      expiresAt: 9999999999999,
      timeframes: { regime4h: 'BULLISH', bias1h: 'BULLISH', structure15m: 'BULLISH', trigger5m: 'BULLISH' },
      confluence: {
        htfAlignmentScore: 10, structureScore: 15, liquiditySweepScore: 10, fvgScore: 10,
        orderBlockScore: 10, retestScore: 10, triggerScore: 10, dataQualityScore: 5,
        totalScore: 80, maxScore: 100, notes: [],
      },
      status: 'READY',
      sourceCandleTimes: [],
      sourceEventIds: [],
    } as never as ReturnType<SetupEngine['getSetupsAsOf']>[number];
    const setupsSpy = vi.spyOn(setupEngine, 'getSetupsAsOf').mockReturnValue([readySetup]);

    const agent = new AutonomousTradingAgent(
      {
        symbols: ['SOLUSDT'], cycleMs: 60_000, minConfluence: 65, minRR: 1.5,
        maxOpenPositions: 3, perSymbolMaxPositions: 1, cooldownMs: 60_000,
        strategyId: 'autonomous-agent-test', minConfidence: 0.4, regimeConfirmationBars: 1,
      },
      {
        setupEngine, mtfEngine, regimeDetector: detector, riskManager, modelManager,
        strategyEngine, eventLog, wsGateway,
        getPositions: () => [], getAccount: () => account, getLastPrice: () => 150,
        performanceTracker: brain.performanceTracker, circuitBreaker: brain.circuitBreaker,
        exitManager: brain.exitManager, healthMonitor: brain.healthMonitor,
      }
    );

    // Track whether the (expensive) model-confidence probe was invoked by
    // wrapping the model manager's complete() — the lock gate must fire
    // BEFORE the probe.
    const completeSpy = vi.spyOn(modelManager, 'complete').mockImplementation(async () => {
      probeSpy();
      return { text: '{"confidence": 0.9}' };
    });

    const summary = await agent.runCycle();
    const decision = summary.decisions[0]!;
    expect(decision.action).toBe('STAND_ASIDE');
    expect(decision.reason).toMatch(/Symbol locked by strategy smc-agent/);
    // No probe, no signal — the lock gate short-circuited the pipeline.
    expect(probeSpy).not.toHaveBeenCalled();
    expect(completeSpy).not.toHaveBeenCalled();
    expect(submittedSignals).toHaveLength(0);

    setupsSpy.mockRestore();
    completeSpy.mockRestore();
  });
});
