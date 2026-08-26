# Autonomous AI Trading Agent

> An opt-in agentic loop that sits **above** the existing candle-driven
> strategy fleet and runs the trading system **on its own clock** —
> surveying every symbol's MTF stack every cycle, detecting FORMING
> setups before they complete, aligning HTF regime with MTF setup with
> LTF trigger, classifying the market regime, building regime-adjusted
> trade plans, and submitting signals through the same `StrategyEngine`
> pipeline the rest of the strategies use.

---

## TL;DR — how to turn it on

```bash
# 1. Install Ollama and pull an open-weight model
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen3.5:2b        # or llama3:8b, mistral:7b, gemma2:9b

# 2. Enable the agent in your .env
echo "AUTONOMOUS_AGENT_ENABLED=true" >> .env

# 3. Start the engine in autonomous mode
pnpm paper:autonomous
```

The agent is **disabled by default** — existing deployments keep their
candle-driven behaviour until the operator explicitly opts in.

---

## What problem does this solve?

The pre-existing engine is **event-driven**: strategies only fire on
Binance candle-close events. That works fine for trend-following on
closed candles, but it has three structural gaps relative to the
"runs autonomously on itself" vision:

1. **No early setup detection.** Setups that are *forming* (e.g. a
   liquidity sweep + bullish CHoCH + FVG retest assembling on 15m but
   not yet triggered on 5m) don't trigger anything until the trigger
   candle actually closes. By then the move may have already started.
2. **No regime-aware risk adaptation.** The same `RiskConfig` is used
   in trending and ranging markets. Stops that work in a strong trend
   get stopped out in chop; size that's fine in low-vol is too big in
   a breakout.
3. **No top-level orchestrator.** Each strategy is independent; nothing
   coordinates "should we even be trading this symbol right now?"

The autonomous agent closes all three gaps without touching the
existing strategy fleet — it adds a layer, not a replacement.

---

## Architecture

```
                       ┌─────────────────────────────────────┐
                       │      AutonomousTradingAgent         │
                       │   (polls every AUTONOMOUS_CYCLE_MS)  │
                       └───────────────┬─────────────────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        │                              │                              │
        ▼                              ▼                              ▼
┌──────────────────┐       ┌────────────────────┐         ┌────────────────────┐
│ MarketRegime     │       │ SetupEngine        │         │ AdaptiveRiskManager│
│ Detector        │       │ (existing)         │         │ (new)              │
│ → regime +      │       │   getSetupsAsOf()  │         │   computeTradePlan │
│   adaptation     │       │   returns FORMING  │         │   → SL/TP/lev/size │
└──────────────────┘       │   + READY setups  │         └────────────────────┘
                           └────────────────────┘
                                       │
                                       ▼
                         ┌──────────────────────────┐
                         │ ModelManager (router)    │
                         │ → LLM confidence probe   │
                         │   (Ollama, falls back to │
                         │    deterministic conf)   │
                         └──────────────────────────┘
                                       │
                                       ▼
                  ┌──────────────────────────────────────┐
                  │ StrategyEngine.submitSignal(input)  │
                  │   (existing pipeline — cooldown,    │
                  │    conflict check, SignalExecutor,  │
                  │    OrderFactory, broker)            │
                  └──────────────────────────────────────┘
```

The agent **never bypasses** the existing execution guardrails. Every
signal it submits goes through `StrategyEngine.submitSignal`, which runs
the same cooldown / dedup / conflict check / SignalExecutor / OrderFactory
path a regular strategy's signal would. The agent gets no special
treatment — it just has more context.

---

## New modules

| File | Purpose |
|------|---------|
| `src/agent/AutonomousTradingAgent.ts` | The polling loop. Surveys each symbol per cycle, runs regime detection, queries the SetupEngine for forming/ready setups, validates alignment, builds trade plans, submits signals, broadcasts WebSocket events. |
| `src/agent/types.ts` | Shared types: `AgentState`, `PerSymbolState`, `AutonomousCycleSummary`, `AutonomousSignalRecord`. |
| `src/analysis/MarketRegimeDetector.ts` | Classifies the current regime per symbol (TRENDING_STRONG / TRENDING_NORMAL / RANGING_LOW_VOL / RANGING_HIGH_VOL / VOLATILE_BREAKOUT / TRANSITIONING) and returns a `RegimeAdaptation` with regime-specific stop/TP/leverage/trailing values. Reuses the existing `extractMarketFeatures` (ADX, Bollinger band-width, RSI, MACD, ATR, volume ratio). |
| `src/risk/AdaptiveRiskManager.ts` | Translates a regime + symbol into a concrete `TradePlan` (entry, stop, target, leverage, size multiplier, RR). Capped against the base `RiskConfig` so a regime can never authorise more leverage than the operator-configured ceiling. |
| `src/ai/ModelManager.ts` | Unified router over the open-weight model fleet. Today only `llm` is wired (Ollama local daemon + Ollama Cloud accounts). `vision` (chart-image pattern recognition via LLaVA) and `timeSeries` (TFT/Chrono-Bert forecasting) are declared as stubs so callers compile today and adapters can be slotted in later without touching call sites. |

