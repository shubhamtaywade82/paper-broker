import type { EventLog } from '../persistence/EventLog.js';
import type { WebSocketGateway } from '../api/websocket/WebSocketGateway.js';
import type { StrategyEngine } from '../strategy/StrategyEngine.js';
import type { SetupEngine } from '../market/setup/SetupEngine.js';
import type { MtfStateEngine } from '../market/MtfStateEngine.js';
import type { MarketRegimeDetector } from '../analysis/MarketRegimeDetector.js';
import type { AdaptiveRiskManager, TradePlan } from '../risk/AdaptiveRiskManager.js';
import type { ModelManager } from '../ai/ModelManager.js';
import type { SignalInput } from '../strategy/signal.js';
import type { SetupCandidate } from '../market/setup/types.js';
import type { Position, AccountState } from '../broker/types.js';
import type {
  PerSymbolState,
  AutonomousCycleSummary,
  AutonomousSignalRecord,
} from './types.js';
import type { PerformanceTracker } from './PerformanceTracker.js';
import type { CircuitBreaker } from './CircuitBreaker.js';
import type { ExitManager } from './ExitManager.js';
import type { HealthMonitor } from './HealthMonitor.js';
import { logger } from '../telemetry/logger.js';
import { metrics } from '../telemetry/metrics.js';

export interface AutonomousTradingAgentConfig {
  /** Symbols to survey each cycle. */
  symbols: string[];
  /** Cycle interval in ms (must be ≥ 5s — see env.ts). */
  cycleMs: number;
  /** Minimum confluence score (0..100) for a setup to be considered READY. */
  minConfluence: number;
  /** Minimum reward:risk ratio enforced by the agent (regime may push higher). */
  minRR: number;
  /** Max concurrent open positions across the portfolio. */
  maxOpenPositions: number;
  /** Max positions per symbol (typically 1). */
  perSymbolMaxPositions: number;
  /** Cooldown after an entry attempt on a symbol (ms). */
  cooldownMs: number;
  /** Strategy ID used for signals submitted by the agent. */
  strategyId: string;
  /** Minimum LLM/model confidence (0..1) for an entry. */
  minConfidence: number;
  /** Consecutive bars that must agree before a regime change is committed. */
  regimeConfirmationBars: number;
}

export interface AutonomousTradingAgentDeps {
  setupEngine: SetupEngine;
  mtfEngine: MtfStateEngine;
  regimeDetector: MarketRegimeDetector;
  riskManager: AdaptiveRiskManager;
  modelManager: ModelManager;
  strategyEngine: StrategyEngine;
  eventLog: EventLog;
  wsGateway: WebSocketGateway;
  /** Returns the current open positions (for the in-position state and budget checks). */
  getPositions: () => Position[];
  /** Returns the current account state (for size + daily-loss checks). */
  getAccount: () => AccountState;
  /** Returns the last price for a symbol (used as the entry assumption). */
  getLastPrice: (symbol: string) => number | undefined;
  /** The performance tracker — the agent's "memory" of recent trade outcomes. */
  performanceTracker: PerformanceTracker;
  /** The circuit breaker — self-preservation: trips on losses / drawdown / unhealthy market. */
  circuitBreaker: CircuitBreaker;
  /** The exit manager — decides when to flatten positions before the trailing stop fires. */
  exitManager: ExitManager;
  /** The health monitor — probes kline / market / model liveness each cycle. */
  healthMonitor: HealthMonitor;
}

