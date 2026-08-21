# PROJECT_STATE.md

## Current Phase

**Phase: foundation**

This project is a paper trading engine with real Binance market data and simulated execution.

## Operating Modes

| Mode    | Status      | Description                                      |
|---------|-------------|--------------------------------------------------|
| paper   | implemented | Simulated execution with real market data        |
| shadow  | planned     | Read-only account state, simulated execution     |
| live    | planned     | Real execution with explicit arm/guard required  |

## Providers

| Provider         | Market Data | Execution | Status                          |
|------------------|-------------|-----------|---------------------------------|
| Binance Futures  | ✅          | ❌        | SDK available, market data active |
| CoinDCX          | ❌          | ❌        | Not integrated                  |

## Agent / LLM

| Component       | Status      | Notes                                    |
|-----------------|-------------|------------------------------------------|
| Ollama SDK      | available   | `@nemesis-oss/ollama-sdk`                |
| Agent loop      | partial     | OllamaSignalGenerator for trend signals  |
| MCP             | not started | Planned for tool orchestration           |
| Trading supervision | partial | Signal validation exists, full risk engine planned |

## Persistence

| Store     | Status      | Notes                                    |
|-----------|-------------|------------------------------------------|
| SQLite    | implemented | `paper.sqlite3` with WAL mode            |
| PostgreSQL| planned     | For production multi-instance deployment |
| Redis     | planned     | For pub/sub and caching                  |

## Dashboard

| Component | Status      | Notes                                    |
|-----------|-------------|------------------------------------------|
| Backend   | implemented | Fastify REST API (`src/api/server.ts`)   |
| Frontend  | planned     | React dashboard                          |

## Notifications

| Provider | Status      | Notes                                    |
|----------|-------------|------------------------------------------|
| Telegram | planned     | Operational alerting                     |
| Email    | not started | Planned for critical alerts              |

## Hard Invariants

These must NOT change without an ADR:

1. **LLM cannot execute orders directly** - LLM produces signals only; SignalExecutor owns order submission.
2. **PaperBroker owns trading state** - No strategy, scheduler, or API handler mutates positions/orders directly.
3. **Market data owns price truth** - Stale/missing market causes `NO_MARKET_STATE` rejection, never invented prices.
4. **Event log is append-only** - `events` table and `events.jsonl` are immutable history.
5. **Live execution requires explicit arm** - Future live mode needs separate armed state beyond `TRADING_MODE=live`.
6. **Exchange state is authoritative (future)** - Live trading requires reconciliation before resuming operations.
7. **TRADING_MODE is single selector** - One flag controls operational profile, not multiple booleans.

## Current Capabilities

### Implemented

- ✅ Binance WebSocket market data streams (bookTicker, markPrice, klines)
- ✅ Market state management with staleness detection
- ✅ PaperBroker with LIMIT/MARKET/STOP_MARKET/TAKE_PROFIT_MARKET orders
- ✅ Position accounting (weighted entry, P&L realization, flips)
- ✅ Funding payments simulation
- ✅ Fee tracking (taker/maker)
- ✅ SQLite event persistence (append-only + queryable tables)
- ✅ Strategy engine with cooldowns and conflict rules
- ✅ Signal executor with sizing logic
- ✅ REST API for monitoring
- ✅ CLI for operational commands
- ✅ Ollama integration for AI signals

### In Progress

- 🔄 Multi-timeframe structure analysis
- 🔄 Advanced setup detection (SMC concepts)

### Planned

- ⏳ Shadow mode (read-only exchange account state)
- ⏳ Live mode with CoinDCX or Binance execution
- ⏳ Provider failover (Binance ↔ CoinDCX)
- ⏳ Telegram notifications
- ⏳ React dashboard
- ⏳ Backtest engine
- ⏳ MCP tool orchestration
- ⏳ Advanced risk engine (daily loss limits, exposure caps)

## Known Constraints

- Testnet vs mainnet switch via `BINANCE_TESTNET` environment variable
- Single-process architecture (not yet cluster-ready)
- SQLite limits concurrency; migration path to PostgreSQL planned
- No authentication on API yet (localhost-only assumed)

## Last Updated

2025-01-XX

---

**Agent Note**: Update this file when the project materially changes phase, capabilities, or invariants.
