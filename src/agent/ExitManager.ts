import type { EventLog } from '../persistence/EventLog.js';
import type { WebSocketGateway } from '../api/websocket/WebSocketGateway.js';
import type { StrategyEngine } from '../strategy/StrategyEngine.js';
import type { MarketRegimeDetector } from '../analysis/MarketRegimeDetector.js';
import type { Position, AccountState } from '../broker/types.js';
import type { SignalInput } from '../strategy/signal.js';
import type { PerSymbolState } from './types.js';
import { logger } from '../telemetry/logger.js';
import { metrics } from '../telemetry/metrics.js';

export type ExitReason =
  | 'REGIME_FLIP'
  | 'UNREALIZED_LOSS_BREACH'
  | 'SETUP_INVALIDATED'
  | 'TRAILING_STOP_RECOMMENDED';

export interface ExitDecision {
  symbol: string;
  action: 'EXIT_NOW' | 'HOLD';
  reason: ExitReason | null;
  /** Confidence attached to the close signal — currently fixed at 0.9 because a model-confidence probe on exits would be overkill. */
  confidence: number;
  /** Diagnostic context for the broadcast / event log. */
  context: Record<string, unknown>;
}

export interface ExitManagerConfig {
  /** If true, flatten a position whose regime has flipped against it. */
  exitOnRegimeFlip: boolean;
  /** If unrealized loss (as fraction of equity) exceeds this, force-exit. 0 = disabled. */
  maxUnrealizedLossPct: number;
  /** Agent's strategy ID — used in the close signal so the StrategyEngine routes it correctly. */
  strategyId: string;
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
 *
 * Exits are submitted through the same StrategyEngine.submitSignal path the
 * entries use, with `features.cooldownMs = 0` so the close isn't blocked by
 * the agent's own per-strategy:symbol cooldown. After a confirmed close,
 * the manager calls `forgetTrailingStop(symbol)` to clear any resting
 * trailing-stop tracker in the TrailingStopController — otherwise the next
 * `onPrice` tick would try to move a stop on a position that no longer exists.
 */
export class ExitManager {
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

    for (const position of positions) {
      if (position.status !== 'OPEN' || position.qty === 0) continue;

      const decision = this.evaluateOne(position, perSymbol, account, now);
      decisions.push(decision);

      if (decision.action === 'EXIT_NOW') {
        const ok = await this.submitClose(position, decision, cycleId, now);
        if (ok) {
          this.deps.forgetTrailingStop?.(position.symbol);
        }
      }
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
