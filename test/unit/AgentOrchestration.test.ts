import { describe, it, expect, vi } from 'vitest';
import { KlineStore } from '../../src/market/Klines.js';
import { TIMEFRAME_MS, type AnalysisTimeframe } from '../../src/market/MtfStateEngine.js';
import { MarketStructureEngine } from '../../src/market/structure/MarketStructureEngine.js';
import { MarketRegimeDetector } from '../../src/analysis/MarketRegimeDetector.js';
import { AdaptiveRiskManager } from '../../src/risk/AdaptiveRiskManager.js';
import { ExitManager, type ScalingConfig } from '../../src/agent/ExitManager.js';
import { StrategyEngine, type Strategy } from '../../src/strategy/StrategyEngine.js';
import { SignalExecutor } from '../../src/strategy/SignalExecutor.js';
import { OrderFactory } from '../../src/strategy/OrderFactory.js';
import { parseSignalInput, signalsEqual } from '../../src/strategy/signal.js';
import type { Signal, SignalInput } from '../../src/strategy/signal.js';
import { DEFAULT_RISK_CONFIG } from '../../src/trading/risk/RiskLimits.js';
import { EventLog } from '../../src/persistence/EventLog.js';
import { WebSocketGateway } from '../../src/api/websocket/WebSocketGateway.js';
import { PaperBroker } from '../../src/broker/PaperBroker.js';
import { DatabaseManager } from '../../src/persistence/db.js';
import type { Position, AccountState, Instrument, MarketState } from '../../src/broker/types.js';
import type { SetupCandidate } from '../../src/market/setup/types.js';
import type { TradePlan } from '../../src/risk/AdaptiveRiskManager.js';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// =============================================================================
// Fixtures
// =============================================================================

const instrument: Instrument = {
  symbol: 'BTCUSDT',
  baseAsset: 'BTC',
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

const market: MarketState = {
  symbol: 'BTCUSDT',
  bid: 100,
  ask: 100.1,
  last: 100.05,
  mark: 100,
  localTsUtc: Date.now(),
  stale: false,
};

function makeEventLog(): EventLog {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-broker-orch-'));
  const db = new Database(path.join(tmp, 'paper.sqlite3'));
  return new EventLog(path.join(tmp, 'events.jsonl'), db);
}

function makeFakeAccount(equity = 10000): AccountState {
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
    dailyRealizedPnl: 0,
    liquidations: 0,
  };
}

function populateTrendingUp(
  store: KlineStore,
  symbol: string,
  tf: AnalysisTimeframe,
  count: number,
  basePrice = 100
): void {
  const intervalMs = TIMEFRAME_MS[tf];
  let currentTs = 1700000000000;
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
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    accountId: 'test-account',
    symbol: 'SOLUSDT',
    positionSide: 'BOTH',
    status: 'OPEN',
    qty: 10,
    entryPrice: 150,
    unrealizedPnl: 0,
    realizedPnl: 0,
    leverage: 5,
    initialMargin: 30,
    maintenanceMargin: 1,
    maintenanceMarginRate: 0.005,
    totalFees: 0,
    totalFunding: 0,
    openedAtUtc: '2026-01-01T00:00:00.000Z',
    updatedAtUtc: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Position;
}

function makeSetup(overrides: Partial<SetupCandidate> = {}): SetupCandidate {
  return {
    id: 'setup-1',
    symbol: 'SOLUSDT',
    direction: 'LONG',
    setupType: 'SSL_SWEEP_REVERSAL_LONG',
    state: 'READY',
    createdAt: 1,
    updatedAt: 1,
    expiresAt: 9999999999999,
    timeframes: {
      regime4h: 'BULLISH',
      bias1h: 'BULLISH',
      structure15m: 'BULLISH',
      trigger5m: 'BULLISH',
    },
    confluence: {
      htfAlignmentScore: 10,
      structureScore: 15,
      liquiditySweepScore: 10,
      fvgScore: 10,
      orderBlockScore: 10,
      retestScore: 10,
      triggerScore: 10,
      dataQualityScore: 5,
      totalScore: 80,
      maxScore: 100,
      notes: [],
    },
    status: 'READY',
    sourceCandleTimes: [],
    sourceEventIds: [],
    ...overrides,
  } as SetupCandidate;
}

