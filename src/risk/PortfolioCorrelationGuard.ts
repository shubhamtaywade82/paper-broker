import type { Position } from '../broker/types.js';
import type { Candle } from '../strategy/indicators.js';

/**
 * Portfolio-level correlation risk (AUTONOMY_AUDIT Finding 8).
 *
 * The agent's portfolio-cap gate (`openPositions.length >= maxOpenPositions`)
 * is count-based: it happily allows BTC + ETH + SOL all long simultaneously
 * because that's three positions, not one. In crypto those three are usually
 * one bet — when BTC dumps, all three lose at once. This guard caps the
 * margin-weighted exposure a candidate may ADD to its correlated cluster.
 *
 * How it works:
 *   1. Estimate pairwise correlation between the candidate symbol and every
 *      open position from rolling close-to-close returns (Pearson, N candles
 *      of the configured timeframe).
 *   2. A position compounds the candidate's risk only when the two P&L
 *      streams are effectively co-moving: correlation × direction-agreement
 *      ≥ correlationFloor. Same-direction + positive ρ is the classic
 *      "BTC/ETH/SOL all long" cluster; opposite-direction + positive ρ (or
 *      same-direction + negative ρ) is a hedge and is NOT counted — crediting
 *      hedges as risk-reducers would be over-clever for a guard whose job is
 *      to say no.
 *   3. Exposure is measured in MARGIN (committed capital), not notional:
 *      open positions use the broker's own `initialMargin`, the candidate
 *      uses notional / leverage. Margin already bakes in the leverage the
 *      risk manager chose, so a 10x scalp and a 2x swing are compared in
 *      the units the account actually has at stake.
 *   4. The candidate is rejected when
 *      candidateMargin + Σ effectively-correlated margins > cap × equity.
 *
 * Data honesty: when either side of a pair has too little candle history to
 * estimate a correlation, the pair is treated as UNCORRELATED but the result
 * is flagged `insufficientData` so the operator can see the estimate was
 * partial. Silently assuming ρ=1 for unknown pairs would block every entry
 * on newly listed symbols — too blunt for a default-on guard.
 */
export interface PortfolioCorrelationGuardConfig {
  /** Master switch — false makes evaluate() a pass-through. */
  enabled: boolean;
  /** |Pearson ρ| at or above this the pair counts as correlated (default 0.7). */
  correlationFloor: number;
  /** Max same-direction correlated margin as a fraction of equity (default 0.25). */
  maxCorrelatedExposurePct: number;
  /** Candles per symbol used for the correlation estimate (default 50). */
  lookbackCandles: number;
  /** Timeframe of the candle series used for the estimate (default '1h'). */
  timeframe: string;
  /** Minimum candles BOTH sides must have before a correlation is trusted (default 30). */
  minCandlesForEstimate: number;
}

export const DEFAULT_CORRELATION_GUARD_CONFIG: PortfolioCorrelationGuardConfig = {
  enabled: true,
  correlationFloor: 0.7,
  maxCorrelatedExposurePct: 0.25,
  lookbackCandles: 50,
  timeframe: '1h',
  minCandlesForEstimate: 30,
};

/** One open position that was counted into the correlated cluster. */
export interface CorrelatedPosition {
  symbol: string;
  /** Signed Pearson correlation with the candidate (positive = co-moving). */
  correlation: number;
  direction: 'LONG' | 'SHORT';
  /** Margin committed as a fraction of equity. */
  exposurePct: number;
}

export interface CorrelationExposureCheck {
  /** False when the candidate would breach the correlated-exposure cap. */
  allowed: boolean;
  /** Candidate margin + same-direction correlated margins, as fraction of equity. */
  correlatedExposurePct: number;
  /** The cap as a fraction of equity (mirrors config). */
  capPct: number;
  /** Open positions counted into the cluster (empty when none correlate). */
  correlatedPositions: CorrelatedPosition[];
  /** Candidate's own margin as a fraction of equity. */
  candidateExposurePct: number;
  /** True when at least one pair had insufficient data and was assumed uncorrelated. */
  insufficientData: boolean;
  /** Human-readable verdict for the cycle decision log. */
  reason: string;
}

export interface CorrelationCandidate {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  /** Absolute notional value of the intended position (qty × entry price). */
  notional: number;
  /** Leverage of the intended position — margin = notional / leverage. */
  leverage: number;
}

export interface PortfolioCorrelationGuardDeps {
  /** Closed candles for a symbol/timeframe — injected for testability. */
  getCandles: (symbol: string, timeframe: string, count: number) => Candle[];
}

export class PortfolioCorrelationGuard {
  private readonly config: PortfolioCorrelationGuardConfig;
  private readonly deps: PortfolioCorrelationGuardDeps;

  constructor(config: PortfolioCorrelationGuardConfig, deps: PortfolioCorrelationGuardDeps) {
    this.config = config;
    this.deps = deps;
  }

