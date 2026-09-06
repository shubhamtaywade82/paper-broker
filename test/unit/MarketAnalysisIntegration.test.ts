import { describe, it, expect } from 'vitest';
import { KlineStore } from '../../src/market/Klines.js';
import { MtfStateEngine, type AnalysisTimeframe } from '../../src/market/MtfStateEngine.js';
import { MarketStructureEngine } from '../../src/market/structure/MarketStructureEngine.js';
import { SmcLocationEngine } from '../../src/market/smc/SmcLocationEngine.js';
import { LiquidityMapEngine } from '../../src/market/liquidity/LiquidityMapEngine.js';
import { ZoneAggregationEngine } from '../../src/analysis/ZoneAggregationEngine.js';
import { MarketLocationEngine } from '../../src/analysis/MarketLocationEngine.js';
import { MarketContextEngine } from '../../src/analysis/MarketContextEngine.js';
import { ThesisEngine } from '../../src/analysis/ThesisEngine.js';
import { ScenarioEngine } from '../../src/analysis/ScenarioEngine.js';
import { HierarchicalConfluenceScorer } from '../../src/analysis/HierarchicalConfluenceScorer.js';
import { MarketAnalysisEngine } from '../../src/analysis/MarketAnalysisEngine.js';
import { SetupEngine } from '../../src/market/setup/SetupEngine.js';
import { AdaptiveRiskManager } from '../../src/risk/AdaptiveRiskManager.js';
import { DEFAULT_RISK_CONFIG } from '../../src/trading/risk/RiskLimits.js';
import type { Candle } from '../../src/strategy/indicators.js';
import type { RegimeAdaptation } from '../../src/analysis/MarketRegimeDetector.js';

const SYMBOL = 'SOLUSDT';
const END_TS = 1_700_208_000_000; // 4h-aligned

/**
 * Rising zigzag generator: 5-candle up legs and 3-candle pullbacks over a
 * rising base — produces clean HH/HL swings, BOS events, FVGs and OBs on
 * every timeframe, i.e. the deterministic "bullish continuation" market.
 */
function candleValue(i: number, base: number): number {
  const cyclePos = i % 8;
  const cycle = Math.floor(i / 8);
  const wave = cyclePos <= 4 ? cyclePos : 4 - (cyclePos - 4) * 0.5;
  return base + cycle * 0.8 + wave;
}

function populateTrending(
  store: KlineStore,
  tf: AnalysisTimeframe,
  intervalMs: number,
  count: number,
  base = 100
): void {
  for (let i = 0; i < count; i++) {
    const openTime = END_TS - (count - i) * intervalMs;
    const open = candleValue(Math.max(0, i - 1), base);
    const close = candleValue(i, base);
    const high = Math.max(open, close) + 0.3;
    const low = Math.min(open, close) - 0.3;
    store.upsertCandle({
      symbol: SYMBOL,
      interval: tf,
      openTime,
      closeTime: openTime + intervalMs - 1,
      open,
      high,
      low,
      close,
      volume: 1000,
      isClosed: true,
    });
  }
}

function buildStack(store: KlineStore) {
  const structureEngine = new MarketStructureEngine(store);
  const smcEngine = new SmcLocationEngine(store, structureEngine);
  const mtfEngine = new MtfStateEngine(store);
  const liquidityMapEngine = new LiquidityMapEngine();
  const zoneAggregationEngine = new ZoneAggregationEngine();
  const locationEngine = new MarketLocationEngine();
  const contextEngine = new MarketContextEngine({
    mtfEngine,
    structureEngine,
    smcEngine,
    liquidityMapEngine,
    zoneAggregationEngine,
    locationEngine,
  });
  const thesisEngine = new ThesisEngine();
  const scenarioEngine = new ScenarioEngine();
  const scorer = new HierarchicalConfluenceScorer();
  const setupEngine = new SetupEngine(mtfEngine, structureEngine, smcEngine);
  setupEngine.setIntelligence({
    contextEngine,
    thesisEngine,
    scenarioEngine,
    confluenceScorer: scorer,
    minHierarchicalScore: 55,
  });
  const analysisEngine = new MarketAnalysisEngine({
    contextEngine,
    thesisEngine,
    scenarioEngine,
    setupEngine,
    baseRiskPerTradePct: 0.005,
  });
  return { mtfEngine, structureEngine, smcEngine, contextEngine, thesisEngine, scenarioEngine, scorer, setupEngine, analysisEngine };
}

function populateBullishStore(): KlineStore {
  const store = new KlineStore();
  populateTrending(store, '4h', 14_400_000, 40);
  populateTrending(store, '2h', 7_200_000, 40);
  populateTrending(store, '1h', 3_600_000, 60);
  populateTrending(store, '15m', 900_000, 80);
  populateTrending(store, '5m', 300_000, 80);
  return store;
}

