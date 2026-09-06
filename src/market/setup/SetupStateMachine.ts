import type {
  ConfluenceBreakdown,
  SetupCandidate,
  SetupConfig,
  SetupState,
} from './types.js';
import { ConfluenceScorer, DEFAULT_SETUP_CONFIG } from './ConfluenceScorer.js';

/**
 * Live market slice the state machine can use for the CANONICAL
 * price-progression states (APPROACHING / AT_ZONE). Optional — when absent,
 * the state machine falls back to the legacy evidence-driven progression.
 */
export interface SetupMarketContext {
  /** Last traded price at evaluation time. */
  currentPrice: number;
  /** Entry zone attached to the setup (scenario / execution plan). */
  entryZone?: { upper: number; lower: number } | null;
  /** ATR on the trigger timeframe, for the APPROACHING proximity band. */
  atr?: number;
}

/** APPROACHING fires within this many ATRs of the zone edge. */
const APPROACH_ATR_MULTIPLE = 1.0;

export class SetupStateMachine {
  static advanceState(
    candidate: SetupCandidate,
    asOf: number,
    config: SetupConfig = DEFAULT_SETUP_CONFIG,
    isDataHealthy = true,
    market?: SetupMarketContext
  ): SetupCandidate {
    if (candidate.status === 'INVALIDATED' || candidate.status === 'EXPIRED') return candidate;
    if (asOf > candidate.expiresAt) {
      return { ...candidate, state: 'EXPIRED', status: 'EXPIRED', updatedAt: asOf };
    }

    const nextState = market
      ? this.determineCanonicalState(candidate, market)
      : this.determineNextState(candidate);
    const confluence = ConfluenceScorer.evaluateConfluence(candidate, config, isDataHealthy);
    const isReady = (nextState === 'TRIGGERED' || nextState === 'ZONE_IDENTIFIED' || nextState === 'RETEST' || nextState === 'CONFIRMED') && confluence.totalScore >= config.minConfluenceScore;
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

  /**
   * Legacy evidence-driven progression (Phase-5 behaviour, preserved for
   * callers without a live market context).
   */
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

  /**
   * CANONICAL price-progression:
   *   WATCHING → APPROACHING → AT_ZONE → TRIGGER_DETECTED → CONFIRMED
   *
   * Price near/inside the entry zone drives APPROACHING/AT_ZONE; evidence
   * (structure event, retest, trigger) drives TRIGGER_DETECTED/CONFIRMED.
   * A candidate with no zone falls back to pure evidence progression.
   */
  private static determineCanonicalState(c: SetupCandidate, market: SetupMarketContext): SetupState {
    const zone = market.entryZone ?? c.executionPlan?.entryZone ?? null;
    const hasStructure = Boolean(c.structureEvidence);
    const hasTrigger = Boolean(c.triggerEvidence);
    const hasRetest = Boolean(c.retestEvidence);

    const structureConfirmed = hasStructure && (hasRetest || hasTrigger);

    if (!zone) {
      // No zone to approach — evidence-only progression.
      if (structureConfirmed) return 'CONFIRMED';
      if (hasTrigger || hasStructure) return 'TRIGGER_DETECTED';
      return 'WATCHING';
    }

    const proximity = market.atr && market.atr > 0 ? market.atr * APPROACH_ATR_MULTIPLE : zone.upper * 0.004;
    const long = c.direction === 'LONG';

    // Distance from the zone, direction-aware.
    const distance = long
      ? zone.lower - market.currentPrice // below zone → positive = hasn't arrived
      : market.currentPrice - zone.upper;

    const atZone = long
      ? market.currentPrice <= zone.upper && market.currentPrice >= zone.lower
      : market.currentPrice >= zone.lower && market.currentPrice <= zone.upper;

    if (atZone) {
      if (structureConfirmed) return 'CONFIRMED';
      if (hasTrigger || hasStructure) return 'TRIGGER_DETECTED';
      return 'AT_ZONE';
    }

    if (distance > 0 && distance <= proximity) {
      // Approaching the zone; an already-confirmed structure keeps its credit.
      return structureConfirmed ? 'CONFIRMED' : 'APPROACHING';
    }

    // Price beyond the zone in trade direction (zone already left behind).
    if (distance <= 0) {
      return structureConfirmed ? 'CONFIRMED' : hasTrigger ? 'TRIGGER_DETECTED' : 'AT_ZONE';
    }

    return structureConfirmed ? 'CONFIRMED' : 'WATCHING';
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

  /** Transition a READY setup into post-execution lifecycle states. */
  static markExecuted(candidate: SetupCandidate, asOf: number): SetupCandidate {
    if (candidate.status !== 'READY') return candidate;
    return { ...candidate, state: 'EXECUTED', status: 'ACTIVE', updatedAt: asOf };
  }

  static markManaging(candidate: SetupCandidate, asOf: number): SetupCandidate {
    if (candidate.state !== 'EXECUTED') return candidate;
    return { ...candidate, state: 'MANAGING', updatedAt: asOf };
  }

  static markCompleted(candidate: SetupCandidate, asOf: number): SetupCandidate {
    if (candidate.state !== 'EXECUTED' && candidate.state !== 'MANAGING') return candidate;
    return { ...candidate, state: 'COMPLETED', status: 'ACTIVE', updatedAt: asOf };
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
