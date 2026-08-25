# Architecture

`paper-broker` is a single-process modular monolith. It streams Binance Futures market data over WebSocket, simulates a USDT-margined futures account in the `PaperBroker`, and persists every state transition as an append-only event log in SQLite.

```
┌────────────┐   WebSocket   ┌──────────────┐   raw payloads   ┌──────────────┐
│  Binance   │ ◄───────────► │  binance/    │ ───────────────► │  market/     │
│  Futures   │               │  streams.ts  │                  │  state.ts    │
└────────────┘               └──────────────┘                  └──────┬───────┘
                                            klines                    │ market states
                                             │                        │ (price truth)
                                             ▼                        ▼
                                     ┌──────────────┐          ┌──────────────────┐
                                     │  strategy/   │ signals  │     strategy/     │
                                     │  StrategyEng.│ ───────► │  SignalExecutor   │
                                     └──────────────┘          └────────┬─────────┘
                                                                        │ orders
                                                                        ▼
                                  ┌──────────┐  order/fill/position  ┌────────────┐
                                  │ scheduler│  events                │  broker/   │
                                  │  jobs    │ ─────────────────────► │ PaperBroker│
                                  └──────────┘                        └─────┬──────┘
                                                                             │ event sink
                                                                             ▼
                                                          ┌──────────────────────────────┐
                                                          │ persistence/ (SQLite WAL)    │
                                                          │  events (append-only)        │
                                                          │  orders / fills / positions  │
                                                          │  account snapshots / ticks   │
                                                          │  events.jsonl stream         │
                                                          └──────────────────────────────┘
                                                                             ▲
                                    REST API (api/server.ts) ───────────────┘ serves broker
                                    + Prometheus metrics / telemetry           memory + DB
```

## Invariants

1. **Only `PaperBroker` mutates trading state.** Account balance, orders, fills and positions are owned exclusively by the broker. No strategy, signal executor, scheduler or API handler writes to them directly.
2. **Market data owns price truth.** All fills are priced off the current market state (bid/ask/last/mark). A stale or missing market causes orders to be rejected with `NO_MARKET_STATE` / `STALE_MARKET_DATA` rather than being filled at invented prices.
3. **Strategies own signals.** Strategies emit typed signals on candle close. The engine routes them verbatim to the `SignalExecutor`. Sizing and risk are decided upstream by `TradeIntentEngine`/`RiskEngine`, which put `quantity` and `leverage` on `signal.features`; `SignalExecutor` no longer computes sizing itself.
5. **All order writes go through `ExecutionRouter`.** `SignalExecutor` accepts `ExecutionBroker`, not a concrete broker. The router applies the mode profile and `LiveTradingGuard`, and refuses to simulate fills for an armed live profile with no usable adapter.
6. **Observers cannot break execution.** `PaperBroker.onFill` notifies profit goals and performance tracking; a throwing observer is isolated and never aborts a fill.
4. **The database owns audit.** The broker broadcasts every transition through an event sink; `EventLog` appends to the immutable `events` table and the JSONL stream, while `BrokerPersister` keeps the queryable `orders` / `fills` / `positions` tables in sync. Broker memory is live state; the DB is persistent history.

## Component responsibilities

### `binance/` — market data ingestion

- `client.ts` — wraps `@nemesis-oss/binance-sdk` (`BinanceClient`), testnet vs mainnet switch, exchange info bootstrap.
- `streams.ts` — subscribes to `bookTicker`, `markPrice` and kline streams per symbol; exposes `onMessage` callbacks and `disconnect()`.
- `normalizers.ts` — maps raw WS payloads to typed market updates (accepts `any` payloads by design).

### `market/` — market state & candles

- `state.ts` — `MarketStateManager`: merges WS updates into per-symbol `MarketState` (bid/ask/last/mark/funding), stamps `localTsUtc`, tracks staleness, stores a rolling history, and serves as the `MarketStateProvider` the broker queries.
- `candles.ts` — candle builder: accumulates ticks into OHLCV candles on the configured interval (5m, 15m).
- `kline.ts` — SQLite-backed kline persistence (`klines_1m`).

### `broker/` — paper execution

