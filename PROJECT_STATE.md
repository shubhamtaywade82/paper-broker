# PROJECT_STATE.md

## Current Phase

**Phase: foundation**

This project is a crypto futures trading engine with real Binance market data
and simulated (paper) execution by default. A live CoinDCX execution path
exists and is wired, but requires explicit arming and credentials.

## Operating Modes

`TRADING_MODE` selects the profile (see `src/config/modes/resolver.ts`).
Every order submission goes through `ExecutionRouter`, which is constructed in
`engine.ts` and applies the profile plus `LiveTradingGuard`.

| Mode    | Status      | Description                                                                 |
|---------|-------------|-----------------------------------------------------------------------------|
| paper   | implemented | Simulated execution against real market data. Default.                       |
| shadow  | implemented | `accountReadOnly`, reconciliation enabled, still routed to the paper broker. |
| live    | implemented, unproven in production | Routes to `CoinDCXBroker` only when `LIVE_TRADING_ARMED=true` **and** `COINDCX_API_KEY`/`COINDCX_API_SECRET` are set. Missing credentials produce `NO_LIVE_EXECUTION_ADAPTER` rejections — never a silent paper fill. |

## Providers

| Provider         | Market Data | Execution | Status                                                                 |
|------------------|-------------|-----------|------------------------------------------------------------------------|
| Binance Futures  | ✅ wired     | ❌        | Primary stream (`BinanceStreamHandler`), wired in `engine.ts`.          |
| CoinDCX          | ❌ no feed   | ✅ wired   | `CoinDCXBroker` is routed via `ExecutionRouter`. `MarketDataSupervisor` is wired and treats CoinDCX as the configured fallback, but no CoinDCX market-data feed exists, so failover can never actually promote it. |

## Agent / LLM

| Component       | Status      | Notes                                    |
|-----------------|-------------|------------------------------------------|
| Ollama SDK      | available   | `@nemesis-oss/ollama-sdk`, local daemon plus optional cloud key pool |
| Agent pipeline  | implemented | `TradingAgentsPipeline`, driven by `createSmcAgentStrategy`. **LLM-backed stages:** analyst team, bull/bear debate (`debateRounds`, default 2), debate verdict, trader decision. **Deterministic stages:** risk team, fund manager. Each emitted `AgentCycleStep` carries `engine: 'llm' \| 'deterministic'` so consumers cannot conflate them. |
| Agent authority | advisory only | The pipeline **confirms or vetoes** a candidate the deterministic SMC engine already produced (`smc-agent.ts`: a NEUTRAL or mismatched direction returns null). It cannot originate a trade, pick a symbol, set a stop, or size a position. |
| Ollama reachability | soft dependency | If unreachable, the debate resolves to NEUTRAL and no SMC trades occur. `engine.ts` logs a startup warning; startup is not gated. |
| Cloud model | corrected | `OLLAMA_CLOUD_MODEL` default is now `gemma3:27b` (was `gemma4:cloud`, which is not a real public model). Override via env to point at any other Ollama Cloud-served open-weight model. (feature/agentic-upgrade) |
| MCP / tool framework | implemented (opt-in) | `src/ai/tools/` ships a bounded, read-only, schema-validated tool layer: `ToolRegistry` + 6 tools (MarketData, PositionInfo, WebSearch, NewsSentiment, MacroFunding, OnChainWhale, DocsLookup). The analyst stage runs a bounded tool loop before its LLM call when `AGENT_TOOLS_ENABLED=true`. All tools fail-closed (return `{ok:false}` rather than throw) and respect a hard deadline. **Off by default** — backward-compatible. (feature/agentic-upgrade) |
| Agent memory | implemented (opt-in) | `src/ai/memory/AgentMemoryStore.ts` + `src/ai/SelfImprovementLoop.ts`. Closing fills trigger an async reflection LLM call (parsed against `ReflectionSchema`, persisted to `data/agent_memory.sqlite3` — separate file, preserves the Event Log Contract §4). Top-K lessons (FTS-ranked × recency-decayed) are re-injected into the next analyst + trader prompts as `ctx.agentMemory`. Soft-fail: model unreachable → skip silently. **Off by default** (`AGENT_MEMORY_ENABLED=true` to enable). (feature/agentic-upgrade) |
| Strategy param learning | implemented (opt-in) | `src/strategy/learning/StrategyParamLearner.ts` — generic per-`(strategyId, regime, paramKey)` Q-learning. Extends the existing Q-learning (only on Supertrend params) to any strategy's tunable parameter. ε-greedy selection. Persisted to `data/strategy_param_qtable.json`. **Off by default** (`AGENT_PARAM_LEARNING_ENABLED=true` to enable). (feature/agentic-upgrade) |
| Strategy selector | implemented (opt-in) | `src/strategy/learning/StrategySelector.ts` — per-`(strategyId, regime)` promotion/demotion. Wraps the existing global `StrategyPerformanceTracker` quarantine with regime-aware granularity. Persisted to `data/strategy_selector_state.json`. **Off by default** (`AGENT_STRATEGY_SELECTOR_ENABLED=true` to enable). (feature/agentic-upgrade) |
| A/B testing | skeleton (opt-in) | `src/strategy/abtesting/ABTestRunner.ts` — parallel-paper-instance evaluation contract. Ships the recordOutcome/evaluate API; the parallel-instance hosting itself (N `PaperBroker` instances) is left to a follow-up ADR. **Off by default** (`AGENT_AB_TESTING_ENABLED=true` to enable). (feature/agentic-upgrade) |
| Learning (existing) | implemented | Q-learning over Supertrend parameters per market regime (`parameter-ai.ts`), reward = realized directional return on position close, persisted to `data/adaptive_supertrend_qtable.json`. **Also:** per-SMC-setup-archetype performance memory (`StrategyPerformanceTracker` reused, keyed by setup type e.g. `SSL_SWEEP_REVERSAL_LONG`, persisted to `data/setup_performance.json`). Closing fills from `smc-agent-v1` are attributed to the setup archetype that opened them via `SetupOutcomeTracker` (in-memory, per-symbol correlation). A setup archetype's realized track record is (a) surfaced to the LLM analyst/trader prompts as advisory `setupMemory` context — informational only, never routed to the deterministic risk/fund-manager stages — and (b) deterministically gates future entries of that archetype when quarantined, same mechanism as strategy-level quarantine but scoped narrower. Off by default (`SETUP_FEEDBACK_ENABLED=true` to enforce; stats accumulate either way). Operator-releasable via `POST /api/v1/setups/:id/release`, observable via `GET /api/v1/setups/performance`. |

