import type { MtfStateEngine } from '../MtfStateEngine.js';
import type { MarketStructureEngine } from '../structure/MarketStructureEngine.js';
import type { SmcLocationEngine } from '../smc/SmcLocationEngine.js';
import type { SetupCandidate, SetupConfig, SetupQualification } from './types.js';
import { DEFAULT_SETUP_CONFIG } from './ConfluenceScorer.js';
import { SetupStateMachine } from './SetupStateMachine.js';
import type { MarketContextEngine } from '../../analysis/MarketContextEngine.js';
import type { ThesisEngine } from '../../analysis/ThesisEngine.js';
import type { ScenarioEngine } from '../../analysis/ScenarioEngine.js';
import type { HierarchicalConfluenceScorer } from '../../analysis/HierarchicalConfluenceScorer.js';
import type { MarketContext, Thesis, TradeScenario } from '../../analysis/types.js';

/**
 * Optional market-intelligence dependencies. When present, SetupEngine runs
 * its TWO-STAGE pipeline (discovery → qualification); when absent, it keeps
 * the legacy discovery-only behaviour so existing callers/tests are unchanged.
 */
export interface SetupEngineIntelligence {
  contextEngine: MarketContextEngine;
  thesisEngine: ThesisEngine;
  scenarioEngine: ScenarioEngine;
  confluenceScorer: HierarchicalConfluenceScorer;
  /** Minimum hierarchical score for a candidate to survive qualification. */
  minHierarchicalScore: number;
}

export class SetupEngine {
  private mtfEngine: MtfStateEngine;
  private structureEngine: MarketStructureEngine;
  private smcEngine: SmcLocationEngine;
  private config: SetupConfig;
  private intelligence?: SetupEngineIntelligence;

  constructor(
    mtfEngine: MtfStateEngine,
    structureEngine: MarketStructureEngine,
    smcEngine: SmcLocationEngine,
    config: SetupConfig = DEFAULT_SETUP_CONFIG,
    intelligence?: SetupEngineIntelligence
  ) {
    this.mtfEngine = mtfEngine;
    this.structureEngine = structureEngine;
    this.smcEngine = smcEngine;
    this.config = config;
    this.intelligence = intelligence;
  }

  /**
   * Attach the market-intelligence layer after construction. Exists because
   * the intelligence stack needs the regime detector, which in engine.ts is
   * constructed after the setup engine (the agent block ordering).
   */
  setIntelligence(intelligence: SetupEngineIntelligence): void {
    this.intelligence = intelligence;
  }

  /**
   * STAGE 1 — Candidate discovery (permissive, OR-based). Any interesting
   * evidence (sweep / CHoCH / BOS / FVG / OB) creates a candidate. This is
   * kept exactly as-is for backward compatibility with every existing caller.
   */
  getSetupsAsOf(symbol: string, asOfTimestamp = Date.now(), config = this.config): SetupCandidate[] {
    const mtf = this.mtfEngine.computeState(symbol, asOfTimestamp);
    const struct = this.structureEngine.computeMultiTimeframeStructure(symbol, asOfTimestamp);
    const smc = this.smcEngine.computeMultiTimeframeSmcContext(symbol, asOfTimestamp);

    const isDataHealthy = mtf.isFullySynchronized;
    const candidates: SetupCandidate[] = [];

    const longCand = this.evaluateLongSetup(symbol, asOfTimestamp, mtf, struct, smc, config, isDataHealthy);
    if (longCand) candidates.push(longCand);

    const shortCand = this.evaluateShortSetup(symbol, asOfTimestamp, mtf, struct, smc, config, isDataHealthy);
    if (shortCand) candidates.push(shortCand);

    return candidates;
  }

