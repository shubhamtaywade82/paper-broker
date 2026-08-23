# PROJECT_STATE.md

## Current Phase

**Phase: foundation**

This project is a paper trading engine with real Binance market data and simulated execution.

## Operating Modes

| Mode    | Status      | Description                                      |
|---------|-------------|--------------------------------------------------|
| paper   | implemented | Simulated execution with real market data        |
| shadow  | implemented | Read-only account state, simulated execution     |
| live    | implemented | CoinDCX execution with explicit arm gate (`LiveTradingGuard`) |

## Providers

| Provider         | Market Data | Execution | Status                          |
|------------------|-------------|-----------|---------------------------------|
| Binance Futures  | ✅          | ❌        | Primary market data stream active |
| CoinDCX          | ✅ (Fallback)| ✅       | MarketDataSupervisor fallback + CoinDCXBroker live execution |

## Agent / LLM

| Component       | Status      | Notes                                    |
|-----------------|-------------|------------------------------------------|
| Ollama SDK      | available   | `@nemesis-oss/ollama-sdk`                |
| Agent loop      | implemented | `TradingAgentsPipeline` multi-agent debate drives every live signal via `createSmcAgentStrategy` (registered in `engine.ts`); also reachable manually via `/api/v1/agents/cycle` |
| Ollama reachability | hard runtime dependency | If Ollama is unreachable, the agent debate always resolves to NEUTRAL and no trades occur (safe by design); `engine.ts` logs a startup warning if unreachable, but does not gate startup |
| MCP             | planned     | Planned for tool orchestration           |
| Trading supervision | implemented | LiveTradingGuard, DivergenceGuard, Risk check |

## Persistence

| Store     | Status      | Notes                                    |
|-----------|-------------|------------------------------------------|
| SQLite    | implemented | `paper.sqlite3` with WAL mode            |
| PostgreSQL| planned     | For production multi-instance deployment |
| Redis     | planned     | For pub/sub and caching                  |

## Dashboard

| Component | Status      | Notes                                    |
|-----------|-------------|------------------------------------------|
| Backend / BFF | implemented | Fastify REST API + WebSocket Gateway (`/ws`, `/api/v1/dashboard`) |
| Frontend  | planned     | React dashboard                          |

## Notifications

| Provider | Status      | Notes                                    |
|----------|-------------|------------------------------------------|
| Telegram | implemented | ErrorNormalizer with incident IDs (`INC-...`) and TelegramNotifier |
| Webhook  | planned     | Additional operational alert sinks       |

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
- ✅ CoinDCX execution broker (`CoinDCXBroker`) via `@nemesis-oss/coindcx-sdk`
- ✅ Unified execution router (`ExecutionRouter`) and live safety guard (`LiveTradingGuard`)
- ✅ Multi-feed market data supervisor (`MarketDataSupervisor`) with fallback coordination
- ✅ Cross-exchange price divergence guard (`DivergenceGuard`)
- ✅ Provider health & latency tracking (`ProviderHealthManager`)
- ✅ Fastify WebSocket gateway (`ws://localhost:8080/ws`) for real-time dashboard push events
- ✅ Consolidated dashboard BFF endpoints (`/api/v1/dashboard`, `/api/v1/health/providers`, `/api/v1/incidents`, `/api/v1/mode/arm`)
- ✅ Incident normalization and error pipeline (`ErrorNormalizer`) with Telegram alerts (`TelegramNotifier`)
- ✅ PaperBroker with LIMIT/MARKET/STOP_MARKET/TAKE_PROFIT_MARKET orders
- ✅ Position accounting (weighted entry, P&L realization, flips)
- ✅ Funding payments simulation
- ✅ Fee tracking (taker/maker)
- ✅ SQLite event persistence (append-only + queryable tables)
- ✅ Strategy engine with cooldowns and conflict rules, hosting a single live strategy (`smc-agent-v1`)
- ✅ SMC structure detection → `TradingAgentsPipeline` multi-agent debate → `TradeIntentEngine` risk gate drives every live/paper trading signal (`createSmcAgentStrategy`, wired in `engine.ts`); classic indicator strategies (EMA/RSI/breakout/momentum/grid/Ollama-trend) removed from the live loop
- ✅ Signal executor executes pre-sized signals (quantity/leverage sourced from `signal.features`, computed upstream by the risk gate — `SignalExecutor` itself no longer contains sizing logic)
- ✅ CLI for operational commands

### In Progress

- 🔄 Multi-timeframe structure analysis (`MtfStateEngine`, wired into the live SMC pipeline in `engine.ts`)

### Deferred (not yet migrated to the unified pipeline)

- ⏸️ `SizingEngine.ts`, the 6 non-Ollama classic strategy files, and `BacktestRunner.ts` remain on disk, reachable via `cli.ts`'s `--engine=indicators` flag, but produce zero trades (`SignalExecutor` no longer computes sizing for signals that don't carry it) — this path is retired pending a future unification plan, not a working alternative to the default `--engine=smc` path

### Planned

- ⏳ Standalone React dashboard UI (`apps/dashboard`)
- ⏳ MCP tool orchestration loop
- ⏳ Backtest engine visualization

## Known Constraints

- Testnet vs mainnet switch via `BINANCE_TESTNET` environment variable
- Single-process architecture (not yet cluster-ready)
- SQLite limits concurrency; migration path to PostgreSQL planned
- No authentication on API yet (localhost-only assumed)

## Last Updated

2026-08-23

---

**Agent Note**: Update this file when the project materially changes phase, capabilities, or invariants.
