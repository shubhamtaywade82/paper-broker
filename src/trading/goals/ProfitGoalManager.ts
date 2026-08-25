/**
 * Profit Goal Manager
 * 
 * Tracks and manages profit targets for daily/weekly/monthly trading goals.
 * Integrates with RiskEngine to enforce risk reduction after target achievement.
 * 
 * Key Features:
 * - Real-time PnL tracking against configurable profit targets
 * - Automatic risk reduction when targets are achieved
 * - Cooldown periods to prevent giving back profits
 * - Metrics calculation for goal achievement analysis
 */

import { logger } from '../../telemetry/logger.js';
import type { ProfitGoalConfig, ProfitGoalState, ProfitGoalMetrics, ProfitGoalUpdate } from './ProfitGoalTypes.js';
import {
  DEFAULT_PROFIT_GOAL_CONFIG,
  createInitialProfitGoalState,
  checkTargetAchieved,
  calculateProfitGoalMetrics,
} from './ProfitGoalTypes.js';

export class ProfitGoalManager {
  private config: ProfitGoalConfig;
  private state: ProfitGoalState;
  private dailyPnLHistory: Array<{ date: string; pnl: number; equity: number }> = [];

  constructor(
    startingEquity: number,
    config: ProfitGoalConfig = DEFAULT_PROFIT_GOAL_CONFIG
  ) {
    this.config = config;
    this.state = createInitialProfitGoalState(startingEquity);
    logger.info(
      { startingEquity, config },
      '[ProfitGoalManager] Initialized with profit targets'
    );
  }

  /**
   * Update profit goal state with realized PnL from closed trades
   */
  updatePnL(update: ProfitGoalUpdate): void {
    const { realizedPnl, currentEquity, timestamp } = update;
    
    // Update running PnL totals
    this.state.dailyPnL += realizedPnl;
    this.state.weeklyPnL += realizedPnl;
    this.state.monthlyPnL += realizedPnl;

    // Check if targets are achieved
    this.checkAndSetTargets(currentEquity, timestamp);

    // Apply risk multiplier based on target achievement
    this.updateRiskMultiplier();

    logger.debug(
      {
        dailyPnL: this.state.dailyPnL,
        weeklyPnL: this.state.weeklyPnL,
        monthlyPnL: this.state.monthlyPnL,
        riskMultiplier: this.state.currentRiskMultiplier,
      },
      '[ProfitGoalManager] PnL updated'
    );
  }

  /**
   * Get the current risk multiplier to apply to position sizing
   * Returns 1.0 for normal trading, < 1.0 for reduced risk mode
   */
  getCurrentRiskMultiplier(): number {
    return this.state.currentRiskMultiplier;
  }

