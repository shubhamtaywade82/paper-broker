# Autonomous Agent — Self-Directed Decision Audit

**Date**: 2026-08-26
**Scope**: `src/agent/AutonomousTradingAgent.ts`, `src/agent/ExitManager.ts`, `src/agent/CircuitBreaker.ts`, `src/agent/PerformanceTracker.ts`, `src/agent/HealthMonitor.ts`, `src/risk/AdaptiveRiskManager.ts`, `src/analysis/MarketRegimeDetector.ts`
**Question**: Does the autonomous agent make self-directed entry / exit / risk decisions, or is it a thin wrapper around the existing `StrategyEngine` pipeline?

> **Implementation status (2026-08-26, follow-up commits)**: ALL 8 findings
> are now IMPLEMENTED. Findings 7, 4, 3, 2 shipped in the first follow-up
> commit; findings 1, 5, 6, 8 in the second (see "Implemented follow-ups" at
> the bottom of this document, plus one bonus bug found and fixed on the way
> — `StrategyEngine.submitSignal` outcome reporting).

## Verdict: ✅ The agent IS its own brain

After reading the full `runCycle()` flow and the four brain-module collaborators, the agent is definitively **not** a thin wrapper. It performs every meaningful trading decision itself and only delegates the final order submission to the canonical `StrategyEngine.submitSignal` path — which is correct because that's the path through `OrderFactory` → `ExecutionRouter` → `PaperBroker` / `CoinDCXBroker`. The agent does not bypass the execution pipeline.

## Evidence — what the agent decides itself

### 1. Self-directed ENTRY decisions (`runCycle` lines ~275–658)

| Step | Decision | Self-directed? | How |
|---|---|---|---|
| 5 | Compute MTF state per symbol | ✅ | `mtfEngine.computeState(symbol, now)` |
| 6 | Detect regime | ✅ | `regimeDetector.detect(symbol, mtf, now)` — classifies trend/range/volatile |
| 7 | Track regime change with confirmation bars | ✅ | N consecutive observations before committing (avoids thrashing) |
| 8 | Stand-aside if TRANSITIONING | ✅ | `riskManager.isTradeable(currentRegime)` |
| 9 | In-position state handling | ✅ | Records and continues (ExitManager handles exits) |
| 10 | Circuit-breaker stand-aside | ✅ | Reads `breaker.allowEntries` and skips ALL entries if tripped |
| 11 | Cooldown check | ✅ | `now - symState.lastEntryAttemptAt < cooldownMs` |
| 12 | Portfolio capacity | ✅ | `openPositions.length >= maxOpenPositions` |
| 13 | Setup selection | ✅ | Pulls setups from `setupEngine.getSetupsAsOf`; filters to READY; picks highest-confluence |
| 14 | Confluence gate | ✅ | `best.confluence.totalScore < minConfluence` (default 65/100) |
| 15 | HTF alignment | ✅ | Setup direction must agree with 4h trend; reversal archetypes exempted |
| 16 | Trade plan construction | ✅ | `riskManager.computeTradePlan` — regime-adjusted ATR-based SL/TP/leverage/size |
| 17 | LLM confidence probe | ✅ | `probeConfidence` — best-effort, falls back to deterministic confluence |
| 18 | Size folding | ✅ | `baseSizePct × runtimeRiskMultiplier` (learning-loop output applied on top) |
| 19 | Quantity computation | ✅ | `(equity × sizePct) / stopDistance` — risk-based qty |
| 20 | Signal submission | ➡️ delegates | `strategyEngine.submitSignal(signalInput)` — canonical path |

### 2. Self-directed EXIT decisions (`ExitManager.evaluateExits`)

Exits **always run regardless of circuit-breaker state** — a tripped breaker does not prevent the agent from flattening positions whose regime has flipped.

| Trigger | Logic | Confidence |
|---|---|---|
| `UNREALIZED_LOSS_BREACH` | `computeUnrealizedPct(pos, last, equity) ≤ -maxUnrealizedLossPct` (default -2% of equity) | 0.95 |
| `REGIME_FLIP` | Three independent signals: (a) `riskMultDrop ≥ 0.3` between entry and current regime; (b) entered in a strong trend and now choppy; (c) direction mismatch (long in bearish regime or vice versa) | 0.9 |
| `SETUP_INVALIDATION` | Tracked setup state is `INVALIDATED` or `EXPIRED` | 0.85 |
| Otherwise | `HOLD` — let trailing stops manage the position | — |

