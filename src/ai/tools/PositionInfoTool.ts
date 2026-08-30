import { z } from 'zod';
import type { ToolDefinition, ToolResult } from './types.js';

/**
 * PositionInfoTool — read-only inspector over the paper broker's account and
 * open positions.
 *
 * Lets the LLM analyst stage ask "what's currently in the book?" before
 * proposing a new entry, so the model can factor in correlation exposure and
 * free margin. The output mirrors the engine's existing ToolAccountSnapshot
 * / ToolPosition shapes so the analyst prompt stays consistent with the
 * tool catalog.
 *
 * Read-only by construction — the deps getters return deep copies of state.
 */
export interface PositionInfoToolDeps {
  getAccount: () => {
    equity: number;
    walletBalance: number;
    availableBalance: number;
    totalUnrealizedPnl: number;
    totalRealizedPnl: number;
    totalFees: number;
    totalFunding: number;
    liquidations: number;
  };
  getPositions: () => Array<{
    symbol: string;
    side: 'LONG' | 'SHORT' | 'FLAT';
    quantity: number;
    entryPrice: number;
    unrealizedPnl: number;
    realizedPnl: number;
    leverage: number;
    openedAt: number;
  }>;
}

const InputSchema = z
  .object({
    symbol: z
      .string()
      .optional()
      .describe('Optional filter — only return positions matching this symbol.'),
  })
  .default({});

const PositionSchema = z.object({
  symbol: z.string(),
  side: z.enum(['LONG', 'SHORT', 'FLAT']),
  quantity: z.number(),
  entryPrice: z.number(),
  unrealizedPnl: z.number(),
  realizedPnl: z.number(),
  leverage: z.number(),
  openedAt: z.number(),
});

const AccountSchema = z.object({
  equity: z.number(),
  walletBalance: z.number(),
  availableBalance: z.number(),
  totalUnrealizedPnl: z.number(),
  totalRealizedPnl: z.number(),
  totalFees: z.number(),
  totalFunding: z.number(),
  liquidations: z.number(),
});

const OutputSchema = z.object({
  account: AccountSchema,
  positions: z.array(PositionSchema),
  exposureSummary: z.object({
    longCount: z.number(),
    shortCount: z.number(),
    netLongPct: z.number(),
    correlationRisk: z.string(),
  }),
});

export type PositionInfoToolInput = z.infer<typeof InputSchema>;
export type PositionInfoToolOutput = z.infer<typeof OutputSchema>;

export function createPositionInfoTool(deps: PositionInfoToolDeps): ToolDefinition<
  PositionInfoToolInput,
  PositionInfoToolOutput
> {
  return {
    name: 'position-info',
    description:
      'Read-only inspector for the paper broker account and open positions. Returns equity, available balance, and every open position with entry/unrealized PnL/leverage. Use before proposing an entry to check correlation exposure and free margin.',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    readonly: true,
    async execute(input, _ctx): Promise<ToolResult<PositionInfoToolOutput>> {
      const startedAt = Date.now();
      try {
        const account = deps.getAccount();
        const all = deps.getPositions();
        const positions = input.symbol ? all.filter((p) => p.symbol === input.symbol) : all;

        const longs = positions.filter((p) => p.side === 'LONG');
        const shorts = positions.filter((p) => p.side === 'SHORT');
        const netLongPct = positions.length === 0 ? 0 : (longs.length - shorts.length) / positions.length;

        // Rough qualitative correlation-risk read. The autonomous agent has
        // a real Pearson-ρ guard; this string just lets the analyst prompt
        // see "all long" vs "mixed book" without recomputing ρ.
        let correlationRisk = 'unknown';
        if (positions.length === 0) correlationRisk = 'no exposure';
        else if (shorts.length === 0) correlationRisk = 'all long — concentrated directional risk';
        else if (longs.length === 0) correlationRisk = 'all short — concentrated directional risk';
        else if (Math.abs(netLongPct) <= 0.34) correlationRisk = 'mixed book — diversification reasonable';
        else correlationRisk = 'skewed book — partial concentration';

        return {
          ok: true,
          data: {
            account,
            positions,
            exposureSummary: {
              longCount: longs.length,
              shortCount: shorts.length,
              netLongPct,
              correlationRisk,
            },
          },
          latencyMs: Date.now() - startedAt,
          truncated: false,
        };
      } catch (err) {
        return {
          ok: false,
          error: `position-info: ${(err as Error).message}`,
          latencyMs: Date.now() - startedAt,
        };
      }
    },
  };
}
