# Coin Screener — Design Spec

**Date:** 2026-09-05
**Status:** Approved (pending implementation plan)
**Author:** Claude Code (brainstorming session with Shubham Taywade)

## Problem

paper-broker has no way to discover trading opportunities outside its
configured `SYMBOLS` env var — a static list, unchanged since deployment. The
operator can only ever see what they already decided to watch; nothing
surfaces a coin that started performing and isn't on that list.

A sibling project (`bots/dhanhq-node`) built exactly this feature tonight for
Indian equity options — universe resolution from a live scrip master,
horizon-classified performance ranking (Swing/Short-Term/Long-Term), and a
dashboard with a background-activity log showing per-step provenance. That
build started from zero: no universe source, no candle fetcher, no
activity/provenance persistence, no dashboard pattern for any of it.

paper-broker already has all four of those. This spec is a port in the sense
of the *feature*, not the *code* — the money-math and exit-logic code being
ported is unnecessary; what's missing is purely the screener/discovery layer,
and it wires into infrastructure that already exists here.

## Goal

A coin screener that:
- Resolves its universe live from Binance (`exchangeInfo()`), not a
  hardcoded list — every USDT-M perpetual currently `TRADING`.
- Ranks coins on real price/volume performance (no fabricated
  fundamentals — there is no fundamentals feed for crypto here either,
  same constraint dhanhq-node hit and resolved the same way: don't pretend
  to have one).
- Classifies each passing coin into one or more trade horizons (SWING /
  SHORT_TERM / LONG_TERM), measured against BTCUSDT as the relative-strength
  benchmark (the crypto-native equivalent of "beating the index").
- Surfaces a live background-activity log during a scan (what's being
  fetched, what's skipped and why, real vs. placeholder data), using the
  `engine: 'llm' | 'deterministic'` provenance convention already
  established by `TradingAgentsPipeline` — this run is 100% `deterministic`,
  and says so explicitly rather than leaving it ambiguous.
- Gets its own dashboard tab, separate from the existing `research` tab
  (which is the backtest-results viewer — unrelated, confirmed by reading
  `ResearchView.tsx`).

## Non-goals

- No fundamentals/on-chain scoring inside the screener itself. The existing
  `src/ai/tools/OnChainWhaleTool`/`MacroFundingTool` remain scoped to the
  per-symbol AI analyst stage; the screener does not call them and does not
  claim any valuation judgment.
- No new database table. `EventLog`'s existing `events` table (SQLite,
  already indexed on `type`) covers both the activity feed (`SCREENER_STEP`
  events) and the persisted result (`SCREENER_RESULT` event, latest one per
  scan is the current watchlist) — no schema migration.
- No CoinDCX universe — Binance's `exchangeInfo()` is the only live universe
  source in this repo (CoinDCX has no market-data feed here at all, per
  `KNOWN_LIMITATIONS.md`'s already-documented "wired but inert" finding).
  Binance-only matches how `Klines`/candle fetching already works throughout
  the codebase.
- No changes to `PaperBroker`, `StrategyEngine`, `ExitManager`, or any
  execution path. This is a read-only discovery feature; it does not place
  orders, does not feed signals into the strategy engine, does not touch
  `CONTRACTS.md`'s execution-routing rules. A future "add a screener pick to
  `SYMBOLS`" action is explicitly out of scope — today it's manual (operator
  reads the dashboard, edits the env var themselves).
- No API authentication beyond what already exists (`requireApiKey` on
  mutating routes only, matching every other `POST` in `server.ts`).

## Architecture

### 1. Data layer — new `src/screener/` module

Three files, mirroring the shape (not the code — the underlying asset class
differs) of what was built tonight for dhanhq-node's research engine:

**`universe.ts`** — resolves the live universe:
```ts
async function resolveUniverse(client: BinanceClient): Promise<string[]>
```
Calls `client.futures.market.exchangeInfo()`, filters to
`status === 'TRADING' && contractType === 'PERPETUAL' && quoteAsset === 'USDT'`,
returns the symbol list. No caching beyond what the SDK itself does — a full
scan is not a hot path, calling it fresh each run is correct.

