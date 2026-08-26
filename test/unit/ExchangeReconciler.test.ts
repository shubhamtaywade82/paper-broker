import { describe, expect, it, vi } from 'vitest';
import { ExchangeReconciler } from '../../src/execution/ExchangeReconciler.js';
import { LiveTradingGuard } from '../../src/execution/LiveTradingGuard.js';
import { ExecutionRouter } from '../../src/execution/ExecutionRouter.js';
import { resolveRuntimeProfile } from '../../src/config/modes/resolver.js';
import type { ExecutionBroker, Position } from '../../src/broker/types.js';

function position(symbol: string, qty: number): Position {
  return {
    accountId: 'acc',
    symbol,
    positionSide: 'BOTH',
    status: 'OPEN',
    qty,
    entryPrice: 100,
    unrealizedPnl: 0,
    realizedPnl: 0,
    leverage: 5,
    initialMargin: 100,
    maintenanceMargin: 5,
    maintenanceMarginRate: 0.005,
    totalFees: 0,
    totalFunding: 0,
    updatedAtUtc: new Date().toISOString(),
  };
}

function brokerWith(positions: Position[] | (() => never)): ExecutionBroker {
  return {
    submitOrder: vi.fn(),
    cancelOrder: vi.fn(),
    cancelAllOrders: vi.fn(),
    getOpenOrders: vi.fn().mockResolvedValue([]),
    getPositions: typeof positions === 'function' ? vi.fn(positions) : vi.fn().mockResolvedValue(positions),
    getPosition: vi.fn(),
    getAccount: vi.fn(),
  } as unknown as ExecutionBroker;
}

