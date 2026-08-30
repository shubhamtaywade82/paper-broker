import { z } from 'zod';
import type { ToolDefinition, ToolResult } from './types.js';

/**
 * DocsLookupTool
 * ==============
 *
 * Read-only lookup over a small static catalog of Binance Futures API doc
 * pages + the project's own CONTRACTS.md / SKILL.md / PROJECT_STATE.md. The
 * agent uses this to self-debug ("what's the exact response shape of
 * /fapi/v1/premiumIndex?") without leaving the tool framework.
 *
 * Implementation note: this is intentionally a static catalog, not a live
 * web crawl. Live doc crawling would require either scraping MDN-style HTML
 * (fragile, heavy) or a search API key. The static catalog covers the docs
 * an agent debugging this codebase actually needs:
 *
 *   - Binance Futures REST endpoints we hit (premiumIndex, openInterest,
 *     klines, exchangeInfo)
 *   - CONTRACTS.md sections (so the agent can self-check "am I allowed to
 *     do X?" without re-reading the whole file in the prompt)
 *   - skills/agentic-llm/SKILL.md (so the agent knows its own constraints)
 *
 * Operators who want richer docs lookup should swap this implementation for
 * a Brave-Search-backed fetcher (the WebSearchTool already supports Brave).
 */

const InputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(120)
    .describe('What to look up — e.g. "funding rate endpoint", "LLM authority contract", "Fear Greed API".'),
  maxChars: z.number().int().min(100).max(4_000).default(1_500),
});

const ResultSchema = z.object({
  title: z.string(),
  snippet: z.string(),
  url: z.string().optional(),
});

const OutputSchema = z.object({
  query: z.string(),
  results: z.array(ResultSchema).default([]),
  summary: z.string(),
});

export type DocsLookupToolInput = z.infer<typeof InputSchema>;
export type DocsLookupToolOutput = z.infer<typeof OutputSchema>;

interface CatalogEntry {
  title: string;
  url?: string;
  keywords: string[];
  snippet: string;
}

const CATALOG: CatalogEntry[] = [
  {
    title: 'Binance Futures: premiumIndex (mark + funding)',
    url: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest/premiumIndex',
    keywords: ['funding', 'premiumindex', 'mark price', 'funding rate', 'binance'],
    snippet:
      'GET /fapi/v1/premiumIndex — returns { symbol, markPrice, indexPrice, lastFundingRate, nextFundingTime }. Public, no API key. Use to fetch funding rate + mark price for a USDT-M symbol.',
  },
  {
    title: 'Binance Futures: openInterest',
    url: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest/openInterest',
    keywords: ['open interest', 'oi', 'fapi', 'binance'],
    snippet:
      'GET /fapi/v1/openInterest?symbol=X — returns { symbol, openInterest, time }. Public. Use to gauge position crowding for a symbol.',
  },
  {
    title: 'Binance Futures: klines',
    url: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest/klines',
    keywords: ['klines', 'candles', 'kline', 'binance'],
    snippet:
      'GET /fapi/v1/klines?symbol=X&interval=1m&limit=200 — returns array of [openTime, open, high, low, close, volume, closeTime, ...]. Public.',
  },
  {
    title: 'Binance Futures: exchangeInfo',
    url: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest/Exchange-Info',
    keywords: ['exchangeinfo', 'instrument', 'tick_size', 'step_size', 'binance'],
    snippet:
      'GET /fapi/v1/exchangeInfo — returns { symbols: [{ symbol, contractType, status, pricePrecision, quantityPrecision, filters: [...] }] }. Public. Used at engine bootstrap to build the instrument table.',
  },
  {
    title: 'CONTRACTS.md §5 — LLM Authority Contract',
    url: 'https://github.com/shubhamtaywade82/paper-broker/blob/main/CONTRACTS.md',
    keywords: ['llm', 'authority', 'contracts', 'risk', 'intent', 'veto'],
    snippet:
      "LLM produces intent, not authority. The LLM may analyze data, produce BUY/SELL/HOLD signals and reasoning. The LLM may NOT submit orders, bypass validation, override risk checks, or modify position state.",
  },
  {
    title: 'CONTRACTS.md §1 — Execution Contract',
    url: 'https://github.com/shubhamtaywade82/paper-broker/blob/main/CONTRACTS.md',
    keywords: ['execution', 'contracts', 'strategy', 'signalexecutor', 'order'],
    snippet:
      'Strategy never places orders directly. Strategies produce signals; SignalExecutor owns sizing, risk validation, order type selection, bracket attachment, submission.',
  },
  {
    title: 'skills/agentic-llm/SKILL.md',
    url: 'https://github.com/shubhamtaywade82/paper-broker/blob/main/skills/agentic-llm/SKILL.md',
    keywords: ['skill', 'agentic', 'llm', 'tool', 'mcp', 'memory'],
    snippet:
      "The LLM is a reasoning layer over verified facts. Tools should be read-only by default, schema-validated, timeout-constrained (max 30s), output-bounded, logged. The agent must have a finite iteration budget (MAX_ITERATIONS=5).",
  },
  {
    title: 'PROJECT_STATE.md — Agent/LLM',
    url: 'https://github.com/shubhamtaywade82/paper-broker/blob/main/PROJECT_STATE.md',
    keywords: ['project state', 'agent', 'llm', 'pipeline', 'ollama'],
    snippet:
      "TradingAgentsPipeline runs 7 stages: analyst_team / debate_bull / debate_bear / debate_verdict / trader_decision are LLM; risk_team / fund_manager are deterministic. Agent authority is advisory-only — a NEUTRAL or mismatched direction returns null.",
  },
];

export function createDocsLookupTool(): ToolDefinition<DocsLookupToolInput, DocsLookupToolOutput> {
  return {
    name: 'docs-lookup',
    description:
      "Static catalog lookup over Binance Futures API docs and the project's own CONTRACTS.md / SKILL.md / PROJECT_STATE.md. Returns matched entries with title + snippet + URL. Use to self-debug ('what is the response shape of premiumIndex?') or to check a contract before acting ('am I allowed to override risk?').",
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    readonly: true,
    async execute(input): Promise<ToolResult<DocsLookupToolOutput>> {
      const startedAt = Date.now();
      try {
        const q = input.query.toLowerCase();
        const words = q.split(/\s+/).filter((w) => w.length >= 2);

        const scored = CATALOG.map((entry) => {
          let score = 0;
          for (const w of words) {
            if (entry.keywords.some((k) => k.includes(w))) score += 2;
            if (entry.title.toLowerCase().includes(w)) score += 1;
            if (entry.snippet.toLowerCase().includes(w)) score += 1;
          }
          return { entry, score };
        });

        const matched = scored
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((s) => ({
            title: s.entry.title,
            snippet: s.entry.snippet.slice(0, input.maxChars),
            url: s.entry.url,
          }));

        const summary =
          matched.length === 0
            ? `No doc entries match "${input.query}"`
            : `${matched.length} doc entries: ${matched.map((m) => m.title).join('; ')}`;

        return {
          ok: true,
          data: { query: input.query, results: matched, summary },
          latencyMs: Date.now() - startedAt,
          truncated: false,
        };
      } catch (err) {
        return {
          ok: false,
          error: `docs-lookup: ${(err as Error).message}`,
          latencyMs: Date.now() - startedAt,
        };
      }
    },
  };
}
