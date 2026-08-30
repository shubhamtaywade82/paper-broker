import { describe, it, expect } from 'vitest';
import { deriveAgentState, formatSince } from '../AgentStateBar';
import type { CircuitBreakerState } from '../../../stores/autonomousStore';
import type { AutonomousCycle, AutonomousHealth } from '../../../lib/wsContracts';

const IDLE_BREAKER: CircuitBreakerState = {
  tripped: false,
  reason: null,
  trippedAt: null,
  cooldownEndsAt: null,
  clearedAt: null,
  lastAction: null,
};

const HEALTHY: AutonomousHealth = { healthy: true, issues: [], lastCheckedAt: 1000 };

function cycle(over: Partial<AutonomousCycle> = {}): AutonomousCycle {
  return {
    cycleId: 'c1',
    startedAt: 1000,
    completedAt: 1073,
    durationMs: 73,
    symbolsScanned: 5,
    regimesChanged: 0,
    formingSetups: 0,
    readySetups: 0,
    signalsSubmitted: 0,
    signalsRejected: 0,
    standingAsideSymbols: 5,
    circuitBreakerTripped: false,
    runtimeRiskMultiplier: 1,
    rollingWinRate: 0,
    health: HEALTHY,
    exits: [],
    decisions: [],
    ...over,
  } as AutonomousCycle;
}

describe('deriveAgentState', () => {
  it('reports halted when the breaker is tripped, naming the reason', () => {
    const state = deriveAgentState(
      { ...IDLE_BREAKER, tripped: true, reason: 'MARKET_UNHEALTHY', trippedAt: 500 },
      HEALTHY,
      cycle()
    );

    expect(state.posture).toBe('halted');
    expect(state.headline).toBe('Not trading');
    expect(state.because).toContain('market unhealthy');
    expect(state.since).toBe(500);
  });

  // The breaker is what actually refuses the entry, so it outranks stale data
  // even when both are true — otherwise the operator is told to fix the feed
  // while a tripped breaker would keep blocking anyway.
  it('a tripped breaker outranks health issues', () => {
    const unhealthy: AutonomousHealth = {
      healthy: false,
      issues: [{ kind: 'KLINE_STALE', detail: 'SOLUSDT 4h' }],
      lastCheckedAt: 900,
    };
    const state = deriveAgentState(
      { ...IDLE_BREAKER, tripped: true, reason: 'MAX_DRAWDOWN', trippedAt: 500 },
      unhealthy,
      cycle()
    );

    expect(state.posture).toBe('halted');
  });

  it('reports degraded when health issues exist and the breaker is clear', () => {
    const unhealthy: AutonomousHealth = {
      healthy: false,
      issues: [
        { kind: 'KLINE_STALE', detail: 'SOLUSDT 4h' },
        { kind: 'KLINE_STALE', detail: 'SOLUSDT 1h' },
      ],
      lastCheckedAt: 900,
    };
    const state = deriveAgentState(IDLE_BREAKER, unhealthy, cycle());

    expect(state.posture).toBe('degraded');
    expect(state.because).toContain('2 health issues');
  });

  it('reports trading once a cycle actually submitted an entry', () => {
    const state = deriveAgentState(IDLE_BREAKER, HEALTHY, cycle({ signalsSubmitted: 2 }));

    expect(state.posture).toBe('trading');
    expect(state.because).toContain('2 entries submitted');
  });

  // The agent cycles every ~30s but enters far less often. Judging posture on
  // "did the LAST cycle submit" alone makes an agent holding three winners read
  // "no qualifying setup" on almost every cycle, flickering to "Trading" for
  // one cycle at a time.
  it('reports in-market while positions are open and no new entry qualified', () => {
    const state = deriveAgentState(IDLE_BREAKER, HEALTHY, cycle(), 3);

    expect(state.posture).toBe('in-market');
    expect(state.headline).toContain('3 open positions');
    expect(state.because).toContain('Managing open risk');
  });

  it('singularises a lone open position', () => {
    expect(deriveAgentState(IDLE_BREAKER, HEALTHY, cycle(), 1).headline).toContain('1 open position');
  });

  it('a fresh entry still outranks in-market', () => {
    const state = deriveAgentState(IDLE_BREAKER, HEALTHY, cycle({ signalsSubmitted: 1 }), 3);
    expect(state.posture).toBe('trading');
  });

  it('blockers still outrank open positions', () => {
    const state = deriveAgentState(
      { ...IDLE_BREAKER, tripped: true, reason: 'MAX_DAILY_LOSS', trippedAt: 500 },
      HEALTHY,
      cycle(),
      3
    );
    expect(state.posture).toBe('halted');
  });

  // The important distinction the old page never drew: nothing blocking and
  // nothing traded is "no setup qualified", not "autonomous mode: on".
  it('reports scanning when nothing blocks, nothing qualified and nothing is open', () => {
    const state = deriveAgentState(IDLE_BREAKER, HEALTHY, cycle({ readySetups: 0 }), 0);

    expect(state.posture).toBe('scanning');
    expect(state.because).toContain('5 symbols scanned');
    expect(state.because).toContain('none cleared');
  });

  it('reports waiting before the first cycle arrives', () => {
    const state = deriveAgentState(IDLE_BREAKER, null, null);

    expect(state.posture).toBe('scanning');
    expect(state.because).toContain('first cycle');
  });
});

describe('formatSince', () => {
  const now = 1_000_000_000;

  it('formats hours and minutes', () => {
    expect(formatSince(now - (21 * 60 + 11) * 60_000, now)).toBe('21h 11m ago');
  });

  it('formats minutes alone under an hour', () => {
    expect(formatSince(now - 3 * 60_000, now)).toBe('3m ago');
  });

  it('collapses sub-minute ages', () => {
    expect(formatSince(now - 5_000, now)).toBe('just now');
  });

  it('returns null for missing or future timestamps', () => {
    expect(formatSince(null, now)).toBeNull();
    expect(formatSince(0, now)).toBeNull();
    expect(formatSince(now + 60_000, now)).toBeNull();
  });
});
