# Unified Agentic Pipeline — Design Spec

**Date:** 2026-08-22
**Status:** Approved (pending implementation plan)
**Author:** Claude Code (brainstorming session with Shubham Taywade)

## Problem

The repository currently runs four independent decision pipelines that share
no code:

1. `engine.ts` (live/paper loop) → `StrategyEngine` → classic indicator
   strategies (EMA/RSI/breakout/momentum/grid) + `OllamaSignalGenerator`
   simple trend signal → `SignalExecutor` → `SizingEngine` → `PaperBroker`.
   This is what actually executes when the app starts.
2. `BacktestRunner.ts` (CLI `backtest` command) — duplicates pipeline #1.
3. `ReplayEngine.ts` (dashboard BacktestPanel) — a separate SMC structure
   pipeline (`MtfStateEngine`→`MarketStructureEngine`→`SmcLocationEngine`→
   `SetupEngine`→`ExecutionPlanEngine`→`TradeIntentEngine`→`RiskEngine`→
   `SmcPaperBroker`). None of this runs in pipeline #1. The backtest surfaced
   in the dashboard validates logic that never executes live.
4. `TradingAgentsPipeline` — multi-agent LLM debate (analyst → bull/bear
   debate → trader → risk personas → fund manager). Reachable only via
   `POST /api/v1/agents/cycle`, never invoked by the live loop.

Additionally, `TRADING_MODE` (`paper`/`shadow`/`live`) is resolved into a
`RuntimeProfile` by `resolveRuntimeProfile`, but `engine.ts` never branches on
`profile.mode` — it always constructs `PaperBroker`. `CoinDCXBroker`,
`ExecutionRouter`, and `LiveTradingGuard` exist, pass their own tests, and are
never called from any production entrypoint. Live and shadow modes are
non-functional at the wiring level regardless of `TRADING_MODE`'s value.

Several other built, tested subsystems are similarly orphaned:
`MarketDataSupervisor`/`ProviderHealthManager`/`DivergenceGuard` (failover),
`ErrorNormalizer` (incident pipeline), and `market-state/engine.ts`
(structure/liquidity-sweep event engine).

## Goal

One coherent system: a single decision pipeline that both backtests and live
trading run, built as a market-structure graph evaluated by role-specialized
LLM agents with a deterministic risk gate, plus working mode branching
(paper/shadow/live) and the orphaned observability subsystems wired in.

## Non-goals

- Merging `SizingEngine`/`PositionSizer` — `SizingEngine` is deleted along
  with the classic-strategy path it served; `PositionSizer` (research-only)
  is untouched.
- PostgreSQL/Redis migration, API authentication, dashboard authentication —
  remain `planned`, out of scope here.
- MCP tool orchestration — `agentRuntime.ts` is deleted as redundant with
  `TradingAgentsPipeline`, but this does not preclude a future MCP-based
  harness.

## Architecture

### 1. Composition root & graph model

`engine.ts` remains the single composition root. A new `src/graph/` module
holds the unified pipeline:

```
MarketState (tick/candle)
  → StructureGraphBuilder
      wraps existing MtfStateEngine / MarketStructureEngine / SmcLocationEngine
      produces nodes: { type: SWEEP | CHOCH | BOS | SETUP_CANDIDATE, ... }
      edges: valid transitions between structure states
      (SetupEngine's confluence-score logic becomes edge-weight/traversal
      rather than a separate flat call)
  → confluence-score filter (existing SetupEngine logic, deterministic,
      cheap) — only SETUP_CANDIDATE nodes above threshold proceed
  → AgentGraph (TradingAgentsPipeline, reframed as graph nodes):
      AnalystTeam → Debate (Bull/Bear/Judge) → Trader → RiskTeam (advisory
      personas) → FundManager
  → RiskEngine.evaluate() — hard gate, final veto regardless of agent
      approval (daily loss / exposure / kill-switch)
  → ExecutionPlanEngine (via TradeIntentEngine) sizes stop/TP/leverage
  → SignalExecutor → Broker (Paper / CoinDCX per mode)
```

`TradingAgentsPipeline` becomes the `AgentGraph` node implementation. It
remains reachable via `POST /api/v1/agents/cycle` for manual/debug triggering,
and is now also invoked automatically by the live candle-close loop when a
setup candidate clears the confluence filter.

Confluence-filter-then-agents (not agents-on-every-candidate) keeps LLM cost
bounded — each full agent cycle is ~8 LLM calls.

### 2. Mode branching (paper / shadow / live)

`engine.ts` branches broker construction on `runtimeProfile.mode`:

```
paper  → PaperBroker (current behavior, unchanged)
shadow → PaperBroker for execution, plus a read-only CoinDCX account reader
          (balance/positions queried each snapshot cycle, feeds real
          account equity into SizingEngine's successor / RiskEngine instead
          of PAPER_STARTING_USDT — real numbers, simulated execution)
live   → LiveTradingGuard.checkArmed() first (LIVE_TRADING_ARMED=true
          required) → ExecutionRouter selects CoinDCXBroker
          → hardcoded MAX_ORDER_NOTIONAL_USDT constant, checked in
            SignalExecutor before broker.submitOrder — not configurable,
            not agent-adjustable, independent of RiskEngine's own limits
          → reconciliation on startup and stream reconnect: query CoinDCX
            positions/balance, diff against internal state, block new
            orders if discrepancy exceeds tolerance (AGENTS.md §10)
```

