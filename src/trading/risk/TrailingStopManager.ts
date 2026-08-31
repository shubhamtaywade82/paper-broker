/**
 * Trailing Stop Manager
 * 
 * Dynamically adjusts stop-loss levels as positions move in favor.
 * Captures more profit during strong trends while protecting gains.
 * 
 * Key Features:
 * - Activation threshold: trailing begins after X% profit
 * - Trailing distance: stop stays Y% behind highest favorable price
 * - Breakeven trigger: move stop to entry + fees at Z% profit
 * - Works with both LONG and SHORT positions
 */

import type { PortfolioPosition } from './types.js';
import { logger } from '../../telemetry/logger.js';

export interface TrailingStopConfig {
  /** Activate trailing after this percentage of profit (e.g., 0.02 = 2%) */
  activationThresholdPct: number;
  
  /** Distance to trail stop behind highest favorable price (e.g., 0.015 = 1.5%) */
  trailingDistancePct: number;
  
  /** Move stop to breakeven at this profit percentage (e.g., 0.01 = 1%) */
  breakevenTriggerPct: number;
  
  /** Minimum profit to lock in (overrides trailing if higher) */
  minProfitToLockPct?: number;
  
  /** Enable/disable breakeven feature */
  enableBreakeven: boolean;
  
  /** Enable/disable trailing feature */
  enableTrailing: boolean;

  /** Extend the take-profit target past this fraction beyond the highest favorable price (e.g., 0.03 = 3%) */
  tpExtensionPct: number;

  /** Enable/disable take-profit extension */
  enableTpExtension: boolean;
}

export interface TrailingTakeProfitResult {
  /** Whether the take-profit target was updated */
  tpUpdated: boolean;

  /** Previous take-profit price */
  previousTp: number;

  /** New take-profit price */
  newTp: number;

  /** Reason for update */
  reason: 'EXTENDED' | 'NO_CHANGE';

  /** Current unrealized PnL percentage */
  currentUnrealizedPnlPct: number;

  /**
   * Most favorable market price seen while the position was open:
   * the highest price for a LONG, the lowest price for a SHORT.
   */
  highestFavorablePrice: number;
}

export interface TrailingStopResult {
  /** Whether stop loss was updated */
  stopUpdated: boolean;
  
  /** Previous stop loss price */
  previousStop: number;
  
  /** New stop loss price */
  newStop: number;
  
  /** Reason for update */
  reason: 'BREAKEVEN' | 'TRAILING' | 'NO_CHANGE';
  
  /** Current unrealized PnL percentage */
  currentUnrealizedPnlPct: number;
  
  /**
   * Most favorable market price seen while the position was open:
   * the highest price for a LONG, the lowest price for a SHORT.
   */
  highestFavorablePrice: number;
}

export const DEFAULT_TRAILING_STOP_CONFIG: TrailingStopConfig = {
  activationThresholdPct: 0.02,    // Trail after 2% profit
  trailingDistancePct: 0.015,      // 1.5% trailing distance
  breakevenTriggerPct: 0.01,       // BE at 1% profit
  enableBreakeven: true,
  enableTrailing: true,
  tpExtensionPct: 0.03,            // Extend TP 3% past each new favorable extreme
  enableTpExtension: true,
};

interface PositionTracker {
  /** Highest price for a LONG, lowest price for a SHORT. */
  highestFavorablePrice: number;
  breakevenApplied: boolean;
  lastUpdateTimestamp: number;
}

export class TrailingStopManager {
  private config: TrailingStopConfig;
  private positionTrackers = new Map<string, PositionTracker>();

  constructor(config: TrailingStopConfig = DEFAULT_TRAILING_STOP_CONFIG) {
    this.config = config;
    logger.info({ config }, '[TrailingStopManager] Initialized');
  }

  /**
   * Update stop loss for a position based on current market price
   * Call this on every price tick for open positions
   */
  updateStopLoss(position: PortfolioPosition, currentPrice: number, timestamp?: number): TrailingStopResult {
    const ts = timestamp ?? Date.now();
    const isLong = position.side === 'LONG';
    const tracker = this.trackFavorablePrice(position, currentPrice, isLong, ts);

    // Calculate current unrealized PnL percentage
    const unrealizedPnlPct = isLong
      ? (currentPrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - currentPrice) / position.entryPrice;

    // Check if we should apply breakeven. Only a position in profit qualifies —
    // moving a losing position's stop to entry would stop it out immediately.
    if (this.config.enableBreakeven && !tracker.breakevenApplied) {
      if (unrealizedPnlPct >= this.config.breakevenTriggerPct) {
        return this.applyBreakeven(position, tracker, unrealizedPnlPct, ts);
      }
    }

    // Check if we should apply trailing stop
    if (this.config.enableTrailing && unrealizedPnlPct >= this.config.activationThresholdPct) {
      return this.applyTrailingStop(position, tracker, currentPrice, isLong, ts);
    }

    // No update needed
    return {
      stopUpdated: false,
      previousStop: position.stopLossPrice,
      newStop: position.stopLossPrice,
      reason: 'NO_CHANGE',
      currentUnrealizedPnlPct: unrealizedPnlPct,
      highestFavorablePrice: tracker.highestFavorablePrice,
    };
  }

