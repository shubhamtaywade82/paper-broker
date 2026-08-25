import { create } from 'zustand';
import type { Order, Position, Signal } from '../lib/wsContracts.js';

export interface TradingStore {
  positions: Record<string, Position>;
  openOrders: Order[];
  recentSignals: Signal[];
  upsertPosition: (p: Position) => void;
  removePosition: (id: string) => void;
  upsertOrder: (o: Order) => void;
  removeOrder: (id: string) => void;
  pushSignal: (s: Signal) => void;
  reset: () => void;
}

export const useTradingStore = create<TradingStore>()((set) => ({
  positions: {},
  openOrders: [],
  recentSignals: [],

  upsertPosition: (p) =>
    set((st) => ({
      positions: { ...st.positions, [p.id]: p },
    })),

  removePosition: (id) =>
    set((st) => {
      const next = { ...st.positions };
      delete next[id];
      return { positions: next };
    }),

  upsertOrder: (o) =>
    set((st) => ({
      openOrders: st.openOrders.some((x) => x.id === o.id)
        ? st.openOrders.map((x) => (x.id === o.id ? o : x))
        : [...st.openOrders, o],
    })),

  removeOrder: (id) =>
    set((st) => ({
      openOrders: st.openOrders.filter((x) => x.id !== id),
    })),

  pushSignal: (s) =>
    set((st) => ({
      recentSignals: [s, ...st.recentSignals].slice(0, 50),
    })),

  reset: () =>
    set({
      positions: {},
      openOrders: [],
      recentSignals: [],
    }),
}));
