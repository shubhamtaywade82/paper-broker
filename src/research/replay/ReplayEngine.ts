import { KlineStore } from '../../market/Klines.js';
import { MarketStateManager } from '../../market/MarketState.js';
import { MtfStateEngine } from '../../market/MtfStateEngine.js';
import { MarketStructureEngine } from '../../market/structure/MarketStructureEngine.js';
import { SmcLocationEngine } from '../../market/smc/SmcLocationEngine.js';
import { SetupEngine } from '../../market/setup/SetupEngine.js';
import { ExecutionPlanEngine } from '../../market/execution/ExecutionPlanEngine.js';
import { TradeIntentEngine } from '../../trading/TradeIntentEngine.js';
import { SmcPaperBroker } from '../../broker/paper/SmcPaperBroker.js';
import { DEFAULT_EXECUTION_PLAN_CONFIG } from '../../market/execution/RiskRewardCalculator.js';
import type { TradeSignal } from '../../trading/signal/types.js';
import { PerformanceAnalyzer } from '../analytics/PerformanceAnalyzer.js';
import { ArchetypeBreakdown } from '../analytics/ArchetypeBreakdown.js';
import { ConfluenceScoreValidator } from '../analytics/ConfluenceScoreValidator.js';
import { RegimeAnalyzer } from '../analytics/RegimeAnalyzer.js';
import { MonteCarloSimulator } from '../analytics/MonteCarloSimulator.js';
import { StatisticalValidationEngine } from '../analytics/StatisticalValidationEngine.js';
import { HistoricalDataLoader } from './HistoricalDataLoader.js';
import { DEFAULT_SETUP_CONFIG } from '../../market/setup/ConfluenceScorer.js';
import type { BacktestReport, HistoricalDataset, ReplayConfig } from './types.js';

export class ReplayEngine {
  static runBacktest(rawDataset: HistoricalDataset, config: ReplayConfig): BacktestReport {
    const dataset = HistoricalDataLoader.sanitizeDataset(rawDataset);
    const store = new KlineStore(10000);
    const inst = dataset.instrument ?? this.makeDefaultInstrument(dataset.symbol);
    const stateManager = new MarketStateManager([inst]);

    const mtfEngine = new MtfStateEngine(store, stateManager);
    const structureEngine = new MarketStructureEngine(store);
    const smcEngine = new SmcLocationEngine(store, structureEngine);
    const setupConfig = config.minConfluenceScore != null
      ? { ...DEFAULT_SETUP_CONFIG, minConfluenceScore: config.minConfluenceScore }
      : DEFAULT_SETUP_CONFIG;
    const setupEngine = new SetupEngine(mtfEngine, structureEngine, smcEngine, setupConfig);
    const planEngine = new ExecutionPlanEngine({ ...DEFAULT_EXECUTION_PLAN_CONFIG, ...config.executionConfig });
    const tradeEngine = new TradeIntentEngine({
      maxOpenPositions: config.maxOpenPositions,
      maxPositionsPerSymbol: 1,
      maxDailyLossPct: config.maxDailyLossPct,
      riskPerTradePct: config.riskPerTradePct,
      maxAccountRiskPct: 0.05,
      cooldownBars: 3,
      defaultLeverage: config.defaultLeverage,
      maxLeverage: 10,
    });
    const broker = new SmcPaperBroker(config.initialEquity, config.paperBrokerConfig);
    const signalsMap = new Map<string, TradeSignal>();

    this.replayChronological(dataset, store, setupEngine, structureEngine, smcEngine, planEngine, tradeEngine, broker, signalsMap, inst);
    return this.buildReport(dataset, config, broker, signalsMap);
  }

