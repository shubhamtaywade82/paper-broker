# Configuration Reference

All configuration is environment-driven. Copy `.env.example` to `.env` and adjust. The engine reads `process.env` at startup via `src/config/env.ts`; invalid or missing values fall back to defaults.

## Server

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` / `production` |
| `PORT` | `8080` | HTTP API port |
| `LOG_LEVEL` | `info` | pino log level (`trace` … `fatal`) |

## Binance

| Variable | Default | Description |
| --- | --- | --- |
| `BINANCE_ENV` | `testnet` | `testnet` (paper streams) or `mainnet` (live streams) |
| `BINANCE_API_KEY` | — | API key. Optional — enables authenticated bootstrap (exchange info, account) |
| `BINANCE_API_SECRET` | — | API secret. Optional |

Without credentials the engine logs a warning, uses default instrument definitions and subscribes to the configured symbols on the testnet feed. **Binance keys are only ever used for reading market data.** Order execution is either `PaperBroker` (in-memory simulation) or, in an armed live profile, `CoinDCXBroker` — never Binance.

## Ollama (optional)

| Variable | Default | Description |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama HTTP endpoint |
| `OLLAMA_MODEL` | `qwen3.5:2b` | Local model id used by the agent pipeline |
| `OLLAMA_API_KEY_1` … `_3` | — | Optional Ollama Cloud account keys, tried in priority order before the local daemon |
| `OLLAMA_CLOUD_BASE_URL` | `https://ollama.com` | Cloud endpoint |
| `OLLAMA_CLOUD_MODEL` | `gemma4:cloud` | Cloud model id |

At startup the engine probes reachability and logs a warning if nothing responds. Startup is **not** gated: if no model is reachable, the agent debate resolves to `NEUTRAL` and the SMC strategy produces no trades. The adaptive Supertrend strategy has no LLM dependency and keeps running.

## Trading mode and live execution

| Variable | Default | Description |
| --- | --- | --- |
| `TRADING_MODE` | `paper` | `paper` / `shadow` / `live`. The single operational profile selector (CONTRACTS.md §7). |
| `LIVE_TRADING_ARMED` | `false` | Must be `true` before any order can reach a real venue. |
| `COINDCX_API_KEY` | — | Required for live execution. |
| `COINDCX_API_SECRET` | — | Required for live execution. |
| `LIVE_ARM_PASSCODE` | — | When set, `POST /api/v1/mode/arm` requires a matching passcode. |
| `API_KEY` | — | When set, control endpoints require `Authorization: Bearer <key>` or `x-api-key`. |

`TRADING_MODE=live` alone does nothing. Orders reach CoinDCX only when the mode is `live`, `LIVE_TRADING_ARMED=true`, **and** both CoinDCX credentials are present. If the profile is armed but credentials are missing, orders are rejected with `NO_LIVE_EXECUTION_ADAPTER` — the router never falls back to simulated fills while reporting live execution.

## Profit goals

Off by default. When enabled, `ProfitGoalManager` gates trading and scales position size through `RiskEngine`, and state persists to `<data>/profit_goals.json` across restarts.

| Variable | Default | Description |
| --- | --- | --- |
| `PROFIT_GOALS_ENABLED` | `false` | Master switch. |
| `PROFIT_GOAL_DAILY_TARGET_PCT` | `0.02` | Daily target as a fraction of the period's starting equity. |
| `PROFIT_GOAL_WEEKLY_TARGET_PCT` | `0.08` | Weekly target. |
| `PROFIT_GOAL_MONTHLY_TARGET_PCT` | `0.2` | Monthly target. |
| `PROFIT_GOAL_ACTION` | `REDUCE_RISK` | `REDUCE_RISK` / `STOP_TRADING` / `TRAIL_STOPS` on target achievement. |
| `PROFIT_GOAL_RISK_REDUCTION_FACTOR` | `0.5` | Risk multiplier applied under `REDUCE_RISK`. |
| `PROFIT_GOAL_COOLDOWN_MS` | `3600000` | Trading pause after a daily target is hit. |
| `PROFIT_GOAL_ENABLE_DAILY` | `true` | Set `false` to disable the daily window. |
| `PROFIT_GOAL_ENABLE_WEEKLY` | `true` | Set `false` to disable the weekly window. |
| `PROFIT_GOAL_ENABLE_MONTHLY` | `false` | Set `true` to enable the monthly window. |

Windows are reset by `Scheduler` on UTC calendar boundaries (daily 00:00, weekly Monday 00:00, monthly 1st 00:00), rebasing on current equity.

## Trailing stops

Off by default. When enabled, `TrailingStopController` cancels and replaces resting reduce-only `STOP_MARKET` orders as price moves in favour. Driven from the aggTrade stream, so a symbol with no trade prints does not trail.