/**
 * Autonomous trading agent.
 *
 * This is the "runs by itself" loop the user's vision calls for. Unlike the
 * existing strategy fleet, which fires on Binance candle-close events, this
 * agent polls on its own clock (default 30s) and:
 *
 *   1. Surveys every configured symbol's MTF state and HTF (4h) regime.
 *   2. Detects FORMING setups (state WATCHING..RETEST) — i.e. setups that
 *      haven't completed yet but are assembling. These are surfaced to the
 *      dashboard as `agent.autonomous.forming` events so the operator can
 *      see what the agent is *about* to act on.
 *   3. For READY setups with HTF/LTF alignment, builds a regime-adjusted
 *      trade plan (stop, target, leverage, size) via AdaptiveRiskManager,
 *      runs an optional model-confidence probe via ModelManager, and
 *      submits a Signal through StrategyEngine.submitSignal — the same
 *      pipeline regular strategies use, so cooldown / conflict / executor
 *      guardrails all apply.
 *   4. Detects regime transitions and emits `AUTONOMOUS_REGIME_CHANGE` to
 *      the event log + `agent.autonomous.regime` to the dashboard.
 *   5. Tracks per-symbol state between cycles so the agent's "memory" of
 *      what each symbol was doing survives the next poll.
 *   6. **(Brain)** Each cycle, the PerformanceTracker refreshes its rolling
 *      window from the durable EventLog and suggests a runtime risk multiplier
 *      based on recent realised win rate. The agent applies that multiplier
 *      on top of the regime overlay's riskMultiplier.
 *   7. **(Self-preservation)** Before any new entry, the CircuitBreaker
 *      checks daily loss, drawdown, consecutive losses, and market health.
 *      A tripped breaker refuses new entries for the cooldown period.
 *   8. **(Exits)** The ExitManager walks open positions and may flatten any
 *      whose regime has flipped, whose setup has invalidated, or whose
 *      unrealized loss has breached the configured threshold.
 *   9. **(Self-diagnostics)** The HealthMonitor probes kline freshness, market
 *      state staleness, model reachability, and recent WS disconnects. A
 *      degraded state trips the breaker via the `requireHealthyMarket` config.
 *
 * The agent is **always safe by default**:
 *   - Disabled by env (AUTONOMOUS_AGENT_ENABLED=false) → never constructed.
 *   - Regime is TRANSITIONING → stand aside, no entries.
 *   - HTF trend misaligns with setup direction → skip.
 *   - Confluence below threshold → skip.
 *   - RR below regime minRR → skip.
 *   - Portfolio at max open positions → skip new entries.
 *   - Symbol in cooldown → skip.
 *   - Circuit breaker tripped → skip ALL new entries.
 *
 * Everything that happens is logged + broadcast, so an operator can audit
 * why the agent did or didn't act on any given cycle.
 */
export class AutonomousTradingAgent {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private perSymbol = new Map<string, PerSymbolState>();
  private readonly config: AutonomousTradingAgentConfig;
  private readonly deps: AutonomousTradingAgentDeps;
  /** Most recent runtime risk multiplier suggested by the learning loop. */
  private runtimeRiskMultiplier = 1.0;

  constructor(config: AutonomousTradingAgentConfig, deps: AutonomousTradingAgentDeps) {
    this.config = config;
    this.deps = deps;
    for (const symbol of config.symbols) {
      this.perSymbol.set(symbol, {
        symbol,
        state: 'monitoring',
        regime: null,
        regimeChangedAt: 0,
        lastEntryAttemptAt: 0,
        trackingSetup: null,
        trackingPlan: null,
        regimeObservationCount: 0,
      });
    }
  }

