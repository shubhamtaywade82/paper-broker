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
    const positionKey = `${position.symbol}_${position.side}`;
    const ts = timestamp ?? Date.now();
    
    // Get or create tracker for this position
    let tracker = this.positionTrackers.get(positionKey);
    if (!tracker) {
      tracker = {
        highestFavorablePrice: position.entryPrice,
        breakevenApplied: false,
        lastUpdateTimestamp: ts,
      };
      this.positionTrackers.set(positionKey, tracker);
    }

    // Track the most favorable price reached: the high for a LONG, the low for a SHORT.
    const isLong = position.side === 'LONG';
    tracker.highestFavorablePrice = isLong
      ? Math.max(tracker.highestFavorablePrice, currentPrice)
      : Math.min(tracker.highestFavorablePrice, currentPrice);

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
   * Clear all trackers (useful for reset scenarios)
   */
  clearAllTrackers(): void {
    this.positionTrackers.clear();
    logger.info('[TrailingStopManager] All trackers cleared');
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
}