  private static replayChronological(
    dataset: HistoricalDataset,
    store: KlineStore,
    setupEngine: SetupEngine,
    structureEngine: MarketStructureEngine,
    smcEngine: SmcLocationEngine,
    planEngine: ExecutionPlanEngine,
    tradeEngine: TradeIntentEngine,
    broker: SmcPaperBroker,
    signalsMap: Map<string, TradeSignal>,
    inst: ReturnType<typeof this.makeDefaultInstrument>
  ): void {
    const allCandles = [...dataset.candles4h, ...dataset.candles1h, ...dataset.candles15m, ...dataset.candles5m]
      .sort((a, b) => a.openTime - b.openTime);

    for (const candle of allCandles) {
      store.upsertCandle(candle);
      broker.processCandle(candle);

      if (candle.interval === '5m') {
        const setups = setupEngine.getReadySetups(dataset.symbol, candle.openTime);
        const struct = structureEngine.computeMultiTimeframeStructure(dataset.symbol, candle.openTime);
        const smcCtx = smcEngine.computeMultiTimeframeSmcContext(dataset.symbol, candle.openTime);

        for (const cand of setups) {
          const plan = planEngine.generateExecutionPlan(cand, struct, smcCtx, inst, candle.openTime, true);
          if (plan.status === 'EXECUTABLE') {
            const acc = broker.getAccount();
            const sig = tradeEngine.processExecutionPlan(plan, { equity: acc.equity, availableBalance: acc.availableBalance, dailyLoss: 0, realizedPnl: acc.realizedPnl }, [], inst, candle.openTime);
            if (sig.status === 'PAPER_READY') {
              signalsMap.set(sig.id, sig);
              broker.submitTradeSignal(sig, candle.openTime);
            }
          }
        }
      }
    }
  }

  private static buildReport(
    dataset: HistoricalDataset,
    config: ReplayConfig,
    broker: SmcPaperBroker,
    signalsMap: Map<string, TradeSignal>
  ): BacktestReport {
    const trades = broker.getLedger();
    const coreMetrics = PerformanceAnalyzer.analyzeTrades(trades);
    const archetypeBreakdown = ArchetypeBreakdown.evaluateArchetypes(trades);
    const scoreBucketValidation = ConfluenceScoreValidator.validateScoreBuckets(trades, signalsMap);
    const regimePerformance = RegimeAnalyzer.evaluateRegimes(trades);
    const monteCarlo = MonteCarloSimulator.runSimulation(trades, config.initialEquity, 1000);
    const statisticalValidation = StatisticalValidationEngine.validateTrades(trades);

    const acc = broker.getAccount();
    const totalNetPnl = coreMetrics.netPnL;
    const totalReturnPct = Number(((totalNetPnl / config.initialEquity) * 100).toFixed(2));
    const durationDays = Number(((config.endTime - config.startTime) / (86_400_000)).toFixed(1));
    const configHash = `CFG:${config.symbol}:${config.strategyVersion}:${config.riskPerTradePct}`;

    return {
      id: `RUN:${dataset.symbol}:${config.startTime}`,
      symbol: dataset.symbol,
      configHash,
      startTime: config.startTime,
      endTime: config.endTime,
      durationDays: Math.max(1, durationDays),
      initialEquity: config.initialEquity,
      finalEquity: acc.equity,
      totalNetPnl,
      totalReturnPct,
      coreMetrics,
      archetypeBreakdown,
      scoreBucketValidation,
      regimePerformance,
      monteCarlo,
      statisticalValidation,
      trades,
      generatedAt: config.endTime,
    };
  }

  private static makeDefaultInstrument(symbol: string) {
    return {
      symbol,
      baseAsset: 'SOL',
      quoteAsset: 'USDT',
      contractType: 'PERPETUAL',
      status: 'TRADING',
      tickSize: '0.01',
      stepSize: '0.001',
      minQty: '0.001',
      minNotional: '5.0',
      pricePrecision: 2,
      quantityPrecision: 3,
      maintenanceMarginRate: '0.005',
      createdAtUtc: new Date().toISOString(),
      updatedAtUtc: new Date().toISOString(),
    };
  }
}
