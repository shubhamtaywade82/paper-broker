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
import type { ExitManager, ScaleInDecision } from './ExitManager.js';
import type { RegimeAdaptation, MarketRegime } from '../analysis/MarketRegimeDetector.js';
import { regimeConfirmationBarsFor } from '../analysis/MarketRegimeDetector.js';
import type { HealthMonitor } from './HealthMonitor.js';
import type {
  MarketFactContext,
  AgentCycleStepListener,
  VetoConsultation,
} from '../ai/tradingAgents.js';
import type { MarketState } from '../broker/types.js';
import type {
  PortfolioCorrelationGuard,
  CorrelationExposureCheck,
} from '../risk/PortfolioCorrelationGuard.js';
import type { MarketTrend } from '../market/structure/types.js';
import { logger } from '../telemetry/logger.js';
import { metrics } from '../telemetry/metrics.js';

/**
 * Structural subset of TradingAgentsPipeline the agent depends on for the
 * debate-driven veto (AUTONOMY_AUDIT Finding 1). Declared as an interface so
 * tests can pass a plain stub — the concrete pipeline satisfies it
 * structurally and is wired in engine.ts.
 */
export interface VetoConsultant {
  runVetoConsultation(
    ctx: MarketFactContext,
    direction: 'LONG' | 'SHORT',
    onStep?: AgentCycleStepListener
  ): Promise<VetoConsultation>;
}

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
  /**
   * Per-regime confirmation-bar overrides (AUTONOMY_AUDIT Finding 6). Keys on
   * the regime being LEFT. Absent → the noise-ranked offset table applies
   * (see confirmationBarsFor). Optional for backward compatibility.
   */
  regimeConfirmationBarsByRegime?: Partial<Record<MarketRegime, number>>;
  /**
   * Debate-driven LLM veto (AUTONOMY_AUDIT Finding 1). When true (default)
   * and a {@link VetoConsultant} is wired, every entry candidate is put in
   * front of the bull/bear debate before submission; a genuine NEUTRAL /
   * opposing trader verdict vetoes the entry. Degraded consultations never
   * veto (the agent stays best-effort when Ollama is down).
   */
  llmVetoEnabled?: boolean;
  /**
   * Weighted HTF alignment (AUTONOMY_AUDIT Finding 5). When true (default)
   * the 4h trend scales the setup's confluence instead of gating it
   * binary-style. False restores the legacy pass/fail gate.
   */
  htfAlignmentWeighted?: boolean;
  /** Confluence weight when the 4h trend is RANGE/UNKNOWN (default 0.7). */
  htfRangeWeight?: number;
  /** Confluence weight for a non-reversal setup countering the 4h trend (default 0.3). */
  htfCounterTrendWeight?: number;
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
  /**
   * Debate-driven veto consultant (Finding 1) — the TradingAgentsPipeline.
   * Optional so existing constructions (and tests) keep working; absent =
   * the plain model-confidence probe path.
   */
  tradingAgents?: VetoConsultant;
  /** Market snapshot for the veto consultation context (Finding 1). Optional. */
  getMarketState?: (symbol: string) => MarketState | undefined;
  /**
   * Correlation-aware portfolio cap (Finding 8). Optional; absent = the
   * count-based maxOpenPositions gate is the only portfolio check.
   */
  correlationGuard?: PortfolioCorrelationGuard;
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
  /**
   * Cache of the most recently completed cycle summary. Surfaced via
   * {@link getSnapshot} for the REST endpoint `/api/v1/autonomous/snapshot`
   * so the dashboard can bootstrap initial state on mount instead of
   * waiting up to one full cycle (default 30s) for the first broadcast.
   */
  private lastCycleSummary: AutonomousCycleSummary | null = null;

  constructor(config: AutonomousTradingAgentConfig, deps: AutonomousTradingAgentDeps) {
    // Normalize optional Finding 1/5 knobs to their defaults up front so the
    // cycle code can read them without null-guarding on every access.
    this.config = {
      ...config,
      llmVetoEnabled: config.llmVetoEnabled ?? true,
      htfAlignmentWeighted: config.htfAlignmentWeighted ?? true,
      htfRangeWeight: config.htfRangeWeight ?? 0.7,
      htfCounterTrendWeight: config.htfCounterTrendWeight ?? 0.3,
    };
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
          // Only commit the regime change after enough consecutive
          // observations to avoid thrashing on a single noisy bar. The bar
          // count is per-regime (Finding 6): leaving a noisy regime
          // (VOLATILE_BREAKOUT, RANGING_HIGH_VOL) needs MORE confirmations
          // than leaving a quiet one (RANGING_LOW_VOL).
          const requiredBars = this.confirmationBarsFor(prev.regime, regime.regime);
          if (symState.regimeObservationCount >= requiredBars) {
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
                confirmations: requiredBars,
              },
              createdAtUtc: new Date().toISOString(),
            });
            this.deps.wsGateway.broadcast('agent.autonomous.regime', {
              cycleId,
              symbol,
              from: prev.regime,
              to: regime.regime,
              confidence: regime.confidence,
              confirmations: requiredBars,
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
        // Scaling (AUTONOMY_AUDIT Finding 2): the ExitManager owns the
        // intra-position brain — evaluate a pyramid add for this winner and
        // fold its outcome into the cycle decision. Exits (incl. partial
        // de-risks) already ran in step (4) above.
        const scaleIn = await this.evaluateScaleInForPosition(
          symPosition,
          symState,
          adaptation,
          cycleId,
          now,
          breakerTripped
        );
        decisions.push({
          symbol,
          state: 'in_position',
          regime: currentRegime,
          setupState: scaleIn?.setupState ?? null,
          setupType: scaleIn?.setupType ?? null,
          confluenceScore: scaleIn?.confluenceScore ?? null,
          action: scaleIn?.submitted ? 'SCALE_IN_SUBMITTED' : 'IN_POSITION',
          reason: scaleIn?.reason ?? `Already in position (qty=${symPosition.qty}, entry=${symPosition.entryPrice})`,
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

      // 15. Weighted HTF alignment (AUTONOMY_AUDIT Finding 5) — the 4h trend
      // scales the setup's confluence instead of gating it binary-style:
      // aligned gets full weight, RANGE/UNKNOWN context gets htfRangeWeight
      // (default 0.7), counter-trend gets htfCounterTrendWeight (default
      // 0.3) unless it's a reversal archetype (those get the range weight —
      // countering the 4h trend is their job). The weighted score then has
      // to clear minConfluence, which subsumes the old binary gate: a
      // hard-misaligned setup needs a 100/100 confluence to clear a 0.3
      // weight at min 65, so in practice it still never trades.
      const direction = best.direction;
      const htfTrend = best.timeframes.regime4h;
      const isReversal = best.setupType.includes('REVERSAL');
      const alignment = this.alignmentWeightFor(direction, htfTrend, isReversal);
      const effectiveConfluence = Math.round(best.confluence.totalScore * alignment.weight);

      if (effectiveConfluence < this.config.minConfluence) {
        symState.state = 'monitoring';
        decisions.push({
          symbol,
          state: 'monitoring',
          regime: currentRegime,
          setupState: best.state,
          setupType: best.setupType,
          confluenceScore: best.confluence.totalScore,
          action: 'MONITOR',
          reason:
            alignment.weight <= 0
              ? `HTF trend ${htfTrend} misaligns with ${direction} ${best.setupType} (binary gate)`
              : `HTF alignment ${alignment.label}: confluence ${best.confluence.totalScore} × ${alignment.weight.toFixed(2)} = ${effectiveConfluence} < min ${this.config.minConfluence}`,
        });
        continue;
      }

      // 16.5. Symbol-lock orchestration gate (AUTONOMY_AUDIT Finding 3):
      // if another strategy (e.g. smc-agent) holds the entry lock on this
      // symbol, stand aside BEFORE burning a model-confidence probe. The
      // StrategyEngine enforces the same lock at submit time — this is the
      // cheap, informative pre-check. (Optional-chained so test doubles
      // without the lock API keep working.)
      const symbolLock = this.deps.strategyEngine.getSymbolLock?.(symbol) ?? null;
      if (symbolLock && symbolLock.strategyId !== this.config.strategyId) {
        const remainingSec = Math.ceil((symbolLock.until - now) / 1000);
        symState.state = 'stand_aside';
        decisions.push({
          symbol,
          state: 'stand_aside',
          regime: currentRegime,
          setupState: best.state,
          setupType: best.setupType,
          confluenceScore: best.confluence.totalScore,
          action: 'STAND_ASIDE',
          reason: `Symbol locked by strategy ${symbolLock.strategyId} (${remainingSec}s remaining)`,
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

      // 17.5 Correlation-aware portfolio capacity (AUTONOMY_AUDIT Finding 8):
      // the count-based maxOpenPositions gate can't see that BTC + ETH + SOL
      // all long is one bet. Cheap deterministic check (Pearson over recent
      // candles) BEFORE the expensive model calls — if the candidate's
      // correlated margin cluster is already at cap, don't burn a probe.
      const correlationCheck = this.checkCorrelationCapacity(
        symbol,
        direction,
        plan,
        account.equity,
        openPositions
      );
      if (correlationCheck && !correlationCheck.allowed) {
        symState.state = 'monitoring';
        decisions.push({
          symbol,
          state: 'monitoring',
          regime: currentRegime,
          setupState: best.state,
          setupType: best.setupType,
          confluenceScore: best.confluence.totalScore,
          action: 'REJECTED',
          reason: `Correlated exposure cap: ${correlationCheck.reason}`,
        });
        signalsRejected++;
        metrics.inc('autonomous_correlation_rejections_total');
        continue;
      }

      // 18. Optional model-confidence probe — best-effort, never blocks. With
      // the veto consultant wired (Finding 1) this also runs the bull/bear
      // debate, whose genuine NEUTRAL / opposing verdict vetoes the entry.
      const probe = await this.probeEntryConfidence(
        symbol,
        direction,
        best,
        plan,
        effectiveConfluence
      );

      if (probe.vetoed) {
        symState.state = 'monitoring';
        decisions.push({
          symbol,
          state: 'monitoring',
          regime: currentRegime,
          setupState: best.state,
          setupType: best.setupType,
          confluenceScore: best.confluence.totalScore,
          action: 'REJECTED',
          reason: probe.vetoReason ?? 'LLM veto',
        });
        signalsRejected++;
        this.deps.eventLog.appendSystemEvent({
          eventType: 'AUTONOMOUS_LLM_VETO',
          payload: {
            symbol,
            direction,
            setupType: best.setupType,
            regime: currentRegime,
            confluenceScore: best.confluence.totalScore,
            effectiveConfluence,
            reason: probe.vetoReason,
          },
          createdAtUtc: new Date().toISOString(),
        });
        continue;
      }
      const confidence = probe.confidence;

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

      // Same sizing math the correlation gate (17.5) already used, so the
      // exposure the guard approved is exactly the exposure submitted.
      const { sizePct, quantity } = this.positionSizing(plan, account.equity);

      const signalInput: SignalInput = {
        strategyId: this.config.strategyId,
        symbol,
        action: direction === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT',
        confidence,
        stopLossPrice: String(plan.stopLossPrice.toFixed(8)),
        takeProfitPrice: String(plan.takeProfitPrice.toFixed(8)),
        ttlMs: this.config.cycleMs * 2,
        reasoning: `[AutonomousAgent] ${best.setupType} ${direction} | regime=${currentRegime} conf=${best.confluence.totalScore}/${best.confluence.maxScore}×htfAlign=${alignment.weight.toFixed(2)}→${effectiveConfluence} RR=${plan.rr.toFixed(2)} riskMult=${this.runtimeRiskMultiplier.toFixed(2)} regimeBias=${plan.regimeBias.toFixed(2)} | ${adaptation.rationale}`,
        features: {
          ...this.deps.riskManager.planToFeatures(plan),
          sizePct,
          runtimeRiskMultiplier: this.runtimeRiskMultiplier,
          quantity,
          cooldownMs: this.config.cooldownMs,
          alignmentWeight: alignment.weight,
          effectiveConfluence,
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
    // Cache for the REST snapshot endpoint so the dashboard can hydrate on
    // mount without waiting for the next WS broadcast.
    this.lastCycleSummary = summary;
    this.deps.wsGateway.broadcast('agent.autonomous.cycle', summary);
    metrics.setGauge('autonomous_forming_setups', formingSetups);
    metrics.setGauge('autonomous_ready_setups', readySetups);
    metrics.setGauge('autonomous_standing_aside', standingAsideSymbols);
    metrics.setGauge('autonomous_runtime_risk_multiplier', Math.round(this.runtimeRiskMultiplier * 1000));

    return summary;
  }

  /**
   * Read-only snapshot of the agent's current state — used by the REST
   * endpoint GET /api/v1/autonomous/snapshot so the dashboard can hydrate
   * on mount instead of waiting up to one full cycle for the first WS
   * broadcast. Returns the same payload shape the WS events emit so the
   * dashboard can feed it straight into the autonomous store.
   *
   * Not a deep copy — callers must not mutate. The brain-module sub-objects
   * (breaker state, health, rolling stats) are themselves immutable
   * snapshots from their respective classes.
   */
  public getSnapshot(): {
    latestCycle: AutonomousCycleSummary | null;
    runtimeRiskMultiplier: number;
    rollingWinRate: number;
    rollingSampleSize: number;
    breaker: ReturnType<CircuitBreaker['getState']>;
    health: ReturnType<HealthMonitor['getState']>;
    running: boolean;
    perSymbol: Array<PerSymbolState>;
  } {
    const rolling = this.deps.performanceTracker.getRollingStats();
    return {
      latestCycle: this.lastCycleSummary,
      runtimeRiskMultiplier: this.runtimeRiskMultiplier,
      rollingWinRate: rolling.winRate,
      rollingSampleSize: rolling.trades,
      breaker: this.deps.circuitBreaker.getState(),
      health: this.deps.healthMonitor.getState(),
      running: this.running,
      perSymbol: Array.from(this.perSymbol.values()),
    };
  }

  /**
   * Scale-in helper for the main loop's in-position branch (Finding 2).
   * Builds the fresh inputs the ExitManager needs (current READY setups +
   * a fresh regime-adjusted plan, which itself gates on tradeability and
   * min RR) and delegates the scaling decision — the ExitManager owns the
   * pyramid rules (profit gate, add budget, add cooldown).
   */
  private async evaluateScaleInForPosition(
    position: Position,
    symState: PerSymbolState,
    adaptation: RegimeAdaptation,
    cycleId: string,
    now: number,
    breakerTripped: boolean
  ): Promise<ScaleInDecision | null> {
    const direction: 'LONG' | 'SHORT' = position.qty > 0 ? 'LONG' : 'SHORT';
    // Fresh plan at the CURRENT price — reusing the entry-time plan would
    // give the add stale stops. A null plan (regime can't pay for the stop,
    // or not enough candles) simply means no add this cycle.
    const plan = this.deps.riskManager.computeTradePlan(
      position.symbol,
      direction,
      adaptation
    );
    const setups = this.deps.setupEngine.getSetupsAsOf(position.symbol, now);
    // Refresh the tracked setup so the ExitManager's invalidation checks see
    // the latest state for this symbol.
    if (symState.trackingSetup) {
      const refreshed = setups.find((s) => s.id === symState.trackingSetup!.id);
      if (refreshed) symState.trackingSetup = refreshed;
    }
    return this.deps.exitManager.evaluateScaleIn(
      position,
      setups,
      plan,
      {
        allowNewEntries: !breakerTripped,
        minConfluence: this.config.minConfluence,
        runtimeRiskMultiplier: this.runtimeRiskMultiplier,
        // Finding 8: a pyramid add is margin added to the same correlated
        // cluster — it must clear the same cap a fresh entry would. The
        // base position counts too (includeSameSymbol), so adds can't hide
        // exposure underneath the guard.
        ...(this.deps.correlationGuard
          ? {
              correlationCheck: (addNotional: number, leverage: number) => {
                const check = this.deps.correlationGuard!.evaluate(
                  { symbol: position.symbol, direction, notional: addNotional, leverage },
                  this.deps.getPositions(),
                  this.deps.getAccount().equity,
                  { includeSameSymbol: true }
                );
                return { allowed: check.allowed, reason: check.reason };
              },
            }
          : {}),
      },
      cycleId,
      now
    );
  }

  /**
   * Deterministic confidence floor: weighted confluence scaled to 0..1 with a
   * small RR bonus. Used alone when no model is reachable, and as the 40%
   * blend component when a model opinion IS available.
   */
  private deterministicConfidence(effectiveConfluence: number, plan: TradePlan): number {
    const base = Math.min(1, effectiveConfluence / 100);
    const rrBonus = Math.min(0.1, Math.max(0, (plan.rr - 1.5) / 10));
    return Math.max(0, Math.min(1, base + rrBonus));
  }

  /**
   * Entry confidence probe + debate-driven veto (AUTONOMY_AUDIT Finding 1).
   *
   * Three paths, in order of preference:
   *   1. Veto consultation (when llmVetoEnabled and a consultant is wired):
   *      the setup goes in front of the bull/bear debate. A genuine NEUTRAL /
   *      opposing trader verdict vetoes the entry. A DEGRADED consultation
   *      (any LLM stage fell back) never vetoes — the agent does not block
   *      on Ollama availability. An agreeing debate contributes its trader
   *      confidence through the same 60/40 blend the plain probe uses.
   *   2. Plain model probe (legacy path): one modelManager.complete call.
   *   3. Deterministic fallback when no model answers.
   */
  private async probeEntryConfidence(
    symbol: string,
    direction: 'LONG' | 'SHORT',
    setup: SetupCandidate,
    plan: TradePlan,
    effectiveConfluence: number
  ): Promise<{ confidence: number; vetoed: boolean; vetoReason: string | null }> {
    const deterministic = this.deterministicConfidence(effectiveConfluence, plan);

    // --- Path 1: debate-driven veto consultation (Finding 1).
    if (this.config.llmVetoEnabled && this.deps.tradingAgents) {
      try {
        const ctx = this.buildConsultationContext(symbol, setup, plan);
        const consultation = await this.deps.tradingAgents.runVetoConsultation(ctx, direction);

        if (consultation.degraded) {
          // The debate fell back to deterministic stand-ins — that is NOT a
          // model opinion, so it can neither veto nor bless the entry. Fall
          // through to the plain probe? No: if the debate degraded, the
          // model endpoints are almost certainly down, and a second round
          // trip would just add cycle latency before failing the same way.
          // Use the deterministic confidence and keep the agent moving.
          logger.warn(
            { symbol, direction },
            'Autonomous agent: veto consultation degraded (model unavailable) — using deterministic confidence, no veto'
          );
          return { confidence: deterministic, vetoed: false, vetoReason: null };
        }

        if (consultation.action !== direction) {
          // NEUTRAL or opposing action → veto. This is the consultative
          // power the audit asked for: the debate can say NO.
          metrics.inc('autonomous_llm_veto_total');
          return {
            confidence: 0,
            vetoed: true,
            vetoReason: `LLM veto: debate trader says ${consultation.action} vs intended ${direction} (${consultation.rationale})`,
          };
        }

        // Debate agrees — blend its trader confidence 60/40 with the
        // deterministic base, exactly like the plain probe blends a model
        // opinion. Keeps one source from running away with the decision.
        const modelConfidence = Math.max(0, Math.min(1, consultation.confidence));
        return {
          confidence: 0.6 * modelConfidence + 0.4 * deterministic,
          vetoed: false,
          vetoReason: null,
        };
      } catch (err) {
        // The consultation itself threw (network, timeout). Best-effort
        // property: never block the cycle — fall back to deterministic.
        logger.warn(
          { err, symbol },
          'Autonomous agent: veto consultation failed — using deterministic confidence, no veto'
        );
        return { confidence: deterministic, vetoed: false, vetoReason: null };
      }
    }

    // --- Path 2: plain model-confidence probe (legacy behaviour).
    try {
      // Quick context dump for the LLM. Keep it short — we don't want a
      // model round-trip to dominate cycle latency.
      const system = `You are a trading-desk risk reviewer. Respond with strict JSON {"confidence": number 0..1, "rationale": string}. Reject anything ambiguous.`;
      const prompt = JSON.stringify({
        symbol,
        direction,
        setupType: setup.setupType,
        regime: plan.adaptation.regime,
        confluence: effectiveConfluence,
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
        return {
          confidence: 0.6 * parsed.confidence + 0.4 * deterministic,
          vetoed: false,
          vetoReason: null,
        };
      }
    } catch (err) {
      logger.warn(
        { err, symbol },
        'Autonomous agent: model confidence probe failed, using deterministic fallback'
      );
    }

    // --- Path 3: deterministic fallback.
    return { confidence: deterministic, vetoed: false, vetoReason: null };
  }

  /**
   * Build the MarketFactContext for a veto consultation (Finding 1). Uses
   * the live market snapshot when available and degrades gracefully to the
   * plan's entry price so the consultation still has coherent numbers.
   * The setup context rides in `setupMemory` — advisory context only, per
   * the same LLM-authority contract the smc-agent path follows.
   */
  private buildConsultationContext(
    symbol: string,
    setup: SetupCandidate,
    plan: TradePlan
  ): MarketFactContext {
    const last = this.deps.getLastPrice(symbol) ?? plan.entryPrice;
    const market = this.deps.getMarketState?.(symbol);
    const bid = market?.bid ?? last;
    const ask = market?.ask ?? last;
    const spread = market?.spread ?? (Number.isFinite(ask) && Number.isFinite(bid) ? ask - bid : 0);
    const account = this.deps.getAccount();
    return {
      symbol,
      lastPrice: last,
      bid,
      ask,
      spread,
      mark: market?.mark ?? last,
      fundingRate: market?.fundingRate,
      openInterest: market?.openInterest,
      accountEquity: account.equity,
      availableBalance: account.availableBalance,
      setupMemory:
        `Agent candidate: ${setup.setupType} ${setup.direction} | confluence ` +
        `${setup.confluence.totalScore}/${setup.confluence.maxScore} | regime ` +
        `${plan.adaptation.regime} | RR ${plan.rr.toFixed(2)} | entry ` +
        `${plan.entryPrice.toFixed(4)} stop ${plan.stopLossPrice.toFixed(4)} ` +
        `target ${plan.takeProfitPrice.toFixed(4)}`,
    };
  }

  /**
   * Correlation-capacity gate (Finding 8) for the entry path. Returns null
   * when no guard is wired — the count-based gate remains the only portfolio
   * check, exactly as before.
   */
  private checkCorrelationCapacity(
    symbol: string,
    direction: 'LONG' | 'SHORT',
    plan: TradePlan,
    equity: number,
    openPositions: Array<Position>
  ): CorrelationExposureCheck | null {
    if (!this.deps.correlationGuard) return null;
    const { notional } = this.positionSizing(plan, equity);
    return this.deps.correlationGuard.evaluate(
      { symbol, direction, notional, leverage: plan.leverage },
      openPositions,
      equity
    );
  }

  /**
   * Risk-based sizing shared by the correlation gate (17.5) and the signal
   * builder (19): sizePct = regime overlay × regime bias × learning
   * multiplier; quantity = (equity × sizePct) / stopDistance; notional and
   * margin follow from quantity and leverage. One implementation so the
   * exposure the guard approves is exactly the exposure submitted.
   */
  private positionSizing(
    plan: TradePlan,
    equity: number
  ): { sizePct: number; quantity: number; notional: number; margin: number } {
    const planFeatures = this.deps.riskManager.planToFeatures(plan);
    const baseSizePct = planFeatures['sizePct'] as number;
    // Apply the learning-loop multiplier on top of the regime overlay.
    const sizePct = baseSizePct * this.runtimeRiskMultiplier;
    const entry = plan.entryPrice;
    const stopDistance = Math.abs(entry - plan.stopLossPrice);
    // Risk-based qty: (equity * sizePct) / stopDistance.
    const riskAmount = equity * sizePct;
    const quantity = stopDistance > 0 ? riskAmount / stopDistance : 0;
    const notional = quantity * entry;
    const margin = plan.leverage > 0 ? notional / plan.leverage : 0;
    return { sizePct, quantity, notional, margin };
  }

  /**
   * Confirmation bars required to commit a regime transition FROM `prev` TO
   * `next` (AUTONOMY_AUDIT Finding 6) — delegates to
   * {@link regimeConfirmationBarsFor}; see its doc for the noise-ranked
   * offset table and override semantics.
   */
  private confirmationBarsFor(
    prev: MarketRegime | undefined,
    next: MarketRegime
  ): number {
    return regimeConfirmationBarsFor(
      prev,
      next,
      this.config.regimeConfirmationBars,
      this.config.regimeConfirmationBarsByRegime
    );
  }

  /**
   * Alignment weight for a setup given its direction, the 4h trend, and
   * whether it's a reversal archetype (AUTONOMY_AUDIT Finding 5).
   *
   * Weighted mode (default):
   *   - 4h aligned with direction               → 1.0
   *   - 4h RANGE / UNKNOWN                      → htfRangeWeight (0.7)
   *   - 4h opposing, reversal archetype         → htfRangeWeight (0.7) —
   *     countering the 4h trend is the archetype's job, but it's still
   *     counter-trend risk
   *   - 4h opposing, non-reversal               → htfCounterTrendWeight (0.3)
   *
   * Binary mode (htfAlignmentWeighted: false) restores the legacy
   * pass/fail gate as weight 1 / 0.
   */
  private alignmentWeightFor(
    direction: string,
    htfTrend: MarketTrend | undefined,
    isReversal: boolean
  ): { weight: number; label: string } {
    if (this.config.htfAlignmentWeighted === false) {
      const aligned =
        (direction === 'LONG' && htfTrend === 'BULLISH') ||
        (direction === 'SHORT' && htfTrend === 'BEARISH') ||
        (isReversal && (htfTrend === 'RANGE' || htfTrend === 'UNKNOWN'));
      return { weight: aligned ? 1 : 0, label: aligned ? 'aligned' : 'misaligned' };
    }
    const alignedTrend = direction === 'LONG' ? 'BULLISH' : 'BEARISH';
    const opposingTrend = direction === 'LONG' ? 'BEARISH' : 'BULLISH';
    if (htfTrend === alignedTrend) {
      return { weight: 1.0, label: `4h ${htfTrend} aligned` };
    }
    if (htfTrend === opposingTrend) {
      if (isReversal) {
        return { weight: this.config.htfRangeWeight ?? 0.7, label: `reversal vs 4h ${htfTrend}` };
      }
      return {
        weight: this.config.htfCounterTrendWeight ?? 0.3,
        label: `counter-trend vs 4h ${htfTrend}`,
      };
    }
    return { weight: this.config.htfRangeWeight ?? 0.7, label: `4h ${htfTrend ?? 'UNKNOWN'} neutral` };
  }
}
