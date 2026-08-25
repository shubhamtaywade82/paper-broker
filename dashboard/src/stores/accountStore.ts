import { create } from 'zustand';

export interface AccountSnapshot {
  balance: number;
  equity: number;
  available: number;
  marginUsed: number;
  peakEquity: number;
  dailyPnl: number;
}

export interface AccountStore extends AccountSnapshot {
  setSnapshot: (s: AccountSnapshot) => void;
  setBalance: (balance: number, equity?: number) => void;
  reset: () => void;
}

const EMPTY: AccountSnapshot = {
  balance: 0,
  equity: 0,
  available: 0,
  marginUsed: 0,
  peakEquity: 0,
  dailyPnl: 0,
};

export const useAccountStore = create<AccountStore>()((set) => ({
  ...EMPTY,
  setSnapshot: (s) => set(s),
  setBalance: (balance, equity) => set((st) => ({ balance, equity: equity ?? st.equity })),
  reset: () => set(EMPTY),
}));
