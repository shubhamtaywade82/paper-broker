import React from 'react';
import { useStore } from '../../store/useStore';
import {
  useDashboard,
  useCycles,
  useRiskSummary,
  useKlines,
  usePerformance,
  useTriggerCycle,
} from '../../hooks/useApi';
import { TradingChart, type ChartMarker } from '../charts/TradingChart';
import {
  DollarSign,
  TrendingUp,
  Shield,
  Bot,
  ArrowUpRight,
  ArrowDownRight,
  Zap,
  Play,
  CheckCircle2,
} from 'lucide-react';

export function DashboardView() {
  const {
    account,
    positions,
    cycles,
    riskSummary,
    selectedSymbol,
    timeframe,
    setTimeframe,
    liveEvents,
  } = useStore();

  useDashboard();
  useCycles(selectedSymbol);
  useRiskSummary();
  usePerformance('30d');

  const { data: klines = [] } = useKlines(selectedSymbol, timeframe, 80);
  const triggerCycle = useTriggerCycle();

  const latestCycle = cycles.length > 0 ? cycles[0] : null;

  // Convert cycles into chart markers for visual context
  const chartMarkers: ChartMarker[] = cycles
    .slice(0, 8)
    .filter((c) => c.startedAt && c.startedAt > 0)
    .map((c): ChartMarker => ({
      time: c.startedAt,
      position: c.action === 'LONG' ? 'belowBar' : 'aboveBar',
      color: c.action === 'LONG' ? '#05cd99' : c.action === 'SHORT' ? '#ff4d4f' : '#8492a6',
      shape: c.action === 'LONG' ? 'arrowUp' : c.action === 'SHORT' ? 'arrowDown' : 'circle',
      text: `${c.action} (${(c.confidence * 100).toFixed(0)}%)`,
    }))
    .sort((a, b) => a.time - b.time);

  return (
    <div className="space-y-5 font-mono text-xs select-none">
      {/* Top Operational Metrics Ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard
          label="Account Equity"
          value={`$${(account?.equity || 10000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          change={account?.unrealizedPnl || 0}
          icon={<DollarSign className="w-4 h-4 text-blue-400" />}
        />
        <MetricCard
          label="Unrealized PnL"
          value={`${(account?.unrealizedPnl || 0) >= 0 ? '+' : ''}$${(account?.unrealizedPnl || 0).toFixed(2)}`}
          icon={<TrendingUp className="w-4 h-4 text-emerald-400" />}
        />
        <MetricCard
          label="Risk Exposure"
          value={`${riskSummary?.exposurePct || 0}%`}
          subtitle={`Margin: ${riskSummary?.marginUsagePct || 0}%`}
          icon={<Shield className="w-4 h-4 text-amber-400" />}
        />
        <MetricCard
          label="Daily Loss Budget"
          value={`${riskSummary?.dailyLossRemainingPct || 5.0}%`}
          subtitle="Remaining today"
          icon={<Shield className="w-4 h-4 text-purple-400" />}
        />
        <MetricCard
          label="Active Agents"
          value="8 / 8 Active"
          subtitle="SMC + Debate Pipeline"
          icon={<Bot className="w-4 h-4 text-emerald-400" />}
        />
        <MetricCard
          label="Latest Conviction"
          value={`${((latestCycle?.confidence || 0.8) * 100).toFixed(0)}%`}
          subtitle={latestCycle?.action || 'NEUTRAL'}
          icon={<Zap className="w-4 h-4 text-blue-400" />}
        />
      </div>

      {/* Main Row: Market Context Chart & AI Brain Decision Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Market Context Chart (2 cols) */}
        <div className="lg:col-span-2 space-y-2">
          <TradingChart
            candles={klines}
            markers={chartMarkers}
            symbol={selectedSymbol}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
            height={360}
          />
        </div>

        {/* AI Brain & Decision Center (1 col) */}
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between border-b border-[#1b2537] pb-3 mb-3">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-blue-400" />
                <h3 className="font-bold text-white uppercase text-xs">AI Brain • Active Bias</h3>
              </div>
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                BULLISH TREND
              </span>
            </div>

            {latestCycle ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-[#080c14] p-3 rounded-lg border border-[#1b2537]">
                  <div>
                    <span className="text-[10px] text-gray-500 uppercase block">Action &amp; Target</span>
                    <span className="font-bold text-white text-sm flex items-center gap-1">
                      {latestCycle.action === 'LONG' ? (
                        <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <ArrowDownRight className="w-4 h-4 text-red-400" />
                      )}
                      {latestCycle.symbol} {latestCycle.action}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-gray-500 uppercase block">Confidence</span>
                    <span className="font-bold text-emerald-400 text-sm">
                      {(latestCycle.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider block mb-1">
                    Decision Evidence
                  </span>
                  <div className="bg-[#080c14] p-3 rounded-lg border border-[#1b2537] text-[11px] text-gray-300 leading-relaxed max-h-32 overflow-y-auto">
                    {latestCycle.rationale || 'Consensus reached on bullish structure breakout.'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-gray-500 text-xs">
                No active decision cycle yet. Click "Run Cycle" to trigger pipeline analysis.
              </div>
            )}
          </div>

          {/* Quick Trigger Button */}
          <button
            onClick={() => triggerCycle.mutate({ symbol: selectedSymbol })}
            disabled={triggerCycle.isPending}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-xl transition-all cursor-pointer disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            {triggerCycle.isPending ? 'Running Debate Pipeline...' : `Analyze ${selectedSymbol}`}
          </button>
        </div>
      </div>

      {/* Bottom Row: Open Positions & Live Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Open Positions Table (2 cols) */}
        <div className="lg:col-span-2 bg-[#0f1623] border border-[#1b2537] rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#1b2537] flex items-center justify-between">
            <h3 className="font-bold text-white uppercase text-xs">Live Positions</h3>
            <span className="text-[10px] text-gray-400">{positions.length} Active</span>
          </div>

          {positions.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-xs">
              No open positions in paper account
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-[#080c14] text-gray-400 uppercase text-[10px] border-b border-[#1b2537]">
                  <tr>
                    <th className="px-4 py-2.5">Symbol</th>
                    <th className="px-4 py-2.5">Side</th>
                    <th className="px-4 py-2.5 text-right">Size</th>
                    <th className="px-4 py-2.5 text-right">Entry</th>
                    <th className="px-4 py-2.5 text-right">Mark</th>
                    <th className="px-4 py-2.5 text-right">PnL ($)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1b2537]">
                  {positions.map((pos) => (
                    <tr key={pos.symbol} className="hover:bg-[#141d2e] transition">
                      <td className="px-4 py-3 font-bold text-white">{pos.symbol}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            pos.side === 'LONG'
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : 'bg-red-500/20 text-red-400'
                          }`}
                        >
                          {pos.side} {pos.leverage}x
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300">{pos.quantity}</td>
                      <td className="px-4 py-3 text-right text-gray-400">${pos.entryPrice.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-white font-semibold">${pos.markPrice.toFixed(2)}</td>
                      <td
                        className={`px-4 py-3 text-right font-bold ${
                          pos.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {pos.unrealizedPnl >= 0 ? '+' : ''}${pos.unrealizedPnl.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Live Activity Stream (1 col) */}
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between border-b border-[#1b2537] pb-2.5 mb-3">
            <h3 className="font-bold text-white uppercase text-xs">Live Stream</h3>
            <span className="text-[10px] text-gray-500">REALTIME</span>
          </div>

          <div className="space-y-2 overflow-y-auto max-h-56">
            {liveEvents.slice(0, 5).map((evt, idx) => (
              <div
                key={evt.id || idx}
                className="bg-[#080c14] border border-[#1b2537] p-2 rounded-lg flex items-center justify-between text-[11px]"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span className="text-gray-300 truncate max-w-[170px]">
                    {String(evt.payload['symbol'] || evt.type)}: {String(evt.payload['action'] || evt.type)}
                  </span>
                </div>
                <span className="text-[9px] text-gray-500 shrink-0">
                  {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  subtitle,
  change,
  icon,
}: {
  label: string;
  value: string;
  subtitle?: string;
  change?: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-3.5 flex flex-col justify-between space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
        {icon}
      </div>
      <div>
        <div className="text-base font-black text-white">{value}</div>
        {change !== undefined && (
          <span
            className={`text-[10px] font-bold ${
              change >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {change >= 0 ? '+' : ''}{change.toFixed(2)} PnL
          </span>
        )}
        {subtitle && <p className="text-[10px] text-gray-400">{subtitle}</p>}
      </div>
    </div>
  );
}
