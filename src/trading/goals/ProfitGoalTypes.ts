/**
 * Profit Goal Types and Interfaces
 * 
 * Defines the configuration and state tracking for profit-based trading goals.
 * This enables the system to transition from "always trading" to "trading for specific financial targets."
 */

export interface ProfitGoalConfig {
  /** Daily profit target as percentage of equity (e.g., 0.02 = 2%) */
  dailyTargetPct: number;
  
  /** Weekly profit target as percentage of equity (e.g., 0.08 = 8%) */
  weeklyTargetPct: number;
  
  /** Monthly profit target as percentage of equity (e.g., 0.20 = 20%) */
  monthlyTargetPct: number;
  
  /** Action to take when target is achieved */
  targetAchievedAction: 'REDUCE_RISK' | 'STOP_TRADING' | 'TRAIL_STOPS';
  
  /** Risk reduction factor when target achieved (e.g., 0.5 = cut risk in half) */
  riskReductionFactor: number;
  
  /** Cooldown period after target achievement before resuming normal trading */
  cooldownAfterTargetMs: number;
  
  /** Enable/disable daily profit goals */
  enableDailyGoals: boolean;
  
  /** Enable/disable weekly profit goals */
  enableWeeklyGoals: boolean;
  
  /** Enable/disable monthly profit goals */
  enableMonthlyGoals: boolean;
}

export interface ProfitGoalState {
  /** Current day's realized PnL */
  dailyPnL: number;
  
  /** Current week's realized PnL */
  weeklyPnL: number;
  
  /** Current month's realized PnL */
  monthlyPnL: number;
  
  /** Starting equity for current day */
  dailyStartingEquity: number;
  
  /** Starting equity for current week */
  weeklyStartingEquity: number;
  
  /** Starting equity for current month */
  monthlyStartingEquity: number;
  
  /** Whether daily target has been achieved */
  dailyTargetAchieved: boolean;
  
  /** Whether weekly target has been achieved */
  weeklyTargetAchieved: boolean;
  
  /** Whether monthly target has been achieved */
  monthlyTargetAchieved: boolean;
  
  /** Timestamp when daily target was achieved */
  dailyTargetAchievedAt?: number;
  
  /** Timestamp when weekly target was achieved */
  weeklyTargetAchievedAt?: number;
  
  /** Timestamp when monthly target was achieved */
  monthlyTargetAchievedAt?: number;
  
  /** Whether reduced risk mode is currently active */
  reducedRiskActive: boolean;
  
  /** Current risk multiplier (1.0 = normal, 0.5 = half risk, etc.) */
  currentRiskMultiplier: number;
  
  /** Last reset timestamp for daily PnL */
  lastDailyReset: number;
  
  /** Last reset timestamp for weekly PnL */
  lastWeeklyReset: number;
  
  /** Last reset timestamp for monthly PnL */
  lastMonthlyReset: number;
}

export interface ProfitGoalMetrics {
  /** Number of days target was achieved */
  daysTargetAchieved: number;
  
  /** Number of days traded */
  totalDaysTraded: number;
  
  /** Daily goal achievement rate (0-1) */
  dailyGoalAchievementRate: number;
  
  /** Average time to reach daily target (in minutes) */
  avgTimeToTargetMinutes: number;
  
  /** Total profit captured on target-achieving days */
  profitOnTargetDays: number;
  
  /** Total loss on non-target days */
  lossOnNonTargetDays: number;
  
  /** Best single-day profit percentage */
  bestDayPct: number;
  
  /** Worst single-day loss percentage */
  worstDayPct: number;
  
  /** Consecutive days achieving target */
  consecutiveTargetDays: number;
  
  /** Longest streak of target-achieving days */
  longestTargetStreak: number;
}

export interface ProfitGoalUpdate {
  /** Realized PnL from a closed trade */
  realizedPnl: number;
  
  /** Current account equity */
  currentEquity: number;
  
  /** Timestamp of the update */
  timestamp: number;
}

