# ADR 0005: Agentic Layer Upgrade

**Date:** 2026-08-30
**Status:** Proposed (on `feature/agentic-upgrade` branch)
**Branch:** `feature/agentic-upgrade`

## Context

PROJECT_STATE.md records three confirmed gaps in the agent layer:

1. **"LLM agent has no memory beyond one summarized line."** Every debate
   cycle starts cold. The only learning loop was per-Supertrend-parameter
   Q-learning and per-setup-archetype quarantine; the LLM analyst/trader
   stages themselves had no memory of past trades.

2. **"MCP not implemented."** The agent is prompt-in / JSON-out only. No
   tool-calling, no external context, no self-debugging capability.

3. **Classic indicator strategies produce zero trades.** `SizingEngine.ts`
   and the classic strategy files remain on disk but `SignalExecutor`
   rejects their signals because they don't carry `features.sizing`.

The user (operator) asked to upgrade the agentic layer to fix these gaps:
add web search across news/macro/on-chain/docs, add a full self-improvement
loop (strategy params + prompt evolution + strategy selection + auto-A/B
testing), wire an MCP-style tool layer, fix the LLM agent's missing memory,
and stay paper-only (no live execution wiring).

## Decision

Add a new `feature/agentic-upgrade` branch that introduces the following
modules, all default-OFF (operators opt in via env flags). The existing
pipeline behaviour is preserved exactly when every flag is off.

### 1. Tool Framework (MCP-style, read-only)

New module: `src/ai/tools/`.

- `ToolDefinition` interface + `ToolRegistry` enforce five hard invariants:
  read-only (the only allowed `readonly` value is `true`), bounded (hard
  deadline via Promise.race), schema-validated (Zod on input + output),
  fail-closed (thrown errors become `{ok:false}`), logged (in-memory ring
  buffer surfaced at `/api/v1/agent/tools`).
- Six concrete tools ship in this branch:
  - `MarketDataTool` — read-only market state + candle inspector
  - `PositionInfoTool` — read-only account + positions + exposure summary
  - `WebSearchTool` — CoinGecko + alternative.me Fear&Greed + Binance
    funding/OI (no API key required); optional Brave Search when configured
  - `NewsSentimentTool` — CoinDesk + CoinTelegraph + BitcoinMagazine RSS,
    minimal XML parser (no XML dep), filtered by topic query
  - `MacroFundingTool` — multi-symbol funding+OI+BTC dominance snapshot
  - `OnChainWhaleTool` — mempool.space (BTC) + Etherscan free RPC (ETH),
    clearly labelled as activity proxy (real whale flows are paywalled)
  - `DocsLookupTool` — static catalog over Binance API docs + the
    project's CONTRACTS.md / SKILL.md / PROJECT_STATE.md
- The analyst stage of `TradingAgentsPipeline` runs a bounded tool loop
  (max 5 iterations) before building its prompt. The loop is deterministic
  (gemma3:27b is a base chat model, not a native tool-caller) — it
  proactively pulls macro-funding + news-sentiment for the cycle's symbol
  and appends the verbatim tool summaries to the prompt as a "Tool
  findings:" block. Hallucination is prevented by grounding: every line
  is a verbatim tool output, never a model paraphrase.

CONTRACTS.md §5 (LLM Authority Contract) is preserved: every tool is
read-only. The LLM never gets write capability over broker state, risk
limits, or execution.

### 2. Agent Memory + Self-Improvement Loop

New modules: `src/ai/memory/AgentMemoryStore.ts` + `src/ai/SelfImprovementLoop.ts`.

- A separate SQLite file (`data/agent_memory.sqlite3`) holds:
  - `agent_reflections` (append-only, age-pruned) — one row per closed
    trade with the LLM-generated structured reflection
  - `agent_lessons` (mutable: `decay_score`, `hit_count`, `last_used_at`)
    — distilled lessons derived from reflections
  - Both tables FTS5-indexed so retrieval by symbol/regime/strategy/action
    is fast and forgiving of partial-match queries.
- The `SelfImprovementLoop` is wired to `broker.onFill` (closing fills
  only): it dispatches an async reflection LLM call whose structured
  output is parsed against `ReflectionSchema` (Zod) and persisted. Soft-
  fail: model unreachable / invalid JSON → skip silently, never block
  trading. Same contract as `TradingAgentsPipeline.checkOllamaReachable`.
- Top-K lessons (by FTS relevance × recency-decay) are re-injected into
  the next analyst + trader prompts as `ctx.agentMemory`. Empty string
  when no lessons are above the decay floor (the pipeline proceeds
  normally — soft dependency).

CONTRACTS.md §4 (Event Log Contract) is preserved: reflections are
**NOT** in the `events` table. Reflections are mutable state (decayed,
pruned); the event log is the source of truth for *trading* history and
must remain append-only. The separate file keeps the WAL contention story
simple.

CONTRACTS.md §19 (Observer Isolation) is preserved: `onClosingFill` is
fire-and-forget. The reflection LLM call happens in the background. A
slow LLM never stalls the fill path.