function makePlan(overrides: Partial<TradePlan> = {}): TradePlan {
  const detector = new MarketRegimeDetector(() => [], () => 'BULLISH', 3);
  return {
    adaptation: detector.getAdaptation('TRENDING_STRONG'),
    stopLossPrice: 155,
    takeProfitPrice: 180,
    leverage: 5,
    riskMultiplier: 1.2,
    regimeBias: 1.0,
    rr: 2.5,
    atr: 2,
    entryPrice: 160,
    direction: 'LONG',
    ...overrides,
  };
}

const SCALING: ScalingConfig = {
  enabled: true,
  scaleInMinProfitPct: 0.01,
  scaleInSizeFraction: 0.5,
  scaleInMaxAdds: 1,
  scaleInCooldownMs: 900_000,
  scaleOutTriggerPct: 0.01,
  scaleOutCloseFraction: 0.5,
};

interface ExitHarness {
  em: ExitManager;
  submitted: SignalInput[];
  wsBroadcast: ReturnType<typeof vi.fn>;
  eventLog: EventLog;
  setPositions: (p: Position[]) => void;
}

function makeExitHarness(opts: {
  positions?: Position[];
  lastPrice?: number;
  equity?: number;
  scaling?: ScalingConfig;
  maxUnrealizedLossPct?: number;
  strategyId?: string;
} = {}): ExitHarness {
  const eventLog = makeEventLog();
  const wsBroadcast = vi.fn();
  const wsGateway = { broadcast: wsBroadcast } as unknown as WebSocketGateway;
  const submitted: SignalInput[] = [];
  const strategyEngine = {
    async submitSignal(input: SignalInput): Promise<Signal | null> {
      submitted.push(input);
      return { ...input, id: `sig-${submitted.length}`, ts: Date.now(), status: 'EXECUTED' } as Signal;
    },
    isRunning: () => true,
  } as unknown as StrategyEngine;
  const detector = new MarketRegimeDetector(() => [], () => 'BULLISH', 3);
  let positions = opts.positions ?? [];
  const em = new ExitManager(
    {
      exitOnRegimeFlip: false,
      maxUnrealizedLossPct: opts.maxUnrealizedLossPct ?? 0.02,
      strategyId: opts.strategyId ?? 'autonomous-agent-test',
      scaling: opts.scaling ?? SCALING,
    },
    {
      eventLog,
      wsGateway,
      strategyEngine,
      regimeDetector: detector,
      getPositions: () => positions,
      getAccount: () => makeFakeAccount(opts.equity ?? 10000),
      getLastPrice: () => opts.lastPrice ?? 160,
      forgetTrailingStop: vi.fn(),
    }
  );
  return {
    em,
    submitted,
    wsBroadcast,
    eventLog,
    setPositions: (p: Position[]) => {
      positions = p;
    },
  };
}

interface EngineHarness {
  engine: StrategyEngine;
  submitted: Signal[];
  rejected: Array<{ signal: Signal; reason: string }>;
}

function makeEngineHarness(opts: { positionQty?: number; symbolLockEnabled?: boolean; symbolLockTtlMs?: number } = {}): EngineHarness {
  const submitted: Signal[] = [];
  const rejected: Array<{ signal: Signal; reason: string }> = [];
  const qty = opts.positionQty ?? 0;
  const engine = new StrategyEngine(
    {
      marketState: () => market,
      klines: { getCandles: () => [] },
      account: () => makeFakeAccount(10000),
      getPosition: (symbol: string) =>
        qty !== 0
          ? makePosition({ symbol, qty })
          : undefined,
      getOpenOrders: () => [],
      getInstrument: () => instrument,
      submitOrder: () => {
        throw new Error('not expected in these tests');
      },
    },
    {
      onSubmitSignal: async (signal) => {
        submitted.push(signal);
        return true;
      },
    },
    {
      onSignalRejected: (signal, reason) => {
        rejected.push({ signal, reason });
      },
    },
    {
      symbolLockEnabled: opts.symbolLockEnabled,
      symbolLockTtlMs: opts.symbolLockTtlMs,
    }
  );
  return { engine, submitted, rejected };
}

function candleClose(): { symbol: string; interval: string; openTime: number; open: number; high: number; low: number; close: number; volume: number } {
  return {
    symbol: 'BTCUSDT',
    interval: '5m',
    openTime: 1700000000000,
    open: 100,
    high: 100.5,
    low: 99.5,
    close: 100,
    volume: 100,
  };
}

// =============================================================================
// Finding 4 — per-regime learning wired into computeTradePlan
// =============================================================================

