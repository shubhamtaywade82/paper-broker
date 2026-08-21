# KNOWN_LIMITATIONS.md

## Confirmed Limitations

This file records confirmed limitations of the current implementation.
**Agents MUST NOT describe these capabilities as complete or implemented.**

---

## Execution & Trading Modes

### ❌ Shadow Mode Not Implemented

Shadow mode (read-only exchange account state with simulated execution) is planned but not yet implemented.

Current status:
- `TRADING_MODE` only supports `paper` behavior
- No exchange account state reconciliation
- No read-only position tracking from live exchange

Work required:
- Exchange account query integration
- Reconciliation logic
- Shadow-specific event types
- Mode profile configuration

### ❌ Live Mode Not Implemented

Live trading with real order execution is not connected.

Current status:
- PaperBroker is the only broker implementation
- No CoinDCX or Binance execution integration
- No live trading guard / arm state
- No reconciliation after disconnect/timeout

Work required:
- Live broker implementation
- Risk engine enhancements
- LiveTradingGuard
- Execution router
- Reconciliation flow
- Explicit arm state mechanism

### ❌ Provider Failover Not Continuity-Safe

Switching between Binance and fallback providers (future CoinDCX) is not safe during active trades.

Current status:
- Binance is the sole market data provider
- No health monitoring with automatic failover
- No price divergence validation
- No candle continuity checks on switch

Work required:
- Provider health monitoring
- Failover decision logic
- State validation on switch
- Event emission for ProviderFailed/ProviderRecovered/ProviderSwitched

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
