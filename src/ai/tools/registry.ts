import type {
  ToolCallLogEntry,
  ToolCatalogEntry,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from './types.js';

/**
 * ToolRegistry
 * ============
 *
 * Central catalog + invoker for the agent's read-only tools. Holds the
 * authoritative list of tools the LLM analyst stage may call, enforces
 * the read-only contract at registration time, validates I/O on every
 * invocation, and records a ring-buffer call log for observability.
 *
 * The registry is the single point at which an LLM touches the outside
 * world or internal broker state. Every tool call goes through `invoke()`,
 * which:
 *
 * 1. Looks up the tool by name (rejecting unknown names).
 * 2. Validates the input against the tool's Zod schema.
 * 3. Wraps `execute()` in a hard deadline — if the tool runs past
 *    `ctx.deadlineMs`, the call is failed with `error: 'timeout'`.
 * 4. Wraps `execute()` in a try/catch — a thrown error becomes
 *    `{ ok: false, error }` so a buggy tool never breaks the trading cycle.
 * 5. Validates the output against the tool's Zod schema.
 * 6. Records the call in the in-memory log.
 *
 * The registry is intentionally not persistent — tool call logs are
 * observability, not history. Persisting them would be a CONTRACTS.md
 * Section 4 (Event Log) violation: the event log is the source of truth
 * for *trading* history, and tool calls are not trading events.
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private callLog: ToolCallLogEntry[] = [];
  private readonly maxLogEntries: number;

  constructor(opts: { maxLogEntries?: number } = {}) {
    this.maxLogEntries = opts.maxLogEntries ?? 500;
  }

  /**
   * Register a tool. Rejects tools whose `readonly` field is not `true`
   * (the only allowed value today — write-capable tools would violate the
   * LLM Authority Contract). Rejects duplicate names.
   */
  register<I, O>(tool: ToolDefinition<I, O>): void {
    if (tool.readonly !== true) {
      throw new Error(
        `ToolRegistry.register: tool "${tool.name}" must declare readonly: true (LLM Authority Contract, CONTRACTS.md §5)`
      );
    }
    if (this.tools.has(tool.name)) {
      throw new Error(`ToolRegistry.register: tool "${tool.name}" is already registered`);
    }
    // Cast to <unknown, unknown> — the registry is heterogeneous; per-tool
    // generic types are preserved at the call site via `invoke<I, O>`.
    this.tools.set(tool.name, tool as unknown as ToolDefinition);
  }

  /** List tool names. */
  list(): string[] {
    return Array.from(this.tools.keys());
  }

  /** True if a tool with the given name is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Render the catalog for the LLM analyst prompt. Schemas are emitted as
   * plain JSON-Schema-ish objects so the model sees the shape without
   * pulling in Zod's full structure.
   */
  catalog(): ToolCatalogEntry[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      readonly: true,
      inputShape: renderSchemaShape(tool.inputSchema),
      outputShape: renderSchemaShape(tool.outputSchema),
    }));
  }

  /**
   * Invoke a tool by name with the given (untrusted) input. Returns a
   * discriminated {@link ToolResult} — never throws.
   */
  async invoke(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
    const startedAt = Date.now();
    const tool = this.tools.get(name);
    if (!tool) {
      const result: ToolResult = {
        ok: false,
        error: `unknown tool: ${name}`,
        latencyMs: Date.now() - startedAt,
      };
      this.appendLog({ ts: startedAt, cycleId: ctx.cycleId, symbol: ctx.symbol, toolName: name, input: rawInput, result, truncated: false });
      return result;
    }

    // 1. Validate input.
    const inputParseResult = tool.inputSchema.safeParse(rawInput);
    if (!inputParseResult.success) {
      const error = `input validation failed: ${inputParseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
      const result: ToolResult = { ok: false, error, latencyMs: Date.now() - startedAt };
      this.appendLog({ ts: startedAt, cycleId: ctx.cycleId, symbol: ctx.symbol, toolName: name, input: rawInput, result, truncated: false });
      return result;
    }
    const input = inputParseResult.data;

    // 2. Race execute() against a deadline. Use Promise.race with a manual
    //    timeout — we cannot abort fetch from inside the tool without an
    //    AbortController, which the tool itself owns; the registry's job is
    //    to enforce an outside wall.
    let result: ToolResult;
    try {
      const timeoutPromise = new Promise<ToolResult>((resolve) => {
        const remaining = ctx.deadlineMs - Date.now();
        const wait = Math.max(0, remaining);
        setTimeout(
          () =>
            resolve({
              ok: false,
              error: `timeout after ${wait}ms`,
              latencyMs: Date.now() - startedAt,
            }),
          wait
        );
      });
      result = await Promise.race([tool.execute(input, ctx), timeoutPromise]);
      if (result === undefined) {
        result = { ok: false, error: 'tool returned undefined', latencyMs: Date.now() - startedAt };
      }
    } catch (err) {
      result = {
        ok: false,
        error: `tool threw: ${(err as Error).message}`,
        latencyMs: Date.now() - startedAt,
      };
    }

    // 3. Validate output (only on success — failed results are passed through).
    if (result.ok) {
      const outputParse = tool.outputSchema.safeParse(result.data);
      if (!outputParse.success) {
        result = {
          ok: false,
          error: `output validation failed: ${outputParse.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
          latencyMs: Date.now() - startedAt,
        };
      } else {
        // Replace data with the parsed (and defaulted) version.
        result = { ...result, data: outputParse.data };
      }
    }

    this.appendLog({
      ts: startedAt,
      cycleId: ctx.cycleId,
      symbol: ctx.symbol,
      toolName: name,
      input: rawInput,
      result,
      truncated: result.ok ? result.truncated : false,
    });
    return result;
  }

  /**
   * Returns the most recent N tool call log entries (newest first).
   */
  recentCalls(limit = 50): ToolCallLogEntry[] {
    const start = Math.max(0, this.callLog.length - limit);
    return this.callLog.slice(start).reverse();
  }

  private appendLog(entry: ToolCallLogEntry): void {
    this.callLog.push(entry);
    if (this.callLog.length > this.maxLogEntries) {
      this.callLog.shift();
    }
  }
}

