import type { Instrument, MarketState } from '../broker/types.js';

export interface NormalizedBookTicker {
  symbol: string;
  bid: number;
  ask: number;
  bidQty: number;
  askQty: number;
  spread: number;
  eventTime: number;
}

export interface NormalizedAggTrade {
  symbol: string;
  price: number;
  quantity: number;
  eventTime: number;
  isBuyerMaker: boolean;
}

export interface NormalizedMarkPrice {
  symbol: string;
  markPrice: number;
  indexPrice: number;
  fundingRate: number;
  nextFundingTime: number;
  eventTime: number;
}

export interface NormalizedKline {
  symbol: string;
  interval: string;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number;
  closed: boolean;
}

export interface NormalizedOpenInterest { symbol: string; openInterest: number; eventTime: number; }
export interface NormalizedLongShortRatio { symbol: string; longShortRatio: number; longAccountRatio: number; shortAccountRatio: number; eventTime: number; }
export interface NormalizedTakerVolume { symbol: string; buyVolume: number; sellVolume: number; takerDelta: number; takerRatio: number; eventTime: number; }

interface RawTickerPayload { s?: string; b?: string | number; a?: string | number; B?: string | number; A?: string | number; E?: number; }
interface RawAggTradePayload { s?: string; p?: string | number; q?: string | number; E?: number; T?: number; m?: boolean; }
interface RawMarkPricePayload { s?: string; p?: string | number; i?: string | number; r?: string | number; T?: number; E?: number; }
interface RawKlinePayload {
  k?: {
    s?: string; i?: string; t?: number; T?: number; o?: string | number; h?: string | number;
    l?: string | number; c?: string | number; v?: string | number; q?: string | number; n?: number; x?: boolean;
  };
}
interface RawOiPayload { symbol?: string; openInterest?: string | number; sumOpenInterest?: string | number; time?: number; timestamp?: number; }
interface RawLsPayload { symbol?: string; longShortRatio?: string | number; longAccount?: string | number; shortAccount?: string | number; timestamp?: number; }
interface RawTakerPayload { symbol?: string; buyVol?: string | number; takerBuyVol?: string | number; sellVol?: string | number; takerSellVol?: string | number; buySellRatio?: string | number; timestamp?: number; }

export const DEFAULT_MAX_CLOCK_SKEW_MS = 10_000;

export function isTimestampValid(eventTime: number, now = Date.now(), maxSkewMs = DEFAULT_MAX_CLOCK_SKEW_MS): boolean {
  return Number.isFinite(eventTime) && eventTime > 0 && eventTime <= now + maxSkewMs;
}

export function normalizeBookTicker(payload: unknown, now = Date.now()): NormalizedBookTicker | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as RawTickerPayload;
  const bid = Number(p.b), ask = Number(p.a), bidQty = Number(p.B), askQty = Number(p.A), eventTime = Number(p.E);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask < bid) return null;
  const validEventTime = Number.isFinite(eventTime) ? eventTime : now;
  if (!isTimestampValid(validEventTime, now)) return null;
  return {
    symbol: String(p.s ?? ''), bid, ask,
    bidQty: Number.isFinite(bidQty) ? bidQty : 0, askQty: Number.isFinite(askQty) ? askQty : 0,
    spread: ask - bid, eventTime: validEventTime,
  };
}

export function normalizeAggTrade(payload: unknown, now = Date.now()): NormalizedAggTrade | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as RawAggTradePayload;
  const price = Number(p.p), quantity = Number(p.q), eventTime = Number(p.E ?? p.T);
  if (!Number.isFinite(price) || !Number.isFinite(quantity) || price <= 0 || quantity <= 0) return null;
  const validEventTime = Number.isFinite(eventTime) ? eventTime : now;
  if (!isTimestampValid(validEventTime, now)) return null;
  return { symbol: String(p.s ?? ''), price, quantity, eventTime: validEventTime, isBuyerMaker: Boolean(p.m) };
}

export function normalizeMarkPrice(payload: unknown, now = Date.now()): NormalizedMarkPrice | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as RawMarkPricePayload;
  const markPrice = Number(p.p), indexPrice = Number(p.i), fundingRate = Number(p.r), nextFundingTime = Number(p.T), eventTime = Number(p.E);
  if (!Number.isFinite(markPrice) || markPrice <= 0) return null;
  const validEventTime = Number.isFinite(eventTime) ? eventTime : now;
  if (!isTimestampValid(validEventTime, now)) return null;
  return {
    symbol: String(p.s ?? ''), markPrice,
    indexPrice: Number.isFinite(indexPrice) ? indexPrice : markPrice,
    fundingRate: Number.isFinite(fundingRate) ? fundingRate : 0,
    nextFundingTime: Number.isFinite(nextFundingTime) ? nextFundingTime : 0,
    eventTime: validEventTime,
  };
}

function isValidKlineOhlc(o: number, h: number, l: number, c: number): boolean {
  return Number.isFinite(o) && Number.isFinite(h) && Number.isFinite(l) && Number.isFinite(c) &&
    o > 0 && h > 0 && l > 0 && c > 0 && h >= l && h >= o && h >= c && l <= o && l <= c;
}