## Persistence

| Store     | Status      | Notes                                    |
|-----------|-------------|------------------------------------------|
| SQLite    | implemented | `paper.sqlite3` with WAL mode            |
| JSON state | implemented | `adaptive_supertrend_qtable.json`, `profit_goals.json`, `strategy_performance.json`, `aggressive_mode.json` under the data dir |
| PostgreSQL| planned     | For production multi-instance deployment |
| Redis     | planned     | For pub/sub and caching                  |

## Dashboard

| Component | Status      | Notes                                    |
|-----------|-------------|------------------------------------------|
| Backend / BFF | implemented | Fastify REST API + WebSocket Gateway (`/ws`, `/api/v1/dashboard`) |
| Frontend  | implemented | React app under `dashboard/` (Vite, Zustand stores, own vitest suite) |

## Notifications

| Provider | Status      | Notes                                    |
|----------|-------------|------------------------------------------|
| Telegram | implemented | `ErrorNormalizer` incident IDs (`INC-...`) + `TelegramNotifier` with rate limiting and token redaction |
| Webhook  | planned     | Additional operational alert sinks       |

## Hard Invariants

These must NOT change without an ADR:

1. **LLM cannot execute orders directly** — LLM produces signals only; `SignalExecutor` owns order submission.
2. **LLM is never an authority over risk** — the risk team and fund manager stages are deterministic by contract (CONTRACTS.md §5).
3. **PaperBroker owns trading state** — no strategy, scheduler, or API handler mutates positions/orders directly.
4. **Market data owns price truth** — stale/missing market causes `NO_MARKET_STATE` rejection, never invented prices.
5. **Event log is append-only** — `events` table and `events.jsonl` are immutable history.
6. **Live execution requires explicit arm** — `TRADING_MODE=live` alone does nothing; `LIVE_TRADING_ARMED=true` plus credentials are required.
7. **Unknown exchange state blocks submission** — a failed or mismatched reconciliation trips safe mode, and `ExecutionRouter` rejects every order until an operator resolves it.
8. **Live execution is never simulated** — an armed live profile with no usable adapter rejects orders; it must never fall back to paper fills.
9. **TRADING_MODE is single selector** — one flag controls the operational profile, not multiple booleans.