  /**
   * Check if trading should be allowed based on profit goal state
   * Returns false if STOP_TRADING action is active or cooldown is in effect
   */
  isTradingAllowed(timestamp: number): boolean {
    if (this.config.targetAchievedAction === 'STOP_TRADING') {
      if (this.state.dailyTargetAchieved || this.state.weeklyTargetAchieved) {
        return false;
      }
    }

    // Check cooldown period
    if (this.state.dailyTargetAchieved && this.state.dailyTargetAchievedAt) {
      const cooldownEnd = this.state.dailyTargetAchievedAt + this.config.cooldownAfterTargetMs;
      if (timestamp < cooldownEnd) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get current profit goal state for dashboard/reporting
   */
  getState(): Readonly<ProfitGoalState> {
    return { ...this.state };
  }

  /**
   * Get configuration
   */
  getConfig(): Readonly<ProfitGoalConfig> {
    return { ...this.config };
  }

  /**
   * Reset daily PnL (called at start of each trading day)
   */
  resetDaily(newStartingEquity: number): void {
    const now = Date.now();
    const prevDayPnL = this.state.dailyPnL;

    // Record previous day's metrics
    if (this.state.lastDailyReset > 0) {
      const prevDay = new Date(this.state.lastDailyReset).toISOString().slice(0, 10);
      this.dailyPnLHistory.push({
        date: prevDay,
        pnl: prevDayPnL,
        equity: this.state.dailyStartingEquity,
      });
    }

    this.state.dailyPnL = 0;
    this.state.dailyStartingEquity = newStartingEquity;
    this.state.dailyTargetAchieved = false;
    this.state.dailyTargetAchievedAt = undefined;
    this.state.lastDailyReset = now;
    this.state.reducedRiskActive = false;
    this.state.currentRiskMultiplier = 1.0;

    logger.info({ newStartingEquity, prevDayPnL }, '[ProfitGoalManager] Daily reset complete');
  }

  /**
   * Reset weekly PnL (called at start of each week)
   */
  resetWeekly(newStartingEquity: number): void {
    this.state.weeklyPnL = 0;
    this.state.weeklyStartingEquity = newStartingEquity;
    this.state.weeklyTargetAchieved = false;
    this.state.weeklyTargetAchievedAt = undefined;
    this.state.lastWeeklyReset = Date.now();

    logger.info({ newStartingEquity }, '[ProfitGoalManager] Weekly reset complete');
  }

  /**
   * Reset monthly PnL (called at start of each month)
   */
  resetMonthly(newStartingEquity: number): void {
    this.state.monthlyPnL = 0;
    this.state.monthlyStartingEquity = newStartingEquity;
    this.state.monthlyTargetAchieved = false;
    this.state.monthlyTargetAchievedAt = undefined;
    this.state.lastMonthlyReset = Date.now();

    logger.info({ newStartingEquity }, '[ProfitGoalManager] Monthly reset complete');
  }

  /**
   * Calculate profit goal metrics from historical data
   */
  getMetrics(): ProfitGoalMetrics {
    return calculateProfitGoalMetrics(this.dailyPnLHistory, this.config);
  }

  /**
   * Get progress toward daily target as percentage (0-100%)
   */
  getDailyProgressPercent(): number {
    const targetAmount = this.state.dailyStartingEquity * this.config.dailyTargetPct;
    if (targetAmount <= 0) return 0;
    return Math.min(100, (this.state.dailyPnL / targetAmount) * 100);
  }

  /**
   * Get progress toward weekly target as percentage (0-100%)
   */
  getWeeklyProgressPercent(): number {
    const targetAmount = this.state.weeklyStartingEquity * this.config.weeklyTargetPct;
    if (targetAmount <= 0) return 0;
    return Math.min(100, (this.state.weeklyPnL / targetAmount) * 100);
  }

  /**
   * Get progress toward monthly target as percentage (0-100%)
   */
  getMonthlyProgressPercent(): number {
    const targetAmount = this.state.monthlyStartingEquity * this.config.monthlyTargetPct;
    if (targetAmount <= 0) return 0;
    return Math.min(100, (this.state.monthlyPnL / targetAmount) * 100);
  }

  /**
   * Check if any profit target has been achieved
   */
  isAnyTargetAchieved(): boolean {
    return (
      this.state.dailyTargetAchieved ||
      this.state.weeklyTargetAchieved ||
      this.state.monthlyTargetAchieved
    );
  }

  /**
   * Get which specific targets have been achieved
   */
  getAchievedTargets(): { daily: boolean; weekly: boolean; monthly: boolean } {
    return {
      daily: this.state.dailyTargetAchieved,
      weekly: this.state.weeklyTargetAchieved,
      monthly: this.state.monthlyTargetAchieved,
    };
  }

  /**
   * Private: Check and set target achievement flags
   */
  private checkAndSetTargets(currentEquity: number, timestamp: number): void {
    const now = timestamp || Date.now();

    // Check daily target
    if (this.config.enableDailyGoals && !this.state.dailyTargetAchieved) {
      if (checkTargetAchieved(this.state.dailyPnL, this.state.dailyStartingEquity, this.config.dailyTargetPct)) {
        this.state.dailyTargetAchieved = true;
        this.state.dailyTargetAchievedAt = now;
        logger.info(
          { dailyPnL: this.state.dailyPnL, targetPct: this.config.dailyTargetPct },
          '[ProfitGoalManager] Daily profit target achieved!'
        );
      }
    }

    // Check weekly target
    if (this.config.enableWeeklyGoals && !this.state.weeklyTargetAchieved) {
      if (checkTargetAchieved(this.state.weeklyPnL, this.state.weeklyStartingEquity, this.config.weeklyTargetPct)) {
        this.state.weeklyTargetAchieved = true;
        this.state.weeklyTargetAchievedAt = now;
        logger.info(
          { weeklyPnL: this.state.weeklyPnL, targetPct: this.config.weeklyTargetPct },
          '[ProfitGoalManager] Weekly profit target achieved!'
        );
      }
    }

    // Check monthly target
    if (this.config.enableMonthlyGoals && !this.state.monthlyTargetAchieved) {
      if (checkTargetAchieved(this.state.monthlyPnL, this.state.monthlyStartingEquity, this.config.monthlyTargetPct)) {
        this.state.monthlyTargetAchieved = true;
        this.state.monthlyTargetAchievedAt = now;
        logger.info(
          { monthlyPnL: this.state.monthlyPnL, targetPct: this.config.monthlyTargetPct },
          '[ProfitGoalManager] Monthly profit target achieved!'
        );
      }
    }
  }

  /**
   * Private: Update risk multiplier based on target achievement and configured action
   */
  private updateRiskMultiplier(): void {
    const anyTargetAchieved = this.isAnyTargetAchieved();

    if (!anyTargetAchieved) {
      this.state.reducedRiskActive = false;
      this.state.currentRiskMultiplier = 1.0;
      return;
    }

    switch (this.config.targetAchievedAction) {
      case 'REDUCE_RISK':
        this.state.reducedRiskActive = true;
        this.state.currentRiskMultiplier = this.config.riskReductionFactor;
        break;

      case 'TRAIL_STOPS':
        // Trail stops logic would be handled by TrailingStopManager
        // Here we just reduce risk slightly
        this.state.reducedRiskActive = true;
        this.state.currentRiskMultiplier = 0.75;
        break;

      case 'STOP_TRADING':
        // Trading allowed flag is checked separately in isTradingAllowed()
        this.state.reducedRiskActive = true;
        this.state.currentRiskMultiplier = 0;
        break;

      default:
        this.state.currentRiskMultiplier = 1.0;
    }

    logger.debug(
      { action: this.config.targetAchievedAction, multiplier: this.state.currentRiskMultiplier },
      '[ProfitGoalManager] Risk multiplier updated'
    );
  }

  /**
   * Serialize state for persistence
   */
  toJSON(): object {
    return {
      config: this.config,
      state: this.state,
      history: this.dailyPnLHistory,
    };
  }

  /**
   * Deserialize state from persistence
   */
  static fromJSON(json: string, overrideEquity?: number): ProfitGoalManager {
    const data = JSON.parse(json) as {
      config: ProfitGoalConfig;
      state: ProfitGoalState;
      history: Array<{ date: string; pnl: number; equity: number }>;
    };

    const manager = new ProfitGoalManager(data.state.dailyStartingEquity, data.config);
    manager.state = data.state;
    manager.dailyPnLHistory = data.history;

    if (overrideEquity) {
      manager.state.dailyStartingEquity = overrideEquity;
      manager.state.weeklyStartingEquity = overrideEquity;
      manager.state.monthlyStartingEquity = overrideEquity;
    }

    return manager;
  }
}