describe('Finding 4: per-regime learning in AdaptiveRiskManager.computeTradePlan', () => {
  function makeRiskManager(getRegimeStats?: (regime: string) => { trades: number; winRate: number } | null) {
    const store = new KlineStore(500);
    populateTrendingUp(store, 'SOLUSDT', '1h', 50);
    const detector = new MarketRegimeDetector(() => [], () => 'BULLISH', 3);
    const adaptation = detector.getAdaptation('TRENDING_STRONG');
    const rm = new AdaptiveRiskManager({
      baseConfig: DEFAULT_RISK_CONFIG,
      getEquity: () => 10000,
      getLastPrice: () => 150,
      getCandles: (sym, _tf, count) =>
        store.getCandles(sym, '1h', count).filter((c) => c.isClosed).slice(-count),
      getRegimeStats: getRegimeStats as never,
    });
    return { rm, adaptation };
  }

  it('applies a win-rate-based regime bias to the risk multiplier (70% win rate → ×1.4)', () => {
    const { rm, adaptation } = makeRiskManager(() => ({ trades: 10, winRate: 0.7 }));
    const plan = rm.computeTradePlan('SOLUSDT', 'LONG', adaptation, '1h');
    expect(plan).not.toBeNull();
    expect(plan!.regimeBias).toBeCloseTo(1.4, 3);
    // TRENDING_STRONG overlay riskMultiplier = 1.2; 1.2 × 1.4 = 1.68.
    expect(plan!.riskMultiplier).toBeCloseTo(1.2 * 1.4, 3);
  });

  it('returns a neutral bias when the regime has no sample (below min-sample)', () => {
    const { rm, adaptation } = makeRiskManager(() => null);
    const plan = rm.computeTradePlan('SOLUSDT', 'LONG', adaptation, '1h');
    expect(plan).not.toBeNull();
    expect(plan!.regimeBias).toBe(1.0);
    expect(plan!.riskMultiplier).toBeCloseTo(1.2, 3);
  });

  it('clamps the bias to [0.5, 1.5]', () => {
    const { rm, adaptation } = makeRiskManager(() => ({ trades: 10, winRate: 1.0 }));
    const up = rm.computeTradePlan('SOLUSDT', 'LONG', adaptation, '1h');
    expect(up!.regimeBias).toBe(1.5);

    const { rm: rm2, adaptation: a2 } = makeRiskManager(() => ({ trades: 10, winRate: 0.1 }));
    const down = rm2.computeTradePlan('SOLUSDT', 'LONG', a2, '1h');
    expect(down!.regimeBias).toBe(0.5);
  });

  it('exposes regimeBias through planToFeatures', () => {
    const { rm, adaptation } = makeRiskManager(() => ({ trades: 10, winRate: 0.7 }));
    const plan = rm.computeTradePlan('SOLUSDT', 'LONG', adaptation, '1h');
    expect(plan).not.toBeNull();
    const features = rm.planToFeatures(plan!);
    expect(features['regimeBias']).toBeCloseTo(1.4, 3);
  });
});

// =============================================================================
// Finding 3 — symbol lock (multi-strategy orchestration)
// =============================================================================

