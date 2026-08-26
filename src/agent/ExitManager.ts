import type { EventLog } from '../persistence/EventLog.js';
import type { WebSocketGateway } from '../api/websocket/WebSocketGateway.js';
import type { StrategyEngine } from '../strategy/StrategyEngine.js';
import type { MarketRegimeDetector } from '../analysis/MarketRegimeDetector.js';
import type { Position, AccountState } from '../broker/types.js';
import type { SignalInput } from '../strategy/signal.js';
import type { TradePlan } from '../risk/AdaptiveRiskManager.js';
import type { SetupCandidate } from '../market/setup/types.js';
import type { PerSymbolState } from './types.js';
import { logger } from '../telemetry/logger.js';
import { metrics } from '../telemetry/metrics.js';

export type ExitReason =
  | 'REGIME_FLIP'
  | 'UNREALIZED_LOSS_BREACH'
  | 'SETUP_INVALIDATED'
  | 'TRAILING_STOP_RECOMMENDED'
  | 'DOWNSIDE_DERISK';

export interface ExitDecision {
  symbol: string;
  action: 'EXIT_NOW' | 'HOLD' | 'SCALE_OUT';
  reason: ExitReason | null;
  /** Confidence attached to the close signal — currently fixed at 0.9 because a model-confidence probe on exits would be overkill. */
  confidence: number;
  /** Diagnostic context for the broadcast / event log. */
  context: Record<string, unknown>;
}

/** Result of a scale-in (pyramid) evaluation — always informative, `submitted` flags whether an add actually went out. */
export interface ScaleInDecision {
  symbol: string;
  action: 'SCALE_IN';
  /** True when an OPEN add signal was accepted by the engine. */
  submitted: boolean;
  /** Human-readable why / why-not — surfaced on the cycle summary. */
  reason: string;
  /** Quantity added (0 when not submitted). */
  addQty: number;
  /** Total adds taken on this position so far (after this decision). */
  addsTaken: number;
  /** The setup archetype that justified the add, when one was found. */
  setupType: string | null;
  setupState: string | null;
  confluenceScore: number | null;
}

/**
 * Position-scaling configuration (AUTONOMY_AUDIT Finding 2). Two behaviours:
 *
 *  - SCALE_IN (pyramid into winners): when an open position is profitable
 *    enough AND a fresh aligned READY setup confirms the move, add a fraction
 *    of the current position size. Adds carry their own SL/TP (from a fresh
 *    AdaptiveRiskManager plan) so every unit of exposure stays protected.
 *  - SCALE_OUT (de-risk losers): when unrealized loss reaches the trigger
 *    band (but is still below the full-breach threshold), close a fraction
 *    of the position once — cut the loss size before the stop fires while
 *    leaving a runner for recovery.
 *
 * Both are disabled when `enabled: false` (the default when no scaling config
 * is supplied, so existing constructions behave exactly as before).
 */
export interface ScalingConfig {
  enabled: boolean;
  /** Unrealized profit as a fraction of EQUITY required before a pyramid add (e.g. 0.01 = 1%). */
  scaleInMinProfitPct: number;
  /** Each add's quantity as a fraction of the CURRENT position size (classic decreasing pyramid). */
  scaleInSizeFraction: number;
  /** Max adds per position lifecycle. */
  scaleInMaxAdds: number;
  /** Min time between adds on the same position. */
  scaleInCooldownMs: number;
  /** Unrealized loss (fraction of equity) that triggers a one-time partial de-risk. Must be < maxUnrealizedLossPct. */
  scaleOutTriggerPct: number;
  /** Fraction of the position closed by the de-risk (e.g. 0.5 = close half). */
  scaleOutCloseFraction: number;
}

export interface ExitManagerConfig {
  /** If true, flatten a position whose regime has flipped against it. */
  exitOnRegimeFlip: boolean;
  /** If unrealized loss (as fraction of equity) exceeds this, force-exit. 0 = disabled. */
  maxUnrealizedLossPct: number;
  /** Agent's strategy ID — used in the close signal so the StrategyEngine routes it correctly. */
  strategyId: string;
  /** Position-scaling (Finding 2). Optional — absent = scaling disabled. */
  scaling?: ScalingConfig;
}

