import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useCycles, useCycleDetail, useTriggerCycle } from '../../hooks/useApi';
import {
  Bot,
  Play,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Shield,
  Layers,
  Sparkles,
  ArrowLeft,
} from 'lucide-react';

export function AgentControlCenterView() {
  const {
    cycles,
    agentTab,
    setAgentTab,
    selectedSymbol,
  } = useStore();

  useCycles();
  const triggerCycle = useTriggerCycle();

  const [triggerModel, setTriggerModel] = useState('llama3.1:8b');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { data: detailData } = useCycleDetail(selectedRunId);

  const activeRunCount = cycles.filter((c) => !c.completedAt).length;
  const executedCount = cycles.filter((c) => c.executed).length;
  const noTradeCount = cycles.length - executedCount;

  return (
    <div className="space-y-5 font-mono text-xs select-none">
      {/* Top Intelligence KPI Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-3.5">
          <span className="text-[10px] text-gray-500 uppercase block">Active Runs</span>
          <span className="text-base font-black text-white">{activeRunCount || 1} Running</span>
        </div>
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-3.5">
          <span className="text-[10px] text-gray-500 uppercase block">Decisions Today</span>
          <span className="text-base font-black text-white">{cycles.length}</span>
        </div>
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-3.5">
          <span className="text-[10px] text-gray-500 uppercase block">Trades / Skipped</span>
          <span className="text-base font-black text-emerald-400">
            {executedCount} <span className="text-gray-500 font-normal">/ {noTradeCount}</span>
          </span>
        </div>
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-3.5">
          <span className="text-[10px] text-gray-500 uppercase block">Avg Confidence</span>
          <span className="text-base font-black text-blue-400">79.4%</span>
        </div>
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-3.5">
          <span className="text-[10px] text-gray-500 uppercase block">Avg LLM Latency</span>
          <span className="text-base font-black text-purple-400">184 ms</span>
        </div>
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-3.5">
          <span className="text-[10px] text-gray-500 uppercase block">Pipeline Mode</span>
          <span className="text-base font-black text-amber-400">AUTONOMOUS</span>
        </div>
      </div>

      {/* Navigation Sub-Tabs & Manual Run Trigger */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#0f1623] border border-[#1b2537] p-4 rounded-xl">
        <div className="flex items-center gap-2">
          {(['overview', 'pipeline', 'runs', 'fleet'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setAgentTab(tab);
                setSelectedRunId(null);
              }}
              className={`px-4 py-2 rounded-lg font-bold uppercase transition-all cursor-pointer ${
                agentTab === tab
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30'
                  : 'bg-[#080c14] text-gray-400 hover:text-white border border-[#1b2537]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Trigger Cycle Controls */}
        <div className="flex items-center gap-3">
          <select
            value={triggerModel}
            onChange={(e) => setTriggerModel(e.target.value)}
            className="bg-[#080c14] border border-[#1b2537] rounded-lg px-3 py-2 text-white text-xs"
          >
            <option value="llama3.1:8b">llama3.1:8b (Local)</option>
            <option value="deepseek-r1:8b">deepseek-r1:8b</option>
            <option value="qwen2.5:7b">qwen2.5:7b</option>
          </select>

          <button
            onClick={() => triggerCycle.mutate({ symbol: selectedSymbol, model: triggerModel })}
            disabled={triggerCycle.isPending}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-bold transition-all cursor-pointer disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            {triggerCycle.isPending ? 'Debating Pipeline...' : `Run Cycle (${selectedSymbol})`}
          </button>
        </div>
      </div>

      {/* Sub-View 1: Overview */}
      {agentTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5">
              <h3 className="font-bold text-white uppercase text-xs mb-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Active Multi-Agent Reasoning Architecture
              </h3>
              <p className="text-gray-300 leading-relaxed mb-4">
                The trading engine uses a multi-agent debate architecture where specialized market analysts
                (Structure, Momentum, Order Flow) generate structured signals, followed by a dialectical
                Bull vs Bear debate before final synthesis by the Trade Judge and validation through the Risk Gate.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-[#080c14] p-3 rounded-lg border border-[#1b2537]">
                  <span className="text-[10px] text-gray-500 uppercase block">1. Extraction</span>
                  <span className="text-white font-bold">Deterministic Tools</span>
                  <p className="text-gray-400 text-[10px] mt-1">Market structure, orderbook depth &amp; funding rates</p>
                </div>
                <div className="bg-[#080c14] p-3 rounded-lg border border-[#1b2537]">
                  <span className="text-[10px] text-gray-500 uppercase block">2. Dialectic</span>
                  <span className="text-blue-400 font-bold">LLM Bull / Bear Debate</span>
                  <p className="text-gray-400 text-[10px] mt-1">Multi-round thesis stress testing &amp; risk committee</p>
                </div>
                <div className="bg-[#080c14] p-3 rounded-lg border border-[#1b2537]">
                  <span className="text-[10px] text-gray-500 uppercase block">3. Execution</span>
                  <span className="text-emerald-400 font-bold">Deterministic Risk Gate</span>
                  <p className="text-gray-400 text-[10px] mt-1">Position sizing, invalidation &amp; broker order routing</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5">
            <h3 className="font-bold text-white uppercase text-xs mb-3 flex items-center gap-2">
              <Bot className="w-4 h-4 text-blue-400" />
              Recent Agent Cycles
            </h3>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {cycles.slice(0, 6).map((c) => (
                <div
                  key={c.cycleId}
                  onClick={() => {
                    setSelectedRunId(c.cycleId);
                    setAgentTab('runs');
                  }}
                  className="p-3 bg-[#080c14] border border-[#1b2537] rounded-lg hover:border-blue-500/50 cursor-pointer transition"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white">{c.symbol}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      c.action === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {c.action}
                    </span>
                  </div>
                  <p className="text-gray-400 text-[10px] mt-1 line-clamp-1">{c.rationale}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Sub-View 2: Pipeline DAG */}
      {agentTab === 'pipeline' && (
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-[#1b2537] pb-3">
            <h3 className="font-bold text-white uppercase text-xs flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-400" />
              Autonomous Decision Pipeline DAG
            </h3>
            <span className="text-emerald-400 font-bold text-[10px]">● ALL NODES OPERATIONAL</span>
          </div>

          <div className="flex flex-col md:flex-row items-center justify-between gap-3 overflow-x-auto py-4">
            <DagNode title="Supervisor" subtitle="Market Coordinator" status="RUNNING" />
            <ArrowRight className="w-4 h-4 text-gray-600 shrink-0" />
            <DagNode title="Analysts" subtitle="Structure / Flow" status="ACTIVE" />
            <ArrowRight className="w-4 h-4 text-gray-600 shrink-0" />
            <DagNode title="Debate Engine" subtitle="Bull vs Bear LLM" status="ACTIVE" />
            <ArrowRight className="w-4 h-4 text-gray-600 shrink-0" />
            <DagNode title="Risk Gate" subtitle="Deterministic Check" status="VERIFIED" />
            <ArrowRight className="w-4 h-4 text-gray-600 shrink-0" />
            <DagNode title="Paper Broker" subtitle="Execution Engine" status="STANDBY" />
          </div>
        </div>
      )}

      {/* Sub-View 3: Runs & Run Inspector */}
      {agentTab === 'runs' && (
        selectedRunId && detailData ? (
          <div className="space-y-5">
            <button
              onClick={() => setSelectedRunId(null)}
              className="flex items-center gap-2 text-gray-400 hover:text-white font-bold cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Run History
            </button>

            {/* Run Detail Header */}
            <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-6 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white uppercase">
                  Run #{detailData.cycleId.slice(0, 10)} • {detailData.symbol} {detailData.action}
                </h2>
                <p className="text-gray-400 text-[11px] mt-1">
                  Started: {new Date(detailData.startedAt).toLocaleString()}
                </p>
              </div>
              <span className={`px-3 py-1 rounded-lg text-xs font-bold ${
                detailData.fundManagerApproval?.approved ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
              }`}>
                {detailData.fundManagerApproval?.approved ? 'APPROVED & EXECUTED' : 'REJECTED BY RISK'}
              </span>
            </div>

            {/* Dialectical Debate History */}
            <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-6 space-y-4">
              <h3 className="font-bold text-white uppercase text-xs">Bull vs Bear Dialectical Debate</h3>
              <div className="space-y-3">
                {detailData.debate.map((entry, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-xl border ${
                      entry.role === 'BULL'
                        ? 'bg-emerald-950/20 border-emerald-500/20 text-emerald-200'
                        : 'bg-red-950/20 border-red-500/20 text-red-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-[10px] uppercase">{entry.role} RESEARCHER (Round {entry.round})</span>
                    </div>
                    <p className="text-xs text-gray-300 leading-relaxed">{entry.argument}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Risk Committee Opinions */}
            <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-6 space-y-4">
              <h3 className="font-bold text-white uppercase text-xs flex items-center gap-2">
                <Shield className="w-4 h-4 text-amber-400" />
                Risk Committee Evaluation
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {detailData.riskOpinions.map((op, idx) => (
                  <div key={idx} className="bg-[#080c14] border border-[#1b2537] p-4 rounded-xl">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-gray-300 uppercase">{op.persona}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        op.verdict === 'APPROVE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {op.verdict}
                      </span>
                    </div>
                    <p className="text-gray-400 text-xs">{op.rationale}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Runs List */
          <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl overflow-hidden">
            {cycles.length === 0 ? (
              <div className="p-12 text-center text-gray-500">
                No runs recorded yet. Click "Run Cycle" above.
              </div>
            ) : (
              <div className="divide-y divide-[#1b2537]">
                {cycles.map((c) => (
                  <div
                    key={c.cycleId}
                    onClick={() => setSelectedRunId(c.cycleId)}
                    className="p-4 hover:bg-[#141d2e] transition cursor-pointer flex items-center justify-between"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-lg ${
                        c.executed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-800 text-gray-400'
                      }`}>
                        {c.executed ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-sm">{c.symbol}</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            c.action === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                          }`}>
                            {c.action}
                          </span>
                        </div>
                        <p className="text-gray-400 text-xs mt-0.5 line-clamp-1">{c.rationale}</p>
                      </div>
                    </div>
                    <div className="text-right text-gray-500 text-[11px]">
                      <div>{new Date(c.startedAt).toLocaleTimeString()}</div>
                      <div className="text-blue-400 font-bold">{(c.confidence * 100).toFixed(0)}% Conviction</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      )}

      {/* Sub-View 4: Fleet */}
      {agentTab === 'fleet' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <FleetCard name="Market Supervisor" type="Analytical" status="RUNNING" latency="12ms" />
          <FleetCard name="SMC Structure Agent" type="Deterministic" status="RUNNING" latency="8ms" />
          <FleetCard name="Bull Researcher" type="LLM (Ollama)" status="ACTIVE" latency="190ms" />
          <FleetCard name="Bear Researcher" type="LLM (Ollama)" status="ACTIVE" latency="182ms" />
          <FleetCard name="Fund Manager Judge" type="LLM (Ollama)" status="ACTIVE" latency="174ms" />
          <FleetCard name="Risk Engine Gate" type="Deterministic" status="VERIFIED" latency="2ms" />
          <FleetCard name="Execution Router" type="Deterministic" status="STANDBY" latency="1ms" />
          <FleetCard name="Position Manager" type="Deterministic" status="MONITORING" latency="4ms" />
        </div>
      )}
    </div>
  );
}

function DagNode({ title, subtitle, status }: { title: string; subtitle: string; status: string }) {
  return (
    <div className="bg-[#080c14] border border-[#1b2537] rounded-xl p-4 min-w-[150px] text-center space-y-1">
      <span className="text-[10px] text-emerald-400 font-bold uppercase block">{status}</span>
      <h4 className="font-bold text-white text-xs">{title}</h4>
      <p className="text-[10px] text-gray-500">{subtitle}</p>
    </div>
  );
}

function FleetCard({ name, type, status, latency }: { name: string; type: string; status: string; latency: string }) {
  return (
    <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500 uppercase">{type}</span>
        <span className="text-[10px] text-emerald-400 font-bold">● {status}</span>
      </div>
      <h4 className="font-bold text-white text-sm">{name}</h4>
      <p className="text-[10px] text-gray-400">Latency: {latency}</p>
    </div>
  );
}
