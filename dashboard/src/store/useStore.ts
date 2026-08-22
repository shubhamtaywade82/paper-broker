import { create } from 'zustand';

export interface Position {
  symbol: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  liquidationPrice?: number;
  margin?: number;
}

export interface AgentCycle {
  cycleId: string;
  symbol: string;
  startedAt: number;
  completedAt?: number;
  executed: boolean;
  action: string;
  confidence: number;
  verdict: string;
  rationale: string;
}

export interface AccountInfo {
  balance: number;
  equity: number;
  unrealizedPnl: number;
  marginUsed: number;
  freeMargin: number;
}

export interface PerformanceMetrics {
  period: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  sharpeRatio: number;
  maxDrawdown: number;
  currentEquity: number;
}

export interface DebateEntry {
  role: 'BULL' | 'BEAR';
  round: number;
  argument: string;
}

export interface RiskOpinion {
  persona: string;
  verdict: string;
  rationale: string;
}

export interface CycleDetail extends AgentCycle {
  analystReports: Array<{
    agent: string;
    summary: string;
    bullishSignals: string[];
    bearishSignals: string[];
    confidence: number;
  }>;
  debate: DebateEntry[];
  riskOpinions: RiskOpinion[];
  fundManagerApproval: {
    approved: boolean;
    rationale: string;
    finalDecision: {
      action: string;
      leverage: number;
      sizePct: number;
      stopLoss?: number;
      takeProfit?: number;
    };
  };
}

export interface LiveEventItem {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

interface StoreState {
  account: AccountInfo | null;
  positions: Position[];
  cycles: AgentCycle[];
  selectedCycle: CycleDetail | null;
  performance: PerformanceMetrics | null;
  wsConnected: boolean;
  liveEvents: LiveEventItem[];
  livePrice: Record<string, number>;

  setAccount: (account: AccountInfo) => void;
  setPositions: (positions: Position[]) => void;
  setCycles: (cycles: AgentCycle[]) => void;
  setSelectedCycle: (cycle: CycleDetail | null) => void;
  setPerformance: (perf: PerformanceMetrics) => void;
  setWsConnected: (connected: boolean) => void;
  addLiveEvent: (event: { type: string; payload: Record<string, unknown> }) => void;
  setLivePrice: (symbol: string, price: number) => void;
}

export const useStore = create<StoreState>((set) => ({
  account: null,
  positions: [],
  cycles: [],
  selectedCycle: null,
  performance: null,
  wsConnected: false,
  liveEvents: [],
  livePrice: {},

  setAccount: (account) => set({ account }),
  setPositions: (positions) => set({ positions }),
  setCycles: (cycles) => set({ cycles }),
  setSelectedCycle: (cycle) => set({ selectedCycle: cycle }),
  setPerformance: (perf) => set({ performance: perf }),
  setWsConnected: (connected) => set({ wsConnected: connected }),
  addLiveEvent: (event) =>
    set((state) => ({
      liveEvents: [
        { ...event, timestamp: Date.now() },
        ...state.liveEvents.slice(0, 99),
      ],
    })),
  setLivePrice: (symbol, price) =>
    set((state) => ({ livePrice: { ...state.livePrice, [symbol]: price } })),
}));