### 3. Strategy Parameter Learner (generic Q-learning)

New module: `src/strategy/learning/StrategyParamLearner.ts`.

- Extends the existing Q-learning (currently only on Supertrend params
  in `src/strategy/adaptive-supertrend/parameter-ai.ts`) to ANY
  strategy's tunable parameter.
- Q-table keyed by `(strategyId, regime, paramKey)`, persisted to
  `data/strategy_param_qtable.json`.
- `select()` is ε-greedy: with prob ε return a random candidate (explore),
  otherwise return the candidate with the highest avg reward whose sample
  count ≥ `minTrades`. Below `minTrades` → return the operator's default.
- `recordOutcome()` updates the running avg via α-weighted update.
- Off by default; `select()` returns the default value when disabled.

### 4. Strategy Selector (per-regime promotion/demotion)

New module: `src/strategy/learning/StrategySelector.ts`.

- Wraps the existing `StrategyPerformanceTracker` (which quarantines
  globally on drawdown) with regime-aware granularity: a strategy that
  loses in `TRENDING_UP` but wins in `RANGING` is demoted for the former
  only, not the latter.
- Per-`(strategyId, regime)` track record with min-trades + max-drawdown
  + min-win-rate thresholds, persisted to
  `data/strategy_selector_state.json`.
- `isEnabled(strategyId, regime)` returns false when demoted. The engine
  wires this as an additional gate on top of the existing global quarantine
  (strict superset — global check still runs first).

### 5. A/B Testing Runner (skeleton)

New module: `src/strategy/abtesting/ABTestRunner.ts`.

- Skeleton for parallel-paper-instance A/B testing of candidate parameter
  sets. Maintains N candidate parameter sets, records outcomes per
  instance, evaluates rolling-window winner.
- The parallel-instance hosting itself (N separate `PaperBroker`
  instances) is left to a follow-up ADR — this ships the evaluation
  contract so operators can record outcomes today and the wiring lands
  later. Off by default; `recordOutcome` is a no-op when disabled.

### 6. API surface

Seven read-only + two operator POST endpoints (all under
`/api/v1/agent/*`, `/api/v1/strategy-selector`, `/api/v1/ab-tests`).
Every GET returns `{enabled: boolean, ...}` so the dashboard can render
the "feature is off" state gracefully. POSTs follow the existing
`/api/v1/strategies/:id/release` pattern of requiring the API key when
configured.

### 7. Cloud Ollama model name corrected

`OLLAMA_CLOUD_MODEL` default changed from `'gemma4:cloud'` (no such
public model exists) to `'gemma3:27b'` — the closest real public Ollama
model to the user-requested `'gemma4:31b'`. Override via env to point at
any other open-weight model.

## Alternatives Considered

- **Native tool-calling via a fine-tuned model.** Would require shipping a
  fine-tuned Llama or waiting for Ollama Cloud to expose tool-calling. The
  deterministic-loop approach works today with any base chat model and
  keeps the grounding contract simple (every tool output is verbatim, no
  hallucination surface).
- **Vector DB for memory.** Considered `hnswlib-node` or a hosted vector
  DB. SQLite FTS5 is sufficient for the volume (hundreds of reflections)
  and avoids a new dep + ops surface. Switch later if scale demands it.
- **Single shared DB for events + reflections.** Rejected because it would
  violate CONTRACTS.md §4. The separate file keeps the event log
  append-only contract intact.
- **Wire live Binance execution.** Out of scope — user explicitly asked
  to stay paper-only. The existing `ExecutionRouter` + `LiveTradingGuard`
  already support a future live path; this ADR does not touch it.

## Consequences

- Operators can opt into each feature independently via env flags. The
  default-OFF posture means existing deployments keep their current
  behaviour exactly until opted in.
- The agent now has bounded, schema-validated, read-only tool access
  (CONTRACTS.md §5 preserved).
- The agent now has cross-cycle memory (CONTRACTS.md §4 preserved by the
  separate-file approach).
- The strategy layer has a generic per-(strategyId, regime, paramKey)
  Q-learning store, a per-regime promotion/demotion gate, and a skeleton
  for A/B testing parallel instances.
- 42 new unit tests cover the new modules. All 658 tests pass.
- The `bm5` FTS5 function was incorrectly used and silently failed —
  fixed to use the FTS5 built-in `rank` column.

## Migration Path

No migration required. All new flags default OFF. To enable:

```bash
AGENT_TOOLS_ENABLED=true             # MCP-style tool loop in analyst stage
AGENT_MEMORY_ENABLED=true            # reflection + memory loop
AGENT_PARAM_LEARNING_ENABLED=true    # generic per-strategy per-regime Q-learning
AGENT_STRATEGY_SELECTOR_ENABLED=true # per-regime strategy promotion/demotion
AGENT_AB_TESTING_ENABLED=true        # A/B testing skeleton
```

See `.env.example` for the full list with descriptions.
