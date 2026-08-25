/**
 * Profit Goal Module Exports
 */

export { ProfitGoalManager } from './ProfitGoalManager.js';
export {
  DEFAULT_PROFIT_GOAL_CONFIG,
  createInitialProfitGoalState,
  checkTargetAchieved,
  calculateProfitGoalMetrics,
} from './ProfitGoalTypes.js';
export type {
  ProfitGoalConfig,
  ProfitGoalState,
  ProfitGoalMetrics,
  ProfitGoalUpdate,
} from './ProfitGoalTypes.js';
