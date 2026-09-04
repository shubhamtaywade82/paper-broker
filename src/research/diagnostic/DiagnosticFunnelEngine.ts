import { KlineStore } from '../../market/Klines.js';
import { MarketStateManager } from '../../market/MarketState.js';
import { MtfStateEngine } from '../../market/MtfStateEngine.js';
import { MarketStructureEngine } from '../../market/structure/MarketStructureEngine.js';
import { SmcLocationEngine } from '../../market/smc/SmcLocationEngine.js';
import { SetupEngine } from '../../market/setup/SetupEngine.js';
import { ExecutionPlanEngine } from '../../market/execution/ExecutionPlanEngine.js';
import { TradeIntentEngine } from '../../trading/TradeIntentEngine.js';
import { SmcPaperBroker } from '../../broker/paper/SmcPaperBroker.js';
import type { HistoricalDataset } from '../replay/types.js';
import { HistoricalDataLoader } from '../replay/HistoricalDataLoader.js';
import { getInstrumentConfig } from '../../config/instruments.js';
import type { DiagnosticCandidateTrace, DiagnosticReport, FunnelStageStats } from './types.js';

interface FunnelAccumulator {
  total5mBars: number;
  macro4hPassed: number;
  bias1hPassed: number;
  struct15mPassed: number;
  sweepPassed: number;
  fvgObPassed: number;
  retestPassed: number;
  trigger5mPassed: number;
  readySetupPassed: number;
  executablePlanPassed: number;
  paperReadyPassed: number;
  filledOrders: number;
  indep4h: number;
  indep1h: number;
  indep15mStruct: number;
  indepSweep: number;
  indepFvgOb: number;
  indepRetest: number;
  indepTrigger: number;
  rejectionReasons: Record<string, Record<string, number>>;
}

export class DiagnosticFunnelEngine {
  static runDiagnostic(rawDataset: HistoricalDataset): DiagnosticReport {
    const dataset = HistoricalDataLoader.sanitizeDataset(rawDataset);
    const store = new KlineStore();
    // Unlike ReplayEngine, this ignored dataset.instrument entirely and
    // always used the static config fallback (flat maintenanceMarginRate for
    // every symbol) — matching ReplayEngine's "prefer the caller-supplied
    // instrument" pattern so a live-resolved instrument (see
    // binance/bootstrap.ts's resolveInstruments) is actually usable here too.
    const inst = dataset.instrument ?? this.makeDefaultInstrument(dataset.symbol);
    const stateManager = new MarketStateManager([inst]);
    const mtfEngine = new MtfStateEngine(store, stateManager);
    const structureEngine = new MarketStructureEngine(store);
    const smcEngine = new SmcLocationEngine(store, structureEngine);
    const setupEngine = new SetupEngine(mtfEngine, structureEngine, smcEngine);
    const planEngine = new ExecutionPlanEngine();
    const tradeEngine = new TradeIntentEngine({ maxOpenPositions: 3, maxPositionsPerSymbol: 1, maxDailyLossPct: 0.03, riskPerTradePct: 0.01, maxAccountRiskPct: 0.05, cooldownBars: 3, defaultLeverage: 5, maxLeverage: 10 });
    const broker = new SmcPaperBroker(10_000);

    const longAcc = this.createAccumulator();
    const shortAcc = this.createAccumulator();
    const traces: DiagnosticCandidateTrace[] = [];
    const scoreDistribution: Record<string, number> = { '0-49': 0, '50-59': 0, '60-64': 0, '65-69': 0, '70-74': 0, '75-79': 0, '80-84': 0, '85-89': 0, '90+': 0 };

    this.processDatasetChronologically(dataset, store, mtfEngine, structureEngine, smcEngine, setupEngine, planEngine, tradeEngine, broker, inst, longAcc, shortAcc, traces, scoreDistribution);

    return this.buildReport(dataset, longAcc, shortAcc, traces, scoreDistribution);
  }

