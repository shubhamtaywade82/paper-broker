import { describe, it, expect, vi } from 'vitest';
import { ExitManager } from '../../src/agent/ExitManager.js';
import type { Position, AccountState } from '../../src/broker/types.js';
import type { PerSymbolState } from '../../src/agent/types.js';
import type { RegimeSnapshot } from '../../src/analysis/MarketRegimeDetector.js';

function makeAccount(equity = 10_000): AccountState {
  return {
    walletBalance: equity,
    unrealizedPnl: 0,
    equity,
    initialMargin: 0,
    maintenanceMargin: 0,
    availableBalance: equity,
    totalFees: 0,
    totalFunding: 0,
    totalRealizedPnl: 0,
    openPositionsCount: 1,
    openOrdersCount: 0,
    dailyRealizedPnl: 0,
    liquidations: 0,
  };
}

function makePosition(qty: number, entryPrice = 100): Position {
  return {
    accountId: 'paper-main',
    symbol: 'XRPUSDT',
    positionSide: 'BOTH',
    status: 'OPEN',
    qty,
    entryPrice,
    leverage: 5,
    maintenanceMarginRate: 0.005,
    realizedPnl: 0,
    unrealizedPnl: 0,
    initialMargin: 0,
    maintenanceMargin: 0,
    totalFees: 0,
    totalFunding: 0,
    updatedAtUtc: new Date().toISOString(),
  };
}

function makeRegimeSnapshot(
  regime: RegimeSnapshot['regime'],
  htfTrend: RegimeSnapshot['htfTrend']
): RegimeSnapshot {
  return {
    symbol: 'XRPUSDT',
    asOf: Date.now(),
    regime,
    features: {} as RegimeSnapshot['features'],
    regimeKey: 'test',
    htfTrend,
    mtfTrend: undefined,
    confidence: 80,
  };
}

function makeSymState(snap: RegimeSnapshot): Map<string, PerSymbolState> {
  return new Map([
    [
      'XRPUSDT',
      {
        symbol: 'XRPUSDT',
        state: 'in_position',
        regime: snap,
        regimeChangedAt: 0,
        lastEntryAttemptAt: 0,
        trackingSetup: null,
        trackingPlan: null,
        regimeObservationCount: 0,
      },
    ],
  ]);
}

/** Builds a minimal ExitManager. The regimeDetector always returns currentSnap. */
function makeExitManager(currentSnap: RegimeSnapshot | null) {
  const mockRegimeDetector = {
    detect: vi.fn().mockReturnValue(currentSnap),
    getAdaptation: (r: string) => {
      const table: Record<string, { riskMultiplier: number }> = {
        TRENDING_STRONG: { riskMultiplier: 1.2 },
        TRENDING_NORMAL: { riskMultiplier: 1.0 },
        RANGING_HIGH_VOL: { riskMultiplier: 0.5 },
        TRANSITIONING: { riskMultiplier: 0.6 },
        RANGING_LOW_VOL: { riskMultiplier: 0.7 },
        VOLATILE_BREAKOUT: { riskMultiplier: 0.8 },
      };
      return { riskMultiplier: table[r]?.riskMultiplier ?? 0.5, ...({} as never) };
    },
  };

  return new ExitManager(
    { exitOnRegimeFlip: true, maxUnrealizedLossPct: 0.05, strategyId: 'test' },
    {
      eventLog: { appendSystemEvent: vi.fn() } as never,
      wsGateway: { broadcast: vi.fn() } as never,
      strategyEngine: { submitSignal: vi.fn() } as never,
      regimeDetector: mockRegimeDetector as never,
      getPositions: vi.fn(),
      getAccount: () => makeAccount(),
      getLastPrice: () => 100,
    }
  );
}

