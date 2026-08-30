import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../../src/ai/tools/registry.js';
import type { ToolDefinition, ToolContext, ToolResult } from '../../src/ai/tools/types.js';

/**
 * ToolRegistry unit tests.
 *
 * Covers the five hard invariants documented in types.ts:
 *   1. Read-only enforcement (register rejects readonly !== true)
 *   2. Bounded invocation (deadline enforced via Promise.race)
 *   3. Schema validation on input + output
 *   4. Fail-closed (thrown errors become {ok:false})
 *   5. Call log is recorded for every invocation
 */
function buildCtx(deadlineMs = Date.now() + 5_000): ToolContext {
  return {
    symbol: 'BTCUSDT',
    cycleId: 'test-cycle',
    deadlineMs,
    marketState: {
      get: () => undefined,
      candles: () => [],
    },
    accountState: {
      get: () => ({
        equity: 10_000,
        walletBalance: 10_000,
        availableBalance: 10_000,
        totalUnrealizedPnl: 0,
        totalRealizedPnl: 0,
        totalFees: 0,
        totalFunding: 0,
        liquidations: 0,
      }),
      positions: () => [],
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
}

const EchoInput = z.object({ msg: z.string() });
const EchoOutput = z.object({ echoed: z.string() });

function makeEchoTool(): ToolDefinition<z.infer<typeof EchoInput>, z.infer<typeof EchoOutput>> {
  return {
    name: 'echo',
    description: 'echoes the input',
    inputSchema: EchoInput,
    outputSchema: EchoOutput,
    readonly: true,
    async execute(input): Promise<ToolResult<z.infer<typeof EchoOutput>>> {
      return { ok: true, data: { echoed: input.msg }, latencyMs: 0, truncated: false };
    },
  };
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('registers a read-only tool', () => {
    registry.register(makeEchoTool());
    expect(registry.list()).toEqual(['echo']);
    expect(registry.has('echo')).toBe(true);
  });

  it('rejects duplicate tool names', () => {
    registry.register(makeEchoTool());
    expect(() => registry.register(makeEchoTool())).toThrow(/already registered/);
  });

  it('rejects tools that do not declare readonly: true', () => {
    const bad = { ...makeEchoTool(), readonly: false } as ToolDefinition;
    expect(() => registry.register(bad)).toThrow(/readonly/);
  });

  it('validates input against the schema and rejects bad input', async () => {
    registry.register(makeEchoTool());
    const res = await registry.invoke('echo', { wrong: 'shape' }, buildCtx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/input validation failed/);
  });

  it('validates output against the schema and rejects bad output', async () => {
    const badOutput: ToolDefinition = {
      name: 'bad-output',
      description: 'returns a shape that does not match its outputSchema',
      inputSchema: z.object({}),
      outputSchema: z.object({ expected: z.string() }),
      readonly: true,
      async execute(): Promise<ToolResult<{ expected: string }>> {
        return { ok: true, data: { wrong: 'shape' } as unknown as { expected: string }, latencyMs: 0, truncated: false };
      },
    };
    registry.register(badOutput);
    const res = await registry.invoke('bad-output', {}, buildCtx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/output validation failed/);
  });

  it('returns ok with the validated output on a successful call', async () => {
    registry.register(makeEchoTool());
    const res = await registry.invoke('echo', { msg: 'hello' }, buildCtx());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ echoed: 'hello' });
  });

  it('captures thrown execute() errors as {ok:false}', async () => {
    const throwing: ToolDefinition = {
      name: 'throwing',
      description: 'always throws',
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      readonly: true,
      async execute(): Promise<ToolResult<{ ok: boolean }>> {
        throw new Error('boom');
      },
    };
    registry.register(throwing);
    const res = await registry.invoke('throwing', {}, buildCtx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/tool threw: boom/);
  });

  it('records every invocation in the call log', async () => {
    registry.register(makeEchoTool());
    await registry.invoke('echo', { msg: 'a' }, buildCtx());
    await registry.invoke('echo', { msg: 'b' }, buildCtx());
    const calls = registry.recentCalls(10);
    expect(calls.length).toBe(2);
    // Newest first
    expect(calls[0]!.input).toEqual({ msg: 'b' });
  });

  it('rejects unknown tool names with {ok:false}', async () => {
    const res = await registry.invoke('nonexistent', {}, buildCtx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/unknown tool/);
  });

  it('enforces the deadline via Promise.race against a setTimeout', async () => {
    const slow: ToolDefinition = {
      name: 'slow',
      description: 'sleeps past the deadline',
      inputSchema: z.object({}),
      outputSchema: z.object({ done: z.boolean() }),
      readonly: true,
      async execute(_input, ctx): Promise<ToolResult<{ done: boolean }>> {
        // Sleep 200ms past the deadline
        const sleep = ctx.deadlineMs - Date.now() + 200;
        await new Promise((r) => setTimeout(r, Math.max(50, sleep)));
        return { ok: true, data: { done: true }, latencyMs: 0, truncated: false };
      },
    };
    registry.register(slow);
    // 100ms deadline — well below the slow tool's 200ms extra sleep
    const res = await registry.invoke('slow', {}, buildCtx(Date.now() + 100));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/timeout/);
  });

  it('catalog() returns entries with rendered shapes', () => {
    registry.register(makeEchoTool());
    const cat = registry.catalog();
    expect(cat.length).toBe(1);
    expect(cat[0]!.name).toBe('echo');
    expect(cat[0]!.readonly).toBe(true);
    expect(cat[0]!.inputShape).toBeDefined();
    expect(cat[0]!.outputShape).toBeDefined();
  });
});
