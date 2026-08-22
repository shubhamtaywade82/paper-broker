import type { Instrument } from '../../broker/types.js';
import type { SetupCandidate } from '../setup/types.js';
import type { MultiTimeframeSmcContext } from '../smc/types.js';
import type { MultiTimeframeStructureState } from '../structure/types.js';
import { EntryCalculator } from './EntryCalculator.js';
import { ExecutionValidator } from './ExecutionValidator.js';
import { DEFAULT_EXECUTION_PLAN_CONFIG, RiskRewardCalculator } from './RiskRewardCalculator.js';
import { StopLossCalculator } from './StopLossCalculator.js';
import { TakeProfitCalculator } from './TakeProfitCalculator.js';
import type { ExecutionPlan, ExecutionPlanConfig } from './types.js';

export class ExecutionPlanEngine {
  private config: ExecutionPlanConfig;

  constructor(config: ExecutionPlanConfig = DEFAULT_EXECUTION_PLAN_CONFIG) {
    this.config = config;
  }

  generateExecutionPlan(
    candidate: SetupCandidate,
    structure: MultiTimeframeStructureState,
    smc: MultiTimeframeSmcContext,
    instrument?: Instrument,
    asOfTimestamp = Date.now(),
    isDataHealthy = true
  ): ExecutionPlan {
    const entryResult = EntryCalculator.calculateEntry(candidate, instrument);
    const entryPrice = entryResult?.entryPrice ?? 0;
    const entryZone = entryResult?.entryZone ?? { upper: 0, lower: 0 };

    const slResult = StopLossCalculator.calculateStopLoss(candidate, structure, instrument, this.config.tickBufferMultiplier);
    const stopLossPrice = slResult?.stopLossPrice ?? 0;
    const stopLossReason = slResult?.stopLossReason ?? 'No structural anchor available';

    const riskDist = Math.abs(entryPrice - stopLossPrice);
    const takeProfits = TakeProfitCalculator.calculateTakeProfits(candidate, entryPrice, riskDist, structure, smc, instrument);
    const { riskReward } = RiskRewardCalculator.calculateRatios(entryPrice, stopLossPrice, takeProfits);

    const validation = ExecutionValidator.validatePlan(
      candidate,
      entryPrice,
      stopLossPrice,
      takeProfits,
      asOfTimestamp,
      this.config,
      isDataHealthy
    );

    const status = validation.isExecutable ? 'EXECUTABLE' : 'AVOID';
    const rewardDist = takeProfits[0]?.rewardDistance ?? 0;

    return {
      id: `PLAN:${candidate.id}`,
      symbol: candidate.symbol,
      setupCandidateId: candidate.id,
      direction: candidate.direction,
      status,
      entryPrice,
      entryZone,
      stopLossPrice,
      stopLossReason,
      takeProfitLevels: takeProfits,
      riskReward,
      riskDistance: riskDist,
      rewardDistance: rewardDist,
      invalidation: {
        price: stopLossPrice,
        reason: stopLossReason,
        invalidationType: validation.isExecutable ? 'ZONE_INVALIDATION' : 'RR_INSUFFICIENT',
      },
      createdAt: asOfTimestamp,
      expiresAt: candidate.expiresAt,
      validationFailures: validation.failures,
      provenance: {
        setupType: candidate.setupType,
        confluenceScore: candidate.confluence.totalScore,
        sourceEventIds: candidate.sourceEventIds,
        sourceCandleTimes: candidate.sourceCandleTimes,
        reasoning: {
          entry: `Equilibrium of ${candidate.fvgEvidence ? 'FVG' : 'OB'} zone`,
          stop: stopLossReason,
          targets: takeProfits.map((t) => `TP${t.level}: ${t.price} (${t.reason})`).join(', '),
        },
      },
    };
  }
}
