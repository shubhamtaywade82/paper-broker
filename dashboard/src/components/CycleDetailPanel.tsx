import { useCycleDetail } from '../hooks/useApi';
import { ArrowLeft, TrendingUp, TrendingDown, Shield } from 'lucide-react';

export function CycleDetailPanel({
  cycleId,
  onBack,
}: {
  cycleId: string;
  onBack: () => void;
}) {
  const { data: cycle, isLoading } = useCycleDetail(cycleId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 font-mono text-xs text-gray-400">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mr-3" />
        Loading cycle trace...
      </div>
    );
  }

  if (!cycle) return null;

  return (
    <div className="space-y-6 font-mono">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-xs font-bold text-gray-400 hover:text-white transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Cycles
      </button>

      {/* Header */}
      <div className="bg-[#1a2332] rounded-xl border border-[#2d3a4f] p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white uppercase tracking-wide">
              {cycle.symbol} — Cycle Detail
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              ID: {cycle.cycleId}
            </p>
          </div>
          <div className="text-right">
            <span
              className={`px-3 py-1 rounded-lg text-xs font-bold ${
                cycle.fundManagerApproval.approved
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-red-500/10 text-red-400 border border-red-500/20'
              }`}
            >
              {cycle.fundManagerApproval.approved ? 'APPROVED' : 'REJECTED'}
            </span>
          </div>
        </div>
      </div>

      {/* Analyst Reports */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cycle.analystReports.map((report, i) => (
          <div
            key={i}
            className="bg-[#1a2332] rounded-xl border border-[#2d3a4f] p-5"
          >
            <h3 className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2">
              {report.agent}
            </h3>
            <p className="text-xs text-gray-300 mb-3">
              {report.summary}
            </p>
            <div className="space-y-1 text-xs">
              {report.bullishSignals.map((s, j) => (
                <p key={j} className="text-emerald-400 flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5" /> {s}
                </p>
              ))}
              {report.bearishSignals.map((s, j) => (
                <p key={j} className="text-red-400 flex items-center gap-1.5">
                  <TrendingDown className="w-3.5 h-3.5" /> {s}
                </p>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-[#0a0e17] rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${report.confidence * 100}%` }}
                />
              </div>
              <span className="text-[11px] text-gray-400">
                {(report.confidence * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Debate History */}
      <div className="bg-[#1a2332] rounded-xl border border-[#2d3a4f] p-6">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4">Bull vs Bear Dialectical Debate</h3>
        <div className="space-y-3">
          {cycle.debate.map((entry, i) => (
            <div
              key={i}
              className={`p-4 rounded-lg border ${
                entry.role === 'BULL'
                  ? 'bg-emerald-950/20 border-emerald-500/20'
                  : 'bg-red-950/20 border-red-500/20'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                    entry.role === 'BULL'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {entry.role} RESEARCHER
                </span>
                <span className="text-[11px] text-gray-400">
                  Round {entry.round}
                </span>
              </div>
              <p className="text-xs text-gray-300 leading-relaxed">
                {entry.argument}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Risk Opinions & Fund Manager */}
      <div className="bg-[#1a2332] rounded-xl border border-[#2d3a4f] p-6">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-amber-400" />
          Risk Committee & Fund Manager Decision
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {cycle.riskOpinions.map((opinion, i) => (
            <div
              key={i}
              className="bg-[#0a0e17] rounded-lg p-4 border border-[#2d3a4f]"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold text-gray-400 uppercase">
                  {opinion.persona}
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                    opinion.verdict === 'APPROVE'
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : opinion.verdict === 'REJECT'
                      ? 'bg-red-500/10 text-red-400'
                      : 'bg-amber-500/10 text-amber-400'
                  }`}
                >
                  {opinion.verdict}
                </span>
              </div>
              <p className="text-xs text-gray-300">
                {opinion.rationale}
              </p>
            </div>
          ))}
        </div>

        {/* Fund Manager Decision */}
        <div className="mt-4 p-4 bg-[#0a0e17] rounded-lg border border-[#2d3a4f]">
          <h4 className="text-xs font-bold text-white uppercase mb-1">Fund Manager Final Approval</h4>
          <p className="text-xs text-gray-300">
            {cycle.fundManagerApproval.rationale}
          </p>
          {cycle.fundManagerApproval.approved && (
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-gray-400">
              <span>Action: <span className="text-white font-bold">{cycle.fundManagerApproval.finalDecision.action}</span></span>
              <span>Leverage: <span className="text-amber-400 font-bold">{cycle.fundManagerApproval.finalDecision.leverage}x</span></span>
              <span>Size: <span className="text-white font-bold">{(cycle.fundManagerApproval.finalDecision.sizePct * 100).toFixed(1)}%</span></span>
              {cycle.fundManagerApproval.finalDecision.stopLoss && (
                <span>SL: <span className="text-red-400 font-bold">${cycle.fundManagerApproval.finalDecision.stopLoss}</span></span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