`PaperBroker` is the heart of the simulator. It reproduces exchange semantics without any real exchange call:

- **Matching** — MARKET fills at the market bid/ask with configurable slippage; LIMIT orders rest at their price and fill when price crosses; STOP_MARKET / TAKE_PROFIT_MARKET brackets trigger on stop price.
- **Fees** — taker/maker rates, applied per fill and tracked in `totalFees`.
- **Funding** — on schedule (default 8h), funding = `qty × mark × fundingRate`, applied to wallet and positions.
- **Risk checks** — reduce-only enforcement (`REDUCE_ONLY_WOULD_INCREASE`), min-notional, max-leverage, max-position notional.
- **Position accounting** — one position per symbol with weighted-average entry; fills produce `OPEN` / `INCREASE` / `REDUCE` / `CLOSE` / `FLIP` transitions and realize P&L on close/reduce.
- **Sinks** — every transition emits an event to the `OrderEventSink` (`EventLog`) and persists the resulting row via the `BrokerPersister`.

### `strategy/` — signals & execution

- `StrategyEngine` — registers strategies, applies per-strategy cooldowns, validates signals (schema + conflict rules + expiry), forwards accepted signals to the executor.
- `SignalExecutor` — submits pre-sized signals through `ExecutionBroker` (the router), closes at position size with reduce-only, attaches STOP_MARKET / TAKE_PROFIT_MARKET brackets, and updates signal status (`EXECUTED` / `REJECTED`). It reports failure rather than success when a signal is skipped.
- `StrategyPerformanceTracker` / `StrategyPerformanceStore` — per-strategy realized PnL, win rate and peak-to-trough drawdown built from broker fills. A strategy breaching its thresholds is quarantined and `StrategyEngine` stops routing candles and ticks to it. Persisted; released only by an operator.
- `strategies/` — the pluggable strategy set (see `docs/strategies.md`).
- `indicators.ts` — EMA, SMA, RSI, ATR implemented on close arrays / candle arrays.

### `execution/` — routing & live safety

- `ExecutionRouter` — implements `ExecutionBroker` and sits on every order submission. Selects the paper broker or the live venue adapter based on the runtime profile, and rejects with `NO_LIVE_EXECUTION_ADAPTER` when the profile demands real orders but no adapter is usable.
- `LiveTradingGuard` — arm-state and safe-mode enforcement.

### `trading/` — intent, risk & goals

- `TradeIntentEngine` — translates an execution plan into a `TradeSignal`, applying duplicate and cooldown rules, then `RiskEngine`.
- `risk/RiskEngine` — daily loss, open-position, per-symbol, and account-risk limits; position sizing; profit-goal halt and risk multiplier.
- `risk/TrailingStopManager` — pure calculation of where a stop should sit given the best favourable price.
- `risk/TrailingStopController` — turns that calculation into broker state. Stops are resting reduce-only STOP_MARKET orders, so trailing means cancel-and-replace; the replacement is submitted **before** the original is cancelled so the position is never left unprotected.
- `goals/ProfitGoalManager` + `ProfitGoalStore` — daily/weekly/monthly targets, cooldowns, risk multiplier, persisted across restarts and reset on calendar boundaries by `Scheduler`.

### `scheduler/` — periodic jobs

- 1s — mark stale markets; write 1s market ticks.
- 1m — account snapshots; (cron) daily rollover.
- 5s — signal expiry; funding application (per-symbol, deduplicated via `nextFundingTimeUtc`).
- cron `0 0 * * *` / `0 0 * * 1` / `0 0 1 * *` — profit-goal daily / weekly / monthly window resets, rebasing on current equity.

### `persistence/` — durable state

- `db.ts` — `DatabaseManager`: opens `paper.sqlite3` (WAL mode), owns the core schema and the `SignalRepository`.
- `EventLog.ts` — append-only order/fill/position/account/funding/risk/system events → `events` table + `events.jsonl`.
- `BrokerPersister.ts` — UPSERTs live `orders` / `fills` / `positions` rows from broker transitions.
- `SnapshotStore.ts` — periodic account snapshots and market ticks.

### `api/` — interface

