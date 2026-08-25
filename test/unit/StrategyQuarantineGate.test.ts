import { describe, expect, it, vi } from 'vitest';
import { StrategyEngine, type Strategy } from '../../src/strategy/StrategyEngine.js';
import type { Candle } from '../../src/strategy/indicators.js';
import type { AccountState } from '../../src/broker/types.js';

function makeCandle(): Candle {
  return {
    symbol: 'SOLUSDT',
    interval: '5m',
    openTime: 1_700_000_000_000,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 1000,
  };
}

function makeStrategy(id: string, onCandleClose: Strategy['onCandleClose']): Strategy {
  return {
    id,
    name: id,
    enabled: true,
    symbols: ['SOLUSDT'],
    intervals: ['5m'],
    priority: 1,
    cooldownMs: 0,
    onCandleClose,
  };
}

function makeEngine(isQuarantined?: (id: string) => boolean) {
  const account: AccountState = {
    accountId: 'test',
    walletBalance: 10_000,
    equity: 10_000,
    availableBalance: 10_000,
    unrealizedPnl: 0,
    realizedPnl: 0,
    totalFees: 0,
  } as unknown as AccountState;

  return new StrategyEngine(
    {
      marketState: () => undefined,
      klines: { getCandles: () => [] } as never,
      account: () => account,
      getPosition: () => undefined,
      getOpenOrders: () => [],
      getInstrument: () => undefined,
      submitOrder: (() => undefined) as never,
    },
    {
      onSubmitSignal: async () => true,
      isQuarantined,
    }
  );
}

describe('StrategyEngine performance quarantine gate', () => {
  it('routes candles to a healthy strategy', async () => {
    const handler = vi.fn().mockReturnValue(null);
    const engine = makeEngine(() => false);
    engine.register(makeStrategy('alpha', handler));
    await engine.start();

    await engine.onCandleClose(makeCandle());

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('stops routing candles to a quarantined strategy', async () => {
    const handler = vi.fn().mockReturnValue(null);
    const engine = makeEngine((id) => id === 'alpha');
    engine.register(makeStrategy('alpha', handler));
    await engine.start();

    await engine.onCandleClose(makeCandle());

    expect(handler).not.toHaveBeenCalled();
  });

  it('quarantines only the offending strategy, not its peers', async () => {
    const alpha = vi.fn().mockReturnValue(null);
    const beta = vi.fn().mockReturnValue(null);
    const engine = makeEngine((id) => id === 'alpha');
    engine.register(makeStrategy('alpha', alpha));
    engine.register(makeStrategy('beta', beta));
    await engine.start();

    await engine.onCandleClose(makeCandle());

    expect(alpha).not.toHaveBeenCalled();
    expect(beta).toHaveBeenCalledTimes(1);
  });

  it('lists which strategies are held back', async () => {
    const engine = makeEngine((id) => id === 'alpha');
    engine.register(makeStrategy('alpha', vi.fn()));
    engine.register(makeStrategy('beta', vi.fn()));

    expect(engine.listQuarantined()).toEqual(['alpha']);
  });

  it('routes to everything when no gate is supplied (default behaviour)', async () => {
    const handler = vi.fn().mockReturnValue(null);
    const engine = makeEngine(undefined);
    engine.register(makeStrategy('alpha', handler));
    await engine.start();

    await engine.onCandleClose(makeCandle());

    expect(handler).toHaveBeenCalledTimes(1);
    expect(engine.listQuarantined()).toEqual([]);
  });
});
