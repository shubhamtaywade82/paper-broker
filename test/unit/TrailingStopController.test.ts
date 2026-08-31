import { describe, expect, it, vi } from 'vitest';
import { TrailingStopController } from '../../src/trading/risk/TrailingStopController.js';
import { TrailingStopManager } from '../../src/trading/risk/TrailingStopManager.js';
import type { ExecutionBroker, Order, Position } from '../../src/broker/types.js';

const T0 = 1_700_000_000_000;

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    accountId: 'paper-main',
    symbol: 'SOLUSDT',
    positionSide: 'BOTH',
    status: 'OPEN',
    qty: 10,
    entryPrice: 100,
    unrealizedPnl: 0,
    realizedPnl: 0,
    leverage: 5,
    initialMargin: 200,
    maintenanceMargin: 10,
    maintenanceMarginRate: 0.005,
    totalFees: 0,
    totalFunding: 0,
    updatedAtUtc: new Date(T0).toISOString(),
    ...overrides,
  };
}

function makeStopOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'stop-1',
    clientOrderId: 'c-stop-1',
    accountId: 'paper-main',
    symbol: 'SOLUSDT',
    side: 'SELL',
    type: 'STOP_MARKET',
    timeInForce: 'GTC',
    status: 'NEW',
    positionSide: 'BOTH',
    quantity: 10,
    filledQty: 0,
    avgFillPrice: 0,
    leverage: 5,
    reduceOnly: true,
    postOnly: false,
    closePosition: false,
    stopPrice: 95,
    submittedAtUtc: new Date(T0).toISOString(),
    updatedAtUtc: new Date(T0).toISOString(),
    ...overrides,
  };
}

function makeTpOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'tp-1',
    clientOrderId: 'c-tp-1',
    accountId: 'paper-main',
    symbol: 'SOLUSDT',
    side: 'SELL',
    type: 'TAKE_PROFIT_MARKET',
    timeInForce: 'GTC',
    status: 'NEW',
    positionSide: 'BOTH',
    quantity: 10,
    filledQty: 0,
    avgFillPrice: 0,
    leverage: 5,
    reduceOnly: true,
    postOnly: false,
    closePosition: false,
    stopPrice: 120,
    submittedAtUtc: new Date(T0).toISOString(),
    updatedAtUtc: new Date(T0).toISOString(),
    ...overrides,
  };
}

function makeBroker(overrides: Partial<ExecutionBroker> = {}) {
  const submitOrder = vi.fn(async (cmd: { type?: string; stopPrice?: number }) =>
    cmd.type === 'TAKE_PROFIT_MARKET'
      ? makeTpOrder({ id: 'tp-2', stopPrice: cmd.stopPrice, status: 'NEW' })
      : makeStopOrder({ id: 'stop-2', stopPrice: cmd.stopPrice, status: 'NEW' })
  );
  const cancelOrder = vi.fn(async () => undefined);
  const broker = {
    submitOrder,
    cancelOrder,
    cancelAllOrders: vi.fn(async () => undefined),
    getOpenOrders: vi.fn(async () => [makeStopOrder()]),
    getPositions: vi.fn(async () => [makePosition()]),
    getPosition: vi.fn(async () => makePosition()),
    getAccount: vi.fn(async () => ({}) as never),
    ...overrides,
  } as unknown as ExecutionBroker & {
    submitOrder: typeof submitOrder;
    cancelOrder: typeof cancelOrder;
  };
  return broker;
}

function makeController(
  broker: ExecutionBroker,
  minUpdateIntervalMs = 0,
  onTpMoved?: (update: { symbol: string; previousTp: number; newTp: number }) => void
) {
  return new TrailingStopController({
    broker,
    manager: new TrailingStopManager({
      activationThresholdPct: 0.02,
      trailingDistancePct: 0.015,
      breakevenTriggerPct: 0.01,
      enableBreakeven: false,
      enableTrailing: true,
      tpExtensionPct: 0.03,
      enableTpExtension: true,
    }),
    minUpdateIntervalMs,
    onTpMoved,
  });
}

