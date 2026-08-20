import { BinanceClient } from '@nemesis-oss/binance-sdk';
import type { Instrument } from '../broker/types.js';
import { env } from '../config/env.js';

export interface BootstrapResult {
  instruments: Instrument[];
  markPrices: Map<string, number>;
  fundingRates: Map<string, number>;
}

export async function bootstrapFromBinance(
  client: BinanceClient,
  symbols: string[]
): Promise<BootstrapResult> {
  const instruments: Instrument[] = [];
  const markPrices = new Map<string, number>();
  const fundingRates = new Map<string, number>();

  const hasAuth = Boolean(env.BINANCE_API_KEY && env.BINANCE_API_SECRET);
  if (!hasAuth) {
    console.warn('[Bootstrap] No API keys configured, using default instruments and skipping authenticated data');
    return { instruments, markPrices, fundingRates };
  }

  for (const symbol of symbols) {
    try {
      const [exchangeInfo, markPrice, fundingInfo, leverageBracket] = await Promise.all([
        client.futures.market.instrumentDetails(symbol),
        client.futures.data.premiumIndex(symbol),
        client.futures.data.fundingInfo(),
        client.futures.account.leverageBrackets(),
      ]);

      if (!exchangeInfo) {
        console.warn(`[Bootstrap] No exchange info for ${symbol}`);
        continue;
      }

      const raw = exchangeInfo as unknown as {
        contractType?: string;
        filters?: Array<{
          filterType: string;
          tickSize?: string;
          stepSize?: string;
          minQty?: string;
          maxQty?: string;
          notional?: string;
        }>;
        pricePrecision?: number;
        quantityPrecision?: number;
      };

      const filters = raw.filters ?? [];
      const priceFilter = filters.find((f) => f.filterType === 'PRICE_FILTER');
      const lotSizeFilter = filters.find((f) => f.filterType === 'LOT_SIZE');
      const minNotionalFilter = filters.find((f) => f.filterType === 'MIN_NOTIONAL');

      const allBrackets = leverageBracket ?? [];
      const symbolBracket = allBrackets.find((b) => b.symbol === symbol);
      const bracket = symbolBracket ?? allBrackets[0];
      const maintMarginRate = String(bracket?.brackets?.[0]?.maintMarginRatio ?? 0.005);

      const instrument: Instrument = {
        symbol: exchangeInfo.symbol,
        baseAsset: exchangeInfo.baseAsset,
        quoteAsset: exchangeInfo.quoteAsset,
        contractType: raw.contractType ?? 'PERPETUAL',
        status: exchangeInfo.status,
        tickSize: priceFilter?.tickSize ?? '0.01',
        stepSize: lotSizeFilter?.stepSize ?? '0.001',
        minQty: lotSizeFilter?.minQty ?? '0.001',
        maxQty: lotSizeFilter?.maxQty,
        minNotional: minNotionalFilter?.notional ?? '5',
        pricePrecision: raw.pricePrecision ?? 2,
        quantityPrecision: raw.quantityPrecision ?? 3,
        maintenanceMarginRate: maintMarginRate,
        createdAtUtc: new Date().toISOString(),
        updatedAtUtc: new Date().toISOString(),
      };

      instruments.push(instrument);

      if (markPrice) {
        markPrices.set(symbol, markPrice.markPrice);
      }

      const rawFunding = fundingInfo as unknown as Array<{ symbol?: string; fundingRate?: string }>;
      const symbolFunding = rawFunding?.find((f) => f.symbol === symbol);
      if (symbolFunding) {
        fundingRates.set(symbol, Number(symbolFunding.fundingRate));
      }

      console.log(`[Bootstrap] ${symbol}: tickSize=${instrument.tickSize}, stepSize=${instrument.stepSize}, minQty=${instrument.minQty}, minNotional=${instrument.minNotional}, maintMarginRate=${maintMarginRate}`);
    } catch (error) {
      console.warn(`[Bootstrap] Failed for ${symbol}: ${(error as Error).message}`);
    }
  }

  return { instruments, markPrices, fundingRates };
}

export function createBinanceClient(): BinanceClient {
  return new BinanceClient({
    testnet: env.BINANCE_ENV === 'testnet',
    apiKey: env.BINANCE_API_KEY,
    apiSecret: env.BINANCE_API_SECRET,
  });
}

type KlineInterval = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d' | '3d' | '1w' | '1M';

export function getBinanceStreams(client: BinanceClient, symbols: string[], timeframes: KlineInterval[]): string[] {
  const streams: string[] = [];

  for (const symbol of symbols) {
    streams.push(
      client.futures.ws.bookTicker(symbol),
      client.futures.ws.aggTrade(symbol),
      client.futures.ws.markPrice(symbol, '1s')
    );

    for (const interval of timeframes) {
      streams.push(client.futures.ws.kline(symbol, interval));
    }
  }

  return streams;
}