describe('Market-intelligence layer — full-stack integration', () => {
  it('computes a complete MarketContext over live engine output', () => {
    const store = populateBullishStore();
    const { contextEngine } = buildStack(store);

    const context = contextEngine.computeContext(SYMBOL, END_TS);

    // All five canonical timeframes present with their roles.
    expect(Object.keys(context.timeframes).sort()).toEqual(['15m', '2h', '4h', '5m', '1h'].sort());
    expect(context.timeframes['4h'].role).toBe('MACRO_REGIME');
    expect(context.timeframes['2h'].role).toBe('STRUCTURAL_CONTEXT');
    expect(context.timeframes['1h'].role).toBe('DIRECTIONAL_THESIS');
    expect(context.timeframes['15m'].role).toBe('SETUP_FORMATION');
    expect(context.timeframes['5m'].role).toBe('EXECUTION_TRIGGER');

    // The rising zigzag reads as a bullish market.
    expect(context.structure.trends['4h']).toBe('BULLISH');
    expect(context.directionalBias.final).toBe('LONG');
    expect(context.regime.primary).toBe('BULLISH');

    // Location + liquidity + zones + volatility are all populated.
    expect(context.location.range.timeframe).toBe('4h');
    expect(context.location.range.high).toBeGreaterThan(context.location.range.low);
    expect(Number.isFinite(context.volatility.atr1h)).toBe(true);
    expect(context.volatility.atr1h).toBeGreaterThan(0);
    expect(context.currentPrice).toBeGreaterThan(0);
    expect(context.nearestLevels.length).toBeGreaterThan(0);
    // Determinism.
    const second = contextEngine.computeContext(SYMBOL, END_TS);
    expect(second.directionalBias).toEqual(context.directionalBias);
    expect(second.location.range).toEqual(context.location.range);
  });

  it('produces the final MarketAnalysis object with thesis, scenarios and risk envelope', () => {
    const store = populateBullishStore();
    const { analysisEngine } = buildStack(store);

    const analysis = analysisEngine.computeAnalysis(SYMBOL, END_TS);

    expect(analysis.symbol).toBe(SYMBOL);
    expect(analysis.marketState.regime).toBe('BULLISH');
    expect(analysis.marketState.location).toBeTruthy();
    expect(analysis.thesis.type).toBe('BULLISH_CONTINUATION');
    expect(analysis.thesis.confidence).toBeGreaterThan(0.5);
    expect(analysis.scenarios.length).toBeGreaterThan(0);
    expect(analysis.dataQuality.mtfSynchronized).toBe(true);
    expect(['WAIT', 'READY', 'EXECUTE']).toContain(analysis.execution.state);
    expect(analysis.risk.maxRiskPercent).toBeGreaterThan(0);
    expect(analysis.risk.invalidation).toBeGreaterThanOrEqual(0);
    expect(analysis.currentPrice).toBeGreaterThan(0);

    // Key levels are split around the current price.
    for (const level of analysis.keyLevels.resistance) {
      expect(level.price).toBeGreaterThan(analysis.currentPrice);
    }
    for (const level of analysis.keyLevels.support) {
      expect(level.price).toBeLessThan(analysis.currentPrice);
    }
  });

  it('marks a timeframe without data as degraded in the analysis data quality', () => {
    const store = new KlineStore();
    populateTrending(store, '4h', 14_400_000, 40);
    populateTrending(store, '1h', 3_600_000, 60);
    populateTrending(store, '15m', 900_000, 80);
    populateTrending(store, '5m', 300_000, 80);
    // No 2h candles at all.

    const { analysisEngine } = buildStack(store);
    const analysis = analysisEngine.computeAnalysis(SYMBOL, END_TS);

    expect(analysis.dataQuality.mtfSynchronized).toBe(false);
    expect(analysis.dataQuality.degradedTimeframes).toContain('2h');
  });

  it('qualifies discovered setups with hierarchical score + grade and links a scenario', () => {
    const store = populateBullishStore();
    const { setupEngine } = buildStack(store);

    const qualified = setupEngine.getQualifiedSetupsAsOf(SYMBOL, END_TS);

    // The bullish zigzag must surface at least one candidate (FVG/OB/BOS all present).
    expect(qualified.length).toBeGreaterThan(0);

    for (const cand of qualified) {
      expect(cand.hierarchicalConfluence).toBeDefined();
      expect(cand.grade).toBeDefined();
      expect(cand.qualification).toBeDefined();
      // Hierarchical total is the sum of its factors.
      const sum = cand.hierarchicalConfluence!.factors.reduce((s, f) => s + f.awarded, 0);
      expect(cand.hierarchicalConfluence!.totalScore).toBe(sum);
    }

    const long = qualified.find((c) => c.direction === 'LONG');
    expect(long).toBeDefined();
    // Bullish thesis backs the LONG candidate → not rejected.
    expect(long!.qualification!.rejected).toBe(false);
    expect(long!.qualification!.thesisQualified).toBe(true);
    // A matching scenario was linked with an execution plan.
    expect(long!.scenarioId).toBeTruthy();
    expect(long!.executionPlan?.entryZone).toBeDefined();
    expect(long!.executionPlan?.stopZone?.price).toBeGreaterThan(0);
    expect((long!.executionPlan?.targetZones?.length ?? 0)).toBeGreaterThan(0);
  });

  it('rejects a LONG candidate when the thesis is RANGE (two-stage gating works)', () => {
    const store = new KlineStore();
    // Flat candles → no directional thesis → any discovered candidate must
    // fail the thesis gate instead of becoming tradeable.
    for (const [tf, ms, n] of [['4h', 14_400_000, 40], ['2h', 7_200_000, 40], ['1h', 3_600_000, 60], ['15m', 900_000, 80], ['5m', 300_000, 80]] as Array<[AnalysisTimeframe, number, number]>) {
      for (let i = 0; i < n; i++) {
        const openTime = END_TS - (n - i) * ms;
        store.upsertCandle({
          symbol: SYMBOL, interval: tf, openTime, closeTime: openTime + ms - 1,
          open: 100, high: 100.4, low: 99.6, close: 100, volume: 1000, isClosed: true,
        });
      }
    }

    const { setupEngine } = buildStack(store);
    const qualified = setupEngine.getQualifiedSetupsAsOf(SYMBOL, END_TS);

    for (const cand of qualified) {
      if (cand.direction === 'LONG' || cand.direction === 'SHORT') {
        expect(cand.qualification!.thesisQualified).toBe(false);
        expect(cand.qualification!.rejected).toBe(true);
        // Rejected candidates may never be READY.
        expect(cand.status).not.toBe('READY');
      }
    }
  });
});

