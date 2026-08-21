# paper-broker TODO List

*Generated from E2E reconciliation session (2026-08-20). Prioritized by impact.*

---

## ✅ Already Done (from reconciliation session)

- [x] **Fill audit bug fixed** — `positionQtyBefore/After` captured after mutation; now snapshotted before.
- [x] **Per-position fee tracking** — `position.totalFees` now accumulates per fill.
- [x] **Momentum exit logic** — added CLOSE_LONG/CLOSE_SHORT when premium flips.
- [x] **4 regression tests added** — fill before/after, position fees, momentum close both sides.
- [x] **Build clean, lint 0 errors, 50/50 tests pass**.
- [x] **SOLUSDT 4-trade E2E reconciliation** — all math exact (wallet, fees, PnL, DB vs API, events).

---

## 🔴 High Priority

### TODO-1: Investigate transient 11-open-orders ✅ DONE
**Resolution:** Transient race between MARKET order reception and instant fill. `getOpenOrders()` counts `NEW || PARTIALLY_FILLED`; a MARKET order can be briefly visible before atomic fill. Not reproducible, no double-count bug found. Current state and DB consistently show 10 grid orders.

### TODO-2: Ported strategies only trade one hardcoded symbol ✅ DONE
**Fixed:** `momentum-5m.ts`, `grid-15m.ts`, `mean-reversion-5m.ts` now iterate over `options.symbols` (passed from engine via `SYMBOLS` env). Each strategy maintains per-symbol state:
- `momentum`: per-symbol cooldown + premium tracking, emits OPEN/CLOSE per symbol.
- `grid`: per-symbol ladder state in `Map`, re-arms on fills/cancellations/price drift.
- `mean-reversion`: per-symbol cooldown + Bollinger band calculation.
**Verified:** Build clean, lint 0 errors, 50/50 tests pass.

### TODO-9: Initial git commit
**Status:** Repo is `git init` + `.gitignore` ready, but **uncommitted** (per policy — needs explicit user approval).
- [ ] Ask user for commit approval.
- [ ] Commit with message: "paper-broker: production paper trading engine with Binance testnet, event-sourced SQLite, 7 strategies, REST API, Docker".

---

## 🟡 Medium Priority

### TODO-3: Grid ladder never re-arms after fills/cancellations ✅ DONE
**Fixed in `grid-15m.ts`:** Per-symbol `Map<string, GridSymbolState>` tracks `ordersPlaced` and `lastMidPrice`. On each 15m close:
- Checks open grid orders for that symbol; if fewer than expected (`2 × gridLevels`), re-places missing.
- Re-places if mid price moved > `gridSpacing` from `lastMidPrice`.
- Uses `postOnly` LIMIT orders; respects risk limit via `maxOpenOrders` in broker.

### TODO-4: Real backtesting via `paper:backtest` CLI ✅ DONE
**Implemented:** `src/backtest/BacktestRunner.ts` + CLI command `paper:backtest`.
- Loads `klines_1m` from SQLite, builds 5m/15m candles.
- Replays each 1m bar through `PaperBroker` + `StrategyEngine` (all 7 strategies).
- Computes: equity curve, total return, max drawdown, Sharpe, win rate, profit factor, per-strategy PnL attribution.
- CLI: `pnpm paper:backtest --start=YYYY-MM-DD --end=YYYY-MM-DD --strategies=all|ema-trend,breakout,...`
- **Verified:** Build clean, 50/50 tests pass, CLI runs and produces metrics output.
- **Note:** Requires `klines_1m` populated (run live engine to collect, or backfill via Binance REST).

---

## 🟢 Low Priority (nice-to-have)

### TODO-5: Strategy performance dashboard
- Equity curve from `account_snapshots` + `fills` + `events`.
- Per-strategy PnL attribution (join `signals` → `orders` → `fills` → `strategies`).
- Web UI (Fastify + static) or TUI (Ratatui/TTY).

### TODO-6: Alerting
- Telegram/webhook on: fills, signal acceptance/rejection, kill-switch, daily PnL summary.

### TODO-7: Long-run 24/7 testnet data collection
- Deploy via Docker, run weeks on testnet.
- Mine accumulated `market_ticks_1s`, `klines_1m`, `events` for analysis.

### TODO-8: More AI strategies
- Ollama multi-model consensus (multiple models vote).
- News/RSI hybrid (fetch headlines → LLM sentiment → blend with technical).

---

## Notes / Known Oddities

- **Zombie `node dist/boot.js` (PID 357486)** — leftover from pre-consolidation; non-root-owned, port-free, harmless.
- **Funding cycle** — 8h schedule, `nextFundingTimeUtc` in future; not yet fired in test runs. Verify when it triggers.
- **Ollama strategy** — auto-registers only when `OllamaSignalGenerator.ping()` succeeds (model loaded in Ollama).
- **`paper-exchange.md`** — 8k-line original design spec, kept for reference.