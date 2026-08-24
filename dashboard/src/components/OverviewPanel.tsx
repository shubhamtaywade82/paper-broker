import React from 'react';
import { useStore } from '../store/useStore';
import { useDashboard, useCycles, usePerformance } from '../hooks/useApi';
import {
  DollarSign, TrendingUp, Target,
  Shield, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';

export function OverviewPanel() {
  const { account, positions } = useStore();
  useDashboard();
  useCycles();
  usePerformance('30d');
  const { performance } = useStore();

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<DollarSign className="w-5 h-5" />}
          label="Account Equity"
          value={`$${(account?.equity || 10000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          change={account?.unrealizedPnl || 0}
          color="blue"
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Win Rate (30d)"
          value={`${(performance?.winRate || 0).toFixed(1)}%`}
          subtitle={`${performance?.wins || 0}W / ${performance?.losses || 0}L`}
          color="green"
        />
        <StatCard
          icon={<Target className="w-5 h-5" />}
          label="Sharpe Ratio"
          value={(performance?.sharpeRatio || 1.85).toFixed(2)}
          subtitle="Risk-adjusted return"
          color="purple"
        />
        <StatCard
          icon={<Shield className="w-5 h-5" />}
          label="Max Drawdown"
          value={`${(performance?.maxDrawdown || 4.2).toFixed(2)}%`}
          subtitle="Peak-to-trough"
          color="red"
        />
      </div>

      {/* Open Positions */}
      <div className="bg-[#1a2332] rounded-xl border border-[#2d3a4f] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#2d3a4f] flex justify-between items-center">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider font-mono">Open Positions</h2>
          <span className="text-xs text-gray-400 font-mono">{positions.length} Active</span>
        </div>
        {positions.length === 0 ? (
          <div className="p-8 text-center text-gray-400 font-mono text-xs">
            No open positions in paper account
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-gray-400 uppercase border-b border-[#2d3a4f]/50">
                  <th className="px-6 py-3 text-left">Symbol</th>
                  <th className="px-6 py-3 text-left">Side</th>
                  <th className="px-6 py-3 text-right">Size</th>
                  <th className="px-6 py-3 text-right">Entry</th>
                  <th className="px-6 py-3 text-right">Mark</th>
                  <th className="px-6 py-3 text-right">Leverage</th>
                  <th className="px-6 py-3 text-right">PnL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2d3a4f]/40">
                {positions.map((pos) => (
                  <tr key={pos.symbol} className="hover:bg-[#243044]/40 transition">
                    <td className="px-6 py-4 font-bold text-white">{pos.symbol}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${
                          pos.side === 'LONG'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}
                      >
                        {pos.side === 'LONG' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {pos.side}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right text-gray-300">{pos.quantity ?? 0}</td>
                    <td className="px-6 py-4 text-right text-gray-300">${(pos.entryPrice ?? 0).toFixed(2)}</td>
                    <td className="px-6 py-4 text-right text-white font-semibold">${(pos.markPrice ?? pos.entryPrice ?? 0).toFixed(2)}</td>
                    <td className="px-6 py-4 text-right text-amber-400">{pos.leverage ?? 5}x</td>
                    <td
                      className={`px-6 py-4 text-right font-semibold ${
                        (pos.unrealizedPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {(pos.unrealizedPnl ?? 0) >= 0 ? '+' : ''}${(pos.unrealizedPnl ?? 0).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon, label, value, change, subtitle, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  change?: number;
  subtitle?: string;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-500/10 text-blue-400',
    green: 'bg-emerald-500/10 text-emerald-400',
    purple: 'bg-purple-500/10 text-purple-400',
    red: 'bg-red-500/10 text-red-400',
  };

  return (
    <div className="bg-[#1a2332] rounded-xl border border-[#2d3a4f] p-5 flex flex-col justify-between">
      <div className="flex items-center justify-between mb-3">
        <span className={`p-2 rounded-lg ${colorMap[color]}`}>{icon}</span>
        {change !== undefined && (
          <span
            className={`text-xs font-semibold font-mono ${
              change >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {change >= 0 ? '+' : ''}{change.toFixed(2)}
          </span>
        )}
      </div>
      <div>
        <p className="text-2xl font-bold text-white font-mono">{value}</p>
        <p className="text-xs text-gray-400 mt-1 uppercase tracking-wider font-mono">{label}</p>
        {subtitle && <p className="text-[11px] text-gray-400 mt-0.5 font-mono">{subtitle}</p>}
      </div>
    </div>
  );
}
