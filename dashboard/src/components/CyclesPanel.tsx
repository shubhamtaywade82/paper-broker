import { useStore } from '../store/useStore';
import { useCycles, useTriggerCycle } from '../hooks/useApi';
import { format } from 'date-fns';
import { Play, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useState } from 'react';

export function CyclesPanel({ onSelectCycle }: { onSelectCycle: (id: string) => void }) {
  const { cycles } = useStore();
  useCycles();
  const triggerCycle = useTriggerCycle();
  const [triggerSymbol, setTriggerSymbol] = useState('SOLUSDT');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white tracking-wide uppercase font-mono">Agent Decision Cycles</h2>
          <p className="text-xs text-gray-400 font-mono">Multi-Agent Debate & Dialectical Reasoning Traces</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={triggerSymbol}
            onChange={(e) => setTriggerSymbol(e.target.value)}
            className="bg-[#1a2332] border border-[#2d3a4f] rounded-lg px-3 py-2 text-xs font-mono text-white"
          >
            <option value="SOLUSDT">SOLUSDT</option>
            <option value="BTCUSDT">BTCUSDT</option>
            <option value="ETHUSDT">ETHUSDT</option>
            <option value="BNBUSDT">BNBUSDT</option>
          </select>
          <button
            onClick={() => triggerCycle.mutate(triggerSymbol)}
            disabled={triggerCycle.isPending}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-xs font-bold font-mono transition-colors disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            {triggerCycle.isPending ? 'Running Debate...' : 'Run Cycle'}
          </button>
        </div>
      </div>

      <div className="space-y-3 font-mono">
        {cycles.length === 0 ? (
          <div className="p-12 text-center text-gray-400 bg-[#1a2332] rounded-xl border border-[#2d3a4f] text-xs">
            No agent cycles recorded yet. Click "Run Cycle" to trigger the multi-agent pipeline.
          </div>
        ) : (
          cycles.map((cycle) => (
            <button
              key={cycle.cycleId}
              onClick={() => onSelectCycle(cycle.cycleId)}
              className="w-full bg-[#1a2332] border border-[#2d3a4f] rounded-xl p-5 text-left hover:border-blue-500/50 transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      cycle.executed
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-gray-500/10 text-gray-400'
                    }`}
                  >
                    {cycle.executed ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-sm">{cycle.symbol}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                          cycle.action === 'LONG'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : cycle.action === 'SHORT'
                            ? 'bg-red-500/10 text-red-400'
                            : 'bg-gray-500/10 text-gray-400'
                        }`}
                      >
                        {cycle.action}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[11px] bg-purple-500/10 text-purple-400 font-bold">
                        {cycle.verdict}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1 line-clamp-1">
                      {cycle.rationale}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400 flex items-center gap-1 justify-end">
                    <Clock className="w-3 h-3" />
                    {format(new Date(cycle.startedAt), 'MMM d, HH:mm:ss')}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Confidence: {(cycle.confidence * 100).toFixed(0)}%
                  </p>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
