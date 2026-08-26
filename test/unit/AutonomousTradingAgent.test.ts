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
import { StrategyEngine } from '../../src/strategy/StrategyEngine.js';
import { DEFAULT_RISK_CONFIG } from '../../src/trading/risk/RiskLimits.js';
import { ModelManager } from '../../src/ai/ModelManager.js';
import type { AccountState, Position, MarketState, Instrument, OrderCommand, Order } from '../../src/broker/types.js';
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

describe('AutonomousTradingAgent', () => {
  it('runs a full cycle, broadcasts a summary, and submits no signal when no READY setup exists', async () => {
    const store = new KlineStore(500);
    const marketState = new MarketStateManager([makeMockInstrument()]);
    const mtfEngine = new MtfStateEngine(store, marketState);
    const structureEngine = new MarketStructureEngine(store);
    const smcEngine = new SmcLocationEngine(store, structureEngine);
    const setupEngine = new SetupEngine(mtfEngine, structureEngine, smcEngine);

    // Populate enough candles for the MTF engine to consider the data
    // synchronized — no setup will be READY because there are no SMC events.
    for (const tf of ['4h', '1h', '15m', '5m'] as AnalysisTimeframe[]) {
      populateTrendingUp(store, 'SOLUSDT', tf, 60);
    }

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
      llmEndpoints: [
        {
          name: 'fake-local',
          kind: 'llm',
          baseUrl: 'http://127.0.0.1:0',
          model: 'qwen3.5:2b',
          priority: 1,
          timeoutMs: 1000,
        },
      ],
    });

    // Minimal StrategyEngine — submitSignal returns null (no signal emitted)
    // because we won't have any READY setup in this fixture.
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

    const account: AccountState = {
      walletBalance: 10000,
      unrealizedPnl: 0,
      equity: 10000,
      initialMargin: 0,
      maintenanceMargin: 0,
      availableBalance: 10000,
      totalFees: 0,
      totalFunding: 0,
      totalRealizedPnl: 0,
      openPositionsCount: 0,
      openOrdersCount: 0,
    };

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
        getPositions: () => [] as Position[],
        getAccount: () => account,
        getLastPrice: () => 150,
      }
    );

    const summary = await agent.runCycle();

    expect(summary.symbolsScanned).toBe(1);
    expect(summary.cycleId).toMatch(/^autonomous_\d+$/);
    expect(summary.decisions).toHaveLength(1);
    // No READY setup exists in synthetic data → either MONITOR or STAND_ASIDE.
    expect(['MONITOR', 'STAND_ASIDE']).toContain(summary.decisions[0]?.action);
    // The agent must have broadcast at least the cycle summary.
    const calls = wsBroadcast.mock.calls as Array<{ type: string; payload: unknown }[] | unknown[]>;
    const cycleCall = calls.find((c) => (c as unknown[])[0] === 'agent.autonomous.cycle');
    expect(cycleCall).toBeDefined();
    // No signal submitted since no READY setup.
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

  it('stands aside when regime is TRANSITIONING', async () => {
    const store = new KlineStore(500);
    const marketState = new MarketStateManager([makeMockInstrument()]);
    const mtfEngine = new MtfStateEngine(store, marketState);
    const structureEngine = new MarketStructureEngine(store);
    const smcEngine = new SmcLocationEngine(store, structureEngine);
    const setupEngine = new SetupEngine(mtfEngine, structureEngine, smcEngine);

    // Flat, low-ADX candles — classifier should return TRANSITIONING or a
    // weak regime. We force the detector to return null by using very few
    // candles so symState.regime stays null → currentRegime falls back to
    // TRANSITIONING and the agent stands aside.
    for (const tf of ['4h', '1h', '15m', '5m'] as AnalysisTimeframe[]) {
      populateTrendingUp(store, 'SOLUSDT', tf, 5);
    }

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

    const account: AccountState = {
      walletBalance: 10000, unrealizedPnl: 0, equity: 10000, initialMargin: 0,
      maintenanceMargin: 0, availableBalance: 10000, totalFees: 0, totalFunding: 0,
      totalRealizedPnl: 0, openPositionsCount: 0, openOrdersCount: 0,
    };

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
      }
    );

    const summary = await agent.runCycle();
    expect(summary.standingAsideSymbols + summary.decisions.filter((d) => d.action === 'MONITOR').length).toBeGreaterThanOrEqual(1);
    expect(summary.signalsSubmitted).toBe(0);
  });
});
