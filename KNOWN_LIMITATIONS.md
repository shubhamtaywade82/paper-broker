# KNOWN_LIMITATIONS.md

## Confirmed Limitations

This file records confirmed limitations of the current implementation.
**Agents MUST NOT describe these capabilities as complete or implemented.**

---

## Execution & Trading Modes

### ✅ Paper, Shadow & Live Routing Implemented and Wired
- `TRADING_MODE=paper|shadow|live` resolution implemented via `resolveRuntimeProfile`.
- `CoinDCXBroker` implements `ExecutionBroker` using `@nemesis-oss/coindcx-sdk`.
- `ExecutionRouter` is constructed in `engine.ts` and sits on every order submission, applying the profile and `LiveTradingGuard` (`LIVE_TRADING_ARMED=true`).
- An armed live profile with missing `COINDCX_API_KEY`/`COINDCX_API_SECRET` rejects orders with `NO_LIVE_EXECUTION_ADAPTER`; it never falls back to simulated fills while reporting live execution.
- **Caveat:** the live path has never been validated against a real CoinDCX account in this repository. Treat it as implemented but unproven.

### ⚠️ Provider Failover Wired But Inert (no second feed)
- `MarketDataSupervisor`, `ProviderHealthManager` and `DivergenceGuard` are constructed in `engine.ts` and fed from the Binance bookTicker stream. Provider liveness, latency and staleness are tracked, `PROVIDER_SWITCHED` is emitted, and `/api/v1/health/providers` reports real state.
- **Failover still cannot fire.** No CoinDCX market-data feed exists in this repository, so the fallback provider never records a tick, `isHealthy('COINDCX')` is always false, and `validateFailover()` refuses to promote it. This is correct behaviour — never silently promote a feed that is not there — but do not describe failover as working.
- The divergence guard is armed and has only one price source, so `checkDivergence()` always returns `isDivergent: false`.
- Work required: add a CoinDCX market-data feed and call `supervisor.processTick('COINDCX', ...)` from it. No other change is needed.

### ⚠️ Exchange Position Reconciliation Implemented, Orders Only Partly Covered

`ExchangeReconciler` runs on startup and on websocket reconnect when a live
venue is attached. It compares venue positions against local positions and, on
any material mismatch — or if the venue cannot be read at all — trips
`LiveTradingGuard` into safe mode, which makes `ExecutionRouter` reject every
subsequent submission. Clearing it requires `POST /api/v1/reconcile`, which
re-runs reconciliation and only resumes on a clean result.

Still missing:
- **Order-level reconciliation is weak.** `CoinDCXBroker.getOpenOrders()` returns
  its own in-memory map rather than querying the venue, so resting orders placed
  before a restart are invisible. Position reconciliation — the part that
  prevents double-entry — does query the venue.
- No periodic reconciliation; only startup, reconnect and manual triggers.
- No automatic remediation. The reconciler halts trading and reports; squaring
  the books is an operator action.
- Never validated against a real CoinDCX account.

---

## Agent & LLM

### ❌ MCP Tool Orchestration Not Implemented

The Ollama SDK supports MCP but the trading engine does not use it.

Current status:
- OllamaSignalGenerator produces simple BUY/SELL/HOLD signals
- No tool-calling agent loop
- No skill selection
- No structured TradeIntent with evidence

Work required:
- Agent loop integration
- Tool definitions for market data, positions, analysis
- Skill system integration
- Structured output schema

### ✅ Risk Engine Implemented

`RiskEngine` (`src/trading/risk/RiskEngine.ts`) validates every signal before an
order is built, via `TradeIntentEngine`.

Implemented:
- Daily loss limit (`DAILY_LOSS_LIMIT_REACHED`)
- Max open positions and per-symbol caps (`MAX_OPEN_POSITIONS_REACHED`)
- Account-wide risk cap (`MAX_ACCOUNT_RISK_EXCEEDED`)
- Cooldown enforcement (`COOLDOWN_ACTIVE`)
- Duplicate-signal rejection
- Position sizing via `PositionSizer` with instrument step/tick rounding
- Profit-goal trading halt (`PROFIT_GOAL_TRADING_HALTED`) and position-size risk multiplier
- Kill switch via `POST /api/v1/kill_switch` (cancels open orders, broadcasts `kill_switch.activated`)

Still missing:
- Weekly/monthly loss tracking (profit goals track weekly/monthly *gains*, not loss limits)
- Correlated-exposure limits across symbols (each symbol is capped independently)

