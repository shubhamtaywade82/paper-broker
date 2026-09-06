import { create } from 'zustand';
import type {
  AutonomousCycle,
  AutonomousForming,
  AutonomousRegime,
  AutonomousAnalysis,
  AutonomousSignal,
  AutonomousRejected,
  AutonomousCircuitBreaker,
  AutonomousHealth,
  AutonomousExit,
  AutonomousLearning,
} from '../lib/wsContracts.js';

/**
 * UI state for the Autonomous Trading Agent.
 *
 * The agent runs on its own 30s clock and broadcasts 8 distinct event types
 * (cycle, forming, regime, signal, rejected, circuit_breaker, health, exit,
 * learning). This store keeps the most recent N of each kind so the dashboard
 * panel can render a live picture without re-fetching.
 *
 * Ring buffers are bounded to prevent unbounded growth during long sessions.
 */

const MAX_CYCLES = 50;
const MAX_FORMING = 100;
const MAX_REGIMES = 50;
const MAX_SIGNALS = 50;
const MAX_REJECTIONS = 50;
const MAX_EXITS = 50;
const MAX_LEARNING = 50;

export interface CircuitBreakerState {
  /** Whether the breaker is currently tripped (refusing new entries). */
  tripped: boolean;
  /** Human-readable reason for the current trip (or last cleared reason). */
  reason: string | null;
  /** Epoch ms when the breaker tripped. */
  trippedAt: number | null;
  /** Epoch ms when the cooldown ends and entries resume. */
  cooldownEndsAt: number | null;
  /** Epoch ms when the breaker was last cleared. */
  clearedAt: number | null;
  /** Last action received: 'tripped' | 'cleared'. */
  lastAction: 'tripped' | 'cleared' | null;
}

export interface AutonomousStore {
  /** Last N cycle summaries (newest first). */
  cycles: AutonomousCycle[];
  /** Most recent cycle summary (alias of cycles[0]) — convenience for UI. */
  latestCycle: AutonomousCycle | null;
  /** True iff at least one cycle has been received — used to show a "waiting
   * for first cycle" placeholder on first mount. */
  hasReceivedCycle: boolean;

  /** Forming setups radar — newest first. */
  forming: AutonomousForming[];
  /** Recent regime transitions — newest first. */
  regimes: AutonomousRegime[];
  /** Recent submitted signals — newest first. */
  signals: AutonomousSignal[];
  /** Recent rejected entries — newest first. */
  rejections: AutonomousRejected[];
  /** Recent exit decisions — newest first. */
  exits: AutonomousExit[];
  /** Recent learning-loop adjustments — newest first. */
  learning: AutonomousLearning[];
  /** Latest market-intelligence analysis per symbol (kept per-symbol). */
  analyses: Record<string, AutonomousAnalysis['analysis']>;

  /** Circuit breaker current state. */
  breaker: CircuitBreakerState;
  /** Latest health snapshot from the HealthMonitor. */
  health: AutonomousHealth | null;

  // --- Mutators ---------------------------------------------------------
  pushCycle: (cycle: AutonomousCycle) => void;
  pushForming: (f: AutonomousForming) => void;
  pushRegime: (r: AutonomousRegime) => void;
  pushSignal: (s: AutonomousSignal) => void;
  pushRejection: (r: AutonomousRejected) => void;
  pushExit: (e: AutonomousExit) => void;
  pushLearning: (l: AutonomousLearning) => void;
  pushAnalysis: (a: AutonomousAnalysis) => void;
  setCircuitBreaker: (cb: AutonomousCircuitBreaker) => void;
  setHealth: (h: AutonomousHealth) => void;
  /**
   * Bulk-replace state from a REST snapshot (used on initial mount).
   *
   * Only replaces fields the snapshot explicitly provides — for ring-buffered
   * event arrays (forming, signals, etc.), passing `undefined` preserves any
   * entries already accumulated from WS broadcasts. The REST endpoint
   * `/api/v1/autonomous/snapshot` returns only the *current* state
   * (latestCycle, breaker, health) and omits the event history, so callers
   * should leave those fields out of the snapshot object rather than pass
   * empty arrays.
   */
  hydrateFromSnapshot: (snap: {
    latestCycle?: AutonomousCycle | null;
    breaker?: CircuitBreakerState | null;
    health?: AutonomousHealth | null;
    forming?: AutonomousForming[];
    signals?: AutonomousSignal[];
    rejections?: AutonomousRejected[];
    exits?: AutonomousExit[];
    learning?: AutonomousLearning[];
    regimes?: AutonomousRegime[];
  }) => void;
  reset: () => void;
}