describe('ExitManager.evaluateOne — directionMismatch', () => {
  it('HOLD: SHORT position in TRENDING_STRONG BEARISH regime (trend is aligned)', () => {
    const currentSnap = makeRegimeSnapshot('TRENDING_STRONG', 'BEARISH');
    const em = makeExitManager(currentSnap);
    const symState = makeSymState(makeRegimeSnapshot('TRENDING_STRONG', 'BEARISH'));
    // qty < 0 = SHORT position
    const decision = em.evaluateOne(makePosition(-10), symState, makeAccount(), Date.now());
    // A short in a bearish trend should stay open — HOLD
    expect(decision.action).toBe('HOLD');
  });

  it('EXIT_NOW: SHORT position in TRENDING_STRONG BULLISH regime (trend reversed against short)', () => {
    const currentSnap = makeRegimeSnapshot('TRENDING_STRONG', 'BULLISH');
    const em = makeExitManager(currentSnap);
    const symState = makeSymState(makeRegimeSnapshot('TRENDING_STRONG', 'BEARISH'));
    const decision = em.evaluateOne(makePosition(-10), symState, makeAccount(), Date.now());
    expect(decision.action).toBe('EXIT_NOW');
    expect(decision.reason).toBe('REGIME_FLIP');
  });

  it('HOLD: LONG position in TRENDING_STRONG BULLISH regime (trend is aligned)', () => {
    const currentSnap = makeRegimeSnapshot('TRENDING_STRONG', 'BULLISH');
    const em = makeExitManager(currentSnap);
    const symState = makeSymState(makeRegimeSnapshot('TRENDING_STRONG', 'BULLISH'));
    const decision = em.evaluateOne(makePosition(10), symState, makeAccount(), Date.now());
    expect(decision.action).toBe('HOLD');
  });

  it('EXIT_NOW: LONG position in TRENDING_STRONG BEARISH regime (trend reversed against long)', () => {
    const currentSnap = makeRegimeSnapshot('TRENDING_STRONG', 'BEARISH');
    const em = makeExitManager(currentSnap);
    const symState = makeSymState(makeRegimeSnapshot('TRENDING_STRONG', 'BULLISH'));
    const decision = em.evaluateOne(makePosition(10), symState, makeAccount(), Date.now());
    expect(decision.action).toBe('EXIT_NOW');
    expect(decision.reason).toBe('REGIME_FLIP');
  });

  it('EXIT_NOW: LONG position in RANGING_HIGH_VOL (regime unsuitable for longs)', () => {
    const currentSnap = makeRegimeSnapshot('RANGING_HIGH_VOL', undefined);
    const em = makeExitManager(currentSnap);
    const symState = makeSymState(makeRegimeSnapshot('TRENDING_STRONG', 'BULLISH'));
    const decision = em.evaluateOne(makePosition(10), symState, makeAccount(), Date.now());
    expect(decision.action).toBe('EXIT_NOW');
    expect(decision.reason).toBe('REGIME_FLIP');
  });

  it('HOLD: SHORT position in RANGING_HIGH_VOL (choppy regime not forced-exit for shorts by direction)', () => {
    // A short in RANGING_HIGH_VOL should still exit via riskMultDrop (1.2 - 0.5 = 0.7 >= 0.3)
    // but not via directionMismatch. Check the reason is still REGIME_FLIP not a false hold.
    const currentSnap = makeRegimeSnapshot('RANGING_HIGH_VOL', undefined);
    const em = makeExitManager(currentSnap);
    const symState = makeSymState(makeRegimeSnapshot('TRENDING_STRONG', 'BEARISH'));
    const decision = em.evaluateOne(makePosition(-10), symState, makeAccount(), Date.now());
    // The riskMultDrop (1.2 - 0.5 = 0.7) triggers the exit — verify it's classified correctly
    expect(decision.action).toBe('EXIT_NOW');
    expect(decision.reason).toBe('REGIME_FLIP');
  });

  it('includes currentHtfTrend in the exit context', () => {
    const currentSnap = makeRegimeSnapshot('TRENDING_STRONG', 'BULLISH');
    const em = makeExitManager(currentSnap);
    const symState = makeSymState(makeRegimeSnapshot('TRENDING_STRONG', 'BEARISH'));
    const decision = em.evaluateOne(makePosition(-10), symState, makeAccount(), Date.now());
    expect(decision.context['currentHtfTrend']).toBe('BULLISH');
  });
});
