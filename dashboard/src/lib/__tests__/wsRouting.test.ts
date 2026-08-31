import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupWsRouting } from '../wsRouting.js';
import { useAutonomousStore } from '../../stores/autonomousStore.js';
import { useTradingStore } from '../../stores/tradingStore.js';

// Mock the wsManager so dispatch happens synchronously via on('*').
// We don't need real WebSocket plumbing — only the routing logic.
vi.mock('../wsConnection.js', () => ({
  wsManager: {
    on: (_channel: string, fn: (m: unknown) => void) => {
      // Capture the handler so tests can invoke it directly.
      (globalThis as unknown as { __wsRoutingHandler?: (m: unknown) => void }).__wsRoutingHandler = fn;
      return () => {
        delete (globalThis as unknown as { __wsRoutingHandler?: (m: unknown) => void }).__wsRoutingHandler;
      };
    },
    subscribe: () => {},
    connect: () => {},
    disconnect: () => {},
    statusSnapshot: 'idle' as const,
    onStatus: () => () => {},
  },
}));

function dispatch(m: unknown): void {
  const handler = (globalThis as unknown as { __wsRoutingHandler?: (m: unknown) => void }).__wsRoutingHandler;
  if (!handler) throw new Error('wsManager.on was never called — setupWsRouting not run');
  handler(m);
}