Fastify server exposing the REST API, Prometheus metrics, and engine lifecycle endpoints. It reads broker memory and the signal repository; it never mutates trading state directly (except by calling broker/engine methods).

### `ai/` — multi-agent pipeline

`TradingAgentsPipeline` wraps `@nemesis-oss/ollama-sdk` (local daemon plus an optional cloud key pool with failover) and runs a seven-stage cycle.

**LLM-backed stages:** analyst team, bull/bear debate researchers, debate verdict, trader decision.

**Deterministic stages:** risk team and fund manager. These are policy code, not model calls, and deliberately so — CONTRACTS.md §5 forbids the LLM from overriding risk checks. The risk team evaluates SAFE/NEUTRAL/RISKY personas against configured leverage, size and confidence ceilings, rejects missing or wrong-side stops, and limits size to free margin. The fund manager takes the most conservative surviving values and blocks on any single persona rejection.

Every emitted `AgentCycleStep` carries `engine: 'llm' | 'deterministic'` so no consumer can present policy code as model output.

The pipeline's authority is **advisory**: `smc-agent.ts` discards the cycle unless the agent direction matches a candidate the deterministic SMC engine already produced. The LLM cannot originate a trade, choose a symbol, set a stop, or size a position.

## Target 4-Plane Platform Architecture (ADR 0003)

```text
                    ┌──────────────────────┐
                    │    CONTROL PLANE     │
                    │                      │
                    │ React Dashboard      │
                    │ Telegram Bot         │
                    │ Operational CLI      │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │     TRADING API      │
                    │   Fastify REST + WS  │
                    └──────────┬───────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│ OBSERVABILITY│       │ TRADING CORE │       │ AGENT PLANE  │
│              │       │              │       │              │
│ EventLog     │       │ Strategy     │       │ Ollama SDK   │
│ Metrics      │       │ Risk Engine  │       │ MCP Tools    │
│ Incidents    │       │ Exec Router  │       │ Reasoning    │
└──────────────┘       └───────┬──────┘       └──────────────┘
                               │
                     ┌─────────┼─────────┐
                     ▼         ▼         ▼
                  Binance   CoinDCX   Paper
```

## Target Monorepo Packages

```text
trading-system/
├── apps/
│   ├── engine/              # Trading runtime composition root
│   ├── api/                 # Fastify REST + WebSocket gateway
│   └── dashboard/           # React + TypeScript frontend
│
├── packages/
│   ├── binance-adapter/     # Binance WS/REST normalization
│   ├── coindcx-adapter/     # CoinDCX WS/REST & execution
│   ├── paper-broker/        # Deterministic paper broker
│   ├── execution/           # Unified ExecutionRouter & broker interface
│   ├── risk/                # RiskEngine & LiveTradingGuard
│   ├── strategy/            # SMC market structure & setup engines
│   ├── agent/               # Ollama agent & MCP tool integration
│   ├── event-bus/           # Typed canonical domain events
│   ├── observability/       # Metrics, Incident pipeline & telemetry
│   ├── notifications/       # Telegram & webhook alerts
│   └── shared/              # Common domain types & utilities
```

## Persistence model

- **Source of truth for history**: the `events` table + `events.jsonl` (append-only, never mutated).
- **Queryable state**: `orders`, `fills`, `positions` — UPSERTed mirrors maintained by `BrokerPersister`.
- **Time series**: `account_snapshots`, `market_ticks_1s`, `klines_1m`.
- **Application state**: `signals`, `strategies`, `system_events`, `risk_events`, `funding_payments`, `wallets`, `ledger_entries`, `ai_inferences`.

All timestamps are epoch-millisecond integers (UTC) or ISO-8601 UTC strings; monetary values are decimal strings in the database and `decimal.js` `Decimal` values during computation.

## Consistency rules

- Timestamps: epoch ms UTC integers; ISO-8601 UTC strings for persistence.
- Money: `decimal.js` for arithmetic; decimal strings in DB; never float comparison for money.
- Strategy signals: validated against `SignalActionSchema` (BUY/SELL/HOLD/CANCEL_ALL) with conflict and expiry rules before execution.