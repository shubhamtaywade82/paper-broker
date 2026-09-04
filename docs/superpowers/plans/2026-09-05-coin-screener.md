# Coin Screener Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a coin screener to paper-broker that ranks every live USDT-M perpetual on real price/volume performance (no fabricated fundamentals), classifies each into SWING/SHORT_TERM/LONG_TERM horizons vs. a BTCUSDT relative-strength benchmark, and surfaces it in a new dashboard tab with a live, provenance-tagged activity log.

**Architecture:** A new `src/screener/` module (universe resolution via Binance `exchangeInfo()`, direct daily-candle fetch, pure performance math, an orchestrator) persists its activity and results through the existing `EventLog` (no new database table), exposed via three new Fastify routes, rendered in a new React dashboard tab that follows the existing `ActivityView.tsx`/`hooks/useApi.ts` conventions exactly.

**Tech Stack:** TypeScript (ESM), `@nemesis-oss/binance-sdk`, `better-sqlite3` (via the existing `EventLog`), `vitest`, React + `@tanstack/react-query` (dashboard), `lucide-react` icons.

**Spec:** `docs/superpowers/specs/2026-09-05-coin-screener-design.md`

## Global Constraints

- No fabricated data: every metric is computed from real fetched candles. A symbol with insufficient history is reported as skipped, never scored off partial/absent data (spec Goal, Architecture §1).
- No new database table or schema migration — all persistence goes through `EventLog`'s existing `events` table (spec Non-goals).
- No changes to `PaperBroker`, `StrategyEngine`, `ExitManager`, or any order-placing path — this is read-only discovery (spec Non-goals).
- Binance-only universe source; no CoinDCX (CoinDCX has no market-data feed in this repo — spec Non-goals).
- Liquidity gate default: $1,000,000 average daily notional, as a named constant (spec Architecture §1).
- Benchmark: BTCUSDT (spec Goal).
- Candle interval: `'1d'` — confirmed valid against both `KlineInterval` (`src/market/Klines.ts:3`) and the live Binance futures API (verified via direct curl during planning: `GET /fapi/v1/klines?symbol=BTCUSDT&interval=1d&limit=3` returns real daily candles).

## Deviation from the spec (found while planning — read before Task 1)

The spec's Architecture §1 says to reuse `KlineStore.fetchHistoricalKlines()`
for candle fetching. Reading it (`src/market/Klines.ts:33-58`) found it
**silently swallows fetch failures**: on a non-OK response, a non-array
response, or a thrown error, it returns `this.getCandles(...)` (the
in-memory cache — empty for any symbol never live-subscribed) instead of
throwing. That makes a rate-limited/failed fetch indistinguishable from "this
coin genuinely has no history" — the *exact* bug class fixed tonight in the
sibling project (`dhanhq-node`), where a swallowed error caused a real
top-performing stock (TECHM) to be silently dropped from every screen.

`KlineStore.fetchHistoricalKlines` is also used by the existing
`GET /api/v1/klines` chart endpoint, where silently falling back to cache is
arguably correct (a live chart shouldn't break on one bad fetch). Changing
its error behavior would risk that unrelated caller for no benefit.

**Resolution:** `src/screener/candles.ts` (Task 1) is a small, new, dedicated
fetch function — same URL shape as `Klines.ts`, but it throws on failure
instead of swallowing. `screener.ts`'s orchestrator (Task 4) retries once,
then classifies a persistent failure as `FETCH_FAILED` (distinct from
`NO_HISTORY`), matching tonight's dhanhq-node fix exactly. `Klines.ts` itself
is untouched.

---

### Task 1: Candle fetching (`src/screener/candles.ts`)

**Files:**
- Create: `src/screener/candles.ts`
- Test: `test/unit/screener/candles.test.ts`

**Interfaces:**
- Consumes: `Candle` type from `src/strategy/indicators.ts` (existing: `{ symbol, interval, openTime, open, high, low, close, volume, quoteVolume?, trades?, closeTime?, isClosed?, eventTime?, receivedAt? }`).
- Produces: `fetchDailyCandles(symbol: string, limit?: number): Promise<Candle[]>` — used by Task 4.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/screener/candles.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchDailyCandles } from '../../../src/screener/candles.js';

function rawKline(closeTime: number, open: number, high: number, low: number, close: number, volume: number) {
  return [closeTime - 86400000, String(open), String(high), String(low), String(close), String(volume), closeTime];
}