  /**
   * Decide whether the candidate fits inside the correlated-exposure cap.
   * Always returns a check object (never throws) — a guard failure must
   * degrade to "no correlation data", not to a crashed cycle.
   *
   * @param opts.includeSameSymbol count the candidate's OWN open position
   *   into the cluster (ρ = 1 by definition). Used for scale-in checks where
   *   the add compounds an existing same-symbol position; fresh entries
   *   keep the default because per-symbol position limits already govern
   *   them.
   */
  evaluate(
    candidate: CorrelationCandidate,
    openPositions: Position[],
    equity: number,
    opts: { includeSameSymbol?: boolean } = {}
  ): CorrelationExposureCheck {
    const capPct = this.config.maxCorrelatedExposurePct;
    if (!this.config.enabled) {
      return {
        allowed: true,
        correlatedExposurePct: 0,
        capPct,
        correlatedPositions: [],
        candidateExposurePct: 0,
        insufficientData: false,
        reason: 'Correlation guard disabled',
      };
    }
    if (equity <= 0 || candidate.leverage <= 0) {
      return {
        allowed: true,
        correlatedExposurePct: 0,
        capPct,
        correlatedPositions: [],
        candidateExposurePct: 0,
        insufficientData: false,
        reason: 'No equity / leverage data for correlation check',
      };
    }

    const candidateExposurePct = candidate.notional / candidate.leverage / equity;
    const candidateReturns = this.returnsFor(candidate.symbol);

    const correlatedPositions: CorrelatedPosition[] = [];
    let clusterExposurePct = candidateExposurePct;
    let insufficientData = false;

    for (const position of openPositions) {
      if (position.status !== 'OPEN') continue;
      const sameSymbol = position.symbol === candidate.symbol;
      if (sameSymbol && !opts.includeSameSymbol) continue;

      const direction: 'LONG' | 'SHORT' =
        position.positionSide === 'SHORT' || position.qty < 0 ? 'SHORT' : 'LONG';

      // A symbol trivially correlates with itself (ρ = 1); otherwise
      // estimate from returns when BOTH sides have enough history.
      let correlation = 1;
      if (!sameSymbol) {
        const otherReturns = this.returnsFor(position.symbol);
        if (
          candidateReturns.length < this.config.minCandlesForEstimate ||
          otherReturns.length < this.config.minCandlesForEstimate
        ) {
          insufficientData = true;
          continue;
        }
        correlation = pearson(candidateReturns, otherReturns);
      }

      // Effective correlation = ρ × direction agreement. Two longs on
      // positively-correlated symbols lose together (+1 × ρ = ρ); a long and
      // a short on positively-correlated symbols offset (−1 × ρ ≤ 0 →
      // hedge, skip); same-direction on negatively-correlated symbols also
      // offset (ρ ≤ −floor → skip).
      const directionAgreement = direction === candidate.direction ? 1 : -1;
      const effectiveCorrelation = directionAgreement * correlation;
      if (effectiveCorrelation < this.config.correlationFloor) continue;

      const margin = position.initialMargin > 0
        ? position.initialMargin
        : Math.abs(position.qty) * position.entryPrice / Math.max(1, position.leverage);
      const exposurePct = margin / equity;
      clusterExposurePct += exposurePct;
      correlatedPositions.push({
        symbol: position.symbol,
        correlation,
        direction,
        exposurePct,
      });
    }

    const allowed = clusterExposurePct <= capPct + 1e-9;
    const parts = [
      `correlated exposure ${(clusterExposurePct * 100).toFixed(1)}% vs cap ${(capPct * 100).toFixed(0)}%`,
      correlatedPositions.length > 0
        ? `cluster: ${correlatedPositions.map((p) => `${p.symbol}(ρ=${p.correlation.toFixed(2)}, ${(p.exposurePct * 100).toFixed(1)}%)`).join(', ')}`
        : 'no correlated open positions',
      insufficientData ? 'some pairs lacked data and were assumed uncorrelated' : '',
    ].filter(Boolean);

    return {
      allowed,
      correlatedExposurePct: clusterExposurePct,
      capPct,
      correlatedPositions,
      candidateExposurePct,
      insufficientData,
      reason: parts.join(' | '),
    };
  }

  /** Close-to-close log returns for a symbol, newest last. */
  private returnsFor(symbol: string): number[] {
    try {
      const candles = this.deps.getCandles(symbol, this.config.timeframe, this.config.lookbackCandles)
        .filter((c) => c.isClosed);
      const returns: number[] = [];
      for (let i = 1; i < candles.length; i++) {
        const prev = candles[i - 1]!.close;
        const cur = candles[i]!.close;
        if (prev > 0 && cur > 0) returns.push(Math.log(cur / prev));
      }
      return returns;
    } catch {
      return [];
    }
  }
}

/** Pearson correlation of two equal-length series (shortest wins). */
function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const xs = a.slice(-n);
  const ys = b.slice(-n);
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const vx = xs[i]! - mx;
    const vy = ys[i]! - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  const denom = Math.sqrt(dx * dy);
  if (denom <= 0) return 0;
  return Math.max(-1, Math.min(1, num / denom));
}
