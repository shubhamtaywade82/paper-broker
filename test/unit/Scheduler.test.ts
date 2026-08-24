import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler } from '../../src/scheduler/jobs.js';
import type { PaperBroker } from '../../src/broker/PaperBroker.js';
import type { MarketStateManager } from '../../src/market/MarketState.js';
import type { SnapshotStore } from '../../src/persistence/SnapshotStore.js';
import type { StrategyEngine } from '../../src/strategy/StrategyEngine.js';
import type { EventLog } from '../../src/persistence/EventLog.js';

function makeState(symbol: string, nextFundingTimeUtc: string, stale = false) {
  return {
    symbol, stale, nextFundingTimeUtc,
    bid: 100, ask: 100.1, last: 100.05, mark: 100, fundingRate: 0.0001,
  };
}

function makeDeps(getAllStates: () => ReturnType<typeof makeState>[], applyFunding: ReturnType<typeof vi.fn>) {
  const broker = { getAccount: () => ({}), applyFunding } as unknown as PaperBroker;
  const marketState = { markStale: vi.fn(), getAllStates } as unknown as MarketStateManager;
  const snapshots = { saveAccountSnapshot: vi.fn(), saveMarketTick1s: vi.fn() } as unknown as SnapshotStore;
  const engine = { expireSignals: () => 0 } as unknown as StrategyEngine;
  const events = {} as unknown as EventLog;
  return { broker, marketState, snapshots, engine, events };
}

// Medium finding: broker.applyFunding() is a single GLOBAL operation (sweeps
// every open position across every symbol in one call), but the scheduler
// used to call it once per symbol that was due for funding within the same
// tick, and debounced repeats with a 1s wall-clock window inside a 5s-
// interval loop — a debounce that could never actually suppress a repeat on
// the *next* tick. Both bugs meant funding could be charged multiple times
// for the same window.
describe('Scheduler funding application (Medium)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies funding at most once per tick even when multiple symbols are simultaneously due', () => {
    const now = Date.now();
    const applyFunding = vi.fn();
    const states = [
      makeState('BTCUSDT', String(now - 1000)),
      makeState('ETHUSDT', String(now - 1000)),
      makeState('SOLUSDT', String(now - 1000)),
    ];
    const deps = makeDeps(() => states, applyFunding);

    const scheduler = new Scheduler({ ...deps, staleMarketMaxAgeMs: 5000 });
    scheduler.start();

    vi.advanceTimersByTime(5000);

    expect(applyFunding).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('does not re-apply funding for the same symbol until its funding window actually advances', () => {
    const now = Date.now();
    const applyFunding = vi.fn();
    let nextFundingTimeUtc = String(now - 1000);
    const deps = makeDeps(() => [makeState('BTCUSDT', nextFundingTimeUtc)], applyFunding);

    const scheduler = new Scheduler({ ...deps, staleMarketMaxAgeMs: 5000 });
    scheduler.start();

    vi.advanceTimersByTime(5000);
    expect(applyFunding).toHaveBeenCalledTimes(1);

    // Market feed hasn't advanced nextFundingTimeUtc yet — the next tick
    // must NOT re-apply funding for this symbol.
    vi.advanceTimersByTime(5000);
    expect(applyFunding).toHaveBeenCalledTimes(1);

    // Market feed advances to the next funding window — now it's due again.
    nextFundingTimeUtc = String(Date.now() - 1000);
    vi.advanceTimersByTime(5000);
    expect(applyFunding).toHaveBeenCalledTimes(2);

    scheduler.stop();
  });

  it('does not apply funding for stale or not-yet-due symbols', () => {
    const now = Date.now();
    const applyFunding = vi.fn();
    const states = [
      makeState('BTCUSDT', String(now + 60_000)), // not due yet
      makeState('ETHUSDT', String(now - 1000), true), // due but stale
    ];
    const deps = makeDeps(() => states, applyFunding);

    const scheduler = new Scheduler({ ...deps, staleMarketMaxAgeMs: 5000 });
    scheduler.start();

    vi.advanceTimersByTime(5000);

    expect(applyFunding).not.toHaveBeenCalled();
    scheduler.stop();
  });
});