describe('wsRouting — autonomous event dispatch', () => {
  let cleanup: () => void;

  beforeEach(() => {
    useAutonomousStore.getState().reset();
    useTradingStore.getState().reset();
    cleanup = setupWsRouting();
  });

  afterEach(() => {
    cleanup();
  });

  it('WS-ROUTE-01: agent.autonomous.cycle pushes to autonomousStore + syncs health', () => {
    const cycle = {
      cycleId: 'cyc-1',
      startedAt: 1,
      completedAt: 2,
      durationMs: 1,
      symbolsScanned: 3,
      regimesChanged: 0,
      formingSetups: 1,
      readySetups: 0,
      signalsSubmitted: 0,
      signalsRejected: 0,
      standingAsideSymbols: 0,
      circuitBreakerTripped: false,
      runtimeRiskMultiplier: 1.0,
      rollingWinRate: 0,
      health: { healthy: true, issues: [], lastCheckedAt: 1 },
      exits: [],
      decisions: [],
    };
    dispatch({
      type: 'agent.autonomous.cycle',
      payload: cycle,
      timestampUtc: new Date().toISOString(),
    });
    expect(useAutonomousStore.getState().latestCycle?.cycleId).toBe('cyc-1');
    expect(useAutonomousStore.getState().health?.healthy).toBe(true);
  });

  it('WS-ROUTE-02: agent.autonomous.circuit_breaker TRIPPED sets breaker.tripped', () => {
    dispatch({
      type: 'agent.autonomous.circuit_breaker',
      payload: { action: 'tripped', reason: 'MAX_DAILY_LOSS_PCT', trippedAt: 1, cooldownEndsAt: 2 },
      timestampUtc: new Date().toISOString(),
    });
    expect(useAutonomousStore.getState().breaker.tripped).toBe(true);
    expect(useAutonomousStore.getState().breaker.cooldownEndsAt).toBe(2);
  });

  it('WS-ROUTE-03: agent.autonomous.signal pushes to signals ring buffer', () => {
    const signal = {
      cycleId: 'cyc-1',
      symbol: 'SOLUSDT',
      action: 'OPEN_LONG',
      confidence: 0.8,
      regime: 'TRENDING_UP',
      setupType: 'FVG',
      confluenceScore: 80,
      entryPrice: 100,
      stopLossPrice: 95,
      takeProfitPrice: 110,
      leverage: 5,
      sizePct: 0.02,
      rr: 2.0,
      rationale: 'aligned',
      submittedAt: 1,
    };
    dispatch({
      type: 'agent.autonomous.signal',
      payload: signal,
      timestampUtc: new Date().toISOString(),
    });
    expect(useAutonomousStore.getState().signals[0].symbol).toBe('SOLUSDT');
  });

  it('WS-ROUTE-04: position.updated routes to tradingStore (existing behaviour preserved)', () => {
    const pos = {
      id: 'pos-1',
      symbol: 'BTCUSDT',
      side: 'LONG' as const,
      quantity: 1.5,
      entryPrice: 50_000,
      markPrice: 51_000,
      unrealizedPnl: 1500,
      status: 'OPEN' as const,
    };
    dispatch({
      type: 'position.updated',
      payload: pos,
      timestampUtc: new Date().toISOString(),
    });
    expect(useTradingStore.getState().positions['pos-1']).toBeDefined();
  });

  it('WS-ROUTE-05: account.reset resets tradingStore positions and open orders', () => {
    useTradingStore.getState().upsertPosition({
      id: 'pos-1',
      symbol: 'BTCUSDT',
      side: 'LONG' as const,
      quantity: 1.5,
      entryPrice: 50_000,
      markPrice: 51_000,
      unrealizedPnl: 1500,
      status: 'OPEN' as const,
    });
    expect(Object.keys(useTradingStore.getState().positions).length).toBe(1);

    dispatch({
      type: 'account.reset',
      payload: { startingBalance: 10000 },
      timestampUtc: new Date().toISOString(),
    });

    expect(Object.keys(useTradingStore.getState().positions).length).toBe(0);
    expect(useTradingStore.getState().openOrders.length).toBe(0);
  });

  // Regression: agent.step was broadcast by the backend (engine.ts onCycleStep,
  // server.ts trigger route) but was absent from WsMessageSchema, so
  // wsConnection's `WsMessageSchema.parse()` threw and the bare `catch {}`
  // dropped every frame at the socket boundary. addLiveEvent had zero callers
  // and liveEvents was permanently empty, which made the live transcript read
  // "0 Steps" forever, pinned all five Decision Pipeline stages to "idle", and
  // made the LLM-latency vital read "Never run" regardless of what the model
  // actually did.
  it('WS-ROUTE-07: agent.step lands in liveEvents as agent_step', () => {
    const before = useStore.getState().liveEvents.length;
    dispatch({
      type: 'agent.step',
      payload: {
        cycleId: 'cyc-9',
        symbol: 'SOLUSDT',
        stage: 'debate_bull',
        status: 'started',
        timestamp: 1700000000000,
      },
      timestampUtc: new Date().toISOString(),
    });

    const events = useStore.getState().liveEvents;
    expect(events.length).toBe(before + 1);
    // Both consumers (AgentControlCenterView.asStep and ActivityView) match on
    // the underscore form, so the router must normalise to it.
    expect(events[0]?.type).toBe('agent_step');
    expect(events[0]?.payload.stage).toBe('debate_bull');
    expect(events[0]?.payload.cycleId).toBe('cyc-9');
  });

  it('WS-ROUTE-08: agent.cycle lands in liveEvents', () => {
    dispatch({
      type: 'agent.cycle',
      payload: { cycleId: 'cyc-9', symbol: 'SOLUSDT', action: 'OPEN_LONG', confidence: 0.7 },
      timestampUtc: new Date().toISOString(),
    });

    const events = useStore.getState().liveEvents;
    // ActivityView already has a `case 'agent.cycle'` waiting for this.
    expect(events[0]?.type).toBe('agent.cycle');
  });

  it('WS-ROUTE-06: market.tick routes to useStore setLivePrice', () => {
    const tick = {
      symbol: 'SOLUSDT',
      price: 185.5,
    };
    dispatch({
      type: 'market.tick',
      payload: tick,
      timestampUtc: new Date().toISOString(),
    });
    expect(useStore.getState().livePrice['SOLUSDT']).toBe(185.5);
  });
});

// Need to import afterEach for the cleanup call.
import { afterEach } from 'vitest';
import { useStore } from '../../store/useStore.js';