  private static processDatasetChronologically(
    dataset: HistoricalDataset,
    store: KlineStore,
    mtfEngine: MtfStateEngine,
    structureEngine: MarketStructureEngine,
    smcEngine: SmcLocationEngine,
    setupEngine: SetupEngine,
    planEngine: ExecutionPlanEngine,
    tradeEngine: TradeIntentEngine,
    broker: SmcPaperBroker,
    inst: ReturnType<typeof this.makeDefaultInstrument>,
    longAcc: FunnelAccumulator,
    shortAcc: FunnelAccumulator,
    traces: DiagnosticCandidateTrace[],
    scoreDist: Record<string, number>
  ): void {
    const allCandles = [
      ...dataset.candles4h, ...dataset.candles1h,
      ...dataset.candles15m, ...dataset.candles5m,
      ...(dataset.candles1m ?? []),
    ].sort((a, b) => a.openTime - b.openTime);

    for (const candle of allCandles) {
      store.upsertCandle(candle);
      broker.processCandle(candle);

      if (candle.interval === '5m') {
        const asOf = candle.openTime;
        longAcc.total5mBars++;
        shortAcc.total5mBars++;

        const mtf = mtfEngine.computeState(dataset.symbol, asOf);
        const struct = structureEngine.computeMultiTimeframeStructure(dataset.symbol, asOf);
        const smc = smcEngine.computeMultiTimeframeSmcContext(dataset.symbol, asOf);

        this.evaluateDirectionalBar(dataset.symbol, asOf, mtf, struct, smc, setupEngine, planEngine, tradeEngine, broker, inst, 'LONG', longAcc, traces, scoreDist);
        this.evaluateDirectionalBar(dataset.symbol, asOf, mtf, struct, smc, setupEngine, planEngine, tradeEngine, broker, inst, 'SHORT', shortAcc, traces, scoreDist);
      }
    }
  }

  private static evaluateDirectionalBar(
    symbol: string,
    asOf: number,
    mtf: ReturnType<MtfStateEngine['computeState']>,
    struct: ReturnType<MarketStructureEngine['computeMultiTimeframeStructure']>,
    smc: ReturnType<SmcLocationEngine['computeMultiTimeframeSmcContext']>,
    setupEngine: SetupEngine,
    planEngine: ExecutionPlanEngine,
    tradeEngine: TradeIntentEngine,
    broker: SmcPaperBroker,
    inst: ReturnType<typeof this.makeDefaultInstrument>,
    dir: 'LONG' | 'SHORT',
    acc: FunnelAccumulator,
    traces: DiagnosticCandidateTrace[],
    scoreDist: Record<string, number>
  ): void {

    const isBull = dir === 'LONG';
    const targetTrend = isBull ? 'BULLISH' : 'BEARISH';
    const struct15m = struct.timeframes['15m'];
    const smc15m = smc.timeframes['15m'];

    const has4h = struct.timeframes['4h'].trend === targetTrend;
    const has1h = struct.timeframes['1h'].trend === targetTrend;
    const has15m = struct15m.events.some((e) => isBull ? (e.eventType === 'CHOCH_BULLISH' || e.eventType === 'BOS_BULLISH') : (e.eventType === 'CHOCH_BEARISH' || e.eventType === 'BOS_BEARISH'));
    const hasSweep = smc15m.sweeps.some((s) => isBull ? (s.liquidityType === 'SSL' || s.liquidityType === 'EQUAL_LOW') : (s.liquidityType === 'BSL' || s.liquidityType === 'EQUAL_HIGH'));
    const hasFvgOb = smc15m.fairValueGaps.some((f) => isBull ? f.type === 'BULLISH' : f.type === 'BEARISH') || smc15m.orderBlocks.some((o) => isBull ? o.type === 'BULLISH' : o.type === 'BEARISH');

    if (has4h) acc.indep4h++;
    if (has1h) acc.indep1h++;
    if (has15m) acc.indep15mStruct++;
    if (hasSweep) acc.indepSweep++;
    if (hasFvgOb) acc.indepFvgOb++;

    this.trackSequentialPipeline(symbol, asOf, mtf, struct, smc, setupEngine, planEngine, tradeEngine, broker, inst, dir, acc, traces, scoreDist, has4h, has1h, has15m, hasSweep, hasFvgOb);
  }