export function normalizeKline(payload: unknown, now = Date.now()): NormalizedKline | null {
  if (!payload || typeof payload !== 'object') return null;
  const k = (payload as RawKlinePayload).k;
  if (!k) return null;
  const open = Number(k.o), high = Number(k.h), low = Number(k.l), close = Number(k.c);
  if (!isValidKlineOhlc(open, high, low, close)) return null;
  const openTime = Number(k.t), closeTime = Number(k.T), volume = Number(k.v), quoteVolume = Number(k.q), trades = Number(k.n);
  if (Number.isFinite(openTime) && !isTimestampValid(openTime, now, 86400_000)) return null;
  return {
    symbol: String(k.s ?? ''), interval: String(k.i ?? ''),
    openTime: Number.isFinite(openTime) ? openTime : 0, closeTime: Number.isFinite(closeTime) ? closeTime : 0,
    open, high, low, close,
    volume: Number.isFinite(volume) && volume >= 0 ? volume : 0,
    quoteVolume: Number.isFinite(quoteVolume) && quoteVolume >= 0 ? quoteVolume : 0,
    trades: Number.isFinite(trades) && trades >= 0 ? trades : 0,
    closed: Boolean(k.x),
  };
}

export function normalizeOpenInterest(payload: unknown, now = Date.now()): NormalizedOpenInterest | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as RawOiPayload;
  const oi = Number(p.openInterest ?? p.sumOpenInterest), time = Number(p.time ?? p.timestamp ?? now);
  if (!Number.isFinite(oi) || oi < 0 || !isTimestampValid(time, now)) return null;
  return { symbol: String(p.symbol ?? ''), openInterest: oi, eventTime: time };
}

export function normalizeLongShortRatio(payload: unknown, now = Date.now()): NormalizedLongShortRatio | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as RawLsPayload;
  const ratio = Number(p.longShortRatio), longAccount = Number(p.longAccount ?? 0), shortAccount = Number(p.shortAccount ?? 0), time = Number(p.timestamp ?? now);
  if (!Number.isFinite(ratio) || ratio <= 0 || !isTimestampValid(time, now)) return null;
  return {
    symbol: String(p.symbol ?? ''), longShortRatio: ratio,
    longAccountRatio: Number.isFinite(longAccount) ? longAccount : 0,
    shortAccountRatio: Number.isFinite(shortAccount) ? shortAccount : 0,
    eventTime: time,
  };
}

export function normalizeTakerVolume(payload: unknown, now = Date.now()): NormalizedTakerVolume | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as RawTakerPayload;
  const buyVol = Number(p.buyVol ?? p.takerBuyVol ?? 0), sellVol = Number(p.sellVol ?? p.takerSellVol ?? 0);
  const ratio = Number(p.buySellRatio ?? (sellVol > 0 ? buyVol / sellVol : 1)), time = Number(p.timestamp ?? now);
  if (!Number.isFinite(buyVol) || !Number.isFinite(sellVol) || !isTimestampValid(time, now)) return null;
  return {
    symbol: String(p.symbol ?? ''), buyVolume: buyVol, sellVolume: sellVol,
    takerDelta: buyVol - sellVol, takerRatio: Number.isFinite(ratio) ? ratio : 1, eventTime: time,
  };
}

export function normalizeInstrumentInfo(symbolData: {
  symbol: string;
  baseAsset?: string;
  quoteAsset?: string;
  contractType?: string;
  status?: string;
  pricePrecision?: number;
  quantityPrecision?: number;
  filters?: Array<{ filterType: string; tickSize?: string; stepSize?: string; minQty?: string; maxQty?: string; notional?: string; minNotional?: string }>;
}): Instrument {
  const priceFilter = symbolData.filters?.find((f) => f.filterType === 'PRICE_FILTER');
  const lotFilter = symbolData.filters?.find((f) => f.filterType === 'LOT_SIZE');
  const notionalFilter = symbolData.filters?.find((f) => f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL');
  const baseAsset = symbolData.baseAsset ?? symbolData.symbol.replace('USDT', '');
  return {
    symbol: symbolData.symbol,
    baseAsset,
    quoteAsset: symbolData.quoteAsset ?? 'USDT',
    contractType: symbolData.contractType ?? 'PERPETUAL',
    status: symbolData.status ?? 'TRADING',
    tickSize: priceFilter?.tickSize ?? '0.01',
    stepSize: lotFilter?.stepSize ?? '0.001',
    minQty: lotFilter?.minQty ?? '0.001',
    maxQty: lotFilter?.maxQty ?? '10000',
    minNotional: notionalFilter?.notional ?? notionalFilter?.minNotional ?? '5',
    pricePrecision: symbolData.pricePrecision ?? 2,
    quantityPrecision: symbolData.quantityPrecision ?? 3,
    maintenanceMarginRate: '0.005',
    canonical: `${baseAsset}/USDT`,
    venues: { binance: symbolData.symbol },
    createdAtUtc: new Date().toISOString(),
    updatedAtUtc: new Date().toISOString(),
  };
}

export function applyToMarketState(
  market: MarketState,
  normalized: NormalizedBookTicker | NormalizedAggTrade | NormalizedMarkPrice
): void {
  const now = Date.now();
  if ('bid' in normalized && 'ask' in normalized) {
    market.bid = normalized.bid;
    market.ask = normalized.ask;
    market.bidQty = normalized.bidQty;
    market.askQty = normalized.askQty;
    market.spread = normalized.spread;
  }
  if ('price' in normalized && !('bid' in normalized)) {
    market.last = normalized.price;
    market.lastQty = normalized.quantity;
  }
  if ('markPrice' in normalized) {
    market.mark = normalized.markPrice;
    market.index = normalized.indexPrice;
    market.fundingRate = normalized.fundingRate;
    market.nextFundingTimeUtc = String(normalized.nextFundingTime);
  }
  market.latencyMs = Math.max(0, now - normalized.eventTime);
  market.localTsUtc = now;
  market.stale = false;
}