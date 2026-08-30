import { z } from 'zod';
import type { ToolDefinition, ToolResult } from './types.js';

/**
 * MarketDataTool — read-only inspector over MarketStateManager.
 *
 * Lets the LLM analyst stage pull the current bid/ask/mark/funding/OI snapshot
 * for any symbol, plus the last N candles of any timeframe, without the model
 * having to be handed that data verbatim in the prompt.
 *
 * This is the only tool that reads internal broker/market state directly. It
 * exists because the analyst prompt may not always carry the full multi-symbol
 * MTF stack, and the model sometimes needs to ask "what's the 1h structure on
 * ETH right now?" or "show me the funding on the candidate symbol" mid-cycle.
 *
 * Read-only by construction — the reader hands back serializable snapshots
 * and never exposes the underlying MarketStateManager reference.
 */
export interface MarketDataToolDeps {
  /** Snapshot getter — supplied by engine from MarketStateManager. */
  get: (symbol: string) => {
    symbol: string;
    bid: number;
    ask: number;
    last: number;
    mark: number;
    spread: number;
    fundingRate?: number;
    openInterest?: number;
    ts: number;
    stale: boolean;
  } | undefined;
  /** Candle getter — supplied by engine from KlineStore. */
  candles: (symbol: string, timeframe: string, count: number) => Array<{
    openTime: number;
    closeTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    isClosed: boolean;
  }>;
}

const InputSchema = z.object({
  symbol: z.string().min(1).describe('Trading symbol, e.g. BTCUSDT'),
  timeframe: z
    .string()
    .optional()
    .describe('Candle timeframe (1m, 5m, 15m, 1h, 4h, 1d). Omit to fetch snapshot only.'),
  count: z.number().int().min(1).max(200).optional().describe('Number of candles to fetch (max 200).'),
});

const SnapshotSchema = z.object({
  symbol: z.string(),
  bid: z.number(),
  ask: z.number(),
  last: z.number(),
  mark: z.number(),
  spread: z.number(),
  fundingRate: z.number().optional(),
  openInterest: z.number().optional(),
  ts: z.number(),
  stale: z.boolean(),
});

const CandleSchema = z.object({
  openTime: z.number(),
  closeTime: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  isClosed: z.boolean(),
});

const OutputSchema = z.object({
  snapshot: SnapshotSchema.nullable(),
  candles: z.array(CandleSchema).default([]),
});

export type MarketDataToolInput = z.infer<typeof InputSchema>;
export type MarketDataToolOutput = z.infer<typeof OutputSchema>;

export function createMarketDataTool(deps: MarketDataToolDeps): ToolDefinition<MarketDataToolInput, MarketDataToolOutput> {
  return {
    name: 'market-data',
    description:
      "Read-only inspector for the engine's current market state. Returns the bid/ask/mark/funding/OI snapshot for a symbol, optionally plus the last N candles of a timeframe. Use to verify a price level or check funding before forming a directional view.",
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    readonly: true,
    async execute(input, _ctx): Promise<ToolResult<MarketDataToolOutput>> {
      const startedAt = Date.now();
      try {
        const snapshot = deps.get(input.symbol) ?? null;
        const candles =
          input.timeframe && input.count
            ? deps.candles(input.symbol, input.timeframe, input.count).slice(-input.count)
            : [];
        return {
          ok: true,
          data: { snapshot, candles },
          latencyMs: Date.now() - startedAt,
          truncated: false,
        };
      } catch (err) {
        return {
          ok: false,
          error: `market-data: ${(err as Error).message}`,
          latencyMs: Date.now() - startedAt,
        };
      }
    },
  };
}