### 3. Self-directed RISK decisions

| Module | Decision | Self-directed? |
|---|---|---|
| `AdaptiveRiskManager.computeTradePlan` | ATR-based stop/target/leverage per regime overlay | ✅ |
| `PerformanceTracker.suggestRiskMultiplier` | Kelly-flavored `(2 × winRate - 1) × step` per cycle, bounded `[min, max]` | ✅ |
| `runtimeRiskMultiplier` applied on top of regime overlay | Yes — folded into `sizePct` | ✅ |
| `CircuitBreaker.check` | Daily loss / consecutive losses / drawdown / unhealthy market | ✅ |
| `HealthMonitor` | Kline staleness, market state staleness, model reachability, WS disconnects | ✅ |

### 4. Self-directed REGIME detection (`MarketRegimeDetector`)

- Trend/range/volatile classification from 4h closed candles
- Volatility + correlation feature extraction
- Per-regime adaptation table: `stopAtrMultiplier`, `targetAtrMultiplier`, `riskMultiplier`, `maxLeverage`, `minRR`, `trailingActivationPct`, `trailingDistancePct`, `breakevenTriggerPct`
- N-bar confirmation before committing a regime change (configurable, default 3)

## What the agent delegates (and why that's correct)

The agent delegates only the **final order submission**:

```ts
const submitted = await this.deps.strategyEngine.submitSignal(signalInput);
```

This is correct because:
1. `StrategyEngine.submitSignal` is the canonical path through `OrderFactory` → `SignalExecutor` → `ExecutionRouter` → broker. Bypassing it would mean re-implementing order routing, rate limiting, reconciliation, and the live/paper mode switch.
2. Existing strategies use the same path — the agent is a peer of `smc-agent` and `adaptive-supertrend`, not a replacement.
3. The agent retains the **decision authority**: which setup, what direction, what size, what SL/TP, what leverage. `StrategyEngine.submitSignal` only executes the agent's plan.

## Findings — opportunities to make the agent even more autonomous

These are not bugs; they're enhancements. Each is annotated with impact and effort.

### Finding 1 — `probeConfidence` is passive, not consultative — ✅ IMPLEMENTED
**Impact**: Medium | **Effort**: Medium | **Status**: shipped (debate-driven veto — see "Implemented follow-ups")

The agent calls `probeConfidence(symbol, direction, setup, plan)` to get a confidence number from the LLM, but it doesn't ask the LLM to **veto** the trade. The existing `TradingAgentsPipeline` (multi-agent LLM debate) does this for SMC setups — `Bull Researcher` vs `Bear Researcher` vs `Debate Judge`. The autonomous agent could subscribe to the same debate for any setup, not just SMC.

**Concrete fix**: wire `TradingAgentsPipeline.runTrader(symbol, setup, plan)` into `probeConfidence` and treat a `NEUTRAL` or `BEARISH` (for long) verdict as a veto.

### Finding 2 — No position-scaling logic — ✅ IMPLEMENTED
**Impact**: Medium | **Effort**: Medium | **Status**: shipped (see "Implemented follow-ups")

When `state === 'in_position'`, the agent records and continues. It doesn't:
- Pyramid into winners (add to a profitable position at retest)
- Scale out of losers (partial close before stop fires)
- Hedge (open an offsetting position in a correlated symbol)

The `ExitManager` only decides `HOLD` or `EXIT_NOW`. A `SCALE_IN` / `SCALE_OUT` action would make the agent's intra-position behavior much richer.

### Finding 3 — No multi-strategy orchestration — ✅ IMPLEMENTED
**Impact**: High | **Effort**: Medium | **Status**: shipped (symbol lock — see "Implemented follow-ups")

The `smc-agent` strategy runs on candle closes via the same `StrategyEngine`. If both the autonomous agent and `smc-agent` detect a setup on SOLUSDT at the same time, they'll both submit signals — possibly conflicting ones (long vs short).

**Concrete fix**: add a `strategyEngine.acquireSymbolLock(symbol, strategyId)` API. The first strategy to acquire the lock owns the symbol for one cycle; others stand aside. Alternatively, the autonomous agent could consult `smc-agent`'s debate verdict before submitting its own signal.