The agent also reuses existing infrastructure end-to-end:

- **`SetupEngine`** (`src/market/setup/SetupEngine.ts`) — its state machine
  already classifies setups as `WATCHING → LIQUIDITY_INTERACTION →
  STRUCTURE_CONFIRMATION → ZONE_IDENTIFIED → RETEST → TRIGGERED →
  READY`. "Forming" = anything from WATCHING to RETEST; "Ready" = READY.
- **`MtfStateEngine`** (`src/market/MtfStateEngine.ts`) — 4h/1h/15m/5m
  state + sync status. The agent pulls `computeState(symbol, asOf)` every
  cycle and feeds it to both the regime detector and the setup engine.
- **`StrategyEngine.submitSignal`** — new public entry-point added in
  `src/strategy/StrategyEngine.ts` so external decision-makers can submit
  signals through the same guardrails as a registered strategy.
- **`EventLog`** — every cycle, regime change, signal, and rejection is
  persisted as a system event (`AUTONOMOUS_AGENT_STARTED`,
  `AUTONOMOUS_AGENT_STOPPED`, `AUTONOMOUS_AGENT_SIGNAL`,
  `AUTONOMOUS_AGENT_REJECTED`, `AUTONOMOUS_REGIME_CHANGE`,
  `AUTONOMOUS_CYCLE_COMPLETED`).
- **`WebSocketGateway`** — every cycle broadcasts a summary event so
  the dashboard can render decisions in real time.

---

## One cycle, step by step

