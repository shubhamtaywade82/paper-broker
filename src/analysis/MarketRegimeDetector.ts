import type { Candle } from '../strategy/indicators.js';
import {
  extractMarketFeatures,
  formatRegimeKey,
} from '../strategy/adaptive-supertrend/regime.js';
import type { MarketFeatures } from '../strategy/adaptive-supertrend/types.js';
import type { MarketTrend } from '../market/structure/types.js';
import type { MultiTimeframeState } from '../market/MtfStateEngine.js';

/**
 * Coarse-grained market regime label. The agent uses this to pick a strategy
 * profile (trend-following vs mean-reversion vs breakout) and to scale risk
 * parameters (stop distance, position size, max leverage).
 *
 * The labels deliberately mirror how a discretionary trader thinks about a
 * market — not the raw `volatility_trendStrength_momentum` regime key used
 * by the adaptive-supertrend Q-learning table, which is too granular for
 * "should I be in this market at all" decisions.
 */
export type MarketRegime =
  | 'TRENDING_STRONG'
  | 'TRENDING_NORMAL'
  | 'RANGING_LOW_VOL'
  | 'RANGING_HIGH_VOL'
  | 'VOLATILE_BREAKOUT'
  | 'TRANSITIONING';

export interface RegimeSnapshot {
  symbol: string;
  asOf: number;
  regime: MarketRegime;
  /** Raw feature vector from the adaptive-supertrend regime extractor. */
  features: MarketFeatures;
  /** Compact key like `low_medium_oversold` used by the Q-table. */
  regimeKey: string;
  /** HTF (4h) trend label from the structure engine, included so the agent
   * can detect "trending up but momentum exhausting" without re-reading MTF. */
  htfTrend: MarketTrend | undefined;
  /** 1h trend label. */
  mtfTrend: MarketTrend | undefined;
  /** 0..100 confidence in the regime classification. */
  confidence: number;
}

/**
 * What the risk manager should change when a symbol enters this regime.
 * Returned by {@link MarketRegimeDetector.getAdaptation} and consumed by
 * the {@link AdaptiveRiskManager}.
 */
export interface RegimeAdaptation {
  regime: MarketRegime;
  /** Multiplier applied to the base risk-per-trade pct (e.g. 0.5 = halve). */
  riskMultiplier: number;
  /** ATR multiplier for the stop-loss distance. */
  stopAtrMultiplier: number;
  /** ATR multiplier for the take-profit distance. */
  targetAtrMultiplier: number;
  /** Minimum reward:risk ratio to accept a trade in this regime. */
  minRR: number;
  /** Recommended trailing-stop activation threshold (fraction of entry). */
  trailingActivationPct: number;
  /** Recommended trailing-stop distance (fraction of entry). */
  trailingDistancePct: number;
  /** Recommended breakeven trigger (fraction of entry). */
  breakevenTriggerPct: number;
  /** Recommended max leverage in this regime. */
  maxLeverage: number;
  /** Narrative for the operator log / dashboard. */
  rationale: string;
}

/**
 * Confirmation bars required to commit a regime transition FROM `prev` TO
 * `next` (AUTONOMY_AUDIT Finding 6).
 *
 * The threshold is keyed on the regime being LEFT, ranked by how noisy its
 * classifications are: RANGING_LOW_VOL is quiet (−1 bar), trending regimes
 * are stable (±0), RANGING_HIGH_VOL / TRANSITIONING are choppy (+1), and
 * VOLATILE_BREAKOUT is the noisiest (+2). Transitions INTO TRANSITIONING are
 * never delayed — standing aside early is the safe direction, and delaying
 * it would keep the agent trading a regime that already ended.
 *
 * An explicit `overrides` entry for the source regime replaces the offset
 * table entirely (clamped to ≥ 1). With the default base of 3 this yields:
 * leaving RANGING_LOW_VOL needs 2 observations, leaving VOLATILE_BREAKOUT
 * needs 5.
 */
export function regimeConfirmationBarsFor(
  prev: MarketRegime | undefined,
  next: MarketRegime,
  base: number,
  overrides?: Partial<Record<MarketRegime, number>>
): number {
  if (next === 'TRANSITIONING') return base;
  const override = prev ? overrides?.[prev] : undefined;
  if (typeof override === 'number') return Math.max(1, Math.round(override));
  const offsets: Record<MarketRegime, number> = {
    RANGING_LOW_VOL: -1,
    TRENDING_STRONG: 0,
    TRENDING_NORMAL: 0,
    RANGING_HIGH_VOL: 1,
    TRANSITIONING: 1,
    VOLATILE_BREAKOUT: 2,
  };
  return Math.max(1, base + (prev ? offsets[prev] : 0));
}

