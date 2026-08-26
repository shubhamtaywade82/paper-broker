import { describe, it, expect, vi } from 'vitest';
import { KlineStore } from '../../src/market/Klines.js';
import { TIMEFRAME_MS, type AnalysisTimeframe } from '../../src/market/MtfStateEngine.js';
import { MarketStructureEngine } from '../../src/market/structure/MarketStructureEngine.js';
import { SmcLocationEngine } from '../../src/market/smc/SmcLocationEngine.js';
import { MarketRegimeDetector, regimeConfirmationBarsFor } from '../../src/analysis/MarketRegimeDetector.js';
import type { MarketRegime, RegimeSnapshot } from '../../src/analysis/MarketRegimeDetector.js';
import { AdaptiveRiskManager } from '../../src/risk/AdaptiveRiskManager.js';
import { PortfolioCorrelationGuard, DEFAULT_CORRELATION_GUARD_CONFIG } from '../../src/risk/PortfolioCorrelationGuard.js';
import { ExitManager, type ScalingConfig } from '../../src/agent/ExitManager.js';
import { AutonomousTradingAgent, type VetoConsultant } from '../../src/agent/AutonomousTradingAgent.js';
import { PerformanceTracker } from '../../src/agent/PerformanceTracker.js';
import { HealthMonitor } from '../../src/agent/HealthMonitor.js';
import { CircuitBreaker } from '../../src/agent/CircuitBreaker.js';
import { ModelManager } from '../../src/ai/ModelManager.js';
import type { StrategyEngine } from '../../src/strategy/StrategyEngine.js';
import type { SetupEngine } from '../../src/market/setup/SetupEngine.js';
import { MtfStateEngine } from '../../src/market/MtfStateEngine.js';
import { SetupEngine } from '../../src/market/setup/SetupEngine.js';
import type { Signal, SignalInput } from '../../src/strategy/signal.js';
import { DEFAULT_RISK_CONFIG } from '../../src/trading/risk/RiskLimits.js';
import { EventLog } from '../../src/persistence/EventLog.js';
import { WebSocketGateway } from '../../src/api/websocket/WebSocketGateway.js';
import type { Position, AccountState, Instrument, MarketState } from '../../src/broker/types.js';
import type { SetupCandidate } from '../../src/market/setup/types.js';
import type { Candle } from '../../src/strategy/indicators.js';
import type { VetoConsultation } from '../../src/ai/tradingAgents.js';
import { MarketStateManager } from '../../src/market/MarketState.js';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// =============================================================================
// Fixtures
// =============================================================================