describe('Finding 3: StrategyEngine symbol lock', () => {
  it('lock API: acquire, get, and release', () => {
    const { engine } = makeEngineHarness();
    expect(engine.acquireSymbolLock('BTCUSDT', 'smc-agent')).toBe(true);
    const lock = engine.getSymbolLock('BTCUSDT');
    expect(lock?.strategyId).toBe('smc-agent');
    expect(lock?.until).toBeGreaterThan(Date.now());

    engine.releaseSymbolLock('BTCUSDT', 'smc-agent');
    expect(engine.getSymbolLock('BTCUSDT')).toBeNull();
  });

  it('acquireSymbolLock refuses when another strategy holds a live lock', () => {
    const { engine } = makeEngineHarness();
    expect(engine.acquireSymbolLock('BTCUSDT', 'smc-agent')).toBe(true);
    expect(engine.acquireSymbolLock('BTCUSDT', 'autonomous-agent')).toBe(false);
    // The holder can re-acquire (refresh).
    expect(engine.acquireSymbolLock('BTCUSDT', 'smc-agent')).toBe(true);
  });

  it('release by a non-holder does not free the lock', () => {
    const { engine } = makeEngineHarness();
    engine.acquireSymbolLock('BTCUSDT', 'smc-agent');
    engine.releaseSymbolLock('BTCUSDT', 'autonomous-agent');
    expect(engine.getSymbolLock('BTCUSDT')?.strategyId).toBe('smc-agent');
  });

  it('the first accepted OPEN acquires the lock; a second strategy OPEN on the same symbol is rejected with a lock reason', async () => {
    const { engine, submitted, rejected } = makeEngineHarness();
    await engine.start();

    const smc: Strategy = {
      id: 'smc-agent',
      name: 'SMC',
      enabled: true,
      symbols: ['BTCUSDT'],
      intervals: ['5m'],
      priority: 1,
      cooldownMs: 1000,
      onCandleClose: () => ({
        strategyId: 'smc-agent',
        symbol: 'BTCUSDT',
        action: 'OPEN_LONG',
        confidence: 0.8,
        ttlMs: 60_000,
        features: {},
      }),
    };
    const autonomous: Strategy = {
      id: 'autonomous-agent',
      name: 'Autonomous',
      enabled: true,
      symbols: ['BTCUSDT'],
      intervals: ['5m'],
      priority: 2,
      cooldownMs: 1000,
      onCandleClose: () => ({
        strategyId: 'autonomous-agent',
        symbol: 'BTCUSDT',
        action: 'OPEN_SHORT',
        confidence: 0.8,
        ttlMs: 60_000,
        features: {},
      }),
    };
    engine.register(smc);
    engine.register(autonomous);

    await engine.onCandleClose(candleClose());

    // smc-agent (priority 1) won the lock; autonomous-agent was rejected.
    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.strategyId).toBe('smc-agent');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.signal.strategyId).toBe('autonomous-agent');
    expect(rejected[0]!.reason).toMatch(/symbol locked by strategy smc-agent/);
    expect(engine.getSymbolLock('BTCUSDT')?.strategyId).toBe('smc-agent');
  });

  it('CLOSE signals bypass the symbol lock (reducing risk is never blocked)', async () => {
    const { engine, submitted } = makeEngineHarness({ positionQty: 1 });
    await engine.start();
    engine.acquireSymbolLock('BTCUSDT', 'smc-agent');

    const result = await engine.submitSignal({
      strategyId: 'autonomous-agent',
      symbol: 'BTCUSDT',
      action: 'CLOSE_LONG',
      confidence: 0.9,
      ttlMs: 30_000,
      features: { cooldownMs: 0 },
    });

    expect(submitted).toHaveLength(1);
    expect(result?.status).toBe('EXECUTED');
  });

  it('submitSignal returns a REJECTED signal with the lock reason (fast path, no dedup poisoning)', async () => {
    const { engine, submitted } = makeEngineHarness({ symbolLockTtlMs: 60 });
    await engine.start();
    engine.acquireSymbolLock('BTCUSDT', 'smc-agent', 60);

    const rejected = await engine.submitSignal({
      strategyId: 'autonomous-agent',
      symbol: 'BTCUSDT',
      action: 'OPEN_LONG',
      confidence: 0.8,
      ttlMs: 60_000,
      features: {},
    });
    expect(rejected?.status).toBe('REJECTED');
    expect(rejected?.rejectReason).toMatch(/symbol locked by strategy smc-agent/);
    // The fast path bypasses processSignal entirely — nothing reached the executor.
    expect(submitted).toHaveLength(0);

    // After the lock expires the same submission goes through — the transient
    // rejection was not cached in the dedup map.
    await new Promise((r) => setTimeout(r, 80));
    const accepted = await engine.submitSignal({
      strategyId: 'autonomous-agent',
      symbol: 'BTCUSDT',
      action: 'OPEN_LONG',
      confidence: 0.8,
      ttlMs: 60_000,
      features: { cooldownMs: 0 },
    });
    expect(accepted?.status).toBe('EXECUTED');
    expect(submitted).toHaveLength(1);
  });

  it('lock expiry frees the symbol for another strategy', async () => {
    const { engine, submitted } = makeEngineHarness({ symbolLockTtlMs: 50 });
    await engine.start();

    const first = await engine.submitSignal({
      strategyId: 'smc-agent',
      symbol: 'BTCUSDT',
      action: 'OPEN_LONG',
      confidence: 0.8,
      ttlMs: 60_000,
      features: { cooldownMs: 0 },
    });
    expect(first?.status).toBe('EXECUTED');
    expect(engine.getSymbolLock('BTCUSDT')?.strategyId).toBe('smc-agent');

    await new Promise((r) => setTimeout(r, 70));

    const second = await engine.submitSignal({
      strategyId: 'autonomous-agent',
      symbol: 'BTCUSDT',
      action: 'OPEN_SHORT',
      confidence: 0.8,
      ttlMs: 60_000,
      features: { cooldownMs: 0 },
    });
    expect(second?.status).toBe('EXECUTED');
    expect(engine.getSymbolLock('BTCUSDT')?.strategyId).toBe('autonomous-agent');
    expect(submitted).toHaveLength(2);
  });

  it('symbolLockEnabled=false disables the gate entirely', async () => {
    const { engine, submitted } = makeEngineHarness({ symbolLockEnabled: false });
    await engine.start();

    await engine.submitSignal({
      strategyId: 'smc-agent',
      symbol: 'BTCUSDT',
      action: 'OPEN_LONG',
      confidence: 0.8,
      ttlMs: 60_000,
      features: { cooldownMs: 0 },
    });
    await engine.submitSignal({
      strategyId: 'autonomous-agent',
      symbol: 'BTCUSDT',
      action: 'OPEN_SHORT',
      confidence: 0.8,
      ttlMs: 60_000,
      features: { cooldownMs: 0 },
    });

    expect(submitted).toHaveLength(2);
    expect(engine.getSymbolLock('BTCUSDT')).toBeNull();
  });

  it('stop() clears all locks', async () => {
    const { engine } = makeEngineHarness();
    await engine.start();
    engine.acquireSymbolLock('BTCUSDT', 'smc-agent');
    engine.stop();
    expect(engine.listSymbolLocks()).toHaveLength(0);
  });

  it('submitSignal reflects the executor outcome as EXECUTED on the returned signal (read-time view)', async () => {
    const { engine } = makeEngineHarness();
    await engine.start();
    const result = await engine.submitSignal({
      strategyId: 'autonomous-agent',
      symbol: 'BTCUSDT',
      action: 'OPEN_LONG',
      confidence: 0.8,
      ttlMs: 60_000,
      features: { cooldownMs: 0 },
    });
    // The stored dedup entry stays CREATED (so expireSignals can recycle it),
    // but the caller sees the terminal status.
    expect(result?.status).toBe('EXECUTED');
  });
});