  /**
   * Extend a take-profit target past the highest favorable price once the
   * position is profitable enough to trail. Only ever moves the target
   * farther from entry — never retracts it toward the current price.
   * Call this on every price tick for open positions.
   */
  updateTakeProfit(
    position: PortfolioPosition,
    currentTpPrice: number,
    currentPrice: number,
    timestamp?: number
  ): TrailingTakeProfitResult {
    const ts = timestamp ?? Date.now();
    const isLong = position.side === 'LONG';
    const tracker = this.trackFavorablePrice(position, currentPrice, isLong, ts);

    const unrealizedPnlPct = isLong
      ? (currentPrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - currentPrice) / position.entryPrice;

    if (this.config.enableTpExtension && unrealizedPnlPct >= this.config.activationThresholdPct) {
      return this.applyTpExtension(position, tracker, currentTpPrice, isLong, unrealizedPnlPct);
    }

    return {
      tpUpdated: false,
      previousTp: currentTpPrice,
      newTp: currentTpPrice,
      reason: 'NO_CHANGE',
      currentUnrealizedPnlPct: unrealizedPnlPct,
      highestFavorablePrice: tracker.highestFavorablePrice,
    };
  }

  /**
   * Remove tracker when position is closed
   */
  onPositionClosed(symbol: string, side: 'LONG' | 'SHORT'): void {
    const positionKey = `${symbol}_${side}`;
    this.positionTrackers.delete(positionKey);
    logger.debug({ symbol, side }, '[TrailingStopManager] Position tracker removed');
  }

  /**
   * Get tracker info for monitoring/debugging
   */
  getTrackerInfo(symbol: string, side: 'LONG' | 'SHORT'): PositionTracker | undefined {
    const positionKey = `${symbol}_${side}`;
    return this.positionTrackers.get(positionKey);
  }

  /**
   * Get configuration
   */
  getConfig(): Readonly<TrailingStopConfig> {
    return { ...this.config };
  }

  /**
   * Private: Apply breakeven stop loss
   */
  private applyBreakeven(
    position: PortfolioPosition,
    tracker: PositionTracker,
    unrealizedPnlPct: number,
    timestamp: number
  ): TrailingStopResult {
    const isLong = position.side === 'LONG';
    
    // Calculate breakeven price (entry + small buffer for fees)
    const feeBufferPct = 0.001; // 0.1% buffer for fees
    const breakevenPrice = isLong
      ? position.entryPrice * (1 + feeBufferPct)
      : position.entryPrice * (1 - feeBufferPct);

    // Only move stop if it improves the position
    const shouldUpdate = isLong
      ? breakevenPrice > position.stopLossPrice
      : breakevenPrice < position.stopLossPrice;

    if (!shouldUpdate) {
      // Stop is already at or past breakeven (e.g. a tracker rebuilt after
      // restart against a resting order that had already trailed past it).
      // Latch anyway or this branch re-enters every tick and the trailing
      // branch below stays unreachable for the life of the position.
      tracker.breakevenApplied = true;
      return {
        stopUpdated: false,
        previousStop: position.stopLossPrice,
        newStop: position.stopLossPrice,
        reason: 'NO_CHANGE',
        currentUnrealizedPnlPct: unrealizedPnlPct,
        highestFavorablePrice: tracker.highestFavorablePrice,
      };
    }

    tracker.breakevenApplied = true;
    tracker.lastUpdateTimestamp = timestamp;

    logger.info(
      {
        symbol: position.symbol,
        side: position.side,
        oldStop: position.stopLossPrice,
        newStop: breakevenPrice,
      },
      '[TrailingStopManager] Breakeven stop applied'
    );

    return {
      stopUpdated: true,
      previousStop: position.stopLossPrice,
      newStop: breakevenPrice,
      reason: 'BREAKEVEN',
      currentUnrealizedPnlPct: unrealizedPnlPct,
      highestFavorablePrice: tracker.highestFavorablePrice,
    };
  }