const instrument: Instrument = {
  symbol: 'SOLUSDT',
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

function makeEventLog(): EventLog {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-broker-followups-'));
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

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    accountId: 'test-account',
    symbol: 'BTCUSDT',
    positionSide: 'BOTH',
    status: 'OPEN',
    qty: 10,
    entryPrice: 150,
    unrealizedPnl: 0,
    realizedPnl: 0,
    leverage: 5,
    initialMargin: 300,
    maintenanceMargin: 1,
    maintenanceMarginRate: 0.005,
    totalFees: 0,
    totalFunding: 0,
    openedAtUtc: '2026-01-01T00:00:00.000Z',
    updatedAtUtc: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Position;
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

function makeReadySetup(overrides: Partial<SetupCandidate> = {}): SetupCandidate {
  return {
    id: 'setup-followups-1',
    symbol: 'SOLUSDT',
    direction: 'LONG',
    setupType: 'SSL_SWEEP_REVERSAL_LONG',
    state: 'TRIGGERED',
    createdAt: 1,
    updatedAt: 1,
    expiresAt: 9999999999999,
    timeframes: { regime4h: 'BULLISH', bias1h: 'BULLISH', structure15m: 'BULLISH', trigger5m: 'BULLISH' },
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

/** Synthetic closed-candle series from a close array — feeds the correlation guard. */
function candlesFromCloses(closes: number[], symbol = 'TESTUSDT', interval = '1h'): Candle[] {
  return closes.map((close, i) => ({
    symbol,
    interval,
    openTime: 1700000000000 + i * 3_600_000,
    open: close,
    high: close * 1.001,
    low: close * 0.999,
    close,
    volume: 1000,
    isClosed: true,
  }));
}

/** Ramping close series — identical series across symbols give ρ = +1. */
const RAMP_60 = Array.from({ length: 60 }, (_, i) => 100 + i);
/**
 * Series built from the EXACTLY NEGATED log-returns of RAMP_60 → ρ = −1.
 * (A simple descending ramp would NOT work: its return magnitudes grow while
 * the ramp's shrink, which actually correlates positively.)
 */
const NEGATED_RAMP_60 = (() => {
  const closes: number[] = [100];
  for (let i = 1; i < 60; i++) {
    const r = Math.log(RAMP_60[i]! / RAMP_60[i - 1]!);
    closes.push(closes[i - 1]! * Math.exp(-r));
  }
  return closes;
})();

// =============================================================================
// Finding 6 — per-regime confirmation bars (pure function)
// =============================================================================

describe('regimeConfirmationBarsFor (Finding 6)', () => {
  it('requires MORE observations to leave a noisy regime than a quiet one', () => {
    // Base 3: leaving RANGING_LOW_VOL needs 2, leaving VOLATILE_BREAKOUT needs 5.
    expect(regimeConfirmationBarsFor('VOLATILE_BREAKOUT', 'TRENDING_NORMAL', 3)).toBe(5);
    expect(regimeConfirmationBarsFor('RANGING_HIGH_VOL', 'TRENDING_NORMAL', 3)).toBe(4);
    expect(regimeConfirmationBarsFor('TRANSITIONING', 'TRENDING_NORMAL', 3)).toBe(4);
    expect(regimeConfirmationBarsFor('TRENDING_STRONG', 'TRENDING_NORMAL', 3)).toBe(3);
    expect(regimeConfirmationBarsFor('TRENDING_NORMAL', 'TRENDING_STRONG', 3)).toBe(3);
    expect(regimeConfirmationBarsFor('RANGING_LOW_VOL', 'TRENDING_NORMAL', 3)).toBe(2);
  });

  it('never delays a transition INTO TRANSITIONING (de-risking direction)', () => {
    // Even out of the noisiest regime, falling back to TRANSITIONING is the
    // safe direction — always the plain base, no offset.
    expect(regimeConfirmationBarsFor('VOLATILE_BREAKOUT', 'TRANSITIONING', 3)).toBe(3);
    expect(regimeConfirmationBarsFor('RANGING_HIGH_VOL', 'TRANSITIONING', 5)).toBe(5);
  });

  it('honours explicit per-regime overrides (clamped to ≥ 1)', () => {
    expect(regimeConfirmationBarsFor('VOLATILE_BREAKOUT', 'TRENDING_NORMAL', 3, { VOLATILE_BREAKOUT: 7 })).toBe(7);
    expect(regimeConfirmationBarsFor('RANGING_LOW_VOL', 'TRENDING_NORMAL', 3, { RANGING_LOW_VOL: 0 })).toBe(1);
    // Other regimes still use the offset table.
    expect(regimeConfirmationBarsFor('TRENDING_NORMAL', 'TRENDING_STRONG', 3, { VOLATILE_BREAKOUT: 7 })).toBe(3);
  });

  it('clamps the offset result to ≥ 1 even with a tiny base', () => {
    expect(regimeConfirmationBarsFor('RANGING_LOW_VOL', 'TRENDING_NORMAL', 1)).toBe(1);
    expect(regimeConfirmationBarsFor('VOLATILE_BREAKOUT', 'TRENDING_NORMAL', 1)).toBe(3);
  });
});

// =============================================================================
// Finding 8 — PortfolioCorrelationGuard (unit)
// =============================================================================

function makeGuard(
  candlesBySymbol: Record<string, Candle[]>,
  configOverrides: Partial<typeof DEFAULT_CORRELATION_GUARD_CONFIG> = {}
): PortfolioCorrelationGuard {
  return new PortfolioCorrelationGuard(
    { ...DEFAULT_CORRELATION_GUARD_CONFIG, ...configOverrides },
    {
      getCandles: (symbol, _tf, count) => (candlesBySymbol[symbol] ?? []).slice(-count),
    }
  );
}

describe('PortfolioCorrelationGuard (Finding 8)', () => {
  const equity = 10000;
  // Candidate: notional 5000 @ 5x → margin 1000 = 10% of equity.
  const candidate = { symbol: 'SOLUSDT', direction: 'LONG' as const, notional: 5000, leverage: 5 };

  it('blocks a candidate whose correlated same-direction cluster breaches the cap', () => {
    const guard = makeGuard({
      SOLUSDT: candlesFromCloses(RAMP_60, 'SOLUSDT'),
      BTCUSDT: candlesFromCloses(RAMP_60, 'BTCUSDT'),
      ETHUSDT: candlesFromCloses(RAMP_60, 'ETHUSDT'),
    });
    // BTC long: margin 2000 (20% equity), ETH long: margin 500 (5%) — both
    // perfectly correlated with SOL (identical series → ρ = +1).
    // Cluster = 10% (candidate) + 20% + 5% = 35% > 25% cap.
    const check = guard.evaluate(
      candidate,
      [makePosition({ symbol: 'BTCUSDT', initialMargin: 2000 }), makePosition({ symbol: 'ETHUSDT', initialMargin: 500 })],
      equity
    );
    expect(check.allowed).toBe(false);
    expect(check.correlatedExposurePct).toBeCloseTo(0.35, 6);
    expect(check.correlatedPositions.map((p) => p.symbol).sort()).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(check.correlatedPositions.every((p) => Math.abs(p.correlation - 1) < 1e-9)).toBe(true);
    expect(check.reason).toMatch(/35\.0% vs cap 25%/);
  });

  it('allows the candidate when the cluster fits under the cap', () => {
    const guard = makeGuard({
      SOLUSDT: candlesFromCloses(RAMP_60, 'SOLUSDT'),
      BTCUSDT: candlesFromCloses(RAMP_60, 'BTCUSDT'),
    });
    // BTC long margin 1000 (10%) + candidate 10% = 20% ≤ 25%.
    const check = guard.evaluate(candidate, [makePosition({ symbol: 'BTCUSDT', initialMargin: 1000 })], equity);
    expect(check.allowed).toBe(true);
    expect(check.correlatedExposurePct).toBeCloseTo(0.2, 6);
  });

  it('ignores a hedge: opposite-direction position on a positively-correlated symbol', () => {
    const guard = makeGuard({
      SOLUSDT: candlesFromCloses(RAMP_60, 'SOLUSDT'),
      BTCUSDT: candlesFromCloses(RAMP_60, 'BTCUSDT'),
    });
    // BTC SHORT with ρ(SOL,BTC) = +1: effective correlation = −1 → hedge.
    // Even a huge margin must not count toward the long cluster.
    const check = guard.evaluate(
      candidate,
      [makePosition({ symbol: 'BTCUSDT', qty: -10, positionSide: 'SHORT', initialMargin: 5000 })],
      equity
    );
    expect(check.allowed).toBe(true);
    expect(check.correlatedPositions).toHaveLength(0);
    expect(check.correlatedExposurePct).toBeCloseTo(0.1, 6);
  });

  it('ignores same-direction positions on negatively-correlated symbols (natural hedge)', () => {
    const guard = makeGuard({
      SOLUSDT: candlesFromCloses(RAMP_60, 'SOLUSDT'),
      BTCUSDT: candlesFromCloses(NEGATED_RAMP_60, 'BTCUSDT'),
    });
    const check = guard.evaluate(candidate, [makePosition({ symbol: 'BTCUSDT', initialMargin: 5000 })], equity);
    expect(check.allowed).toBe(true);
    expect(check.correlatedPositions).toHaveLength(0);
  });

  it('treats pairs with insufficient candle history as uncorrelated but flags it', () => {
    const guard = makeGuard({
      SOLUSDT: candlesFromCloses(RAMP_60, 'SOLUSDT'),
      NEWUSDT: candlesFromCloses(RAMP_60.slice(0, 10), 'NEWUSDT'), // only 10 candles
    });
    const check = guard.evaluate(candidate, [makePosition({ symbol: 'NEWUSDT', initialMargin: 5000 })], equity);
    expect(check.allowed).toBe(true);
    expect(check.insufficientData).toBe(true);
    expect(check.correlatedPositions).toHaveLength(0);
    expect(check.reason).toMatch(/lacked data/);
  });

  it('counts the candidate\'s own open position when includeSameSymbol is set (scale-in)', () => {
    const guard = makeGuard({ SOLUSDT: candlesFromCloses(RAMP_60, 'SOLUSDT') });
    // Scale-in check: the base SOL long (margin 20%) counts at ρ = 1.
    // 10% add + 20% base = 30% > 25% → the add is blocked.
    const check = guard.evaluate(
      candidate,
      [makePosition({ symbol: 'SOLUSDT', initialMargin: 2000 })],
      equity,
      { includeSameSymbol: true }
    );
    expect(check.allowed).toBe(false);
    expect(check.correlatedPositions).toHaveLength(1);
    expect(check.correlatedPositions[0]!.symbol).toBe('SOLUSDT');
    expect(check.correlatedPositions[0]!.correlation).toBe(1);
    expect(check.correlatedExposurePct).toBeCloseTo(0.3, 6);
  });

  it('skips same-symbol positions on fresh entries (per-symbol limits govern those)', () => {
    const guard = makeGuard({ SOLUSDT: candlesFromCloses(RAMP_60, 'SOLUSDT') });
    const check = guard.evaluate(candidate, [makePosition({ symbol: 'SOLUSDT', initialMargin: 5000 })], equity);
    expect(check.allowed).toBe(true);
    expect(check.correlatedPositions).toHaveLength(0);
  });

  it('is a pass-through when disabled', () => {
    const guard = makeGuard(
      { SOLUSDT: candlesFromCloses(RAMP_60, 'SOLUSDT'), BTCUSDT: candlesFromCloses(RAMP_60, 'BTCUSDT') },
      { enabled: false }
    );
    const check = guard.evaluate(
      candidate,
      [makePosition({ symbol: 'BTCUSDT', initialMargin: 5000 })],
      equity
    );
    expect(check.allowed).toBe(true);
    expect(check.reason).toMatch(/disabled/i);
  });

  it('falls back to notional/leverage when initialMargin is missing', () => {
    const guard = makeGuard({
      SOLUSDT: candlesFromCloses(RAMP_60, 'SOLUSDT'),
      BTCUSDT: candlesFromCloses(RAMP_60, 'BTCUSDT'),
    });
    // qty 10 @ entry 150, leverage 5 → notional 1500 → margin 300 (3%).
    const check = guard.evaluate(candidate, [makePosition({ symbol: 'BTCUSDT', initialMargin: 0 })], equity);
    expect(check.allowed).toBe(true);
    expect(check.correlatedPositions[0]!.exposurePct).toBeCloseTo(0.03, 6);
  });
});

// =============================================================================
// Finding 8 — ExitManager scale-in gate
// =============================================================================

const SCALING: ScalingConfig = {
  enabled: true,
  scaleInMinProfitPct: 0.01,
  scaleInSizeFraction: 0.5,
  scaleInMaxAdds: 1,
  scaleInCooldownMs: 900_000,
  scaleOutTriggerPct: 0.01,
  scaleOutCloseFraction: 0.5,
};

function makeExitHarness(opts: { lastPrice?: number; equity?: number } = {}) {
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
  const em = new ExitManager(
    {
      exitOnRegimeFlip: false,
      maxUnrealizedLossPct: 0.02,
      strategyId: 'autonomous-agent-test',
      scaling: SCALING,
    },
    {
      eventLog,
      wsGateway,
      strategyEngine,
      regimeDetector: detector,
      getPositions: () => [],
      getAccount: () => makeFakeAccount(opts.equity ?? 10000),
      getLastPrice: () => opts.lastPrice ?? 160,
      forgetTrailingStop: vi.fn(),
    }
  );
  return { em, submitted, eventLog };
}

describe('ExitManager scale-in correlation gate (Finding 8)', () => {
  const OPTS = { allowNewEntries: true, minConfluence: 65, runtimeRiskMultiplier: 1.0 };
  // A minimal but complete TradePlan for the scale-in path.
  const tradePlan = {
    adaptation: new MarketRegimeDetector(() => [], () => 'BULLISH', 3).getAdaptation('TRENDING_STRONG'),
    stopLossPrice: 155,
    takeProfitPrice: 180,
    leverage: 5,
    riskMultiplier: 1.2,
    regimeBias: 1.0,
    rr: 2.5,
    atr: 2,
    entryPrice: 160,
    direction: 'LONG' as const,
  };

  it('blocks a pyramid add when the correlation callback disallows it', async () => {
    const h = makeExitHarness({ lastPrice: 160 }); // LONG 10 @ 150 → +1% equity (profit gate passes)
    const correlationCheck = vi.fn(() => ({
      allowed: false,
      reason: 'correlated exposure 30.0% vs cap 25% | cluster: BTCUSDT(ρ=0.92, 20.0%)',
    }));
    const decision = await h.em.evaluateScaleIn(
      makePosition({ symbol: 'SOLUSDT', qty: 10, entryPrice: 150, initialMargin: 300 }),
      [makeReadySetup({ symbol: 'SOLUSDT' })],
      tradePlan,
      { ...OPTS, correlationCheck },
      'cycle-1'
    );
    expect(decision?.submitted).toBe(false);
    expect(decision?.reason).toMatch(/Correlated exposure cap/);
    expect(decision?.reason).toMatch(/BTCUSDT/);
    // The callback saw the prospective add: 5 units (half of 10) @ 160 = 800 notional.
    expect(correlationCheck).toHaveBeenCalledWith(800, 5);
    expect(h.submitted).toHaveLength(0);
    // The pyramid budget was NOT consumed by a blocked add.
    expect(decision?.addsTaken).toBe(0);
  });

  it('submits the add when the correlation callback allows it', async () => {
    const h = makeExitHarness({ lastPrice: 160 });
    const correlationCheck = vi.fn(() => ({ allowed: true, reason: 'within cap' }));
    const decision = await h.em.evaluateScaleIn(
      makePosition({ symbol: 'SOLUSDT', qty: 10, entryPrice: 150, initialMargin: 300 }),
      [makeReadySetup({ symbol: 'SOLUSDT' })],
      tradePlan,
      { ...OPTS, correlationCheck },
      'cycle-1'
    );
    expect(decision?.submitted).toBe(true);
    expect(correlationCheck).toHaveBeenCalledTimes(1);
    expect(h.submitted).toHaveLength(1);
  });

  it('no callback configured → behaves exactly as before (no gate)', async () => {
    const h = makeExitHarness({ lastPrice: 160 });
    const decision = await h.em.evaluateScaleIn(
      makePosition({ symbol: 'SOLUSDT', qty: 10, entryPrice: 150, initialMargin: 300 }),
      [makeReadySetup({ symbol: 'SOLUSDT' })],
      tradePlan,
      OPTS,
      'cycle-1'
    );
    expect(decision?.submitted).toBe(true);
    expect(h.submitted).toHaveLength(1);
  });
});

// =============================================================================
// Agent-level harness (Findings 1, 5, 6-behavioural, 8-entry)
// =============================================================================

interface AgentHarness {
  agent: AutonomousTradingAgent;
  submitted: SignalInput[];
  wsBroadcast: ReturnType<typeof vi.fn>;
  eventLog: EventLog;
  setRegime: (r: MarketRegime) => void;
  setSetups: (s: SetupCandidate[]) => void;
  setPositions: (p: Position[]) => void;
  setConsultation: (c: Partial<VetoConsultation> | null) => void;
  consultationSpy: ReturnType<typeof vi.fn>;
  completeSpy: ReturnType<typeof vi.fn>;
}

/**
 * Full agent harness with stub-friendly seams:
 *  - regime detector whose current regime is mutable (Finding 6 behaviour)
 *  - setup engine whose READY setups are injectable (Findings 1/5/8)
 *  - veto consultant recording every call (Finding 1)
 *  - modelManager.complete mocked to a fixed confidence (fast, no network)
 */
function makeAgentHarness(opts: {
  regimeConfirmationBars?: number;
  regimeConfirmationBarsByRegime?: Partial<Record<MarketRegime, number>>;
  llmVetoEnabled?: boolean;
  htfAlignmentWeighted?: boolean;
  minConfluence?: number;
  positions?: Position[];
  correlationGuard?: PortfolioCorrelationGuard;
} = {}): AgentHarness {
  const store = new KlineStore(500);
  const marketState = new MarketStateManager([instrument]);
  const mtfEngine = new MtfStateEngine(store, marketState);
  const structureEngine = new MarketStructureEngine(store);
  const smcEngine = new SmcLocationEngine(store, structureEngine);
  const setupEngine = new SetupEngine(mtfEngine, structureEngine, smcEngine);
  for (const tf of ['4h', '1h', '15m', '5m'] as AnalysisTimeframe[]) {
    populateTrendingUp(store, 'SOLUSDT', tf, 60);
    // ETH mirrors SOL's series exactly → ρ = +1 for the correlation tests.
    populateTrendingUp(store, 'ETHUSDT', tf, 60);
  }
  marketState.onBookTicker('SOLUSDT', 150.0, 150.05, 0, 0);
  marketState.onAggTrade('SOLUSDT', 150.0, 0);
  marketState.onMarkPrice('SOLUSDT', 150.0, 150.0, 0);

  const realDetector = new MarketRegimeDetector(
    (sym, count) => store.getCandles(sym, '4h', count).filter((c) => c.isClosed).slice(-count),
    () => 'BULLISH',
    3
  );
  let currentRegime: MarketRegime = 'TRENDING_STRONG';
  const detector = {
    detect: (): RegimeSnapshot => ({
      symbol: 'SOLUSDT',
      asOf: Date.now(),
      regime: currentRegime,
      features: {} as never,
      regimeKey: 'followups-test',
      htfTrend: 'BULLISH',
      mtfTrend: 'BULLISH',
      confidence: 80,
    }),
    getAdaptation: (r: MarketRegime) => realDetector.getAdaptation(r),
  } as unknown as MarketRegimeDetector;

  const riskManager = new AdaptiveRiskManager({
    baseConfig: DEFAULT_RISK_CONFIG,
    getEquity: () => 10000,
    getLastPrice: () => 150,
    getCandles: (sym, _tf, count) => store.getCandles(sym, '1h', count).filter((c) => c.isClosed).slice(-count),
  });

  const modelManager = new ModelManager({
    llmEndpoints: [{ name: 'fake', kind: 'llm', baseUrl: 'http://127.0.0.1:0', model: 'qwen3.5:2b', priority: 1, timeoutMs: 1000 }],
  });
  const completeSpy = vi
    .spyOn(modelManager, 'complete')
    .mockResolvedValue({ text: '{"confidence": 0.9, "rationale": "mock"}' });

  const submitted: SignalInput[] = [];
  const strategyEngine = {
    async submitSignal(input: SignalInput): Promise<Signal | null> {
      submitted.push(input);
      return { ...input, id: `sig-${submitted.length}`, ts: Date.now(), status: 'EXECUTED' } as Signal;
    },
    isRunning: () => true,
  } as unknown as StrategyEngine;

  const eventLog = makeEventLog();
  const wsBroadcast = vi.fn();
  const wsGateway = { broadcast: wsBroadcast } as unknown as WebSocketGateway;
  const account = makeFakeAccount(10000);
  let positions = opts.positions ?? [];

  const performanceTracker = new PerformanceTracker(
    { strategyId: 'autonomous-agent-test', windowSize: 30, minSample: 3, riskAdaptStep: 0.1, riskMultMin: 0.5, riskMultMax: 1.5 },
    { eventLog }
  );
  const healthMonitor = new HealthMonitor(
    { symbols: ['SOLUSDT'], timeframes: ['4h', '1h', '15m', '5m'] as const, staleMs: 60_000, modelProbeIntervalMs: 0 },
    { eventLog, wsGateway, mtfEngine, marketState, modelManager }
  );
  const circuitBreaker = new CircuitBreaker(
    { maxDailyLossPct: 0.03, maxConsecutiveLosses: 3, maxDrawdownPct: 0.08, cooldownMs: 1_000, requireHealthyMarket: false },
    {
      eventLog,
      wsGateway,
      getAccount: () => account,
      getConsecutiveLosses: () => performanceTracker.getRollingStats().consecutiveLosses,
      getHealth: () => healthMonitor.getState(),
    }
  );
  const exitManager = new ExitManager(
    { exitOnRegimeFlip: true, maxUnrealizedLossPct: 0.02, strategyId: 'autonomous-agent-test' },
    {
      eventLog,
      wsGateway,
      strategyEngine,
      regimeDetector: detector,
      getPositions: () => positions,
      getAccount: () => account,
      getLastPrice: () => 150,
      forgetTrailingStop: vi.fn(),
    }
  );

  // Veto consultant stub — mutable verdict, records every call.
  let consultation: VetoConsultation | null = null;
  const consultationSpy = vi.fn(
    async (ctx: unknown, direction: 'LONG' | 'SHORT'): Promise<VetoConsultation> => {
      void ctx;
      void direction;
      return (
        consultation ?? {
          action: 'LONG',
          prevailingSide: 'BULL',
          confidence: 0.8,
          degraded: false,
          rationale: 'stub consultation',
        }
      );
    }
  );
  const tradingAgents: VetoConsultant = {
    runVetoConsultation: consultationSpy as unknown as VetoConsultant['runVetoConsultation'],
  };

  let injectedSetups: SetupCandidate[] = [];
  const setupsSpy = vi.spyOn(setupEngine, 'getSetupsAsOf').mockImplementation((_symbol, _now) => injectedSetups);

  const agent = new AutonomousTradingAgent(
    {
      symbols: ['SOLUSDT'],
      cycleMs: 60_000,
      minConfluence: opts.minConfluence ?? 65,
      minRR: 1.5,
      maxOpenPositions: 3,
      perSymbolMaxPositions: 1,
      cooldownMs: 0,
      strategyId: 'autonomous-agent-test',
      minConfidence: 0.4,
      regimeConfirmationBars: opts.regimeConfirmationBars ?? 3,
      ...(opts.regimeConfirmationBarsByRegime
        ? { regimeConfirmationBarsByRegime: opts.regimeConfirmationBarsByRegime }
        : {}),
      llmVetoEnabled: opts.llmVetoEnabled ?? true,
      htfAlignmentWeighted: opts.htfAlignmentWeighted ?? true,
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
      getPositions: () => positions,
      getAccount: () => account,
      getLastPrice: () => 150,
      performanceTracker,
      circuitBreaker,
      exitManager,
      healthMonitor,
      tradingAgents,
      getMarketState: (symbol) => marketState.getState(symbol),
      ...(opts.correlationGuard ? { correlationGuard: opts.correlationGuard } : {}),
    }
  );

  return {
    agent,
    submitted,
    wsBroadcast,
    eventLog,
    setRegime: (r) => {
      currentRegime = r;
    },
    setSetups: (s) => {
      injectedSetups = s;
    },
    setPositions: (p) => {
      positions = p;
    },
    setConsultation: (c) => {
      consultation = c ? { action: 'LONG', prevailingSide: 'BULL', confidence: 0.8, degraded: false, rationale: 'stub', ...c } : null;
    },
    consultationSpy,
    completeSpy,
  };
}

// =============================================================================
// Finding 1 — debate-driven LLM veto (agent level)
// =============================================================================

describe('AutonomousTradingAgent LLM veto (Finding 1)', () => {
  it('vetoes the entry when the debate trader returns NEUTRAL (non-degraded)', async () => {
    const h = makeAgentHarness();
    h.setSetups([makeReadySetup()]);
    h.setConsultation({ action: 'NEUTRAL', prevailingSide: 'NEUTRAL', confidence: 0.4, degraded: false, rationale: 'Debate inconclusive' });

    const summary = await h.agent.runCycle();
    const decision = summary.decisions[0]!;

    expect(decision.action).toBe('REJECTED');
    expect(decision.reason).toMatch(/LLM veto/i);
    expect(decision.reason).toMatch(/NEUTRAL/);
    expect(summary.signalsRejected).toBe(1);
    expect(summary.signalsSubmitted).toBe(0);
    expect(h.submitted).toHaveLength(0);
    // The debate replaced the plain probe — modelManager.complete untouched.
    expect(h.consultationSpy).toHaveBeenCalledTimes(1);
    expect(h.completeSpy).not.toHaveBeenCalled();
    // Durable audit trail.
    const events = h.eventLog.getEvents({ type: 'AUTONOMOUS_LLM_VETO', limit: 5 });
    expect(events).toHaveLength(1);
    expect((events[0]!.payload as Record<string, unknown>)['reason']).toMatch(/NEUTRAL/);
  });

  it('vetoes the entry when the debate trader opposes the intended direction', async () => {
    const h = makeAgentHarness();
    h.setSetups([makeReadySetup()]); // LONG setup
    h.setConsultation({ action: 'SHORT', prevailingSide: 'BEAR', confidence: 0.85, degraded: false, rationale: 'Bear case stronger' });

    const summary = await h.agent.runCycle();
    expect(summary.decisions[0]!.action).toBe('REJECTED');
    expect(summary.decisions[0]!.reason).toMatch(/says SHORT vs intended LONG/);
    expect(h.submitted).toHaveLength(0);
  });

  it('does NOT veto on a degraded consultation (model unavailable) — agent stays best-effort', async () => {
    const h = makeAgentHarness();
    h.setSetups([makeReadySetup()]);
    // Even an opposing action must not veto when the debate fell back.
    h.setConsultation({ action: 'SHORT', prevailingSide: 'BEAR', confidence: 0.9, degraded: true, rationale: 'fallback' });

    const summary = await h.agent.runCycle();
    const decision = summary.decisions[0]!;

    // Entry proceeds on deterministic confidence (confluence 80 → ~0.9 ≥ 0.4).
    expect(decision.action).toBe('ENTRY_SUBMITTED');
    expect(summary.signalsSubmitted).toBe(1);
    expect(h.submitted).toHaveLength(1);
    // No veto event, no extra model round-trip.
    expect(h.eventLog.getEvents({ type: 'AUTONOMOUS_LLM_VETO', limit: 5 })).toHaveLength(0);
    expect(h.completeSpy).not.toHaveBeenCalled();
    // Deterministic confidence: 0.8 + min(0.1, (rr-1.5)/10).
    const expected = 0.8 + Math.min(0.1, (h.submitted[0]!.features['rr'] as number));
    expect(h.submitted[0]!.confidence).toBeCloseTo(expected, 6);
  });

  it('blends the agreeing debate\'s trader confidence 60/40 with the deterministic base', async () => {
    const h = makeAgentHarness();
    h.setSetups([makeReadySetup()]);
    h.setConsultation({ action: 'LONG', prevailingSide: 'BULL', confidence: 1.0, degraded: false, rationale: 'bull case strong' });

    await h.agent.runCycle();
    expect(h.submitted).toHaveLength(1);
    const rr = h.submitted[0]!.features['rr'] as number;
    const deterministic = 0.8 + Math.min(0.1, (rr - 1.5) / 10);
    // 60% model (1.0) + 40% deterministic.
    expect(h.submitted[0]!.confidence).toBeCloseTo(0.6 * 1.0 + 0.4 * deterministic, 6);
    // The consultation received a coherent market-fact context.
    const ctx = h.consultationSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(ctx['symbol']).toBe('SOLUSDT');
    expect(ctx['accountEquity']).toBe(10000);
    expect(String(ctx['setupMemory'])).toMatch(/SSL_SWEEP_REVERSAL_LONG/);
  });

  it('falls back to the plain model probe when the veto is disabled', async () => {
    const h = makeAgentHarness({ llmVetoEnabled: false });
    h.setSetups([makeReadySetup()]);
    h.setConsultation({ action: 'NEUTRAL', confidence: 0.1, degraded: false, rationale: 'would have vetoed' });

    const summary = await h.agent.runCycle();
    expect(summary.decisions[0]!.action).toBe('ENTRY_SUBMITTED');
    expect(h.consultationSpy).not.toHaveBeenCalled();
    expect(h.completeSpy).toHaveBeenCalledTimes(1);
    expect(h.submitted).toHaveLength(1);
  });

  it('never blocks the cycle when the consultation itself throws', async () => {
    const h = makeAgentHarness();
    h.setSetups([makeReadySetup()]);
    h.consultationSpy.mockRejectedValueOnce(new Error('network down'));

    const summary = await h.agent.runCycle();
    expect(summary.decisions[0]!.action).toBe('ENTRY_SUBMITTED');
    expect(h.submitted).toHaveLength(1);
  });
});

// =============================================================================
// Finding 5 — weighted HTF alignment (agent level)
// =============================================================================

describe('AutonomousTradingAgent weighted HTF alignment (Finding 5)', () => {
  it('weights a RANGE-trend setup at 0.7 and blocks it when the weighted score misses the gate', async () => {
    const h = makeAgentHarness();
    // 80 × 0.7 = 56 < 65 → MONITOR with the weighted math in the reason.
    h.setSetups([makeReadySetup({ setupType: 'FVG_CONTINUATION_LONG', timeframes: { regime4h: 'RANGE', bias1h: 'BULLISH', structure15m: 'BULLISH', trigger5m: 'BULLISH' } })]);

    const summary = await h.agent.runCycle();
    const decision = summary.decisions[0]!;
    expect(decision.action).toBe('MONITOR');
    expect(decision.reason).toMatch(/4h RANGE neutral/);
    expect(decision.reason).toMatch(/80 .* 0\.70 .* 56/);
    expect(h.submitted).toHaveLength(0);
    // The expensive model probe never ran — the gate fired before it.
    expect(h.consultationSpy).not.toHaveBeenCalled();
  });

  it('lets a very-high-confluence RANGE-trend setup through at 0.7 weight (relaxation vs binary gate)', async () => {
    const h = makeAgentHarness();
    // 100 × 0.7 = 70 ≥ 65 → passes (the legacy binary gate rejected ANY
    // non-reversal long in a RANGE 4h outright).
    h.setSetups([
      makeReadySetup({
        setupType: 'FVG_CONTINUATION_LONG',
        confluence: {
          htfAlignmentScore: 10, structureScore: 20, liquiditySweepScore: 15, fvgScore: 15,
          orderBlockScore: 15, retestScore: 10, triggerScore: 10, dataQualityScore: 5,
          totalScore: 100, maxScore: 100, notes: [],
        },
        timeframes: { regime4h: 'RANGE', bias1h: 'BULLISH', structure15m: 'BULLISH', trigger5m: 'BULLISH' },
      }),
    ]);

    const summary = await h.agent.runCycle();
    expect(summary.decisions[0]!.action).toBe('ENTRY_SUBMITTED');
    expect(h.submitted).toHaveLength(1);
    // The signal carries the alignment weight + effective confluence.
    expect(h.submitted[0]!.features['alignmentWeight']).toBeCloseTo(0.7, 6);
    expect(h.submitted[0]!.features['effectiveConfluence']).toBe(70);
  });

  it('weights a counter-trend non-reversal setup at 0.3 (effectively still unreachable)', async () => {
    const h = makeAgentHarness();
    h.setSetups([
      makeReadySetup({
        setupType: 'FVG_CONTINUATION_LONG',
        timeframes: { regime4h: 'BEARISH', bias1h: 'BULLISH', structure15m: 'BULLISH', trigger5m: 'BULLISH' },
      }),
    ]);

    const summary = await h.agent.runCycle();
    const decision = summary.decisions[0]!;
    expect(decision.action).toBe('MONITOR');
    expect(decision.reason).toMatch(/counter-trend vs 4h BEARISH/);
    expect(decision.reason).toMatch(/80 .* 0\.30 .* 24/);
    expect(h.submitted).toHaveLength(0);
  });

  it('gives a REVERSAL archetype countering the 4h trend the range weight, not the counter weight', async () => {
    const h = makeAgentHarness();
    // Reversal long vs BEARISH 4h: 100 × 0.7 = 70 ≥ 65 → passes where the
    // legacy binary gate rejected reversals unless the 4h was RANGE/UNKNOWN.
    h.setSetups([
      makeReadySetup({
        setupType: 'SSL_SWEEP_REVERSAL_LONG',
        confluence: {
          htfAlignmentScore: 10, structureScore: 20, liquiditySweepScore: 15, fvgScore: 15,
          orderBlockScore: 15, retestScore: 10, triggerScore: 10, dataQualityScore: 5,
          totalScore: 100, maxScore: 100, notes: [],
        },
        timeframes: { regime4h: 'BEARISH', bias1h: 'BULLISH', structure15m: 'BULLISH', trigger5m: 'BULLISH' },
      }),
    ]);

    const summary = await h.agent.runCycle();
    expect(summary.decisions[0]!.action).toBe('ENTRY_SUBMITTED');
    expect(h.submitted[0]!.features['alignmentWeight']).toBeCloseTo(0.7, 6);
  });

  it('htfAlignmentWeighted=false restores the legacy binary gate', async () => {
    const h = makeAgentHarness({ htfAlignmentWeighted: false });
    // Non-reversal long in RANGE → binary gate rejects outright.
    h.setSetups([makeReadySetup({ setupType: 'FVG_CONTINUATION_LONG', timeframes: { regime4h: 'RANGE', bias1h: 'BULLISH', structure15m: 'BULLISH', trigger5m: 'BULLISH' } })]);

    const summary = await h.agent.runCycle();
    const decision = summary.decisions[0]!;
    expect(decision.action).toBe('MONITOR');
    expect(decision.reason).toMatch(/binary gate/);
    expect(h.submitted).toHaveLength(0);
  });
});

// =============================================================================
// Finding 6 — per-regime confirmation bars (behaviour, through runCycle)
// =============================================================================

describe('AutonomousTradingAgent per-regime regime confirmation (Finding 6)', () => {
  it('needs 5 consecutive differing observations to leave VOLATILE_BREAKOUT (base 3 + 2)', async () => {
    const h = makeAgentHarness({ regimeConfirmationBars: 3 });
    // First observation establishes the committed regime.
    h.setRegime('VOLATILE_BREAKOUT');
    await h.agent.runCycle();

    h.setRegime('TRENDING_NORMAL');
    // Four differing observations: not enough (need 5).
    for (let i = 0; i < 4; i++) {
      await h.agent.runCycle();
      const regimeCalls = h.wsBroadcast.mock.calls.filter((c) => c[0] === 'agent.autonomous.regime');
      expect(regimeCalls).toHaveLength(0);
    }
    // Fifth differing observation commits the change.
    await h.agent.runCycle();
    const regimeCalls = h.wsBroadcast.mock.calls.filter((c) => c[0] === 'agent.autonomous.regime');
    expect(regimeCalls).toHaveLength(1);
    const payload = regimeCalls[0]![1] as Record<string, unknown>;
    expect(payload['from']).toBe('VOLATILE_BREAKOUT');
    expect(payload['to']).toBe('TRENDING_NORMAL');
    expect(payload['confirmations']).toBe(5);

    const events = h.eventLog.getEvents({ type: 'AUTONOMOUS_REGIME_CHANGE', limit: 5 });
    expect(events).toHaveLength(1);
    expect((events[0]!.payload as Record<string, unknown>)['confirmations']).toBe(5);
  });

  it('needs only 2 consecutive differing observations to leave RANGING_LOW_VOL (base 3 − 1)', async () => {
    const h = makeAgentHarness({ regimeConfirmationBars: 3 });
    h.setRegime('RANGING_LOW_VOL');
    await h.agent.runCycle();

    h.setRegime('TRENDING_NORMAL');
    await h.agent.runCycle(); // 1st differing observation — not enough.
    expect(h.wsBroadcast.mock.calls.filter((c) => c[0] === 'agent.autonomous.regime')).toHaveLength(0);
    await h.agent.runCycle(); // 2nd — commits.
    const regimeCalls = h.wsBroadcast.mock.calls.filter((c) => c[0] === 'agent.autonomous.regime');
    expect(regimeCalls).toHaveLength(1);
    expect((regimeCalls[0]![1] as Record<string, unknown>)['confirmations']).toBe(2);
  });

  it('honours an explicit per-regime override', async () => {
    const h = makeAgentHarness({
      regimeConfirmationBars: 3,
      regimeConfirmationBarsByRegime: { RANGING_LOW_VOL: 4 },
    });
    h.setRegime('RANGING_LOW_VOL');
    await h.agent.runCycle();

    h.setRegime('TRENDING_NORMAL');
    for (let i = 0; i < 3; i++) {
      await h.agent.runCycle();
      expect(h.wsBroadcast.mock.calls.filter((c) => c[0] === 'agent.autonomous.regime')).toHaveLength(0);
    }
    await h.agent.runCycle(); // 4th differing observation — commits.
    const regimeCalls = h.wsBroadcast.mock.calls.filter((c) => c[0] === 'agent.autonomous.regime');
    expect(regimeCalls).toHaveLength(1);
    expect((regimeCalls[0]![1] as Record<string, unknown>)['confirmations']).toBe(4);
  });
});

// =============================================================================
// Finding 8 — correlation-aware entry gate (agent level)
// =============================================================================

describe('AutonomousTradingAgent correlation-aware entry gate (Finding 8)', () => {
  function makeGuardForStore(store: KlineStore): PortfolioCorrelationGuard {
    return new PortfolioCorrelationGuard(
      { ...DEFAULT_CORRELATION_GUARD_CONFIG },
      {
        getCandles: (symbol, _tf, count) =>
          store.getCandles(symbol, '1h', count).filter((c) => c.isClosed).slice(-count),
      }
    );
  }

  it('rejects an entry whose correlated cluster is already at cap', async () => {
    // Build the harness with a store we control: ETH mirrors SOL's 1h series
    // exactly → ρ(SOL, ETH) = +1. ETH long margin 3000 = 30% of equity, so
    // ANY same-direction candidate breaches the 25% cap before its own margin.
    const store = new KlineStore(500);
    for (const tf of ['4h', '1h', '15m', '5m'] as AnalysisTimeframe[]) {
      populateTrendingUp(store, 'SOLUSDT', tf, 60);
      populateTrendingUp(store, 'ETHUSDT', tf, 60);
    }
    const guard = makeGuardForStore(store);
    const h = makeAgentHarness({ positions: [], correlationGuard: guard });
    h.setPositions([makePosition({ symbol: 'ETHUSDT', qty: 20, entryPrice: 150, initialMargin: 3000 })]);
    h.setSetups([makeReadySetup()]); // aligned LONG, confluence 80 — clears every earlier gate

    const summary = await h.agent.runCycle();
    const decision = summary.decisions[0]!;

    expect(decision.action).toBe('REJECTED');
    expect(decision.reason).toMatch(/Correlated exposure cap/);
    expect(decision.reason).toMatch(/ETHUSDT/);
    expect(summary.signalsRejected).toBe(1);
    expect(h.submitted).toHaveLength(0);
    // The gate fired BEFORE the expensive model calls.
    expect(h.consultationSpy).not.toHaveBeenCalled();
    expect(h.completeSpy).not.toHaveBeenCalled();
  });

  it('allows the entry when the open position is a hedge (opposite direction)', async () => {
    const store = new KlineStore(500);
    for (const tf of ['4h', '1h', '15m', '5m'] as AnalysisTimeframe[]) {
      populateTrendingUp(store, 'SOLUSDT', tf, 60);
      populateTrendingUp(store, 'ETHUSDT', tf, 60);
    }
    const guard = makeGuardForStore(store);
    const h = makeAgentHarness({ correlationGuard: guard });
    // ETH SHORT on a positively-correlated pair → effective ρ = −1 → hedge.
    h.setPositions([makePosition({ symbol: 'ETHUSDT', qty: -20, positionSide: 'SHORT', entryPrice: 150, initialMargin: 3000 })]);
    h.setSetups([makeReadySetup()]);

    const summary = await h.agent.runCycle();
    expect(summary.decisions[0]!.action).toBe('ENTRY_SUBMITTED');
    expect(h.submitted).toHaveLength(1);
  });

  it('no guard wired → identical scenario trades exactly as before', async () => {
    const h = makeAgentHarness();
    h.setPositions([makePosition({ symbol: 'ETHUSDT', qty: 20, entryPrice: 150, initialMargin: 3000 })]);
    h.setSetups([makeReadySetup()]);

    const summary = await h.agent.runCycle();
    expect(summary.decisions[0]!.action).toBe('ENTRY_SUBMITTED');
    expect(h.submitted).toHaveLength(1);
  });
});