export const DEFAULT_PROFIT_GOAL_CONFIG: ProfitGoalConfig = {
  dailyTargetPct: 0.02,        // 2% daily
  weeklyTargetPct: 0.08,       // 8% weekly
  monthlyTargetPct: 0.20,      // 20% monthly
  targetAchievedAction: 'REDUCE_RISK',
  riskReductionFactor: 0.5,    // Cut risk in half after target
  cooldownAfterTargetMs: 3600000, // 1 hour cooldown
  enableDailyGoals: true,
  enableWeeklyGoals: true,
  enableMonthlyGoals: false,   // Disabled by default for flexibility
};

export function createInitialProfitGoalState(
  startingEquity: number,
  config: ProfitGoalConfig = DEFAULT_PROFIT_GOAL_CONFIG
): ProfitGoalState {
  const now = Date.now();
  
  return {
    dailyPnL: 0,
    weeklyPnL: 0,
    monthlyPnL: 0,
    dailyStartingEquity: startingEquity,
    weeklyStartingEquity: startingEquity,
    monthlyStartingEquity: startingEquity,
    dailyTargetAchieved: false,
    weeklyTargetAchieved: false,
    monthlyTargetAchieved: false,
    reducedRiskActive: false,
    currentRiskMultiplier: 1.0,
    lastDailyReset: now,
    lastWeeklyReset: now,
    lastMonthlyReset: now,
  };
}

/**
 * Check if a profit goal has been achieved based on current PnL and target
 */
export function checkTargetAchieved(
  currentPnL: number,
  startingEquity: number,
  targetPct: number
): boolean {
  if (startingEquity <= 0 || targetPct <= 0) return false;
  const targetAmount = startingEquity * targetPct;
  return currentPnL >= targetAmount;
}

/**
 * Calculate profit goal metrics from historical data
 */
export function calculateProfitGoalMetrics(
  dailyPnLHistory: Array<{ date: string; pnl: number; equity: number }>,
  config: ProfitGoalConfig
): ProfitGoalMetrics {
  if (dailyPnLHistory.length === 0) {
    return {
      daysTargetAchieved: 0,
      totalDaysTraded: 0,
      dailyGoalAchievementRate: 0,
      avgTimeToTargetMinutes: 0,
      profitOnTargetDays: 0,
      lossOnNonTargetDays: 0,
      bestDayPct: 0,
      worstDayPct: 0,
      consecutiveTargetDays: 0,
      longestTargetStreak: 0,
    };
  }
  
  let daysTargetAchieved = 0;
  let profitOnTargetDays = 0;
  let lossOnNonTargetDays = 0;
  let bestDayPct = -Infinity;
  let worstDayPct = Infinity;
  let consecutiveTargetDays = 0;
  let longestTargetStreak = 0;
  let currentStreak = 0;
  
  for (const day of dailyPnLHistory) {
    const dayPct = day.pnl / day.equity;
    const targetAchieved = dayPct >= config.dailyTargetPct;
    
    if (targetAchieved) {
      daysTargetAchieved++;
      profitOnTargetDays += day.pnl;
      currentStreak++;
      longestTargetStreak = Math.max(longestTargetStreak, currentStreak);
    } else {
      if (day.pnl < 0) {
        lossOnNonTargetDays += Math.abs(day.pnl);
      }
      currentStreak = 0;
    }
    
    bestDayPct = Math.max(bestDayPct, dayPct);
    worstDayPct = Math.min(worstDayPct, dayPct);
  }
  
  consecutiveTargetDays = currentStreak;
  
  return {
    daysTargetAchieved,
    totalDaysTraded: dailyPnLHistory.length,
    dailyGoalAchievementRate: daysTargetAchieved / dailyPnLHistory.length,
    avgTimeToTargetMinutes: 0, // Would need intraday data to calculate
    profitOnTargetDays,
    lossOnNonTargetDays,
    bestDayPct: bestDayPct === -Infinity ? 0 : bestDayPct,
    worstDayPct: worstDayPct === Infinity ? 0 : worstDayPct,
    consecutiveTargetDays,
    longestTargetStreak,
  };
}
