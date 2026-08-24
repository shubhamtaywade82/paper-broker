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

*(Add entries here when limitations are addressed)*

| Date | Limitation | Resolution |
|------|------------|------------|
| - | - | - |

---

**Last Updated**: 2025-01-XX

**Agent Reminder**: If you discover a capability claimed in documentation that doesn't match implementation, add it here before proceeding.
