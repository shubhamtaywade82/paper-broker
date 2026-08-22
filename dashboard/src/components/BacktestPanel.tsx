import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Play, ArrowLeft, Zap } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar, Cell,
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

function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-[#111827] rounded-lg p-3 border border-[#2d3a4f]">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-sm font-bold font-mono ${color ?? 'text-white'}`}>{value}</p>
    </div>
  );
}

function BacktestForm({ onRun, isPending }: { onRun: (params: Record<string, unknown>) => void; isPending: boolean }) {
  const [symbol, setSymbol] = useState('SOLUSDT');
  const [days, setDays] = useState(3);
  const [initialEquity, setInitialEquity] = useState(10000);
  const [riskPerTradePct, setRiskPerTradePct] = useState(2);
  const [leverage, setLeverage] = useState(5);

  return (
    <div className="bg-[#1a2332] rounded-xl border border-[#2d3a4f] p-6">
      <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4">Backtest Configuration</h3>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div>
          <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Symbol</label>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}
            className="w-full bg-[#111827] border border-[#2d3a4f] rounded-lg px-3 py-2 text-xs font-mono text-white">
            <option value="SOLUSDT">SOLUSDT</option>
            <option value="BTCUSDT">BTCUSDT</option>
            <option value="ETHUSDT">ETHUSDT</option>
            <option value="BNBUSDT">BNBUSDT</option>
            <option value="XRPUSDT">XRPUSDT</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Days</label>
          <input type="number" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))}
            className="w-full bg-[#111827] border border-[#2d3a4f] rounded-lg px-3 py-2 text-xs font-mono text-white" />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Initial Equity</label>
          <input type="number" min={100} value={initialEquity} onChange={(e) => setInitialEquity(Number(e.target.value))}
            className="w-full bg-[#111827] border border-[#2d3a4f] rounded-lg px-3 py-2 text-xs font-mono text-white" />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Risk %</label>
          <input type="number" min={0.5} max={10} step={0.5} value={riskPerTradePct} onChange={(e) => setRiskPerTradePct(Number(e.target.value))}
            className="w-full bg-[#111827] border border-[#2d3a4f] rounded-lg px-3 py-2 text-xs font-mono text-white" />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Leverage</label>
          <input type="number" min={1} max={20} value={leverage} onChange={(e) => setLeverage(Number(e.target.value))}
            className="w-full bg-[#111827] border border-[#2d3a4f] rounded-lg px-3 py-2 text-xs font-mono text-white" />
        </div>
      </div>
      <button onClick={() => onRun({ symbol, days, initialEquity, riskPerTradePct: riskPerTradePct / 100, defaultLeverage: leverage })}
        disabled={isPending}
        className="mt-4 flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-lg text-xs font-bold font-mono transition-colors disabled:opacity-50 cursor-pointer">
        <Play className="w-3.5 h-3.5" />
        {isPending ? 'Running Backtest...' : 'Run Backtest'}
      </button>
    </div>
  );
}

