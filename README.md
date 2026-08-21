# paper-broker

Crypto **futures paper trading engine** powered by live Binance market data. It streams real-time order books and klines from Binance Futures (testnet by default), simulates a USDT-margined futures account with realistic fills, fees, slippage and funding, runs a pluggable set of trading strategies, and persists every event to SQLite as an audit-trail event log.

No real money is ever at risk — all execution is simulated by the `PaperBroker`, which reproduces exchange semantics (fees, mark-price funding, reduce-only rules, leverage, liquidation checks, order brackets).

---

## Features

- **Real-Time Web Dashboard** — built-in interactive control console at `http://localhost:8080/` with TradingView Lightweight Charts, live position monitor, setup radar, provider matrix, and emergency kill-switch.
- **WebSocket Streaming Gateway** — push streaming at `ws://localhost:8080/ws` for live ticks, order updates, position PnL, incident alerts, and mode changes.
- **Multi-Feed Market Supervisor** — concurrent Binance (primary) and CoinDCX (fallback) feeds with latency tracking, staleness detection, and cross-exchange price divergence guards.
- **Paper, Shadow & Live Modes** — single-flag profile resolution (`TRADING_MODE=paper|shadow|live`) with two-step live arming (`LiveTradingGuard`) and venue execution routing (`ExecutionRouter` $\to$ `CoinDCXBroker`).
- **Realistic paper execution** — taker/maker fees, slippage (bps), funding payments, reduce-only enforcement, min-notional, max-leverage, max-position risk limits.
- **Incident Error Pipeline & Telegram Alerts** — centralized error normalization with incident IDs (`INC-YYYYMMDD-XXXXX`), deduplication, and Telegram notifications.
- **Event-sourced persistence** — every order, fill, position, funding and system event is appended to a SQLite WAL database **and** a JSONL stream; relational `orders` / `fills` / `positions` tables are kept in sync for querying.
- **7 built-in strategies** — EMA trend, Bollinger/ATR breakout, RSI mean reversion, momentum, grid, mean reversion, and an Ollama-driven LLM trend strategy (auto-enabled when Ollama is reachable).
- **Docker Background Deployment** — multi-stage Alpine image + `docker-compose` with persistent data volumes.

---

## Quickstart

```bash
pnpm install          # requires Node 22+ and pnpm
cp .env.example .env  # set TRADING_MODE=paper|shadow|live
pnpm db:init          # create the SQLite schema (data/paper.sqlite3)
pnpm build
pnpm start            # API and Dashboard on http://localhost:8080
```

Open your browser and navigate to:
```text
http://localhost:8080/
```

---

## Docker Background Deployment

```bash
# Start container in background
pnpm docker:up
# or: docker-compose up -d

# View live stream logs
docker-compose logs -f

# Check container status
docker ps

# Stop background container
pnpm docker:down
# or: docker-compose down
```

---

## Scripts

| Script | Description |
| --- | --- |
| `pnpm build` | Type-check and compile `src/` → `dist/` |
| `pnpm start` | Run the compiled engine |
| `pnpm dev` | Watch-mode development (`tsx watch`) |
| `pnpm lint` | ESLint over `src/` |
| `pnpm test` | Vitest unit tests (100 tests across 17 suites) |
| `pnpm verify:complete` | Canonical 7-step full verification suite |
| `pnpm db:init` | Create/upgrade the SQLite schema |
| `pnpm cli` | Run `dist/cli.js` |
| `pnpm paper:trade` | Interactive CLI trading loop |
| `pnpm paper:monitor` | Live stream of system events |
| `pnpm docker:up` | Start background Docker container (`docker-compose up -d`) |
| `pnpm docker:down` | Stop background Docker container (`docker-compose down`) |

---

## REST & WebSocket API

Base URL `http://localhost:8080`. Full reference: [`docs/api.md`](docs/api.md).

| Method | Path | Description |
| --- | --- | --- |
| GET | `/` or `/dashboard` | Built-in Real-Time Web Trading Dashboard |
| GET | `/ws` | WebSocket event stream (`market.tick`, `order.updated`, `position.updated`, etc.) |
| GET | `/api/v1/dashboard` | Consolidated operational snapshot (mode, account, positions, health, incidents) |
| GET | `/api/v1/health/providers` | Binance & CoinDCX latency and status matrix |
| GET | `/api/v1/incidents` | Incident reports stream |
| POST | `/api/v1/mode/arm` | Arm live trading mode |
| GET | `/health` | Liveness + uptime |
| GET | `/account` | Wallet balance, equity, fees, daily P&L |
| GET | `/positions` | Open positions |
| GET | `/orders?symbol=` | Open orders (optionally filtered by symbol) |
| GET | `/metrics` | Prometheus metrics |
| POST | `/orders` | Submit an order (passes through Risk Engine) |
| POST | `/orders/cancel` | Cancel one order by id |
| POST | `/orders/cancel-all` | Cancel all orders |
| POST | `/engine/kill-switch` | Emergency kill-switch (cancels orders + stops engine) |

---

## Project Layout

```text
src/
  ai/            Ollama LLM signal generator
  api/           Fastify server, routes, WebSocketGateway, dashboardHtml
  binance/       Binance SDK wiring, stream subscriptions, normalizers
  broker/        PaperBroker + execution interfaces & domain types
  coindcx/       CoinDCXBroker live execution adapter
  config/        Environment parsing, symbol mapping, ModeResolver
  execution/     ExecutionRouter, LiveTradingGuard
  market/        MarketStateManager, CandleBuilder, KlineStore
    supervisor/  MarketDataSupervisor, ProviderHealthManager, DivergenceGuard
  notifications/ TelegramNotifier, ErrorNormalizer incident pipeline
  persistence/   DatabaseManager, EventLog, SnapshotStore, BrokerPersister
  scheduler/     Periodic jobs (funding, snapshots, staleness, signals)
  strategy/      StrategyEngine, SignalExecutor, indicators, strategies/
  telemetry/     Prometheus metrics and logger
```