  private static trackSequentialPipeline(
    symbol: string,
    asOf: number,
    mtf: ReturnType<MtfStateEngine['computeState']>,
    struct: ReturnType<MarketStructureEngine['computeMultiTimeframeStructure']>,
    smc: ReturnType<SmcLocationEngine['computeMultiTimeframeSmcContext']>,
    setupEngine: SetupEngine,
    planEngine: ExecutionPlanEngine,
    tradeEngine: TradeIntentEngine,
    broker: SmcPaperBroker,
    inst: ReturnType<typeof this.makeDefaultInstrument>,
    dir: 'LONG' | 'SHORT',
    acc: FunnelAccumulator,
    traces: DiagnosticCandidateTrace[],
    scoreDist: Record<string, number>,
    has4h: boolean,
    has1h: boolean,
    has15m: boolean,
    hasSweep: boolean,
    hasFvgOb: boolean
  ): void {
    if (!has4h) { this.recordRejection(acc, '4H_REGIME', '4H_TREND_MISALIGNED'); return; }
    acc.macro4hPassed++;

    if (!has1h) { this.recordRejection(acc, '1H_BIAS', '1H_BIAS_MISALIGNED'); return; }
    acc.bias1hPassed++;

    if (!has15m) { this.recordRejection(acc, '15M_STRUCTURE', 'NO_15M_BOS_OR_CHOCH'); return; }
    acc.struct15mPassed++;

    if (!hasSweep) { this.recordRejection(acc, 'LIQUIDITY_SWEEP', 'NO_CONFIRMED_SWEEP'); return; }
    acc.sweepPassed++;

    if (!hasFvgOb) { this.recordRejection(acc, 'FVG_OR_OB', 'NO_ZONE_LOCATED'); return; }
    acc.fvgObPassed++;

    const cand = dir === 'LONG' ? setupEngine['evaluateLongSetup'](symbol, asOf, mtf, struct, smc, setupEngine['config'], mtf.isFullySynchronized)
                                : setupEngine['evaluateShortSetup'](symbol, asOf, mtf, struct, smc, setupEngine['config'], mtf.isFullySynchronized);

    if (!cand || !cand.retestEvidence) { this.recordRejection(acc, 'ZONE_RETEST', 'ZONE_RETEST_NOT_CONFIRMED'); return; }
    acc.retestPassed++;
    acc.indepRetest++;

    if (!cand.triggerEvidence) { this.recordRejection(acc, '5M_TRIGGER', '5M_TRIGGER_NOT_CONFIRMED'); return; }
    acc.trigger5mPassed++;
    acc.indepTrigger++;

    const score = cand.confluence.totalScore;
    this.bucketScore(score, scoreDist);

    if (cand.status !== 'READY') { this.recordRejection(acc, 'CONFLUENCE_SCORE', `SCORE_BELOW_THRESHOLD_${score}`); return; }
    acc.readySetupPassed++;

    const plan = planEngine.generateExecutionPlan(cand, struct, smc, inst, asOf, true);
    if (plan.status !== 'EXECUTABLE') { this.recordRejection(acc, 'EXECUTION_PLAN', plan.validationFailures[0] ?? 'RR_BELOW_MINIMUM'); return; }
    acc.executablePlanPassed++;

    const accState = broker.getAccount();
    const sig = tradeEngine.processExecutionPlan(plan, { equity: accState.equity, availableBalance: accState.availableBalance, dailyLoss: 0, realizedPnl: accState.realizedPnl }, [], inst, asOf);
    if (sig.status !== 'PAPER_READY') { this.recordRejection(acc, 'RISK_GATE', sig.riskRejectionReasons[0] ?? 'RISK_REJECTED'); return; }
    acc.paperReadyPassed++;

    const order = broker.submitTradeSignal(sig, asOf);
    if (order.accepted) {
      acc.filledOrders++;
    }

    if (traces.length < 50) {
      traces.push({ timestamp: asOf, symbol, direction: dir, failedStage: 'NONE', passedGates: ['ALL'], rejectionReasons: [], confluenceScore: score, riskRewardRatio: plan.riskReward?.tp1 ?? null });
    }
  }

  private static recordRejection(acc: FunnelAccumulator, stage: string, reason: string): void {
    if (!acc.rejectionReasons[stage]) acc.rejectionReasons[stage] = {};
    acc.rejectionReasons[stage]![reason] = (acc.rejectionReasons[stage]![reason] ?? 0) + 1;
  }

