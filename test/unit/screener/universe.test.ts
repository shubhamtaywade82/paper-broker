import { describe, it, expect } from 'vitest';
import { resolveUniverse } from '../../../src/screener/universe.js';

function fakeClient(symbols: Array<Record<string, unknown>>) {
  return { futures: { market: { exchangeInfo: async () => ({ symbols }) } } } as any;
}

describe('resolveUniverse', () => {
  it('keeps only TRADING PERPETUAL USDT-margined symbols', async () => {
    const client = fakeClient([
      { symbol: 'BTCUSDT', status: 'TRADING', contractType: 'PERPETUAL', quoteAsset: 'USDT' },
      { symbol: 'ETHUSDT', status: 'TRADING', contractType: 'PERPETUAL', quoteAsset: 'USDT' },
      { symbol: 'BTCUSDT_250926', status: 'TRADING', contractType: 'CURRENT_QUARTER', quoteAsset: 'USDT' }, // dated future, not perpetual
      { symbol: 'DELISTEDUSDT', status: 'BREAK', contractType: 'PERPETUAL', quoteAsset: 'USDT' }, // not trading
      { symbol: 'BTCUSD_PERP', status: 'TRADING', contractType: 'PERPETUAL', quoteAsset: 'USD' }, // coin-margined, not USDT
    ]);

    const universe = await resolveUniverse(client);

    expect(universe).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('returns an empty list, not a throw, when exchangeInfo is empty', async () => {
    const universe = await resolveUniverse(fakeClient([]));
    expect(universe).toEqual([]);
  });
});
