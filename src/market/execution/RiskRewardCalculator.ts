import type { ExecutionPlanConfig, TakeProfitTarget } from './types.js';

export const DEFAULT_EXECUTION_PLAN_CONFIG: ExecutionPlanConfig = {
  minTp1RiskReward: 1.5,
  minTp2RiskReward: 2.5,
  minTp3RiskReward: 3.0,
  tickBufferMultiplier: 2,
  maxCandleAgeBars: 30,
};

export class RiskRewardCalculator {
  static calculateRatios(
    entryPrice: number,
    stopLossPrice: number,
    takeProfits: TakeProfitTarget[]
  ): { riskDistance: number; riskReward: { tp1: number; tp2: number; tp3: number } } {
    const riskDist = Math.abs(entryPrice - stopLossPrice);
    const tp1 = takeProfits.find((t) => t.level === 1)?.riskReward ?? 0;
    const tp2 = takeProfits.find((t) => t.level === 2)?.riskReward ?? 0;
    const tp3 = takeProfits.find((t) => t.level === 3)?.riskReward ?? 0;

    return {
      riskDistance: riskDist,
      riskReward: { tp1, tp2, tp3 },
    };
  }

  static validateRiskReward(
    riskReward: { tp1: number; tp2: number; tp3: number },
    config = DEFAULT_EXECUTION_PLAN_CONFIG
  ): { isValid: boolean; failureReasons: string[] } {
    const failures: string[] = [];
    if (riskReward.tp1 < config.minTp1RiskReward) {
      failures.push(`TP1 R:R (${riskReward.tp1}) is below minimum (${config.minTp1RiskReward})`);
    }
    if (riskReward.tp2 < config.minTp2RiskReward) {
      failures.push(`TP2 R:R (${riskReward.tp2}) is below minimum (${config.minTp2RiskReward})`);
    }
    if (riskReward.tp3 < config.minTp3RiskReward) {
      failures.push(`TP3 R:R (${riskReward.tp3}) is below minimum (${config.minTp3RiskReward})`);
    }
    return { isValid: failures.length === 0, failureReasons: failures };
  }
}