// =============================================================================
// dedupKey semantics in signalsEqual (enables scaling through the same action)
// =============================================================================

describe('signalsEqual with dedupKey', () => {
  it('a dedupKey-carrying signal does not collide with an identity-equal legacy signal', () => {
    const a = parseSignalInput({ strategyId: 's', symbol: 'X', action: 'OPEN_LONG', confidence: 0.8, features: {} });
    const b = parseSignalInput({
      strategyId: 's', symbol: 'X', action: 'OPEN_LONG', confidence: 0.8,
      features: { dedupKey: 'scale-in:X:1' },
    });
    // Same identity, but only b carries a dedupKey → NOT equal → allowed through.
    expect(signalsEqual(a, b)).toBe(false);
    expect(signalsEqual(b, a)).toBe(false);
  });

  it('two signals with the same dedupKey dedup (double-fire protection)', () => {
    const a = parseSignalInput({
      strategyId: 's', symbol: 'X', action: 'CLOSE_LONG', confidence: 0.8,
      features: { dedupKey: 'scale-out:X' },
    });
    const b = parseSignalInput({
      strategyId: 's', symbol: 'X', action: 'CLOSE_LONG', confidence: 0.6,
      features: { dedupKey: 'scale-out:X' },
    });
    expect(signalsEqual(a, b)).toBe(true);
  });

  it('two signals with different dedupKeys do not dedup', () => {
    const a = parseSignalInput({
      strategyId: 's', symbol: 'X', action: 'OPEN_LONG', confidence: 0.8,
      features: { dedupKey: 'scale-in:X:1' },
    });
    const b = parseSignalInput({
      strategyId: 's', symbol: 'X', action: 'OPEN_LONG', confidence: 0.8,
      features: { dedupKey: 'scale-in:X:2' },
    });
    expect(signalsEqual(a, b)).toBe(false);
  });
});

// =============================================================================
// SignalExecutor partial closes (closeFraction)
// =============================================================================