## Current Capabilities

### Implemented and wired into `engine.ts`

- ✅ Binance WebSocket market data (bookTicker, markPrice, klines, aggTrade)
- ✅ `PaperBroker` with LIMIT/MARKET/STOP_MARKET/TAKE_PROFIT_MARKET, weighted-entry position accounting, flips, funding, fees, liquidation
- ✅ `ExecutionRouter` + `LiveTradingGuard` on every order submission
- ✅ `CoinDCXBroker` live adapter, arm-gated and credential-gated
- ✅ Strategy engine hosting **two** live strategies: `smc-agent-v1` and the adaptive Supertrend strategy
- ✅ SMC structure detection → `TradingAgentsPipeline` debate → `TradeIntentEngine` risk gate
- ✅ Adaptive Supertrend with Q-learning parameter selection per regime, persisted across restarts
- ✅ Profit goals (`ProfitGoalManager`) feeding `RiskEngine`'s trading halt and position-size multiplier, persisted, with calendar resets in `Scheduler`
- ✅ Trailing stops (`TrailingStopController`) doing real cancel-and-replace on resting STOP_MARKET orders
- ✅ Per-strategy performance feedback (`StrategyPerformanceTracker`) with drawdown/win-rate quarantine, persisted, operator-released
- ✅ Per-setup-archetype performance feedback for `smc-agent-v1` (same tracker, keyed by setup type), feeding advisory memory into the LLM prompts and gating quarantined archetypes deterministically, persisted, operator-released
- ✅ SQLite event persistence (append-only + queryable tables)
- ✅ Fastify REST + WebSocket gateway, API key auth on control endpoints
- ✅ Incident normalization (`ErrorNormalizer`) with Telegram alerts
- ✅ Exchange state reconciliation (`ExchangeReconciler`) on startup and reconnect, tripping `LiveTradingGuard` safe mode on mismatch or unreachable venue
- ✅ API rate limiting (`RateLimiter`), two-tier, on every non-WebSocket request
- ✅ Bracket-aware, fee-inclusive liquidation pricing (`PaperLiquidation`)
- ✅ CLI for operational commands

### Wired, but constrained by a missing second feed

- ⚠️ `MarketDataSupervisor` / `ProviderHealthManager` / `DivergenceGuard` are
  now constructed in `engine.ts` and fed from the Binance bookTicker stream, so
  provider liveness, latency and staleness are tracked and
  `/api/v1/health/providers` reports real state. **Failover itself cannot fire:**
  no CoinDCX *market data* feed ships here, so the fallback provider never
  records a tick and `validateFailover()` correctly refuses to promote it. The
  divergence guard is armed but has only one price source to compare.

### Deferred

- ⏸️ `SizingEngine.ts`, the classic indicator strategy files, and `BacktestRunner.ts` remain on disk and are reachable via `cli.ts --engine=indicators`, but produce zero trades because `SignalExecutor` no longer computes sizing for signals that do not carry it. Retired pending a unification plan, not a working alternative to the default `--engine=smc` path.

### Planned

- ⏳ Real leverage-bracket data from the exchange (the liquidation model accepts brackets but ships none)
- ⏳ Backtest engine visualization
- ⏳ Parallel-instance hosting for the ABTestRunner (currently ships the evaluation contract only)
- ⏳ Live Binance execution path behind LiveTradingGuard (out of scope for feature/agentic-upgrade — user explicitly asked to stay paper-only)

## Known Constraints

- Testnet vs mainnet switch via `BINANCE_ENV` (`testnet` | `mainnet` | `production`)
- Single-process architecture (not yet cluster-ready)
- SQLite limits concurrency; migration path to PostgreSQL planned
- API control endpoints require `API_KEY` when set; without it they are unauthenticated and localhost-only is assumed
- Live mode has never been validated against a real CoinDCX account in this repository
- All `AGENT_*_ENABLED` flags default OFF — operators must opt in to each agentic-layer feature independently. See `.env.example` for the full list.

## Last Updated

2026-08-30 (feature/agentic-upgrade branch)

---

**Agent Note**: Update this file when the project materially changes phase, capabilities, or invariants. Verify every claim against source before writing it here — several claims in earlier revisions of this file described code that existed on disk but was never constructed at runtime.