### Finding 4 — Per-regime learning not wired into plan computation — ✅ IMPLEMENTED
**Impact**: High | **Effort**: Low-Medium | **Status**: shipped (see "Implemented follow-ups")

`PerformanceTracker.getRegimeStats(regime)` returns per-regime rolling stats (win rate, expectancy, sample size). It exists but is **not consulted** by `AdaptiveRiskManager.computeTradePlan`. The plan uses the static `regimeDetector.getAdaptation(regime)` lookup table.

If SOLUSDT in `TRENDING_STRONG` shows a 70% win rate vs 40% in `TRENDING_NORMAL`, the agent could bias the regime overlay's `riskMultiplier` toward the observed rate. Currently, the learning loop only adjusts a global `runtimeRiskMultiplier` applied uniformly to all regimes.

**Concrete fix**: in `AdaptiveRiskManager.computeTradePlan`, after computing `adaptation`, call `performanceTracker.getRegimeStats(adaptation.regime)` and bias `riskMultiplier`:
```ts
const regimeStats = performanceTracker.getRegimeStats(adaptation.regime);
const regimeBias = regimeStats ? Math.max(0.5, Math.min(1.5, regimeStats.winRate / 0.5)) : 1.0;
const adjustedRiskMultiplier = adaptation.riskMultiplier * regimeBias;
```

### Finding 5 — HTF alignment is binary, not weighted — ✅ IMPLEMENTED
**Impact**: Low | **Effort**: Low | **Status**: shipped (weighted alignment — see "Implemented follow-ups")

The current alignment check is binary: pass / fail. A more nuanced approach would weight confluence by alignment strength — e.g., a long setup with 4h strongly bullish + 1h bullish gets full confluence; 4h range + 1h bullish gets 0.7× confluence; 4h bearish + 1h bullish (counter-trend) gets 0.3× confluence unless it's a reversal archetype.

### Finding 6 — `regimeConfirmationBars` is global, not per-regime — ✅ IMPLEMENTED
**Impact**: Low | **Effort**: Low | **Status**: shipped (per-regime offset table — see "Implemented follow-ups")

A transition out of `VOLATILE` (high noise) should require more observations than a transition out of `RANGING` (low noise). Currently `regimeConfirmationBars` is a single global threshold (default 3). Per-regime thresholds would reduce false regime flips in choppy markets.

### Finding 7 — `queryRecentOutcomes` parses regime as 'UNKNOWN' — ✅ IMPLEMENTED
**Impact**: Medium | **Effort**: Low | **Status**: shipped in the dashboard/self-test/audit commit

In `PerformanceTracker.queryRecentOutcomes` (line ~196), the regime and setupType are hardcoded to `'UNKNOWN'`:
```ts
const regime = 'UNKNOWN';
const setupType = 'UNKNOWN';
```

This means `getRegimeStats(regime)` (Finding 4) won't work properly until this is fixed — the agent has no per-regime historical breakdown. The comment in the code acknowledges this and says it parses the agent's reasoning string from the opening signal, but the implementation is a TODO.

**Concrete fix**: query the `AUTONOMOUS_AGENT_SIGNAL` event by `symbol + entry-time bracket` to recover the regime and setupType at entry time, and populate `TradeOutcome.regime` / `TradeOutcome.setupType` properly. This unlocks Finding 4.

### Finding 8 — No correlation-aware portfolio risk — ✅ IMPLEMENTED
**Impact**: Medium | **Effort**: High | **Status**: shipped (PortfolioCorrelationGuard — see "Implemented follow-ups")

The agent checks `openPositions.length >= maxOpenPositions` (count-based) but doesn't check correlation. If BTC, ETH, and SOL are all long and BTC dumps, all three positions will lose simultaneously. A correlation-aware cap (`total_correlated_exposure < threshold`) would prevent this.

## Recommended next steps (priority order)

1. ~~**Finding 7**~~ ✅ done (dashboard/self-test/audit commit).
2. ~~**Finding 4**~~ ✅ done (per-regime learning bias in `computeTradePlan`).
3. ~~**Finding 3**~~ ✅ done (symbol lock in `StrategyEngine` + agent pre-check).
4. ~~**Finding 2**~~ ✅ done (`SCALE_IN` / `SCALE_OUT` in the ExitManager).
5. ~~**Finding 1**~~ ✅ done (debate-driven LLM veto in the entry path).
6. ~~**Findings 5, 6, 8**~~ ✅ done (weighted HTF alignment, per-regime
   confirmation bars, correlation-aware portfolio cap).