### ✅ Per-Strategy Performance Feedback Implemented

`StrategyPerformanceTracker` maintains realized PnL, win rate, and
peak-to-trough drawdown per strategy from broker fills, and quarantines a
strategy that breaches its thresholds — `StrategyEngine` then stops routing
candles and ticks to it. State persists to `data/strategy_performance.json`.

- Off by default; `STRATEGY_FEEDBACK_ENABLED=true` opts in. Otherwise the
  tracker observes without acting.
- Releasing a quarantine is an operator action
  (`POST /api/v1/strategies/:id/release`), never automatic.
- Not implemented: continuous capital weighting between strategies. The gate is
  binary (trading / quarantined), not an allocator.

### ✅ Profit Goals and Trailing Stops Implemented

- `ProfitGoalManager` is constructed in `engine.ts`, injected into
  `TradeIntentEngine` → `RiskEngine`, fed realized PnL by the broker's `onFill`
  hook, persisted to `data/profit_goals.json`, and reset on calendar boundaries
  by `Scheduler`. Off by default (`PROFIT_GOALS_ENABLED`).
- `TrailingStopController` performs real cancel-and-replace on resting
  reduce-only `STOP_MARKET` orders. Off by default (`TRAILING_STOPS_ENABLED`).
- Not implemented: trailing stops are driven from the aggTrade price stream
  only, so a symbol with no trade prints does not trail.

---

## Strategy Layer

### ❌ Dual Paper Broker Architectures (H-11)

Two entirely separate paper broker implementations exist with no shared
interface or adapter:

- `PaperBroker` (`src/broker/PaperBroker.ts`, types in `src/broker/types.ts`)
  — used by the live engine (`engine.ts`) and `BacktestRunner.ts`. Implements
  `ExecutionBroker` with `Order`/`Fill`/`Position`/`AccountState` types.
- `SmcPaperBroker` (`src/broker/paper/SmcPaperBroker.ts`, types in
  `src/broker/paper/types.ts`) — used by `ReplayEngine` (the backtest engine
  reachable via `/api/v1/backtest/run`). Implements a parallel
  `PaperOrder`/`PaperFill`/`PaperPosition`/`PaperAccountState` type system
  with different field names (e.g. `CANCELED` vs `CANCELLED`), different
  status enums, and different PnL/fee application logic.

Current status:
- No shared interface or adapter layer exists between them.
- A bug fix or behavioral change made to one is not automatically reflected
  in the other — verify both when touching fill/PnL/fee logic.
- H-12 (taker fee default mismatch, 4bps vs 5bps) was one concrete symptom of
  this and has been fixed (both now default to 4bps), but that was a numeric
  alignment, not a structural fix — the two implementations can still drift
  again independently.

Work required (not attempted in this pass — see AGENTS.md Section 20, this is
a materially large refactor touching both the live and backtest execution
paths and needs its own design/ADR, not a fix folded into an unrelated
change):
- Design a shared `ExecutionBroker`-compatible interface (or adapter) that
  both implementations satisfy, or
- Migrate `ReplayEngine` onto `PaperBroker` directly (as `BacktestRunner`
  already does) and retire `SmcPaperBroker`, with full behavioral-parity
  testing across both live and backtest paths before cutover.

### ⚠️ grid-15m Documented Exception to the Execution Contract