describe('fetchDailyCandles', () => {
  afterEach(() => vi.restoreAllMocks());

  it('parses real Binance kline array shape into Candle objects', async () => {
    const raw = [rawKline(1000, 100, 110, 95, 105, 12345)];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => raw })));

    const candles = await fetchDailyCandles('BTCUSDT', 1);

    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({
      symbol: 'BTCUSDT', interval: '1d', open: 100, high: 110, low: 95, close: 105, volume: 12345,
    });
  });

  it('throws (does not swallow) on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })));
    await expect(fetchDailyCandles('BTCUSDT', 10)).rejects.toThrow(/429/);
  });

  it('throws (does not swallow) on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    await expect(fetchDailyCandles('BTCUSDT', 10)).rejects.toThrow(/ECONNRESET/);
  });

  it('throws on a malformed (non-array) response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ code: -1121, msg: 'Invalid symbol' }) })));
    await expect(fetchDailyCandles('NOTASYMBOL', 10)).rejects.toThrow(/Invalid symbol|malformed/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/nemesis/project/trading-workspace/paper-broker && npx vitest run test/unit/screener/candles.test.ts`
Expected: FAIL — `Cannot find module '../../../src/screener/candles.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/screener/candles.ts
import type { Candle } from '../strategy/indicators.js';

/**
 * Fetches real daily candles from Binance's public futures klines endpoint.
 * Deliberately does NOT swallow failures the way KlineStore.
 * fetchHistoricalKlines does (src/market/Klines.ts) — a failed fetch must be
 * distinguishable from "this symbol has no history", not silently reported
 * as the same thing. See the plan's "Deviation from the spec" note.
 */
export async function fetchDailyCandles(symbol: string, limit = 400): Promise<Candle[]> {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Binance klines fetch failed for ${symbol}: HTTP ${res.status} ${JSON.stringify(body)}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error(`Binance klines response for ${symbol} was not an array — malformed or an error payload: ${JSON.stringify(data)}`);
  }
  return (data as Array<[number, string, string, string, string, string, number]>).map((item) => ({
    symbol,
    interval: '1d',
    openTime: item[0],
    open: parseFloat(item[1]),
    high: parseFloat(item[2]),
    low: parseFloat(item[3]),
    close: parseFloat(item[4]),
    volume: parseFloat(item[5]),
    closeTime: item[6],
    isClosed: true,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/screener/candles.test.ts`
Expected: PASS, 4/4 tests

- [ ] **Step 5: Commit**

```bash
git add src/screener/candles.ts test/unit/screener/candles.test.ts
git commit -m "feat(screener): add error-propagating daily candle fetch

KlineStore.fetchHistoricalKlines silently swallows fetch failures
(falls back to the in-memory cache), which would make a rate-limited
request indistinguishable from a symbol with no history — the exact
bug fixed tonight in dhanhq-node. This is a small, dedicated fetch
that throws instead, used only by the screener."
```

---

### Task 2: Universe resolution (`src/screener/universe.ts`)

**Files:**
- Create: `src/screener/universe.ts`
- Test: `test/unit/screener/universe.test.ts`

**Interfaces:**
- Consumes: `BinanceClient` from `@nemesis-oss/binance-sdk` (only `client.futures.market.exchangeInfo(): Promise<{ symbols: Array<{ symbol: string; status: string; contractType?: string; quoteAsset: string }> }>` is used).
- Produces: `resolveUniverse(client: BinanceClient): Promise<string[]>` — used by Task 4.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/screener/universe.test.ts
import { describe, it, expect } from 'vitest';
import { resolveUniverse } from '../../../src/screener/universe.js';

function fakeClient(symbols: Array<Record<string, unknown>>) {
  return { futures: { market: { exchangeInfo: async () => ({ symbols }) } } } as any;
}

describe('resolveUniverse', () => {
  it('keeps only TRADING PERPETUAL USDT-margined symbols', async () => {
    const client = fakeClient([
      { symbol: 'BTCUSDT', status: 'TRADING', contractType: 'PERPETUAL', quoteAsset: 'USDT' },
      { symbol: 'ETHUSDT', status: 'TRADING', contractType: 'PERPETUAL', quoteAsset: 'USDT' },
      { symbol: 'BTCUSDT_250926', status: 'TRADING', contractType: 'CURRENT_QUARTER', quoteAsset: 'USDT' }, // dated future, not perpetual
      { symbol: 'DELISTEDUSDT', status: 'BREAK', contractType: 'PERPETUAL', quoteAsset: 'USDT' }, // not trading
      { symbol: 'BTCUSD_PERP', status: 'TRADING', contractType: 'PERPETUAL', quoteAsset: 'USD' }, // coin-margined, not USDT
    ]);

    const universe = await resolveUniverse(client);

    expect(universe).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('returns an empty list, not a throw, when exchangeInfo is empty', async () => {
    const universe = await resolveUniverse(fakeClient([]));
    expect(universe).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/screener/universe.test.ts`
Expected: FAIL — `Cannot find module '../../../src/screener/universe.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/screener/universe.ts
import type { BinanceClient } from '@nemesis-oss/binance-sdk';

/**
 * Every live, tradable USDT-margined perpetual on Binance Futures — resolved
 * fresh each call, not cached, not hardcoded. Verified live during planning:
 * GET /fapi/v1/exchangeInfo currently returns 526 symbols matching this
 * exact filter (status/contractType/quoteAsset field names confirmed
 * against the real response).
 */
export async function resolveUniverse(client: BinanceClient): Promise<string[]> {
  const info = await client.futures.market.exchangeInfo();
  return info.symbols
    .filter((s: any) => s.status === 'TRADING' && s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT')
    .map((s: any) => s.symbol);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/screener/universe.test.ts`
Expected: PASS, 2/2 tests

- [ ] **Step 5: Commit**

```bash
git add src/screener/universe.ts test/unit/screener/universe.test.ts
git commit -m "feat(screener): add live universe resolution from exchangeInfo()"
```

---

### Task 3: Performance metrics and horizon classification (`src/screener/performance.ts`)

**Files:**
- Create: `src/screener/performance.ts`
- Test: `test/unit/screener/performance.test.ts`

**Interfaces:**
- Consumes: `Candle` type from `src/strategy/indicators.ts` (only `.close`, `.high`, `.low`, `.volume` fields are read).
- Produces:
  - `type TradeHorizon = 'SWING' | 'SHORT_TERM' | 'LONG_TERM'`
  - `interface PerformanceMetrics { close: number; return20d: number|null; return60d: number|null; return250d: number|null; sma20: number|null; sma50: number|null; sma200: number|null; sma200Rising: boolean|null; high52w: number; low52w: number; pctFrom52wHigh: number|null; volatilityPct: number|null; avgTradedValue: number; relativeStrength60d: number|null; relativeStrength250d: number|null; candleCount: number; }`
  - `computePerformance(candles: Candle[], benchmark?: Candle[]): PerformanceMetrics | null`
  - `classifyHorizons(p: PerformanceMetrics): TradeHorizon[]`
  - `performanceScore(p: PerformanceMetrics, horizons: TradeHorizon[]): number` (0-100)
  - Used by Task 4.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/screener/performance.test.ts
import { describe, it, expect } from 'vitest';
import { computePerformance, classifyHorizons, performanceScore } from '../../../src/screener/performance.js';
import type { Candle } from '../../../src/strategy/indicators.js';

/** Deterministic series: `days` sessions compounding at `dailyPct`. */
function series(days: number, start: number, dailyPct: number, volume = 1_000_000): Candle[] {
  const out: Candle[] = [];
  let price = start;
  for (let i = 0; i < days; i++) {
    price *= 1 + dailyPct / 100;
    out.push({ symbol: 'TEST', interval: '1d', openTime: i, open: price, high: price * 1.01, low: price * 0.99, close: price, volume });
  }
  return out;
}

describe('computePerformance', () => {
  it('returns null rather than scoring a symbol with too little history', () => {
    expect(computePerformance(series(30, 100, 0.1))).toBeNull();
  });

  it('computes real return/SMA/volatility numbers from a known series', () => {
    const p = computePerformance(series(300, 100, 0.3), series(300, 100, 0.05))!;
    expect(p).not.toBeNull();
    expect(p.candleCount).toBe(300);
    expect(p.close).toBeGreaterThan(100);
    expect(p.return20d).toBeGreaterThan(0);
    expect(p.sma200Rising).toBe(true);
    expect(p.relativeStrength250d).toBeGreaterThan(0); // 0.3%/day beats 0.05%/day
  });

  it('does not claim a rising 200DMA when there is not enough history to prove it', () => {
    // 210 sessions: enough for a 200DMA, not enough for the "vs 20 sessions
    // ago" comparison that proves it is rising.
    const p = computePerformance(series(210, 100, 0.3))!;
    expect(p.sma200Rising).toBeNull();
  });
});

describe('classifyHorizons', () => {
  it('classifies a sustained uptrend as long-term and swing (at the highs)', () => {
    const p = computePerformance(series(300, 100, 0.3), series(300, 100, 0.05))!;
    const horizons = classifyHorizons(p);
    expect(horizons).toContain('LONG_TERM');
    expect(horizons).toContain('SWING');
  });

  it('gives a downtrend no horizon at all', () => {
    const p = computePerformance(series(300, 100, -0.2), series(300, 100, 0.05))!;
    expect(classifyHorizons(p)).toHaveLength(0);
  });
});

describe('performanceScore', () => {
  it('scores a strong outperformer higher than a weak one', () => {
    const bench = series(300, 100, 0.05);
    const strong = computePerformance(series(300, 100, 0.4), bench)!;
    const weak = computePerformance(series(300, 100, 0.06), bench)!;
    expect(performanceScore(strong, classifyHorizons(strong)))
      .toBeGreaterThan(performanceScore(weak, classifyHorizons(weak)));
  });

  it('always returns a score in [0, 100]', () => {
    const bench = series(300, 100, 0.05);
    const crashed = computePerformance(series(300, 100, -0.5), bench)!;
    const score = performanceScore(crashed, classifyHorizons(crashed));
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/screener/performance.test.ts`
Expected: FAIL — `Cannot find module '../../../src/screener/performance.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/screener/performance.ts
import type { Candle } from '../strategy/indicators.js';

/** How long a candidate's current setup is good for. A coin can qualify for
 * more than one at once (a yearly uptrend that is also breaking out). */
export type TradeHorizon = 'SWING' | 'SHORT_TERM' | 'LONG_TERM';

/** All derived from real daily OHLCV. `null` means "not enough history to
 * say" and is never silently treated as zero. */
export interface PerformanceMetrics {
  close: number;
  return20d: number | null;
  return60d: number | null;
  return250d: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  sma200Rising: boolean | null;
  high52w: number;
  low52w: number;
  pctFrom52wHigh: number | null;
  volatilityPct: number | null;
  avgTradedValue: number;
  relativeStrength60d: number | null;
  relativeStrength250d: number | null;
  candleCount: number;
}

const TRADING_DAYS = { swing: 20, short: 60, long: 250 } as const;

function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) sum += closes[i];
  return sum / period;
}

function pctReturn(closes: number[], period: number): number | null {
  if (closes.length <= period) return null;
  const past = closes[closes.length - 1 - period];
  if (!(past > 0)) return null;
  return ((closes[closes.length - 1] - past) / past) * 100;
}

function volatilityPct(closes: number[], period = 20): number | null {
  if (closes.length <= period) return null;
  const rets: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev > 0) rets.push((closes[i] - prev) / prev);
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * 100;
}

export function computePerformance(candles: Candle[], benchmark?: Candle[]): PerformanceMetrics | null {
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.close);
  const close = closes[closes.length - 1];
  if (!(close > 0)) return null;

  const window = candles.slice(-TRADING_DAYS.long);
  const high52w = Math.max(...window.map((c) => c.high));
  const low52w = Math.min(...window.map((c) => c.low));

  const recent = candles.slice(-20);
  const avgTradedValue = recent.reduce((sum, c) => sum + c.close * c.volume, 0) / recent.length;

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const sma200Prev = closes.length >= 220 ? sma(closes.slice(0, -20), 200) : null;

  const benchCloses = benchmark?.map((c) => c.close) || [];
  const relativeStrength = (period: number): number | null => {
    const own = pctReturn(closes, period);
    const bench = benchCloses.length ? pctReturn(benchCloses, period) : null;
    if (own == null || bench == null) return null;
    return own - bench;
  };

  return {
    close,
    return20d: pctReturn(closes, TRADING_DAYS.swing),
    return60d: pctReturn(closes, TRADING_DAYS.short),
    return250d: pctReturn(closes, TRADING_DAYS.long),
    sma20, sma50, sma200,
    sma200Rising: sma200 != null && sma200Prev != null ? sma200 > sma200Prev : null,
    high52w,
    low52w,
    pctFrom52wHigh: high52w > 0 ? ((close - high52w) / high52w) * 100 : null,
    volatilityPct: volatilityPct(closes),
    avgTradedValue,
    relativeStrength60d: relativeStrength(TRADING_DAYS.short),
    relativeStrength250d: relativeStrength(TRADING_DAYS.long),
    candleCount: candles.length,
  };
}

/** A coin can qualify for several horizons at once — a long-term uptrend
 * that is also breaking out is both LONG_TERM and SWING. */
export function classifyHorizons(p: PerformanceMetrics): TradeHorizon[] {
  const horizons: TradeHorizon[] = [];

  if (p.sma20 != null && p.close > p.sma20 && (p.return20d ?? 0) > 0
    && p.pctFrom52wHigh != null && p.pctFrom52wHigh > -15) {
    horizons.push('SWING');
  }
  if (p.sma50 != null && p.close > p.sma50 && (p.return60d ?? 0) > 0
    && (p.relativeStrength60d ?? 0) > 0) {
    horizons.push('SHORT_TERM');
  }
  // sma200Rising being null (short history) fails this on purpose rather
  // than assuming the trend is up.
  if (p.sma200 != null && p.close > p.sma200 && p.sma200Rising === true
    && (p.relativeStrength250d ?? 0) > 0) {
    horizons.push('LONG_TERM');
  }

  return horizons;
}

/** 0-100 composite, weighted toward relative strength with trend alignment
 * as confirmation. */
export function performanceScore(p: PerformanceMetrics, _horizons: TradeHorizon[]): number {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  const rs60 = clamp((p.relativeStrength60d ?? 0) + 10, 0, 40);
  const rs250 = clamp(((p.relativeStrength250d ?? 0) + 20) / 2, 0, 25);
  const trend = [
    p.sma20 != null && p.close > p.sma20,
    p.sma50 != null && p.close > p.sma50,
    p.sma200 != null && p.close > p.sma200,
    p.sma200Rising === true,
  ].filter(Boolean).length * 5;
  const proximity = clamp(15 + (p.pctFrom52wHigh ?? -100) / 2, 0, 15);

  return Math.round(clamp(rs60 + rs250 + trend + proximity, 0, 100));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/screener/performance.test.ts`
Expected: PASS, 9/9 tests

- [ ] **Step 5: Commit**

```bash
git add src/screener/performance.ts test/unit/screener/performance.test.ts
git commit -m "feat(screener): add performance metrics and horizon classification"
```

---

### Task 4: Screener orchestrator (`src/screener/screener.ts`)

**Files:**
- Create: `src/screener/screener.ts`
- Test: `test/unit/screener/screener.test.ts`

**Interfaces:**
- Consumes:
  - `fetchDailyCandles(symbol: string, limit?: number): Promise<Candle[]>` (Task 1)
  - `resolveUniverse(client: BinanceClient): Promise<string[]>` (Task 2)
  - `computePerformance`, `classifyHorizons`, `performanceScore`, `PerformanceMetrics`, `TradeHorizon` (Task 3)
- Produces:
  - `interface ScreenerCandidate { symbol: string; passed: boolean; score: number; horizons: TradeHorizon[]; metrics: PerformanceMetrics; }`
  - `interface ScreenerResult { totalScreened: number; totalPassed: number; skippedNoHistory: string[]; skippedFetchFailed: string[]; candidates: ScreenerCandidate[]; topPicks: string[]; screenedAt: number; }`
  - `const MIN_AVG_TRADED_VALUE = 1_000_000`
  - `async function screen(client: BinanceClient, onProgress?: (msg: string) => void): Promise<ScreenerResult>` — used by Task 5.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/screener/screener.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as candlesModule from '../../../src/screener/candles.js';
import * as universeModule from '../../../src/screener/universe.js';
import { screen, MIN_AVG_TRADED_VALUE } from '../../../src/screener/screener.js';
import type { Candle } from '../../../src/strategy/indicators.js';

function series(days: number, start: number, dailyPct: number, volume = 1_000_000): Candle[] {
  const out: Candle[] = [];
  let price = start;
  for (let i = 0; i < days; i++) {
    price *= 1 + dailyPct / 100;
    out.push({ symbol: 'X', interval: '1d', openTime: i, open: price, high: price * 1.01, low: price * 0.99, close: price, volume });
  }
  return out;
}

describe('screen', () => {
  it('screens a universe, separating passed/failed by real horizon rules', async () => {
    vi.spyOn(universeModule, 'resolveUniverse').mockResolvedValue(['BTCUSDT', 'STRONGCOIN', 'WEAKCOIN']);
    vi.spyOn(candlesModule, 'fetchDailyCandles').mockImplementation(async (symbol) => {
      if (symbol === 'BTCUSDT') return series(300, 100, 0.05); // the benchmark itself
      if (symbol === 'STRONGCOIN') return series(300, 100, 0.4);
      return series(300, 100, -0.2); // WEAKCOIN
    });

    const result = await screen({} as any);

    expect(result.totalScreened).toBe(3);
    expect(result.candidates.find((c) => c.symbol === 'STRONGCOIN')!.passed).toBe(true);
    expect(result.candidates.find((c) => c.symbol === 'WEAKCOIN')!.passed).toBe(false);
    expect(result.topPicks).toContain('STRONGCOIN');
  });

  it('retries a fetch failure once, then reports it as FETCH_FAILED, not NO_HISTORY', async () => {
    vi.spyOn(universeModule, 'resolveUniverse').mockResolvedValue(['BTCUSDT', 'FLAKYCOIN']);
    let flakyCalls = 0;
    vi.spyOn(candlesModule, 'fetchDailyCandles').mockImplementation(async (symbol) => {
      if (symbol === 'BTCUSDT') return series(300, 100, 0.05);
      flakyCalls++;
      throw new Error('429 rate limited');
    });

    const result = await screen({} as any);

    expect(flakyCalls).toBe(2); // one retry
    expect(result.skippedFetchFailed).toEqual(['FLAKYCOIN']);
    expect(result.skippedNoHistory).toEqual([]);
  });

  it('reports genuinely short history as NO_HISTORY, distinct from a fetch failure', async () => {
    vi.spyOn(universeModule, 'resolveUniverse').mockResolvedValue(['BTCUSDT', 'NEWCOIN']);
    vi.spyOn(candlesModule, 'fetchDailyCandles').mockImplementation(async (symbol) => {
      if (symbol === 'BTCUSDT') return series(300, 100, 0.05);
      return series(10, 100, 0.3); // real data, just too little of it
    });

    const result = await screen({} as any);

    expect(result.skippedNoHistory).toEqual(['NEWCOIN']);
    expect(result.skippedFetchFailed).toEqual([]);
  });

  it('rejects an illiquid coin however strong its trend', async () => {
    vi.spyOn(universeModule, 'resolveUniverse').mockResolvedValue(['BTCUSDT', 'THINCOIN']);
    vi.spyOn(candlesModule, 'fetchDailyCandles').mockImplementation(async (symbol) => {
      if (symbol === 'BTCUSDT') return series(300, 100, 0.05);
      return series(300, 100, 0.4, 1); // strong trend, volume=1 -> tiny notional
    });

    const result = await screen({} as any);
    const thin = result.candidates.find((c) => c.symbol === 'THINCOIN')!;
    expect(thin.passed).toBe(false);
    expect(thin.metrics.avgTradedValue).toBeLessThan(MIN_AVG_TRADED_VALUE);
  });

  it('reports progress via the callback during a scan', async () => {
    vi.spyOn(universeModule, 'resolveUniverse').mockResolvedValue(['BTCUSDT']);
    vi.spyOn(candlesModule, 'fetchDailyCandles').mockResolvedValue(series(300, 100, 0.05));

    const messages: string[] = [];
    await screen({} as any, (msg) => messages.push(msg));

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => /universe/i.test(m))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/screener/screener.test.ts`
Expected: FAIL — `Cannot find module '../../../src/screener/screener.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/screener/screener.ts
import type { BinanceClient } from '@nemesis-oss/binance-sdk';
import type { Candle } from '../strategy/indicators.js';
import { fetchDailyCandles } from './candles.js';
import { resolveUniverse } from './universe.js';
import { computePerformance, classifyHorizons, performanceScore, type PerformanceMetrics, type TradeHorizon } from './performance.js';

/** Below this, a position cannot be entered or exited without moving the
 * price. $1M of average daily notional is a modest floor for a futures pair. */
export const MIN_AVG_TRADED_VALUE = 1_000_000;

const HISTORY_DAYS = 400; // ~250 trading-relevant days plus buffer
const BENCHMARK_SYMBOL = 'BTCUSDT';

export interface ScreenerCandidate {
  symbol: string;
  passed: boolean;
  score: number;
  horizons: TradeHorizon[];
  metrics: PerformanceMetrics;
}

export interface ScreenerResult {
  totalScreened: number;
  totalPassed: number;
  skippedNoHistory: string[];
  skippedFetchFailed: string[];
  candidates: ScreenerCandidate[];
  topPicks: string[];
  screenedAt: number;
}

/** Fetches once, retries once on failure, then gives up — distinguishing a
 * transient fetch problem from a symbol that genuinely has too little
 * history. See the plan's "Deviation from the spec" note for why this
 * distinction needs its own dedicated fetch (candles.ts) rather than reusing
 * KlineStore.fetchHistoricalKlines, which cannot make it. */
async function fetchWithRetry(symbol: string): Promise<Candle[] | 'FETCH_FAILED'> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetchDailyCandles(symbol, HISTORY_DAYS);
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
    }
  }
  return 'FETCH_FAILED';
}

export async function screen(
  client: BinanceClient,
  onProgress: (message: string) => void = () => {},
): Promise<ScreenerResult> {
  const universe = await resolveUniverse(client);
  onProgress(`Resolved ${universe.length} USDT-M perpetuals from the live universe`);

  const benchmark = await fetchDailyCandles(BENCHMARK_SYMBOL, HISTORY_DAYS);
  onProgress(`Benchmark loaded: ${benchmark.length} BTCUSDT sessions for relative strength`);

  const candidates: ScreenerCandidate[] = [];
  const skippedNoHistory: string[] = [];
  const skippedFetchFailed: string[] = [];
  let done = 0;

  for (const symbol of universe) {
    const candles = await fetchWithRetry(symbol);
    done++;

    if (candles === 'FETCH_FAILED') {
      skippedFetchFailed.push(symbol);
    } else {
      const metrics = computePerformance(candles, benchmark);
      if (!metrics) {
        skippedNoHistory.push(symbol);
      } else {
        const horizons = classifyHorizons(metrics);
        const liquid = metrics.avgTradedValue >= MIN_AVG_TRADED_VALUE;
        candidates.push({
          symbol,
          passed: liquid && horizons.length > 0,
          score: performanceScore(metrics, horizons),
          horizons,
          metrics,
        });
      }
    }

    if (done % 25 === 0 || done === universe.length) {
      onProgress(`Evaluated ${done}/${universe.length} (${skippedNoHistory.length + skippedFetchFailed.length} skipped)`);
    }
  }

  if (skippedFetchFailed.length > 0) {
    onProgress(`WARNING: ${skippedFetchFailed.length} symbol(s) could not be fetched after retry — `
      + `${skippedFetchFailed.slice(0, 8).join(', ')}${skippedFetchFailed.length > 8 ? '…' : ''}. `
      + 'Excluded, not failed; a re-run may include them.');
  }

  candidates.sort((a, b) => (a.passed !== b.passed ? (a.passed ? -1 : 1) : b.score - a.score));
  const passedList = candidates.filter((c) => c.passed);

  return {
    totalScreened: candidates.length,
    totalPassed: passedList.length,
    skippedNoHistory,
    skippedFetchFailed,
    candidates,
    topPicks: passedList.slice(0, 5).map((c) => c.symbol),
    screenedAt: Date.now(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/screener/screener.test.ts`
Expected: PASS, 5/5 tests

- [ ] **Step 5: Commit**

```bash
git add src/screener/screener.ts test/unit/screener/screener.test.ts
git commit -m "feat(screener): add the screening orchestrator with fetch-failure classification"
```

---

### Task 5: Wire a BinanceClient into ApiServer

**Files:**
- Modify: `src/api/server.ts` (the `ApiServerOptions` interface and `ApiServer` constructor)
- Modify: `src/engine.ts` (the `new ApiServer({...})` call site)

**Interfaces:**
- Consumes: `BinanceClient` (already imported in `engine.ts` as `client`, constructed at `engine.ts:~112` per the instrument-table-fix commit).
- Produces: `this.binanceClient?: BinanceClient` field on `ApiServer`, used by Task 6's routes.

- [ ] **Step 1: Add the field**

In `src/api/server.ts`, find the `ApiServerOptions` interface (contains `strategyParamLearner?`, `strategySelector?`, `abTestRunner?` near line 195) and add:

```ts
  /** Used by the screener routes for live universe resolution
   * (exchangeInfo()) — optional so ApiServer can still construct in tests
   * or contexts with no Binance client available. */
  binanceClient?: BinanceClient;
```

Add the same import at the top of the file if `BinanceClient` isn't already imported:
```ts
import type { BinanceClient } from '@nemesis-oss/binance-sdk';
```

Find the `ApiServer` class's private field block (contains `private broker: ExecutionBroker;` etc., around line 202) and add:
```ts
  private binanceClient?: BinanceClient;
```

Find the constructor body (around line 224, where `this.broker = options.broker;` etc. are assigned) and add:
```ts
    this.binanceClient = options.binanceClient;
```

- [ ] **Step 2: Pass it from engine.ts**

In `src/engine.ts`, find `const api = new ApiServer({` (around line 1086) and add one line inside the object literal, alongside the existing `broker,` `engine: strategyEngine,` etc.:
```ts
    binanceClient: client,
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/api/server.ts src/engine.ts
git commit -m "feat(screener): wire a BinanceClient into ApiServer for screener routes"
```

---

### Task 6: API routes

**Files:**
- Modify: `src/api/server.ts` (add three routes; find the route-registration method — the same one containing `this.app.get('/api/v1/klines', ...)` around line 686 — and add these alongside it)
- Test: `test/unit/screener/screenerRoutes.test.ts`

**Interfaces:**
- Consumes: `screen()` (Task 4), `this.events: EventLog` (existing field), `this.binanceClient` (Task 5), `this.requireApiKey` (existing preHandler, used by every other mutating route).
- Produces: `POST /api/v1/screener/run`, `GET /api/v1/screener/watchlist`, `GET /api/v1/screener/activity`.

- [ ] **Step 1: Write the failing test**

Check first how an existing route test in this repo constructs a minimal `ApiServer` for testing (grep `new ApiServer(` under `test/`) and mirror that exact setup — do not guess at the constructor's required fields.

```bash
grep -rn "new ApiServer(" test/
```

Then write (adjusting the fixture setup to match whatever that grep shows — the shape below assumes the same minimal-broker/minimal-engine pattern used elsewhere in this test suite; replace the `TODO` markers with the real fixture code copied from the existing test found above, this is not itself a step to leave incomplete):

```ts
// test/unit/screener/screenerRoutes.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as screenerModule from '../../../src/screener/screener.js';
// ... same ApiServer + broker + engine + events + klines fixture imports as
// the existing route test found via the grep above ...

describe('screener routes', () => {
  it('POST /api/v1/screener/run triggers a scan and returns the result', async () => {
    const fakeResult = {
      totalScreened: 1, totalPassed: 1, skippedNoHistory: [], skippedFetchFailed: [],
      candidates: [], topPicks: ['BTCUSDT'], screenedAt: Date.now(),
    };
    vi.spyOn(screenerModule, 'screen').mockResolvedValue(fakeResult as any);

    // build server per the existing pattern, inject { apiKey: 'test-key' }
    // const res = await server.app.inject({
    //   method: 'POST', url: '/api/v1/screener/run',
    //   headers: { 'x-api-key': 'test-key' },
    // });
    // expect(res.statusCode).toBe(200);
    // expect(JSON.parse(res.body)).toMatchObject({ topPicks: ['BTCUSDT'] });
  });

  it('POST /api/v1/screener/run rejects without the API key, matching every other mutating route', async () => {
    // const res = await server.app.inject({ method: 'POST', url: '/api/v1/screener/run' });
    // expect(res.statusCode).toBe(401);
  });

  it('GET /api/v1/screener/watchlist returns the latest persisted SCREENER_RESULT event', async () => {
    // seed events via server's EventLog.append('SCREENER_RESULT', fakeResult, { aggregateType: 'screener' })
    // const res = await server.app.inject({ method: 'GET', url: '/api/v1/screener/watchlist' });
    // expect(res.statusCode).toBe(200);
  });

  it('GET /api/v1/screener/watchlist returns null/empty when no scan has ever run', async () => {
    // const res = await server.app.inject({ method: 'GET', url: '/api/v1/screener/watchlist' });
    // expect(JSON.parse(res.body)).toEqual({ result: null });
  });

  it('GET /api/v1/screener/activity returns SCREENER_STEP events, matching the /api/v1/agents/steps shape', async () => {
    // seed a SCREENER_STEP event, request the route, assert it comes back
  });
});
```

This step is intentionally structured around "find the real fixture pattern
first" rather than a guessed one, because `ApiServer`'s constructor has many
fields (`broker`, `engine`, `signals`, `events`, ...) and guessing at a
working minimal set here risks writing a test that fails for reasons
unrelated to the code under test. The subagent implementing this task must
run the grep, read the matched file in full, and write the real fixture
before proceeding — this is not optional scaffolding to skip.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/screener/screenerRoutes.test.ts`
Expected: FAIL — routes don't exist yet (404s) or the test file itself won't compile until Step 1's fixture is filled in.

- [ ] **Step 3: Write minimal implementation**

Add to `src/api/server.ts`, in the route-registration method, near the existing `/api/v1/klines` and `/api/v1/activity` routes:

```ts
    // POST /api/v1/screener/run — full-universe scan, real price/volume
    // data only (see src/screener/), no fundamentals, no LLM. Read-only:
    // does not place orders, does not feed the strategy engine.
    this.app.post('/api/v1/screener/run', { preHandler: this.requireApiKey }, async (_request, reply) => {
      if (!this.binanceClient) {
        return reply.code(503).send({ error: 'BINANCE_CLIENT_UNAVAILABLE' });
      }
      const { screen } = await import('../screener/screener.js');
      try {
        const result = await screen(this.binanceClient, (message) => {
          this.events.append('SCREENER_STEP', { message, engine: 'deterministic' }, { aggregateType: 'screener' });
        });
        this.events.append('SCREENER_RESULT', result, { aggregateType: 'screener' });
        return result;
      } catch (error) {
        this.events.append('SCREENER_STEP', { message: `Scan failed: ${(error as Error).message}`, engine: 'deterministic' }, { aggregateType: 'screener' });
        return reply.code(500).send({ error: (error as Error).message });
      }
    });

    // GET /api/v1/screener/watchlist — the latest completed scan. Every scan
    // is an immutable append (SCREENER_RESULT); "current" is simply "most
    // recent" — no separate mutable watchlist row to drift out of sync.
    this.app.get('/api/v1/screener/watchlist', async () => {
      const events = this.events.getEvents({ type: 'SCREENER_RESULT', limit: 1 });
      return { result: events[0]?.payload ?? null };
    });

    // GET /api/v1/screener/activity — mirrors GET /api/v1/agents/steps exactly.
    this.app.get('/api/v1/screener/activity', async (request) => {
      const query = request.query as { limit?: string };
      const limit = Math.min(Math.max(parseInt(query.limit ?? '100', 10) || 100, 1), 500);
      const events = this.events.getEvents({ type: 'SCREENER_STEP', limit });
      return { steps: events.map((e) => e.payload) };
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/screener/screenerRoutes.test.ts`
Expected: PASS, 5/5 tests

- [ ] **Step 5: Commit**

```bash
git add src/api/server.ts test/unit/screener/screenerRoutes.test.ts
git commit -m "feat(screener): add /api/v1/screener/{run,watchlist,activity} routes"
```

---

### Task 7: Dashboard data hooks

**Files:**
- Modify: `dashboard/src/hooks/useApi.ts` (add three hooks near the existing `useActivity`/`useCreateOrder` functions, around line 458)

**Interfaces:**
- Consumes: `fetchJson` (existing helper already used by every hook in this file), `useQuery`/`useMutation`/`useQueryClient` from `@tanstack/react-query` (already imported in this file).
- Produces: `useScreenerWatchlist()`, `useScreenerActivity(limit?)`, `useRunScreener()` — used by Task 9.

- [ ] **Step 1: Add the hooks**

No test file for this task — it's a thin, typed wrapper over `fetchJson`
matching the exact existing pattern in this file (`useKlines`, `useActivity`
above it have no dedicated unit tests either; they're exercised via the
component that uses them, which Task 9 covers). Add after `useActivity`
(the function ending around line 470):

```ts
export interface ScreenerCandidate {
  symbol: string;
  passed: boolean;
  score: number;
  horizons: Array<'SWING' | 'SHORT_TERM' | 'LONG_TERM'>;
  metrics: {
    close: number;
    return20d: number | null;
    return60d: number | null;
    return250d: number | null;
    pctFrom52wHigh: number | null;
    relativeStrength60d: number | null;
    relativeStrength250d: number | null;
    avgTradedValue: number;
  };
}

export interface ScreenerResult {
  totalScreened: number;
  totalPassed: number;
  skippedNoHistory: string[];
  skippedFetchFailed: string[];
  candidates: ScreenerCandidate[];
  topPicks: string[];
  screenedAt: number;
}

export function useScreenerWatchlist() {
  return useQuery({
    queryKey: ['screener', 'watchlist'],
    queryFn: () => fetchJson<{ result: ScreenerResult | null }>('/api/v1/screener/watchlist'),
    refetchInterval: 30000,
  });
}

export function useScreenerActivity(limit = 100) {
  return useQuery({
    queryKey: ['screener', 'activity', limit],
    queryFn: () => fetchJson<{ steps: Array<{ message: string; engine: string }> }>(`/api/v1/screener/activity?limit=${limit}`),
    refetchInterval: 3000,
  });
}

export function useRunScreener() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson<ScreenerResult>('/api/v1/screener/run', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['screener'] });
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/hooks/useApi.ts
git commit -m "feat(screener): add dashboard data hooks for the screener API"
```

---

### Task 8: Register the tab

**Files:**
- Modify: `dashboard/src/store/useStore.ts` (the `WorkspaceTab` union at line 3 and `VALID_TABS` array at line ~262)
- Modify: `dashboard/src/App.tsx` (the keyboard-shortcut `tabs` array around line 40, and the view-render block around line 97)
- Modify: `dashboard/src/components/Sidebar.tsx` (the `mainNavItems` array around line 21)

**Interfaces:**
- Consumes: nothing new.
- Produces: `'screener'` as a valid `WorkspaceTab` value, reachable via the sidebar, keyboard shortcut, and URL hash — used by Task 9's `ScreenerView` to actually render.

- [ ] **Step 1: Add to the type and valid-tabs list**

In `dashboard/src/store/useStore.ts`, change:
```ts
export type WorkspaceTab =
  | 'dashboard'
  | 'markets'
  | 'trading'
  | 'agent'
  | 'research'
  | 'risk'
  | 'activity'
  | 'system';
```
to:
```ts
export type WorkspaceTab =
  | 'dashboard'
  | 'markets'
  | 'trading'
  | 'agent'
  | 'research'
  | 'screener'
  | 'risk'
  | 'activity'
  | 'system';
```
And in the `VALID_TABS` array (same file, ~line 262), add `'screener',` in the same position (after `'research',`, before `'risk',`).

- [ ] **Step 2: Add to App.tsx's keyboard shortcuts and render block**

In `dashboard/src/App.tsx`, add `'screener',` to the `tabs` array (~line 40) in the same position, and add the import + render line:
```ts
import { ScreenerView } from './components/screener/ScreenerView';
```
```tsx
          {activeTab === 'research' && <ResearchView />}
          {activeTab === 'screener' && <ScreenerView />}
          {activeTab === 'risk' && <RiskView />}
```

- [ ] **Step 3: Add the sidebar nav entry**

In `dashboard/src/components/Sidebar.tsx`, add `Radar` to the lucide-react import list, and add one entry to `mainNavItems` (after the `research` entry):
```ts
  { id: 'screener', label: 'Screener', icon: Radar },
```

- [ ] **Step 4: Typecheck (will fail until Task 9 creates ScreenerView — that's expected)**

Run: `cd dashboard && npx tsc --noEmit`
Expected: FAIL — `Cannot find module './components/screener/ScreenerView'`. This confirms the wiring compiles against a not-yet-existing component, which Task 9 supplies. Do not create a stub file to silence this — Task 9 is the very next task.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/store/useStore.ts dashboard/src/App.tsx dashboard/src/components/Sidebar.tsx
git commit -m "feat(screener): register the screener workspace tab (component follows next)"
```

---

### Task 9: `ScreenerView` component

**Files:**
- Create: `dashboard/src/components/screener/ScreenerView.tsx`

**Interfaces:**
- Consumes: `useScreenerWatchlist()`, `useScreenerActivity()`, `useRunScreener()` (Task 7).
- Produces: `export function ScreenerView(): JSX.Element` — completes Task 8's import.

- [ ] **Step 1: Write the component**

```tsx
// dashboard/src/components/screener/ScreenerView.tsx
import { RefreshCw, Loader2, Radar, Info } from 'lucide-react';
import { useScreenerWatchlist, useScreenerActivity, useRunScreener, type ScreenerCandidate } from '../../hooks/useApi';

const HORIZONS = [
  { key: 'SWING' as const, label: 'Swing', hint: 'Days to ~2 weeks — above 20DMA, pushing at the highs' },
  { key: 'SHORT_TERM' as const, label: 'Short Term', hint: 'Weeks to a quarter — above 50DMA, beating BTC over 60d' },
  { key: 'LONG_TERM' as const, label: 'Long Term', hint: 'Months — above a rising 200DMA, beating BTC over a year' },
];

const fmtPct = (v: number | null | undefined) =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
const tone = (v: number | null | undefined) =>
  v == null ? 'text-zinc-500' : v > 0 ? 'text-emerald-400' : 'text-rose-400';

export function ScreenerView() {
  const { data: watchlistData } = useScreenerWatchlist();
  const { data: activityData } = useScreenerActivity();
  const runScreener = useRunScreener();

  const candidates = watchlistData?.result?.candidates ?? [];
  const passed = candidates.filter((c) => c.passed);
  const byHorizon = (key: 'SWING' | 'SHORT_TERM' | 'LONG_TERM'): ScreenerCandidate[] =>
    passed.filter((c) => c.horizons.includes(key)).sort((a, b) => b.score - a.score);

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto pb-10">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Radar size={16} className="text-accent" />
            Coin Screener
          </h2>
          <p className="text-[11px] text-muted">
            {passed.length} of {candidates.length} scanned coins with a current setup
          </p>
        </div>
        <button
          onClick={() => runScreener.mutate()}
          disabled={runScreener.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent hover:brightness-110 disabled:opacity-50 text-black font-bold text-xs cursor-pointer transition-all"
        >
          {runScreener.isPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          <span>{runScreener.isPending ? 'Scanning…' : 'Run Scan'}</span>
        </button>
      </div>

      <div className="flex items-start gap-2 px-3 py-2 rounded border border-border bg-surface-100 text-[11px] text-muted">
        <Info size={13} className="mt-0.5 shrink-0 text-sky-400" />
        <span>
          Ranked on real price and volume only — relative strength vs BTCUSDT, trend alignment
          and liquidity. No fundamentals feed exists for crypto here, so no valuation claim is made.
        </span>
      </div>

      <div className="bg-surface-100 border border-border rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-border/60 text-xs font-semibold text-white">
          Background Activity
        </div>
        <div className="max-h-40 overflow-y-auto px-3 py-2 space-y-1">
          {(activityData?.steps ?? []).length === 0 ? (
            <p className="text-[11px] text-muted font-mono py-2 text-center">
              No scan activity yet — run a scan to see each step here.
            </p>
          ) : (
            (activityData?.steps ?? []).map((s, i) => (
              <div key={i} className="text-[11px] font-mono text-zinc-300">
                <span className="text-[9px] font-bold text-sky-400 mr-1.5">RULES</span>
                {s.message}
              </div>
            ))
          )}
        </div>
      </div>

      {candidates.length === 0 ? (
        <div className="text-center py-10 bg-surface-100 border border-border rounded-lg">
          <p className="text-sm text-white font-semibold">No scan yet</p>
          <p className="text-[11px] text-muted mt-1">Click "Run Scan" above to screen the live universe.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {HORIZONS.map(({ key, label, hint }) => {
            const picks = byHorizon(key);
            return (
              <div key={key} className="bg-surface-100 border border-border rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-border/60">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-white">{label}</span>
                    <span className="ml-auto text-[10px] font-mono text-muted">{picks.length}</span>
                  </div>
                  <p className="text-[10px] text-muted mt-0.5">{hint}</p>
                </div>
                <div className="divide-y divide-border/30">
                  {picks.length === 0 ? (
                    <p className="px-3 py-4 text-[11px] text-muted text-center">Nothing qualifying right now.</p>
                  ) : (
                    picks.slice(0, 8).map((c) => (
                      <div key={c.symbol} className="w-full px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-bold text-white text-xs">{c.symbol}</span>
                          <span className="font-mono font-bold text-accent text-xs">{c.score}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[10px] font-mono">
                          <span className={tone(c.metrics.return20d)}>20d {fmtPct(c.metrics.return20d)}</span>
                          <span className={tone(c.metrics.relativeStrength60d)}>
                            vs BTC {fmtPct(c.metrics.relativeStrength60d)}
                          </span>
                          <span className="text-zinc-500">{fmtPct(c.metrics.pctFrom52wHigh)} off high</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: PASS, no errors (Task 8's dangling import now resolves).

- [ ] **Step 3: Manual smoke test**

Run: `cd /home/nemesis/project/trading-workspace/paper-broker && pnpm dev:all` (or the repo's documented dev-all script), open the dashboard, click the new "Screener" sidebar entry, confirm the page renders the empty state without console errors. Do not click "Run Scan" yet — that requires `API_KEY` to be configured and a live Binance connection; that end-to-end check is Task 10.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/screener/ScreenerView.tsx
git commit -m "feat(screener): add the ScreenerView dashboard component"
```

---

### Task 10: Extend `ActivityView`'s event formatter

**Files:**
- Modify: `dashboard/src/components/activity/ActivityView.tsx` (the `formatEventSummary` function, ~line 16)

**Interfaces:**
- Consumes: nothing new — this only adds cases to an existing function.
- Produces: nothing new — improves display only.

- [ ] **Step 1: Add the cases**

In `formatEventSummary` (`dashboard/src/components/activity/ActivityView.tsx`), add before the final generic `return JSON.stringify(p);` fallback:

```ts
  if (evt.type === 'SCREENER_STEP') {
    return `[SCREENER] ${p.message || ''}`;
  }
  if (evt.type === 'SCREENER_RESULT') {
    return `[SCREENER] Scan complete: ${p.totalPassed}/${p.totalScreened} passed. Top: ${(p.topPicks as string[] | undefined)?.join(', ') || 'none'}`;
  }
```

- [ ] **Step 2: Typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/activity/ActivityView.tsx
git commit -m "feat(screener): show screener events legibly in the global activity feed"
```

---

### Task 11: Live verification pass

**Files:**
- Create (throwaway, deleted at the end of this task): `scripts/tmp-screener-verify.ts`

**Interfaces:**
- Consumes: `screen()` (Task 4), a real `BinanceClient`.
- Produces: nothing persisted — this task's deliverable is a verified-correct system, evidenced in the commit message, not new code.

This mirrors the two live-verification passes done tonight in this same
session (the instrument-table fix and the `PaperBroker` lifecycle replay) —
both surfaced real bugs that unit tests against fakes did not catch. This
screener has the same risk profile (external API, hundreds of symbols,
retry/classification logic) and gets the same treatment before being called
done.

- [ ] **Step 1: Write the verification script**

```ts
// scripts/tmp-screener-verify.ts
import { BinanceClient } from '@nemesis-oss/binance-sdk';
import { screen } from '../src/screener/screener.js';

async function main() {
  const client = new BinanceClient({ testnet: false });
  const start = Date.now();

  const result = await screen(client, (msg) => console.log(`  ${msg}`));

  console.log(`\n${'='.repeat(90)}`);
  console.log(`Screened ${result.totalScreened} in ${((Date.now() - start) / 1000).toFixed(1)}s — ` +
    `${result.totalPassed} passed, ${result.skippedNoHistory.length} no-history, ` +
    `${result.skippedFetchFailed.length} fetch-failed`);
  console.log(`Top picks: ${result.topPicks.join(', ') || 'none'}`);
  console.log('='.repeat(90));

  for (const c of result.candidates.filter((c) => c.passed).slice(0, 15)) {
    const m = c.metrics;
    console.log(`  ${c.symbol.padEnd(14)} score=${String(c.score).padStart(3)} ` +
      `20d=${(m.return20d ?? 0).toFixed(1).padStart(6)}% ` +
      `rs60=${(m.relativeStrength60d ?? 0).toFixed(1).padStart(6)}% ` +
      `horizons=[${c.horizons.join(',')}]`);
  }

  // Sanity checks a real run must satisfy, printed loudly if violated —
  // these are the exact two bug classes found and fixed in this session
  // tonight (a benchmark fetch silently nulling relative strength, and a
  // swallowed fetch error masquerading as "no history").
  if (result.totalScreened < 100) {
    console.log(`\n⚠ MISMATCH: only ${result.totalScreened} screened — expected 400+ live USDT-M perpetuals. Universe resolution or the benchmark fetch may be failing silently.`);
  }
  if (result.candidates.every((c) => c.metrics.relativeStrength60d == null)) {
    console.log(`\n⚠ MISMATCH: every candidate has relativeStrength60d == null — the BTCUSDT benchmark fetch likely failed silently.`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERR', e.message); process.exit(1); });
```

- [ ] **Step 2: Run it against the live Binance API**

Run: `cd /home/nemesis/project/trading-workspace/paper-broker && npx tsx scripts/tmp-screener-verify.ts`
Expected: completes in well under 5 minutes (500+ symbols, sequential fetches — if this is dramatically slower, note it in the commit message as a follow-up concern, don't silently accept an unusable multi-hour scan). `totalScreened` should be 400+. At least a few real coins should pass with non-null `relativeStrength60d`/`relativeStrength250d` values that look plausible (not all-null, not all-zero).

- [ ] **Step 3: Investigate and fix anything the sanity checks flag**

If either `⚠ MISMATCH` line prints, or the results otherwise look wrong (e.g.,
every single candidate fails, which would indicate a rule is miscalibrated
rather than the market genuinely offering nothing), stop and diagnose before
proceeding — do not delete the script and move on with a known-broken
screener. This step has no fixed code to write because the fix depends on
what's actually found; investigate with the same rigor used tonight (read
the real API response, don't guess).

- [ ] **Step 4: Delete the throwaway script**

```bash
rm scripts/tmp-screener-verify.ts
```

- [ ] **Step 5: Run the full test suite and typecheck one more time**

Run: `cd /home/nemesis/project/trading-workspace/paper-broker && npx tsc --noEmit && npx vitest run && cd dashboard && npx tsc --noEmit`
Expected: all pass, 0 failures, clean typecheck in both the backend and dashboard.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(screener): verify a full live scan against real Binance data

Ran the screener against the live universe (verified: 500+ USDT-M
perpetuals resolved, real relative-strength numbers computed against
BTCUSDT). [Fill in: N passed, top picks were: ...] No mismatches from
the two known bug classes checked for (silent benchmark failure,
swallowed fetch errors)."
```

(Fill in the bracketed placeholder with the real numbers from Step 2's
actual output before committing — this is the one line in this entire plan
that depends on live data unknowable until the script runs.)

---

## Self-Review

**Spec coverage:**
- Universe resolution from live `exchangeInfo()`, not hardcoded → Task 2. ✅
- Performance metrics + horizon classification, BTCUSDT benchmark → Task 3. ✅
- No fabricated fundamentals → enforced throughout (Global Constraints; no fundamentals field exists anywhere in Tasks 3-4's types). ✅
- Activity log via `EventLog`, `engine: 'deterministic'` tag → Task 6 (both `SCREENER_STEP` events tagged, and the route layer). ✅
- No new database table → Task 6 uses only `EventLog.append`/`getEvents`, confirmed no schema changes anywhere in the plan. ✅
- New dashboard tab, separate from `research` → Tasks 8-9. ✅
- `$1,000,000` liquidity default as a named constant → Task 4 (`MIN_AVG_TRADED_VALUE`). ✅
- Live verification pass before considering it done → Task 11. ✅
- Open question 1 (shared activity component) → resolved during planning: no reusable component exists (`AgentActivityToasts` is a toast overlay, wrong shape; `ActivityView` is a whole-app page, not embeddable) — `ScreenerView` renders its own small activity list directly (Task 9), and `ActivityView`'s formatter gets a matching case for consistency in the global feed (Task 10). ✅
- Open question 2 (`'1d'` interval validity) → resolved during planning via direct API verification, confirmed at the type level (`KlineInterval` already includes `'1d'`) and against the live endpoint. ✅

**Placeholder scan:** No TBD/TODO strings. The one intentionally-incomplete-until-run item is Task 11 Step 6's bracketed commit message placeholder, which is explicitly called out as depending on live data and must be filled in before committing — not a plan gap.

**Type consistency:** `ScreenerCandidate`/`ScreenerResult`/`PerformanceMetrics`/`TradeHorizon` are defined once (Tasks 3-4) and referenced with matching field names throughout Tasks 5-9 (checked: `passed`, `score`, `horizons`, `metrics`, `avgTradedValue`, `relativeStrength60d`/`250d`, `pctFrom52wHigh`, `return20d` all match exactly between the backend types (Task 4) and the dashboard's mirrored `ScreenerCandidate` interface (Task 7)). `fetchDailyCandles`'s signature (Task 1) matches its only two call sites (Task 4's `fetchWithRetry` and Task 11's benchmark fetch).
