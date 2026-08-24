import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Play, ArrowLeft, Zap, FlaskConical } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from 'recharts';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

interface BacktestRunSummary {
  id: string;
  symbol: string;
  start_time: number;
  end_time: number;
  duration_days: number;
  initial_equity: number;
  final_equity: number;
  total_net_pnl: number;
  total_return_pct: number;
  total_trades: number;
  win_rate: number;
  profit_factor: number;
  max_drawdown: number;
  avg_r: number;
  created_at_utc: string;
}

interface BacktestFullReport {
  runId: string;
  report: {
    id: string;
    symbol: string;
    startTime: number;
    endTime: number;
    durationDays: number;
    initialEquity: number;
    finalEquity: number;
    totalNetPnl: number;
    totalReturnPct: number;
    coreMetrics: {
      totalTrades: number;
      winningTrades: number;
      losingTrades: number;
      winRate: number;
      grossProfit: number;
      grossLoss: number;
      netPnL: number;
      totalFees: number;
      profitFactor: number;
      averageR: number;
      maxDrawdown: number;
      averageTrade: number;
      averageWinner: number;
      averageLoser: number;
      largestWinner: number;
      largestLoser: number;
      averageHoldingTimeMs: number;
    };
    trades: Array<{
      tradeId: string;
      symbol: string;
      setupType: string;
      direction: string;
      entryPrice: number;
      exitPrice?: number;
      quantity: number;
      leverage: number;
      netPnl: number;
      fees: number;
      entryTimestamp: number;
      exitTimestamp?: number;
      exitReason?: string;
      durationMs?: number;
      status: string;
    }>;
    monteCarlo?: {
      iterations: number;
      meanNetPnl: number;
      medianNetPnl: number;
      probabilityOfRuin: number;
      maxDrawdownP95: number;
    };
  };
}

