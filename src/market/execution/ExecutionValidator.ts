import type { SetupCandidate } from '../setup/types.js';
import type { ExecutionPlanConfig, TakeProfitTarget } from './types.js';
import { DEFAULT_EXECUTION_PLAN_CONFIG, RiskRewardCalculator } from './RiskRewardCalculator.js';

export class ExecutionValidator {
  static validatePlan(
    candidate: SetupCandidate,
    entryPrice: number,
    stopLossPrice: number,
    takeProfits: TakeProfitTarget[],
    asOf: number,
    config: ExecutionPlanConfig = DEFAULT_EXECUTION_PLAN_CONFIG,
    isDataHealthy = true
  ): { isExecutable: boolean; failures: string[] } {
    const failures: string[] = [];

    if (candidate.status !== 'READY') {
      failures.push(`Setup candidate is not in READY state (current: ${candidate.status})`);
    }
    if (!isDataHealthy) {
      failures.push('Market data is desynchronized, stale, or degraded');
    }
    if (asOf > candidate.expiresAt) {
      failures.push(`Setup candidate has expired (expiresAt: ${candidate.expiresAt}, asOf: ${asOf})`);
    }

    this.validateGeometry(candidate.direction, entryPrice, stopLossPrice, takeProfits, failures);
    const { riskReward } = RiskRewardCalculator.calculateRatios(entryPrice, stopLossPrice, takeProfits);
    const rrValidation = RiskRewardCalculator.validateRiskReward(riskReward, config);
    if (!rrValidation.isValid) {
      failures.push(...rrValidation.failureReasons);
    }

    return {
      isExecutable: failures.length === 0,
      failures,
    };
  }

  private static validateGeometry(
    direction: string,
    entry: number,
    sl: number,
    tps: TakeProfitTarget[],
    failures: string[]
  ): void {
    if (entry <= 0 || sl <= 0) {
      failures.push('Entry or stop loss price is non-positive');
      return;
    }
    if (direction === 'LONG') {
      if (sl >= entry) failures.push(`Long stop loss (${sl}) must be strictly below entry (${entry})`);
      for (const tp of tps) {
        if (tp.price <= entry) failures.push(`Long take profit (${tp.price}) must be strictly above entry (${entry})`);
      }
    } else if (direction === 'SHORT') {
      if (sl <= entry) failures.push(`Short stop loss (${sl}) must be strictly above entry (${entry})`);
      for (const tp of tps) {
        if (tp.price >= entry) failures.push(`Short take profit (${tp.price}) must be strictly below entry (${entry})`);
      }
    }
  }
}