1. **For each configured symbol:**
   1. Compute `MtfStateEngine.computeState(symbol, now)` — full 4h/1h/15m/5m
      sync state.
   2. `MarketRegimeDetector.detect(symbol, mtf, now)` — extract 9-dim
      features from closed 4h candles, classify the regime, compute
      confidence.
   3. **Regime confirmation gate (per-regime, Finding 6).** If the regime
      differs from the previous cycle, bump an observation counter; only
      commit the change after enough consecutive observations — the count is
      **per-regime**, keyed on the regime being left:
      leaving `RANGING_LOW_VOL` needs `AUTONOMOUS_REGIME_CONFIRMATION_BARS − 1`,
      leaving a trending regime needs the base (default 3), leaving
      `RANGING_HIGH_VOL`/`TRANSITIONING` needs base + 1, and leaving
      `VOLATILE_BREAKOUT` — the noisiest — needs base + 2. Transitions INTO
      `TRANSITIONING` are never delayed (standing aside early is the safe
      direction). This prevents noisy regimes from thrashing the strategy
      profile.
   4. **Stand-aside.** If the current regime is `TRANSITIONING`, log a
      "stand aside" decision and move to the next symbol. No entries in
      ambiguous regimes.
   5. **Position check.** If we already hold a position on this symbol,
      mark the symbol state `in_position` and move on. The trailing-stop
      controller (existing) is what manages the exit.
   6. **Cooldown check.** If we attempted an entry on this symbol within
      the last `AUTONOMOUS_COOLDOWN_MS` (default 5 min), skip.
   7. **Portfolio capacity.** If we're at `AUTONOMOUS_MAX_OPEN_POSITIONS`
      (default 3), skip new entries.
   8. **Setup scan.** `SetupEngine.getSetupsAsOf(symbol, now)` returns
      the candidate long + short setups at their current state. We
      partition them into:
      - **Forming** (status `ACTIVE`, state in `WATCHING..RETEST`) —
        broadcast as `agent.autonomous.forming` so the dashboard can
        show "what's coming".
      - **Ready** (status `READY`) — eligible for entry.
   9. **Confluence gate × weighted HTF alignment (Finding 5).** Pick the
      highest-confluence READY setup. Its confluence score is scaled by how
      strongly the 4h trend supports the direction:
      aligned = ×1.0, 4h RANGE/UNKNOWN = ×0.7, counter-trend = ×0.3
      (reversal archetypes countering the 4h trend get the ×0.7 range weight
      instead). The weighted score must clear `AUTONOMOUS_MIN_CONFLUENCE`.
      In practice a hard-misaligned setup needs a near-perfect 100/100
      confluence to clear a ×0.3 weight at min 65 — the binary gate's
      rejection behaviour survives, but high-conviction range-trend setups
      are no longer locked out. Set `AUTONOMOUS_HTF_ALIGNMENT_WEIGHTED=false`
      to restore the legacy binary pass/fail gate.
   10. **Trade plan.** `AdaptiveRiskManager.computeTradePlan(symbol,
       direction, regimeAdaptation)` returns stop/target/leverage/size
       based on ATR scaled by the regime's `stopAtrMultiplier` and
       `targetAtrMultiplier`. If the realised RR is below the regime's
       `minRR`, the plan is rejected — "the regime can't pay for the
       stop we'd need".
   11. **Correlation-aware portfolio capacity (Finding 8).** Before any
       model call, the candidate's planned margin is checked against the
       correlated cluster: same-direction open positions whose rolling
       1h-return Pearson correlation with the candidate clears
       `AUTONOMOUS_CORRELATION_FLOOR` count toward a cap of
       `AUTONOMOUS_CORRELATION_MAX_EXPOSURE_PCT` of equity (margin-weighted).
       This is what stops "BTC + ETH + SOL all long" — three positions that
       are really one bet. Hedges (opposite direction, or negative
       correlation) don't count.
   12. **Model confidence probe + debate veto (Finding 1).** With the veto
       enabled (default), the setup is first put in front of the same
       bull/bear debate the SMC strategy uses (`TradingAgentsPipeline`:
       analyst → bull vs bear → judge → trader). A **genuine** NEUTRAL or
       opposing trader verdict **vetoes** the entry (durable
       `AUTONOMOUS_LLM_VETO` event). If any debate stage fell back —
       Ollama down, timeout — the consultation is *degraded* and NEVER
       vetoes: the agent falls back to the plain probe path. Without the
       consultant (or with `AUTONOMOUS_LLM_VETO_ENABLED=false`) the plain
       probe runs: one best-effort LLM call via `ModelManager.complete()`,
       blended 60/40 with a deterministic confidence derived from the
       weighted confluence + RR bonus. Either way the agent never blocks
       on model availability.
   13. **Confidence gate.** If the blended confidence < 
       `AUTONOMOUS_MIN_CONFIDENCE` (default 0.55), reject and log.
   14. **Position sizing.** `riskAmount = equity * sizePct`, where
       `sizePct = baseRiskPerTradePct * regime.riskMultiplier`. Then
       `quantity = riskAmount / stopDistance`. Folded into
       `signalInput.features['quantity']` — exactly the key
       `SignalExecutor` reads. The signal also carries
       `features.alignmentWeight` and `features.effectiveConfluence` so the
       audit trail shows the weighted score that justified the entry.
   15. **Submit.** `strategyEngine.submitSignal(signalInput)` runs the
       existing pipeline: cooldown, dedup, conflict check, signal
       repository insert, `SignalExecutor.execute()`, broker order +
       SL + TP placement.
2. **Broadcast + persist.** Every cycle ends by emitting
   `agent.autonomous.cycle` (full summary, WebSocket) and an
   `AUTONOMOUS_CYCLE_COMPLETED` system event (event log). Metrics gauges
   for forming/ready/standing-aside counts are updated.

---