/**
 * Render a Zod schema as a plain JSON-Schema-ish object for the LLM catalog.
 * We deliberately keep this minimal — the model only needs to see the shape
 * (fields, types, required vs optional), not the full validation rules.
 */
function renderSchemaShape(schema: { _def?: { shape?: () => unknown } } | unknown): Record<string, unknown> {
  // Best-effort: pull the Zod object's shape() if available, otherwise return
  // a placeholder. This works for z.object(); for primitives we emit { type }.
  try {
    const s = schema as { _def?: { shape?: () => Record<string, unknown> } };
    if (s && s._def && typeof s._def.shape === 'function') {
      const shape = s._def.shape();
      const rendered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(shape)) {
        rendered[k] = renderPrimitiveShape(v);
      }
      return rendered;
    }
  } catch {
    // ignore — return placeholder below
  }
  return { type: 'unknown' };
}

function renderPrimitiveShape(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  const tag = (v as { _def?: { typeName?: string } })._def?.typeName;
  if (typeof tag === 'string') {
    if (tag.startsWith('ZodString')) return 'string';
    if (tag.startsWith('ZodNumber')) return 'number';
    if (tag.startsWith('ZodBoolean')) return 'boolean';
    if (tag.startsWith('ZodArray')) return 'array';
    if (tag.startsWith('ZodObject')) return 'object';
    if (tag.startsWith('ZodEnum')) return 'enum';
    if (tag.startsWith('ZodOptional') || tag.startsWith('ZodNullable')) {
      const inner = (v as { _def?: { innerType?: unknown } })._def?.innerType;
      return `${renderPrimitiveShape(inner)} | null`;
    }
  }
  return typeof v;
}
