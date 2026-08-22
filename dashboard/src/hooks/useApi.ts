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
      const data = await fetchJson<{ cycles: Array<Record<string, unknown>> }>(url);
      const cycles: AgentCycle[] = (data.cycles || []).map((c) => ({
        cycleId: String(c.cycle_id ?? c.cycleId ?? ''),
        symbol: String(c.symbol ?? ''),
        startedAt: Number(c.started_at ?? c.startedAt ?? 0),
        completedAt: c.completed_at != null ? Number(c.completed_at) : undefined,
        executed: Boolean(c.executed),
        action: String((c.verdict as Record<string, unknown>)?.prevailingSide ?? c.action ?? 'UNKNOWN'),
        confidence: Number(c.confidence ?? 0),
        verdict: typeof c.verdict === 'object' ? String((c.verdict as Record<string, unknown>)?.prevailingSide ?? '') : String(c.verdict ?? ''),
        rationale: String((c.verdict as Record<string, unknown>)?.rationale ?? c.rationale ?? ''),
      }));
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
      const raw = await fetchJson<Record<string, unknown>>(`/api/v1/agents/cycles/${cycleId}`);
      const data: CycleDetail = {
        cycleId: String(raw.cycle_id ?? ''),
        symbol: String(raw.symbol ?? ''),
        startedAt: Number(raw.started_at ?? 0),
        completedAt: raw.completed_at != null ? Number(raw.completed_at) : undefined,
        executed: Boolean(raw.executed),
        action: String((raw.verdict as Record<string, unknown>)?.prevailingSide ?? ''),
        confidence: Number(raw.confidence ?? 0),
        verdict: String((raw.verdict as Record<string, unknown>)?.prevailingSide ?? ''),
        rationale: String(raw.rationale ?? ''),
        analystReports: Array.isArray(raw.analyst_reports)
          ? (raw.analyst_reports as Array<Record<string, unknown>>).map((r) => ({
              agent: String(r.agent ?? ''),
              summary: String(r.summary ?? ''),
              bullishSignals: Array.isArray(r.bullishSignals) ? (r.bullishSignals as string[]) : [],
              bearishSignals: Array.isArray(r.bearishSignals) ? (r.bearishSignals as string[]) : [],
              confidence: Number(r.confidence ?? 0),
            }))
          : [],
        debate: Array.isArray(raw.debate_history)
          ? (raw.debate_history as Array<Record<string, unknown>>).map((d) => ({
              role: d.role as 'BULL' | 'BEAR',
              round: Number(d.round ?? 0),
              argument: String(d.argument ?? ''),
            }))
          : [],
        riskOpinions: Array.isArray(raw.risk_opinions)
          ? (raw.risk_opinions as Array<Record<string, unknown>>).map((r) => ({
              persona: String(r.persona ?? ''),
              verdict: String(r.verdict ?? ''),
              rationale: String(r.rationale ?? ''),
            }))
          : [],
        fundManagerApproval: (() => {
          const fma = raw.fund_manager_approval as Record<string, unknown> | undefined;
          const fd = fma?.finalDecision as Record<string, unknown> | undefined;
          return {
            approved: Boolean(fma?.approved),
            rationale: String(fma?.rationale ?? ''),
            finalDecision: {
              action: String(fd?.action ?? ''),
              leverage: Number(fd?.leverage ?? 0),
              sizePct: Number(fd?.sizePct ?? 0),
              stopLoss: fd?.stopLoss != null ? Number(fd.stopLoss) : undefined,
              takeProfit: fd?.takeProfit != null ? Number(fd.takeProfit) : undefined,
            },
          };
        })(),
      };
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
