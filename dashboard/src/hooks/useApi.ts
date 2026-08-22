import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useStore, type AgentCycle, type CycleDetail, type PerformanceMetrics, type AccountInfo, type Position } from '../store/useStore';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export function useDashboard() {
  const setAccount = useStore((s) => s.setAccount);
  const setPositions = useStore((s) => s.setPositions);

  return useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const data = await fetchJson<{
        account: AccountInfo;
        positions: Position[];
      }>('/api/v1/dashboard');

      if (data.account) setAccount(data.account);
      if (data.positions) setPositions(data.positions);
      return data;
    },
    refetchInterval: 5000,
  });
}

export function useCycles(symbol?: string) {
  const setCycles = useStore((s) => s.setCycles);

  return useQuery({
    queryKey: ['cycles', symbol],
    queryFn: async () => {
      const url = symbol
        ? `/api/v1/agents/cycles?symbol=${symbol}&limit=50`
        : '/api/v1/agents/cycles?limit=50';
      const data = await fetchJson<{ cycles: AgentCycle[] }>(url);
      const cycles = data.cycles || [];
      setCycles(cycles);
      return cycles;
    },
    refetchInterval: 10000,
  });
}

export function useCycleDetail(cycleId: string | null) {
  const setSelectedCycle = useStore((s) => s.setSelectedCycle);

  return useQuery({
    queryKey: ['cycle-detail', cycleId],
    queryFn: async () => {
      if (!cycleId) return null;
      const data = await fetchJson<CycleDetail>(`/api/v1/agents/cycles/${cycleId}`);
      setSelectedCycle(data);
      return data;
    },
    enabled: !!cycleId,
  });
}

export function useEquityCurve(limit = 100) {
  return useQuery({
    queryKey: ['equity-curve', limit],
    queryFn: () =>
      fetchJson<Array<{
        ts: string;
        equity: number;
        walletBalance: number;
        totalRealizedPnl: number;
        drawdown: number | null;
      }>>(`/api/v1/equity-curve?limit=${limit}`),
    refetchInterval: 30000,
  });
}

export function usePerformance(period = '30d') {
  const setPerformance = useStore((s) => s.setPerformance);
  const account = useStore((s) => s.account);

  return useQuery({
    queryKey: ['performance', period],
    queryFn: async () => {
      const winRateData = await fetchJson<{ winRate: number; wins: number; losses: number }>(
        '/api/v1/win-rate'
      );
      const data: PerformanceMetrics = {
        period,
        totalTrades: (winRateData.wins || 0) + (winRateData.losses || 0),
        wins: winRateData.wins || 0,
        losses: winRateData.losses || 0,
        winRate: winRateData.winRate || 0,
        totalPnl: account?.unrealizedPnl ?? 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        currentEquity: account?.equity ?? 0,
      };
      setPerformance(data);
      return data;
    },
    refetchInterval: 15000,
  });
}


export function useTriggerCycle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (symbol: string) => {
      const res = await fetch('/api/v1/agents/cycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cycles'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
