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

### TODO-1: Investigate transient 11-open-orders
**Observation:** During SOLUSDT run, `openOrdersCount` showed 11 once while grid ladder is 10 orders. Current state and DB show exactly 10 open orders; likely a transient NEW/PARTIALLY_FILLED moment during a fill read, or grid re-arm overlap.
- [ ] Read `grid-15m.ts` fully — understand re-arm logic and when it cancels vs places.
- [ ] Check `getOpenOrders()` counting: counts `NEW || PARTIALLY_FILLED`.
- [ ] Reproduce by running engine + spamming `/account` while grid places/cancels.
- [ ] Fix if it's a real bug (double-count or missed cancel).

### TODO-2: Ported strategies only trade one hardcoded symbol
**Affected:** `momentum-5m.ts`, `grid-15m.ts`, `mean-reversion-5m.ts`
- Each filters `if (candle.symbol !== targetSymbol) return null` with hardcoded default (`SOLUSDT`, `SOLUSDT`, `ETHUSDT`).
- Engine passes `symbols` (from `SYMBOLS` env) to each factory, but the filter ignores it.
- **Fix:** Make each strategy iterate over `options.symbols` (or the strategy's `symbols` field) and emit signals for any matching candle.
  - `momentum`: track last-premium per symbol, emit OPEN/CLOSE per symbol.
  - `grid`: per-symbol ladder state; place 10 orders per active symbol (respect `maxOpenOrders` risk limit).
  - `mean-reversion`: per-symbol Bollinger band state, emit per symbol.

### TODO-9: Initial git commit
**Status:** Repo is `git init` + `.gitignore` ready, but **uncommitted** (per policy — needs explicit user approval).
- [ ] Ask user for commit approval.
- [ ] Commit with message: "paper-broker: production paper trading engine with Binance testnet, event-sourced SQLite, 7 strategies, REST API, Docker".

---

## 🟡 Medium Priority

### TODO-3: Grid ladder never re-arms after fills/cancellations
**Current:** Grid places ladder once on 15m candle close when flat. If orders fill or get canceled, it does **not** re-place.
- [ ] Read `grid-15m.ts` fully — find re-arm trigger condition.
- [ ] Implement per-symbol ladder maintenance: on each 15m close, check open orders for that symbol; if fewer than expected levels, re-place the missing side.
- [ ] Track `placed` state per symbol (not global).

### TODO-4: Real backtesting via `paper:backtest` CLI
**Current:** CLI stub prints a message.
- [ ] Build a backtester that replays `klines_1m` through `PaperBroker` + strategies.
- [ ] Output: equity curve, trades, fees, win/loss per strategy, max drawdown, Sharpe.
- [ ] Accept date range, symbols, strategies, risk params.

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