/**
 * Detect market regime per symbol from the MTF state.
 *
 * Reuses the existing {@link extractMarketFeatures} function (ADX, Bollinger
 * band-width, RSI, MACD histogram, ATR, volume ratio) so the regime label
 * stays consistent with what the adaptive-supertrend strategy's Q-table
 * already learns. The detector just projects that 9-dim vector down to a
 * single human-readable label plus an adaptation payload.
 */
export class MarketRegimeDetector {
  /**
   * @param getHtfCandles Returns the HTF (4h) closed candles for a symbol.
   *   Injected so this class doesn't reach into KlineStore directly — keeps
   *   it testable with synthetic data.
   * @param getMtfTrend Returns the 1h structure trend for a symbol.
   * @param confirmationBars Number of consecutive bars that must agree before
   *   a regime is "confirmed". Defaults to 3.
   */
  constructor(
    private readonly getHtfCandles: (symbol: string, count: number) => Candle[],
    private readonly getMtfTrend: (symbol: string) => MarketTrend | undefined,
    private readonly confirmationBars: number = 3
  ) {}

  /**
   * Compute a single regime snapshot for a symbol. Returns null if there
   * isn't enough HTF history yet (caller should treat as TRANSITIONING).
   */
  detect(symbol: string, mtf?: MultiTimeframeState, asOf = Date.now()): RegimeSnapshot | null {
    const candles = this.getHtfCandles(symbol, 100);
    if (candles.length < 35) return null;

    const features = extractMarketFeatures(candles);
    if (!features) return null;

    const regimeKey = formatRegimeKey(features);
    const regime = this.classify(features);
    const htfTrend = mtf?.timeframes?.['4h']?.lastClosedCandle
      ? this.getTrendFromCandles(mtf.timeframes['4h']!.closedCandles)
      : undefined;
    const mtfTrend = this.getMtfTrend(symbol);

    return {
      symbol,
      asOf,
      regime,
      features,
      regimeKey,
      htfTrend,
      mtfTrend,
      confidence: this.confidenceFor(features, regime),
    };
  }

  /**
   * Translate a regime into concrete risk-parameter adjustments. The
   * AdaptiveRiskManager consumes this and applies it on top of the base
   * RiskConfig.
   */
  getAdaptation(regime: MarketRegime): RegimeAdaptation {
    switch (regime) {
      case 'TRENDING_STRONG':
        return {
          regime,
          riskMultiplier: 1.2,
          stopAtrMultiplier: 2.0,
          targetAtrMultiplier: 6.0,
          minRR: 2.5,
          trailingActivationPct: 0.015,
          trailingDistancePct: 0.012,
          breakevenTriggerPct: 0.01,
          maxLeverage: 10,
          rationale:
            'ADX>35 with aligned momentum — let winners run, trail looser to avoid shake-outs.',
        };
      case 'TRENDING_NORMAL':
        return {
          regime,
          riskMultiplier: 1.0,
          stopAtrMultiplier: 1.75,
          targetAtrMultiplier: 4.5,
          minRR: 2.0,
          trailingActivationPct: 0.02,
          trailingDistancePct: 0.015,
          breakevenTriggerPct: 0.01,
          maxLeverage: 8,
          rationale:
            'ADX 20-35 — standard trend-following profile, balanced RR and trailing distance.',
        };
      case 'RANGING_LOW_VOL':
        return {
          regime,
          riskMultiplier: 0.7,
          stopAtrMultiplier: 1.25,
          targetAtrMultiplier: 2.5,
          minRR: 1.5,
          trailingActivationPct: 0.012,
          trailingDistancePct: 0.008,
          breakevenTriggerPct: 0.008,
          maxLeverage: 5,
          rationale:
            'Low band-width, weak ADX — favour mean-reversion, tight stops, smaller size.',
        };
      case 'RANGING_HIGH_VOL':
        return {
          regime,
          riskMultiplier: 0.5,
          stopAtrMultiplier: 1.75,
          targetAtrMultiplier: 3.0,
          minRR: 1.5,
          trailingActivationPct: 0.018,
          trailingDistancePct: 0.014,
          breakevenTriggerPct: 0.012,
          maxLeverage: 3,
          rationale:
            'Range-bound but volatile — wider stops, much smaller size, avoid overtrading.',
        };
      case 'VOLATILE_BREAKOUT':
        return {
          regime,
          riskMultiplier: 0.8,
          stopAtrMultiplier: 2.5,
          targetAtrMultiplier: 5.5,
          minRR: 2.0,
          trailingActivationPct: 0.025,
          trailingDistancePct: 0.02,
          breakevenTriggerPct: 0.015,
          maxLeverage: 6,
          rationale:
            'High band-width + expanding ATR — wider stops to survive noise, smaller size, favour breakout setups.',
        };
      case 'TRANSITIONING':
      default:
        return {
          regime,
          riskMultiplier: 0.6,
          stopAtrMultiplier: 1.5,
          targetAtrMultiplier: 3.0,
          minRR: 1.8,
          trailingActivationPct: 0.015,
          trailingDistancePct: 0.012,
          breakevenTriggerPct: 0.01,
          maxLeverage: 4,
          rationale:
            'Regime unclear / conflicting signals — defensive size, hold for clearer context.',
        };
    }
  }

