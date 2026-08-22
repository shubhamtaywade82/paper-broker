import type {
  ConfluenceBreakdown,
  SetupCandidate,
  SetupConfig,
  SetupState,
} from './types.js';
import { ConfluenceScorer, DEFAULT_SETUP_CONFIG } from './ConfluenceScorer.js';

export class SetupStateMachine {
  static advanceState(
    candidate: SetupCandidate,
    asOf: number,
    config: SetupConfig = DEFAULT_SETUP_CONFIG,
    isDataHealthy = true
  ): SetupCandidate {
    if (candidate.status === 'INVALIDATED' || candidate.status === 'EXPIRED') return candidate;
    if (asOf > candidate.expiresAt) {
      return { ...candidate, state: 'EXPIRED', status: 'EXPIRED', updatedAt: asOf };
    }

    const nextState = this.determineNextState(candidate);
    const confluence = ConfluenceScorer.evaluateConfluence(candidate, config, isDataHealthy);
    const isReady = (nextState === 'TRIGGERED' || nextState === 'ZONE_IDENTIFIED' || nextState === 'RETEST') && confluence.totalScore >= config.minConfluenceScore;
    const finalState: SetupState = isReady ? 'READY' : nextState;
    const finalStatus = isReady ? ('READY' as const) : ('ACTIVE' as const);

    return {
      ...candidate,
      state: finalState,
      status: finalStatus,
      confluence,
      updatedAt: asOf,
      confirmedAt: isReady ? asOf : candidate.confirmedAt,
    };
  }

  private static determineNextState(c: SetupCandidate): SetupState {
    if (c.triggerEvidence && c.retestEvidence && (c.fvgEvidence || c.orderBlockEvidence) && c.structureEvidence) {
      return 'TRIGGERED';
    }
    if (c.retestEvidence && (c.fvgEvidence || c.orderBlockEvidence)) {
      return 'RETEST';
    }
    if (c.fvgEvidence || c.orderBlockEvidence) {
      return 'ZONE_IDENTIFIED';
    }
    if (c.structureEvidence) {
      return 'STRUCTURE_CONFIRMATION';
    }
    if (c.sweepEvidence) {
      return 'LIQUIDITY_INTERACTION';
    }
    return 'WATCHING';
  }

  static invalidateCandidate(candidate: SetupCandidate, reason: string, asOf: number): SetupCandidate {
    return {
      ...candidate,
      state: 'INVALIDATED',
      status: 'INVALIDATED',
      invalidationReason: reason,
      invalidatedAt: asOf,
      updatedAt: asOf,
    };
  }

  static createWatchingCandidate(
    params: Omit<SetupCandidate, 'state' | 'status' | 'confluence' | 'createdAt' | 'updatedAt' | 'expiresAt'>,
    asOf: number,
    ttlMs: number
  ): SetupCandidate {
    const emptyConfluence: ConfluenceBreakdown = {
      htfAlignmentScore: 0,
      structureScore: 0,
      liquiditySweepScore: 0,
      fvgScore: 0,
      orderBlockScore: 0,
      retestScore: 0,
      triggerScore: 0,
      dataQualityScore: 0,
      totalScore: 0,
      maxScore: 100,
      notes: [],
    };

    return {
      ...params,
      state: 'WATCHING',
      status: 'ACTIVE',
      createdAt: asOf,
      updatedAt: asOf,
      expiresAt: asOf + ttlMs,
      confluence: emptyConfluence,
    };
  }
}