export interface ExitManagerDeps {
  eventLog: EventLog;
  wsGateway: WebSocketGateway;
  strategyEngine: StrategyEngine;
  regimeDetector: MarketRegimeDetector;
  /** All currently open positions (the broker's view). */
  getPositions: () => Position[];
  /** Latest account state (for maxUnrealizedLossPct). */
  getAccount: () => AccountState;
  /** Latest price for a symbol — used to evaluate unrealized P&L. */
  getLastPrice: (symbol: string) => number | undefined;
  /** Forget any trailing-stop tracker the TrailingStopController holds for this symbol. */
  forgetTrailingStop?: (symbol: string) => void;
}

/**
 * Intra-position decision layer.
 *
 * The existing TrailingStopController already manages the mechanical exit
 * (price hits trailing stop → reduceOnly STOP_MARKET fires). What that
 * controller does NOT do, and what this ExitManager adds, is:
 *
 *   1. Regime-flip exits: if the HTF regime has changed against the
 *      position direction since entry, flatten before the stop fires.
 *      Example: opened a LONG in TRENDING_STRONG, regime is now
 *      TRENDING_STRONG ↓ flip ↓ VOLATILE_BREAKOUT (which the adaptation
 *      table treats as defensive) → exit, don't ride it out.
 *   2. Emergency exit: if unrealized loss as a fraction of equity exceeds
 *      the configured threshold, flatten immediately (independent of regime).
 *   3. Setup invalidation: if the SetupEngine has marked the setup the agent
 *      is tracking as INVALIDATED or EXPIRED, exit (the original thesis is
 *      dead — don't keep the position on life support).
 *   4. Downside de-risk (SCALE_OUT): between the de-risk trigger and the
 *      full-breach threshold, cut a fraction of the position once — the
 *      thesis isn't dead but the loss is big enough to want less of it.
 *   5. Pyramid adds (SCALE_IN): when the position is profitable AND a fresh
 *      aligned READY setup confirms the move, add a fraction of the current
 *      size with its own SL/TP (evaluated on demand by the agent, see
 *      {@link evaluateScaleIn}).
 *
 * Exits are submitted through the same StrategyEngine.submitSignal path the
 * entries use, with `features.cooldownMs = 0` so the close isn't blocked by
 * the agent's own per-strategy:symbol cooldown. Partial closes additionally
 * carry `features.closeFraction` (read by SignalExecutor) and a `dedupKey`
 * (read by StrategyEngine's dedup) so a de-risk can never double-fire nor
 * collide with a later full exit. After a confirmed full close, the manager
 * calls `forgetTrailingStop(symbol)` to clear any resting trailing-stop
 * tracker in the TrailingStopController — otherwise the next `onPrice` tick
 * would try to move a stop on a position that no longer exists.
 */
export class ExitManager {
  /** Per-position pyramid state — keyed by position identity (symbol + open time + entry). */
  private scaleInTracker = new Map<string, { adds: number; lastAt: number }>();
  /** Position keys that already took their one-time downside de-risk. */
  private scaledOutPositions = new Set<string>();

  constructor(
    private readonly config: ExitManagerConfig,
    private readonly deps: ExitManagerDeps
  ) {}