describe('SignalExecutor closeFraction (partial closes)', () => {
  function makeExecutor() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-broker-orch-exec-'));
    const broker = new PaperBroker({
      dataDir: tmp,
      accountId: 'test-account',
      startingUsdt: 10000,
      instruments: [instrument],
    });
    broker.onMarket(market);
    const db = new DatabaseManager(tmp);
    const executor = new SignalExecutor({
      broker,
      orderFactory: new OrderFactory({ defaultLeverage: 5 }),
      signals: db.signals,
      getMarketState: () => market,
    });
    return { broker, db, executor };
  }

  it('closes half the position when closeFraction = 0.5', async () => {
    const { broker, db, executor } = makeExecutor();
    broker.submitOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.1, leverage: 5 });
    expect(broker.getPosition('BTCUSDT')?.qty).toBeCloseTo(0.1, 6);

    const signal = {
      strategyId: 'autonomous-agent',
      symbol: 'BTCUSDT',
      action: 'CLOSE_LONG' as const,
      confidence: 0.9,
      ttlMs: 30_000,
      features: { closeFraction: 0.5, cooldownMs: 0 },
    };
    db.signals.insert({ ...signal, id: 'sig-partial-1', ts: Date.now(), status: 'CREATED' } as Signal);
    const ok = await executor.execute({ ...signal, id: 'sig-partial-1', ts: Date.now(), status: 'CREATED' } as Signal);
    expect(ok).toBe(true);

    const remaining = broker.getPosition('BTCUSDT')?.qty ?? 0;
    expect(remaining).toBeGreaterThan(0.04);
    expect(remaining).toBeLessThan(0.06);
  });

  it('closes the whole position when closeFraction is absent (regression)', async () => {
    const { broker, db, executor } = makeExecutor();
    broker.submitOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.1, leverage: 5 });

    const signal = {
      strategyId: 'autonomous-agent',
      symbol: 'BTCUSDT',
      action: 'CLOSE_LONG' as const,
      confidence: 0.9,
      ttlMs: 30_000,
      features: { cooldownMs: 0 },
    };
    db.signals.insert({ ...signal, id: 'sig-full-1', ts: Date.now(), status: 'CREATED' } as Signal);
    await executor.execute({ ...signal, id: 'sig-full-1', ts: Date.now(), status: 'CREATED' } as Signal);
    expect(broker.getPosition('BTCUSDT')?.qty).toBe(0);
  });

  it('treats an invalid closeFraction as a full close', async () => {
    const { broker, db, executor } = makeExecutor();
    broker.submitOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.1, leverage: 5 });

    const signal = {
      strategyId: 'autonomous-agent',
      symbol: 'BTCUSDT',
      action: 'CLOSE_LONG' as const,
      confidence: 0.9,
      ttlMs: 30_000,
      features: { closeFraction: NaN, cooldownMs: 0 },
    };
    db.signals.insert({ ...signal, id: 'sig-nan-1', ts: Date.now(), status: 'CREATED' } as Signal);
    await executor.execute({ ...signal, id: 'sig-nan-1', ts: Date.now(), status: 'CREATED' } as Signal);
    expect(broker.getPosition('BTCUSDT')?.qty).toBe(0);
  });
});

// =============================================================================
// Finding 2 — position scaling (ExitManager)
// =============================================================================