**`performance.ts`** — near-identical port of dhanhq-node's
`services/research/performance.ts` tonight: `return20d/60d/250d`,
`sma20/50/200`, `sma200Rising` (requires the 20-sessions-ago SMA200 to have
existed — `null` when history is too short, never assumed), `high52w`/
`low52w`, `pctFrom52wHigh`, `volatilityPct`, `avgTradedValue` (from the
candles' own volume field — no separate ticker/24hr-stats call needed),
`relativeStrength60d/250d` vs BTCUSDT. `classifyHorizons()` and
`performanceScore()` port with no material change — the math is asset-class
agnostic; only the benchmark symbol (`BTCUSDT` instead of `NIFTY`) and the
default candle interval (`1d`, same as before) differ.

**`screener.ts`** — orchestrates: for each universe symbol, fetch candles via
**the already-existing** `KlineStore.fetchHistoricalKlines(symbol, '1d', 400)`
(no new candle-fetch code — this function already exists and is already used
by `/api/v1/klines`), compute performance, classify, score. Liquidity gate:
same shape as dhanhq-node's ₹5cr-equivalent rule, expressed here as a
concrete default — $1,000,000 average daily notional (from the candles' own
volume × close, no separate endpoint call), a named constant so it can be
tuned without touching the filter logic itself. Reports progress via an
`onProgress(message: string)` callback, same pattern as tonight's build.

Tonight's build surfaced two real bugs by actually running this against live
data before calling it done — a benchmark-fetch failure silently nulling
every relative-strength number, and a swallowed-exception path making a
rate-limited fetch indistinguishable from "this coin has no history." The
implementation plan must include the same live-data verification pass
before this is considered complete, not just unit tests against fakes.

### 2. Activity/provenance — reuse `EventLog`, add no new persistence primitive

Every screener step calls the existing `EventLog.append()`:
```ts
eventLog.append('SCREENER_STEP', { message, engine: 'deterministic' },
  { aggregateType: 'screener' });
```
This is the exact same table and the exact same `engine` tag convention
`TradingAgentsPipeline` already uses for `AGENT_STEP` — no new concept
introduced, no new column, no new index. `GET /api/v1/agents/steps` already
demonstrates the read pattern (`getEvents({ type, limit })`); the screener's
API layer (§3) does the same query against `type: 'SCREENER_STEP'`.

The completed scan itself is one more event: `SCREENER_RESULT`, payload =
the full candidate list + universe/preset/timestamp. "Current watchlist" is
simply the most recent `SCREENER_RESULT` event (`getEvents({ type:
'SCREENER_RESULT', limit: 1 })`) — no separate watchlist table, no
expiry/TTL logic to get wrong (dhanhq-node's build had a 30-day TTL column
that briefly caused stale-test-fixture confusion tonight; this design avoids
that entire class of bug by not persisting a mutable "current state" row at
all — every scan is an immutable append, "current" is just "latest").

### 3. API — new routes in `server.ts`

- `POST /api/v1/screener/run` — no body needed. Triggers a full-universe
  scan, `preHandler: this.requireApiKey` (matches every other mutating
  route). No preset parameter: unlike dhanhq-node (which kept four presets
  as a holdover from an older fundamentals-based screener with real API
  callers to stay compatible with), this is a clean-slate build with no
  legacy shape to preserve. Every candidate gets full performance metrics
  and every applicable horizon tag in one pass; "pass" is simply "qualifies
  for at least one horizon." The dashboard groups by horizon (§4) — no
  preset selector needed to drive that.
  Returns the `SCREENER_RESULT` payload directly (synchronous — a full
  universe scan is tens of seconds, not instant, but this repo's existing
  `POST /api/v1/agents/cycle` pattern is also synchronous-request/eventual
  streamed-progress-via-activity-feed, so this matches precedent rather than
  introducing a job-queue concept that doesn't exist elsewhere here).
- `GET /api/v1/screener/watchlist` — latest `SCREENER_RESULT`, no auth (read
  path, matches `/api/v1/activity`, `/api/v1/agents/steps`).
- `GET /api/v1/screener/activity` — thin wrapper over `getEvents({ type:
  'SCREENER_STEP', limit })`, mirroring `/api/v1/agents/steps` exactly.

### 4. Dashboard — new tab

`WorkspaceTab` (`dashboard/src/store/useStore.ts`) gains `'screener'`.
`App.tsx` gains one more `activeTab === 'screener' && <ScreenerView />` line,
following the exact pattern of every existing tab. `ScreenerView.tsx`
(`dashboard/src/components/screener/`) follows `ActivityView.tsx`'s
established page-shell (react-query for data fetching, same layout/styling
conventions) — three horizon-grouped columns (Swing / Short-Term /
Long-Term), a "Run Scan" button, and an embedded activity log reusing
whatever shared component the existing agent-steps display uses (checked in
the implementation plan, not invented fresh here if one already exists).

## Testing

- `test/unit/screener/` — unit tests for `performance.ts`/`classifyHorizons`/
  `performanceScore` against synthetic deterministic price series (same
  technique as tonight: `series(days, start, dailyPct)` helper generating a
  controlled compounding series), matching the existing `vitest` conventions
  in this repo (see `test/unit/PaperBroker.test.ts` for style).
- `test/unit/screener/universe.test.ts` — a fake `BinanceClient` exercising
  the filter logic (TRADING/PERPETUAL/USDT only), matching the
  `resolveInstruments` test pattern just added in
  `test/unit/ResolveInstruments.test.ts`.
- A live verification pass (throwaway script, deleted after, same pattern as
  tonight's `tmp-lifecycle-verify.ts`) running a real scan against live
  Binance data before this is considered done — this is where tonight's two
  real bugs were actually found, unit tests against fakes did not catch
  either one.

## Open questions for the implementation plan

- Exact shared component (if any) for rendering an activity/step feed in the
  dashboard already — check `AgentActivityToasts.tsx` and whatever renders
  `/api/v1/agents/steps` today before writing a new one.
- Candle interval: this spec assumes daily (`1d`) candles for the
  20d/60d/250d return windows, matching dhanhq-node's convention exactly.
  Confirm `KlineStore.fetchHistoricalKlines` accepts `'1d'` as a valid
  interval string (Binance's own kline endpoint does; the SDK wrapper should
  pass it through unchanged, but verify against the live API in the
  implementation pass rather than assuming).