`resolveRuntimeProfile`'s existing `liveGuardEnabled` / `reconciliationEnabled`
/ `accountReadOnly` fields — currently computed and never read — become the
actual switches driving this branch.

### 3. Backtest unification

One backtest engine. `ReplayEngine.ts` (already the SMC stack) is extended to
include the `AgentGraph` node. Backtests default to a fast path — deterministic
fallback reports (the same offline/error fallback `TradingAgentsPipeline`
already implements) instead of live LLM calls, since real Ollama debate over
months of candles is impractically slow. A `--with-agents` flag runs the real
debate for validating agent judgment specifically, at the cost of runtime.

`BacktestRunner.ts` is deleted. CLI `backtest` command repoints at
`ReplayEngine`. Dashboard `BacktestPanel` requires no change — it already
calls `ReplayEngine` via API, which now matches live exactly.

### 4. Failover, error pipeline, event-driven wiring

Mechanical additions to `engine.ts` — each subsystem already exists and is
tested, only needs construction and wiring:

- `MarketDataSupervisor` (Binance primary, CoinDCX fallback) constructed and
  passed into stream setup and `ApiServer({ supervisor })`, so
  `/api/v1/health/providers` stops returning empty. `DivergenceGuard` /
  `ProviderHealthManager` are its existing internals.
- `ErrorNormalizer` constructed once, passed to catch-paths in `engine.ts` /
  `streams.ts` / `SignalExecutor` that currently only `logger.error(...)`.
  Normalizes, assigns incident ID, persists via `EventLog`, routes to
  `TelegramNotifier` by severity. `/api/v1/incidents` returns real data.
- Structure/liquidity-sweep events from `market-state/engine.ts` (produced as
  a byproduct of `StructureGraphBuilder`) are piped to `EventLog` /
  `WebSocketGateway` instead of being dropped.

No new abstractions in this section — every piece already has an interface.

## Hard invariants (unchanged, reaffirmed)

Per AGENTS.md §6: LLM never bypasses the risk engine, never submits live
orders directly, never overrides reconciliation failures. This design
enforces that structurally: `RiskEngine.evaluate()` runs *after*
`FundManagerApproval` and can veto it; `MAX_ORDER_NOTIONAL_USDT` is a
hardcoded circuit breaker outside both the risk engine and the agent graph.

This spec materially alters execution mode, risk boundaries, and agent
autonomy (AGENTS.md §20) — an ADR is required before implementation begins.

## Testing & rollout order

AGENTS.md §13 requires unit + regression + integration coverage per behavior
change. Order: **graph unification → backtest unification → C/D/E wiring →
mode branching**, so the riskiest change (live/shadow, real money adjacent)
lands last, after the unified pipeline has been validated against history.

1. **Graph unification** — unit tests per node (structure builder, confluence
   filter, agent-graph node reusing existing `TradingAgentsPipeline` tests).
   Integration test: candle → structure → filtered setup → agent verdict →
   risk gate → signal, asserting RiskEngine veto blocks even when the fund
   manager approves.
2. **Backtest unification** — regression test: existing `ReplayEngine`
   reports must reproduce before/after on a fixed dataset.
3. **Failover/error/event wiring** — smoke tests: constructors called with
   correct args, endpoints return non-empty.
4. **Mode branching** — integration test per mode: paper unchanged
   (regression), shadow reads real CoinDCX balance but performs zero writes
   to CoinDCX (assert on the mock), live blocked without
   `LIVE_TRADING_ARMED`, live respects `MAX_ORDER_NOTIONAL_USDT` even when
   RiskEngine/agents approve a larger size.

## Deletions

- `src/strategy/strategies/*` (ema-trend-5m, breakout-15m,
  rsi-mean-reversion-5m, momentum-5m, grid-15m, mean-reversion-5m)
- `OllamaSignalGenerator` trend strategy usage in `ai/ollama.ts` /
  `strategies/ollama-trend-5m.ts`
- `src/backtest/BacktestRunner.ts`
- `src/ai/agentRuntime.ts` (superseded by `TradingAgentsPipeline` as the
  agent harness)
- Opportunistic cleanup, unrelated to this work but touched along the way:
  `ReplayClock.ts`, `signalAdapter.ts`, `binance/client.ts`, dead `Metrics`
  methods, `EventLog` JSONL dual-write, unused `prettier` dependency

`ExecutionRouter.ts` is **not** deleted — this design gives it its first
production caller (reversing the earlier audit's delete recommendation).

## Open items for the implementation plan

- Exact confluence-score threshold for the agent pre-filter (tunable, needs a
  default).
- Reconciliation tolerance for live-mode position/balance diffing.
- `MAX_ORDER_NOTIONAL_USDT` value.
