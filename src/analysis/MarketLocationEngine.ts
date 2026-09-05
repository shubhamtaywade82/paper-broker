import type { AnalysisTimeframe } from '../market/MtfStateEngine.js';
import type { MultiTimeframeStructureState } from '../market/structure/types.js';
import type { ConfluenceZone, LiquidityMap, MarketLocation, MarketPosition } from './types.js';

export interface MarketLocationConfig {
  /** Half-width of the equilibrium band around the 50% level. */
  equilibriumBandHalfWidth: number;
  /** Beyond this range position, discount/premium becomes "deep". */
  deepThreshold: number;
  /** Max percent distance for a zone to count as "nearby". */
  nearbyZoneDistancePct: number;
  /** Max nearby zones returned. */
  maxNearbyZones: number;
}

export const DEFAULT_MARKET_LOCATION_CONFIG: MarketLocationConfig = {
  equilibriumBandHalfWidth: 0.05,
  deepThreshold: 0.25,
  nearbyZoneDistancePct: 0.015,
  maxNearbyZones: 6,
};

/**
 * Market Location Engine — WHERE price is inside the HTF dealing range.
 *
 * This is the layer that makes "bullish BOS + bullish FVG" mean different
 * things at discount (continuation fuel) vs at HTF premium under major
 * buy-side liquidity (exhaustion risk). Same structure, different location,
 * different trade.
 *
 * The dealing range is derived from the 4h external structure swings (macro
 * regime timeframe), falling back through 2h → 1h when the higher timeframe
 * has no confirmed swings yet, and finally to the recent candle envelope.
 */
export class MarketLocationEngine {
  private config: MarketLocationConfig;

  constructor(config: MarketLocationConfig = DEFAULT_MARKET_LOCATION_CONFIG) {
    this.config = config;
  }

  /**
   * @param structure Multi-timeframe structure state (for range derivation).
   * @param zones Merged confluence zones (for nearbyZones).
   * @param liquidity Liquidity map (for liquidityDistance).
   * @param currentPrice Anchor price.
   * @param rangeHint Optional precomputed range override (high/low + tf).
   */
  computeLocation(
    structure: MultiTimeframeStructureState,
    zones: ConfluenceZone[],
    liquidity: LiquidityMap | null,
    currentPrice: number,
    rangeHint?: { high: number; low: number; timeframe: AnalysisTimeframe }
  ): MarketLocation {
    const range =
      rangeHint ??
      this.deriveRange(structure, currentPrice);

    const span = range.high - range.low;
    const rangePosition = span > 0 ? (currentPrice - range.low) / span : 0.5;
    const position = this.classifyPosition(rangePosition);

    const nearbyZones = this.findNearbyZones(zones, currentPrice);

    const upside = liquidity?.nearestAbove
      ? ((liquidity.nearestAbove.price - currentPrice) / currentPrice) * 100
      : Number.NaN;
    const downside = liquidity?.nearestBelow
      ? ((currentPrice - liquidity.nearestBelow.price) / currentPrice) * 100
      : Number.NaN;

    return {
      range: {
        high: range.high,
        low: range.low,
        equilibrium: (range.high + range.low) / 2,
        timeframe: range.timeframe,
      },
      position,
      rangePosition,
      nearbyZones,
      liquidityDistance: { upside, downside },
    };
  }

  /**
   * Classify a 0..1 range position. Discount = lower half, premium = upper
   * half; "deep" marks the extreme quartiles where reversal risk is highest
   * for continuation trades.
   */
  private classifyPosition(rangePosition: number): MarketPosition {
    const { equilibriumBandHalfWidth: eq, deepThreshold: deep } = this.config;
    if (rangePosition < deep) return 'DEEP_DISCOUNT';
    if (rangePosition < 0.5 - eq) return 'DISCOUNT';
    if (rangePosition <= 0.5 + eq) return 'EQUILIBRIUM';
    if (rangePosition <= 1 - deep) return 'PREMIUM';
    return 'DEEP_PREMIUM';
  }

  private findNearbyZones(zones: ConfluenceZone[], currentPrice: number): ConfluenceZone[] {
    const tol = currentPrice * this.config.nearbyZoneDistancePct;
    return zones
      .filter((z) => {
        // Overlapping now, or sitting just above/below within tolerance.
        if (currentPrice >= z.low && currentPrice <= z.high) return true;
        return z.low - currentPrice <= tol || currentPrice - z.high <= tol;
      })
      .sort((a, b) => b.strength - a.strength)
      .slice(0, this.config.maxNearbyZones);
  }

  /**
   * Derive the dealing range from the highest timeframe with confirmed
   * swings. Falls back to a synthetic ±1.5% envelope around price when no
   * swing data exists yet (fresh listing / degraded data), so consumers can
   * still rely on a well-formed range object.
   */
  deriveRange(
    structure: MultiTimeframeStructureState,
    currentPrice: number
  ): { high: number; low: number; timeframe: AnalysisTimeframe } {
    const preference: AnalysisTimeframe[] = ['4h', '2h', '1h', '15m'];

    for (const tf of preference) {
      const s = structure.timeframes[tf];
      const high = s?.lastConfirmedSwingHigh?.price;
      const low = s?.lastConfirmedSwingLow?.price;
      if (
        typeof high === 'number' &&
        typeof low === 'number' &&
        high > low &&
        currentPrice > 0
      ) {
        // Sanity: reject degenerate micro-ranges (< 0.5% span) — they would
        // put every price at both "premium" and "discount" simultaneously.
        if ((high - low) / currentPrice >= 0.005) {
          return { high, low, timeframe: tf };
        }
      }
    }

    const fallbackSpan = currentPrice * 0.03;
    return {
      high: currentPrice + fallbackSpan,
      low: currentPrice - fallbackSpan,
      timeframe: '15m',
    };
  }
}