  /**
   * Private: Apply trailing stop loss
   */
  private applyTrailingStop(
    position: PortfolioPosition,
    tracker: PositionTracker,
    currentPrice: number,
    isLong: boolean,
    timestamp: number
  ): TrailingStopResult {
    // Calculate trailing stop price based on highest favorable price
    const trailingStopPrice = isLong
      ? tracker.highestFavorablePrice * (1 - this.config.trailingDistancePct)
      : tracker.highestFavorablePrice * (1 + this.config.trailingDistancePct);

    // Only move stop if it improves the position (locks in more profit)
    const shouldUpdate = isLong
      ? trailingStopPrice > position.stopLossPrice
      : trailingStopPrice < position.stopLossPrice;

    if (!shouldUpdate) {
      return {
        stopUpdated: false,
        previousStop: position.stopLossPrice,
        newStop: position.stopLossPrice,
        reason: 'NO_CHANGE',
        currentUnrealizedPnlPct: isLong
          ? (currentPrice - position.entryPrice) / position.entryPrice
          : (position.entryPrice - currentPrice) / position.entryPrice,
        highestFavorablePrice: tracker.highestFavorablePrice,
      };
    }

    tracker.lastUpdateTimestamp = timestamp;

    logger.info(
      {
        symbol: position.symbol,
        side: position.side,
        oldStop: position.stopLossPrice,
        newStop: Number(trailingStopPrice.toFixed(2)),
        highestFavorablePrice: Number(tracker.highestFavorablePrice.toFixed(2)),
      },
      '[TrailingStopManager] Trailing stop updated'
    );

    return {
      stopUpdated: true,
      previousStop: position.stopLossPrice,
      newStop: trailingStopPrice,
      reason: 'TRAILING',
      currentUnrealizedPnlPct: isLong
        ? (currentPrice - position.entryPrice) / position.entryPrice
        : (position.entryPrice - currentPrice) / position.entryPrice,
      highestFavorablePrice: tracker.highestFavorablePrice,
    };
  }

  /**
   * Get or create a position's tracker and update its most favorable price
   * seen: the high for a LONG, the low for a SHORT.
   */
  private trackFavorablePrice(
    position: PortfolioPosition,
    currentPrice: number,
    isLong: boolean,
    timestamp: number
  ): PositionTracker {
    const positionKey = `${position.symbol}_${position.side}`;
    let tracker = this.positionTrackers.get(positionKey);
    if (!tracker) {
      tracker = {
        highestFavorablePrice: position.entryPrice,
        breakevenApplied: false,
        lastUpdateTimestamp: timestamp,
      };
      this.positionTrackers.set(positionKey, tracker);
    }

    tracker.highestFavorablePrice = isLong
      ? Math.max(tracker.highestFavorablePrice, currentPrice)
      : Math.min(tracker.highestFavorablePrice, currentPrice);

    return tracker;
  }

  /**
   * Private: Extend the take-profit target past the highest favorable price
   */
  private applyTpExtension(
    position: PortfolioPosition,
    tracker: PositionTracker,
    currentTpPrice: number,
    isLong: boolean,
    unrealizedPnlPct: number
  ): TrailingTakeProfitResult {
    const extendedTp = isLong
      ? tracker.highestFavorablePrice * (1 + this.config.tpExtensionPct)
      : tracker.highestFavorablePrice * (1 - this.config.tpExtensionPct);

    // Only move the target if it captures more of the move — never retract it.
    const shouldUpdate = isLong ? extendedTp > currentTpPrice : extendedTp < currentTpPrice;

    if (!shouldUpdate) {
      return {
        tpUpdated: false,
        previousTp: currentTpPrice,
        newTp: currentTpPrice,
        reason: 'NO_CHANGE',
        currentUnrealizedPnlPct: unrealizedPnlPct,
        highestFavorablePrice: tracker.highestFavorablePrice,
      };
    }

    logger.info(
      {
        symbol: position.symbol,
        side: position.side,
        oldTp: currentTpPrice,
        newTp: Number(extendedTp.toFixed(2)),
        highestFavorablePrice: Number(tracker.highestFavorablePrice.toFixed(2)),
      },
      '[TrailingStopManager] Take-profit extended'
    );

    return {
      tpUpdated: true,
      previousTp: currentTpPrice,
      newTp: extendedTp,
      reason: 'EXTENDED',
      currentUnrealizedPnlPct: unrealizedPnlPct,
      highestFavorablePrice: tracker.highestFavorablePrice,
    };
  }
}