  /**
   * STAGE 2 — Qualification. Discovery candidates are scored with the
   * hierarchical confluence model, gated on context + thesis, attached to
   * their matching scenario's execution plan, and advanced through the
   * CANONICAL state progression (APPROACHING / AT_ZONE / ...).
   *
   * Requires the intelligence dependency; falls back to discovery-only when
   * it wasn't wired.
   */
  getQualifiedSetupsAsOf(symbol: string, asOfTimestamp = Date.now()): SetupCandidate[] {
    const candidates = this.getSetupsAsOf(symbol, asOfTimestamp);
    if (!this.intelligence || candidates.length === 0) return candidates;

    const { contextEngine, thesisEngine, scenarioEngine, confluenceScorer, minHierarchicalScore } = this.intelligence;

    const context: MarketContext = contextEngine.computeContext(symbol, asOfTimestamp);
    const thesis: Thesis = thesisEngine.deriveThesis(context);
    const scenarios: TradeScenario[] = scenarioEngine.generateScenarios(context, thesis);

    const qualified: SetupCandidate[] = [];

    for (const cand of candidates) {
      if (cand.direction !== 'LONG' && cand.direction !== 'SHORT') continue;

      // --- Scenario linkage + execution plan ------------------------------
      const matching = scenarios.filter(
        (s) =>
          s.direction === cand.direction &&
          s.type !== 'NO_TRADE'
      );
      const scenario = matching.sort((a, b) => b.alignment - a.alignment)[0];

      const executionPlan = scenario?.entry
        ? {
            entryZone: scenario.entry.zone,
            stopZone: {
              price: scenario.invalidation,
              reason: scenario.invalidationReason,
            },
            targetZones: scenario.targets.map((t, i) => ({ level: i + 1, price: t.price })),
            riskRewardRatio: scenario.rr,
          }
        : undefined;

      // Hierarchical confluence (evidence-quality model), scored with the
      // concrete R:R from the linked scenario's execution plan.
      const withRr = confluenceScorer.score({
        direction: cand.direction,
        context,
        thesis,
        sweep: cand.sweepEvidence
          ? { liquidityType: cand.sweepEvidence.liquidityType, timeframe: cand.sweepEvidence.timeframe }
          : null,
        hasDirectionalZone: Boolean(cand.fvgEvidence || cand.orderBlockEvidence),
        rr: executionPlan?.riskRewardRatio,
        hasTrigger: Boolean(cand.triggerEvidence),
      });

      // --- Qualification gates ---------------------------------------------
      const qualification = this.qualify(cand, context, thesis, withRr.totalScore, minHierarchicalScore);

      // --- Canonical state progression with live price ---------------------
      const market = {
        currentPrice: context.currentPrice,
        entryZone: executionPlan?.entryZone ?? null,
        atr: Number.isFinite(context.volatility.atr1h) ? context.volatility.atr1h : undefined,
      };

      const advanced = SetupStateMachine.advanceState(
        {
          ...cand,
          timeframes: {
            ...cand.timeframes,
            structure2h: context.timeframes['2h']?.trend ?? cand.timeframes.structure2h,
          },
          hierarchicalConfluence: withRr,
          grade: withRr.grade,
          qualification,
          scenarioId: scenario?.id,
          executionPlan: executionPlan ?? cand.executionPlan,
        },
        asOfTimestamp,
        this.config,
        true,
        market
      );

      // Rejected candidates stay visible for the dashboard but can never
      // become READY — downgrade any READY the advance produced.
      if (qualification.rejected && advanced.status === 'READY') {
        qualified.push({
          ...advanced,
          status: 'ACTIVE',
          state: 'WATCHING',
          invalidationReason: qualification.rejectionReasons.join('; ') || 'Failed qualification',
        });
        continue;
      }

      qualified.push(advanced);
    }

    return qualified.sort((a, b) => {
      const sa = a.hierarchicalConfluence?.totalScore ?? a.confluence.totalScore;
      const sb = b.hierarchicalConfluence?.totalScore ?? b.confluence.totalScore;
      return sb - sa;
    });
  }

  /**
   * The two-stage gate: FVG alone can create a candidate, but it only
   * becomes a trade when context, thesis, and (for READY) trigger all agree.
   */
  private qualify(
    cand: SetupCandidate,
    context: MarketContext,
    thesis: Thesis,
    hierarchicalScore: number,
    minHierarchicalScore: number
  ): SetupQualification {
    const reasons: string[] = [];

    // Context gate: stand aside in churn / chaos.
    const continuation = cand.setupType.includes('CONTINUATION');
    const regimeOk =
      context.regime.primary !== 'TRANSITION' || !continuation;
    const volatilityOk = context.volatility.label !== 'EXTREME';
    const contextQualified = regimeOk && volatilityOk;
    if (!regimeOk) reasons.push(`Regime TRANSITION does not support ${cand.setupType}`);
    if (!volatilityOk) reasons.push(`Volatility EXTREME (${context.volatility.atrPct}% ATR)`);

    // Thesis gate: the directional thesis must back the candidate.
    const bullish = cand.direction === 'LONG';
    const thesisOk =
      (bullish && (thesis.type === 'BULLISH_CONTINUATION' || thesis.type === 'BULLISH_REVERSAL')) ||
      (!bullish && (thesis.type === 'BEARISH_CONTINUATION' || thesis.type === 'BEARISH_REVERSAL'));
    if (!thesisOk) reasons.push(`Thesis ${thesis.type} does not back ${cand.direction}`);

    // Trigger gate: pending trigger keeps the candidate watching, not rejected.
    const triggerQualified = Boolean(cand.triggerEvidence);

    // Hierarchical score gate.
    if (hierarchicalScore < minHierarchicalScore) {
      reasons.push(`Hierarchical score ${hierarchicalScore} < ${minHierarchicalScore}`);
    }

    return {
      contextQualified,
      thesisQualified: thesisOk,
      triggerQualified,
      rejected: reasons.length > 0,
      rejectionReasons: reasons,
    };
  }