  /**
   * Walk the currently open positions owned by the agent and decide what to
   * do with each. Side-effecting: submits close signals and forgets trailing
   * stops for any position it acts on.
   *
   * @returns the per-symbol exit decisions broadcast to the dashboard.
   */
  async evaluateExits(
    perSymbol: Map<string, PerSymbolState>,
    cycleId: string,
    now = Date.now()
  ): Promise<ExitDecision[]> {
    const positions = this.deps.getPositions();
    const account = this.deps.getAccount();
    const decisions: ExitDecision[] = [];
    const livePositionKeys = new Set<string>();

    for (const position of positions) {
      if (position.status !== 'OPEN' || position.qty === 0) continue;

      const decision = this.evaluateOne(position, perSymbol, account, now);
      decisions.push(decision);
      livePositionKeys.add(this.positionKey(position));

      if (decision.action === 'EXIT_NOW') {
        const ok = await this.submitClose(position, decision, cycleId, now);
        if (ok) {
          this.deps.forgetTrailingStop?.(position.symbol);
        }
      } else if (decision.action === 'SCALE_OUT') {
        // Partial close — the trailing-stop tracker stays live because the
        // position survives the de-risk.
        await this.submitScaleOut(position, decision, cycleId, now);
      }
    }

    // Forget per-position scaling state for positions that no longer exist
    // (closed / flipped since last cycle) so a fresh position starts with a
    // clean pyramid budget and de-risk allowance.
    for (const key of Array.from(this.scaleInTracker.keys())) {
      if (!livePositionKeys.has(key)) this.scaleInTracker.delete(key);
    }
    for (const key of Array.from(this.scaledOutPositions)) {
      if (!livePositionKeys.has(key)) this.scaledOutPositions.delete(key);
    }
    return decisions;
  }

  /**
   * Evaluate a single position. Pure (no side effects) — exposed so tests
   * can verify the decision logic without submitting real close signals.
   */
  evaluateOne(
    position: Position,
    perSymbol: Map<string, PerSymbolState>,
    account: AccountState,
    now: number
  ): ExitDecision {
    const sym = position.symbol;
    const last = this.deps.getLastPrice(sym);
    if (!last) {
      return { symbol: sym, action: 'HOLD', reason: null, confidence: 0, context: { note: 'no last price' } };
    }

    // 1. Emergency exit: unrealized loss exceeds max pct of equity.
    if (this.config.maxUnrealizedLossPct > 0 && account.equity > 0) {
      const unrealized = this.computeUnrealizedPct(position, last, account.equity);
      if (unrealized <= -this.config.maxUnrealizedLossPct) {
        return {
          symbol: sym,
          action: 'EXIT_NOW',
          reason: 'UNREALIZED_LOSS_BREACH',
          confidence: 0.95,
          context: { unrealized, threshold: -this.config.maxUnrealizedLossPct, equity: account.equity },
        };
      }
    }

    // 2. Regime-flip exit. Compare the regime at entry time (recorded on the
    // per-symbol state's trackingSetup) to the regime now. We don't need
    // the SetupEngine here — the agent's per-symbol state already tracks
    // the regime via the regimeDetector in the main cycle.
    const symState = perSymbol.get(sym);
    if (symState && this.config.exitOnRegimeFlip) {
      const entryRegime = symState.regime?.regime ?? 'TRANSITIONING';
      // Re-detect the current regime. This is a cheap call (feature
      // extraction on 100 closed 4h candles) and the agent already runs
      // the same detect() in its main loop, but we re-do it here so the
      // exit manager doesn't depend on the agent's cycle timing.
      const mtf = undefined; // RegimeDetector.detect tolerates undefined mtf.
      const current = this.deps.regimeDetector.detect(sym, mtf, now);
      const currentRegime = current?.regime ?? symState.regime?.regime ?? 'TRANSITIONING';
      const entryAdaptation = this.deps.regimeDetector.getAdaptation(entryRegime as never);
      const currentAdaptation = this.deps.regimeDetector.getAdaptation(currentRegime as never);
      // Heuristic: if the regime's riskMultiplier dropped by ≥ 30%, the
      // regime has shifted against us enough to flatten.
      const riskMultDrop = entryAdaptation.riskMultiplier - currentAdaptation.riskMultiplier;
      const directionLong = position.qty > 0;
      // Bullish regimes (strong/normal trending) favor longs; bearish
      // favor shorts. If we entered in a strong trend and the regime is
      // now ranging or transitioning, that's a flip regardless of direction.
      const enteredTrend = entryRegime === 'TRENDING_STRONG' || entryRegime === 'TRENDING_NORMAL';
      const nowChoppy = currentRegime === 'RANGING_HIGH_VOL' || currentRegime === 'TRANSITIONING';
      const directionMismatch =
        (directionLong && (currentRegime === 'RANGING_HIGH_VOL')) ||
        (!directionLong && currentRegime === 'TRENDING_STRONG');
      if (riskMultDrop >= 0.3 || (enteredTrend && nowChoppy) || directionMismatch) {
        return {
          symbol: sym,
          action: 'EXIT_NOW',
          reason: 'REGIME_FLIP',
          confidence: 0.9,
          context: {
            entryRegime,
            currentRegime,
            riskMultDrop,
            directionLong,
            directionMismatch,
          },
        };
      }
    }

    // 3. Setup invalidation. If the agent is tracking a setup for this symbol
    // and that setup is now INVALIDATED or EXPIRED, exit.
    if (symState?.trackingSetup) {
      const setupState = symState.trackingSetup.state;
      if (setupState === 'INVALIDATED' || setupState === 'EXPIRED') {
        return {
          symbol: sym,
          action: 'EXIT_NOW',
          reason: 'SETUP_INVALIDATED',
          confidence: 0.9,
          context: { setupState, setupType: symState.trackingSetup.setupType },
        };
      }
    }

    // 4. Downside de-risk (SCALE_OUT, Finding 2): the loss has reached the
    // de-risk trigger band but is still below the full-breach threshold from
    // check 1. Cut a fraction of the position ONCE — smaller loss exposure
    // while the runner keeps upside / stop protection. Order matters: this
    // runs after every EXIT_NOW check, so a full breach or regime flip
    // always takes the whole position instead.
    const scaling = this.config.scaling;
    if (scaling?.enabled && scaling.scaleOutTriggerPct > 0 && account.equity > 0) {
      const unrealized = this.computeUnrealizedPct(position, last, account.equity);
      const posKey = this.positionKey(position);
      const alreadyDerisked = this.scaledOutPositions.has(posKey);
      if (unrealized <= -scaling.scaleOutTriggerPct && !alreadyDerisked) {
        return {
          symbol: sym,
          action: 'SCALE_OUT',
          reason: 'DOWNSIDE_DERISK',
          confidence: 0.7,
          context: {
            unrealized,
            trigger: -scaling.scaleOutTriggerPct,
            fullBreachAt: -this.config.maxUnrealizedLossPct,
            closeFraction: scaling.scaleOutCloseFraction,
          },
        };
      }
    }

    return { symbol: sym, action: 'HOLD', reason: null, confidence: 0, context: {} };
  }

