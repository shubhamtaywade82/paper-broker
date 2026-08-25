import { create } from 'zustand';

export interface AgentCycleData {
  cycleId: string;
  symbol: string;
  action: string;
  confidence: number;
  verdict: string;
  startedAt: number;
  completedAt?: number;
}

export interface AgentStore {
  cycles: AgentCycleData[];
  activeCycleId: string | null;
  llmStatus: 'idle' | 'analyzing' | 'debating' | 'deciding';
  addCycle: (cycle: AgentCycleData) => void;
  setActiveCycle: (id: string | null) => void;
  setLlmStatus: (status: AgentStore['llmStatus']) => void;
  reset: () => void;
}

export const useAgentStore = create<AgentStore>()((set) => ({
  cycles: [],
  activeCycleId: null,
  llmStatus: 'idle',
  addCycle: (cycle) => set((st) => ({ cycles: [cycle, ...st.cycles].slice(0, 100) })),
  setActiveCycle: (id) => set({ activeCycleId: id }),
  setLlmStatus: (status) => set({ llmStatus: status }),
  reset: () => set({ cycles: [], activeCycleId: null, llmStatus: 'idle' }),
}));
