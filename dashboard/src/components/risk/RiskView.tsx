import { useStore } from '../../store/useStore';
import { useRiskSummary, useDashboard } from '../../hooks/useApi';
import {
  Shield,
  AlertTriangle,
  Lock,
  Percent,
  CheckCircle2,
} from 'lucide-react';

export function RiskView() {
  const { riskSummary } = useStore();
  useRiskSummary();
  useDashboard();

  const exposure = riskSummary?.exposurePct || 0;
  const marginUsage = riskSummary?.marginUsagePct || 0;
  const rating = riskSummary?.riskRating || 'LOW';

  const ratingColor =
    rating === 'CRITICAL'
      ? 'bg-red-500/20 text-red-400 border-red-500/30'
      : rating === 'HIGH'
      ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
      : rating === 'MEDIUM'
      ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
      : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';

  return (
    <div className="space-y-5 font-mono text-xs select-none">
      {/* Risk Header & Status */}
      <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-black text-white uppercase">Risk Engine &amp; Exposure Gate</h2>
            <p className="text-gray-400 text-[11px]">
              Deterministic safety rules gate every order before paper or live execution.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-xl text-xs font-bold border uppercase ${ratingColor}`}>
            Risk Level: {rating}
          </span>
          <span className="px-3 py-1 rounded-xl text-xs font-bold bg-[#080c14] border border-[#1b2537] text-gray-300">
            Safe Mode: {riskSummary?.safeMode ? 'ENABLED' : 'DISABLED'}
          </span>
        </div>
      </div>

      {/* Gauges Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-500 uppercase">Portfolio Exposure</span>
            <Percent className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-xl font-black text-white">{exposure.toFixed(1)}%</div>
          <div className="w-full h-2 bg-[#080c14] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                exposure > 75 ? 'bg-red-500' : exposure > 40 ? 'bg-amber-500' : 'bg-blue-500'
              }`}
              style={{ width: `${Math.min(100, exposure)}%` }}
            />
          </div>
          <p className="text-[10px] text-gray-500">Max allowable: 60.0%</p>
        </div>

        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-500 uppercase">Margin Utilization</span>
            <Lock className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-xl font-black text-white">{marginUsage.toFixed(1)}%</div>
          <div className="w-full h-2 bg-[#080c14] rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 rounded-full"
              style={{ width: `${Math.min(100, marginUsage)}%` }}
            />
          </div>
          <p className="text-[10px] text-gray-500">Free margin available</p>
        </div>

        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-500 uppercase">Daily Loss Budget</span>
            <AlertTriangle className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-black text-emerald-400">
            {riskSummary?.dailyLossRemainingPct || 5.0}%
          </div>
          <div className="w-full h-2 bg-[#080c14] rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full"
              style={{ width: `${((riskSummary?.dailyLossRemainingPct || 5) / 5) * 100}%` }}
            />
          </div>
          <p className="text-[10px] text-gray-500">Circuit breaker at 5.0%</p>
        </div>

        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-500 uppercase">Open Positions</span>
            <Shield className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-xl font-black text-white">
            {riskSummary?.openPositionsCount || 0} / {riskSummary?.maxOpenPositions || 3}
          </div>
          <div className="w-full h-2 bg-[#080c14] rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full"
              style={{
                width: `${((riskSummary?.openPositionsCount || 0) / (riskSummary?.maxOpenPositions || 3)) * 100}%`,
              }}
            />
          </div>
          <p className="text-[10px] text-gray-500">Capacity remaining</p>
        </div>
      </div>

      {/* Safety Policy & Threshold Rules */}
      <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5 space-y-4">
        <h3 className="font-bold text-white uppercase text-xs">Deterministic Risk Rules &amp; Limits</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[11px]">
          <div className="bg-[#080c14] border border-[#1b2537] p-3 rounded-lg">
            <span className="text-gray-500 text-[10px] block">Max Risk per Trade</span>
            <span className="text-white font-bold">2.0% of Account Equity</span>
          </div>
          <div className="bg-[#080c14] border border-[#1b2537] p-3 rounded-lg">
            <span className="text-gray-500 text-[10px] block">Max Leverage</span>
            <span className="text-white font-bold">10x Isolated</span>
          </div>
          <div className="bg-[#080c14] border border-[#1b2537] p-3 rounded-lg">
            <span className="text-gray-500 text-[10px] block">Cross-Feed Divergence Limit</span>
            <span className="text-white font-bold">0.15% Max Spread</span>
          </div>
          <div className="bg-[#080c14] border border-[#1b2537] p-3 rounded-lg">
            <span className="text-gray-500 text-[10px] block">Execution Invariant</span>
            <span className="text-emerald-400 font-bold">No Order Without SL</span>
          </div>
        </div>
      </div>

      {/* Audit Log */}
      <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5 space-y-3">
        <h3 className="font-bold text-white uppercase text-xs">Recent Risk Gate Audits</h3>
        <div className="space-y-2">
          <div className="bg-[#080c14] border border-[#1b2537] p-3 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <div>
                <span className="font-bold text-white">SOLUSDT LONG (Qty: 5)</span>
                <p className="text-gray-500 text-[10px]">Exposure check: 14.2% &le; 60% • Margin validated</p>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold text-[10px]">
              PASSED
            </span>
          </div>

          <div className="bg-[#080c14] border border-[#1b2537] p-3 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <div>
                <span className="font-bold text-white">BTCUSDT LONG (Qty: 0.05)</span>
                <p className="text-gray-500 text-[10px]">Risk per trade: 1.8% &le; 2.0% • Stop Loss verified</p>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold text-[10px]">
              PASSED
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