describe('TrailingStopController', () => {
  it('does nothing when the price has not moved enough to trail', async () => {
    const broker = makeBroker();
    const controller = makeController(broker);

    const moved = await controller.onPrice('SOLUSDT', 100.5, T0);

    expect(moved).toBeNull();
    expect(broker.submitOrder).not.toHaveBeenCalled();
    expect(broker.cancelOrder).not.toHaveBeenCalled();
  });

  it('replaces the resting stop when the trailing rule fires', async () => {
    const broker = makeBroker();
    const controller = makeController(broker);

    const moved = await controller.onPrice('SOLUSDT', 110, T0);

    expect(moved).not.toBeNull();
    expect(moved?.reason).toBe('TRAILING');
    expect(moved?.previousStop).toBe(95);
    expect(moved?.newStop).toBeCloseTo(108.35, 6);

    // New stop is placed BEFORE the old one is cancelled, so the position is
    // never left unprotected.
    expect(broker.submitOrder).toHaveBeenCalledTimes(1);
    expect(broker.cancelOrder).toHaveBeenCalledWith('stop-1', 'TRAILING_STOP_REPLACED');
    const submitOrderMock = broker.submitOrder as unknown as ReturnType<typeof vi.fn>;
    const cancelOrderMock = broker.cancelOrder as unknown as ReturnType<typeof vi.fn>;
    expect(submitOrderMock.mock.invocationCallOrder[0]).toBeLessThan(
      cancelOrderMock.mock.invocationCallOrder[0] as number
    );
  });

  it('keeps the original stop when the replacement is rejected', async () => {
    const broker = makeBroker({
      submitOrder: vi.fn(async () =>
        makeStopOrder({ id: 'stop-2', status: 'REJECTED', rejectReason: 'INSUFFICIENT_MARGIN' })
      ),
    } as Partial<ExecutionBroker>);
    const controller = makeController(broker);

    const moved = await controller.onPrice('SOLUSDT', 110, T0);

    expect(moved).toBeNull();
    expect(broker.cancelOrder).not.toHaveBeenCalled();
  });

  it('is a no-op when there is no open position', async () => {
    const broker = makeBroker({ getPosition: vi.fn(async () => undefined) } as Partial<ExecutionBroker>);
    const controller = makeController(broker);

    expect(await controller.onPrice('SOLUSDT', 110, T0)).toBeNull();
    expect(broker.submitOrder).not.toHaveBeenCalled();
  });

  it('is a no-op when there is no resting stop order', async () => {
    const broker = makeBroker({ getOpenOrders: vi.fn(async () => []) } as Partial<ExecutionBroker>);
    const controller = makeController(broker);

    expect(await controller.onPrice('SOLUSDT', 110, T0)).toBeNull();
    expect(broker.submitOrder).not.toHaveBeenCalled();
  });

  it('ignores a non-positive price', async () => {
    const broker = makeBroker();
    const controller = makeController(broker);

    expect(await controller.onPrice('SOLUSDT', 0, T0)).toBeNull();
    expect(await controller.onPrice('SOLUSDT', Number.NaN, T0)).toBeNull();
    expect(broker.getPosition).not.toHaveBeenCalled();
  });

  it('throttles repeat updates inside the minimum interval', async () => {
    const broker = makeBroker();
    const controller = makeController(broker, 5_000);

    const first = await controller.onPrice('SOLUSDT', 110, T0);
    expect(first).not.toBeNull();

    const second = await controller.onPrice('SOLUSDT', 120, T0 + 1_000);
    expect(second).toBeNull();
    expect(broker.submitOrder).toHaveBeenCalledTimes(1);

    const third = await controller.onPrice('SOLUSDT', 130, T0 + 6_000);
    expect(third).not.toBeNull();
    expect(broker.submitOrder).toHaveBeenCalledTimes(2);
  });

  it('surfaces a broker failure as null rather than throwing into the tick path', async () => {
    const broker = makeBroker({
      submitOrder: vi.fn(async () => {
        throw new Error('venue unreachable');
      }),
    } as Partial<ExecutionBroker>);
    const controller = makeController(broker);

    await expect(controller.onPrice('SOLUSDT', 110, T0)).resolves.toBeNull();
  });

  it('extends the resting take-profit when the extension rule fires', async () => {
    const onTpMoved = vi.fn();
    const broker = makeBroker({
      getOpenOrders: vi.fn(async () => [makeTpOrder({ stopPrice: 105 })]),
    } as Partial<ExecutionBroker>);
    const controller = makeController(broker, 0, onTpMoved);

    await controller.onPrice('SOLUSDT', 110, T0);

    expect(onTpMoved).toHaveBeenCalledTimes(1);
    const moved = onTpMoved.mock.calls[0][0];
    expect(moved.previousTp).toBe(105);
    expect(moved.newTp).toBeCloseTo(113.3, 6);
    expect(broker.cancelOrder).toHaveBeenCalledWith('tp-1', 'TRAILING_TP_REPLACED');
  });

  it('does not touch the take-profit before the extension threshold is reached', async () => {
    const onTpMoved = vi.fn();
    const broker = makeBroker({
      getOpenOrders: vi.fn(async () => [makeTpOrder({ stopPrice: 105 })]),
    } as Partial<ExecutionBroker>);
    const controller = makeController(broker, 0, onTpMoved);

    await controller.onPrice('SOLUSDT', 100.5, T0);

    expect(onTpMoved).not.toHaveBeenCalled();
    expect(broker.submitOrder).not.toHaveBeenCalled();
  });

  it('is a no-op for take-profit when there is no resting TP order', async () => {
    const onTpMoved = vi.fn();
    const broker = makeBroker(); // default: only a STOP_MARKET order resting
    const controller = makeController(broker, 0, onTpMoved);

    await controller.onPrice('SOLUSDT', 110, T0);

    expect(onTpMoved).not.toHaveBeenCalled();
  });

  it('keeps the original take-profit when the replacement is rejected', async () => {
    const onTpMoved = vi.fn();
    const broker = makeBroker({
      getOpenOrders: vi.fn(async () => [makeTpOrder({ stopPrice: 105 })]),
      submitOrder: vi.fn(async () =>
        makeTpOrder({ id: 'tp-2', status: 'REJECTED', rejectReason: 'INSUFFICIENT_MARGIN' })
      ),
    } as Partial<ExecutionBroker>);
    const controller = makeController(broker, 0, onTpMoved);

    await controller.onPrice('SOLUSDT', 110, T0);

    expect(onTpMoved).not.toHaveBeenCalled();
    expect(broker.cancelOrder).not.toHaveBeenCalled();
  });

  it('moves both the stop and the take-profit in the same tick when both rules fire', async () => {
    const onTpMoved = vi.fn();
    const broker = makeBroker({
      getOpenOrders: vi.fn(async () => [makeStopOrder(), makeTpOrder({ stopPrice: 105 })]),
    } as Partial<ExecutionBroker>);
    const controller = makeController(broker, 0, onTpMoved);

    const slMoved = await controller.onPrice('SOLUSDT', 110, T0);

    expect(slMoved?.reason).toBe('TRAILING');
    expect(onTpMoved).toHaveBeenCalledTimes(1);
    expect(broker.submitOrder).toHaveBeenCalledTimes(2);
    expect(broker.cancelOrder).toHaveBeenCalledWith('stop-1', 'TRAILING_STOP_REPLACED');
    expect(broker.cancelOrder).toHaveBeenCalledWith('tp-1', 'TRAILING_TP_REPLACED');
  });
});
