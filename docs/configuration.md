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

Without credentials the engine logs a warning, uses default instrument definitions and subscribes to the configured symbols on the testnet feed. **Live keys are only for reading market data, never for placing real orders** — `PaperBroker` is entirely in-memory simulation.

## Ollama (optional)

| Variable | Default | Description |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama HTTP endpoint |
| `OLLAMA_MODEL` | `qwen2.5:7b` | Model id used by `ollama-trend-5m` |

At startup the engine pings the model (`listModels`). If it responds, the Ollama strategy registers; otherwise it is skipped with a warning. The strategy never runs without a reachable model.

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