  getActiveSetups(symbol: string, asOfTimestamp = Date.now()): SetupCandidate[] {
    return this.getSetupsAsOf(symbol, asOfTimestamp).filter((s) => s.status === 'ACTIVE');
  }

  getReadySetups(symbol: string, asOfTimestamp = Date.now()): SetupCandidate[] {
    return this.getSetupsAsOf(symbol, asOfTimestamp).filter((s) => s.status === 'READY');
  }

  private evaluateLongSetup(
    symbol: string,
    asOf: number,
    mtf: ReturnType<MtfStateEngine['computeState']>,
    struct: ReturnType<MarketStructureEngine['computeMultiTimeframeStructure']>,
    smc: ReturnType<SmcLocationEngine['computeMultiTimeframeSmcContext']>,
    config: SetupConfig,
    isDataHealthy: boolean
  ): SetupCandidate | null {
    const struct15m = struct.timeframes['15m'];
    const smc15m = smc.timeframes['15m'];
    const smc5m = smc.timeframes['5m'];

    const sslSweep = smc15m.sweeps.find((s) => s.liquidityType === 'SSL' || s.liquidityType === 'EQUAL_LOW');
    const bullChoch = struct15m.events.find((e) => e.eventType === 'CHOCH_BULLISH');
    const bullBos = struct15m.events.find((e) => e.eventType === 'BOS_BULLISH');
    const bullFvg = smc15m.fairValueGaps.find((f) => f.type === 'BULLISH');
    const bullOb = smc15m.orderBlocks.find((o) => o.type === 'BULLISH');

    if (!sslSweep && !bullChoch && !bullBos && !bullFvg && !bullOb) return null;

    // Determine setup archetype: BOS = trend continuation, CHoCH = reversal.
    // A sweep with any structural break (BOS or CHoCH) is the strongest
    // reversal signal. A CHoCH without sweep is also a reversal entry.
    // A BOS without sweep is a continuation entry.
    let setupType: SetupCandidate['setupType'];
    if (sslSweep && (bullChoch || bullBos)) {
      setupType = 'SSL_SWEEP_REVERSAL_LONG';
    } else if (bullChoch) {
      setupType = 'BULLISH_CHOCH_RETEST_LONG';
    } else if (bullBos) {
      setupType = 'BULLISH_BOS_CONTINUATION_LONG';
    } else {
      // FVG or OB only, no structural event
      setupType = 'BULLISH_CHOCH_RETEST_LONG';
    }

    const ttlMs = config.maxCandleAgeBars * 900_000;
    const initial = SetupStateMachine.createWatchingCandidate({
      id: `${symbol}:LONG:${asOf}`,
      symbol,
      direction: 'LONG',
      setupType,
      timeframes: {
        regime4h: struct.timeframes['4h'].trend,
        structure2h: struct.timeframes['2h']?.trend,
        bias1h: struct.timeframes['1h'].trend,
        structure15m: struct15m.trend,
        trigger5m: struct.timeframes['5m'].trend,
      },
      sweepEvidence: sslSweep,
      structureEvidence: bullChoch ?? bullBos,
      fvgEvidence: bullFvg,
      orderBlockEvidence: bullOb,
      retestEvidence: bullFvg?.status === 'MITIGATED' || bullFvg?.status === 'PARTIALLY_FILLED' || bullOb?.status === 'MITIGATED'
        ? { retestCandleTime: asOf, retestPrice: bullFvg?.lowerPrice ?? bullOb?.upperPrice ?? 0 }
        : undefined,
      triggerEvidence: struct.timeframes['5m'].trend === 'BULLISH' || smc5m.sweeps.length > 0
        ? { triggerCandleTime: asOf, triggerType: '5M_CONFIRMATION' }
        : undefined,
      sourceCandleTimes: [asOf],
      sourceEventIds: [bullChoch?.id, bullBos?.id, sslSweep?.id, bullFvg?.id, bullOb?.id].filter(Boolean) as string[],
    }, asOf, ttlMs);

    return SetupStateMachine.advanceState(initial, asOf, config, isDataHealthy);
  }