All 8 findings closed.

## Tests covering the autonomy contract

The existing test suite (`test/unit/AutonomousTradingAgent.test.ts`) verifies the state machine and cycle behaviour. The audit confirms the agent's decision logic is exercised end-to-end:

- ✅ State machine: `monitoring` → `seeking_entry` → `in_position` → `stand_aside` transitions
- ✅ Confluence gate (rejects setups below `minConfluence`)
- ✅ HTF alignment check (rejects counter-trend setups)
- ✅ Cooldown + portfolio capacity
- ✅ Circuit-breaker stand-aside
- ✅ Exit manager: unrealized loss breach, regime flip, setup invalidation
- ✅ Learning loop: `suggestRiskMultiplier` Kelly-flavored
- ✅ Regime confirmation bars (N consecutive observations)
- ✅ Self-test on startup (newly added in this branch)

## Summary

The agent is genuinely autonomous. It runs on its own clock (30s default), surveys every configured symbol's MTF stack, detects forming + ready setups, classifies the market regime, builds regime-adjusted trade plans with ATR-based stops/targets, probes the LLM for confidence, folds a learning-loop risk multiplier into position sizing, submits signals through the canonical pipeline, manages exits independently (unrealized loss / regime flip / setup invalidation), and trips a circuit breaker on drawdown / consecutive losses / unhealthy market.

The 8 findings above are enhancements, not blockers. The most impactful quick wins are Findings 7 + 4 (wire per-regime learning into the plan computation).

## Implemented follow-ups (2026-08-26, second batch — findings 1, 5, 6, 8)

