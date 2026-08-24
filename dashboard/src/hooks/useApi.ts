import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  useStore,
  type AgentCycle,
  type CycleDetail,
  type PerformanceMetrics,
  type AccountInfo,
  type Position,
  type Order,
  type RiskSummary,
  type OrderbookDepth,
  type TickerData,
} from '../store/useStore';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let errMessage = `API error: ${res.status}`;
    try {
      const errBody = await res.json();
      if (errBody?.message || errBody?.error) {
        errMessage = String(errBody.message || errBody.error);
      }
    } catch {
      // ignore
    }
    throw new Error(errMessage);
  }
  return res.json();
}

export function useDashboard() {
  const setAccount = useStore((s) => s.setAccount);
  const setPositions = useStore((s) => s.setPositions);
  const setOperatingMode = useStore((s) => s.setOperatingMode);
  const setAggressiveMode = useStore((s) => s.setAggressiveMode);

  return useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const data = await fetchJson<{
        mode?: 'paper' | 'shadow' | 'live';
        liveArmed?: boolean;
        aggressiveMode?: boolean;
        engineRunning?: boolean;
        account: AccountInfo;
        positions: Position[];
        health: Record<string, unknown>;
        incidents: Array<Record<string, unknown>>;
      }>('/api/v1/dashboard');

      if (data.account) setAccount(data.account);
      if (data.positions) setPositions(data.positions);
      if (data.mode) setOperatingMode(data.mode, data.liveArmed);
      if (typeof data.aggressiveMode === 'boolean') setAggressiveMode(data.aggressiveMode);
      return data;
    },
    refetchInterval: 5000,
  });
}

export function useRiskSummary() {
  const setRiskSummary = useStore((s) => s.setRiskSummary);

  return useQuery({
    queryKey: ['risk-summary'],
    queryFn: async () => {
      const data = await fetchJson<RiskSummary>('/api/v1/risk');
      setRiskSummary(data);
      return data;
    },
    refetchInterval: 5000,
  });
}

export interface ProviderHealthState {
  provider: string;
  status: 'HEALTHY' | 'DEGRADED' | 'STALE' | 'DISCONNECTED' | 'RECOVERING';
  lastTickTimeMs: number;
  latencyMs: number;
  stale: boolean;
  consecutiveMisses: number;
}

export function useProviderHealth() {
  return useQuery({
    queryKey: ['provider-health'],
    queryFn: () =>
      fetchJson<{
        activeProvider: string;
        binance?: ProviderHealthState;
        coindcx?: ProviderHealthState;
      }>('/api/v1/health/providers'),
    refetchInterval: 5000,
  });
}

export function useOpenOrders(symbol?: string) {
  const setOpenOrders = useStore((s) => s.setOpenOrders);

  return useQuery({
    queryKey: ['open-orders', symbol],
    queryFn: async () => {
      const url = symbol ? `/orders?symbol=${symbol}` : '/orders';
      const data = await fetchJson<Order[]>(url);
      setOpenOrders(data || []);
      return data || [];
    },
    refetchInterval: 4000,
  });
}

export function useTickers() {
  const setTickers = useStore((s) => s.setTickers);

  return useQuery({
    queryKey: ['tickers'],
    queryFn: async () => {
      const raw = await fetchJson<Array<Record<string, unknown>>>('/api/v1/tickers');
      const tickersMap: Record<string, TickerData> = {};
      if (Array.isArray(raw)) {
        for (const item of raw) {
          const sym = String(item.symbol || '');
          if (!sym) continue;
          tickersMap[sym] = {
            symbol: sym,
            price: parseFloat(String(item.lastPrice || item.price || 0)),
            change24h: parseFloat(String(item.priceChangePercent || 0)),
            high24h: parseFloat(String(item.highPrice || 0)),
            low24h: parseFloat(String(item.lowPrice || 0)),
            volume24h: parseFloat(String(item.volume || item.quoteVolume || 0)),
            fundingRate: item.lastFundingRate ? parseFloat(String(item.lastFundingRate)) : undefined,
            markPrice: item.markPrice ? parseFloat(String(item.markPrice)) : undefined,
          };
        }
      }
      setTickers(tickersMap);
      return tickersMap;
    },
    refetchInterval: 8000,
  });
}

export function useOrderbook(symbol: string) {
  const setOrderbook = useStore((s) => s.setOrderbook);

  return useQuery({
    queryKey: ['orderbook', symbol],
    queryFn: async () => {
      const data = await fetchJson<OrderbookDepth>(`/api/v1/orderbook?symbol=${symbol}&limit=12`);
      if (data) setOrderbook(data);
      return data;
    },
    refetchInterval: 2500,
  });
}

export function useTrades(symbol: string) {
  return useQuery({
    queryKey: ['trades', symbol],
    queryFn: () =>
      fetchJson<Array<{ price: number; qty: number; ts: number; isBuyerMaker: boolean }>>(
        `/api/v1/trades?symbol=${symbol}&limit=20`
      ),
    refetchInterval: 3000,
  });
}

export function useKlines(symbol: string, interval = '15m', limit = 100) {
  return useQuery({
    queryKey: ['klines', symbol, interval, limit],
    queryFn: () =>
      fetchJson<Array<{
        openTime: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        closeTime: number;
      }>>(`/api/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`),
    refetchInterval: 15000,
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
        confidence: Number((c.trader_decision as Record<string, unknown>)?.confidence ?? c.confidence ?? 0),
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
        confidence: Number((raw.trader_decision as Record<string, unknown>)?.confidence ?? raw.confidence ?? 0),
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

export function useActivity(limit = 50) {
  return useQuery({
    queryKey: ['activity', limit],
    queryFn: () =>
      fetchJson<Array<{
        id: string;
        type: string;
        ts: string;
        payload: Record<string, unknown>;
      }>>(`/api/v1/activity?limit=${limit}`),
    refetchInterval: 5000,
  });
}

export function useCreateOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      symbol: string;
      side: 'BUY' | 'SELL';
      type: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
      quantity: number;
      price?: number;
      stopPrice?: number;
      leverage?: number;
      reduceOnly?: boolean;
      postOnly?: boolean;
    }) =>
      fetchJson<Order>('/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['open-orders'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useCancelOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (orderId: string) =>
      fetchJson<Order>('/orders/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['open-orders'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useCancelAllOrders() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (symbol?: string) =>
      fetchJson<{ canceled: boolean; symbol: string }>('/orders/cancel-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['open-orders'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useArmMode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (passcode?: string) =>
      fetchJson<{ armed: boolean }>('/api/v1/mode/arm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      }),
    onSuccess: () => {
      useStore.getState().setOperatingMode('live', true);
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['risk-summary'] });
    },
  });
}

export function useDisarmMode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      fetchJson<{ armed: boolean }>('/api/v1/mode/disarm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      useStore.getState().setOperatingMode('live', false);
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['risk-summary'] });
    },
  });
}

export function useEngineControl() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (action: 'start' | 'stop' | 'kill-switch') =>
      fetchJson<Record<string, unknown>>(`/engine/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['open-orders'] });
    },
  });
}

export function useTriggerCycle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ symbol, model }: { symbol: string; model?: string }) => {
      return fetchJson('/api/v1/agents/cycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, model }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cycles'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useSetAggressiveMode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (enabled: boolean) => {
      return fetchJson<{ aggressive: boolean }>('/api/v1/mode/aggressive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
    },
    onSuccess: (res) => {
      useStore.getState().setAggressiveMode(res.aggressive);
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useTriggerEvaluation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return fetchJson<{ evaluated: number }>('/api/v1/engine/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['open-orders'] });
    },
  });
}
