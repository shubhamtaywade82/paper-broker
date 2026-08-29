import type { RiskConfig } from '../trading/risk/types.js';
import type { RegimeAdaptation, MarketRegime } from '../analysis/MarketRegimeDetector.js';
import type { Candle } from '../strategy/indicators.js';
import { atr } from '../strategy/indicators.js';

/**
 * Adaptive risk manager.
 *
 * Sits in front of the existing RiskEngine's static config and rewrites it
 * per-symbol, per-regime. The RiskEngine itself stays untouched — it still
 * applies the same daily-loss / max-positions / exposure guards it always
 * has. This class is the "regime-aware overlay" that produces the inputs
 * (stop distance, target distance, leverage, size multiplier) the agent
 * hands to the rest of the pipeline.
 *
 * Concretely: every cycle, the AutonomousTradingAgent calls
 * {@link AdaptiveRiskManager.computeTradePlan} with the current regime and
 * the latest 1h/15m candle array. The risk manager returns:
 *   - the regime-adjusted stop and target prices derived from ATR
 *   - the position size multiplier (regime-scaled fraction of equity at risk)
 *   - the recommended leverage (capped to both the regime ceiling and the
 *     base RiskConfig.maxLeverage)
 *   - the realised RR ratio for sanity-checking
 *
 * The agent then folds these into a SignalInput.features map and submits
 * via StrategyEngine.submitSignal — exactly the same path a regular
 * strategy's signal would take.
 */
export interface TradePlan {
  /** Per-regime adaptation applied. */
  adaptation: RegimeAdaptation;
  /** Stop-loss price (absolute, quote units). */
  stopLossPrice: number;
  /** Take-profit price (absolute, quote units). */
  takeProfitPrice: number;
  /** Recommended leverage (≤ base RiskConfig.maxLeverage AND ≤ adaptation.maxLeverage). */
  leverage: number;
  /** Fraction-of-equity multiplier applied to the base riskPerTradePct. */
  riskMultiplier: number;
  /**
   * Per-regime learning bias applied on top of the regime overlay's
   * riskMultiplier (AUTONOMY_AUDIT Finding 4). 1.0 when the learning loop
   * has no statistically meaningful sample for this regime; bounded to
   * [0.5, 1.5] otherwise (observed win rate / 50% baseline). Exposed for
   * observability — the effective multiplier is
   * `adaptation.riskMultiplier * regimeBias`.
   */
  regimeBias: number;
  /** Gross reward:risk ratio (target distance / stop distance). */
  rr: number;
  /**
   * Reward:risk after round-trip execution cost, which is what the trade
   * actually has to clear. Unlike {@link rr} — where the ATR cancels out of
   * both distances, making it a per-regime constant that can never fail its
   * own minRR check — this varies with ATR, price and the fee schedule, so it
   * genuinely discriminates between setups.
   */
  netRR: number;
  /** Round-trip execution cost per unit (entry + exit fees, quote units). */
  roundTripCost: number;
  /** ATR value used to compute distances (informational). */
  atr: number;
  /** Entry price assumed for the plan. */
  entryPrice: number;
  /** Direction the plan is built for — used by callers to sanity-check. */
  direction: 'LONG' | 'SHORT';
}

/**
 * Rolling per-regime performance the learning loop can report for a regime.
 * Structurally compatible with PerformanceTracker's RollingStats — only the
 * fields the risk manager needs are declared, so tests can stub it easily.
 */
export interface RegimePerformanceStats {
  /** Closed trades observed in this regime. */
  trades: number;
  /** 0..1 share of winners. */
  winRate: number;
}

export interface AdaptiveRiskManagerDeps {
  /** Base risk config — the regime overlay multiplies / caps against this. */
  baseConfig: RiskConfig;
  /** Equity getter — usually `() => broker.getAccount().equity`. */
  getEquity: () => number;
  /** Latest price for a symbol — used as the entry assumption. */
  getLastPrice: (symbol: string) => number | undefined;
  /** Closed candles for a timeframe — injected so this is testable. */
  getCandles: (symbol: string, timeframe: string, count: number) => Candle[];
  /**
   * Per-regime performance lookup — the learning loop's memory (Finding 4).
   * Optional: without it (or before min-sample is reached) the regime
   * overlay's static riskMultiplier is used unchanged.
   */
  getRegimeStats?: (regime: MarketRegime) => RegimePerformanceStats | null;
  /**
   * Round-trip execution cost in basis points of notional — entry fee + exit
   * fee. Defaults to 8bps (two 4bps taker legs, the PaperBroker/Binance USDM
   * VIP0 rate). Raise it to include expected slippage.
   */
  roundTripCostBps?: number;
  /**
   * Reject a plan whose stop distance is smaller than this multiple of the
   * round-trip cost. At 1x, a stop-out and a scratch cost the same and fees
   * eat the whole edge; the default 4x means the loss leg is at least 4x the
   * cost of transacting.
   */
  minStopCostMultiple?: number;
}

export class AdaptiveRiskManager {
  private deps: AdaptiveRiskManagerDeps;

  constructor(deps: AdaptiveRiskManagerDeps) {
    this.deps = deps;
  }

