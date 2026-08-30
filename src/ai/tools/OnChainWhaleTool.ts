import { z } from 'zod';
import type { ToolDefinition, ToolResult } from './types.js';

/**
 * OnChainWhaleTool
 * ================
 *
 * Read-only fetcher of on-chain "whale flow" proxies:
 *
 *   1. BTC mempool stats (mempool.space API) — congestion + fee pressure.
 *   2. BTC exchange net flow (blockchain.info / Coinglass free) — when the
 *      free endpoints do not expose this directly we surface the data we can
 *      get and label it as a network-activity proxy, never pretending to be
 *      actual exchange-flow data. The tool description says so explicitly.
 *   3. ETH gas price (public RPC eth_gasPrice via Etherscan free).
 *
 * Why these sources: all are free, no API key, rate-limit-friendly, and
 * representative of network activity. Real whale-alert / Glassnode / Nansen
 * endpoints are paywalled — if the operator wires in a paid key we can swap
 * the implementation here. The contract is that the tool returns a structured
 * snapshot; the LLM analyst can still infer "high fees → risk-off" without
 * us pretending to data we don't have.
 */

const InputSchema = z.object({
  asset: z.enum(['BTC', 'ETH']).default('BTC').describe('Which on-chain network to inspect.'),
  maxChars: z.number().int().min(50).max(2_000).default(400),
});

const OutputSchema = z.object({
  asset: z.enum(['BTC', 'ETH']),
  networkActivity: z.string(),
  feePressure: z.string(),
  exchangeFlow: z.string(),
  raw: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  summary: z.string(),
});

export type OnChainWhaleToolInput = z.infer<typeof InputSchema>;
export type OnChainWhaleToolOutput = z.infer<typeof OutputSchema>;

export function createOnChainWhaleTool(timeoutMs: number): ToolDefinition<
  OnChainWhaleToolInput,
  OnChainWhaleToolOutput
> {
  return {
    name: 'onchain-whale',
    description:
      "Read-only on-chain snapshot for BTC or ETH. Returns network activity, fee pressure and an exchange-flow proxy (labelled as such — real exchange-flow endpoints are paywalled). Use to gauge whether large holders are moving coins (high fees + rising mempool = activity).",
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    readonly: true,
    async execute(input, ctx): Promise<ToolResult<OnChainWhaleToolOutput>> {
      const startedAt = Date.now();
      try {
        const remainingMs = Math.max(500, ctx.deadlineMs - Date.now());
        const ac = new AbortController();
        const timeout = setTimeout(() => ac.abort(), Math.min(remainingMs, timeoutMs));

        try {
          if (input.asset === 'BTC') {
            const mempool = await fetchJson('https://mempool.space/api/mempool', ac.signal);
            const fees = await fetchJson('https://mempool.space/api/v1/fees/recommended', ac.signal);

            const m = (mempool.ok ? mempool.data : {}) as { count?: number; vsize?: number; totalFees?: number };
            const f = (fees.ok ? fees.data : {}) as { fastestFee?: number; halfHourFee?: number; hourFee?: number; economyFee?: number };

            const count = m.count ?? 0;
            const fastest = f.fastestFee ?? 0;
            const networkActivity = count > 50_000 ? 'high' : count > 10_000 ? 'moderate' : 'low';
            const feePressure = fastest > 100 ? 'high' : fastest > 30 ? 'moderate' : 'low';
            const exchangeFlow = 'exchange-flow requires paid API (Glassnode/Nansen); using mempool congestion as activity proxy only';
            const summary = `BTC on-chain: ${count} mempool txs, fastestFee=${fastest} sat/vB → activity ${networkActivity}, fees ${feePressure}`;

            return {
              ok: true,
              data: {
                asset: 'BTC',
                networkActivity,
                feePressure,
                exchangeFlow,
                raw: { count, fastestFee: fastest, halfHourFee: f.halfHourFee ?? 0, hourFee: f.hourFee ?? 0, economyFee: f.economyFee ?? 0 },
                summary: summary.slice(0, input.maxChars * 2),
              },
              latencyMs: Date.now() - startedAt,
              truncated: false,
            };
          }

          // ETH path: gas price from Etherscan free RPC. Use the public
          // eth_gasPrice RPC through etherscan.io's free endpoint shape.
          const gasRes = await fetchJson('https://api.etherscan.io/api?module=proxy&action=eth_gasPrice', ac.signal);
          const gasData = (gasRes.ok ? gasRes.data : {}) as { result?: string };
          // gasPrice comes back as a hex string in wei.
          const gasWei = gasData.result ? parseInt(gasData.result, 16) : 0;
          const gwei = gasWei / 1e9;
          const networkActivity = gwei > 50 ? 'high' : gwei > 15 ? 'moderate' : 'low';
          const feePressure = gwei > 50 ? 'high' : gwei > 20 ? 'moderate' : 'low';
          const exchangeFlow = 'exchange-flow requires paid API (Glassnode/Nansen); using gas price as activity proxy only';
          const summary = `ETH on-chain: gas=${gwei.toFixed(2)} gwei → activity ${networkActivity}, fees ${feePressure}`;

          return {
            ok: true,
            data: {
              asset: 'ETH',
              networkActivity,
              feePressure,
              exchangeFlow,
              raw: { gasPriceWei: gasWei, gasPriceGwei: gwei },
              summary: summary.slice(0, input.maxChars * 2),
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
          error: `onchain-whale: ${(err as Error).message}`,
          latencyMs: Date.now() - startedAt,
        };
      }
    },
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