  /**
   * Submit a CLOSE_LONG / CLOSE_SHORT signal for the given position. Returns
   * true if the close was accepted (EXECUTED or ACCEPTED), false otherwise.
   * Side-effecting: emits event log + WS broadcast + increments metrics.
   */
  private async submitClose(
    position: Position,
    decision: ExitDecision,
    cycleId: string,
    now: number
  ): Promise<boolean> {
    const isLong = position.qty > 0;
    const action: SignalInput['action'] = isLong ? 'CLOSE_LONG' : 'CLOSE_SHORT';
    const signalInput: SignalInput = {
      strategyId: this.config.strategyId,
      symbol: position.symbol,
      action,
      confidence: decision.confidence,
      ttlMs: 30_000,
      reasoning: `[AutonomousAgent ExitManager] ${decision.reason} | ${decision.context['entryRegime'] ?? ''}→${decision.context['currentRegime'] ?? ''}`,
      // cooldownMs=0 so the close isn't blocked by the per-strategy:symbol
      // cooldown the agent's own entries set up.
      features: { cooldownMs: 0 },
    };
    try {
      const submitted = await this.deps.strategyEngine.submitSignal(signalInput);
      const accepted = Boolean(submitted && (submitted.status === 'EXECUTED' || submitted.status === 'ACCEPTED'));
      metrics.inc(accepted ? 'autonomous_exits_submitted_total' : 'autonomous_exits_rejected_total');
      this.deps.eventLog.appendSystemEvent({
        eventType: 'AUTONOMOUS_EXIT_SIGNAL',
        payload: {
          cycleId,
          symbol: position.symbol,
          action,
          reason: decision.reason,
          accepted,
          signalId: submitted?.id,
          rejectReason: submitted?.rejectReason,
          decisionContext: decision.context,
        },
        createdAtUtc: new Date(now).toISOString(),
      });
      this.deps.wsGateway.broadcast('agent.autonomous.exit', {
        cycleId,
        symbol: position.symbol,
        action,
        reason: decision.reason,
        accepted,
        signalId: submitted?.id,
        context: decision.context,
      });
      if (!accepted) {
        logger.warn(
          { symbol: position.symbol, action, rejectReason: submitted?.rejectReason, reason: decision.reason },
          'Exit manager: close signal rejected'
        );
      }
      return accepted;
    } catch (err) {
      logger.error({ err, symbol: position.symbol, action, reason: decision.reason }, 'Exit manager: close signal threw');
      return false;
    }
  }

