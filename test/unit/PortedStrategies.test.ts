import { describe, it, expect } from 'vitest';
import { StrategyEngine, type Strategy } from '../../src/strategy/StrategyEngine.js';
import { createMomentumStrategy } from '../../src/strategy/strategies/momentum-5m.js';
import { createGridStrategy } from '../../src/strategy/strategies/grid-15m.js';
import { createMeanReversionStrategy } from '../../src/strategy/strategies/mean-reversion-5m.js';
import type { Signal } from '../../src/strategy/signal.js';
import type { Candle } from '../../src/strategy/indicators.js';
import type { MarketState } from '../../src/broker/types.js';

const market: MarketState = {
  symbol: 'SOLUSDT',
  bid: 100,
  ask: 100.1,
  last: 100.5,
  mark: 100.2,
  localTsUtc: Date.now(),
  stale: false,
};

const candle: Candle = {
  symbol: 'SOLUSDT',
  interval: '5m',
  openTime: 1700000000000,
  open: 100,
  high: 101,
  low: 99,
  close: 100.5,
  volume: 1000,
};

function setup(positions: { qty: number }[] = []) {
  const submitted: Signal[] = [];
  const directOrders: unknown[] = [];
  let currentMarket: MarketState = market;
  const engine = new StrategyEngine(
    {
      marketState: () => currentMarket,
      klines: {
        getCandles: () => Array.from({ length: 25 }, (_, i) => ({
          ...candle,
          openTime: 1700000000000 + i * 300_000,
          close: 100 + (i % 5) * 0.5,
        })),
      },
      account: () => ({
        walletBalance: 10000,
        unrealizedPnl: 0,
        equity: 10000,
        initialMargin: 0,
        maintenanceMargin: 0,
        availableBalance: 9999,
        openPositionsCount: positions.length,
        openOrdersCount: 0,
      }),
      getPosition: () =>
        positions.length > 0
          ? {
              accountId: 'test',
              symbol: 'SOLUSDT',
              positionSide: 'BOTH',
              status: 'OPEN',
              qty: positions[0]?.qty ?? 0,
              entryPrice: 100,
              leverage: 3,
              maintenanceMarginRate: 0.005,
              realizedPnl: 0,
              unrealizedPnl: 0,
              initialMargin: 0,
              maintenanceMargin: 0,
              totalFees: 0,
              totalFunding: 0,
              updatedAtUtc: new Date().toISOString(),
            }
          : undefined,
      getOpenOrders: () => [],
      getInstrument: () => undefined,
      submitOrder: (order) => {
        directOrders.push(order);
        return {
          id: 'x',
          symbol: order.symbol,
          side: order.side,
          type: order.type,
          quantity: order.quantity,
          price: order.price,
          stopPrice: order.stopPrice,
          timeInForce: order.timeInForce ?? 'GTC',
          reduceOnly: order.reduceOnly ?? false,
          leverage: order.leverage ?? 1,
          status: 'NEW',
          createdAtUtc: new Date().toISOString(),
          updatedAtUtc: new Date().toISOString(),
        };
      },
    },
    {
      onSubmitSignal: async (signal) => {
        submitted.push(signal);
        return true;
      },
    }
  );
  return { engine, submitted, directOrders, setMarket: (m: MarketState) => { currentMarket = m; } };
}

describe('ported strategies', () => {
  it('momentum opens long when last > mark', async () => {
    const { engine, submitted } = setup();
    engine.register(createMomentumStrategy({ symbol: 'SOLUSDT', symbols: ['SOLUSDT'] }));
    await engine.start();

    await engine.onCandleClose(candle);
    expect(submitted.length).toBe(1);
    expect(submitted[0]?.action).toBe('OPEN_LONG');
  });

  it('momentum skips when a position is open', async () => {
    const { engine, submitted } = setup([{ qty: 1 }]);
    engine.register(createMomentumStrategy({ symbol: 'SOLUSDT', symbols: ['SOLUSDT'] }));
    await engine.start();

    await engine.onCandleClose(candle);
    expect(submitted.length).toBe(0);
  });

  it('momentum closes a long when premium flips negative', async () => {
    const { engine, submitted, setMarket } = setup([{ qty: 1 }]);
    engine.register(createMomentumStrategy({ symbol: 'SOLUSDT', symbols: ['SOLUSDT'] }));
    await engine.start();

    setMarket({ ...market, last: 99.8, mark: 100.2 });
    await engine.onCandleClose(candle);
    expect(submitted.length).toBe(1);
    expect(submitted[0]?.action).toBe('CLOSE_LONG');
  });

  it('momentum closes a short when premium flips positive', async () => {
    const { engine, submitted, setMarket } = setup([{ qty: -1 }]);
    engine.register(createMomentumStrategy({ symbol: 'SOLUSDT', symbols: ['SOLUSDT'] }));
    await engine.start();

    setMarket({ ...market, last: 100.6, mark: 100.2 });
    await engine.onCandleClose(candle);
    expect(submitted.length).toBe(1);
    expect(submitted[0]?.action).toBe('CLOSE_SHORT');
  });

  it('grid places a limit order ladder once', async () => {
    const { engine, directOrders } = setup();
    engine.register(createGridStrategy({ symbol: 'SOLUSDT', symbols: ['SOLUSDT'] }));
    await engine.start();

    const gridCandle = { ...candle, interval: '15m' };
    await engine.onCandleClose(gridCandle);
    await engine.onCandleClose(gridCandle);

    // 5 levels each side minus 0 = 10 orders, placed once
    expect(directOrders.length).toBe(10);
    expect(directOrders.every((o) => (o as { type: string }).type === 'LIMIT')).toBe(true);
  });

  it('C-09: stops placing ladder orders once the max grid notional cap is reached', async () => {
    const { engine, directOrders } = setup();
    // equity is 10000 in setup()'s account mock; maxEquityFraction: 1 makes
    // the absolute maxTotalGridNotional cap (150) the binding constraint —
    // each order is ~50 notional (baseQty 0.5 @ ~mid 100), so only 3 of the
    // 10 ladder levels should fit before the cap stops further placement.
    engine.register(createGridStrategy({
      symbols: ['SOLUSDT'],
      maxTotalGridNotional: 150,
      maxEquityFraction: 1,
    }));
    await engine.start();

    const gridCandle = { ...candle, interval: '15m' };
    await engine.onCandleClose(gridCandle);

    expect(directOrders.length).toBe(3);
    expect(directOrders.length).toBeLessThan(10);
  });

  it('mean reversion signals long below lower band', async () => {
    const { engine, submitted, setMarket } = setup();
    engine.register(createMeanReversionStrategy({ symbol: 'SOLUSDT', symbols: ['SOLUSDT'] }));
    await engine.start();

    setMarket({ ...market, mark: 50 }); // far below mean of ~101

    await engine.onCandleClose(candle);

    expect(submitted.length).toBe(1);
    expect(submitted[0]?.action).toBe('OPEN_LONG');
  });
});