  /** Start the polling loop. Idempotent. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.deps.eventLog.appendSystemEvent({
      eventType: 'AUTONOMOUS_AGENT_STARTED',
      payload: {
        symbols: this.config.symbols,
        cycleMs: this.config.cycleMs,
        minConfluence: this.config.minConfluence,
        minRR: this.config.minRR,
        maxOpenPositions: this.config.maxOpenPositions,
      },
      createdAtUtc: new Date().toISOString(),
    });
    logger.info(
      { symbols: this.config.symbols, cycleMs: this.config.cycleMs },
      'Autonomous trading agent started'
    );
    // Run one cycle immediately so the dashboard doesn't wait 30s for first
    // output; subsequent cycles run on the timer.
    void this.runCycle().catch((err) => {
      logger.error({ err }, 'Autonomous agent initial cycle failed');
    });
    this.timer = setInterval(() => {
      void this.runCycle().catch((err) => {
        logger.error({ err }, 'Autonomous agent cycle failed');
      });
    }, this.config.cycleMs);
  }

  /** Stop the polling loop. Idempotent. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.deps.eventLog.appendSystemEvent({
      eventType: 'AUTONOMOUS_AGENT_STOPPED',
      payload: { symbols: this.config.symbols },
      createdAtUtc: new Date().toISOString(),
    });
    logger.info('Autonomous trading agent stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * One polling cycle. Public so it can be triggered manually from the API
   * (e.g. a "Run cycle now" dashboard button) without waiting for the timer.
   *
   * The cycle runs in this order, deliberately:
   *   1. Health probe (cheap unless model probe interval elapses)
   *   2. Performance refresh + risk multiplier suggestion (the brain)
   *   3. Circuit breaker check (may stand-aside the whole cycle)
   *   4. Exit evaluation on open positions (the agent's intra-position brain)
   *   5. Per-symbol entry scan (only if breaker not tripped)
   *   6. Broadcast + persist cycle summary
   *
   * Exits always run regardless of circuit-breaker state — we don't want a
   * tripped breaker to prevent the agent from flattening positions whose
   * regime has flipped against them.
   */
  async runCycle(): Promise<AutonomousCycleSummary> {
    const startedAt = Date.now();
    const cycleId = `autonomous_${startedAt}`;
    let signalsSubmitted = 0;
    let signalsRejected = 0;
    let formingSetups = 0;
    let readySetups = 0;
    let regimesChanged = 0;
    let standingAsideSymbols = 0;
    const decisions: AutonomousCycleSummary['decisions'] = [];

    const now = startedAt;

    // --- (1) Health probe — drives the circuit breaker via requireHealthyMarket.
    const health = await this.deps.healthMonitor.check(now);

    // --- (2) Performance refresh + learning-loop risk multiplier suggestion.
    this.deps.performanceTracker.refresh(now);
    const learningRiskMultiplier = this.deps.performanceTracker.suggestRiskMultiplier();
    if (Math.abs(learningRiskMultiplier - this.runtimeRiskMultiplier) > 0.001) {
      const prev = this.runtimeRiskMultiplier;
      this.runtimeRiskMultiplier = learningRiskMultiplier;
      this.deps.eventLog.appendSystemEvent({
        eventType: 'AUTONOMOUS_LEARNING_PARAMETER_ADJUSTED',
        payload: {
          parameter: 'runtimeRiskMultiplier',
          from: prev,
          to: learningRiskMultiplier,
          rollingWinRate: this.deps.performanceTracker.getRollingStats().winRate,
          rollingSampleSize: this.deps.performanceTracker.getRollingStats().trades,
        },
        createdAtUtc: new Date(now).toISOString(),
      });
      this.deps.wsGateway.broadcast('agent.autonomous.learning', {
        cycleId,
        parameter: 'runtimeRiskMultiplier',
        from: prev,
        to: learningRiskMultiplier,
        rollingWinRate: this.deps.performanceTracker.getRollingStats().winRate,
        rollingSampleSize: this.deps.performanceTracker.getRollingStats().trades,
      });
    }

    // --- (3) Circuit breaker — may stand-aside the entire cycle.
    const breaker = this.deps.circuitBreaker.check(now);
    const breakerTripped = !breaker.allowEntries;

    // --- (4) Exits — always run, regardless of breaker.
    const exits = await this.deps.exitManager.evaluateExits(this.perSymbol, cycleId, now);

    const account = this.deps.getAccount();
    const openPositions = this.deps.getPositions();
    const portfolioFull = openPositions.length >= this.config.maxOpenPositions;

    for (const symbol of this.config.symbols) {
      const symState = this.perSymbol.get(symbol)!;

      // 5. Compute MTF state.
      const mtf = this.deps.mtfEngine.computeState(symbol, now);

      // 6. Detect regime.
      const regime = this.deps.regimeDetector.detect(symbol, mtf, now);

      // 7. Track regime change + confirmation.
      if (regime) {
        const prev = symState.regime;
        if (prev && prev.regime !== regime.regime) {
          symState.regimeObservationCount += 1;
          // Only commit the regime change after N consecutive observations to
          // avoid thrashing on a single noisy bar.
          if (symState.regimeObservationCount >= this.config.regimeConfirmationBars) {
            symState.regime = regime;
            symState.regimeChangedAt = now;
            symState.regimeObservationCount = 0;
            regimesChanged++;
            this.deps.eventLog.appendSystemEvent({
              eventType: 'AUTONOMOUS_REGIME_CHANGE',
              payload: {
                symbol,
                from: prev.regime,
                to: regime.regime,
                confidence: regime.confidence,
                regimeKey: regime.regimeKey,
              },
              createdAtUtc: new Date().toISOString(),
            });
            this.deps.wsGateway.broadcast('agent.autonomous.regime', {
              cycleId,
              symbol,
              from: prev.regime,
              to: regime.regime,
              confidence: regime.confidence,
            });
          }
        } else if (prev && prev.regime === regime.regime) {
          symState.regimeObservationCount = Math.max(0, symState.regimeObservationCount - 1);
          symState.regime = regime;
        } else {
          // First observation ever — just record it.
          symState.regime = regime;
          symState.regimeChangedAt = now;
        }
      }

      // 8. Stand-aside if regime is TRANSITIONING.
      const currentRegime = symState.regime?.regime ?? 'TRANSITIONING';
      const adaptation = this.deps.regimeDetector.getAdaptation(currentRegime);
      const tradeableRegime = this.deps.riskManager.isTradeable(currentRegime);

      // 9. Check for an existing position on this symbol — if so, the
      // ExitManager already evaluated it above; just record the in-position
      // state and move on.
      const symPosition = openPositions.find((p) => p.symbol === symbol && p.status === 'OPEN');

      if (symPosition) {
        symState.state = 'in_position';
        decisions.push({
          symbol,
          state: 'in_position',
          regime: currentRegime,
          setupState: null,
          setupType: null,
          confluenceScore: null,
          action: 'IN_POSITION',
          reason: `Already in position (qty=${symPosition.qty}, entry=${symPosition.entryPrice})`,
        });
        continue;
      }

      // 10. Circuit-breaker stand-aside.
      if (breakerTripped) {
        symState.state = 'stand_aside';
        standingAsideSymbols++;
        decisions.push({
          symbol,
          state: 'stand_aside',
          regime: currentRegime,
          setupState: null,
          setupType: null,
          confluenceScore: null,
          action: 'STAND_ASIDE',
          reason: `Circuit breaker tripped: ${breaker.reason}`,
        });
        continue;
      }

      if (!tradeableRegime) {
        symState.state = 'stand_aside';
        standingAsideSymbols++;
        decisions.push({
          symbol,
          state: 'stand_aside',
          regime: currentRegime,
          setupState: null,
          setupType: null,
          confluenceScore: null,
          action: 'STAND_ASIDE',
          reason: 'Regime is TRANSITIONING — standing aside until clearer context',
        });
        continue;
      }

      // 11. Check cooldown.
      if (now - symState.lastEntryAttemptAt < this.config.cooldownMs) {
        const remainingMs = this.config.cooldownMs - (now - symState.lastEntryAttemptAt);
        symState.state = 'monitoring';
        decisions.push({
          symbol,
          state: 'monitoring',
          regime: currentRegime,
          setupState: null,
          setupType: null,
          confluenceScore: null,
          action: 'MONITOR',
          reason: `Cooldown active (${Math.ceil(remainingMs / 1000)}s remaining)`,
        });
        continue;
      }

      // 12. Portfolio full?
      if (portfolioFull) {
        symState.state = 'monitoring';
        decisions.push({
          symbol,
          state: 'monitoring',
          regime: currentRegime,
          setupState: null,
          setupType: null,
          confluenceScore: null,
          action: 'MONITOR',
          reason: `Portfolio at max open positions (${openPositions.length}/${this.config.maxOpenPositions})`,
        });
        continue;
      }

      // 13. Pull setups for this symbol.
      const setups = this.deps.setupEngine.getSetupsAsOf(symbol, now);
      const ready = setups.filter((s) => s.status === 'READY');
      const forming = setups.filter(
        (s) => s.status === 'ACTIVE' && s.state !== 'INVALIDATED' && s.state !== 'EXPIRED'
      );

      readySetups += ready.length;
      formingSetups += forming.length;

      // Broadcast forming setups so the dashboard can show "what's coming".
      for (const f of forming) {
        this.deps.wsGateway.broadcast('agent.autonomous.forming', {
          cycleId,
          symbol,
          setupId: f.id,
          setupType: f.setupType,
          state: f.state,
          direction: f.direction,
          confluenceScore: f.confluence.totalScore,
          confluenceNotes: f.confluence.notes,
        });
      }

      // 14. Pick the highest-confluence READY setup.
      const best = ready.sort((a, b) => b.confluence.totalScore - a.confluence.totalScore)[0];

      if (!best) {
        symState.state = 'monitoring';
        decisions.push({
          symbol,
          state: 'monitoring',
          regime: currentRegime,
          setupState: forming[0]?.state ?? null,
          setupType: forming[0]?.setupType ?? null,
          confluenceScore: forming[0]?.confluence.totalScore ?? null,
          action: 'MONITOR',
          reason: `${forming.length} forming setup(s); no READY setup yet`,
        });
        continue;
      }

      // 15. Confluence gate.
      if (best.confluence.totalScore < this.config.minConfluence) {
        symState.state = 'monitoring';
        decisions.push({
          symbol,
          state: 'monitoring',
          regime: currentRegime,
          setupState: best.state,
          setupType: best.setupType,
          confluenceScore: best.confluence.totalScore,
          action: 'MONITOR',
          reason: `Confluence ${best.confluence.totalScore} < min ${this.config.minConfluence}`,
        });
        continue;
      }

      // 16. HTF alignment check — setup direction must agree with HTF trend
      // unless it's an explicit reversal archetype.
      const direction = best.direction;
      const htfTrend = best.timeframes.regime4h;
      const isReversal = best.setupType.includes('REVERSAL');
      const aligned =
        (direction === 'LONG' && htfTrend === 'BULLISH') ||
        (direction === 'SHORT' && htfTrend === 'BEARISH') ||
        (isReversal && (htfTrend === 'RANGE' || htfTrend === 'UNKNOWN'));

      if (!aligned) {
        symState.state = 'monitoring';
        decisions.push({
          symbol,
          state: 'monitoring',
          regime: currentRegime,
          setupState: best.state,
          setupType: best.setupType,
          confluenceScore: best.confluence.totalScore,
          action: 'MONITOR',
          reason: `HTF trend ${htfTrend} misaligns with ${direction} ${best.setupType}`,
        });
        continue;
      }

      // 17. Build the trade plan.
      // SetupDirection includes 'AVOID' but we've already filtered to READY
      // setups with aligned HTF, so direction is guaranteed to be LONG/SHORT.
      if (direction !== 'LONG' && direction !== 'SHORT') {
        symState.state = 'monitoring';
        decisions.push({
          symbol,
          state: 'monitoring',
          regime: currentRegime,
          setupState: best.state,
          setupType: best.setupType,
          confluenceScore: best.confluence.totalScore,
          action: 'REJECTED',
          reason: `Setup direction ${direction} is not actionable`,
        });
        continue;
      }
      const plan = this.deps.riskManager.computeTradePlan(
        symbol,
        direction,
        adaptation
      );

      if (!plan) {
        symState.state = 'monitoring';
        decisions.push({
          symbol,
          state: 'monitoring',
          regime: currentRegime,
          setupState: best.state,
          setupType: best.setupType,
          confluenceScore: best.confluence.totalScore,
          action: 'REJECTED',
          reason: `Plan rejected (RR below regime min ${adaptation.minRR})`,
        });
        signalsRejected++;
        continue;
      }

      // 18. Optional model-confidence probe — best-effort, never blocks.
      const confidence = await this.probeConfidence(symbol, direction, best, plan);

      if (confidence < this.config.minConfidence) {
        symState.state = 'monitoring';
        decisions.push({
          symbol,
          state: 'monitoring',
          regime: currentRegime,
          setupState: best.state,
          setupType: best.setupType,
          confluenceScore: best.confluence.totalScore,
          action: 'REJECTED',
          reason: `Model confidence ${confidence.toFixed(2)} < min ${this.config.minConfidence}`,
        });
        signalsRejected++;
        continue;
      }

      // 19. Build & submit the signal. The runtime risk multiplier from the
      // learning loop is folded into sizePct on top of the regime overlay.
      symState.trackingSetup = best;
      symState.trackingPlan = plan;
      symState.state = 'seeking_entry';
      symState.lastEntryAttemptAt = now;

      const planFeatures = this.deps.riskManager.planToFeatures(plan);
      const baseSizePct = planFeatures['sizePct'] as number;
      // Apply the learning-loop multiplier on top of the regime overlay.
      const sizePct = baseSizePct * this.runtimeRiskMultiplier;
      const entry = plan.entryPrice;
      const stopDistance = Math.abs(entry - plan.stopLossPrice);
      // Risk-based qty: (equity * sizePct) / stopDistance.
      const riskAmount = account.equity * sizePct;
      const quantity = stopDistance > 0 ? riskAmount / stopDistance : 0;

      const signalInput: SignalInput = {
        strategyId: this.config.strategyId,
        symbol,
        action: direction === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT',
        confidence,
        stopLossPrice: String(plan.stopLossPrice.toFixed(8)),
        takeProfitPrice: String(plan.takeProfitPrice.toFixed(8)),
        ttlMs: this.config.cycleMs * 2,
        reasoning: `[AutonomousAgent] ${best.setupType} ${direction} | regime=${currentRegime} conf=${best.confluence.totalScore}/${best.confluence.maxScore} RR=${plan.rr.toFixed(2)} riskMult=${this.runtimeRiskMultiplier.toFixed(2)} | ${adaptation.rationale}`,
        features: {
          ...planFeatures,
          sizePct,
          runtimeRiskMultiplier: this.runtimeRiskMultiplier,
          quantity,
          cooldownMs: this.config.cooldownMs,
        },
      };

      const submitted = await this.deps.strategyEngine.submitSignal(signalInput);
      const signalRecord: AutonomousSignalRecord = {
        symbol,
        action: signalInput.action as 'OPEN_LONG' | 'OPEN_SHORT',
        confidence,
        regime: currentRegime,
        setupType: best.setupType,
        confluenceScore: best.confluence.totalScore,
        entryPrice: plan.entryPrice,
        stopLossPrice: plan.stopLossPrice,
        takeProfitPrice: plan.takeProfitPrice,
        leverage: plan.leverage,
        sizePct,
        rr: plan.rr,
        rationale: signalInput.reasoning ?? '',
        submittedAt: now,
      };

      if (submitted && (submitted.status === 'EXECUTED' || submitted.status === 'ACCEPTED')) {
        signalsSubmitted++;
        metrics.inc('autonomous_signals_submitted_total');
        this.deps.eventLog.appendSystemEvent({
          eventType: 'AUTONOMOUS_AGENT_SIGNAL',
          payload: { ...signalRecord, signalId: submitted.id } as unknown as Record<string, unknown>,
          createdAtUtc: new Date().toISOString(),
        });
        this.deps.wsGateway.broadcast('agent.autonomous.signal', {
          cycleId,
          ...signalRecord,
          signalId: submitted.id,
        });
        decisions.push({
          symbol,
          state: 'seeking_entry',
          regime: currentRegime,
          setupState: best.state,
          setupType: best.setupType,
          confluenceScore: best.confluence.totalScore,
          action: 'ENTRY_SUBMITTED',
          reason: `Submitted ${signalInput.action} @ ${plan.entryPrice} SL=${plan.stopLossPrice.toFixed(4)} TP=${plan.takeProfitPrice.toFixed(4)} lev=${plan.leverage}x RR=${plan.rr.toFixed(2)} riskMult=${this.runtimeRiskMultiplier.toFixed(2)}`,
        });
      } else {
        signalsRejected++;
        metrics.inc('autonomous_signals_rejected_total');
        const reason = submitted?.rejectReason ?? 'rejected by executor';
        this.deps.eventLog.appendSystemEvent({
          eventType: 'AUTONOMOUS_AGENT_REJECTED',
          payload: { ...signalRecord, signalId: submitted?.id, reason } as unknown as Record<string, unknown>,
          createdAtUtc: new Date().toISOString(),
        });
        this.deps.wsGateway.broadcast('agent.autonomous.rejected', {
          cycleId,
          ...signalRecord,
          signalId: submitted?.id,
          reason,
        });
        decisions.push({
          symbol,
          state: 'seeking_entry',
          regime: currentRegime,
          setupState: best.state,
          setupType: best.setupType,
          confluenceScore: best.confluence.totalScore,
          action: 'REJECTED',
          reason: `Executor rejected: ${reason}`,
        });
      }
    }

    const completedAt = Date.now();
    const summary: AutonomousCycleSummary = {
      cycleId,
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
      symbolsScanned: this.config.symbols.length,
      regimesChanged,
      formingSetups,
      readySetups,
      signalsSubmitted,
      signalsRejected,
      standingAsideSymbols,
      circuitBreakerTripped: breakerTripped,
      health,
      exits,
      runtimeRiskMultiplier: this.runtimeRiskMultiplier,
      rollingWinRate: this.deps.performanceTracker.getRollingStats().winRate,
      decisions,
    };

    this.deps.eventLog.appendSystemEvent({
      eventType: 'AUTONOMOUS_CYCLE_COMPLETED',
      payload: summary as unknown as Record<string, unknown>,
      createdAtUtc: new Date().toISOString(),
    });
    this.deps.wsGateway.broadcast('agent.autonomous.cycle', summary);
    metrics.setGauge('autonomous_forming_setups', formingSetups);
    metrics.setGauge('autonomous_ready_setups', readySetups);
    metrics.setGauge('autonomous_standing_aside', standingAsideSymbols);
    metrics.setGauge('autonomous_runtime_risk_multiplier', Math.round(this.runtimeRiskMultiplier * 1000));

    return summary;
  }