## Configuration (`.env`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `AUTONOMOUS_AGENT_ENABLED` | `true` | Master switch (autonomous-first; only explicit `false` disables). |
| `AUTONOMOUS_CYCLE_MS` | `30000` | Polling interval (min 5s). |
| `AUTONOMOUS_MIN_CONFLUENCE` | `65` | Min confluence score (0..100) for entry. |
| `AUTONOMOUS_MIN_RR` | `1.5` | Base min reward:risk — regime may push higher. |
| `AUTONOMOUS_MAX_OPEN_POSITIONS` | `3` | Max concurrent positions portfolio-wide. |
| `AUTONOMOUS_PER_SYMBOL_MAX_POSITIONS` | `1` | Per-symbol cap for independent entries (pyramid adds are governed separately). |
| `AUTONOMOUS_COOLDOWN_MS` | `300000` | Cooldown after an entry attempt on a symbol. |
| `AUTONOMOUS_REGIME_CONFIRMATION_BARS` | `3` | Bars that must agree before a regime change commits. |
| `AUTONOMOUS_MIN_CONFIDENCE` | `0.55` | Min blended model + deterministic confidence for entry. |
| `AUTONOMOUS_STRATEGY_ID` | `autonomous-agent` | Strategy ID stamped on agent-submitted signals. |
| `AUTONOMOUS_SCALING_ENABLED` | `true` | Position scaling master switch (pyramid adds + downside de-risk). |
| `AUTONOMOUS_SCALE_IN_MIN_PROFIT_PCT` | `0.01` | Unrealized profit (fraction of equity) required before a pyramid add. |
| `AUTONOMOUS_SCALE_IN_SIZE_FRACTION` | `0.5` | Each add's quantity as a fraction of the CURRENT position size. |
| `AUTONOMOUS_SCALE_IN_MAX_ADDS` | `1` | Max adds per position lifecycle. |
| `AUTONOMOUS_SCALE_IN_COOLDOWN_MS` | `900000` | Min time between adds on the same position. |
| `AUTONOMOUS_SCALE_OUT_TRIGGER_PCT` | `0.01` | Unrealized loss (fraction of equity) triggering a one-time partial de-risk. |
| `AUTONOMOUS_SCALE_OUT_CLOSE_FRACTION` | `0.5` | Fraction of the position closed by the de-risk. |
| `SYMBOL_LOCK_ENABLED` | `true` | One strategy owns a symbol's entry rights for the lock TTL (multi-strategy orchestration). |
| `SYMBOL_LOCK_TTL_MS` | `300000` | How long an accepted OPEN signal owns the symbol. |
| `AUTONOMOUS_LLM_VETO_ENABLED` | `true` | Debate-driven LLM veto: entries face the bull/bear debate; a genuine opposing verdict blocks the entry (Finding 1). |
| `AUTONOMOUS_HTF_ALIGNMENT_WEIGHTED` | `true` | Weight confluence by HTF-alignment strength instead of the legacy binary gate (Finding 5). |
| `AUTONOMOUS_HTF_RANGE_WEIGHT` | `0.7` | Confluence weight when the 4h trend is RANGE/UNKNOWN, or a reversal counters the 4h trend. |
| `AUTONOMOUS_HTF_COUNTER_WEIGHT` | `0.3` | Confluence weight for a non-reversal setup countering the 4h trend. |
| `AUTONOMOUS_CORRELATION_ENABLED` | `true` | Correlation-aware portfolio cap on top of the count-based maxOpenPositions gate (Finding 8). |
| `AUTONOMOUS_CORRELATION_FLOOR` | `0.7` | Rolling 1h-return Pearson ρ at/above which a same-direction position joins the correlated cluster. |
| `AUTONOMOUS_CORRELATION_MAX_EXPOSURE_PCT` | `0.25` | Max margin-weighted correlated exposure as a fraction of equity (candidate + cluster). |
| `AUTONOMOUS_CORRELATION_LOOKBACK` | `50` | Candles used for the pairwise correlation estimate. |

The agent also reads the existing `OLLAMA_*` env vars for the model
endpoint configuration — see `src/ai/ModelManager.ts` and the engine
wiring in `src/engine.ts`.

---

## Per-regime learning bias (the learning loop × the regime overlay)

On top of the static regime adaptation table, `AdaptiveRiskManager.computeTradePlan`
consults the PerformanceTracker's **per-regime** rolling stats. If the agent has
enough closed trades in the *current* regime (`AUTONOMOUS_LEARN_MIN_SAMPLE`), the
plan's `riskMultiplier` is multiplied by

```
regimeBias = clamp(observedWinRate / 0.5, 0.5, 1.5)
```

A 50% win rate is neutral (×1.0), a 70% win rate scales risk up to ×1.4, and a
30% win rate scales it down to ×0.6 — bounded so the learning loop can refine the
regime overlay but never override it. The effective multiplier for sizing is
`regimeOverlay.riskMultiplier × regimeBias × runtimeRiskMultiplier` (the last one is
the global learning-loop multiplier from `suggestRiskMultiplier`). The bias is
surfaced on every signal's features (`regimeBias`) and in the reasoning string.

---

## Position scaling (SCALE_IN / SCALE_OUT)

The agent's intra-position behaviour is richer than HOLD-or-exit:

- **SCALE_IN — pyramid into winners.** When an open position is profitable by at
  least `AUTONOMOUS_SCALE_IN_MIN_PROFIT_PCT` of equity AND a fresh aligned READY
  setup (≥ `AUTONOMOUS_MIN_CONFLUENCE`) confirms the move AND a fresh
  regime-adjusted plan clears the regime's min RR, the agent adds
  `AUTONOMOUS_SCALE_IN_SIZE_FRACTION` of the current position size (classic
  decreasing pyramid). Each add carries **its own SL/TP** computed from the fresh
  plan, so every unit of added exposure is independently protected. Bounded by
  `AUTONOMOUS_SCALE_IN_MAX_ADDS` per position lifecycle and
  `AUTONOMOUS_SCALE_IN_COOLDOWN_MS` between adds. Pyramid adds are blocked while
  the circuit breaker is tripped (de-risking is never blocked).