  /**
   * Stable identity for a position lifecycle — used to key per-position
   * scaling state (pyramid budget, one-time de-risk) so a new position on
   * the same symbol starts with a clean slate. open time is the primary
   * discriminator; entry price is the fallback for fixtures without one.
   */
  private positionKey(position: Position): string {
    return `${position.symbol}@${position.openedAtUtc ?? `entry-${position.entryPrice}`}`;
  }

  /**
   * Submit a partial CLOSE for the given position (SCALE_OUT / downside
   * de-risk). Mirrors {@link submitClose} but:
   *   - `features.closeFraction` tells SignalExecutor to close only a
   *     fraction of the position instead of flattening it
   *   - `features.dedupKey` (stable per position) makes the engine's dedup
   *     drop an accidental double-fire of the SAME de-risk while still
   *     letting a later full EXIT through (different dedup semantics)
   *   - the trailing-stop tracker is NOT forgotten — the position survives
   * Records the position as de-risked ONLY when the close was accepted, so
   * a rejected de-risk is retried next cycle.
   */
  private async submitScaleOut(
    position: Position,
    decision: ExitDecision,
    cycleId: string,
    now: number
  ): Promise<boolean> {
    const scaling = this.config.scaling;
    if (!scaling) return false;
    const isLong = position.qty > 0;
    const action: SignalInput['action'] = isLong ? 'CLOSE_LONG' : 'CLOSE_SHORT';
    const posKey = this.positionKey(position);
    const signalInput: SignalInput = {
      strategyId: this.config.strategyId,
      symbol: position.symbol,
      action,
      confidence: decision.confidence,
      ttlMs: 30_000,
      reasoning: `[AutonomousAgent ScaleOut] ${decision.reason} | unrealized=${(
        (decision.context['unrealized'] as number) ?? 0
      ).toFixed(4)} of equity, closing ${(scaling.scaleOutCloseFraction * 100).toFixed(0)}%`,
      features: {
        cooldownMs: 0,
        closeFraction: scaling.scaleOutCloseFraction,
        dedupKey: `scale-out:${posKey}`,
        scaleOut: true,
      },
    };
    try {
      const submitted = await this.deps.strategyEngine.submitSignal(signalInput);
      const accepted = Boolean(
        submitted && (submitted.status === 'EXECUTED' || submitted.status === 'ACCEPTED')
      );
      metrics.inc(
        accepted ? 'autonomous_scale_outs_submitted_total' : 'autonomous_scale_outs_rejected_total'
      );
      this.deps.eventLog.appendSystemEvent({
        eventType: 'AUTONOMOUS_SCALE_OUT',
        payload: {
          cycleId,
          symbol: position.symbol,
          action,
          reason: decision.reason,
          closeFraction: scaling.scaleOutCloseFraction,
          accepted,
          signalId: submitted?.id,
          rejectReason: submitted?.rejectReason,
          decisionContext: decision.context,
        },
        createdAtUtc: new Date(now).toISOString(),
      });
      // Broadcast on the exit channel so the dashboard's exits feed shows
      // the de-risk inline with full exits (payload is a superset of the
      // agent.autonomous.exit contract; extra keys are stripped by the
      // dashboard's zod schema).
      this.deps.wsGateway.broadcast('agent.autonomous.exit', {
        cycleId,
        symbol: position.symbol,
        action,
        reason: decision.reason,
        accepted,
        signalId: submitted?.id,
        partial: true,
        closeFraction: scaling.scaleOutCloseFraction,
        context: decision.context,
      });
      if (accepted) {
        this.scaledOutPositions.add(posKey);
      } else {
        logger.warn(
          { symbol: position.symbol, action, rejectReason: submitted?.rejectReason },
          'Exit manager: scale-out close signal rejected — will retry next cycle'
        );
      }
      return accepted;
    } catch (err) {
      logger.error({ err, symbol: position.symbol, action }, 'Exit manager: scale-out signal threw');
      return false;
    }
  }

