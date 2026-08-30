# paper-broker

Crypto **futures paper trading engine** powered by live Binance market data. It streams real-time order books and klines from Binance Futures (testnet by default), simulates a USDT-margined futures account with realistic fills, fees, slippage and funding, runs a pluggable set of trading strategies, and persists every event to SQLite as an audit-trail event log.

**By default no real money is at risk** — execution is simulated by the `PaperBroker`, which reproduces exchange semantics (fees, mark-price funding, reduce-only rules, leverage, liquidation checks, order brackets). A live CoinDCX execution path exists and is wired, but it is inert unless you set `TRADING_MODE=live`, `LIVE_TRADING_ARMED=true`, **and** supply CoinDCX credentials. See [Trading modes](#trading-modes).

---

## Features

- **Real-Time Web Dashboard** — built-in interactive control console at `http://localhost:8080/` with TradingView Lightweight Charts, live position monitor, setup radar, provider matrix, and emergency kill-switch.
- **WebSocket Streaming Gateway** — push streaming at `ws://localhost:8080/ws` for live ticks, order updates, position PnL, incident alerts, and mode changes.
- **Paper, Shadow & Live Modes** — single-flag profile resolution (`TRADING_MODE=paper|shadow|live`) with two-step live arming (`LiveTradingGuard`) and venue execution routing (`ExecutionRouter` → `CoinDCXBroker`). An armed live profile with no usable adapter **rejects** orders rather than silently simulating them.
- **Profit goals** — daily/weekly/monthly targets that throttle risk or halt trading once hit, persisted across restarts (opt-in via `PROFIT_GOALS_ENABLED`).
- **Trailing stops** — real cancel-and-replace on resting stop orders as price moves in favour (opt-in via `TRAILING_STOPS_ENABLED`).
- **Strategy performance feedback** — per-strategy PnL, win rate and drawdown; a strategy breaching its limits is quarantined and stops receiving candles (opt-in via `STRATEGY_FEEDBACK_ENABLED`).
- **Realistic paper execution** — taker/maker fees, slippage (bps), funding payments, reduce-only enforcement, min-notional, max-leverage, max-position risk limits.
- **Incident Error Pipeline & Telegram Alerts** — centralized error normalization with incident IDs (`INC-YYYYMMDD-XXXXX`), deduplication, and Telegram notifications.
- **Event-sourced persistence** — every order, fill, position, funding and system event is appended to a SQLite WAL database **and** a JSONL stream; relational `orders` / `fills` / `positions` tables are kept in sync for querying.
- **Two live strategies** — `smc-agent-v1` (SMC structure detection confirmed by a multi-agent LLM debate) and an adaptive Supertrend strategy with Q-learning parameter selection per market regime. The classic indicator strategies remain on disk behind `cli.ts --engine=indicators` but produce no trades; see PROJECT_STATE.md.
- **Reinforcement learning** — the adaptive Supertrend strategy learns which parameter set suits which regime from realized trade outcomes, persisted to `data/adaptive_supertrend_qtable.json`.
- **Docker Background Deployment** — multi-stage Alpine image + `docker-compose` with persistent data volumes.
- **Agentic Layer (opt-in, `feature/agentic-upgrade`)** — MCP-style read-only tool framework (`src/ai/tools/`), agent memory + self-improvement loop (`src/ai/memory/`, `src/ai/SelfImprovementLoop.ts`), per-strategy per-regime Q-learning (`StrategyParamLearner`), per-regime strategy promotion/demotion (`StrategySelector`), A/B testing skeleton (`ABTestRunner`). All features default OFF — operators opt in via `AGENT_*_ENABLED` env flags. See `.env.example` and `docs/decisions/0005-agentic-layer-upgrade.md`.

---

## Trading modes

| Mode | Execution | What it takes |
| --- | --- | --- |
| `paper` (default) | `PaperBroker` simulation | Nothing. |
| `shadow` | `PaperBroker` simulation, account treated as read-only | `TRADING_MODE=shadow`. |
| `live` | `CoinDCXBroker`, real funds | `TRADING_MODE=live` **and** `LIVE_TRADING_ARMED=true` **and** `COINDCX_API_KEY`/`COINDCX_API_SECRET`. |

Every order submission goes through `ExecutionRouter`. If the profile is armed
for live but no usable adapter is present, orders are rejected with
`NO_LIVE_EXECUTION_ADAPTER` — the router will not fall back to paper fills while
reporting live execution.

Binance credentials are used for **market data only**, never for order placement.

On startup and on every websocket reconnect, `ExchangeReconciler` compares venue
positions against local state. A mismatch — or a venue it cannot read — halts all
order submission until an operator resolves it via `POST /api/v1/reconcile`.

> The live path has never been validated against a real CoinDCX account in this
> repository. Treat it as implemented but unproven.

---

## Quickstart

```bash
pnpm install          # requires Node 22+ and pnpm
cp .env.example .env  # set TRADING_MODE=paper|shadow|live
pnpm db:init          # create the SQLite schema (data/paper.sqlite3)
pnpm build
pnpm start            # boots in AUTONOMOUS mode by default; dashboard at http://localhost:8080
```

> **Autonomous-first by default.** `pnpm start` boots the engine with the
> `AutonomousTradingAgent` driving decisions on its own 30s clock (override
> via `AUTONOMOUS_CYCLE_MS`). Candle-driven strategies remain active in
> parallel. To opt out for the legacy candle-only behaviour, use
> `pnpm paper:candle-only` or set `AUTONOMOUS_AGENT_ENABLED=false` in `.env`.

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
| `pnpm start` | **Run the compiled engine — autonomous by default** |
| `pnpm dev` | Watch-mode development (`tsx watch`) — autonomous by default |
| `pnpm lint` | ESLint over `src/` |
| `pnpm test` | Vitest unit tests (100 tests across 17 suites) |
| `pnpm verify:complete` | Canonical 7-step full verification suite |
| `pnpm db:init` | Create/upgrade the SQLite schema |
| `pnpm cli` | Run `dist/cli.js` |
| `pnpm paper:trade` | Same as `pnpm start` via CLI (alias of `autonomous`) |
| `pnpm paper:autonomous` | Same as `pnpm start` via CLI — explicit alias |
| `pnpm paper:candle-only` | **Opt-out:** legacy candle-driven behaviour (sets `AUTONOMOUS_AGENT_ENABLED=false` for you) |
| `pnpm paper:monitor` | Live stream of Binance market data without trading |
| `pnpm paper:backtest` | Run historical SMC replay backtest |
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
| GET | `/api/v1/risk` | Live risk limits, exposure, profit-goal state, quarantined strategies |
| GET | `/api/v1/profit-goals` | Profit-goal config, state, progress and metrics |
| GET | `/api/v1/strategies/performance` | Per-strategy PnL, win rate, drawdown, quarantine state |
| POST | `/api/v1/strategies/:id/release` | Lift a strategy quarantine (operator action) |
| GET | `/api/v1/reconcile` | Last exchange reconciliation report and safe-mode state |
| POST | `/api/v1/reconcile` | Re-run reconciliation; resumes trading only if clean |
| GET | `/api/v1/agent/tools` | Tool catalog + recent tool calls (when `AGENT_TOOLS_ENABLED=true`) |
| GET | `/api/v1/agent/memory` | Top-K decay-weighted lessons (when `AGENT_MEMORY_ENABLED=true`) |
| GET | `/api/v1/agent/reflections` | Recent post-trade reflections |
| POST | `/api/v1/agent/decay` | Operator-triggered decay+prune (API key) |
| GET | `/api/v1/agent/param-learning` | Per-(strategy,regime,param) Q-table (when `AGENT_PARAM_LEARNING_ENABLED=true`) |
| GET | `/api/v1/strategy-selector` | Per-regime demoted pairs (when `AGENT_STRATEGY_SELECTOR_ENABLED=true`) |
| GET | `/api/v1/ab-tests` | A/B test instances + promoted id (when `AGENT_AB_TESTING_ENABLED=true`) |
| POST | `/api/v1/ab-tests/evaluate` | Operator-triggered promotion (API key) |
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
  ai/            TradingAgentsPipeline (multi-agent debate) + schemas
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
                 StrategyPerformanceTracker + Store (quarantine feedback loop)
  trading/       TradeIntentEngine, RiskEngine, PositionSizer
    goals/       ProfitGoalManager + Store (targets, cooldowns, risk multiplier)
    risk/        TrailingStopManager + TrailingStopController
  telemetry/     Prometheus metrics and logger
```