function ReportDetail({ report, onBack }: { report: BacktestFullReport; onBack: () => void }) {
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
    <div className="space-y-6 font-mono">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white cursor-pointer">
        <ArrowLeft className="w-3 h-3" /> Back to runs
      </button>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white uppercase tracking-wide">
            {report.report.symbol} Backtest Report
          </h2>
          <p className="text-xs text-gray-400">
            {format(new Date(report.report.startTime), 'MMM d')} - {format(new Date(report.report.endTime), 'MMM d, yyyy')}
            {' '}({report.report.durationDays}d)
          </p>
        </div>
        <div className={`px-3 py-1 rounded-lg text-xs font-bold ${report.report.totalReturnPct >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
          {report.report.totalReturnPct >= 0 ? '+' : ''}{report.report.totalReturnPct.toFixed(2)}%
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <MetricCard label="Net P&L" value={`$${report.report.totalNetPnl.toFixed(2)}`} color={report.report.totalNetPnl >= 0 ? 'text-emerald-400' : 'text-red-400'} />
        <MetricCard label="Win Rate" value={`${(m.winRate * 100).toFixed(1)}%`} />
        <MetricCard label="Profit Factor" value={m.profitFactor === Infinity ? '\u221E' : m.profitFactor.toFixed(2)} />
        <MetricCard label="Total Trades" value={String(m.totalTrades)} />
        <MetricCard label="Max Drawdown" value={`$${m.maxDrawdown.toFixed(2)}`} color="text-red-400" />
        <MetricCard label="Avg R" value={m.averageR.toFixed(2)} />
      </div>

      <div className="bg-[#1a2332] rounded-xl border border-[#2d3a4f] p-6">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-1">Equity Curve</h3>
        {equityCurve.length <= 1 ? (
          <p className="text-xs text-gray-500 py-8 text-center">No trades to chart</p>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityCurve}>
                <defs>
                  <linearGradient id="btEquityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d3a4f" />
                <XAxis dataKey="date" stroke="#6b7280" fontSize={10} />
                <YAxis stroke="#6b7280" fontSize={10} />
                <Tooltip contentStyle={{ backgroundColor: '#1a2332', border: '1px solid #2d3a4f', borderRadius: '8px', color: '#e5e7eb', fontSize: '11px' }} />
                <Area type="monotone" dataKey="equity" stroke="#3b82f6" fill="url(#btEquityGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="bg-[#1a2332] rounded-xl border border-[#2d3a4f] p-6">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-1">P&L per Trade</h3>
        {pnlByTrade.length === 0 ? (
          <p className="text-xs text-gray-500 py-6 text-center">No trades</p>
        ) : (
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pnlByTrade}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d3a4f" />
                <XAxis dataKey="trade" stroke="#6b7280" fontSize={10} />
                <YAxis stroke="#6b7280" fontSize={10} />
                <Tooltip contentStyle={{ backgroundColor: '#1a2332', border: '1px solid #2d3a4f', borderRadius: '8px', color: '#e5e7eb', fontSize: '11px' }} />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                  {pnlByTrade.map((entry, index) => (
                    <Cell key={index} fill={entry.pnl >= 0 ? '#10b981' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {report.report.monteCarlo && (
        <div className="bg-[#1a2332] rounded-xl border border-[#2d3a4f] p-6">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3">
            <Zap className="w-3.5 h-3.5 inline mr-1" />
            Monte Carlo Simulation
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard label="Iterations" value={String(report.report.monteCarlo.iterations)} />
            <MetricCard label="Mean P&L" value={`$${report.report.monteCarlo.meanNetPnl.toFixed(2)}`} />
            <MetricCard label="Median P&L" value={`$${report.report.monteCarlo.medianNetPnl.toFixed(2)}`} />
            <MetricCard label="P(Ruin)" value={`${(report.report.monteCarlo.probabilityOfRuin * 100).toFixed(1)}%`} color="text-red-400" />
          </div>
        </div>
      )}

      {trades.length > 0 && (
        <div className="bg-[#1a2332] rounded-xl border border-[#2d3a4f] p-6">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3">Trade Log</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 uppercase border-b border-[#2d3a4f]">
                  <th className="text-left py-2 px-2">#</th>
                  <th className="text-left py-2 px-2">Side</th>
                  <th className="text-left py-2 px-2">Setup</th>
                  <th className="text-right py-2 px-2">Entry</th>
                  <th className="text-right py-2 px-2">Exit</th>
                  <th className="text-right py-2 px-2">P&L</th>
                  <th className="text-right py-2 px-2">Duration</th>
                  <th className="text-left py-2 px-2">Exit Reason</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr key={t.tradeId} className="border-b border-[#2d3a4f]/50 hover:bg-[#111827]">
                    <td className="py-2 px-2 text-gray-400">{i + 1}</td>
                    <td className={`py-2 px-2 font-bold ${t.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>{t.direction}</td>
                    <td className="py-2 px-2 text-gray-400">{t.setupType}</td>
                    <td className="py-2 px-2 text-right text-white">${t.entryPrice.toFixed(2)}</td>
                    <td className="py-2 px-2 text-right text-white">{t.exitPrice ? `$${t.exitPrice.toFixed(2)}` : '\u2014'}</td>
                    <td className={`py-2 px-2 text-right font-bold ${t.netPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {t.netPnl >= 0 ? '+' : ''}${t.netPnl.toFixed(2)}
                    </td>
                    <td className="py-2 px-2 text-right text-gray-400">
                      {t.durationMs ? `${(t.durationMs / 60000).toFixed(0)}m` : '\u2014'}
                    </td>
                    <td className="py-2 px-2 text-gray-400">{t.exitReason ?? '\u2014'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function BacktestPanel() {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [viewReport, setViewReport] = useState<BacktestFullReport | null>(null);

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
      <div className="space-y-6">
        <ReportDetail report={viewReport} onBack={() => { setViewReport(null); setSelectedRunId(null); }} />
      </div>
    );
  }

  const runs = historyData?.runs ?? [];

  return (
    <div className="space-y-6 font-mono">
      <div>
        <h2 className="text-lg font-bold text-white tracking-wide uppercase font-mono">Backtesting</h2>
        <p className="text-xs text-gray-400 font-mono">Historical strategy replay with Monte Carlo validation</p>
      </div>

      <BacktestForm onRun={(params) => runMutation.mutate(params)} isPending={runMutation.isPending} />

      {runMutation.isError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-xs text-red-400">
          Backtest failed: {(runMutation.error as Error).message}
        </div>
      )}

      <div className="bg-[#1a2332] rounded-xl border border-[#2d3a4f] p-6">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4">Run History</h3>
        {historyLoading ? (
          <p className="text-xs text-gray-500 py-4 text-center">Loading...</p>
        ) : runs.length === 0 ? (
          <p className="text-xs text-gray-500 py-8 text-center">No backtest runs yet. Configure and run your first backtest above.</p>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <button
                key={run.id}
                onClick={() => loadReport(run.id)}
                className={`w-full bg-[#111827] border rounded-xl p-4 text-left hover:border-blue-500/50 transition-all cursor-pointer ${
                  selectedRunId === run.id ? 'border-blue-500/50' : 'border-[#2d3a4f]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="font-bold text-white text-sm">{run.symbol}</span>
                    <span className="text-xs text-gray-400">{run.duration_days}d</span>
                    <span className="text-xs text-gray-400">${run.initial_equity.toLocaleString()}</span>
                    <span className="text-xs text-gray-400">{run.total_trades} trades</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`text-xs font-bold ${run.total_return_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {run.total_return_pct >= 0 ? '+' : ''}{run.total_return_pct.toFixed(2)}%
                    </span>
                    <span className={`text-xs ${run.win_rate >= 0.5 ? 'text-emerald-400' : 'text-amber-400'}`}>
                      WR: {(run.win_rate * 100).toFixed(0)}%
                    </span>
                    <span className="text-xs text-gray-500">{format(new Date(run.created_at_utc), 'MMM d HH:mm')}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