export function ResearchView() {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [viewReport, setViewReport] = useState<BacktestFullReport | null>(null);
  const [subTab, setSubTab] = useState<'backtest' | 'strategies'>('backtest');

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['backtest-history'],
    queryFn: () => fetchJson<{ runs: BacktestRunSummary[] }>('/api/v1/backtest/history?limit=20'),
    refetchInterval: 30000,
  });

  const runMutation = useMutation({
    mutationFn: (params: Record<string, unknown>) =>
      fetchJson<BacktestFullReport>('/api/v1/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      }),
    onSuccess: (data) => {
      setViewReport(data);
      setSelectedRunId(data.runId);
      queryClient.invalidateQueries({ queryKey: ['backtest-history'] });
    },
  });

  const loadReport = async (runId: string) => {
    try {
      const data = await fetchJson<BacktestFullReport>(`/api/v1/backtest/${runId}`);
      setViewReport(data);
      setSelectedRunId(runId);
    } catch (err) {
      console.error('Failed to load backtest report:', err);
    }
  };

  if (viewReport) {
    return (
      <div className="space-y-6 font-mono text-xs select-none">
        <ReportDetail
          report={viewReport}
          onBack={() => {
            setViewReport(null);
            setSelectedRunId(null);
          }}
        />
      </div>
    );
  }

  const runs = historyData?.runs ?? [];

  return (
    <div className="space-y-5 font-mono text-xs select-none">
      {/* Sub-tab Navigation */}
      <div className="flex items-center gap-2 bg-[#0f1623] border border-[#1b2537] p-4 rounded-xl">
        <button
          onClick={() => setSubTab('backtest')}
          className={`px-4 py-2 rounded-lg font-bold uppercase transition-all cursor-pointer ${
            subTab === 'backtest'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30'
              : 'bg-[#080c14] text-gray-400 hover:text-white border border-[#1b2537]'
          }`}
        >
          Backtest Studio
        </button>
        <button
          onClick={() => setSubTab('strategies')}
          className={`px-4 py-2 rounded-lg font-bold uppercase transition-all cursor-pointer ${
            subTab === 'strategies'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30'
              : 'bg-[#080c14] text-gray-400 hover:text-white border border-[#1b2537]'
          }`}
        >
          Strategy Catalog
        </button>
      </div>

      {subTab === 'strategies' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white text-sm">SMC Agent Strategy (v1)</span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold text-[10px]">
                PRODUCTION
              </span>
            </div>
            <p className="text-gray-400 text-xs leading-relaxed">
              Smart Money Concepts structural breakout detection coupled with dialectical LLM debate
              and deterministic risk gate validation. Targets 1:2 R:R setups with automatic breakeven triggers.
            </p>
            <div className="grid grid-cols-2 gap-2 text-[11px] pt-2 border-t border-[#1b2537]">
              <div>
                <span className="text-gray-500 block">Min Confluence</span>
                <span className="text-white font-bold">40 / 100</span>
              </div>
              <div>
                <span className="text-gray-500 block">Execution Style</span>
                <span className="text-white font-bold">Limit / Maker</span>
              </div>
            </div>
          </div>

          <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white text-sm">Multi-Timeframe State Engine</span>
              <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-bold text-[10px]">
                ACTIVE
              </span>
            </div>
            <p className="text-gray-400 text-xs leading-relaxed">
              Synthesizes 1H macro bias, 15m structural order flow, and 5m execution timing to prevent
              counter-trend entries and detect regime transitions in real-time.
            </p>
            <div className="grid grid-cols-2 gap-2 text-[11px] pt-2 border-t border-[#1b2537]">
              <div>
                <span className="text-gray-500 block">Timeframes</span>
                <span className="text-white font-bold">5m / 15m / 1h</span>
              </div>
              <div>
                <span className="text-gray-500 block">Filter Gate</span>
                <span className="text-white font-bold">Structure Alignment</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <BacktestForm
            onRun={(params) => runMutation.mutate(params)}
            isPending={runMutation.isPending}
          />

          {runMutation.isError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400">
              Backtest failed: {(runMutation.error as Error).message}
            </div>
          )}

          {/* Run History Archive */}
          <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5">
            <h3 className="font-bold text-white uppercase text-xs mb-4">Historical Backtest Runs</h3>
            {historyLoading ? (
              <p className="text-center text-gray-500 py-6">Loading backtest archive...</p>
            ) : runs.length === 0 ? (
              <p className="text-center text-gray-500 py-8">
                No backtest runs found. Configure and execute a backtest run above.
              </p>
            ) : (
              <div className="space-y-2">
                {runs.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => loadReport(run.id)}
                    className={`w-full bg-[#080c14] border rounded-xl p-4 text-left transition-all cursor-pointer flex items-center justify-between ${
                      selectedRunId === run.id ? 'border-blue-500/50' : 'border-[#1b2537] hover:border-blue-500/30'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <span className="font-bold text-white text-sm">{run.symbol}</span>
                      <span className="text-gray-400">{run.duration_days} Days</span>
                      <span className="text-gray-400">${run.initial_equity.toLocaleString()} Initial</span>
                      <span className="text-gray-400">{run.total_trades} Trades</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span
                        className={`font-bold ${
                          run.total_return_pct >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {run.total_return_pct >= 0 ? '+' : ''}{run.total_return_pct.toFixed(2)}%
                      </span>
                      <span className="text-blue-400 font-bold">
                        WR: {(run.win_rate * 100).toFixed(0)}%
                      </span>
                      <span className="text-gray-500">
                        {format(new Date(run.created_at_utc), 'MMM d, HH:mm')}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function BacktestForm({
  onRun,
  isPending,
}: {
  onRun: (params: Record<string, unknown>) => void;
  isPending: boolean;
}) {
  const [symbol, setSymbol] = useState('SOLUSDT');
  const [days, setDays] = useState(3);
  const [initialEquity, setInitialEquity] = useState(10000);
  const [riskPerTradePct, setRiskPerTradePct] = useState(2);
  const [leverage, setLeverage] = useState(5);

  return (
    <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5 space-y-4">
      <h3 className="font-bold text-white uppercase text-xs flex items-center gap-2">
        <FlaskConical className="w-4 h-4 text-blue-400" />
        Configure Simulation Parameters
      </h3>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div>
          <label className="text-[10px] text-gray-500 uppercase block mb-1">Symbol</label>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="w-full bg-[#080c14] border border-[#1b2537] rounded-lg px-3 py-2 text-white"
          >
            <option value="SOLUSDT">SOLUSDT</option>
            <option value="BTCUSDT">BTCUSDT</option>
            <option value="ETHUSDT">ETHUSDT</option>
            <option value="BNBUSDT">BNBUSDT</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-500 uppercase block mb-1">Historical Days</label>
          <input
            type="number"
            min={1}
            max={30}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="w-full bg-[#080c14] border border-[#1b2537] rounded-lg px-3 py-2 text-white"
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 uppercase block mb-1">Initial Equity ($)</label>
          <input
            type="number"
            min={100}
            value={initialEquity}
            onChange={(e) => setInitialEquity(Number(e.target.value))}
            className="w-full bg-[#080c14] border border-[#1b2537] rounded-lg px-3 py-2 text-white"
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 uppercase block mb-1">Risk per Trade (%)</label>
          <input
            type="number"
            min={0.5}
            max={10}
            step={0.5}
            value={riskPerTradePct}
            onChange={(e) => setRiskPerTradePct(Number(e.target.value))}
            className="w-full bg-[#080c14] border border-[#1b2537] rounded-lg px-3 py-2 text-white"
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 uppercase block mb-1">Leverage</label>
          <input
            type="number"
            min={1}
            max={20}
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            className="w-full bg-[#080c14] border border-[#1b2537] rounded-lg px-3 py-2 text-white"
          />
        </div>
      </div>

      <button
        onClick={() =>
          onRun({
            symbol,
            days,
            initialEquity,
            riskPerTradePct: riskPerTradePct / 100,
            defaultLeverage: leverage,
          })
        }
        disabled={isPending}
        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-bold px-5 py-2.5 rounded-xl transition-all cursor-pointer disabled:opacity-50"
      >
        <Play className="w-3.5 h-3.5" />
        {isPending ? 'Simulating Strategy...' : 'Execute Backtest'}
      </button>
    </div>
  );
}

function ReportDetail({
  report,
  onBack,
}: {
  report: BacktestFullReport;
  onBack: () => void;
}) {
  const m = report.report.coreMetrics;
  const trades = report.report.trades ?? [];

  const equityCurve = (() => {
    let equity = report.report.initialEquity;
    const points = [{ ts: report.report.startTime, equity }];
    for (const t of trades) {
      equity += t.netPnl;
      points.push({ ts: t.exitTimestamp ?? t.entryTimestamp, equity: Number(equity.toFixed(2)) });
    }
    return points.map((p) => ({
      date: new Date(p.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      equity: p.equity,
    }));
  })();

  const pnlByTrade = trades.map((t, i) => ({
    trade: i + 1,
    pnl: Number(t.netPnl.toFixed(2)),
  }));

  return (
    <div className="space-y-5">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-400 hover:text-white font-bold cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Backtest Studio
      </button>

      <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5 flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white uppercase">
            {report.report.symbol} Strategy Simulation Report
          </h2>
          <p className="text-gray-400 text-[11px] mt-1">
            Duration: {report.report.durationDays} Days ({trades.length} Trades)
          </p>
        </div>
        <span
          className={`px-3 py-1 rounded-lg font-bold text-xs ${
            report.report.totalReturnPct >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
          }`}
        >
          {report.report.totalReturnPct >= 0 ? '+' : ''}{report.report.totalReturnPct.toFixed(2)}% Net Return
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <ReportMetricCard label="Net PnL" value={`$${report.report.totalNetPnl.toFixed(2)}`} />
        <ReportMetricCard label="Win Rate" value={`${(m.winRate * 100).toFixed(1)}%`} />
        <ReportMetricCard label="Profit Factor" value={m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2)} />
        <ReportMetricCard label="Max Drawdown" value={`$${m.maxDrawdown.toFixed(2)}`} />
        <ReportMetricCard label="Average R" value={m.averageR.toFixed(2)} />
        <ReportMetricCard label="Total Trades" value={String(m.totalTrades)} />
      </div>

      {/* Equity Curve */}
      <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5">
        <h3 className="font-bold text-white uppercase text-xs mb-3">Equity Growth Curve</h3>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={equityCurve}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1b2537" />
              <XAxis dataKey="date" stroke="#6b7280" fontSize={10} />
              <YAxis stroke="#6b7280" fontSize={10} />
              <Tooltip contentStyle={{ backgroundColor: '#0f1623', border: '1px solid #1b2537', borderRadius: '8px', color: '#e5e7eb' }} />
              <Area type="monotone" dataKey="equity" stroke="#3b82f6" fill="rgba(59, 130, 246, 0.2)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* PnL Per Trade Distribution */}
      <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5">
        <h3 className="font-bold text-white uppercase text-xs mb-3">P&amp;L Per Trade Distribution</h3>
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pnlByTrade}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1b2537" />
              <XAxis dataKey="trade" stroke="#6b7280" fontSize={10} />
              <YAxis stroke="#6b7280" fontSize={10} />
              <Tooltip contentStyle={{ backgroundColor: '#0f1623', border: '1px solid #1b2537', borderRadius: '8px', color: '#e5e7eb' }} />
              <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                {pnlByTrade.map((entry, index) => (
                  <Cell key={index} fill={entry.pnl >= 0 ? '#05cd99' : '#ff4d4f'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Monte Carlo Card */}
      {report.report.monteCarlo && (
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5">
          <h3 className="font-bold text-white uppercase text-xs mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" /> Monte Carlo Simulation (1,000 Iterations)
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ReportMetricCard label="Mean PnL" value={`$${report.report.monteCarlo.meanNetPnl.toFixed(2)}`} />
            <ReportMetricCard label="Median PnL" value={`$${report.report.monteCarlo.medianNetPnl.toFixed(2)}`} />
            <ReportMetricCard label="Probability of Ruin" value={`${(report.report.monteCarlo.probabilityOfRuin * 100).toFixed(1)}%`} />
            <ReportMetricCard label="95th Pct Drawdown" value={`$${report.report.monteCarlo.maxDrawdownP95.toFixed(2)}`} />
          </div>
        </div>
      )}
    </div>
  );
}

function ReportMetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#080c14] border border-[#1b2537] rounded-xl p-3">
      <span className="text-[10px] text-gray-500 uppercase block">{label}</span>
      <span className="text-sm font-black text-white">{value}</span>
    </div>
  );
}
