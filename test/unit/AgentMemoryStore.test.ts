import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AgentMemoryStore } from '../../src/ai/memory/AgentMemoryStore.js';
import type { Reflection } from '../../src/ai/schemas.js';

/**
 * AgentMemoryStore unit tests.
 *
 * Covers:
 *   - recordReflection persists a row + extracts lessons
 *   - retrieveRelevantLessons finds lessons by FTS + filters by decay
 *   - decayLessons reduces scores; below floor → pruned
 *   - pruneOlderThan removes old reflections
 *   - renderAgentMemoryForPrompt returns the formatted block (or '' when empty)
 *   - separate SQLite file preserves the Event Log Contract (CONTRACTS.md §4)
 */
let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-memory-test-'));
  dbPath = path.join(tmpDir, 'agent_memory.sqlite3');
});

afterEach(() => {
  // tmpdir cleaned by the OS eventually; explicit cleanup is safer
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

const sampleReflection = (text: string, lessons: string[] = []): Reflection => ({
  reflection: text,
  lessons,
  selfConfidence: 0.7,
  nextTime: 'do better next time',
});

function makeStore(overrides: Partial<ConstructorParameters<typeof AgentMemoryStore>[0]> = {}) {
  return new AgentMemoryStore({
    dbPath,
    decayFloor: 0.1,
    pruneOlderThanMs: 90 * 86_400_000,
    topK: 5,
    ...overrides,
  });
}

describe('AgentMemoryStore', () => {
  it('starts empty', () => {
    const store = makeStore();
    expect(store.listLessons()).toEqual([]);
    expect(store.recentReflections()).toEqual([]);
    expect(store.renderAgentMemoryForPrompt({})).toBe('');
  });

  it('persists a reflection and extracts lessons into the lessons table', () => {
    const store = makeStore();
    const id = store.recordReflection({
      ts: Date.now(),
      symbol: 'BTCUSDT',
      regime: 'TRENDING_STRONG',
      strategyId: 'smc-agent-v1',
      action: 'CLOSE_LONG',
      outcomePnlUsdt: 42.5,
      reflection: sampleReflection('Strong follow-through after the sweep.', ['sweeps in strong trends work', 'confirm with HTF alignment']),
      modelUsed: 'gemma3:27b',
    });

    expect(id).toMatch(/^01/); // ulid prefix
    const reflections = store.recentReflections();
    expect(reflections.length).toBe(1);
    expect(reflections[0]!.symbol).toBe('BTCUSDT');
    expect(reflections[0]!.outcomePnlUsdt).toBe(42.5);
    expect(reflections[0]!.outcomeLabel).toBe('WIN');
    expect(reflections[0]!.lessonTags.length).toBe(2);

    const lessons = store.listLessons();
    expect(lessons.length).toBe(2);
    expect(lessons[0]!.decayScore).toBe(1.0);
  });

  it('retrieveRelevantLessons finds lessons by FTS free-text', () => {
    const store = makeStore();
    store.recordReflection({
      ts: Date.now(),
      symbol: 'BTCUSDT',
      regime: 'TRENDING_STRONG',
      strategyId: 'smc-agent-v1',
      action: 'CLOSE_LONG',
      outcomePnlUsdt: 10,
      reflection: sampleReflection('sweep in trending regime', ['sweeps in strong trends work']),
      modelUsed: 'gemma3:27b',
    });
    store.recordReflection({
      ts: Date.now(),
      symbol: 'ETHUSDT',
      regime: 'RANGING',
      strategyId: 'smc-agent-v1',
      action: 'CLOSE_SHORT',
      outcomePnlUsdt: -5,
      reflection: sampleReflection('range fades', ['ranging markets favor mean reversion']),
      modelUsed: 'gemma3:27b',
    });

    const sweepLessons = store.retrieveRelevantLessons({ freeText: 'sweep' });
    expect(sweepLessons.length).toBe(1);
    expect(sweepLessons[0]!.lessonText).toMatch(/sweep/);
  });

  it('retrieveRelevantLessons marks used lessons (hit_count + last_used_at)', () => {
    const store = makeStore();
    store.recordReflection({
      ts: Date.now(),
      symbol: 'BTCUSDT',
      regime: 'TRENDING_STRONG',
      strategyId: 'smc-agent-v1',
      action: 'CLOSE_LONG',
      outcomePnlUsdt: 10,
      reflection: sampleReflection('sweep', ['sweeps work']),
      modelUsed: 'gemma3:27b',
    });

    const retrieved = store.retrieveRelevantLessons({ freeText: 'sweep' });
    expect(retrieved.length).toBe(1);
    expect(retrieved[0]!.hitCount).toBe(1);
    expect(retrieved[0]!.lastUsedAt).not.toBeNull();
  });

  it('decayLessons reduces scores; lessons below the floor are pruned', () => {
    const store = makeStore({ decayFloor: 0.5 });
    store.recordReflection({
      ts: Date.now(),
      symbol: 'BTCUSDT',
      regime: 'TRENDING_STRONG',
      strategyId: 'smc-agent-v1',
      action: 'CLOSE_LONG',
      outcomePnlUsdt: 10,
      reflection: sampleReflection('sweep', ['sweeps work']),
      modelUsed: 'gemma3:27b',
    });

    // Each decay multiplies by 0.5 — two decays drops 1.0 → 0.25, below the 0.5 floor.
    store.decayLessons(0.5);
    expect(store.listLessons().length).toBe(1); // 1.0 -> 0.5, still at floor
    store.decayLessons(0.5);
    expect(store.listLessons().length).toBe(0); // 0.5 -> 0.25, pruned
  });

  it('pruneOlderThan removes reflections older than the cutoff', () => {
    const store = makeStore({ pruneOlderThanMs: 1_000 });
    const old = Date.now() - 2_000;
    store.recordReflection({
      ts: old,
      symbol: 'BTCUSDT',
      regime: 'TRENDING_STRONG',
      strategyId: 'smc-agent-v1',
      action: 'CLOSE_LONG',
      outcomePnlUsdt: 10,
      reflection: sampleReflection('old', ['old lesson']),
      modelUsed: 'gemma3:27b',
    });
    expect(store.recentReflections().length).toBe(1);
    // recordReflection lazily prunes — recording a fresh one triggers the cleanup
    store.recordReflection({
      ts: Date.now(),
      symbol: 'ETHUSDT',
      regime: 'RANGING',
      strategyId: 'smc-agent-v1',
      action: 'CLOSE_LONG',
      outcomePnlUsdt: 10,
      reflection: sampleReflection('new', ['new lesson']),
      modelUsed: 'gemma3:27b',
    });
    expect(store.recentReflections().length).toBe(1);
    expect(store.recentReflections()[0]!.symbol).toBe('ETHUSDT');
  });

  it('renderAgentMemoryForPrompt returns an empty string when no lessons exist', () => {
    const store = makeStore();
    expect(store.renderAgentMemoryForPrompt({ freeText: 'anything' })).toBe('');
  });

  it('renderAgentMemoryForPrompt returns a formatted block with decay + lesson text', () => {
    const store = makeStore();
    store.recordReflection({
      ts: Date.now(),
      symbol: 'BTCUSDT',
      regime: 'TRENDING_STRONG',
      strategyId: 'smc-agent-v1',
      action: 'CLOSE_LONG',
      outcomePnlUsdt: 10,
      reflection: sampleReflection('sweep', ['sweeps in trending regimes work when HTF aligned']),
      modelUsed: 'gemma3:27b',
    });
    const block = store.renderAgentMemoryForPrompt({ freeText: 'sweep' });
    expect(block).toMatch(/Past lessons/);
    expect(block).toMatch(/sweeps in trending/);
    expect(block).toMatch(/100%/); // decay score
  });

  it('survives a restart — reloading from the same file restores the lessons', () => {
    const store1 = makeStore();
    store1.recordReflection({
      ts: Date.now(),
      symbol: 'BTCUSDT',
      regime: 'TRENDING_STRONG',
      strategyId: 'smc-agent-v1',
      action: 'CLOSE_LONG',
      outcomePnlUsdt: 10,
      reflection: sampleReflection('sweep', ['sweeps work']),
      modelUsed: 'gemma3:27b',
    });
    store1.close();

    const store2 = makeStore();
    const lessons = store2.listLessons();
    expect(lessons.length).toBe(1);
    expect(lessons[0]!.lessonText).toMatch(/sweep/);
  });
});