  /**
   * Best-effort LLM confidence probe. Falls back to a deterministic
   * confluence-derived confidence if the model is unreachable — the agent
   * never blocks on Ollama availability, see TradingAgentsPipeline's
   * NEUTRAL fallback for the same reasoning.
   */
  private async probeConfidence(
    symbol: string,
    direction: 'LONG' | 'SHORT',
    setup: SetupCandidate,
    plan: TradePlan
  ): Promise<number> {
    // Deterministic base: confluence score scaled to 0..1, with a small
    // bonus for high RR and a small penalty for stale regime.
    const base = Math.min(1, setup.confluence.totalScore / 100);
    const rrBonus = Math.min(0.1, Math.max(0, (plan.rr - 1.5) / 10));
    const confidence = Math.max(0, Math.min(1, base + rrBonus));

    try {
      // Quick context dump for the LLM. Keep it short — we don't want a
      // model round-trip to dominate cycle latency.
      const system = `You are a trading-desk risk reviewer. Respond with strict JSON {"confidence": number 0..1, "rationale": string}. Reject anything ambiguous.`;
      const prompt = JSON.stringify({
        symbol,
        direction,
        setupType: setup.setupType,
        regime: plan.adaptation.regime,
        confluence: setup.confluence.totalScore,
        rr: Number(plan.rr.toFixed(2)),
        atr: Number(plan.atr.toFixed(4)),
        entry: Number(plan.entryPrice.toFixed(4)),
        stop: Number(plan.stopLossPrice.toFixed(4)),
        target: Number(plan.takeProfitPrice.toFixed(4)),
      });
      const res = await this.deps.modelManager.complete({
        system,
        prompt,
        json: true,
        temperature: 0.2,
        maxTokens: 256,
      });
      const parsed = JSON.parse(res.text) as { confidence?: number };
      if (typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1) {
        // Blend: 60% model, 40% deterministic — keeps one source from
        // running away with the decision.
        return 0.6 * parsed.confidence + 0.4 * confidence;
      }
    } catch (err) {
      logger.warn(
        { err, symbol },
        'Autonomous agent: model confidence probe failed, using deterministic fallback'
      );
    }
    return confidence;
  }
}