describe('AdaptiveRiskManager — structural invalidation contract', () => {
  const candles: Candle[] = Array.from({ length: 50 }, (_, i) => ({
    symbol: SYMBOL,
    interval: '1h',
    openTime: END_TS - (50 - i) * 3_600_000,
    closeTime: END_TS - (50 - i) * 3_600_000 + 3_599_999,
    open: 100 + i * 0.1,
    high: 101 + i * 0.1,
    low: 99 + i * 0.1,
    close: 100.5 + i * 0.1,
    volume: 1000,
    isClosed: true,
  }));

  const adaptation: RegimeAdaptation = {
    regime: 'TRENDING_NORMAL',
    riskMultiplier: 1,
    stopAtrMultiplier: 1.75,
    targetAtrMultiplier: 4.5,
    minRR: 2,
    trailingActivationPct: 0.02,
    trailingDistancePct: 0.015,
    breakevenTriggerPct: 0.01,
    maxLeverage: 8,
    rationale: 'test',
  };

  function makeManager() {
    return new AdaptiveRiskManager({
      baseConfig: DEFAULT_RISK_CONFIG,
      getEquity: () => 10_000,
      getLastPrice: () => 105,
      getCandles: () => candles,
    });
  }

  it('uses the setup structural stop instead of the ATR-derived stop', () => {
    const manager = makeManager();
    const atrPlan = manager.computeTradePlan(SYMBOL, 'LONG', adaptation);
    const structuralPlan = manager.computeTradePlan(SYMBOL, 'LONG', adaptation, '1h', {
      stopPrice: 102.2,
      takeProfitPrice: 112,
      stopReason: 'Loss of the 15m demand confluence',
    });

    expect(atrPlan).not.toBeNull();
    expect(structuralPlan).not.toBeNull();
    expect(atrPlan!.structuralStopUsed).toBe(false);
    expect(structuralPlan!.structuralStopUsed).toBe(true);
    expect(structuralPlan!.stopLossPrice).toBeCloseTo(102.2, 6);
    expect(structuralPlan!.takeProfitPrice).toBeCloseTo(112, 6);
    expect(structuralPlan!.stopReason).toContain('demand confluence');
    // R:R reflects the structural distances, not the ATR table.
    expect(structuralPlan!.rr).toBeCloseTo(7 / 2.8, 5);
  });

  it('falls back to the ATR stop when the structural stop is degenerate', () => {
    const manager = makeManager();
    const plan = manager.computeTradePlan(SYMBOL, 'LONG', adaptation, '1h', {
      stopPrice: 104.99, // wrong side for a long
    });

    expect(plan).not.toBeNull();
    expect(plan!.structuralStopUsed).toBe(false);
  });
});
