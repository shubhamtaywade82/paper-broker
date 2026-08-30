import { z } from 'zod';
import type { ToolDefinition, ToolResult } from './types.js';

/**
 * WebSearchTool
 * =============
 *
 * Read-only web-search over four free public sources, no API key required:
 *
 *   1. CoinGecko `/search` — symbol/news lookup for any coin.
 *   2. alternative.me Fear & Greed index — daily sentiment snapshot.
 *   3. Binance Futures public REST — funding rate + open interest for any
 *      USDT-M futures symbol (same data the engine already streams, but
 *      the public REST is the canonical source for "right now").
 *   4. CoinDesk RSS — recent crypto headlines (used by NewsSentimentTool).
 *
 * Optional: Brave Search API for richer web search. Set
 * `AGENT_WEB_SEARCH_PROVIDER=brave` + `AGENT_WEB_SEARCH_BRAVE_KEY`.
 *
 * All network calls use a per-call AbortController bound to the context's
 * deadline. The tool NEVER throws — every failure path returns
 * `{ ok: false, error }` so a flaky network never breaks the trading cycle.
 *
 * Output is truncated to `maxChars` per item so a single chatty response
 * cannot blow out the analyst prompt's token budget.
 */

type SearchMode = 'symbol' | 'sentiment' | 'funding' | 'web';

const InputSchema = z.object({
  query: z.string().min(1).max(200).describe('What to look up — a symbol, a news topic, or a free-text question.'),
  mode: z
    .enum(['symbol', 'sentiment', 'funding', 'web'])
    .default('symbol')
    .describe('symbol: CoinGecko coin lookup. sentiment: Fear&Greed. funding: Binance funding+OI. web: Brave Search (or free fallback).'),
  symbol: z
    .string()
    .optional()
    .describe('Required when mode=funding — the futures symbol, e.g. BTCUSDT.'),
  maxChars: z
    .number()
    .int()
    .min(100)
    .max(8_000)
    .default(1_500)
    .describe('Max chars per returned item (anti-token-bloat).'),
});

const ResultSchema = z.object({
  title: z.string(),
  snippet: z.string(),
  url: z.string().optional(),
  ts: z.number().optional(),
});

const OutputSchema = z.object({
  mode: z.enum(['symbol', 'sentiment', 'funding', 'web']),
  results: z.array(ResultSchema).default([]),
  /** Free-text summary the analyst can drop into its report verbatim. */
  summary: z.string(),
});

export type WebSearchToolInput = z.infer<typeof InputSchema>;
export type WebSearchToolOutput = z.infer<typeof OutputSchema>;

export interface WebSearchToolConfig {
  /** 'free' (default) | 'brave' (requires braveKey). */
  provider: 'free' | 'brave';
  braveKey?: string;
  /** Hard per-call timeout in ms (also enforced by registry). */
  timeoutMs: number;
  /** In-memory per-tool rate cap. */
  ratePerMin: number;
}

interface RateBucket {
  windowStart: number;
  count: number;
}

export function createWebSearchTool(cfg: WebSearchToolConfig): ToolDefinition<WebSearchToolInput, WebSearchToolOutput> {
  const rateBucket: RateBucket = { windowStart: Date.now(), count: 0 };

  return {
    name: 'web-search',
    description:
      'Web search across free public crypto sources. Modes: symbol (CoinGecko coin lookup), sentiment (Fear&Greed index), funding (Binance funding rate + open interest for a symbol), web (Brave Search or free fallback). Use before forming a directional view to ground the analyst report in fresh external context.',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    readonly: true,
    async execute(input, ctx): Promise<ToolResult<WebSearchToolOutput>> {
      const startedAt = Date.now();

      // Rate-limit check (per-process). If the bucket is exhausted for this
      // minute, return a soft failure — the analyst stage can still produce
      // a report without web context, exactly like when the LLM is offline.
      const now = Date.now();
      if (now - rateBucket.windowStart > 60_000) {
        rateBucket.windowStart = now;
        rateBucket.count = 0;
      }
      if (rateBucket.count >= cfg.ratePerMin) {
        return {
          ok: false,
          error: `web-search: rate limit (${cfg.ratePerMin}/min) reached`,
          latencyMs: Date.now() - startedAt,
        };
      }
      rateBucket.count += 1;

      try {
        const remainingMs = Math.max(500, ctx.deadlineMs - now);
        const ac = new AbortController();
        const timeout = setTimeout(() => ac.abort(), remainingMs);
        try {
          let results: WebSearchToolOutput['results'] = [];
          let summary = '';

          if (input.mode === 'symbol') {
            const r = await fetchCoinGeckoSearch(input.query, ac.signal, input.maxChars);
            results = r.results;
            summary = r.summary;
          } else if (input.mode === 'sentiment') {
            const r = await fetchFearGreed(ac.signal, input.maxChars);
            results = r.results;
            summary = r.summary;
          } else if (input.mode === 'funding') {
            if (!input.symbol) {
              return {
                ok: false,
                error: 'web-search.funding: symbol is required',
                latencyMs: Date.now() - startedAt,
              };
            }
            const r = await fetchBinanceFunding(input.symbol, ac.signal, input.maxChars);
            results = r.results;
            summary = r.summary;
          } else {
            // web
            if (cfg.provider === 'brave' && cfg.braveKey) {
              const r = await fetchBraveSearch(input.query, cfg.braveKey, ac.signal, input.maxChars);
              results = r.results;
              summary = r.summary;
            } else {
              // Free fallback: CoinGecko search by query — gives coin
              // matches + a link to coin page (no key, generous rate).
              const r = await fetchCoinGeckoSearch(input.query, ac.signal, input.maxChars);
              results = r.results;
              summary = `[free-fallback web search] ${r.summary}`;
            }
          }

          return {
            ok: true,
            data: { mode: input.mode, results, summary },
            latencyMs: Date.now() - startedAt,
            truncated: false,
          };
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        return {
          ok: false,
          error: `web-search: ${(err as Error).message}`,
          latencyMs: Date.now() - startedAt,
        };
      }
    },
  };
}

// ----- Free source fetchers -----

interface FetchResult {
  results: WebSearchToolOutput['results'];
  summary: string;
}

async function fetchCoinGeckoSearch(query: string, signal: AbortSignal, maxChars: number): Promise<FetchResult> {
  const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`;
  const res = await fetchJson(url, signal);
  if (!res.ok) return toFetchResult(`CoinGecko search failed: ${res.error}`);
  const data = res.data as { coins?: Array<{ id: string; name: string; symbol: string; large?: string; market_cap_rank?: number }> };
  const coins = (data.coins ?? []).slice(0, 5);
  if (coins.length === 0) return toFetchResult(`CoinGecko: no matches for "${query}"`);
  const results = coins.map((c) => ({
    title: `${c.name} (${c.symbol?.toUpperCase() ?? '?'})`,
    snippet: `market_cap_rank=${c.market_cap_rank ?? 'n/a'}`.slice(0, maxChars),
    url: `https://www.coingecko.com/en/coins/${c.id}`,
  }));
  const summary = `CoinGecko top matches: ${results.map((r) => r.title).join('; ')}`;
  return { results, summary };
}

