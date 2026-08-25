import { create } from 'zustand';

export interface SystemStore {
  mode: 'paper' | 'shadow' | 'live';
  liveArmed: boolean;
  engineRunning: boolean;
  providerHealth: Record<string, { latencyMs: number; status: string }>;
  incidentCount: number;
  setSystem: (p: Partial<Omit<SystemStore, 'setSystem'>>) => void;
  reset: () => void;
}

const DEFAULT_SYSTEM: Omit<SystemStore, 'setSystem' | 'reset'> = {
  mode: 'paper',
  liveArmed: false,
  engineRunning: false,
  providerHealth: {},
  incidentCount: 0,
};

export const useSystemStore = create<SystemStore>()((set) => ({
  ...DEFAULT_SYSTEM,
  setSystem: (p) => set(p),
  reset: () => set(DEFAULT_SYSTEM),
}));