describe('Finding 2: ExitManager SCALE_OUT (downside de-risk)', () => {
  it('decides SCALE_OUT when the loss is in the de-risk band (below full breach)', () => {
    // LONG 10 @ 150, last 140 → unrealized = -100 = -1% of 10k equity.
    // Trigger = 1%, full breach = 2% → in band.
    const h = makeExitHarness({ positions: [makePosition()], lastPrice: 140 });
    const decision = h.em.evaluateOne(makePosition(), new Map(), makeFakeAccount(10000), Date.now());
    expect(decision.action).toBe('SCALE_OUT');
    expect(decision.reason).toBe('DOWNSIDE_DERISK');
    expect(decision.context['closeFraction']).toBe(0.5);
  });

  it('a full breach takes EXIT_NOW precedence over SCALE_OUT', () => {
    // LONG 10 @ 150, last 120 → -300 = -3% of equity → above the 2% breach.
    const h = makeExitHarness({ positions: [makePosition()], lastPrice: 120 });
    const decision = h.em.evaluateOne(makePosition(), new Map(), makeFakeAccount(10000), Date.now());
    expect(decision.action).toBe('EXIT_NOW');
    expect(decision.reason).toBe('UNREALIZED_LOSS_BREACH');
  });

  it('de-risks once per position, then holds on subsequent cycles', async () => {
    const h = makeExitHarness({ positions: [makePosition()], lastPrice: 140 });
    const first = await h.em.evaluateExits(new Map(), 'cycle-1', Date.now());
    expect(first[0]!.action).toBe('SCALE_OUT');
    expect(h.submitted).toHaveLength(1);
    expect(h.submitted[0]!.features['closeFraction']).toBe(0.5);
    expect(h.submitted[0]!.features['dedupKey']).toMatch(/^scale-out:SOLUSDT@/);

    const second = await h.em.evaluateExits(new Map(), 'cycle-2', Date.now());
    expect(second[0]!.action).toBe('HOLD');
    expect(h.submitted).toHaveLength(1); // no second partial close
  });

  it('emits the AUTONOMOUS_SCALE_OUT event and broadcasts on the exit channel', async () => {
    const h = makeExitHarness({ positions: [makePosition()], lastPrice: 140 });
    await h.em.evaluateExits(new Map(), 'cycle-1', Date.now());
    const types = h.eventLog.getEvents({ type: 'AUTONOMOUS_SCALE_OUT' });
    expect(types).toHaveLength(1);
    expect((types[0]!.payload as { closeFraction: number }).closeFraction).toBe(0.5);

    const calls = h.wsBroadcast.mock.calls as Array<[string, Record<string, unknown>]>;
    const exitCall = calls.find((c) => c[0] === 'agent.autonomous.exit');
    expect(exitCall).toBeDefined();
    expect(exitCall![1]['partial']).toBe(true);
    expect(exitCall![1]['reason']).toBe('DOWNSIDE_DERISK');
  });

  it('a fresh position on the same symbol gets a new de-risk allowance', async () => {
    const h = makeExitHarness({ positions: [makePosition()], lastPrice: 140 });
    await h.em.evaluateExits(new Map(), 'cycle-1', Date.now());
    expect(h.submitted).toHaveLength(1);

    // Old position closed; a new one opened later (different openedAtUtc).
    h.setPositions([makePosition({ openedAtUtc: '2026-02-01T00:00:00.000Z' })]);
    const next = await h.em.evaluateExits(new Map(), 'cycle-2', Date.now());
    expect(next[0]!.action).toBe('SCALE_OUT');
    expect(h.submitted).toHaveLength(2);
  });

  it('never scales out when scaling is disabled (config absent)', () => {
    const h = makeExitHarness({ positions: [makePosition()], lastPrice: 140, scaling: { ...SCALING, enabled: false } });
    const decision = h.em.evaluateOne(makePosition(), new Map(), makeFakeAccount(10000), Date.now());
    expect(decision.action).toBe('HOLD');
  });
});