### Finding 1 — debate-driven LLM veto
`TradingAgentsPipeline` gained a public `runVetoConsultation(ctx, direction)`:
it runs the pipeline's LLM stages (analyst team → bull/bear debate → judge →
trader) and **deliberately skips** the deterministic risk-team / fund-manager
stages — the agent has its own `AdaptiveRiskManager`, `CircuitBreaker` and the
canonical `RiskEngine` behind every signal, and CONTRACTS.md §5 keeps risk
authority out of model hands. The consultation returns
`{ action, prevailingSide, confidence, degraded, rationale }` where
`degraded` is true whenever any LLM stage emitted `failed` (i.e. we're on a
deterministic fallback). The agent's `probeConfidence` became
`probeEntryConfidence`: with the veto enabled (default,
`AUTONOMOUS_LLM_VETO_ENABLED`) and the pipeline wired, a **genuine** trader
verdict of NEUTRAL or the opposing direction **vetoes** the entry — a
`REJECTED` cycle decision with the debate rationale, a durable
`AUTONOMOUS_LLM_VETO` system event, and an `autonomous_llm_veto_total`
metric. A **degraded** consultation never vetoes and never blesses: the agent
uses its deterministic confidence and keeps trading (the "never blocks on
Ollama availability" property survives). An agreeing debate contributes its
trader confidence through the same 60/40 blend as the plain probe. The veto
runs inside the confidence-probe gate (18) — after every cheap deterministic
gate including the correlation cap (17.5), so a capped candidate never burns
LLM latency — and before signal construction.
New system event `AUTONOMOUS_LLM_VETO`.

### Finding 5 — weighted HTF alignment
The binary pass/fail gate (long needs BULLISH 4h, etc.) is now a weight on
confluence: aligned ×1.0, 4h RANGE/UNKNOWN ×`AUTONOMOUS_HTF_RANGE_WEIGHT`
(0.7), counter-trend ×`AUTONOMOUS_HTF_COUNTER_WEIGHT` (0.3) — with reversal
archetypes countering the 4h trend getting the range weight, since countering
the prior trend is their job. The weighted score must still clear
`AUTONOMOUS_MIN_CONFLUENCE`, so in practice counter-trend entries remain
unreachable at realistic scores (a 100/100 setup scores 30 at ×0.3 vs min
65) while very-high-conviction range-trend setups are no longer locked out.
The effective score feeds the deterministic confidence base, and every
submitted signal carries `features.alignmentWeight` +
`features.effectiveConfluence` for the audit trail.
`AUTONOMOUS_HTF_ALIGNMENT_WEIGHTED=false` restores the legacy binary gate.

### Finding 6 — per-regime confirmation bars
`regimeConfirmationBarsFor(prev, next, base, overrides?)` (exported from
`MarketRegimeDetector.ts`) keys the confirmation threshold on the regime
being LEFT, ranked by classification noise: leaving `RANGING_LOW_VOL` needs
base − 1, trending regimes need base, `RANGING_HIGH_VOL`/`TRANSITIONING`
need base + 1, `VOLATILE_BREAKOUT` needs base + 2. Transitions INTO
`TRANSITIONING` are never delayed — standing aside early is the safe
direction. Explicit per-regime overrides (config
`regimeConfirmationBarsByRegime`) replace the offset table and clamp to ≥ 1.
Committed regime changes now carry `confirmations: <bars required>` in both
the `AUTONOMOUS_REGIME_CHANGE` event and the `agent.autonomous.regime`
broadcast (dashboard contract updated with an optional field), so operators
can see why a change took longer to commit.

### Finding 8 — correlation-aware portfolio risk
New `src/risk/PortfolioCorrelationGuard.ts`. The entry path gained gate
17.5: the candidate's planned margin (`notional / leverage`, from the same
`positionSizing` helper that builds the signal — so the exposure the guard
approves is exactly the exposure submitted) is checked against its
**correlated cluster** — same-direction open positions whose rolling 1h
close-to-close log-return Pearson correlation with the candidate (≥ 30
closed candles on both sides, `AUTONOMOUS_CORRELATION_LOOKBACK` window)
clears `AUTONOMOUS_CORRELATION_FLOOR` (0.7). Cluster exposure is
margin-weighted (broker's `initialMargin` for open positions) and capped at
`AUTONOMOUS_CORRELATION_MAX_EXPOSURE_PCT` (0.25) of equity. The effective
correlation is ρ × direction-agreement, so hedges (opposite direction on
positively-correlated symbols, or same direction on negatively-correlated
symbols) are never counted. Pairs with insufficient history are treated as
uncorrelated and flagged `insufficientData`. Pyramid adds evaluate the same
cap through a `correlationCheck` callback on `ExitManager.evaluateScaleIn`
(with `includeSameSymbol` so the base position counts, ρ = 1 by definition)
— adds can no longer hide exposure underneath the gate. The gate runs
before any model call. `AUTONOMOUS_CORRELATION_ENABLED=false` makes the
guard a pass-through (count-based `maxOpenPositions` remains, as before).

### Verification (second batch)
Backend: typecheck ✓, lint ✓, build ✓, **587/587 tests** (+33 new in
`test/unit/AutonomyFollowups.test.ts`: guard unit tests including the ρ = −1
hedge fixture, ExitManager scale-in gate, agent-level veto / degraded /
blend / disabled / throwing-consultation tests, weighted-alignment matrix,
per-regime confirmation behaviour through `runCycle`, and the
correlation-capped entry + hedge exemption). Dashboard: typecheck ✓, 32/32
tests (regime contract gained optional `confirmations`).

## Implemented follow-ups (2026-08-26, first batch — findings 4, 3, 2)

### Finding 4 — per-regime learning bias in the trade plan
`AdaptiveRiskManagerDeps` gained an optional `getRegimeStats(regime)` lookup, wired in
`engine.ts` to `PerformanceTracker.getRegimeStats`. `computeTradePlan` now computes a
`regimeBias = clamp(winRate / 0.5, 0.5, 1.5)` (50% win rate = neutral ×1.0; 70% → ×1.4;
30% → ×0.6) and folds it into the plan's `riskMultiplier` = `regimeOverlay × regimeBias`.
The bias is surfaced on `TradePlan.regimeBias`, in `planToFeatures()` (so every signal
carries it), and in the agent's signal reasoning (`regimeBias=1.40`). Learning can now
refine the regime overlay but never override it — bounded by construction.

### Finding 3 — symbol lock (multi-strategy orchestration)
`StrategyEngine` gained a symbol lock: the first strategy whose OPEN signal is accepted
acquires exclusive entry rights on that symbol for `SYMBOL_LOCK_TTL_MS` (default 5 min,
refreshed on every accepted signal). Other strategies' OPEN signals on that symbol are
rejected with an explicit reason (`symbol locked by strategy X (Ns remaining)`), both on
the candle-driven path (`processSignal`) and the agent path (`submitSignal` fast-path
that returns a proper REJECTED signal without poisoning the dedup map). CLOSE /
CANCEL_ALL always pass — reducing risk is never blocked. The agent also pre-checks the
lock in its entry scan (gate 16.5, before the LLM confidence probe) and records a clean
`STAND_ASIDE` decision. Env: `SYMBOL_LOCK_ENABLED` (default true), `SYMBOL_LOCK_TTL_MS`.

### Finding 2 — position scaling (SCALE_IN / SCALE_OUT)
The ExitManager now owns a richer intra-position action space:

- **SCALE_OUT (downside de-risk)**: when unrealized loss lands in the band
  [`AUTONOMOUS_SCALE_OUT_TRIGGER_PCT`, `AUTONOMOUS_EXIT_MAX_UNREALIZED_LOSS_PCT`)
  it closes `AUTONOMOUS_SCALE_OUT_CLOSE_FRACTION` (default half) of the position **once
  per position lifecycle**, before the full-breach exit or trailing stop fires. Full
  breach / regime flip / setup invalidation still take the WHOLE position (precedence
  preserved by check ordering).
- **SCALE_IN (pyramid into winners)**: when the position is profitable by ≥
  `AUTONOMOUS_SCALE_IN_MIN_PROFIT_PCT` of equity AND a fresh aligned READY setup (≥
  min confluence) confirms the move AND a fresh regime-adjusted plan clears the regime
  min-RR AND the per-position add budget (`AUTONOMOUS_SCALE_IN_MAX_ADDS`, default 1)
  and add cooldown (`AUTONOMOUS_SCALE_IN_COOLDOWN_MS`) allow it, the agent adds
  `AUTONOMOUS_SCALE_IN_SIZE_FRACTION` (default 50%) of the current position size — a
  classic decreasing pyramid. Each add carries its own SL/TP from the fresh plan.

Enabling plumbing (all backward compatible):
- `SignalExecutor` honours `features.closeFraction` (0..1] on CLOSE signals — absent or
  invalid falls back to a full close, the historical behaviour.
- `signalsEqual` honours `features.dedupKey`: identity-dedup by default, but a
  dedupKey-carrying signal only dedups against the SAME key — this is what lets a
  second OPEN (pyramid add) or a partial CLOSE (de-risk) through the engine's dedup
  without allowing double-fires of the same intent.
- New system events `AUTONOMOUS_SCALE_IN` / `AUTONOMOUS_SCALE_OUT`; scale-outs
  broadcast on `agent.autonomous.exit` (partial close, visible in the dashboard exits
  feed) and scale-ins on `agent.autonomous.signal` (visible in the signals feed) — no
  dashboard schema changes required.
- Per-position scaling state (add budget, de-risk allowance) is keyed by position
  identity (symbol + open time) and auto-resets when the position closes.
- Env knobs: `AUTONOMOUS_SCALING_ENABLED` (default true) + the seven `AUTONOMOUS_SCALE_*`
  variables above. All are bounded and independently disable-able.

### Bonus bug found & fixed — `submitSignal` outcome reporting
While wiring the lock fast-path I found that `StrategyEngine.submitSignal` returned the
stored signal with status `CREATED` even when the executor had accepted it
(`SignalExecutor` persists EXECUTED to the DB without mutating the in-memory object).
Every caller that gates on `status === 'EXECUTED' || 'ACCEPTED'` — the agent's entry
path and both ExitManager paths — was misreporting filled orders as rejections.
`submitSignal` now returns a read-time EXECUTED **view** when the stored signal was
accepted, deliberately WITHOUT mutating the stored object (so `expireSignals`' lifecycle
— which recycles CREATED entries and re-enables future identical submissions — stays
intact).

### Verification
Backend: typecheck ✓, lint ✓, build ✓, **554/554 tests** (+37 new:
`test/unit/AgentOrchestration.test.ts` with 35 tests across the three features, plus 2
agent-level integration tests in `test/unit/AutonomousTradingAgent.test.ts`).
Dashboard: typecheck ✓, 32/32 tests.