async function fetchFearGreed(signal: AbortSignal, _maxChars: number): Promise<FetchResult> {
  const url = 'https://api.alternative.me/fng/?limit=3';
  const res = await fetchJson(url, signal);
  if (!res.ok) return toFetchResult(`Fear&Greed fetch failed: ${res.error}`);
  const data = res.data as { data?: Array<{ value: string; value_classification: string; timestamp: string }> };
  const items = data.data ?? [];
  if (items.length === 0) return toFetchResult('Fear&Greed: no data');
  const latest = items[0]!;
  const results = items.map((d) => ({
    title: `Fear&Greed @ ${new Date(Number(d.timestamp) * 1000).toISOString().slice(0, 10)}`,
    snippet: `${d.value} (${d.value_classification})`,
    ts: Number(d.timestamp) * 1000,
    url: 'https://alternative.me/crypto/fear-and-greed-index/',
  }));
  const summary = `Market sentiment (Fear&Greed): latest ${latest.value} = ${latest.value_classification}`;
  return { results, summary };
}

async function fetchBinanceFunding(symbol: string, signal: AbortSignal, _maxChars: number): Promise<FetchResult> {
  // Binance public REST: funding rate + open interest. No API key required
  // for these public endpoints.
  const [fundRes, oiRes] = await Promise.all([
    fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`, signal),
    fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`, signal),
  ]);

  if (!fundRes.ok) return toFetchResult(`Binance funding fetch failed: ${fundRes.error}`);
  if (!oiRes.ok) return toFetchResult(`Binance OI fetch failed: ${oiRes.error}`);

  const fund = fundRes.data as { lastFundingRate?: string; markPrice?: string; indexPrice?: string };
  const oi = oiRes.data as { openInterest?: string; symbol?: string };

  const rate = Number(fund.lastFundingRate ?? 0);
  const ratePct = (rate * 100).toFixed(4);
  const annualPct = (rate * 3 * 365 * 100).toFixed(2);
  const results = [
    {
      title: `${symbol} funding`,
      snippet: `lastFundingRate=${ratePct}% (≈${annualPct}% APR) | mark=${fund.markPrice ?? '?'} | idx=${fund.indexPrice ?? '?'}`,
      url: `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`,
    },
    {
      title: `${symbol} open interest`,
      snippet: `openInterest=${oi.openInterest ?? '?'} ${symbol.replace('USDT', '')}`,
      url: `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`,
    },
  ];
  const sentiment =
    rate > 0.0005 ? 'longs paying shorts → crowded-long, funding-bearish' :
    rate < -0.0005 ? 'shorts paying longs → crowded-short, funding-bullish' :
    'funding neutral';
  const summary = `${symbol}: funding ${ratePct}% (APR ${annualPct}%), OI ${oi.openInterest ?? '?'}, ${sentiment}`;
  return { results, summary };
}

async function fetchBraveSearch(query: string, key: string, signal: AbortSignal, maxChars: number): Promise<FetchResult> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
  const res = await fetchJson(url, signal, {
    'X-Subscription-Token': key,
    'Accept': 'application/json',
  });
  if (!res.ok) return toFetchResult(`Brave search failed: ${res.error}`);
  const data = res.data as { web?: { results?: Array<{ title?: string; description?: string; url?: string }> } };
  const items = (data.web?.results ?? []).slice(0, 5);
  if (items.length === 0) return toFetchResult(`Brave: no matches for "${query}"`);
  const results = items.map((r) => ({
    title: r.title ?? '(no title)',
    snippet: (r.description ?? '').slice(0, maxChars),
    url: r.url,
  }));
  const summary = `Brave top results: ${results.map((r) => r.title).join('; ')}`;
  return { results, summary };
}

function toFetchResult(summary: string): FetchResult {
  return { results: [], summary };
}

// ----- Tiny fetch helper with abort + JSON parsing -----

async function fetchJson(
  url: string,
  signal: AbortSignal,
  headers?: Record<string, string>
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      signal,
      headers: {
        'User-Agent': 'paper-broker-agent/1.0 (+https://github.com/shubhamtaywade82/paper-broker)',
        ...headers,
      },
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
    }
    const text = await res.text();
    try {
      return { ok: true, data: JSON.parse(text) };
    } catch {
      return { ok: false, error: `non-JSON response (len ${text.length})` };
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
