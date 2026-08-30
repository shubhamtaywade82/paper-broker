import { type ZodType, type ZodTypeDef } from 'zod';

/**
 * Agentic Layer — Tool Framework
 * ===============================
 *
 * A bounded, read-only, schema-validated tool layer for the LLM analyst
 * stage of {@link TradingAgentsPipeline}. Tools let the agent pull fresh
 * external context (news, funding, OI, on-chain flows, Binance API docs) and
 * inspect internal state (market state, positions, account) before forming
 * its report. They never mutate anything — see CONTRACTS.md Section 5
 * (LLM Authority Contract): "LLM produces intent, not authority."
 *
 * Hard invariants enforced for every tool call:
 *
 * 1. **Read-only.** Every tool declares `readonly: true` (the only allowed
 *    value today). The framework rejects write-capable tools at registration
 *    time.
 * 2. **Bounded.** A single tool call MUST complete within the context's
 *    `deadlineMs`. Tools are expected to abort on deadline and return a
 *    failed `ToolResult` rather than throw.
 * 3. **Schema-validated.** Inputs and outputs are validated by Zod schemas.
 *    A tool whose output does not validate is returned as a failed
 *    `ToolResult` rather than propagated to the analyst.
 * 4. **Fail-closed.** Tools MUST NOT throw. Any error — network, schema,
 *    timeout — is captured as `{ ok: false, error }`. A broken tool never
 *    breaks the trading cycle.
 * 5. **Logged.** Every invocation is recorded by {@link ToolRegistry} for
 *    observability (`/api/v1/agent/tools`).
 *
 * These mirror the policy in `skills/agentic-llm/SKILL.md` Section "Tool
 * Policy (Future)".
 */

/**
 * Discriminated result of a single tool invocation.
 *
 * The shape is deliberately flat (no nested `{ success: ..., data: ... }`)
 * so the registry can record it verbatim into the call log without
 * post-processing, and so the analyst stage can pattern-match cleanly.
 */
export type ToolResult<T = unknown> =
  | {
      ok: true;
      data: T;
      latencyMs: number;
      /** True when the tool truncated its output to stay under the budget. */
      truncated: boolean;
    }
  | {
      ok: false;
      error: string;
      latencyMs: number;
    };

/**
 * Read-only context handed to every tool execution. The engine constructs
 * one per analyst-stage cycle and passes it through the registry.
 *
 * The inspectors (`marketState`, `accountState`) are deliberately functions,
 * not snapshots — the tool decides what to read and when, and the engine
 * can refresh them mid-cycle without re-issuing the context. They are
 * read-only by construction: they return serializable copies of state.
 */
export interface ToolContext {
  /** The symbol the analyst stage is currently evaluating. */
  symbol: string;
  /** The cycle ID for log correlation. */
  cycleId: string;
  /**
   * Hard wall-clock deadline (epoch ms) for this call. Tools MUST abort
   * after this point and return a failed `ToolResult`. The registry also
   * enforces this from the outside (defense in depth).
   */
  deadlineMs: number;
  /** Read-only market state inspector. */
  marketState: ToolMarketStateReader;
  /** Read-only account/positions inspector. */
  accountState: ToolAccountStateReader;
  /** Structured logger scoped to the tool call. */
  logger: ToolLogger;
}

export interface ToolMarketStateReader {
  /** Returns the current snapshot for a symbol, or undefined. */
  get(symbol: string): ToolMarketStateSnapshot | undefined;
  /** Returns the last N candles for a symbol+timeframe, oldest first. */
  candles(symbol: string, timeframe: string, count: number): ToolCandle[];
}

export interface ToolMarketStateSnapshot {
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
}

export interface ToolCandle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
}

export interface ToolAccountStateReader {
  /** Returns the current account state (equity, balance, etc). */
  get(): ToolAccountSnapshot;
  /** Returns all currently open positions. */
  positions(): ToolPosition[];
}

export interface ToolAccountSnapshot {
  equity: number;
  walletBalance: number;
  availableBalance: number;
  totalUnrealizedPnl: number;
  totalRealizedPnl: number;
  totalFees: number;
  totalFunding: number;
  liquidations: number;
}

export interface ToolPosition {
  symbol: string;
  side: 'LONG' | 'SHORT' | 'FLAT';
  quantity: number;
  entryPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  leverage: number;
  openedAt: number;
}

export interface ToolLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * A single tool definition. Tools are generic over their input `I` and
 * output `O`. The registry stores them as `ToolDefinition<unknown, unknown>`
 * and validates I/O via the schemas when invoked.
 */
export interface ToolDefinition<I = unknown, O = unknown> {
  /** Unique short name, lowercase kebab-case. Used in the LLM tool catalog. */
  name: string;
  /** One-paragraph description for the LLM tool catalog. */
  description: string;
  /** Zod schema for the tool's input. Accepts unknown and produces I. */
  inputSchema: ZodType<I, ZodTypeDef, unknown>;
  /** Zod schema for the tool's output. */
  outputSchema: ZodType<O, ZodTypeDef, unknown>;
  /**
   * Read-only assertion. The only allowed value is `true`. The registry
   * rejects any other value at registration time. This makes "read-only"
   * a type-level property the LLM Authority Contract can rely on.
   */
  readonly: true;
  /**
   * Execute the tool. MUST NOT throw — wrap every failure path into a
   * `{ ok: false, error }` result. The registry also wraps the call in a
   * try/catch as defense in depth.
   */
  execute(input: I, ctx: ToolContext): Promise<ToolResult<O>>;
}

/**
 * Compact catalog entry the registry hands to the LLM analyst prompt so the
 * model knows which tools exist and how to call them. Schemas are rendered
 * as plain JSON-Schema-ish objects so the LLM sees the shape.
 */
export interface ToolCatalogEntry {
  name: string;
  description: string;
  readonly: true;
  inputShape: Record<string, unknown>;
  outputShape: Record<string, unknown>;
}

/**
 * A single tool invocation as recorded by {@link ToolRegistry}. Kept
 * in-memory ring-buffer style (last N calls). Surfaced via
 * `/api/v1/agent/tools` for observability.
 */
export interface ToolCallLogEntry {
  ts: number;
  cycleId: string;
  symbol: string;
  toolName: string;
  input: unknown;
  result: ToolResult;
  truncated: boolean;
}
