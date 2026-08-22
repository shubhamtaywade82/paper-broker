import type { MarketState, Instrument } from '../broker/types.js';

export type DataHealthState = 'HEALTHY' | 'DEGRADED' | 'STALE' | 'INVALID' | 'DISCONNECTED';

export class MarketStateManager {
  private states = new Map<string, MarketState>();
  private instruments = new Map<string, Instrument>();

  constructor(instruments: Instrument[]) {
    for (const inst of instruments) {
      this.instruments.set(inst.symbol, inst);
      this.states.set(inst.symbol, {
        symbol: inst.symbol,
        localTsUtc: Date.now(),
        stale: true,
      });
    }
  }

  onBookTicker(symbol: string, bid: number, ask: number, bidQty: number, askQty: number, exchangeTsUtc?: string): void {
    const state = this.states.get(symbol);
    if (!state) return;
    const now = Date.now();
    const exTs = exchangeTsUtc ? Number(exchangeTsUtc) : undefined;

    if (exTs !== undefined) {
      const prevTs = state.exchangeTsUtc ? Number(state.exchangeTsUtc) : 0;
      if (exTs < prevTs) {
        state.lastQualityStatus = 'OUT_OF_ORDER';
        state.lastQualityReason = `Tick timestamp ${exTs} < previous ${prevTs}`;
        return;
      }
      if (exTs > now + 10_000) {
        state.lastQualityStatus = 'INVALID';
        state.lastQualityReason = `Future tick timestamp ${exTs} > now ${now}`;
        return;
      }
    }

    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask < bid) {
      state.lastQualityStatus = 'INVALID';
      state.lastQualityReason = 'Invalid bid/ask spread';
      return;
    }

    state.bid = bid;
    state.ask = ask;
    state.bidQty = bidQty;
    state.askQty = askQty;
    state.spread = ask - bid;
    state.exchangeTsUtc = exchangeTsUtc;
    state.latencyMs = exTs ? Math.max(0, now - exTs) : undefined;
    state.localTsUtc = now;
    state.stale = false;
    state.lastQualityStatus = 'VALID';
  }

  onAggTrade(symbol: string, price: number, qty: number, exchangeTsUtc?: string): void {
    const state = this.states.get(symbol);
    if (!state) return;
    const now = Date.now();
    const exTs = exchangeTsUtc ? Number(exchangeTsUtc) : undefined;

    if (exTs !== undefined && exTs > now + 10_000) {
      state.lastQualityStatus = 'INVALID';
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      state.lastQualityStatus = 'INVALID';
      return;
    }

    state.last = price;
    state.lastQty = qty;
    state.exchangeTsUtc = exchangeTsUtc;
    state.localTsUtc = now;
    state.stale = false;
    state.lastQualityStatus = 'VALID';
  }

  onMarkPrice(symbol: string, mark: number, index: number, fundingRate: number, nextFundingTimeUtc?: string, exchangeTsUtc?: string): void {
    const state = this.states.get(symbol);
    if (!state) return;
    const now = Date.now();
    const exTs = exchangeTsUtc ? Number(exchangeTsUtc) : undefined;

    if (exTs !== undefined && exTs > now + 10_000) {
      state.lastQualityStatus = 'INVALID';
      return;
    }
    if (!Number.isFinite(mark) || mark <= 0) {
      state.lastQualityStatus = 'INVALID';
      return;
    }

    state.mark = mark;
    state.index = index;
    state.fundingRate = fundingRate;
    state.nextFundingTimeUtc = nextFundingTimeUtc;
    state.exchangeTsUtc = exchangeTsUtc;
    state.localTsUtc = now;
    state.stale = false;
    state.lastQualityStatus = 'VALID';
  }

  onDerivatives(symbol: string, data: {
    openInterest?: number;
    openInterestDelta?: number;
    openInterestTimestampUtc?: string;
    longShortRatio?: number;
    longShortTimestampUtc?: string;
    topTraderLongShortRatio?: number;
    topTraderTimestampUtc?: string;
    takerBuyVolume?: number;
    takerSellVolume?: number;
    takerDelta?: number;
    takerVolumeTimestampUtc?: string;
  }): void {
    const state = this.states.get(symbol);
    if (!state) return;

    if (data.openInterest !== undefined) {
      state.openInterest = data.openInterest;
      state.openInterestTimestampUtc = data.openInterestTimestampUtc ?? new Date().toISOString();
    }
    if (data.openInterestDelta !== undefined) state.openInterestDelta = data.openInterestDelta;
    if (data.longShortRatio !== undefined) {
      state.longShortRatio = data.longShortRatio;
      state.longShortTimestampUtc = data.longShortTimestampUtc ?? new Date().toISOString();
    }
    if (data.topTraderLongShortRatio !== undefined) {
      state.topTraderLongShortRatio = data.topTraderLongShortRatio;
      state.topTraderTimestampUtc = data.topTraderTimestampUtc ?? new Date().toISOString();
    }
    if (data.takerBuyVolume !== undefined) state.takerBuyVolume = data.takerBuyVolume;
    if (data.takerSellVolume !== undefined) state.takerSellVolume = data.takerSellVolume;
    if (data.takerDelta !== undefined) state.takerDelta = data.takerDelta;
    if (data.takerVolumeTimestampUtc !== undefined || data.takerBuyVolume !== undefined || data.takerSellVolume !== undefined || data.takerDelta !== undefined) {
      state.takerVolumeTimestampUtc = data.takerVolumeTimestampUtc ?? new Date().toISOString();
    }
    state.localTsUtc = Date.now();
  }

  getState(symbol: string): MarketState | undefined {
    return this.states.get(symbol);
  }

  getAllStates(): MarketState[] {
    return Array.from(this.states.values());
  }

  getInstrument(symbol: string): Instrument | undefined {
    return this.instruments.get(symbol);
  }

  getAllInstruments(): Instrument[] {
    return Array.from(this.instruments.values());
  }

  markStale(maxAgeMs: number): void {
    const now = Date.now();
    for (const state of this.states.values()) {
      if (now - state.localTsUtc >= maxAgeMs) {
        state.stale = true;
      }
    }
  }

  isStale(symbol: string, maxAgeMs: number): boolean {
    const state = this.states.get(symbol);
    if (!state) return true;
    return state.stale || Date.now() - state.localTsUtc >= maxAgeMs;
  }

  hasValidBidAsk(symbol: string): boolean {
    const state = this.states.get(symbol);
    return !!state && Number.isFinite(state.bid ?? NaN) && Number.isFinite(state.ask ?? NaN) && (state.ask ?? 0) >= (state.bid ?? 0);
  }

  hasValidMark(symbol: string): boolean {
    const state = this.states.get(symbol);
    return !!state && Number.isFinite(state.mark ?? NaN) && (state.mark ?? 0) > 0;
  }

  getDataHealth(symbol: string, maxAgeMs = 5000): DataHealthState {
    const state = this.states.get(symbol);
    if (!state) return 'DISCONNECTED';
    if (this.isStale(symbol, maxAgeMs)) return 'STALE';
    if (!this.hasValidBidAsk(symbol) || !this.hasValidMark(symbol)) return 'INVALID';
    if ((state.latencyMs ?? 0) > 2000) return 'DEGRADED';
    return 'HEALTHY';
  }
}