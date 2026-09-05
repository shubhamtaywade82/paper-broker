import { MIN_CLOSED_CANDLES, type AnalysisTimeframe } from '../market/MtfStateEngine.js';
import type { MarketContextEngine } from './MarketContextEngine.js';
import type { ThesisEngine } from './ThesisEngine.js';
import type { ScenarioEngine } from './ScenarioEngine.js';
import type { SetupEngine } from '../market/setup/SetupEngine.js';
import type {
  MarketAnalysis,
  MarketContext,
  PriceLevel,
  Thesis,
  TradeScenario,
} from './types.js';

export interface MarketAnalysisEngineDeps {
  contextEngine: MarketContextEngine;
  thesisEngine: ThesisEngine;
  scenarioEngine: ScenarioEngine;
  /** Optional qualified-setup source for the execution state. */
  setupEngine?: SetupEngine;
  /** Base risk-per-trade fraction used in the envelope (0.005 = 0.5%). */
  baseRiskPerTradePct?: number;
}

/**
 * Market Analysis Engine — the final assembly point.
 *
 * Produces the `MarketAnalysis` object: the machine-readable equivalent of a
 * full discretionary chart read (regime, per-TF narrative, bias, key levels,
 * thesis, ranked scenarios, execution state, risk envelope). This is the
 * object the agent, the dashboard and the LLM synthesis layer all consume —
 * deterministic engines calculate, the LLM (when enabled) only explains,
 * ranks and narrates over these structured facts.
 */
export class MarketAnalysisEngine {
  private deps: MarketAnalysisEngineDeps;

  constructor(deps: MarketAnalysisEngineDeps) {
    this.deps = deps;
  }

  computeAnalysis(symbol: string, asOf = Date.now()): MarketAnalysis {
    const context = this.deps.contextEngine.computeContext(symbol, asOf);
    const thesis = this.deps.thesisEngine.deriveThesis(context);
    const scenarios = this.deps.scenarioEngine.generateScenarios(context, thesis);
    const preferred = this.deps.scenarioEngine.pickPreferred(scenarios, thesis);

    const keyLevels = this.buildKeyLevels(context);
    const execution = this.resolveExecutionState(symbol, asOf, context, thesis, scenarios, preferred);
    const risk = this.riskEnvelope(context, preferred);

    return {
      symbol,
      asOf,
      dataQuality: this.dataQuality(context),
      marketState: {
        regime: context.regime.primary,
        regimeConfidence: context.regime.confidence,
        volatility: context.volatility.label,
        location: context.location.position,
      },
      timeframeAnalysis: context.timeframes,
      directionalBias: context.directionalBias,
      keyLevels,
      thesis,
      scenarios,
      preferredScenarioId: preferred?.id,
      execution,
      risk,
      currentPrice: context.currentPrice,
    };
  }

  // -------------------------------------------------------------------------

  private buildKeyLevels(context: MarketContext): MarketAnalysis['keyLevels'] {
    const price = context.currentPrice;

    const toLevel = (p: number, label: string, timeframe: PriceLevel['timeframe'], kind: PriceLevel['kind']): PriceLevel => ({
      price: p,
      label,
      timeframe,
      kind,
      distancePct: price > 0 ? Math.round((Math.abs(p - price) / price) * 10000) / 100 : Number.NaN,
    });

    const resistance: PriceLevel[] = [
      ...context.liquidity.buySide.slice(0, 4).map((p) =>
        toLevel(p.price, `${p.kind} liquidity`, p.timeframe, 'LIQUIDITY')
      ),
      ...context.zones
        .filter((z) => z.low > price)
        .slice(0, 3)
        .map((z) => toLevel(z.low, `${z.direction.toLowerCase()} zone (${z.dominantTimeframe}, str ${z.strength})`, z.dominantTimeframe, 'ZONE_EDGE')),
      toLevel(context.location.range.high, 'Range high', context.location.range.timeframe, 'RANGE_HIGH'),
    ]
      .filter((l) => l.price > price)
      .sort((a, b) => a.price - b.price)
      .slice(0, 6);

    const support: PriceLevel[] = [
      ...context.liquidity.sellSide.slice(0, 4).map((p) =>
        toLevel(p.price, `${p.kind} liquidity`, p.timeframe, 'LIQUIDITY')
      ),
      ...context.zones
        .filter((z) => z.high < price)
        .slice(0, 3)
        .map((z) => toLevel(z.high, `${z.direction.toLowerCase()} zone (${z.dominantTimeframe}, str ${z.strength})`, z.dominantTimeframe, 'ZONE_EDGE')),
      toLevel(context.location.range.low, 'Range low', context.location.range.timeframe, 'RANGE_LOW'),
    ]
      .filter((l) => l.price < price)
      .sort((a, b) => b.price - a.price)
      .slice(0, 6);

    const liquidityAbove = context.liquidity.buySide
      .slice(0, 4)
      .map((p) => toLevel(p.price, `${p.scope.toLowerCase()} ${p.kind.toLowerCase()}`, p.timeframe, 'LIQUIDITY'));

    const liquidityBelow = context.liquidity.sellSide
      .slice(0, 4)
      .map((p) => toLevel(p.price, `${p.scope.toLowerCase()} ${p.kind.toLowerCase()}`, p.timeframe, 'LIQUIDITY'));

    return { resistance, support, liquidityAbove, liquidityBelow };
  }

