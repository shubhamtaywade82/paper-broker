# ADR 0004: Unified Agentic Decision Pipeline

**Date**: 2026-08-22
**Status**: Accepted
**Author**: Claude Code (brainstorming session with Shubham Taywade)

## Context

Four decision pipelines exist in the repository with no shared code:

1. `engine.ts` (live/paper loop) → `StrategyEngine` → classic indicator
   strategies + `OllamaSignalGenerator` → `SignalExecutor` → `SizingEngine`
   → `PaperBroker`. This is what actually executes.
2. `BacktestRunner.ts` (CLI) — duplicates pipeline #1.
3. `ReplayEngine.ts` (dashboard) — a separate SMC structure pipeline
   (`MtfStateEngine`→`MarketStructureEngine`→`SmcLocationEngine`→
   `SetupEngine`→`ExecutionPlanEngine`→`TradeIntentEngine`→`RiskEngine`→
   `SmcPaperBroker`). Never runs in pipeline #1 — the dashboard backtest
   validates logic the live engine never executes.
4. `TradingAgentsPipeline` — multi-agent LLM debate, reachable only via
   `POST /api/v1/agents/cycle`, never invoked by the live loop.

`TRADING_MODE` (`paper`/`shadow`/`live`) resolves into a `RuntimeProfile`,
but `engine.ts` never branches on `profile.mode` — it always constructs
`PaperBroker`. `CoinDCXBroker`, `ExecutionRouter`, and `LiveTradingGuard`
exist and pass their own tests but are never called from any production
entrypoint. Live and shadow modes are non-functional at the wiring level.

`MarketDataSupervisor`/`ProviderHealthManager`/`DivergenceGuard` (failover),
`ErrorNormalizer` (incident pipeline), and `market-state/engine.ts`
(structure/event engine) are built and tested but orphaned — no production
caller constructs them.

This matches the target architecture already described in ADR 0003 (Command
Bus → RiskEngine → LiveTradingGuard → ExecutionRouter, an Agent Plane, an
Observability Plane) — 0003 described the target shape; this ADR is the
decision to actually converge onto it.

Full analysis: `docs/superpowers/specs/2026-08-22-unified-agentic-pipeline-design.md`.

## Decision

Converge on one pipeline, modeled as a graph, shared by live, shadow, and
backtest:

```
MarketState → StructureGraphBuilder (SMC structure/setup detection, nodes
  and edges) → confluence-score filter (deterministic, cheap) → AgentGraph
  (TradingAgentsPipeline's analyst/debate/trader/risk-team/fund-manager
  roles as graph nodes) → RiskEngine.evaluate() (hard gate, final veto,
  independent of agent approval) → ExecutionPlanEngine sizing →
  SignalExecutor → Broker (Paper/CoinDCX per mode)
```

Consequences of this shape:

- **Classic indicator strategies retired.** EMA/RSI/breakout/momentum/grid
  and the simple Ollama trend signal are deleted; the SMC+agent graph is now
  the only decision source.
- **`BacktestRunner.ts` retired.** `ReplayEngine.ts` becomes the single
  backtest engine for both CLI and dashboard, extended with the same
  `AgentGraph` node (fast-path fallback reports by default; `--with-agents`
  runs real LLM debate for agent-judgment validation).
- **`TradingAgentsPipeline` is no longer standalone.** It is the `AgentGraph`
  node implementation — still reachable via `POST /api/v1/agents/cycle` for
  manual triggering, now also invoked automatically when a setup candidate
  clears the confluence filter.
- **`RiskEngine` moves from backtest-only to universal.** It becomes the
  hard gate after agent approval on every pipeline (live, shadow, backtest),
  per AGENTS.md §6: the LLM never bypasses the risk engine.
- **Mode branching implemented.** `engine.ts` reads `runtimeProfile.mode`:
  `paper` unchanged; `shadow` adds a read-only CoinDCX account reader
  feeding real equity into sizing/risk without submitting orders; `live`
  requires `LiveTradingGuard` armed, routes through `ExecutionRouter` to
  `CoinDCXBroker`, and adds a hardcoded `MAX_ORDER_NOTIONAL_USDT` circuit
  breaker independent of `RiskEngine`'s own limits.
- **`ExecutionRouter` gets its first production caller** (reverses an
  earlier over-engineering-audit recommendation to delete it as unused —
  it was unused because live mode was never wired, not because it was
  unnecessary).
- **Observability subsystems wired in.** `MarketDataSupervisor` (failover),
  `ErrorNormalizer` (incidents), and `market-state/engine.ts` (structure
  events) are constructed in `engine.ts` and connected to their existing,
  already-built consumers (`/api/v1/health/providers`, `/api/v1/incidents`,
  `EventLog`/`WebSocketGateway`).
- **`agentRuntime.ts` deleted** as redundant with `TradingAgentsPipeline`,
  which now serves as the agent harness.

Hard invariants reaffirmed structurally, not just by convention: the risk
gate runs after agent approval and can veto it; the live notional cap sits
outside both the risk engine and the agent graph as a last-resort circuit
breaker.

## Consequences

- Backtests validate exactly the logic that runs live — a `pnpm
  paper:backtest` result is now predictive of live behavior, which it was
  not before.
- Live and shadow modes become reachable for the first time; `TRADING_MODE`
  is no longer decorative.
- Four maintenance surfaces collapse into one; the classic strategies,
  duplicate backtest runner, and duplicate position sizer they required are
  removed.
- LLM cost is bounded by the confluence-score pre-filter rather than
  running full multi-agent debate on every candle.
- Risk: this is a large, multi-phase change touching execution mode, risk
  boundaries, and agent autonomy simultaneously. Mitigated by phased
  rollout (graph unification → backtest unification → observability wiring
  → mode branching) with regression/integration tests gating each phase,
  detailed in the implementation plan.
