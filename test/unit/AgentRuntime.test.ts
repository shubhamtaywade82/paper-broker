import { describe, expect, it } from 'vitest';
import { AgentRuntime, breakoutRetestLongSkill } from '../../src/ai/agentRuntime.js';
import { TradingEventBus } from '../../src/strategy/market-state/index.js';
import type { TradingEvent } from '../../src/strategy/market-state/index.js';

function event(type: TradingEvent['type']): TradingEvent {
  return {
    id: 'evt-1',
    type,
    symbol: 'SOLUSDT',
    timestamp: 1_700_000_000_000,
    source: 'test',
    sequence: 1,
    payload: { setup: { id: 'setup-1', direction: 'LONG' } },
  };
}

describe('AgentRuntime', () => {
  it('does not wake on high-frequency events by default', async () => {
    const runtime = new AgentRuntime({ model: 'fake' }, async () => ({
      action: 'NO_TRADE',
      symbol: 'SOLUSDT',
      confidence: 0.5,
      rationale: 'ignored',
      requiredEvidence: [],
      contradictions: [],
    }));

    expect(runtime.shouldWake(event('TRADE'))).toBe(false);
    await expect(runtime.run({ event: event('TRADE'), facts: {} })).resolves.toBeNull();
  });

  it('uses skill-gated evidence tools and permits supervisor trade proposals', async () => {
    const runtime = new AgentRuntime({ model: 'fake', mode: 'SUPERVISOR', maxIterations: 2 }, async () => ({
      action: 'ENTER_LONG',
      symbol: 'SOLUSDT',
      confidence: 0.82,
      rationale: 'Deterministic setup is coherent and derivatives evidence is supportive.',
      requiredEvidence: ['market.oi'],
      contradictions: [],
      proposal: { setupId: 'setup-1', direction: 'LONG', entryZone: { low: 87.3, high: 87.7 }, invalidation: 83.8, targets: [91.1] },
    }));

    runtime.registerSkill(breakoutRetestLongSkill);
    runtime.registerTool({ name: 'analysis.structure', namespace: 'analysis', description: 'structure facts', execute: () => ({ trend: 'UP' }) });
    runtime.registerTool({ name: 'market.oi', namespace: 'market', description: 'open interest', execute: () => ({ state: 'RISING' }) });
    runtime.registerTool({ name: 'market.funding', namespace: 'market', description: 'funding', execute: () => ({ state: 'MODERATE' }) });

    const trace = await runtime.run({ event: event('SETUP_CREATED'), facts: { setupScore: 85 } });

    expect(trace?.decision.action).toBe('ENTER_LONG');
    expect(trace?.selectedSkillIds).toEqual(['breakout-retest-long']);
    expect(trace?.toolCalls).toEqual(['analysis.structure', 'market.oi']);
  });

  it('prevents unrestricted execution tools and observer execution actions', async () => {
    const observer = new AgentRuntime({ model: 'fake', mode: 'OBSERVER' }, async () => ({
      action: 'ENTER_LONG',
      symbol: 'SOLUSDT',
      confidence: 0.7,
      rationale: 'not allowed',
      requiredEvidence: [],
      contradictions: [],
    }));

    expect(() => observer.registerTool({ name: 'execution.placeOrder', namespace: 'execution', description: 'unsafe', execute: () => ({}) })).toThrow(/restricted/);
    await expect(observer.run({ event: event('SETUP_CREATED'), facts: {} })).rejects.toThrow(/Observer mode/);
  });

  it('can attach to the trading event bus and emit decisions only for meaningful events', async () => {
    const bus = new TradingEventBus();
    const decisions: string[] = [];
    const runtime = new AgentRuntime({ model: 'fake' }, async () => ({
      action: 'NO_TRADE',
      symbol: 'SOLUSDT',
      confidence: 0.9,
      rationale: 'observer classification only',
      requiredEvidence: [],
      contradictions: ['missing derivatives context'],
    }));

    const detach = runtime.attach(bus, () => ({ deterministic: true }), (trace) => decisions.push(trace.decision.action));
    await bus.publish(event('TRADE'));
    await bus.publish(event('REGIME_CHANGED'));
    detach();

    expect(decisions).toEqual(['NO_TRADE']);
  });
});