  private evaluateShortSetup(
    symbol: string,
    asOf: number,
    mtf: ReturnType<MtfStateEngine['computeState']>,
    struct: ReturnType<MarketStructureEngine['computeMultiTimeframeStructure']>,
    smc: ReturnType<SmcLocationEngine['computeMultiTimeframeSmcContext']>,
    config: SetupConfig,
    isDataHealthy: boolean
  ): SetupCandidate | null {
    const struct15m = struct.timeframes['15m'];
    const smc15m = smc.timeframes['15m'];
    const smc5m = smc.timeframes['5m'];

    const bslSweep = smc15m.sweeps.find((s) => s.liquidityType === 'BSL' || s.liquidityType === 'EQUAL_HIGH');
    const bearChoch = struct15m.events.find((e) => e.eventType === 'CHOCH_BEARISH');
    const bearBos = struct15m.events.find((e) => e.eventType === 'BOS_BEARISH');
    const bearFvg = smc15m.fairValueGaps.find((f) => f.type === 'BEARISH');
    const bearOb = smc15m.orderBlocks.find((o) => o.type === 'BEARISH');

    if (!bslSweep && !bearChoch && !bearBos && !bearFvg && !bearOb) return null;

    // Determine setup archetype: BOS = trend continuation, CHoCH = reversal.
    // A sweep with any structural break (BOS or CHoCH) is the strongest
    // reversal signal. A CHoCH without sweep is also a reversal entry.
    // A BOS without sweep is a continuation entry.
    let setupType: SetupCandidate['setupType'];
    if (bslSweep && (bearChoch || bearBos)) {
      setupType = 'BSL_SWEEP_REVERSAL_SHORT';
    } else if (bearChoch) {
      setupType = 'BEARISH_CHOCH_RETEST_SHORT';
    } else if (bearBos) {
      setupType = 'BEARISH_BOS_CONTINUATION_SHORT';
    } else {
      setupType = 'BEARISH_CHOCH_RETEST_SHORT';
    }

    const ttlMs = config.maxCandleAgeBars * 900_000;
    const initial = SetupStateMachine.createWatchingCandidate({
      id: `${symbol}:SHORT:${asOf}`,
      symbol,
      direction: 'SHORT',
      setupType,
      timeframes: {
        regime4h: struct.timeframes['4h'].trend,
        structure2h: struct.timeframes['2h']?.trend,
        bias1h: struct.timeframes['1h'].trend,
        structure15m: struct15m.trend,
        trigger5m: struct.timeframes['5m'].trend,
      },
      sweepEvidence: bslSweep,
      structureEvidence: bearChoch ?? bearBos,
      fvgEvidence: bearFvg,
      orderBlockEvidence: bearOb,
      retestEvidence: bearFvg?.status === 'MITIGATED' || bearFvg?.status === 'PARTIALLY_FILLED' || bearOb?.status === 'MITIGATED'
        ? { retestCandleTime: asOf, retestPrice: bearFvg?.upperPrice ?? bearOb?.lowerPrice ?? 0 }
        : undefined,
      triggerEvidence: struct.timeframes['5m'].trend === 'BEARISH' || smc5m.sweeps.length > 0
        ? { triggerCandleTime: asOf, triggerType: '5M_CONFIRMATION' }
        : undefined,
      sourceCandleTimes: [asOf],
      sourceEventIds: [bearChoch?.id, bearBos?.id, bslSweep?.id, bearFvg?.id, bearOb?.id].filter(Boolean) as string[],
    }, asOf, ttlMs);

    return SetupStateMachine.advanceState(initial, asOf, config, isDataHealthy);
  }
}

// Re-export for consumers that want the qualification type via the engine.
export type { SetupQualification };
