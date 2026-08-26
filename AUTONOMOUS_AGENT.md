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
   3. **Regime confirmation gate.** If the regime differs from the
      previous cycle, bump an observation counter; only commit the change
      after `AUTONOMOUS_REGIME_CONFIRMATION_BARS` (default 3) consecutive
      observations. This prevents a single noisy 4h bar from thrashing
      the strategy profile.
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
   9. **Confluence gate.** Pick the highest-confluence READY setup.
      If its confluence score < `AUTONOMOUS_MIN_CONFLUENCE` (default
      65/100), skip.
   10. **HTF alignment gate.** Setup direction must agree with the 4h
       trend — longs only when HTF is bullish, shorts only when HTF is
       bearish. **Exception:** reversal archetypes (e.g.
       `SSL_SWEEP_REVERSAL_LONG`) are allowed when HTF is in range,
       because that's exactly the regime they're designed for.
   11. **Trade plan.** `AdaptiveRiskManager.computeTradePlan(symbol,
       direction, regimeAdaptation)` returns stop/target/leverage/size
       based on ATR scaled by the regime's `stopAtrMultiplier` and
       `targetAtrMultiplier`. If the realised RR is below the regime's
       `minRR`, the plan is rejected — "the regime can't pay for the
       stop we'd need".
   12. **Model confidence probe.** Best-effort LLM call via
       `ModelManager.complete()` to ask a quick risk-reviewer prompt
       ("given this setup + regime + RR + ATR, what confidence 0..1?").
       The model output is **blended** 60/40 with a deterministic
       confidence derived from the confluence score + RR bonus. If the
       model is unreachable (Ollama down), the agent falls back to the
       deterministic confidence and keeps running — the agent never
       blocks on model availability, same pattern as
       `TradingAgentsPipeline`'s NEUTRAL fallback.
   13. **Confidence gate.** If the blended confidence < 
       `AUTONOMOUS_MIN_CONFIDENCE` (default 0.55), reject and log.
   14. **Position sizing.** `riskAmount = equity * sizePct`, where
       `sizePct = baseRiskPerTradePct * regime.riskMultiplier`. Then
       `quantity = riskAmount / stopDistance`. Folded into
       `signalInput.features['quantity']` — exactly the key
       `SignalExecutor` reads.
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
| `AUTONOMOUS_AGENT_ENABLED` | `false` | Master switch. |
| `AUTONOMOUS_CYCLE_MS` | `30000` | Polling interval (min 5s). |
| `AUTONOMOUS_MIN_CONFLUENCE` | `65` | Min confluence score (0..100) for entry. |
| `AUTONOMOUS_MIN_RR` | `1.5` | Base min reward:risk — regime may push higher. |
| `AUTONOMOUS_MAX_OPEN_POSITIONS` | `3` | Max concurrent positions portfolio-wide. |
| `AUTONOMOUS_PER_SYMBOL_MAX_POSITIONS` | `1` | Per-symbol cap (typically 1 — pyramiding is off). |
| `AUTONOMOUS_COOLDOWN_MS` | `300000` | Cooldown after an entry attempt on a symbol. |
| `AUTONOMOUS_REGIME_CONFIRMATION_BARS` | `3` | Bars that must agree before a regime change commits. |
| `AUTONOMOUS_MIN_CONFIDENCE` | `0.55` | Min blended model + deterministic confidence for entry. |
| `AUTONOMOUS_STRATEGY_ID` | `autonomous-agent` | Strategy ID stamped on agent-submitted signals. |

The agent also reads the existing `OLLAMA_*` env vars for the model
endpoint configuration — see `src/ai/ModelManager.ts` and the engine
wiring in `src/engine.ts`.

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
| `agent.autonomous.signal` | `AutonomousSignalRecord & {cycleId, signalId}` | When a signal is submitted and accepted by the executor. |
| `agent.autonomous.rejected` | `AutonomousSignalRecord & {cycleId, signalId, reason}` | When the executor rejects an agent signal (cooldown, conflict, broker). |

---

## System events (SQLite event log)

Same payload shape, persisted to the existing `events` table under
`aggregate_type='system'`:

- `AUTONOMOUS_AGENT_STARTED` — payload: `{symbols, cycleMs, thresholds...}`
- `AUTONOMOUS_AGENT_STOPPED` — payload: `{symbols}`
- `AUTONOMOUS_REGIME_CHANGE` — payload: `{symbol, from, to, confidence, regimeKey}`
- `AUTONOMOUS_AGENT_SIGNAL` — payload: `AutonomousSignalRecord & {signalId}`
- `AUTONOMOUS_AGENT_REJECTED` — payload: `AutonomousSignalRecord & {signalId, reason}`
- `AUTONOMOUS_CYCLE_COMPLETED` — payload: full `AutonomousCycleSummary`

Query them via the existing API: `GET /api/v1/events?type=AUTONOMOUS_CYCLE_COMPLETED&limit=20`.

---

## Safety properties (by construction)

The agent is **defensive by default**. Here is every "skip" path it takes
before submitting a signal, in order:

1. Agent not constructed → never started.
2. Symbol already has an open position → `in_position`, no new entries.
3. Regime is `TRANSITIONING` → `stand_aside`.
4. Within `AUTONOMOUS_COOLDOWN_MS` of the last attempt → `monitor`.
5. Portfolio at `AUTONOMOUS_MAX_OPEN_POSITIONS` → `monitor`.
6. No READY setup found → `monitor` (forming setups still broadcast).
7. Confluence < `AUTONOMOUS_MIN_CONFLUENCE` → `monitor`.
8. HTF trend misaligns with setup direction (and not a reversal archetype in range) → `monitor`.
9. Plan RR < regime `minRR` → `reject` (the regime can't pay for the stop).
10. Blended confidence < `AUTONOMOUS_MIN_CONFIDENCE` → `reject`.
11. `StrategyEngine.submitSignal` itself runs cooldown + dedup + conflict check (e.g. "duplicate: long position already open").
12. `SignalExecutor` rejects with `NO_MARKET_STATE` or `ZERO_QUANTITY`.
13. `ExecutionRouter` applies the live-trading guard + mode profile (paper/shadow/live).
14. The `RiskEngine` (untouched, still applies) re-validates exposure, daily loss, max positions.

That's fourteen independent gates between "the agent saw a setup" and
"an order reached the broker." Removing any single one is safe-by-design:
the remaining thirteen still hold.

---

## Open-weight model fleet

The `ModelManager` is designed to route between three model kinds:

| Kind | Status | Wire-in plan |
|------|--------|--------------|
| `llm` | **Wired.** Routes to Ollama local daemon + Ollama Cloud accounts (Llama 3, Qwen, Mistral, Gemma). Used by the agent's confidence probe. | Already configured via existing `OLLAMA_*` env vars. |
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
pnpm vitest run test/unit/AutonomousTradingAgent.test.ts
```

The suite covers:
- `MarketRegimeDetector` classifies a strong uptrend as `TRENDING_STRONG`.
- `MarketRegimeDetector.getAdaptation` returns a valid adaptation for all six regimes.
- `AdaptiveRiskManager.computeTradePlan` builds a plan that clears the regime min RR for a strong trend.
- `AdaptiveRiskManager.isTradeable` reports `TRANSITIONING` as not tradeable.
- `AutonomousTradingAgent.runCycle` runs a full cycle, broadcasts a summary, and submits no signal when no READY setup exists.
- `AutonomousTradingAgent` stands aside when the regime is unclear (not enough candles).
- `AutonomousTradingAgent.start/stop` emit the correct system events.
