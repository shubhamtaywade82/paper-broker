# Autonomous Agent — Self-Directed Decision Audit

**Date**: 2026-08-26
**Scope**: `src/agent/AutonomousTradingAgent.ts`, `src/agent/ExitManager.ts`, `src/agent/CircuitBreaker.ts`, `src/agent/PerformanceTracker.ts`, `src/agent/HealthMonitor.ts`, `src/risk/AdaptiveRiskManager.ts`, `src/analysis/MarketRegimeDetector.ts`
**Question**: Does the autonomous agent make self-directed entry / exit / risk decisions, or is it a thin wrapper around the existing `StrategyEngine` pipeline?

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

### Finding 1 — `probeConfidence` is passive, not consultative
**Impact**: Medium | **Effort**: Medium

The agent calls `probeConfidence(symbol, direction, setup, plan)` to get a confidence number from the LLM, but it doesn't ask the LLM to **veto** the trade. The existing `TradingAgentsPipeline` (multi-agent LLM debate) does this for SMC setups — `Bull Researcher` vs `Bear Researcher` vs `Debate Judge`. The autonomous agent could subscribe to the same debate for any setup, not just SMC.

**Concrete fix**: wire `TradingAgentsPipeline.runTrader(symbol, setup, plan)` into `probeConfidence` and treat a `NEUTRAL` or `BEARISH` (for long) verdict as a veto.

### Finding 2 — No position-scaling logic
**Impact**: Medium | **Effort**: Medium

When `state === 'in_position'`, the agent records and continues. It doesn't:
- Pyramid into winners (add to a profitable position at retest)
- Scale out of losers (partial close before stop fires)
- Hedge (open an offsetting position in a correlated symbol)

The `ExitManager` only decides `HOLD` or `EXIT_NOW`. A `SCALE_IN` / `SCALE_OUT` action would make the agent's intra-position behavior much richer.

### Finding 3 — No multi-strategy orchestration
**Impact**: High | **Effort**: Medium

The `smc-agent` strategy runs on candle closes via the same `StrategyEngine`. If both the autonomous agent and `smc-agent` detect a setup on SOLUSDT at the same time, they'll both submit signals — possibly conflicting ones (long vs short).

**Concrete fix**: add a `strategyEngine.acquireSymbolLock(symbol, strategyId)` API. The first strategy to acquire the lock owns the symbol for one cycle; others stand aside. Alternatively, the autonomous agent could consult `smc-agent`'s debate verdict before submitting its own signal.

### Finding 4 — Per-regime learning not wired into plan computation
**Impact**: High | **Effort**: Low-Medium

`PerformanceTracker.getRegimeStats(regime)` returns per-regime rolling stats (win rate, expectancy, sample size). It exists but is **not consulted** by `AdaptiveRiskManager.computeTradePlan`. The plan uses the static `regimeDetector.getAdaptation(regime)` lookup table.

If SOLUSDT in `TRENDING_STRONG` shows a 70% win rate vs 40% in `TRENDING_NORMAL`, the agent could bias the regime overlay's `riskMultiplier` toward the observed rate. Currently, the learning loop only adjusts a global `runtimeRiskMultiplier` applied uniformly to all regimes.

**Concrete fix**: in `AdaptiveRiskManager.computeTradePlan`, after computing `adaptation`, call `performanceTracker.getRegimeStats(adaptation.regime)` and bias `riskMultiplier`:
```ts
const regimeStats = performanceTracker.getRegimeStats(adaptation.regime);
const regimeBias = regimeStats ? Math.max(0.5, Math.min(1.5, regimeStats.winRate / 0.5)) : 1.0;
const adjustedRiskMultiplier = adaptation.riskMultiplier * regimeBias;
```

### Finding 5 — HTF alignment is binary, not weighted
**Impact**: Low | **Effort**: Low

The current alignment check is binary: pass / fail. A more nuanced approach would weight confluence by alignment strength — e.g., a long setup with 4h strongly bullish + 1h bullish gets full confluence; 4h range + 1h bullish gets 0.7× confluence; 4h bearish + 1h bullish (counter-trend) gets 0.3× confluence unless it's a reversal archetype.

### Finding 6 — `regimeConfirmationBars` is global, not per-regime
**Impact**: Low | **Effort**: Low

A transition out of `VOLATILE` (high noise) should require more observations than a transition out of `RANGING` (low noise). Currently `regimeConfirmationBars` is a single global threshold (default 3). Per-regime thresholds would reduce false regime flips in choppy markets.

### Finding 7 — `queryRecentOutcomes` parses regime as 'UNKNOWN'
**Impact**: Medium | **Effort**: Low

In `PerformanceTracker.queryRecentOutcomes` (line ~196), the regime and setupType are hardcoded to `'UNKNOWN'`:
```ts
const regime = 'UNKNOWN';
const setupType = 'UNKNOWN';
```

This means `getRegimeStats(regime)` (Finding 4) won't work properly until this is fixed — the agent has no per-regime historical breakdown. The comment in the code acknowledges this and says it parses the agent's reasoning string from the opening signal, but the implementation is a TODO.

**Concrete fix**: query the `AUTONOMOUS_AGENT_SIGNAL` event by `symbol + entry-time bracket` to recover the regime and setupType at entry time, and populate `TradeOutcome.regime` / `TradeOutcome.setupType` properly. This unlocks Finding 4.

### Finding 8 — No correlation-aware portfolio risk
**Impact**: Medium | **Effort**: High

The agent checks `openPositions.length >= maxOpenPositions` (count-based) but doesn't check correlation. If BTC, ETH, and SOL are all long and BTC dumps, all three positions will lose simultaneously. A correlation-aware cap (`total_correlated_exposure < threshold`) would prevent this.

## Recommended next steps (priority order)

1. **Finding 7** (low effort, unlocks Finding 4) — populate `regime` and `setupType` in `queryRecentOutcomes` by parsing the `AUTONOMOUS_AGENT_SIGNAL` event log.
2. **Finding 4** (low-medium effort, high impact) — wire `getRegimeStats` into `computeTradePlan`'s riskMultiplier.
3. **Finding 3** (medium effort, high impact) — add symbol-lock or debate-consultation to prevent conflicts with `smc-agent`.
4. **Finding 2** (medium effort, medium impact) — add `SCALE_IN` / `SCALE_OUT` actions to `ExitManager`.
5. **Finding 1** (medium effort, medium impact) — wire `TradingAgentsPipeline.runTrader` into `probeConfidence` for veto power.
6. **Findings 5, 6, 8** — defer until the above are done.

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
