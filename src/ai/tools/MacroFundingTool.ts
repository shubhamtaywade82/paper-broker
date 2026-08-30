import { z } from 'zod';
import type { ToolDefinition, ToolResult } from './types.js';

/**
 * MacroFundingTool
 * ================
 *
 * Multi-symbol macro & derivatives snapshot — a single call returns:
 *   - Fear & Greed index (alternative.me, free)
 *   - BTC dominance (CoinGecko global, free)
 *   - Funding rate for each requested symbol (Binance public REST)
 *   - Open interest for each requested symbol (Binance public REST)
 *
 * Useful for the analyst to ask "what's the macro picture right now?" before
 * forming a directional view, instead of having to invoke web-search multiple
 * times. Same AbortController + deadline + fail-closed pattern as WebSearchTool.
 */
const InputSchema = z.object({
  symbols: z
    .array(z.string().min(1))
    .min(1)
    .max(10)
    .default(['BTCUSDT'])
    .describe('Futures symbols to fetch funding+OI for, e.g. ["BTCUSDT","ETHUSDT"].'),
  maxChars: z.number().int().min(100).max(4_000).default(500),
});

const SymbolRowSchema = z.object({
  symbol: z.string(),
  fundingRate: z.number(),
  fundingRateAnnualPct: z.number(),
  openInterest: z.number(),
  markPrice: z.number(),
  interpretation: z.string(),
});

const OutputSchema = z.object({
  fearGreed: z.object({ value: z.number().optional(), classification: z.string().optional() }).default({}),
  btcDominance: z.number().optional(),
  rows: z.array(SymbolRowSchema).default([]),
  summary: z.string(),
});

export type MacroFundingToolInput = z.infer<typeof InputSchema>;
export type MacroFundingToolOutput = z.infer<typeof OutputSchema>;

export function createMacroFundingTool(timeoutMs: number): ToolDefinition<
  MacroFundingToolInput,
  MacroFundingToolOutput
> {
  return {
    name: 'macro-funding',
    description:
      "Multi-symbol macro/derivatives snapshot. Returns Fear&Greed index, BTC dominance, and per-symbol funding rate + open interest. Use at the start of an analyst cycle to set the macro backdrop before evaluating any specific setup.",
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    readonly: true,
    async execute(_input, ctx): Promise<ToolResult<MacroFundingToolOutput>> {
      const startedAt = Date.now();
      const input = _input;
      try {
        const remainingMs = Math.max(500, ctx.deadlineMs - Date.now());
        const ac = new AbortController();
        const timeout = setTimeout(() => ac.abort(), Math.min(remainingMs, timeoutMs));

        try {
          // Fire all requests in parallel; each is independently fail-closed.
          const [fng, global, ...rows] = await Promise.all([
            fetchFearGreed(ac.signal),
            fetchGlobal(ac.signal),
            ...input.symbols.map((s) => fetchSymbolRow(s, ac.signal)),
          ]);

          const summary =
            `Macro snapshot: F&G=${fng.value ?? '?'} (${fng.classification ?? '?'}), ` +
            `BTC dom=${(global.btcDominance ?? 0).toFixed(1)}%, ` +
            rows.map((r) => `${r.symbol} funding=${(r.fundingRate * 100).toFixed(4)}% OI=${r.openInterest}`).join(', ');

          return {
            ok: true,
            data: {
              fearGreed: { value: fng.value, classification: fng.classification },
              btcDominance: global.btcDominance,
              rows,
              summary: summary.slice(0, input.maxChars * 4),
            },
            latencyMs: Date.now() - startedAt,
            truncated: false,
          };
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        return {
          ok: false,
          error: `macro-funding: ${(err as Error).message}`,
          latencyMs: Date.now() - startedAt,
        };
      }
    },
  };
}

interface FearGreedResult { value?: number; classification?: string; }
interface GlobalResult { btcDominance?: number; }

async function fetchFearGreed(signal: AbortSignal): Promise<FearGreedResult> {
  const r = await fetchJson('https://api.alternative.me/fng/?limit=1', signal);
  if (!r.ok) return {};
  const data = r.data as { data?: Array<{ value: string; value_classification: string }> };
  const latest = data.data?.[0];
  if (!latest) return {};
  return { value: Number(latest.value), classification: latest.value_classification };
}

async function fetchGlobal(signal: AbortSignal): Promise<GlobalResult> {
  const r = await fetchJson('https://api.coingecko.com/api/v3/global', signal);
  if (!r.ok) return {};
  const data = r.data as { data?: { market_cap_percentage?: { btc?: number } } };
  return { btcDominance: data.data?.market_cap_percentage?.btc };
}

async function fetchSymbolRow(symbol: string, signal: AbortSignal): Promise<z.infer<typeof SymbolRowSchema>> {
  const [fundRes, oiRes] = await Promise.all([
    fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`, signal),
    fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`, signal),
  ]);

  const fund = (fundRes.ok ? fundRes.data : {}) as { lastFundingRate?: string; markPrice?: string };
  const oi = (oiRes.ok ? oiRes.data : {}) as { openInterest?: string };

  const rate = Number(fund.lastFundingRate ?? 0);
  const annual = rate * 3 * 365 * 100;
  const interpretation =
    rate > 0.0005 ? 'crowded-long, funding-bearish' :
    rate < -0.0005 ? 'crowded-short, funding-bullish' :
    'neutral funding';

  return {
    symbol,
    fundingRate: rate,
    fundingRateAnnualPct: annual,
    openInterest: Number(oi.openInterest ?? 0),
    markPrice: Number(fund.markPrice ?? 0),
    interpretation,
  };
}

async function fetchJson(url: string, signal: AbortSignal): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      signal,
      headers: { 'User-Agent': 'paper-broker-agent/1.0' },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const text = await res.text();
    try {
      return { ok: true, data: JSON.parse(text) };
    } catch {
      return { ok: false, error: `non-JSON (len ${text.length})` };
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
