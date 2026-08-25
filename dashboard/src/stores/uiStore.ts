import { create } from 'zustand';

export type WorkspaceTab =
  | 'dashboard'
  | 'markets'
  | 'trading'
  | 'agent'
  | 'research'
  | 'risk'
  | 'activity'
  | 'system';

export interface UiStore {
  activeTab: WorkspaceTab;
  selectedSymbol: string;
  timeframe: string;
  sidebarOpen: boolean;
  setActiveTab: (tab: WorkspaceTab) => void;
  setSelectedSymbol: (symbol: string) => void;
  setTimeframe: (timeframe: string) => void;
  setSidebarOpen: (open: boolean) => void;
}

export const useUiStore = create<UiStore>()((set) => ({
  activeTab: 'dashboard',
  selectedSymbol: 'BTCUSDT',
  timeframe: '5m',
  sidebarOpen: true,
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),
  setTimeframe: (timeframe) => set({ timeframe }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}));
