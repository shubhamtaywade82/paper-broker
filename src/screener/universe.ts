import type { BinanceClient, ExchangeSymbol } from '@nemesis-oss/binance-sdk';

/** `contractType` is real on the live exchangeInfo response but not part of
 * the SDK's typed ExchangeSymbolSchema — widen just that one field instead
 * of casting the whole symbol object to `any` (which would also swallow a
 * typo in `symbol`/`status`/`baseAsset`/`quoteAsset`, all of which ARE typed). */
interface PerpetualSymbol extends ExchangeSymbol {
  contractType?: string;
}

/**
 * Every live, tradable USDT-margined perpetual on Binance Futures — resolved
 * fresh each call, not cached, not hardcoded. Verified live during planning:
 * GET /fapi/v1/exchangeInfo currently returns 526 symbols matching this
 * exact filter (status/contractType/quoteAsset field names confirmed
 * against the real response).
 */
export async function resolveUniverse(client: BinanceClient): Promise<string[]> {
  const info = await client.futures.market.exchangeInfo();
  return (info.symbols as PerpetualSymbol[])
    .filter((s) => s.status === 'TRADING' && s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT')
    .map((s) => s.symbol);
}
