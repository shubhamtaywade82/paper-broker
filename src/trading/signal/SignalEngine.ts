import type { ExecutionPlan } from '../../market/execution/types.js';
import type { TakeProfitAllocation, TradeSignal } from './types.js';

export class SignalEngine {
  static translatePlan(plan: ExecutionPlan, asOf = Date.now()): TradeSignal {
    const signalKey = `${plan.symbol}:${plan.provenance.setupType}:${plan.setupCandidateId}:${plan.id}`;
    const takeProfits = this.buildAllocations(plan);

    return {
      id: `SIG:${plan.id}`,
      signalKey,
      symbol: plan.symbol,
      market: 'BINANCE_USDM',
      direction: plan.direction,
      status: plan.status === 'EXECUTABLE' ? 'VALIDATED' : 'AVOID',
      setupType: plan.provenance.setupType,
      confluenceScore: plan.provenance.confluenceScore,
      entryPrice: plan.entryPrice,
      entryZone: plan.entryZone,
      stopLossPrice: plan.stopLossPrice,
      stopLossReason: plan.stopLossReason,
      takeProfits,
      riskReward: plan.riskReward,
      riskRejectionReasons: plan.status === 'AVOID' ? plan.validationFailures : [],
      createdAt: asOf,
      expiresAt: plan.expiresAt,
      sourceSetupId: plan.setupCandidateId,
      sourceExecutionPlanId: plan.id,
      provenance: plan.provenance,
    };
  }

  private static buildAllocations(plan: ExecutionPlan): TakeProfitAllocation[] {
    const defaultSplits = [0.33, 0.33, 0.34];
    return plan.takeProfitLevels.map((tp, idx) => ({
      level: tp.level,
      price: tp.price,
      allocationPct: defaultSplits[idx] ?? 0.33,
      riskReward: tp.riskReward,
      reason: tp.reason,
    }));
  }
}