  /**
   * Compute a complete trade plan for a candidate setup, given the current
   * regime adaptation. Returns null if the plan doesn't clear the regime's
   * min RR — the agent should treat that as "skip this setup, the regime
   * can't pay for the stop we'd need".
   */
  computeTradePlan(
    symbol: string,
    direction: 'LONG' | 'SHORT',
    adaptation: RegimeAdaptation,
    timeframe: string = '1h'
  ): TradePlan | null {
    const candles = this.deps.getCandles(symbol, timeframe, 50);
    if (candles.length < 15) return null;

    const closes = candles.map((c) => c.close);
    const atrRes = atr(candles, 14);
    const lastIdx = candles.length - 1;
    // `??` does not catch NaN, and atr() returns NaN for every index it could
    // not compute. A NaN ATR propagated silently into stopLossPrice /
    // takeProfitPrice and past the `rr < minRR` gate (NaN comparisons are
    // false), handing the agent a plan with NaN stop and target.
    const rawAtr = atrRes[lastIdx];
    const atrVal = Number.isFinite(rawAtr) && rawAtr! > 0 ? rawAtr! : closes[lastIdx]! * 0.01;
    const entry = this.deps.getLastPrice(symbol) ?? closes[lastIdx]!;
    if (!Number.isFinite(entry) || entry <= 0) return null;

    const stopDistance = atrVal * adaptation.stopAtrMultiplier;
    const targetDistance = atrVal * adaptation.targetAtrMultiplier;

    const stopLossPrice =
      direction === 'LONG' ? entry - stopDistance : entry + stopDistance;
    const takeProfitPrice =
      direction === 'LONG' ? entry + targetDistance : entry - targetDistance;

    if (stopDistance <= 0) return null;
    const rr = targetDistance / stopDistance;

    // Cost-adjusted gate. `rr` above is targetAtrMultiplier/stopAtrMultiplier —
    // the ATR cancels, so it is a constant per regime, drawn from the same
    // adaptation table that supplies minRR. It passed 1817/1817 live signals at
    // exactly RR=3.00 and rejected nothing, ever. Cost is what actually varies:
    // a 3500-notional round trip costs ~2.80 against trades whose realized PnL
    // is single digits, so the loss leg must clear the cost by a real margin.
    const roundTripCost = entry * ((this.deps.roundTripCostBps ?? 8) / 10_000);
    const minStopCostMultiple = this.deps.minStopCostMultiple ?? 4;
    if (stopDistance < minStopCostMultiple * roundTripCost) return null;

    const netRR = (targetDistance - roundTripCost) / (stopDistance + roundTripCost);
    if (netRR < adaptation.minRR) return null;

    // Leverage: regime ceiling AND base config ceiling, take the lower.
    const leverage = Math.min(
      adaptation.maxLeverage,
      this.deps.baseConfig.maxLeverage
    );

    // Per-regime learning bias (AUTONOMY_AUDIT Finding 4): when the learning
    // loop has enough closed trades in THIS regime, bias the regime overlay's
    // riskMultiplier toward the observed win rate. A 50% win rate is neutral
    // (x1.0); 70% scales up to x1.4; 30% scales down to x0.6 — bounded to
    // [0.5, 1.5] so learning can refine the overlay but never override it.
    // No sample (or no tracker wired) → neutral 1.0.
    const regimeStats = this.deps.getRegimeStats?.(adaptation.regime) ?? null;
    const regimeBias = regimeStats
      ? Math.round(Math.max(0.5, Math.min(1.5, regimeStats.winRate / 0.5)) * 1000) / 1000
      : 1.0;

    // Risk multiplier: regime overlay x per-regime learning bias, never above
    // the product of the two ceilings, never below 0.1 (a degenerate plan
    // that risks nothing still has to risk something to execute on the
    // broker).
    const riskMultiplier = Math.max(0.1, adaptation.riskMultiplier * regimeBias);

    return {
      adaptation,
      stopLossPrice,
      takeProfitPrice,
      leverage,
      riskMultiplier,
      regimeBias,
      rr,
      netRR,
      roundTripCost,
      atr: atrVal,
      entryPrice: entry,
      direction,
    };
  }

  /**
   * Convenience: returns true if the candidate regime is "tradeable" at all.
   * TRANSITIONING is a stand-aside regime.
   */
  isTradeable(regime: MarketRegime): boolean {
    return regime !== 'TRANSITIONING';
  }

  /**
   * Project a TradePlan back into the SignalInput.features map the
   * SignalExecutor / OrderFactory understand. Keeps the contract the same
   * as the rest of the strategy fleet — `leverage`, `sizePct`, etc. are
   * the canonical keys the executor reads.
   */
  planToFeatures(plan: TradePlan): Record<string, number | string | boolean> {
    const baseRiskPct = this.deps.baseConfig.riskPerTradePct;
    const sizePct = baseRiskPct * plan.riskMultiplier;
    return {
      leverage: plan.leverage,
      sizePct,
      riskMultiplier: plan.riskMultiplier,
      regimeBias: plan.regimeBias,
      atr: plan.atr,
      rr: plan.rr,
      regime: plan.adaptation.regime,
      stopAtrMultiplier: plan.adaptation.stopAtrMultiplier,
      targetAtrMultiplier: plan.adaptation.targetAtrMultiplier,
      trailingActivationPct: plan.adaptation.trailingActivationPct,
      trailingDistancePct: plan.adaptation.trailingDistancePct,
      breakevenTriggerPct: plan.adaptation.breakevenTriggerPct,
    };
  }
}