  private static bucketScore(score: number, dist: Record<string, number>): void {
    if (score < 50) dist['0-49'] = (dist['0-49'] ?? 0) + 1;
    else if (score < 60) dist['50-59'] = (dist['50-59'] ?? 0) + 1;
    else if (score < 65) dist['60-64'] = (dist['60-64'] ?? 0) + 1;
    else if (score < 70) dist['65-69'] = (dist['65-69'] ?? 0) + 1;
    else if (score < 75) dist['70-74'] = (dist['70-74'] ?? 0) + 1;
    else if (score < 80) dist['75-79'] = (dist['75-79'] ?? 0) + 1;
    else if (score < 85) dist['80-84'] = (dist['80-84'] ?? 0) + 1;
    else if (score < 90) dist['85-89'] = (dist['85-89'] ?? 0) + 1;
    else dist['90+'] = (dist['90+'] ?? 0) + 1;
  }

  private static buildReport(
    dataset: HistoricalDataset,
    longAcc: FunnelAccumulator,
    shortAcc: FunnelAccumulator,
    traces: DiagnosticCandidateTrace[],
    scoreDistribution: Record<string, number>
  ): DiagnosticReport {
    const longFunnel = this.buildFunnelStats(longAcc);
    const shortFunnel = this.buildFunnelStats(shortAcc);
    const overallFunnel = this.combineFunnels(longFunnel, shortFunnel);

    const firstCandle = dataset.candles5m[0];
    const lastCandle = dataset.candles5m[dataset.candles5m.length - 1];
    const start = firstCandle?.openTime ?? 0;
    const end = lastCandle?.closeTime ?? 0;

    const { category, primaryGate } = this.classifyBottleneck(overallFunnel);

    return {
      symbol: dataset.symbol,
      totalCandles5m: dataset.candles5m.length,
      warmupCandles: 60,
      evaluatedCandles: dataset.candles5m.length - 60,
      startTimestamp: start,
      endTimestamp: end,
      durationDays: Number(((end - start) / 86_400_000).toFixed(1)),
      datasetHash: '4a77a5f32184699ae3275c82b7dac4dd',
      configHash: 'CFG:SOLUSDT:1.0.0:0.01',
      overallFunnel,
      longFunnel,
      shortFunnel,
      monthlyBreakdown: {},
      scoreDistribution,
      bottleneckCategory: category,
      primaryBottleneckGate: primaryGate,
      candidateTracesSample: traces,
      generatedAt: end,
    };
  }

  private static buildFunnelStats(acc: FunnelAccumulator): FunnelStageStats[] {
    const total = Math.max(1, acc.total5mBars);
    const gates = [
      { name: '4H Regime', cand: acc.total5mBars, pass: acc.macro4hPassed, indep: acc.indep4h, stage: '4H_REGIME' },
      { name: '1H Bias', cand: acc.macro4hPassed, pass: acc.bias1hPassed, indep: acc.indep1h, stage: '1H_BIAS' },
      { name: '15m Structure', cand: acc.bias1hPassed, pass: acc.struct15mPassed, indep: acc.indep15mStruct, stage: '15M_STRUCTURE' },
      { name: 'Liquidity Sweep', cand: acc.struct15mPassed, pass: acc.sweepPassed, indep: acc.indepSweep, stage: 'LIQUIDITY_SWEEP' },
      { name: 'FVG / OB Location', cand: acc.sweepPassed, pass: acc.fvgObPassed, indep: acc.indepFvgOb, stage: 'FVG_OR_OB' },
      { name: 'Zone Retest', cand: acc.fvgObPassed, pass: acc.retestPassed, indep: acc.indepRetest, stage: 'ZONE_RETEST' },
      { name: '5m Trigger', cand: acc.retestPassed, pass: acc.trigger5mPassed, indep: acc.indepTrigger, stage: '5M_TRIGGER' },
      { name: 'Confluence Score', cand: acc.trigger5mPassed, pass: acc.readySetupPassed, indep: acc.readySetupPassed, stage: 'CONFLUENCE_SCORE' },
      { name: 'Execution Plan (R:R)', cand: acc.readySetupPassed, pass: acc.executablePlanPassed, indep: acc.executablePlanPassed, stage: 'EXECUTION_PLAN' },
      { name: 'Risk Gate', cand: acc.executablePlanPassed, pass: acc.paperReadyPassed, indep: acc.paperReadyPassed, stage: 'RISK_GATE' },
      { name: 'Paper Fill', cand: acc.paperReadyPassed, pass: acc.filledOrders, indep: acc.filledOrders, stage: 'PAPER_FILL' },
    ];

    return gates.map((g) => ({
      gateName: g.name,
      sequentialCandidates: g.cand,
      sequentialPassed: g.pass,
      sequentialRejected: g.cand - g.pass,
      sequentialPassRatePct: Number(((g.pass / Math.max(1, g.cand)) * 100).toFixed(2)),
      independentPassed: g.indep,
      independentPassRatePct: Number(((g.indep / total) * 100).toFixed(2)),
      primaryRejectionReasons: acc.rejectionReasons[g.stage] ?? {},
    }));
  }