- **SCALE_OUT — de-risk losers.** When unrealized loss lands in the band
  [`AUTONOMOUS_SCALE_OUT_TRIGGER_PCT`, `AUTONOMOUS_EXIT_MAX_UNREALIZED_LOSS_PCT`),
  the agent closes `AUTONOMOUS_SCALE_OUT_CLOSE_FRACTION` of the position **once** —
  cutting exposure before the full-breach exit or trailing stop fires, while the
  runner keeps the stop protection. A full breach, regime flip, or setup
  invalidation still takes the WHOLE position (precedence by check ordering).

Both actions flow through the same `StrategyEngine.submitSignal` pipeline. Partial
closes carry `features.closeFraction` (honoured by the SignalExecutor) and every
scaling signal carries a `features.dedupKey` so the engine's identity dedup neither
blocks the second OPEN/CLOSE on a symbol nor allows a double-fire of the same
intent. Per-position scaling state resets automatically when the position closes.

---

## Symbol lock (multi-strategy orchestration)

The autonomous agent and the candle-driven strategy fleet (e.g. `smc-agent`)
share one `StrategyEngine`. To guarantee they can never race each other into
conflicting entries on the same symbol, the engine maintains a **symbol lock**:
the first strategy whose OPEN signal is accepted owns that symbol's entry rights
for `SYMBOL_LOCK_TTL_MS` (refreshed on every accepted signal). Other strategies'
OPEN signals on that symbol are rejected with an explicit reason. CLOSE /
CANCEL_ALL always pass — reducing risk is never blocked. The agent pre-checks the
lock in its entry scan (before the LLM confidence probe) and records a clean
`STAND_ASIDE` decision like `Symbol locked by strategy smc-agent (240s remaining)`.
Disable with `SYMBOL_LOCK_ENABLED=false`.

---

## LLM veto via debate consultation (Finding 1)

The agent's confidence probe used to be *passive*: it asked the LLM for a
confidence number and blended it in. It now also gives the model the power to
say **no**. When `AUTONOMOUS_LLM_VETO_ENABLED=true` (default) and the
`TradingAgentsPipeline` is wired, every entry candidate that survives the
cheap gates is put in front of the same multi-agent debate the `smc-agent`
strategy uses:

1. **Analyst team** — derivatives/order-flow read of the market facts.
2. **Bull vs bear debate** — configurable rounds, each rebutting the prior.
3. **Debate judge** — which side presented stronger evidence.
4. **Trader** — final LONG / SHORT / NEUTRAL action with confidence.

The deterministic risk-team / fund-manager stages are deliberately skipped:
the agent already has its own `AdaptiveRiskManager`, `CircuitBreaker` and the
canonical `RiskEngine` behind the signal, and CONTRACTS.md Section 5 keeps
risk authority out of model hands. The debate is *consultative*, not
authoritative.

**Veto rule:** a genuine trader verdict of NEUTRAL, or one opposing the
intended direction, blocks the entry — recorded as a `REJECTED` decision with
the debate rationale and a durable `AUTONOMOUS_LLM_VETO` system event.

**Degradation contract:** if ANY debate stage fell back (Ollama down,
timeout, schema failure) the consultation is flagged `degraded` and **never
vetoes** — a fallback NEUTRAL is not a model opinion. The agent falls back to
its deterministic confidence and keeps trading. This preserves the
"never blocks on model availability" property that has been the design rule
since the first confidence probe.

When the debate agrees, its trader confidence is blended 60/40 with the
deterministic base — exactly like the plain probe — so no single source runs
away with the decision. With the veto disabled the plain single-call probe
runs unchanged.

---

## Weighted HTF alignment (Finding 5)

The old alignment gate was binary: a long setup needed a BULLISH 4h trend
(else rejection, with only RANGE/UNKNOWN reversals exempt). The gate is now a
weight on the confluence score:

