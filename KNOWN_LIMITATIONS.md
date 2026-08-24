# KNOWN_LIMITATIONS.md

## Confirmed Limitations

This file records confirmed limitations of the current implementation.
**Agents MUST NOT describe these capabilities as complete or implemented.**

---

## Execution & Trading Modes

### ✅ Paper, Shadow & Live Routing Implemented
- `TRADING_MODE=paper|shadow|live` resolution implemented via `resolveRuntimeProfile`.
- `CoinDCXBroker` implements `ExecutionBroker` using `@nemesis-oss/coindcx-sdk`.
- `ExecutionRouter` routes between simulation and live venue with `LiveTradingGuard` arming validation (`LIVE_TRADING_ARMED=true`).

### ✅ Provider Failover & Divergence Guard Implemented
- `MarketDataSupervisor`, `ProviderHealthManager`, and `DivergenceGuard` implemented.
- Automatic failover from Binance to CoinDCX occurs only when fallback is healthy and price divergence is within threshold (default 50 bps).

### ❌ Exchange Position Reconciliation (Live Mode Ongoing Reconnects)
- Startup and periodic reconciliation with exchange balance/positions for automated multi-day recovery is planned.

Work required:
- Live reconciliation loop on websocket reconnect
- Blocking order submission if state discrepancy exceeds tolerance

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

### ❌ Full Risk Engine Not Implemented

Risk validation is partial.

Current status:
- Basic sizing exists in SignalExecutor
- No daily loss limits
- No exposure caps
- No cooldown enforcement beyond strategy-level
- No kill switch

Work required:
- RiskEngine component
- Daily/weekly/monthly loss tracking
- Position exposure limits
- Symbol exposure limits
- Kill switch mechanism
- Integration before SignalExecutor → Broker

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
- **Hardcoded risk parameters in `/api/v1/risk`** (`maxOpenPositions: 3`,
  `maxLeverage: 10`, `dailyLossLimitPct: 5.0`, etc.): these are display-only
  values in the API response, not read from `RiskLimits`
  (`PaperBroker`'s actual configured risk config) — the dashboard could show
  numbers that don't match what the broker will actually enforce if
  `PaperBrokerConfig.risk` is ever overridden from its defaults.
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

- **`PaperLiquidation.calculateLiquidationPrice()` uses a flat-rate,
  fee-and-funding-free formula** (`entryPrice * (1 - 1/leverage +
  maintenanceMarginRate)` for longs). Real exchanges use tiered maintenance
  margin rates that increase with position size, and a real liquidation
  also incurs the closing taker fee — both make actual liquidation happen
  earlier (a less favorable price) than this formula predicts, i.e. it is
  optimistic versus a real exchange. Implementing tiered margin schedules
  is exchange-specific data modeling, not a formula tweak.
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

### ❌ Dashboard Frontend Not Implemented

No React/web dashboard exists.

Current status:
- REST API backend implemented (`src/api/server.ts`)
- No frontend UI
- Monitoring via API responses only

Work required:
- React application
- Real-time WebSocket updates
- Position/order visualization
- P&L charts
- Control panel (with auth)

### ❌ API Authentication Not Implemented

The REST API has no authentication.

Current status:
- All endpoints accessible without credentials
- Assumes localhost-only deployment

Work required:
- API key authentication
- Role-based authorization
- Rate limiting
- Audit logging for commands

### ❌ Telegram Notifications Not Implemented

No notification subsystem exists.

Current status:
- Logging via Pino
- No Telegram integration
- No email integration
- No alert routing

Work required:
- NotificationService abstraction
- Telegram provider implementation
- Severity-based routing
- Deduplication logic
- Incident correlation IDs

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

---

**Last Updated**: 2026-08-24

**Agent Reminder**: If you discover a capability claimed in documentation that doesn't match implementation, add it here before proceeding.
