/**
 * Paper Liquidation
 *
 * Liquidation price for an isolated-margin position.
 *
 * The previous implementation was `entry * (1 - 1/lev + mmr)`, which assumes
 * the margin is exactly `notional / leverage`, ignores fees already charged
 * against the position, and treats the maintenance margin rate as a single
 * flat number regardless of position size. Real USDⓈ-M futures use tiered
 * brackets: as notional grows the maintenance rate steps up, and each tier
 * carries a maintenance *amount* that compensates for the step.
 *
 * This version implements the standard isolated-margin relation
 *
 *     margin + unrealizedPnl - fees  =  maintenanceMargin
 *
 * solved for price, with maintenanceMargin = notional * mmr - maintenanceAmount.
 *
 * On bracket data: this module does NOT ship a hardcoded table of exchange
 * tier boundaries. Inventing those numbers would produce a liquidation price
 * that looks authoritative and is wrong. With no brackets supplied it falls
 * back to a single tier built from the instrument's own maintenanceMarginRate
 * and a zero maintenance amount — the same rate the caller already had, now
 * applied through the correct formula. Supply real brackets (e.g. from the
 * exchange's leverage-bracket endpoint) via `brackets` to get true tiering.
 */

export interface LeverageBracket {
  /** Upper bound of the notional range this bracket covers, in quote currency. */
  notionalCap: number;
  /** Maintenance margin rate for this bracket, as a fraction (0.005 = 0.5%). */
  maintenanceMarginRate: number;
  /**
   * Maintenance amount (the "cum" deduction) for this bracket. Compensates for
   * the rate step so maintenance margin stays continuous across tier edges.
   */
  maintenanceAmount: number;
}

export interface LiquidationParams {
  entryPrice: number;
  side: 'LONG' | 'SHORT';
  leverage: number;
  /** Position size in base units. Defaults to 1 (price-only estimate). */
  quantity?: number;
  /** Margin actually posted. Defaults to notional / leverage. */
  initialMargin?: number;
  /** Fees already charged against this position. Reduces available margin. */
  fees?: number;
  /** Funding already paid (positive) or received (negative). */
  funding?: number;
  /** Fallback rate when no brackets are supplied. */
  maintenanceMarginRate?: number;
  /** Real exchange brackets, ordered or unordered; selected by notional. */
  brackets?: LeverageBracket[];
}

export class PaperLiquidation {
  /**
   * Select the bracket covering `notional`. Brackets are sorted by cap so an
   * unordered table from an API response still resolves correctly; the widest
   * bracket applies to anything above the largest cap.
   */
  static selectBracket(
    notional: number,
    brackets: LeverageBracket[] | undefined,
    fallbackRate: number
  ): LeverageBracket {
    if (!brackets || brackets.length === 0) {
      return { notionalCap: Number.POSITIVE_INFINITY, maintenanceMarginRate: fallbackRate, maintenanceAmount: 0 };
    }

    const sorted = [...brackets].sort((a, b) => a.notionalCap - b.notionalCap);
    for (const bracket of sorted) {
      if (notional <= bracket.notionalCap) return bracket;
    }
    return sorted[sorted.length - 1]!;
  }

  /**
   * Isolated-margin liquidation price.
   *
   * Accepts either the original positional signature (kept so existing callers
   * and their tests are unaffected) or a params object for the full model.
   */
  static calculateLiquidationPrice(
    entryPriceOrParams: number | LiquidationParams,
    side?: 'LONG' | 'SHORT',
    leverage?: number,
    maintenanceMarginRate = 0.005
  ): number {
    const params: LiquidationParams =
      typeof entryPriceOrParams === 'number'
        ? {
            entryPrice: entryPriceOrParams,
            side: side ?? 'LONG',
            leverage: leverage ?? 1,
            maintenanceMarginRate,
          }
        : entryPriceOrParams;

    const entry = params.entryPrice;
    if (!Number.isFinite(entry) || entry <= 0) return 0;

    const lev = Math.max(1, params.leverage);
    const qty = params.quantity !== undefined && params.quantity > 0 ? params.quantity : 1;
    const notional = entry * qty;

    const bracket = PaperLiquidation.selectBracket(
      notional,
      params.brackets,
      params.maintenanceMarginRate ?? 0.005
    );
    const mmr = bracket.maintenanceMarginRate;

    const margin = params.initialMargin !== undefined ? params.initialMargin : notional / lev;
    // Fees and funding already paid are gone from the margin balance, so the
    // position liquidates sooner than a fee-free model predicts.
    const costs = (params.fees ?? 0) + (params.funding ?? 0);
    const maintAmount = bracket.maintenanceAmount;

    // margin - costs + pnl(P) = P*qty*mmr - maintAmount
    //   LONG : pnl = (P - entry) * qty
    //   SHORT: pnl = (entry - P) * qty
    const liq =
      params.side === 'LONG'
        ? (notional + costs - margin - maintAmount) / (qty * (1 - mmr))
        : (notional - costs + margin + maintAmount) / (qty * (1 + mmr));

    if (!Number.isFinite(liq)) return 0;
    return Number(Math.max(0, liq).toFixed(4));
  }
}