  /**
   * Map a 9-dim feature vector down to one of six regimes.
   *
   * The mapping is deliberately conservative: anything ambiguous falls into
   * TRANSITIONING rather than forcing a directional classification. The agent
   * treats TRANSITIONING as "stand aside" — see {@link AutonomousTradingAgent}.
   */
  private classify(f: MarketFeatures): MarketRegime {
    const strongTrend = f.trendStrength === 'strong';
    const mediumTrend = f.trendStrength === 'medium';
    const weakTrend = f.trendStrength === 'weak';
    const lowVol = f.volatility === 'low';
    const highVol = f.volatility === 'high';
    const neutralMomentum = f.momentum === 'neutral';

    if (strongTrend && (f.adx >= 30 || !neutralMomentum)) {
      return 'TRENDING_STRONG';
    }
    if (mediumTrend && !highVol) {
      return 'TRENDING_NORMAL';
    }
    if (highVol && (f.bandWidth > 0.06 || f.volumeRatio > 1.4)) {
      return 'VOLATILE_BREAKOUT';
    }
    if (lowVol && weakTrend) {
      return 'RANGING_LOW_VOL';
    }
    if (highVol && weakTrend) {
      return 'RANGING_HIGH_VOL';
    }
    return 'TRANSITIONING';
  }

  /**
   * Rough confidence in the classification. Strong ADX + non-neutral momentum
   * in a trending regime is the most confident call; weak ADX in any
   * "trending" bucket is the least.
   */
  private confidenceFor(f: MarketFeatures, regime: MarketRegime): number {
    let base = 50;
    if (regime === 'TRENDING_STRONG') base = 75;
    if (regime === 'TRENDING_NORMAL') base = 65;
    if (regime === 'VOLATILE_BREAKOUT') base = 60;
    if (regime === 'RANGING_LOW_VOL') base = 60;
    if (regime === 'RANGING_HIGH_VOL') base = 55;
    if (regime === 'TRANSITIONING') base = 35;

    // ADX bonus: anything above 25 adds confidence, below 18 subtracts it.
    if (f.adx >= 25) base += 10;
    if (f.adx < 18) base -= 10;

    // Volume confirmation: a volume ratio above 1.2 reinforces the call.
    if (f.volumeRatio >= 1.2) base += 5;

    return Math.max(0, Math.min(100, base));
  }

  /**
   * Quick swing-high/swing-low trend classifier so the snapshot includes an
   * HTF trend label without re-running the full structure engine.
   *
   * The agent doesn't act on this label alone — it consults the structure
   * engine's events (CHOCH/BOS) through the SetupEngine. This is purely for
   * the regime snapshot narrative.
   */
  private getTrendFromCandles(candles: Candle[]): MarketTrend | undefined {
    if (candles.length < 10) return undefined;
    const recent = candles.slice(-10);
    const first = recent[0]!.close;
    const last = recent[recent.length - 1]!.close;
    const change = (last - first) / first;
    if (change > 0.005) return 'BULLISH';
    if (change < -0.005) return 'BEARISH';
    return 'RANGE';
  }
}
