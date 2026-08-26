import { describe, it, expect, beforeEach } from 'vitest';
import { useAutonomousStore } from '../autonomousStore.js';
import type {
  AutonomousCycle,
  AutonomousForming,
  AutonomousRegime,
  AutonomousSignal,
  AutonomousRejected,
  AutonomousCircuitBreaker,
  AutonomousHealth,
  AutonomousExit,
  AutonomousLearning,
} from '../../lib/wsContracts.js';

const baseCycle: AutonomousCycle = {
  cycleId: 'cyc-1',
  startedAt: 1_700_000_000_000,
  completedAt: 1_700_000_030_000,
  durationMs: 30_000,
  symbolsScanned: 5,
  regimesChanged: 0,
  formingSetups: 1,
  readySetups: 0,
  signalsSubmitted: 0,
  signalsRejected: 0,
  standingAsideSymbols: 0,
  circuitBreakerTripped: false,
  runtimeRiskMultiplier: 1.0,
  rollingWinRate: 0,
  health: { healthy: true, issues: [], lastCheckedAt: 1_700_000_000_000 },
  exits: [],
  decisions: [],
};

describe('AutonomousStore ring buffers + brain-module state', () => {
  beforeEach(() => {
    useAutonomousStore.getState().reset();
  });

  it('AUTON-01: pushCycle stores newest first + sets hasReceivedCycle', () => {
    expect(useAutonomousStore.getState().hasReceivedCycle).toBe(false);
    useAutonomousStore.getState().pushCycle(baseCycle);
    const st = useAutonomousStore.getState();
    expect(st.hasReceivedCycle).toBe(true);
    expect(st.latestCycle?.cycleId).toBe('cyc-1');
    expect(st.cycles[0].cycleId).toBe('cyc-1');
  });

  it('AUTON-02: pushCycle bounds to 50 entries (ring buffer)', () => {
    for (let i = 0; i < 60; i++) {
      useAutonomousStore.getState().pushCycle({ ...baseCycle, cycleId: `cyc-${i}` });
    }
    expect(useAutonomousStore.getState().cycles.length).toBe(50);
    expect(useAutonomousStore.getState().cycles[0].cycleId).toBe('cyc-59');
    expect(useAutonomousStore.getState().latestCycle?.cycleId).toBe('cyc-59');
  });

  it('AUTON-03: setCircuitBreaker TRIPPED captures cooldown + reason', () => {
    const tripped: AutonomousCircuitBreaker = {
      action: 'tripped',
      reason: 'MAX_DAILY_LOSS_PCT exceeded',
      trippedAt: 1_700_000_000_000,
      cooldownEndsAt: 1_700_000_900_000,
    };
    useAutonomousStore.getState().setCircuitBreaker(tripped);
    const b = useAutonomousStore.getState().breaker;
    expect(b.tripped).toBe(true);
    expect(b.reason).toBe('MAX_DAILY_LOSS_PCT exceeded');
    expect(b.cooldownEndsAt).toBe(1_700_000_900_000);
    expect(b.lastAction).toBe('tripped');
  });

  it('AUTON-04: setCircuitBreaker CLEARED resets tripped + records clearedAt', () => {
    // Trip first
    useAutonomousStore.getState().setCircuitBreaker({
      action: 'tripped',
      reason: 'loss',
      trippedAt: 1_700_000_000_000,
    });
    expect(useAutonomousStore.getState().breaker.tripped).toBe(true);
    // Clear
    useAutonomousStore.getState().setCircuitBreaker({
      action: 'cleared',
      reason: 'cooldown elapsed',
      clearedAt: 1_700_000_500_000,
    });
    const b = useAutonomousStore.getState().breaker;
    expect(b.tripped).toBe(false);
    expect(b.clearedAt).toBe(1_700_000_500_000);
    expect(b.lastAction).toBe('cleared');
  });

  it('AUTON-05: setHealth replaces (not merges) the health snapshot', () => {
    const h1: AutonomousHealth = {
      healthy: false,
      issues: [{ kind: 'STALE_KLINES', symbol: 'BTCUSDT', detail: 'no klines for 5m' }],
      lastCheckedAt: 1_700_000_000_000,
    };
    useAutonomousStore.getState().setHealth(h1);
    expect(useAutonomousStore.getState().health?.healthy).toBe(false);
    expect(useAutonomousStore.getState().health?.issues.length).toBe(1);

    const h2: AutonomousHealth = {
      healthy: true,
      issues: [],
      lastCheckedAt: 1_700_000_010_000,
    };
    useAutonomousStore.getState().setHealth(h2);
    expect(useAutonomousStore.getState().health?.healthy).toBe(true);
    expect(useAutonomousStore.getState().health?.issues.length).toBe(0);
  });

  it('AUTON-06: each event type lands in its own ring buffer', () => {
    const forming: AutonomousForming = {
      cycleId: 'cyc-1',
      symbol: 'SOLUSDT',
      setupType: 'FVG_REVERSAL',
      state: 'WATCHING',
      direction: 'LONG',
    };
    const regime: AutonomousRegime = {
      cycleId: 'cyc-1',
      symbol: 'SOLUSDT',
      from: 'TRENDING_UP',
      to: 'RANGING',
      confidence: 0.78,
    };
    const signal: AutonomousSignal = {
      cycleId: 'cyc-1',
      symbol: 'SOLUSDT',
      action: 'OPEN_LONG',
      confidence: 0.72,
      regime: 'TRENDING_UP',
      setupType: 'SSL_SWEEP_REVERSAL_LONG',
      confluenceScore: 78,
      entryPrice: 150.5,
      stopLossPrice: 148.0,
      takeProfitPrice: 156.0,
      leverage: 5,
      sizePct: 0.02,
      rr: 2.2,
      rationale: 'confluence aligned',
      submittedAt: 1_700_000_000_000,
    };
    const rej: AutonomousRejected = {
      cycleId: 'cyc-1',
      symbol: 'BTCUSDT',
      action: 'OPEN_SHORT',
      reason: 'CIRCUIT_BREAKER_TRIPPED',
    };
    const exit: AutonomousExit = {
      cycleId: 'cyc-1',
      symbol: 'ETHUSDT',
      action: 'EXIT_NOW',
      reason: 'REGIME_FLIP',
      accepted: true,
    };
    const learn: AutonomousLearning = {
      cycleId: 'cyc-1',
      parameter: 'runtimeRiskMultiplier',
      from: 1.0,
      to: 1.1,
      rollingWinRate: 0.6,
      rollingSampleSize: 10,
    };

    useAutonomousStore.getState().pushForming(forming);
    useAutonomousStore.getState().pushRegime(regime);
    useAutonomousStore.getState().pushSignal(signal);
    useAutonomousStore.getState().pushRejection(rej);
    useAutonomousStore.getState().pushExit(exit);
    useAutonomousStore.getState().pushLearning(learn);

    const st = useAutonomousStore.getState();
    expect(st.forming[0].setupType).toBe('FVG_REVERSAL');
    expect(st.regimes[0].to).toBe('RANGING');
    expect(st.signals[0].rr).toBe(2.2);
    expect(st.rejections[0].reason).toBe('CIRCUIT_BREAKER_TRIPPED');
    expect(st.exits[0].accepted).toBe(true);
    expect(st.learning[0].to).toBe(1.1);
  });

  it('AUTON-07: hydrateFromSnapshot replaces current state but preserves ring buffers when snapshot omits them', () => {
    useAutonomousStore.getState().pushCycle(baseCycle);
    useAutonomousStore.getState().pushForming({
      cycleId: 'cyc-1',
      symbol: 'SOLUSDT',
      setupType: 'X',
      state: 'WATCHING',
    });
    // Pre-state
    expect(useAutonomousStore.getState().forming.length).toBe(1);

    // Hydrate with new current-state (latestCycle, breaker, health) but
    // OMIT the ring-buffer fields — they should be preserved, not wiped.
    useAutonomousStore.getState().hydrateFromSnapshot({
      latestCycle: { ...baseCycle, cycleId: 'cyc-hydrated' },
      breaker: { tripped: true, reason: 'r', trippedAt: 0, cooldownEndsAt: 0, clearedAt: null, lastAction: 'tripped' },
      health: { healthy: false, issues: [], lastCheckedAt: 0 },
      // Note: deliberately no forming/signals/etc. — preserved.
    });

    const st = useAutonomousStore.getState();
    expect(st.latestCycle?.cycleId).toBe('cyc-hydrated');
    expect(st.breaker.tripped).toBe(true);
    expect(st.health?.healthy).toBe(false);
    // Ring buffer preserved (snapshot didn't include forming)
    expect(st.forming.length).toBe(1);
    expect(st.forming[0].setupType).toBe('X');
  });

  it('AUTON-07b: hydrateFromSnapshot REPLACES ring buffers when snapshot provides a non-empty array', () => {
    useAutonomousStore.getState().pushForming({
      cycleId: 'cyc-1',
      symbol: 'OLD',
      setupType: 'OLD_TYPE',
      state: 'WATCHING',
    });
    expect(useAutonomousStore.getState().forming.length).toBe(1);

    // Hydrate with explicit forming — should replace, not append.
    useAutonomousStore.getState().hydrateFromSnapshot({
      latestCycle: null,
      forming: [
        { cycleId: 'cyc-new', symbol: 'NEW', setupType: 'NEW_TYPE', state: 'READY' },
      ],
    });

    const st = useAutonomousStore.getState();
    expect(st.forming.length).toBe(1);
    expect(st.forming[0].symbol).toBe('NEW');
  });

  it('AUTON-08: reset() returns to initial state', () => {
    useAutonomousStore.getState().pushCycle(baseCycle);
    useAutonomousStore.getState().pushForming({
      cycleId: 'cyc-1',
      symbol: 'X',
      setupType: 'Y',
      state: 'WATCHING',
    });
    useAutonomousStore.getState().setCircuitBreaker({
      action: 'tripped',
      reason: 'r',
      trippedAt: 1,
    });
    useAutonomousStore.getState().reset();
    const st = useAutonomousStore.getState();
    expect(st.cycles).toEqual([]);
    expect(st.latestCycle).toBeNull();
    expect(st.hasReceivedCycle).toBe(false);
    expect(st.forming).toEqual([]);
    expect(st.breaker.tripped).toBe(false);
    expect(st.health).toBeNull();
  });
});
