# paper-broker

Crypto **futures paper trading engine** powered by live Binance market data. It streams real-time order books and klines from Binance Futures (testnet by default), simulates a USDT-margined futures account with realistic fills, fees, slippage and funding, runs a pluggable set of trading strategies, and persists every event to SQLite as an audit-trail event log.

No real money is ever at risk — all execution is simulated by the `PaperBroker`, which reproduces exchange semantics (fees, mark-price funding, reduce-only rules, leverage, liquidation checks, order brackets).

---

## Features

- **Live market data** — Binance Futures WebSocket streams (bookTicker, markPrice, klines) via `@nemesis-oss/binance-sdk`.
- **Realistic paper execution** — taker/maker fees, slippage (bps), funding payments, reduce-only enforcement, min-notional, max-leverage, max-position risk limits.
- **Event-sourced persistence** — every order, fill, position, funding and system event is appended to a SQLite WAL database **and** a JSONL stream; relational `orders` / `fills` / `positions` tables are kept in sync for querying.
- **7 built-in strategies** — EMA trend, Bollinger/ATR breakout, RSI mean reversion, momentum, grid, mean reversion, and an Ollama-driven LLM trend strategy (auto-enabled when Ollama is reachable).
- **Signal pipeline** — strategies emit typed signals; a `SignalExecutor` sizes, brackets and routes them to the broker with per-strategy cooldowns and confidence rules.
- **REST API** — place/cancel orders, inspect account/positions/fills/signals, Prometheus metrics, engine start/stop/kill-switch.
- **Scheduled maintenance** — stale-market marking, 1s tick snapshots, account snapshots, funding application, signal expiry, daily rollover.
- **Docker** — multi-stage image + `docker-compose` with a persistent data volume.
- **CLI** — `trade`, `monitor`, `backtest` entry points.

---

## Quickstart

```bash
pnpm install          # requires Node 22+ and pnpm
cp .env.example .env  # defaults target Binance testnet
pnpm db:init          # create the SQLite schema (data/paper.sqlite3)
pnpm build
pnpm start            # API on http://localhost:8080
```

Ollama strategy (optional): run Ollama locally and set `OLLAMA_MODEL`; the strategy registers automatically when the model responds to a `listModels` ping.

Live Binance data: set `BINANCE_ENV=mainnet` plus `BINANCE_API_KEY` / `BINANCE_API_SECRET`. Without keys, the engine falls back to default instruments and testnet streams.

---

## Scripts

| Script | Description |
| --- | --- |
| `pnpm build` | Type-check and compile `src/` → `dist/` |
| `pnpm start` | Run the compiled engine |
| `pnpm dev` | Watch-mode development (`tsx watch`) |
| `pnpm lint` | ESLint over `src/` |
| `pnpm test` | Vitest unit tests (46 tests) |
| `pnpm test:watch` | Watch-mode tests |
| `pnpm db:init` | Create/upgrade the SQLite schema |
| `pnpm cli` | Run `dist/cli.js` |
| `pnpm paper:trade` | `tsx src/cli.ts trade` — interactive trading loop |
| `pnpm paper:monitor` | Live stream of system events |
| `pnpm paper:backtest` | Backtest stub |
| `pnpm docker:build` / `:up` / `:down` | Docker build & orchestration |

---

## REST API

Base URL `http://localhost:8080`. Full reference: [`docs/api.md`](docs/api.md).

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Liveness + uptime |
| GET | `/account` | Wallet, equity, fees, funding, daily P&L |
| GET | `/positions` | Open positions |
| GET | `/orders?symbol=` | Open orders (optionally filtered by symbol) |
| GET | `/fills` | Recent fills |
| GET | `/signals` | Recent strategy signals |
| GET | `/metrics` | Prometheus metrics |
| POST | `/orders` | Submit an order (MARKET / LIMIT / STOP_MARKET / TAKE_PROFIT_MARKET) |
| POST | `/orders/cancel` | Cancel one order by id |
| POST | `/orders/cancel-all` | Cancel all orders (optionally per symbol) |
| POST | `/engine/start` | Resume the scheduler |
| POST | `/engine/stop` | Pause the scheduler |
| POST | `/engine/kill-switch` | Cancel all orders and stop the engine |

Example order:

```bash
curl -X POST localhost:8080/orders \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"SOLUSDT","side":"BUY","type":"MARKET","quantity":1,"leverage":5}'
```

---

## Configuration

All configuration is environment-driven (`.env`). Reference: [`docs/configuration.md`](docs/configuration.md).

Key groups:

- **Server** — `NODE_ENV`, `PORT`, `LOG_LEVEL`
- **Binance** — `BINANCE_ENV` (`testnet` / `mainnet`), `BINANCE_API_KEY`, `BINANCE_API_SECRET`
- **Ollama** — `OLLAMA_BASE_URL`, `OLLAMA_MODEL`
- **Paper account** — `PAPER_STARTING_USDT`
- **Persistence** — `DB_FILE`, `EVENT_LOG_FILE`, `SNAPSHOT_DIR`, `ANALYTICS_DIR`
- **Universe** — `SYMBOLS`, `TIMEFRAMES`
- **Strategy tuning** — per-strategy periods/RSI/ATR thresholds

---

## Strategies

Strategies emit typed signals (`BUY` / `SELL` / `HOLD` / `CANCEL_ALL`) on candle close; the `SignalExecutor` handles sizing, risk and routing. Details: [`docs/strategies.md`](docs/strategies.md).

| Strategy | ID | Interval | Summary |
| --- | --- | --- | --- |
| EMA Trend | `ema-trend-5m` | 5m | EMA cross + RSI filter |
| Breakout | `breakout-15m` | 15m | ATR-bracketed channel breakout |
| RSI Mean Reversion | `rsi-mean-reversion-5m` | 5m | RSI extremes fading |
| Momentum | `momentum-5m` | 5m | Trades the last-vs-mark premium |
| Grid | `grid-15m` | 15m | Static limit-order ladder |
| Mean Reversion | `mean-reversion-5m` | 5m | Bollinger-band fade of mark price |
| Ollama Trend | `ollama-trend-5m` | 5m | LLM-scored trend confirmation |

---

## Architecture

Single-process modular monolith. The core invariants:

- **Only `PaperBroker` mutates state** — strategies, the signal executor and the scheduler never touch account/position/order state directly.
- **Market data owns price truth** — all fills are priced off the current market state.
- **Strategies own signals** — the engine routes signals to the signal executor; it never re-interprets strategy intent.
- **The database owns audit** — every state transition is appended to the event log; the broker memory is live state, the DB is the persistent history.

Components: `broker/`, `market/`, `strategy/`, `scheduler/`, `persistence/`, `api/`, `binance/`, `ai/`, `telemetry/`. See [`docs/architecture.md`](docs/architecture.md).

The original 8k-line design specification lives in [`paper-exchange.md`](paper-exchange.md).

---

## Testing

```bash
pnpm test
```

46 unit tests across 4 suites:

- `PaperBroker` — balance math, market rejection, fill/pnL accounting, reduce-only & notional enforcement, limits, cancellation, funding, event emission.
- `StrategyEngine` — signal validation, cooldowns, confidence, expiry, sizing, order factory, indicators.
- `SignalExecutor` — signal-to-order routing, brackets, status bookkeeping.
- `PortedStrategies` — the ported legacy strategies against the candle-close interface.

---

## Docker

```bash
pnpm docker:build
pnpm docker:up      # exposes :8080, persists ./data
```

The multi-stage image builds TypeScript in one stage and copies the compiled output plus a prebuilt `better-sqlite3` native binding into a slim Node 22 Alpine runtime.

---

## Project layout

```
src/
  ai/            Ollama signal generator
  api/           Fastify server + routes
  binance/       Binance SDK wiring, stream subscription, normalizers
  broker/        PaperBroker + order/fill/position/account domain types
  cli.ts         trade / monitor / backtest commands
  config/        environment parsing
  engine.ts      composition root (startEngine)
  index.ts       process entry point
  market/        market state manager, candle builder, kline store
  persistence/   DatabaseManager, EventLog, SnapshotStore, BrokerPersister
  scheduler/     periodic jobs (funding, snapshots, staleness, signals)
  strategy/      StrategyEngine, SignalExecutor, indicators, strategies/
  telemetry/     Prometheus metrics
scripts/         init-db, maintenance helpers
test/            vitest unit tests
```