| 4h trend vs direction | Weight (default) |
|---|---|
| Aligned (LONG+BULLISH / SHORT+BEARISH) | ×1.0 |
| RANGE / UNKNOWN | ×0.7 (`AUTONOMOUS_HTF_RANGE_WEIGHT`) |
| Opposing, reversal archetype | ×0.7 (countering the 4h trend is the archetype's job) |
| Opposing, non-reversal | ×0.3 (`AUTONOMOUS_HTF_COUNTER_WEIGHT`) |

The weighted score must clear `AUTONOMOUS_MIN_CONFLUENCE`. Practical effect:
a counter-trend setup needs a near-perfect 100/100 confluence to clear a ×0.3
weight at min 65 (so the old rejection behaviour survives for realistic
scores), while a very-high-conviction setup in a RANGE 4h is no longer locked
out. The effective score feeds the confidence probe, and every submitted
signal carries `features.alignmentWeight` + `features.effectiveConfluence`
for the audit trail. Set `AUTONOMOUS_HTF_ALIGNMENT_WEIGHTED=false` to restore
the legacy binary gate.

---

## Correlation-aware portfolio risk (Finding 8)

The count-based `AUTONOMOUS_MAX_OPEN_POSITIONS` gate can't see that BTC, ETH
and SOL all long is *one* bet. The `PortfolioCorrelationGuard`
(`src/risk/PortfolioCorrelationGuard.ts`) adds a second, correlation-aware
gate at entry time (and for pyramid adds):

- **Pairwise correlation** is estimated from rolling 1h close-to-close log
  returns (Pearson, `AUTONOMOUS_CORRELATION_LOOKBACK` candles, both symbols
  need ≥ 30 closed candles for a trusted estimate).
- A position joins the candidate's **correlated cluster** only when the
  *effective* correlation — ρ × direction-agreement — clears
  `AUTONOMOUS_CORRELATION_FLOOR`. Same-direction + positive ρ compounds;
  opposite-direction + positive ρ (or same-direction + negative ρ) is a hedge
  and is ignored.
- Exposure is measured in **margin** (the broker's `initialMargin`; the
  candidate's notional / leverage), so a 10x scalp and a 2x swing are compared
  in the capital the account actually commits.
- The candidate is rejected when `candidate margin + Σ cluster margins >
  AUTONOMOUS_CORRELATION_MAX_EXPOSURE_PCT × equity`.

Design notes: pairs with insufficient candle history are treated as
uncorrelated (flagged `insufficientData` in the check result) so newly listed
symbols aren't silently blocked; the check runs BEFORE the model calls so a
capped candidate never burns LLM latency; and pyramid adds evaluate the same
cap with the base position included (`includeSameSymbol`) so adds can't hide
exposure underneath the gate. With `AUTONOMOUS_CORRELATION_ENABLED=false` the
guard is a pass-through and the count-based gate is the only portfolio check.

---

## Regime adaptation table

| Regime | Risk multiplier | Stop ATR | Target ATR | Min RR | Max lev | Trailing act / dist |
|--------|----------------:|---------:|-----------:|-------:|--------:|---------------------|
| `TRENDING_STRONG` | 1.2 | 2.0 | 6.0 | 2.5 | 7 | 1.5% / 1.2% |
| `TRENDING_NORMAL` | 1.0 | 1.75 | 4.5 | 2.0 | 5 | 2.0% / 1.5% |
| `RANGING_LOW_VOL` | 0.7 | 1.25 | 2.5 | 1.5 | 3 | 1.2% / 0.8% |
| `RANGING_HIGH_VOL` | 0.5 | 1.75 | 3.0 | 1.5 | 2 | 1.8% / 1.4% |
| `VOLATILE_BREAKOUT` | 0.8 | 2.5 | 5.5 | 2.0 | 4 | 2.5% / 2.0% |
| `TRANSITIONING` | 0.6 | 1.5 | 3.0 | 1.8 | 3 | 1.5% / 1.2% (but agent stands aside) |

Leverage is **always** capped to `min(regimeMaxLeverage, RiskConfig.maxLeverage)`
— a regime can never authorise more leverage than the operator-configured
ceiling in `DEFAULT_RISK_CONFIG`.

---

## WebSocket events

All events are added to the existing `WebSocketEventType` union.

| Event | Payload | When |
|-------|---------|------|
| `agent.autonomous.cycle` | `AutonomousCycleSummary` | End of every cycle. |
| `agent.autonomous.forming` | `{cycleId, symbol, setupId, setupType, state, direction, confluenceScore, confluenceNotes}` | For each FORMING setup detected. |
| `agent.autonomous.regime` | `{cycleId, symbol, from, to, confidence}` | When a regime change is committed (after confirmation). |
| `agent.autonomous.signal` | `AutonomousSignalRecord & {cycleId, signalId}` | When a signal is submitted and accepted by the executor (entries **and pyramid adds**). |
| `agent.autonomous.rejected` | `AutonomousSignalRecord & {cycleId, signalId, reason}` | When the executor rejects an agent signal (cooldown, conflict, symbol lock, broker). |
| `agent.autonomous.exit` | `{cycleId, symbol, action, reason, accepted, signalId, partial?, closeFraction?}` | Full exits and **partial de-risks** (SCALE_OUT, `partial: true`). |

---

## System events (SQLite event log)

Same payload shape, persisted to the existing `events` table under
`aggregate_type='system'`:

- `AUTONOMOUS_AGENT_STARTED` — payload: `{symbols, cycleMs, thresholds...}`
- `AUTONOMOUS_AGENT_STOPPED` — payload: `{symbols}`
- `AUTONOMOUS_REGIME_CHANGE` — payload: `{symbol, from, to, confidence, regimeKey, confirmations}`
- `AUTONOMOUS_AGENT_SIGNAL` — payload: `AutonomousSignalRecord & {signalId}`
- `AUTONOMOUS_AGENT_REJECTED` — payload: `AutonomousSignalRecord & {signalId, reason}`
- `AUTONOMOUS_CYCLE_COMPLETED` — payload: full `AutonomousCycleSummary`
- `AUTONOMOUS_EXIT_SIGNAL` — payload: `{cycleId, symbol, action, reason, accepted, signalId}`
- `AUTONOMOUS_SCALE_IN` — payload: `{cycleId, symbol, action, addNumber, maxAdds, addQty, setupType, regime, unrealizedPct, accepted, signalId}`
- `AUTONOMOUS_SCALE_OUT` — payload: `{cycleId, symbol, action, reason: 'DOWNSIDE_DERISK', closeFraction, accepted, signalId}`
- `AUTONOMOUS_LLM_VETO` — payload: `{symbol, direction, setupType, regime, confluenceScore, effectiveConfluence, reason}` — the debate blocked an entry (Finding 1).
- `AUTONOMOUS_LEARNING_PARAMETER_ADJUSTED` — payload: `{parameter, from, to, rollingWinRate, rollingSampleSize}`

Query them via the existing API: `GET /api/v1/events?type=AUTONOMOUS_CYCLE_COMPLETED&limit=20`.

---

## Safety properties (by construction)

The agent is **defensive by default**. Here is every "skip" path it takes
before submitting a signal, in order:

1. Agent not constructed → never started.
2. Symbol already has an open position → `in_position`, no new entries (a pyramid add is only considered through the ExitManager's own gated evaluation).
3. Regime is `TRANSITIONING` → `stand_aside`.
4. Within `AUTONOMOUS_COOLDOWN_MS` of the last attempt → `monitor`.
5. Portfolio at `AUTONOMOUS_MAX_OPEN_POSITIONS` → `monitor`.
6. No READY setup found → `monitor` (forming setups still broadcast).
7. Weighted confluence (raw score × HTF-alignment weight) < `AUTONOMOUS_MIN_CONFLUENCE` → `monitor` — the old binary HTF gate is subsumed here (Finding 5).
8. Plan RR < regime `minRR` → `reject` (the regime can't pay for the stop).
9. Correlated-exposure cluster (same-direction, ρ ≥ floor) at cap → `reject` (Finding 8).
10. Debate veto: genuine NEUTRAL / opposing trader verdict → `reject` (Finding 1; degraded consultations never veto).
11. Blended confidence < `AUTONOMOUS_MIN_CONFIDENCE` → `reject`.
12. Another strategy holds the symbol lock → `stand_aside` ("symbol locked by strategy X").
13. `StrategyEngine.submitSignal` itself runs cooldown + dedup + conflict check (e.g. "duplicate: long position already open") **and re-checks the symbol lock** at submission time.
14. `SignalExecutor` rejects with `NO_MARKET_STATE` or `ZERO_QUANTITY`.
15. `ExecutionRouter` applies the live-trading guard + mode profile (paper/shadow/live).
16. The `RiskEngine` (untouched, still applies) re-validates exposure, daily loss, max positions.

That's sixteen independent gates between "the agent saw a setup" and
"an order reached the broker." Removing any single one is safe-by-design:
the remaining fifteen still hold.

---

## Open-weight model fleet

The `ModelManager` is designed to route between three model kinds:

| Kind | Status | Wire-in plan |
|------|--------|--------------|
| `llm` | **Wired.** Routes to Ollama local daemon + Ollama Cloud accounts (Llama 3, Qwen, Mistral, Gemma). Used by the agent's confidence probe **and the debate-driven veto consultation** (Finding 1). | Already configured via existing `OLLAMA_*` env vars. |
| `vision` | Declared, throws `Not Implemented`. | Drop in `OllamaClient.chat({ images: [base64Chart] })` against a pulled LLaVA model. Use case: candlestick pattern recognition on rendered chart screenshots for setups the SMC detectors don't cover. |
| `timeSeries` | Declared, throws `Not Implemented`. | Wire a Temporal Fusion Transformer or Chrono-Bert adapter (e.g. via ONNX Runtime). Use case: short-horizon volatility forecasting to refine the regime adaptation. |

Every model reachable through the router is an **open-weight** model —
served either locally by Ollama or via Ollama Cloud endpoints that
serve open-weight lineages. No closed proprietary model is reachable
from this class.

---

## Operator guide

### "I want to try this on testnet paper trading"

```bash
# .env
TRADING_MODE=paper
AUTONOMOUS_AGENT_ENABLED=true
AUTONOMOUS_CYCLE_MS=30000
AUTONOMOUS_MIN_CONFLUENCE=70
AUTONOMOUS_MIN_RR=2.0
AUTONOMOUS_MAX_OPEN_POSITIONS=2

# Start
pnpm paper:autonomous
```

Open `http://localhost:8080` and watch the WebSocket events tab for
`agent.autonomous.cycle` and `agent.autonomous.forming` events. The
event log is queryable via `GET /api/v1/events?type=AUTONOMOUS_CYCLE_COMPLETED&limit=20`.

### "I want to add a vision model for chart pattern recognition"

1. Pull LLaVA locally: `ollama pull llava:7b`.
2. In `src/engine.ts`, where `ModelManager` is constructed, add a `visionEndpoints` entry:
   ```ts
   visionEndpoints: [{
     name: 'llava-local',
     kind: 'vision',
     baseUrl: env.OLLAMA_BASE_URL,
     model: 'llava:7b',
     priority: 1,
     timeoutMs: 60_000,
   }],
   ```
3. Replace the throw in `ModelManager.visionComplete` with a real
   `client.chat({ model, images: [base64Chart] })` call.
4. Wire a caller — e.g. the `probeConfidence` step in
   `AutonomousTradingAgent` could call `visionComplete` with a
   rendered chart screenshot for non-SMC pattern setups.

### "I want to disable the agent but keep the rest"

Set `AUTONOMOUS_AGENT_ENABLED=false` (or remove the line). The agent
won't be constructed; everything else runs as before.

### "Why is the agent standing aside so much?"

Check the event log for `AUTONOMOUS_REGIME_CHANGE` events — the symbol
is likely in `TRANSITIONING`. That's intentional: the agent only enters
when it has a confident regime classification + an aligned HTF trend +
a READY setup + a confluence score above threshold + a RR above regime
min. Lower `AUTONOMOUS_MIN_CONFLUENCE` or `AUTONOMOUS_MIN_RR`
cautiously — the defaults are deliberately conservative.

### "Can the agent trade live?"

Yes — set `TRADING_MODE=live` + `LIVE_TRADING_ARMED=true` + valid
CoinDCX credentials. The agent submits signals through the same
`ExecutionRouter` that applies the mode profile and the live-trading
guard. **Don't do this until you've validated on testnet for at least a
week.** The agent has no special live-trading behaviour; the same
guardrails apply.

---

## Tests

```bash
pnpm vitest run test/unit/AutonomousTradingAgent.test.ts test/unit/AutonomyFollowups.test.ts
```

The suite covers:
- `MarketRegimeDetector` classifies a strong uptrend as `TRENDING_STRONG`.
- `MarketRegimeDetector.getAdaptation` returns a valid adaptation for all six regimes.
- `regimeConfirmationBarsFor` per-regime offsets: leaving VOLATILE needs more observations than leaving RANGING (Finding 6).
- `PortfolioCorrelationGuard`: correlated cluster caps, hedge exemption, insufficient-data flag, same-symbol scale-in inclusion (Finding 8).
- `ExitManager.evaluateScaleIn` blocks pyramid adds when the correlation callback disallows (Finding 8).
- `AutonomousTradingAgent` vetoes entries on a genuine NEUTRAL / opposing debate verdict and never vetoes on a degraded consultation (Finding 1).
- `AutonomousTradingAgent` weights confluence by HTF alignment (0.7 range / 0.3 counter / reversal exemption) and restores the binary gate when disabled (Finding 5).
- `AutonomousTradingAgent.runCycle` runs a full cycle, broadcasts a summary, and submits no signal when no READY setup exists.
- `AutonomousTradingAgent` stands aside when the regime is unclear (not enough candles).
- `AutonomousTradingAgent.start/stop` emit the correct system events.