| Variable | Default | Description |
| --- | --- | --- |
| `TRAILING_STOPS_ENABLED` | `false` | Master switch. |
| `TRAILING_ACTIVATION_PCT` | `0.02` | Profit required before trailing begins. |
| `TRAILING_DISTANCE_PCT` | `0.015` | Distance kept behind the best favourable price. |
| `TRAILING_BREAKEVEN_PCT` | `0.01` | Profit at which the stop moves to entry plus a fee buffer. |

## Strategy performance feedback

Observe-only by default. When enabled, a strategy breaching its limits is quarantined — `StrategyEngine` stops routing candles and ticks to it. State persists to `<data>/strategy_performance.json`; release is manual via `POST /api/v1/strategies/:id/release`.

| Variable | Default | Description |
| --- | --- | --- |
| `STRATEGY_FEEDBACK_ENABLED` | `false` | When `false` the tracker records but never quarantines. |
| `STRATEGY_FEEDBACK_MIN_TRADES` | `20` | Trades required before any quarantine rule applies. |
| `STRATEGY_FEEDBACK_MAX_DRAWDOWN_USDT` | `500` | Peak-to-trough realized drawdown that triggers quarantine. |
| `STRATEGY_FEEDBACK_MIN_WIN_RATE` | `0.3` | Win-rate floor below which a strategy is quarantined. |

## Paper account

| Variable | Default | Description |
| --- | --- | --- |
| `PAPER_STARTING_USDT` | `10000` | Initial wallet balance for the paper account |

## Persistence

All paths are resolved relative to the working directory. `DB_FILE`, `EVENT_LOG_FILE` and `SNAPSHOT_DIR` should live under the same directory (default `./data`) so they share one SQLite database.

| Variable | Default | Description |
| --- | --- | --- |
| `DB_FILE` | `./data/paper.sqlite3` | SQLite database (WAL mode) |
| `EVENT_LOG_FILE` | `./data/events.jsonl` | Append-only JSONL event stream |
| `SNAPSHOT_DIR` | `./data/snapshots` | Account snapshots + market ticks |
| `ANALYTICS_DIR` | `./data/analytics` | Reserved for analytics exports |

## Trading universe

| Variable | Default | Description |
| --- | --- | --- |
| `SYMBOLS` | `BTCUSDT,ETHUSDT,SOLUSDT` | Comma-separated symbols to subscribe & trade |
| `TIMEFRAMES` | `5m,15m` | Comma-separated candle intervals |

## Strategy tuning

### EMA Trend (`ema-trend-5m`)

| Variable | Default | Description |
| --- | --- | --- |
| `EMA_FAST_PERIOD` | `9` | Fast EMA period |
| `EMA_SLOW_PERIOD` | `21` | Slow EMA period |
| `EMA_RSI_UPPER` | `70` | RSI overbought filter |
| `EMA_RSI_LOWER` | `30` | RSI oversold filter |

### Breakout (`breakout-15m`)

| Variable | Default | Description |
| --- | --- | --- |
| `BREAKOUT_LOOKBACK` | `20` | Channel lookback candles |
| `BREAKOUT_ATR_STOP_MULT` | `2` | ATR × stop-loss distance |
| `BREAKOUT_ATR_TP_MULT` | `4` | ATR × take-profit distance |

### RSI Mean Reversion (`rsi-mean-reversion-5m`)

| Variable | Default | Description |
| --- | --- | --- |
| `RSI_OVERSOLD` | `30` | Buy below this RSI |
| `RSI_OVERBOUGHT` | `70` | Sell above this RSI |
| `RSI_NEUTRAL_HIGH` | `55` | Return to neutral below this |
| `RSI_NEUTRAL_LOW` | `45` | Return to neutral above this |

Momentum, Grid, Mean Reversion and Ollama strategies use sensible fixed defaults; override via code-level factory options if needed.

## Persistence layout (default)

```
data/
  paper.sqlite3        # SQLite WAL database
  paper.sqlite3-wal    # WAL journal (transient)
  paper.sqlite3-shm    # shared-memory index (transient)
  events.jsonl         # append-only event stream
  snapshots/           # account snapshots & market ticks
  analytics/           # reserved
```

## Database schema

Created by `pnpm db:init` (idempotent). Tables: `accounts`, `instruments`, `wallets`, `ledger_entries`, `orders`, `fills`, `positions`, `funding_payments`, `risk_events`, `signals`, `strategies`, `ai_inferences`, `system_events`, `account_snapshots`, `market_states_current`, `market_ticks_1s`, `klines_1m`, `events`.

Money columns are stored as decimal strings; timestamps as ISO-8601 UTC text or epoch-millisecond integers.