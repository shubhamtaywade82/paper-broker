import type { MarketState } from '../broker/types.js';

export interface NormalizedBookTicker {
  symbol: string;
  bid: number;
  ask: number;
  bidQty: number;
  askQty: number;
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

export function normalizeBookTicker(payload: any): NormalizedBookTicker | null {
  try {
    return {
      symbol: String(payload.s),
      bid: Number(payload.b),
      ask: Number(payload.a),
      bidQty: Number(payload.B),
      askQty: Number(payload.A),
      eventTime: Number(payload.E),
    };
  } catch {
    return null;
  }
}

export function normalizeAggTrade(payload: any): NormalizedAggTrade | null {
  try {
    return {
      symbol: String(payload.s),
      price: Number(payload.p),
      quantity: Number(payload.q),
      eventTime: Number(payload.E),
      isBuyerMaker: Boolean(payload.m),
    };
  } catch {
    return null;
  }
}

export function normalizeMarkPrice(payload: any): NormalizedMarkPrice | null {
  try {
    return {
      symbol: String(payload.s),
      markPrice: Number(payload.p),
      indexPrice: Number(payload.i),
      fundingRate: Number(payload.r),
      nextFundingTime: Number(payload.T),
      eventTime: Number(payload.E),
    };
  } catch {
    return null;
  }
}

export function normalizeKline(payload: any): NormalizedKline | null {
  try {
    const k = payload.k;
    return {
      symbol: String(k.s),
      interval: String(k.i),
      openTime: Number(k.t),
      closeTime: Number(k.T),
      open: Number(k.o),
      high: Number(k.h),
      low: Number(k.l),
      close: Number(k.c),
      volume: Number(k.v),
      quoteVolume: Number(k.q),
      trades: Number(k.n),
      closed: Boolean(k.x),
    };
  } catch {
    return null;
  }
}

export function applyToMarketState(market: MarketState, normalized: NormalizedBookTicker | NormalizedAggTrade | NormalizedMarkPrice): void {
  if ('bid' in normalized && 'ask' in normalized) {
    market.bid = normalized.bid;
    market.ask = normalized.ask;
    market.bidQty = normalized.bidQty;
    market.askQty = normalized.askQty;
  }
  if ('price' in normalized && 'quantity' in normalized && !('bid' in normalized)) {
    market.last = normalized.price;
    market.lastQty = normalized.quantity;
  }
  if ('markPrice' in normalized) {
    market.mark = normalized.markPrice;
    market.index = normalized.indexPrice;
    market.fundingRate = normalized.fundingRate;
    market.nextFundingTimeUtc = String(normalized.nextFundingTime);
  }
  market.localTsUtc = Date.now();
  market.stale = false;
}