`createGridStrategy` (`src/strategy/strategies/grid-15m.ts`) calls
`ctx.submitOrder()` directly instead of emitting a `SignalInput`, which is a
deliberate, documented exception to CONTRACTS.md Section 1 ("strategies never
place orders directly"), not an oversight.

Why: a grid ladder is N resting BUY limits and N resting SELL limits placed
atomically as one unit. `SignalInput`/`Signal` model exactly one directional
trade decision (one action, one quantity, one stop/TP), so there is no way to
express "place a full ladder this candle" through the standard pipeline
without either changing what grid trading means (spreading the ladder across
N candles) or extending the Signal schema to support order batches — either
is a materially different architecture change than a docs/safeguards fix
warrants, per AGENTS.md Section 20.

Current status:
- Not wired into the live engine (`engine.ts` does not register it) — only
  reachable via `BacktestRunner`'s already-retired `--engine=indicators` CLI
  path.
- Bypasses `SignalExecutor`'s sizing/risk pipeline and the `SignalRepository`,
  so ladder orders are not tracked as signals.
- Fixed as of the C-08/C-09 review pass: the strategy now enforces its own
  position limit (`maxTotalGridNotional`, `maxEquityFraction` options) while
  placing the ladder, stopping and logging a warning rather than silently
  exceeding it. It still does not get the standard pipeline's cooldown/
  conflict/exposure checks.

Work required (if this strategy is ever wired into the live engine):
- Extend the Signal schema to support an order-batch action, or
- Accept that grid trading needs its own execution path with its own risk
  gate wired explicitly (not the single-Signal SignalExecutor path), and
  document that as an ADR before wiring it live.

---

## API Server Design Debt (Medium findings, not fixed this pass)

Several Medium-severity findings from the code review describe design debt
in `src/api/server.ts` and `src/api/websocket/WebSocketGateway.ts` that
would require materially changing the API's shape or adding new
architecture (a repository layer, a pub/sub subscription model) rather than
a contained bug fix. Documented here instead of attempted piecemeal, per
AGENTS.md Section 20 (stop and document rather than make a silent
architecture change):

- **Inconsistent REST path structure**: some endpoints are at the root
  (`/orders`, `/engine/start`) and others under `/api/v1/` (most dashboard
  endpoints). A consistent scheme would mean either versioning everything or
  nothing — a breaking change for whatever currently calls the root-level
  routes.
- **Raw DB access from the API layer**: `/api/v1/journal`,
  `/api/v1/backtest/history`, `/api/v1/backtest/:id`, and
  `/api/v1/backtest/run` all call `this.events.raw.prepare(...)` directly
  instead of going through a repository. Fixing this properly means adding
  a `BacktestRepository`/`JournalRepository` (matching the existing
  `SignalRepository` pattern) — a real but non-trivial addition, not a
  one-line fix.
- **N+1-shaped query in `/api/v1/journal`**: builds a `stopPriceBySignal`
  map from one query, then does the entries computation in JS rather than
  a single joined query — works correctly today, but doesn't scale past the
  1000-row `FILL_CREATED` fetch it's already capped at.
- ~~**Hardcoded risk parameters in `/api/v1/risk`**~~ — **RESOLVED 2026-08-25.** The
  endpoint now reports the `RiskConfig` actually in force (passed from
  `engine.ts`), plus real `safeMode` from `LiveTradingGuard`, live profit-goal
  state, and the list of quarantined strategies.

- **Silent error swallowing on external Binance proxy calls**
  (`/api/v1/orderbook`, `/api/v1/trades`, `/api/v1/tickers`): `catch { ... }`
  blocks with no logging fall back to market-state data or an empty array.
  Reasonable as a fallback, but failures are invisible to operators.
- **Missing explicit Content-Type validation on POST endpoints**: Fastify's
  default JSON body parser already only engages for
  `Content-Type: application/json` (a non-JSON POST reaches route handlers
  with an unparsed/empty body, which Zod validation then rejects) — but
  there's no explicit, friendly `415`-style check or error message for a
  wrong Content-Type.
- **WebSocketGateway**: no backpressure handling on `broadcast()` (a slow
  client's `ws.send()` buffer can grow unbounded — `bufferedAmount` is never
  checked), and no subscription/topic model (every event type goes to every
  connected client regardless of what the dashboard view actually needs).
  H-05/H-06 (heartbeat + connection/rate limits) were fixed this pass;
  backpressure and subscriptions are a larger client-facing protocol change.

## Persistence & Observability Design Debt (Medium findings, not fixed this pass)

- **`db.ts` stores monetary/decimal fields as TEXT**: this is not a bug —
  it's what CONTRACTS.md's Monetary Precision Contract (Section 14)
  requires ("Database: decimal strings... Never: float comparison for
  monetary values"), avoiding SQLite's REAL-type floating-point precision
  loss. The real cost the review's finding points at is genuine, though:
  TEXT columns sort/compare lexicographically, not numerically, so a range
  query (`WHERE quantity > ?`) can't use a normal index efficiently. A fix
  (generated numeric shadow columns with their own indexes for the specific
  range-queried fields) is schema work, not a one-line index addition — not
  attempted this pass.
- **`Metrics` (in-memory counters/gauges) and `ErrorNormalizer` (in-memory
  incident history, capped at 200) both lose their state on restart.**
  HELP annotations and naming-convention warnings were added to `Metrics`
  this pass (see commit history), but persisting either to SQLite is a
  real feature (schema + load-on-construct + write-through) beyond a
  contained bug fix.
- **`docs/api.md` (or equivalent) is missing coverage for 15+ endpoints**
  that exist in `server.ts` — not verified/updated this pass; treat the
  source (`server.ts`'s route registrations) as authoritative over any
  existing API documentation until it's reconciled.

## Known Performance Characteristics (not fixed this pass)

- **`PaperBroker.onMarket()` recalculates full account state on every
  market tick** (`recalculateAccount()` iterates every open position;
  `checkLiquidation()` does too) rather than incrementally updating only
  the ticked symbol's position and the account-level aggregates. Correct
  today, but means account-state computation cost scales with total open
  position count on every single tick, not just ticks that affect a
  multi-position account. An incremental-update rewrite touches core P&L/
  margin calculation logic in a financial-correctness-critical file —
  deliberately not attempted in this pass (AGENTS.md: prefer small verified
  changes over large speculative refactors in code this sensitive).
- **`StructureClassifier`'s break detection is O(n²)** over the candle/swing
  history for the timeframes it processes. Not verified against real
  production candle-history sizes to confirm this is an actual bottleneck
  (vs. a correct-but-unoptimized algorithm operating on small windows) —
  flagging for future profiling rather than assuming it needs fixing.

## Financial Modeling Simplifications (not fixed this pass)

- ~~**`PaperLiquidation.calculateLiquidationPrice()` uses a flat-rate**~~ —
  **PARTLY RESOLVED 2026-08-25.** It now solves the standard isolated-margin
  relation (`margin + pnl - fees = notional*mmr - maintenanceAmount`) and accepts
  a real leverage-bracket table, selecting the bracket by notional. It also
  accounts for fees and funding already charged, which the old formula ignored.
  **Still missing:** this repository ships no bracket data — fabricating exchange
  tier boundaries would produce an authoritative-looking wrong number — so with
  no brackets supplied it falls back to a single tier built from the instrument's
  own `maintenanceMarginRate`. Supply real brackets from the exchange's
  leverage-bracket endpoint to get true tiering. Note that the closing taker fee
  at liquidation is still not modelled, so the result remains marginally
  optimistic versus a real exchange.
- **The `SmcPaperBroker` subsystem (`src/broker/paper/*.ts`, used by
  `ReplayEngine`/backtesting) computes money with native JS floating-point
  arithmetic plus `.toFixed(4)` rounding, not `decimal.js`** — a direct
  instance of the same "dual broker architecture" split already documented
  above (H-11): `PaperBroker.ts` (the live path) correctly uses `decimal.js`
  per CONTRACTS.md Section 14 ("Money uses decimal arithmetic... Never:
  float comparison for monetary values"); the entire `SmcPaperBroker`
  subsystem (`PaperAccount`, `PaperFeeModel`, `PaperFundingModel`,
  `PaperLedger`, `PaperLiquidation`, `PaperMetrics`, `PaperPositionManager`,
  `PaperSlippageModel`) does not. This is a real CONTRACTS.md violation in
  the backtest path, not a narrow "balance rounding" nit — migrating 8
  files' arithmetic to `decimal.js` with full behavioral-parity retesting
  is a substantial project of its own, tracked here rather than attempted
  as part of this review pass.

---

## Dashboard & Control

### ✅ Dashboard Frontend Implemented

A React application exists under `dashboard/` (Vite, Zustand stores, its own
vitest suite, nginx config, Docker build). It consumes the REST API and the
WebSocket gateway.

Still missing:
- The dashboard does not yet surface the newer endpoints
  (`/api/v1/profit-goals`, `/api/v1/strategies/performance`) or the
  `profit.goal` / `strategy.performance` / `trailing.stop` WebSocket events.
- `AgentCycleStep` now carries `engine: 'llm' | 'deterministic'`; the agent view
  does not yet use it to distinguish model output from deterministic policy.

### ✅ API Rate Limiting Implemented

`RateLimiter` applies a two-tier token bucket per client IP on every
non-WebSocket request, registered as an `onRequest` hook so unmatched paths are
covered too. Reads get 600/min sustained with a 120 burst; control endpoints
(anything non-GET) get 60/min with a 20 burst. Blocked requests return `429`
with `Retry-After`. Buckets are evicted when idle and hard-capped, so client
churn cannot grow memory without bound.

The WebSocket upgrade path is exempt — it is one long-lived connection per
client, already bounded by `WebSocketGateway`'s own connection limit.

Still missing: limits are per-process (no shared store across instances), and
keyed by `request.ip`, which is only as trustworthy as the proxy in front of it.

### ⚠️ API Authentication Partially Implemented

`API_KEY` guards control endpoints via the `requireApiKey` preHandler:
order submission/cancel, kill switch, mode arm/disarm, aggressive mode,
backtest run, and strategy quarantine release.

Still missing:
- Read endpoints are unauthenticated even when `API_KEY` is set.
- When `API_KEY` is unset, control endpoints are open — localhost-only is assumed.
- No role-based authorization and no per-command audit log. (Rate limiting is now implemented — see above.)

### ✅ Telegram Notifications Implemented

`TelegramNotifier` sends startup, incident, and trade notifications, with
`TelegramLimiter` rate limiting, HTML escaping, and bot-token redaction in logs.
`ErrorNormalizer` assigns incident IDs (`INC-...`).

Still missing:
- No webhook sink beyond Telegram.
- `TELEGRAM_MIN_LEVEL` is parsed from env but not used to filter sends.

---

## Testing & Verification

### ❌ Backtest Engine Incomplete

Backtesting functionality is not production-ready.

Current status:
- CLI has `backtest` command placeholder
- No historical replay engine
- No performance attribution

Work required:
- Historical data loader
- Replay engine matching live semantics
- Performance metrics
- Report generation

### ❌ Architecture Boundary Tests Missing

No automated enforcement of architectural contracts.

Current status:
- Contracts documented in CONTRACTS.md
- No import-boundary tests
- No ESLint rules for layer violations

Work required:
- Import boundary tests (e.g., strategy → exchange SDK)
- ESLint custom rules
- CI enforcement

### ❌ Integration Test Coverage Gaps

Critical paths lack integration tests.

Missing coverage:
- End-to-end signal → order → fill flow
- Market stale → rejection flow
- Funding payment application
- Position flip scenarios
- Event persistence verification

---

## Persistence & Scaling

### ❌ SQLite Concurrency Limits

Single-file SQLite limits multi-instance deployment.

Current status:
- WAL mode enabled for better concurrency
- Single-process architecture assumed
- No migration to PostgreSQL

Work required:
- PostgreSQL schema migration
- Connection pooling
- Multi-instance coordination
- Redis for pub/sub (if needed)

### ❌ Event Replay Not Formalized

Replaying events to rebuild state is not a formal capability.

Current status:
- Events persisted to `events` table and `events.jsonl`
- No replay utility
- No snapshot + replay optimization

Work required:
- Event replay utility
- Snapshot capture/restore
- Time-travel debugging support

---

## Market Data

### ❌ Multi-Timeframe Structure Engine Incomplete

Advanced market structure analysis is in progress.

Current status:
- Single-timeframe candles processed
- Multi-timeframe structure (HTF/LTF) not complete
- SMC concepts (sweeps, CHoCH, BOS) partially implemented

Work required:
- MTF candle synchronization
- Structure point detection
- Liquidity pool tracking
- Displacement detection

---

## Security

### ❌ Secrets Management Basic

Secrets handling is minimal.

Current status:
- `.env` file usage via dotenv
- No secrets rotation
- No encrypted storage

Work required:
- Environment validation on startup
- Secrets masking in logs
- Rotation support (future)

---

## Documentation

### ❌ Runbooks Missing

Operational runbooks not written.

Missing:
- Startup procedures
- Incident response
- Recovery procedures
- Deployment guide

---

## How to Use This File

### For AI Agents

Before claiming a feature is implemented:
1. Check this file
2. Verify in source code
3. If listed here as incomplete, it IS NOT done

Example violations to avoid:
- ❌ "Telegram notifications are ready" (they're not)
- ❌ "Live mode can be enabled" (it cannot)
- ❌ "The backtest engine will replay history" (it won't yet)

### For Developers

When you complete work that addresses a limitation:
1. Move it to a "Recently Resolved" section with date
2. Update PROJECT_STATE.md capabilities
3. Ensure tests cover the new capability
4. Do not remove this file's history

---

## Recently Resolved

| Date | Limitation | Resolution |
|------|------------|------------|
| 2026-08-24 | API endpoints fully unauthenticated | Optional API_KEY bearer/x-api-key auth + LIVE_ARM_PASSCODE on order/engine/mode-control endpoints (C-01) |
| 2026-08-24 | Path traversal in `/assets/:file` | `path.basename()` + reject any non-bare-filename value (C-02) |
| 2026-08-24 | Triple-opened SQLite connections with inconsistent pragmas | EventLog/SnapshotStore now share DatabaseManager's connection (C-03) |
| 2026-08-24 | Liquidation bypassed the Fill/audit-trail pipeline | Routed through executeFill() via a synthetic LIQUIDATION order (C-04) |
| 2026-08-24 | Unbounded SmcLocationEngine cache growth | FIFO-capped at 2000 entries (C-05) |
| 2026-08-24 | Unguarded LLM pipeline call in smc-agent strategy | try/catch + 5-failure circuit breaker (C-06) |
| 2026-08-24 | TradingEventBus.publish serialized/unisolated handlers | Concurrent dispatch via Promise.allSettled (C-07) |
| 2026-08-24 | Q-learning Bellman update bootstrapped off the wrong state; hardcoded reward | Bootstraps off real next-state; reward now derived from realized trade outcome (C-08) |
| 2026-08-24 | grid-15m bypassed the signal pipeline with no risk limits | Kept as a documented exception, added its own notional/equity-fraction caps (C-09) |
| 2026-08-24 | 20 High findings (H-01 through H-20: DoS/SSRF/blocking-I/O limits, WS heartbeat/connection limits, EventLog dual-write ordering, Telegram token/rate-limiting, dual-broker fee/peak-equity issues, shutdown races, `as any` cast, debate rounds/risk-team documentation, SignalExecutor false-success, MACD/Supertrend warm-up) | See git history on `claude/paper-broker-code-review-wp6pkg` for the individual commits |
| 2026-08-24 | Dead code: `signalAdapter.ts`, `agentRuntime.ts` | Removed (zero production importers confirmed) |
| 2026-08-24 | Several Medium findings (funding double-apply, wrong `applyIntent` event type, VOLATILITY slippage silently zero, ErrorNormalizer dedup collisions, Telegram HTML injection, missing `orders.signal_id` index, cli.ts shutdown/--help, Metrics HELP annotations) | See git history on `claude/paper-broker-code-review-wp6pkg` |
| 2026-08-24 | Remaining Medium findings (API layer design debt, WebSocket backpressure/subscriptions, TEXT-column range queries, in-memory metrics/incident persistence, api.md coverage, PaperBroker/StructureClassifier performance characteristics, PaperLiquidation formula simplification, SmcPaperBroker decimal.js migration) | Investigated and documented above (not fixed — each requires its own larger, separately-scoped change) rather than left unrecorded |
| 2026-08-25 | `ProfitGoalManager`/`TrailingStopManager` existed but were unreachable — `engine.ts` called `new TradeIntentEngine()` with no arguments | Constructed in `engine.ts`, injected into `RiskEngine`, fed by a new `PaperBroker.onFill` hook, persisted via `ProfitGoalStore`, reset on calendar boundaries by `Scheduler`. New `TrailingStopController` performs real cancel-and-replace on resting stop orders |
| 2026-08-25 | `ExecutionRouter` was imported only by its own test; the engine talked to `PaperBroker` directly regardless of `TRADING_MODE` | Router constructed in `engine.ts` and placed on every order submission; `SignalExecutor` widened to `ExecutionBroker`; `CoinDCXBroker` wired as the live adapter behind the arm gate |
| 2026-08-25 | `ExecutionRouter` silently fell back to paper fills when the profile demanded real orders but no adapter was registered — simulated fills reported as live execution | Rejects with `NO_LIVE_EXECUTION_ADAPTER` instead |
| 2026-08-25 | `StrategyEngine` had no performance feedback; strategies ran always-on regardless of PnL | `StrategyPerformanceTracker` + quarantine gate, persisted across restarts, operator-released |
| 2026-08-25 | Agent risk team evaluated 2 of 3 declared personas and its only rule was `leverage > 5`; the fund manager rubber-stamped on confidence alone | Complete deterministic policy across SAFE/NEUTRAL/RISKY with real ceilings, stop validation, free-margin limits, and every `RiskOpinionSchema` verdict reachable. Kept deterministic per CONTRACTS.md §5 — not converted to LLM calls |
| 2026-08-25 | All seven agent stages were presented identically as "agents" despite two being hardcoded policy | `AgentCycleStep` now carries `engine: 'llm' \| 'deterministic'` |

---

**Last Updated**: 2026-08-25

**Agent Reminder**: If you discover a capability claimed in documentation that doesn't match implementation, add it here before proceeding.