describe('ExchangeReconciler', () => {
  it('passes when venue and local agree, leaving trading enabled', async () => {
    const guard = new LiveTradingGuard();
    const reconciler = new ExchangeReconciler({
      venue: brokerWith([position('SOLUSDT', 10)]),
      local: brokerWith([position('SOLUSDT', 10)]),
      guard,
    });

    const report = await reconciler.reconcile('STARTUP');

    expect(report.ok).toBe(true);
    expect(report.positionDiscrepancies).toEqual([]);
    expect(report.safeModeTripped).toBe(false);
    expect(guard.isSafeMode()).toBe(false);
  });

  it('ignores flat positions on both sides', async () => {
    const guard = new LiveTradingGuard();
    const reconciler = new ExchangeReconciler({
      venue: brokerWith([position('SOLUSDT', 0)]),
      local: brokerWith([]),
      guard,
    });

    expect((await reconciler.reconcile('STARTUP')).ok).toBe(true);
  });

  it('catches a position the venue holds and this process does not', async () => {
    // The restart case: local ledger is empty, the exchange still holds size.
    const guard = new LiveTradingGuard();
    const reconciler = new ExchangeReconciler({
      venue: brokerWith([position('SOLUSDT', 10)]),
      local: brokerWith([]),
      guard,
    });

    const report = await reconciler.reconcile('STARTUP');

    expect(report.ok).toBe(false);
    expect(report.positionDiscrepancies).toHaveLength(1);
    expect(report.positionDiscrepancies[0]).toMatchObject({
      symbol: 'SOLUSDT',
      localQty: 0,
      venueQty: 10,
      kind: 'MISSING_LOCALLY',
    });
    expect(guard.isSafeMode()).toBe(true);
  });

  it('catches a position this process believes in that the venue does not have', async () => {
    const guard = new LiveTradingGuard();
    const reconciler = new ExchangeReconciler({
      venue: brokerWith([]),
      local: brokerWith([position('SOLUSDT', 10)]),
      guard,
    });

    const report = await reconciler.reconcile('RECONNECT');

    expect(report.positionDiscrepancies[0]?.kind).toBe('MISSING_AT_VENUE');
    expect(guard.isSafeMode()).toBe(true);
  });

  it('catches a quantity mismatch', async () => {
    const guard = new LiveTradingGuard();
    const reconciler = new ExchangeReconciler({
      venue: brokerWith([position('SOLUSDT', 10)]),
      local: brokerWith([position('SOLUSDT', 4)]),
      guard,
    });

    const report = await reconciler.reconcile('STARTUP');

    expect(report.positionDiscrepancies[0]).toMatchObject({
      kind: 'QUANTITY_MISMATCH',
      difference: 6,
    });
  });

  it('respects the configured quantity tolerance', async () => {
    const guard = new LiveTradingGuard();
    const reconciler = new ExchangeReconciler({
      venue: brokerWith([position('SOLUSDT', 10.0000001)]),
      local: brokerWith([position('SOLUSDT', 10)]),
      guard,
      quantityTolerance: 1e-6,
    });

    expect((await reconciler.reconcile('STARTUP')).ok).toBe(true);
  });

  it('treats an unreachable venue as a failure, not a pass', async () => {
    const guard = new LiveTradingGuard();
    const reconciler = new ExchangeReconciler({
      venue: brokerWith(() => {
        throw new Error('venue timeout');
      }),
      local: brokerWith([]),
      guard,
    });

    const report = await reconciler.reconcile('STARTUP');

    // Not knowing the exchange state is exactly when submission must stop.
    expect(report.ok).toBe(false);
    expect(report.error).toContain('venue timeout');
    expect(guard.isSafeMode()).toBe(true);
  });

  it('halts real order submission through the router once tripped', async () => {
    const guard = new LiveTradingGuard();
    const paperBroker = brokerWith([]);
    const profile = resolveRuntimeProfile({ TRADING_MODE: 'paper' });
    const router = new ExecutionRouter({ profile, paperBroker, guard });

    // Clean submission first.
    (paperBroker.submitOrder as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'FILLED' });
    const before = await router.submitOrder({ symbol: 'SOLUSDT', side: 'BUY', type: 'MARKET', quantity: 1 });
    expect(before.status).toBe('FILLED');

    await new ExchangeReconciler({
      venue: brokerWith([position('SOLUSDT', 10)]),
      local: brokerWith([]),
      guard,
    }).reconcile('STARTUP');

    const after = await router.submitOrder({ symbol: 'SOLUSDT', side: 'BUY', type: 'MARKET', quantity: 1 });
    expect(after.status).toBe('REJECTED');
    expect(after.rejectReason).toContain('SAFE_MODE_ACTIVE');
  });

  it('clears safe mode only after a clean re-run', async () => {
    const guard = new LiveTradingGuard();
    const venuePositions = [position('SOLUSDT', 10)];
    const venue = brokerWith(venuePositions);
    const local = brokerWith([]);
    const reconciler = new ExchangeReconciler({ venue, local, guard });

    await reconciler.reconcile('STARTUP');
    expect(guard.isSafeMode()).toBe(true);

    // Still mismatched — must stay halted.
    const stillBad = await reconciler.reconcileAndResume();
    expect(stillBad.ok).toBe(false);
    expect(guard.isSafeMode()).toBe(true);

    // Operator squares the books; now it clears.
    (local.getPositions as ReturnType<typeof vi.fn>).mockResolvedValue([position('SOLUSDT', 10)]);
    const good = await reconciler.reconcileAndResume();
    expect(good.ok).toBe(true);
    expect(guard.isSafeMode()).toBe(false);
  });

  it('reports the trigger and keeps the last report available', async () => {
    const guard = new LiveTradingGuard();
    const seen: string[] = [];
    const reconciler = new ExchangeReconciler({
      venue: brokerWith([]),
      local: brokerWith([]),
      guard,
      onReport: (r) => seen.push(r.trigger),
    });

    await reconciler.reconcile('PROVIDER_RECOVERY');

    expect(seen).toEqual(['PROVIDER_RECOVERY']);
    expect(reconciler.getLastReport()?.trigger).toBe('PROVIDER_RECOVERY');
  });
});
