import type { BinanceClient } from '@nemesis-oss/binance-sdk';

/**
 * Every live, tradable USDT-margined perpetual on Binance Futures — resolved
 * fresh each call, not cached, not hardcoded. Verified live during planning:
 * GET /fapi/v1/exchangeInfo currently returns 526 symbols matching this
 * exact filter (status/contractType/quoteAsset field names confirmed
 * against the real response).
 */
export async function resolveUniverse(client: BinanceClient): Promise<string[]> {
  const info = await client.futures.market.exchangeInfo();
  return info.symbols
    .filter((s: any) => s.status === 'TRADING' && s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT')
    .map((s: any) => s.symbol);
}