  private resolveExecutionState(
    symbol: string,
    asOf: number,
    context: MarketContext,
    thesis: Thesis,
    scenarios: TradeScenario[],
    preferred?: TradeScenario
  ): MarketAnalysis['execution'] {
    // 1. A qualified READY setup with thesis backing → EXECUTE.
    const setupEngine = this.deps.setupEngine;
    if (setupEngine) {
      const ready = setupEngine
        .getQualifiedSetupsAsOf(symbol, asOf)
        .filter((s) => s.status === 'READY' && !s.qualification?.rejected);
      const actionable = ready.find((s) =>
        s.direction === 'LONG'
          ? thesis.type === 'BULLISH_CONTINUATION' || thesis.type === 'BULLISH_REVERSAL'
          : thesis.type === 'BEARISH_CONTINUATION' || thesis.type === 'BEARISH_REVERSAL'
      );
      if (actionable) {
        return {
          state: 'EXECUTE',
          setupId: actionable.id,
          note: `${actionable.direction} ${actionable.setupType} READY (grade ${actionable.grade ?? 'n/a'}, score ${actionable.hierarchicalConfluence?.totalScore ?? actionable.confluence.totalScore})`,
        };
      }
    }

    // 2. A preferred scenario whose price trigger is armed → READY.
    if (preferred && preferred.status === 'ARMED' && preferred.entry) {
      return {
        state: 'READY',
        setupId: preferred.id,
        trigger: preferred.entry.trigger,
        note: `Preferred scenario ${preferred.type} armed at ${preferred.entry.zone.lower}–${preferred.entry.zone.upper}`,
      };
    }

    // 3. Otherwise wait on the preferred scenario's trigger.
    if (preferred?.entry?.trigger) {
      return {
        state: 'WAIT',
        trigger: preferred.entry.trigger,
        setupId: preferred.id,
        note: `Waiting for ${preferred.type}: ${preferred.entry.trigger.description}`,
      };
    }

    void context; void scenarios;
    return {
      state: 'WAIT',
      note: `Thesis ${thesis.type} — no actionable scenario yet`,
    };
  }

  private riskEnvelope(context: MarketContext, preferred?: TradeScenario): MarketAnalysis['risk'] {
    const base = this.deps.baseRiskPerTradePct ?? 0.005;

    // Volatility-scaled risk budget: extreme volatility trades smaller.
    let maxRiskPercent = base;
    if (context.volatility.label === 'EXTREME') maxRiskPercent = base * 0.5;
    else if (context.volatility.label === 'ELEVATED') maxRiskPercent = base * 0.75;
    else if (context.volatility.label === 'LOW') maxRiskPercent = base * 1.1;

    // Range/transition regimes halve the budget.
    if (context.regime.primary === 'RANGE' || context.regime.primary === 'TRANSITION') {
      maxRiskPercent *= 0.7;
    }

    return {
      invalidation: preferred?.invalidation ?? 0,
      maxRiskPercent: Math.round(maxRiskPercent * 10000) / 10000,
      structuralStop: preferred?.invalidation || undefined,
    };
  }

  private dataQuality(context: MarketContext): MarketAnalysis['dataQuality'] {
    const degraded: AnalysisTimeframe[] = [];
    for (const tf of Object.keys(context.timeframes) as AnalysisTimeframe[]) {
      const ctx = context.timeframes[tf];
      const min = MIN_CLOSED_CANDLES[tf];
      if (!ctx || ctx.candleCount < min) degraded.push(tf);
    }
    return {
      mtfSynchronized: degraded.length === 0,
      overallSyncStatus: degraded.length === 0 ? 'SYNCHRONIZED' : 'DEGRADED',
      degradedTimeframes: degraded,
    };
  }
}