  /**
   * Evaluate a pyramid add (SCALE_IN, Finding 2) for one open position and,
   * when every gate passes, submit it. Called by the agent's main loop for
   * in-position symbols — the agent supplies the fresh trade plan (which
   * already gates on regime tradeability + min RR) and the current READY
   * setups, this method owns the scaling rules:
   *
   *   1. scaling enabled
   *   2. new entries allowed (circuit breaker not tripped)
   *   3. unrealized profit ≥ scaleInMinProfitPct of equity
   *   4. a READY setup aligned with the position direction clears minConfluence
   *   5. a fresh plan exists (the regime can still pay for the add's stop)
   *   6. adds taken < scaleInMaxAdds for this position lifecycle
   *   7. enough time since the last add on this position
   *
   * The add's quantity is a fraction of the CURRENT position size (classic
   * decreasing pyramid) and carries its own SL/TP from the fresh plan, so
   * every unit of added exposure is independently protected. The signal uses
   * a per-add `dedupKey` so the engine's identity dedup neither blocks the
   * add after the original entry nor allows the same add to double-fire.
   *
   * @returns the decision (with a human-readable reason either way), or null
   * when scaling is disabled entirely.
   */
  async evaluateScaleIn(
    position: Position,
    setups: SetupCandidate[],
    plan: TradePlan | null,
    opts: {
      allowNewEntries: boolean;
      minConfluence: number;
      runtimeRiskMultiplier: number;
      /**
       * Correlated-exposure gate (AUTONOMY_AUDIT Finding 8): called with the
       * prospective add's notional and leverage just before submission. When
       * provided and it disallows, the add is skipped with a reason — a
       * pyramid add is margin added to the same correlated cluster and must
       * clear the same cap a fresh entry would.
       */
      correlationCheck?: (addNotional: number, leverage: number) => { allowed: boolean; reason: string };
    },
    cycleId: string,
    now = Date.now()
  ): Promise<ScaleInDecision | null> {
    const scaling = this.config.scaling;
    if (!scaling?.enabled) return null;
    const symbol = position.symbol;
    const posKey = this.positionKey(position);
    const tracker = this.scaleInTracker.get(posKey) ?? { adds: 0, lastAt: 0 };
    const direction: 'LONG' | 'SHORT' = position.qty > 0 ? 'LONG' : 'SHORT';
    const base = { symbol, action: 'SCALE_IN' as const, addQty: 0, addsTaken: tracker.adds };

    const last = this.deps.getLastPrice(symbol);
    const account = this.deps.getAccount();
    if (!last || account.equity <= 0) {
      return { ...base, submitted: false, reason: 'No last price / account state for scale-in', setupType: null, setupState: null, confluenceScore: null };
    }

    if (!opts.allowNewEntries) {
      return { ...base, submitted: false, reason: 'Circuit breaker tripped — no pyramid adds', setupType: null, setupState: null, confluenceScore: null };
    }

    // 3. Profit gate — only pyramid into winners.
    const unrealizedPct = this.computeUnrealizedPct(position, last, account.equity);
    if (unrealizedPct < scaling.scaleInMinProfitPct) {
      return {
        ...base,
        submitted: false,
        reason: `Unrealized ${(unrealizedPct * 100).toFixed(2)}% < scale-in threshold ${(scaling.scaleInMinProfitPct * 100).toFixed(2)}%`,
        setupType: null, setupState: null, confluenceScore: null,
      };
    }

    // 4. Fresh aligned READY setup must confirm the move.
    const aligned = setups
      .filter((s) => s.status === 'READY' && s.direction === direction)
      .sort((a, b) => b.confluence.totalScore - a.confluence.totalScore);
    const best = aligned[0];
    if (!best || best.confluence.totalScore < opts.minConfluence) {
      return {
        ...base,
        submitted: false,
        reason: 'No aligned READY setup above min confluence — holding',
        setupType: best?.setupType ?? null,
        setupState: best?.state ?? null,
        confluenceScore: best?.confluence.totalScore ?? null,
      };
    }

    // 5. Fresh plan — regime tradeability + min RR are baked into it.
    if (!plan) {
      return {
        ...base,
        submitted: false,
        reason: 'Fresh trade plan rejected (regime min RR / stale candles) — no add',
        setupType: best.setupType,
        setupState: best.state,
        confluenceScore: best.confluence.totalScore,
      };
    }

    // 6. Pyramid budget.
    if (tracker.adds >= scaling.scaleInMaxAdds) {
      return {
        ...base,
        submitted: false,
        reason: `Pyramid budget exhausted (${tracker.adds}/${scaling.scaleInMaxAdds} adds)`,
        setupType: best.setupType,
        setupState: best.state,
        confluenceScore: best.confluence.totalScore,
      };
    }

    // 7. Add cooldown.
    if (tracker.lastAt > 0 && now - tracker.lastAt < scaling.scaleInCooldownMs) {
      const remainingMs = scaling.scaleInCooldownMs - (now - tracker.lastAt);
      return {
        ...base,
        submitted: false,
        reason: `Scale-in cooldown active (${Math.ceil(remainingMs / 1000)}s remaining)`,
        setupType: best.setupType,
        setupState: best.state,
        confluenceScore: best.confluence.totalScore,
      };
    }

    // All gates passed — build and submit the add.
    const addQty = Math.abs(position.qty) * scaling.scaleInSizeFraction;
    if (addQty <= 0) {
      return { ...base, submitted: false, reason: 'Computed add quantity is zero', setupType: best.setupType, setupState: best.state, confluenceScore: best.confluence.totalScore };
    }

    // 7.5. Correlated-exposure capacity (Finding 8): the add's notional is
    // margin added to the candidate's cluster — check it BEFORE building the
    // signal, same as the agent's entry path does at gate 17.5.
    if (opts.correlationCheck) {
      const check = opts.correlationCheck(addQty * last, plan.leverage);
      if (!check.allowed) {
        return {
          ...base,
          submitted: false,
          reason: `Correlated exposure cap: ${check.reason}`,
          setupType: best.setupType,
          setupState: best.state,
          confluenceScore: best.confluence.totalScore,
        };
      }
    }

    const addNumber = tracker.adds + 1;
    const confidence = Math.max(0.55, Math.min(0.95, 0.5 + best.confluence.totalScore / 200));
    const action: SignalInput['action'] = direction === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT';
    const signalInput: SignalInput = {
      strategyId: this.config.strategyId,
      symbol,
      action,
      confidence,
      stopLossPrice: String(plan.stopLossPrice.toFixed(8)),
      takeProfitPrice: String(plan.takeProfitPrice.toFixed(8)),
      ttlMs: 30_000,
      reasoning: `[AutonomousAgent ScaleIn] add ${addNumber}/${scaling.scaleInMaxAdds} ${best.setupType} ${direction} | regime=${plan.adaptation.regime} unrealized=+${(unrealizedPct * 100).toFixed(2)}% | ${plan.adaptation.rationale}`,
      features: {
        quantity: addQty,
        leverage: plan.leverage,
        cooldownMs: 0,
        pyramid: true,
        scaleIn: true,
        dedupKey: `scale-in:${posKey}:${addNumber}`,
        runtimeRiskMultiplier: opts.runtimeRiskMultiplier,
        regimeBias: plan.regimeBias,
      },
    };

    try {
      const submitted = await this.deps.strategyEngine.submitSignal(signalInput);
      const accepted = Boolean(
        submitted && (submitted.status === 'EXECUTED' || submitted.status === 'ACCEPTED')
      );
      metrics.inc(
        accepted ? 'autonomous_scale_ins_submitted_total' : 'autonomous_scale_ins_rejected_total'
      );
      if (accepted) {
        this.scaleInTracker.set(posKey, { adds: addNumber, lastAt: now });
      }
      this.deps.eventLog.appendSystemEvent({
        eventType: 'AUTONOMOUS_SCALE_IN',
        payload: {
          cycleId,
          symbol,
          action,
          addNumber,
          maxAdds: scaling.scaleInMaxAdds,
          addQty,
          confidence,
          setupType: best.setupType,
          regime: plan.adaptation.regime,
          unrealizedPct,
          accepted,
          signalId: submitted?.id,
          rejectReason: submitted?.rejectReason,
        },
        createdAtUtc: new Date(now).toISOString(),
      });
      // Broadcast on the signal channel so the dashboard's signals feed
      // shows the add inline with fresh entries (payload matches the
      // agent.autonomous.signal contract; extra keys are stripped).
      this.deps.wsGateway.broadcast('agent.autonomous.signal', {
        cycleId,
        symbol,
        action,
        confidence,
        regime: plan.adaptation.regime,
        setupType: best.setupType,
        confluenceScore: best.confluence.totalScore,
        entryPrice: plan.entryPrice,
        stopLossPrice: plan.stopLossPrice,
        takeProfitPrice: plan.takeProfitPrice,
        leverage: plan.leverage,
        sizePct: scaling.scaleInSizeFraction,
        rr: plan.rr,
        rationale: signalInput.reasoning ?? '',
        submittedAt: now,
        signalId: submitted?.id,
      });
      if (!accepted) {
        logger.warn(
          { symbol, action, rejectReason: submitted?.rejectReason, addNumber },
          'Exit manager: scale-in add rejected'
        );
      }
      return {
        symbol,
        action: 'SCALE_IN',
        submitted: accepted,
        reason: accepted
          ? `Pyramid add ${addNumber}/${scaling.scaleInMaxAdds} submitted (${addQty.toFixed(6)} ${direction} @ ~${plan.entryPrice})`
          : `Scale-in rejected by executor: ${submitted?.rejectReason ?? 'unknown'}`,
        addQty: accepted ? addQty : 0,
        addsTaken: accepted ? addNumber : tracker.adds,
        setupType: best.setupType,
        setupState: best.state,
        confluenceScore: best.confluence.totalScore,
      };
    } catch (err) {
      logger.error({ err, symbol, action }, 'Exit manager: scale-in signal threw');
      return {
        symbol,
        action: 'SCALE_IN',
        submitted: false,
        reason: 'Scale-in submission threw',
        addQty: 0,
        addsTaken: tracker.adds,
        setupType: best.setupType,
        setupState: best.state,
        confluenceScore: best.confluence.totalScore,
      };
    }
  }

  /**
   * Compute unrealized P&L as a fraction of equity. For a LONG, unrealized =
   * (last - entry) * qty. For a SHORT, unrealized = (entry - last) * qty.
   * Returns the fraction (not the absolute USDT).
   *
   * Note: the broker already computes `position.unrealizedPnl` and the
   * account-level `unrealizedPnl`, but we re-compute here so the exit
   * manager's decision is purely a function of the most recent tick — the
   * broker's value may lag by one cycle.
   */
  private computeUnrealizedPct(position: Position, last: number, equity: number): number {
    if (equity <= 0) return 0;
    const qty = position.qty;
    const entry = position.entryPrice;
    const unrealized = (qty > 0 ? (last - entry) : (entry - last)) * Math.abs(qty);
    return unrealized / equity;
  }
}