const INITIAL_BREAKER: CircuitBreakerState = {
  tripped: false,
  reason: null,
  trippedAt: null,
  cooldownEndsAt: null,
  clearedAt: null,
  lastAction: null,
};

export const useAutonomousStore = create<AutonomousStore>()((set) => ({
  cycles: [],
  latestCycle: null,
  hasReceivedCycle: false,
  forming: [],
  regimes: [],
  signals: [],
  rejections: [],
  exits: [],
  learning: [],
  analyses: {},
  breaker: INITIAL_BREAKER,
  health: null,

  pushCycle: (cycle) =>
    set((st) => ({
      cycles: [cycle, ...st.cycles].slice(0, MAX_CYCLES),
      latestCycle: cycle,
      hasReceivedCycle: true,
    })),

  pushForming: (f) =>
    set((st) => ({ forming: [f, ...st.forming].slice(0, MAX_FORMING) })),

  pushRegime: (r) =>
    set((st) => ({ regimes: [r, ...st.regimes].slice(0, MAX_REGIMES) })),

  pushSignal: (s) =>
    set((st) => ({ signals: [s, ...st.signals].slice(0, MAX_SIGNALS) })),

  pushRejection: (r) =>
    set((st) => ({ rejections: [r, ...st.rejections].slice(0, MAX_REJECTIONS) })),

  pushExit: (e) => set((st) => ({ exits: [e, ...st.exits].slice(0, MAX_EXITS) })),

  pushLearning: (l) =>
    set((st) => ({ learning: [l, ...st.learning].slice(0, MAX_LEARNING) })),

  pushAnalysis: (a) =>
    set((st) => ({ analyses: { ...st.analyses, [a.symbol]: a.analysis } })),

  setCircuitBreaker: (cb) =>
    set(() => {
      if (cb.action === 'tripped') {
        return {
          breaker: {
            tripped: true,
            reason: cb.reason,
            trippedAt: cb.trippedAt ?? Date.now(),
            cooldownEndsAt: cb.cooldownEndsAt ?? null,
            clearedAt: null,
            lastAction: 'tripped',
          },
        };
      }
      return {
        breaker: {
          tripped: false,
          reason: cb.reason,
          trippedAt: null,
          cooldownEndsAt: null,
          clearedAt: cb.clearedAt ?? Date.now(),
          lastAction: 'cleared',
        },
      };
    }),

  setHealth: (h) => set(() => ({ health: h })),

  hydrateFromSnapshot: (snap) =>
    set((st) => ({
      // Replace current-state fields unconditionally (latestCycle, breaker,
      // health). If the snapshot doesn't include them, fall back to defaults
      // — but only the "current" fields; ring buffers are preserved below.
      latestCycle: snap.latestCycle !== undefined ? snap.latestCycle : st.latestCycle,
      hasReceivedCycle: snap.latestCycle != null ? true : st.hasReceivedCycle,
      cycles: snap.latestCycle ? [snap.latestCycle] : st.cycles,
      // breaker is non-null in the store; null input is treated as "no value
      // provided" (preserve existing). Same for health.
      breaker: snap.breaker ?? st.breaker,
      health: snap.health ?? st.health,
      // Ring buffers: only replace if the snapshot explicitly provides a
      // non-empty array. The REST snapshot doesn't return these — they only
      // arrive via WS broadcasts. So undefined / empty arrays preserve
      // existing entries; an explicit array REPLACES (e.g. for tests or
      // a future REST endpoint that returns recent history).
      forming: snap.forming && snap.forming.length > 0 ? snap.forming : st.forming,
      signals: snap.signals && snap.signals.length > 0 ? snap.signals : st.signals,
      rejections: snap.rejections && snap.rejections.length > 0 ? snap.rejections : st.rejections,
      exits: snap.exits && snap.exits.length > 0 ? snap.exits : st.exits,
      learning: snap.learning && snap.learning.length > 0 ? snap.learning : st.learning,
      regimes: snap.regimes && snap.regimes.length > 0 ? snap.regimes : st.regimes,
    })),

  reset: () =>
    set(() => ({
      cycles: [],
      latestCycle: null,
      hasReceivedCycle: false,
      forming: [],
      regimes: [],
      signals: [],
      rejections: [],
      exits: [],
      learning: [],
      analyses: {},
      breaker: INITIAL_BREAKER,
      health: null,
    })),
}));
