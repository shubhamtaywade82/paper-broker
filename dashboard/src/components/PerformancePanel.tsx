import { usePerformance, useEquityCurve } from '../hooks/useApi';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';
import { useState } from 'react';

export function PerformancePanel() {
  const [period, setPeriod] = useState('30d');
  usePerformance(period);

  const limitMap: Record<string, number> = { '7d': 168, '30d': 720, '90d': 2160 };
  const { data: snapshots = [] } = useEquityCurve(limitMap[period] ?? 720);

  // Downsample to ≤ 30 points for chart readability
  const step = Math.max(1, Math.floor(snapshots.length / 30));
  const equityCurve = snapshots
    .filter((_, i) => i % step === 0 || i === snapshots.length - 1)
    .map((s) => ({
      date: new Date(s.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      equity: Number(s.equity.toFixed(2)),
    }));

  const dailyPnl = snapshots
    .filter((_, i) => i % step === 0 || i === snapshots.length - 1)
    .map((s) => ({
      date: new Date(s.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      pnl: Number(s.totalRealizedPnl.toFixed(2)),
    }));

  return (
    <div className="space-y-6 font-mono">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white uppercase tracking-wide">Performance Analytics</h2>
          <p className="text-xs text-gray-400">Trading Returns from Paper Broker Snapshots</p>
        </div>
        <div className="flex gap-2">
          {['7d', '30d', '90d'].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                period === p
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#1a2332] text-gray-400 hover:text-white border border-[#2d3a4f]'
              }`}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Equity Curve */}
      <div className="bg-[#1a2332] rounded-xl border border-[#2d3a4f] p-6">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-1">Equity Growth Curve</h3>
        {equityCurve.length === 0 ? (
          <p className="text-xs text-gray-500 py-8 text-center">No snapshot data yet — start trading to see equity history</p>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityCurve}>
                <defs>
                  <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d3a4f" />
                <XAxis dataKey="date" stroke="#6b7280" fontSize={10} />
                <YAxis stroke="#6b7280" fontSize={10} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1a2332',
                    border: '1px solid #2d3a4f',
                    borderRadius: '8px',
                    color: '#e5e7eb',
                    fontSize: '11px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="equity"
                  stroke="#3b82f6"
                  fill="url(#equityGradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Daily PnL */}
      <div className="bg-[#1a2332] rounded-xl border border-[#2d3a4f] p-6">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-1">Realized P&amp;L Distribution</h3>
        {dailyPnl.length === 0 ? (
          <p className="text-xs text-gray-500 py-6 text-center">No realized PnL data yet</p>
        ) : (
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyPnl}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d3a4f" />
                <XAxis dataKey="date" stroke="#6b7280" fontSize={10} />
                <YAxis stroke="#6b7280" fontSize={10} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1a2332',
                    border: '1px solid #2d3a4f',
                    borderRadius: '8px',
                    color: '#e5e7eb',
                    fontSize: '11px',
                  }}
                />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                  {dailyPnl.map((entry, index) => (
                    <Cell
                      key={index}
                      fill={entry.pnl >= 0 ? '#10b981' : '#ef4444'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