describe('Finding 2: ExitManager evaluateScaleIn (pyramid adds)', () => {
  const OPTS = { allowNewEntries: true, minConfluence: 65, runtimeRiskMultiplier: 1.0 };

  it('returns null when scaling is disabled', async () => {
    const h = makeExitHarness({ scaling: { ...SCALING, enabled: false } });
    const decision = await h.em.evaluateScaleIn(makePosition(), [makeSetup()], makePlan(), OPTS, 'cycle-1');
    expect(decision).toBeNull();
  });

  it('does not add when the position is profitable but below the profit threshold', async () => {
    // LONG 10 @ 150, last 151 → +10 = +0.1% of equity < 1% threshold.
    const h = makeExitHarness({ lastPrice: 151 });
    const decision = await h.em.evaluateScaleIn(makePosition(), [makeSetup()], makePlan(), OPTS, 'cycle-1');
    expect(decision?.submitted).toBe(false);
    expect(decision?.reason).toMatch(/threshold/i);
    expect(h.submitted).toHaveLength(0);
  });

  it('does not add when the circuit breaker is tripped', async () => {
    const h = makeExitHarness({ lastPrice: 160 });
    const decision = await h.em.evaluateScaleIn(
      makePosition(), [makeSetup()], makePlan(),
      { ...OPTS, allowNewEntries: false }, 'cycle-1'
    );
    expect(decision?.submitted).toBe(false);
    expect(decision?.reason).toMatch(/circuit breaker/i);
  });

  it('does not add without an aligned READY setup above min confluence', async () => {
    const h = makeExitHarness({ lastPrice: 160 });
    const decision = await h.em.evaluateScaleIn(
      makePosition(),
      [makeSetup({ direction: 'SHORT', status: 'ACTIVE' })],
      makePlan(), OPTS, 'cycle-1'
    );
    expect(decision?.submitted).toBe(false);
    expect(decision?.reason).toMatch(/no aligned ready setup/i);
  });

  it('does not add when the fresh trade plan is null (regime cannot pay for the add)', async () => {
    const h = makeExitHarness({ lastPrice: 160 });
    const decision = await h.em.evaluateScaleIn(makePosition(), [makeSetup()], null, OPTS, 'cycle-1');
    expect(decision?.submitted).toBe(false);
    expect(decision?.reason).toMatch(/plan rejected/i);
  });

  it('submits a pyramid add with its own SL/TP, quantity, and dedupKey when all gates pass', async () => {
    // LONG 10 @ 150, last 160 → +100 = +1% of equity ≥ threshold.
    const h = makeExitHarness({ lastPrice: 160 });
    const plan = makePlan();
    const decision = await h.em.evaluateScaleIn(makePosition(), [makeSetup()], plan, OPTS, 'cycle-1');

    expect(decision?.submitted).toBe(true);
    expect(decision?.addQty).toBeCloseTo(5, 8); // 0.5 × 10
    expect(decision?.addsTaken).toBe(1);
    expect(decision?.setupType).toBe('SSL_SWEEP_REVERSAL_LONG');

    expect(h.submitted).toHaveLength(1);
    const sig = h.submitted[0]!;
    expect(sig.action).toBe('OPEN_LONG');
    expect(sig.stopLossPrice).toBe(String(plan.stopLossPrice.toFixed(8)));
    expect(sig.takeProfitPrice).toBe(String(plan.takeProfitPrice.toFixed(8)));
    expect(sig.features['quantity']).toBeCloseTo(5, 8);
    expect(sig.features['pyramid']).toBe(true);
    expect(sig.features['scaleIn']).toBe(true);
    expect(sig.features['dedupKey']).toBe('scale-in:SOLUSDT@2026-01-01T00:00:00.000Z:1');
    expect(String(sig.reasoning)).toMatch(/ScaleIn/);

    // Event + WS broadcast on the signal channel.
    const events = h.eventLog.getEvents({ type: 'AUTONOMOUS_SCALE_IN' });
    expect(events).toHaveLength(1);
    const calls = h.wsBroadcast.mock.calls as Array<[string, Record<string, unknown>]>;
    const sigCall = calls.find((c) => c[0] === 'agent.autonomous.signal');
    expect(sigCall).toBeDefined();
    expect(sigCall![1]['setupType']).toBe('SSL_SWEEP_REVERSAL_LONG');
  });

  it('blocks the second add once the pyramid budget is exhausted', async () => {
    const h = makeExitHarness({ lastPrice: 160 });
    await h.em.evaluateScaleIn(makePosition(), [makeSetup()], makePlan(), OPTS, 'cycle-1');
    const second = await h.em.evaluateScaleIn(makePosition(), [makeSetup()], makePlan(), OPTS, 'cycle-2');
    expect(second?.submitted).toBe(false);
    expect(second?.reason).toMatch(/budget exhausted/i);
    expect(h.submitted).toHaveLength(1);
  });

  it('enforces the scale-in cooldown between adds', async () => {
    const h = makeExitHarness({
      lastPrice: 160,
      scaling: { ...SCALING, scaleInMaxAdds: 2, scaleInCooldownMs: 900_000 },
    });
    const first = await h.em.evaluateScaleIn(makePosition(), [makeSetup()], makePlan(), OPTS, 'cycle-1');
    expect(first?.submitted).toBe(true);

    const second = await h.em.evaluateScaleIn(makePosition(), [makeSetup()], makePlan(), OPTS, 'cycle-1');
    // Budget is NOT exhausted (1/2) but the cooldown is active.
    expect(second?.submitted).toBe(false);
    expect(second?.reason).toMatch(/cooldown active/i);
    expect(h.submitted).toHaveLength(1);
  });

  it('resets the pyramid budget for a new position lifecycle', async () => {
    const h = makeExitHarness({ lastPrice: 160 });
    await h.em.evaluateScaleIn(makePosition(), [makeSetup()], makePlan(), OPTS, 'cycle-1');
    // Old position closed; new one opened (different openedAtUtc).
    h.setPositions([]);
    await h.em.evaluateExits(new Map(), 'cycle-1b', Date.now());
    h.setPositions([makePosition({ openedAtUtc: '2026-02-01T00:00:00.000Z' })]);

    const fresh = await h.em.evaluateScaleIn(
      makePosition({ openedAtUtc: '2026-02-01T00:00:00.000Z' }),
      [makeSetup()], makePlan(), OPTS, 'cycle-2'
    );
    expect(fresh?.submitted).toBe(true);
    expect(fresh?.addsTaken).toBe(1);
    expect(h.submitted).toHaveLength(2);
  });
});
