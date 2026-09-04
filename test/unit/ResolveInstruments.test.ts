import { describe, it, expect, vi } from 'vitest';
import { resolveInstruments } from '../../src/binance/bootstrap.js';
import { env } from '../../src/config/env.js';

// Found live (paper-broker instrument-table fix): the backtest/replay paths
// always used the static config, whose maintenanceMarginRate is a flat 0.005
// for every symbol regardless of real risk tier — every backtest's
// liquidation-price and available-margin math was systematically wrong. The
// live trading path (engine.ts) also silently dropped a symbol entirely
// (rather than falling back for just that symbol) if its individual fetch
// failed. resolveInstruments() is the shared fix for both.

function fakeClient(overrides: {
  instrumentDetails?: (symbol: string) => Promise<any>;
  leverageBrackets?: () => Promise<any>;
} = {}) {
  // instrumentDetails must always resolve/reject a real Promise: real code
  // does `.catch(() => null)` on the call, and a mock that returns a plain
  // value instead throws synchronously on `.catch` — which the real
  // per-symbol try/catch also swallows, silently masking whichever bug this
  // test is meant to catch. That happened here on the first pass: two
  // assertions "passed" for the wrong reason before this fix.
  const defaultInstrumentDetails = async (symbol: string) => ({
    symbol,
    baseAsset: symbol.replace('USDT', ''),
    quoteAsset: 'USDT',
    status: 'TRADING',
    contractType: 'PERPETUAL',
    pricePrecision: 2,
    quantityPrecision: 3,
    filters: [
      { filterType: 'PRICE_FILTER', tickSize: '0.05' },
      { filterType: 'LOT_SIZE', stepSize: '0.002', minQty: '0.002', maxQty: '5000' },
      { filterType: 'MIN_NOTIONAL', notional: '10' },
    ],
  });
  return {
    futures: {
      market: {
        instrumentDetails: vi.fn(overrides.instrumentDetails ?? defaultInstrumentDetails),
      },
      data: {
        premiumIndex: vi.fn(async () => ({ markPrice: 100 })),
        fundingInfo: vi.fn(async () => []),
      },
      account: {
        leverageBrackets: vi.fn(
          overrides.leverageBrackets ?? (async () => [
            { symbol: 'BTCUSDT', brackets: [{ maintMarginRatio: 0.004 }] },
            { symbol: 'ETHUSDT', brackets: [{ maintMarginRatio: 0.0065 }] },
          ])
        ),
      },
    },
  } as any;
}

describe('resolveInstruments', () => {
  it('uses real per-symbol maintenanceMarginRate instead of a flat placeholder', async () => {
    // leverageBrackets requires auth (matches bootstrapFromBinance's real
    // gating) — exercised directly rather than skipped, since this is
    // precisely the branch that used to be silently unreachable.
    const prevKey = env.BINANCE_API_KEY, prevSecret = env.BINANCE_API_SECRET;
    env.BINANCE_API_KEY = 'test-key';
    env.BINANCE_API_SECRET = 'test-secret';
    try {
      const instruments = await resolveInstruments(fakeClient(), ['BTCUSDT', 'ETHUSDT']);
      const btc = instruments.find((i) => i.symbol === 'BTCUSDT')!;
      const eth = instruments.find((i) => i.symbol === 'ETHUSDT')!;

      expect(btc.maintenanceMarginRate).toBe('0.004');
      expect(eth.maintenanceMarginRate).toBe('0.0065');
      expect(btc.maintenanceMarginRate).not.toBe(eth.maintenanceMarginRate); // proves it's real per-symbol data, not one shared constant
    } finally {
      env.BINANCE_API_KEY = prevKey;
      env.BINANCE_API_SECRET = prevSecret;
    }
  });

  it('uses real tick/step sizes, not the static guesses', async () => {
    const [inst] = await resolveInstruments(fakeClient(), ['BTCUSDT']);
    expect(inst.tickSize).toBe('0.05'); // static table has BTCUSDT at 0.1
    expect(inst.stepSize).toBe('0.002'); // static table has BTCUSDT at 0.001
  });

  it('falls back to the static config for only the symbol whose fetch failed, not the whole batch', async () => {
    const client = fakeClient({
      instrumentDetails: async (symbol: string) => {
        if (symbol === 'ETHUSDT') throw new Error('simulated fetch failure');
        return {
          symbol, baseAsset: symbol.replace('USDT', ''), quoteAsset: 'USDT', status: 'TRADING', contractType: 'PERPETUAL',
          pricePrecision: 2, quantityPrecision: 3,
          filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.05' }, { filterType: 'LOT_SIZE', stepSize: '0.002' }],
        };
      },
    });

    const instruments = await resolveInstruments(client, ['BTCUSDT', 'ETHUSDT']);

    expect(instruments).toHaveLength(2); // ETHUSDT is present (static fallback), not silently dropped
    expect(instruments.find((i) => i.symbol === 'BTCUSDT')!.tickSize).toBe('0.05'); // live
    expect(instruments.find((i) => i.symbol === 'ETHUSDT')!.tickSize).toBe('0.01'); // static fallback for this symbol only
  });

  it('uses the static config entirely, offline, when no client is provided', async () => {
    const instruments = await resolveInstruments(undefined, ['BTCUSDT', 'SOMENEWCOIN']);
    expect(instruments).toHaveLength(2);
    expect(instruments.every((i) => i.symbol)).toBe(true);
  });

  it('falls back to a placeholder maintenanceMarginRate, loudly, when no leverage-bracket data exists', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = fakeClient({ leverageBrackets: async () => null });

    const [inst] = await resolveInstruments(client, ['BTCUSDT']);

    expect(inst.maintenanceMarginRate).toBe('0.005');
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('placeholder maintMarginRate'))).toBe(true);
    warnSpy.mockRestore();
  });
});