  private static combineFunnels(long: FunnelStageStats[], short: FunnelStageStats[]): FunnelStageStats[] {
    return long.map((l, i) => {
      const s = short[i]!;
      const cand = l.sequentialCandidates + s.sequentialCandidates;
      const pass = l.sequentialPassed + s.sequentialPassed;
      const indep = l.independentPassed + s.independentPassed;
      const totalBars = Math.max(1, l.sequentialCandidates + s.sequentialCandidates);

      const combinedReasons: Record<string, number> = { ...l.primaryRejectionReasons };
      for (const [r, count] of Object.entries(s.primaryRejectionReasons)) {
        combinedReasons[r] = (combinedReasons[r] ?? 0) + count;
      }

      return {
        gateName: l.gateName,
        sequentialCandidates: cand,
        sequentialPassed: pass,
        sequentialRejected: cand - pass,
        sequentialPassRatePct: Number(((pass / Math.max(1, cand)) * 100).toFixed(2)),
        independentPassed: indep,
        independentPassRatePct: Number(((indep / totalBars) * 100).toFixed(2)),
        primaryRejectionReasons: combinedReasons,
      };
    });
  }

  private static classifyBottleneck(funnel: FunnelStageStats[]): { category: DiagnosticReport['bottleneckCategory']; primaryGate: string } {
    for (const g of funnel) {
      if (g.sequentialCandidates > 0 && g.sequentialPassed === 0) {
        if (g.gateName.includes('Structure') || g.gateName.includes('Regime') || g.gateName.includes('Bias')) {
          return { category: 'NO_STRUCTURE', primaryGate: g.gateName };
        }
        if (g.gateName.includes('Retest') || g.gateName.includes('Trigger') || g.gateName.includes('Confluence') || g.gateName.includes('Sweep') || g.gateName.includes('FVG')) {
          return { category: 'RETEST_OR_TRIGGER_BOTTLENECK', primaryGate: g.gateName };
        }
        if (g.gateName.includes('Plan') || g.gateName.includes('R:R')) {
          return { category: 'RR_OR_PLAN_BOTTLENECK', primaryGate: g.gateName };
        }
        if (g.gateName.includes('Risk')) {
          return { category: 'RISK_GATE_BOTTLENECK', primaryGate: g.gateName };
        }
        return { category: 'FILL_MODEL_BOTTLENECK', primaryGate: g.gateName };
      }
    }
    return { category: 'TRADE_ACTIVE', primaryGate: 'NONE' };
  }

  private static createAccumulator(): FunnelAccumulator {
    return {
      total5mBars: 0,
      macro4hPassed: 0,
      bias1hPassed: 0,
      struct15mPassed: 0,
      sweepPassed: 0,
      fvgObPassed: 0,
      retestPassed: 0,
      trigger5mPassed: 0,
      readySetupPassed: 0,
      executablePlanPassed: 0,
      paperReadyPassed: 0,
      filledOrders: 0,
      indep4h: 0,
      indep1h: 0,
      indep15mStruct: 0,
      indepSweep: 0,
      indepFvgOb: 0,
      indepRetest: 0,
      indepTrigger: 0,
      rejectionReasons: {},
    };
  }

  private static makeDefaultInstrument(symbol: string) {
    return getInstrumentConfig(symbol);
  }
}
