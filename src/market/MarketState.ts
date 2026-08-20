import type { MarketState, Instrument } from '../broker/types.js';

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

    state.bid = bid;
    state.ask = ask;
    state.bidQty = bidQty;
    state.askQty = askQty;
    state.exchangeTsUtc = exchangeTsUtc;
    state.localTsUtc = Date.now();
    state.stale = false;
  }

  onAggTrade(symbol: string, price: number, qty: number, exchangeTsUtc?: string): void {
    const state = this.states.get(symbol);
    if (!state) return;

    state.last = price;
    state.lastQty = qty;
    state.exchangeTsUtc = exchangeTsUtc;
    state.localTsUtc = Date.now();
    state.stale = false;
  }

  onMarkPrice(symbol: string, mark: number, index: number, fundingRate: number, nextFundingTimeUtc?: string, exchangeTsUtc?: string): void {
    const state = this.states.get(symbol);
    if (!state) return;

    state.mark = mark;
    state.index = index;
    state.fundingRate = fundingRate;
    state.nextFundingTimeUtc = nextFundingTimeUtc;
    state.exchangeTsUtc = exchangeTsUtc;
    state.localTsUtc = Date.now();
    state.stale = false;
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
      if (now - state.localTsUtc > maxAgeMs) {
        state.stale = true;
      }
    }
  }

  isStale(symbol: string, maxAgeMs: number): boolean {
    const state = this.states.get(symbol);
    if (!state) return true;
    return state.stale || Date.now() - state.localTsUtc > maxAgeMs;
  }

  hasValidBidAsk(symbol: string): boolean {
    const state = this.states.get(symbol);
    return !!state && Number.isFinite(state.bid ?? NaN) && Number.isFinite(state.ask ?? NaN);
  }

  hasValidMark(symbol: string): boolean {
    const state = this.states.get(symbol);
    return !!state && Number.isFinite(state.mark ?? NaN);
  }
}