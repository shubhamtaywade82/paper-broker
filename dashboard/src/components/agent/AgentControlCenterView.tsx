import { useMemo, useState, type ReactNode } from 'react';
import { useStore, type LiveEventItem } from '../../store/useStore';
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
  Radio,
} from 'lucide-react';

// Models confirmed present on the local Ollama instance (`GET /api/tags`) as of this
// dashboard build. The engine's autonomous loop always uses OLLAMA_MODEL from the
// backend's .env regardless of this selector — this list only affects manual runs.
const AVAILABLE_MODELS = ['qwen3.5:2b', 'qwen3:4b', 'llama3.2:3b', 'deepseek-r1:1.5b'];

const STAGE_LABELS: Record<string, string> = {
  analyst_team: 'Derivatives Analyst',
  debate_bull: 'Bull Researcher',
  debate_bear: 'Bear Researcher',
  debate_verdict: 'Debate Judge',
  trader_decision: 'Trader',
  risk_team: 'Risk Committee',
  fund_manager: 'Fund Manager',
};

// The LLM debate output uses markdown syntax (###, **bold**, " * bullet ",
// | pipe tables |) but often without real newlines between prose sections —
// it renders as one unreadable run-on line otherwise. No JSX injection risk:
// every token maps to a fixed element, nothing is ever parsed as HTML.
function renderInlineBold(body: string): ReactNode[] {
  return body.split(/(\*\*.+?\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="text-white">{part.slice(2, -2)}</strong>
    ) : (
      part
    )
  );
}

const isTableRow = (line: string) => /^\|.*\|$/.test(line.trim());
const isTableSeparatorRow = (line: string) => /^\|[\s:|-]+\|$/.test(line.trim());
const splitTableCells = (line: string) =>
  line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

function renderTableBlock(rows: string[], key: number): ReactNode {
  const header = splitTableCells(rows[0]!);
  const bodyRows = (isTableSeparatorRow(rows[1] ?? '') ? rows.slice(2) : rows.slice(1)).map(splitTableCells);

  return (
    <div key={key} className="overflow-x-auto">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="border-b border-[#1b2537]/60">
            {header.map((cell, i) => (
              <th key={i} className="text-left font-bold uppercase text-[10px] px-2 py-1 opacity-80">
                {renderInlineBold(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, r) => (
            <tr key={r} className="border-b border-[#1b2537]/30 align-top">
              {row.map((cell, c) => (
                <td key={c} className="px-2 py-1">{renderInlineBold(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Splits one prose line/blob into virtual lines around markdown structure
// (headers, horizontal rules, " * " bullets). " * " never appears inside a
// **bold** pair (no spaces between the stars), so it's safe to split on.
function splitProseLine(line: string): string[] {
  return line
    .replace(/\s*---\s*/g, '\n')
    .replace(/(#{2,4})\s*/g, '\n$1 ')
    .replace(/\s\*\s(?=\S)/g, '\n• ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function renderProseLine(line: string, key: string | number): ReactNode {
  const heading = line.match(/^#{2,4}\s+(.*)/);
  const body = heading ? heading[1]! : line;
  const parts = renderInlineBold(body);

  if (heading) {
    return (
      <p key={key} className="font-bold uppercase text-[10px] tracking-wide mt-2 first:mt-0 opacity-80">
        {parts}
      </p>
    );
  }
  return (
    <p key={key} className={line.startsWith('•') ? 'pl-3' : undefined}>
      {parts}
    </p>
  );
}

function renderLiteMarkdown(text: string): ReactNode {
  const rawLines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const blocks: ReactNode[] = [];
  let i = 0;
  let blockKey = 0;

  while (i < rawLines.length) {
    if (isTableRow(rawLines[i]!)) {
      const tableRows: string[] = [];
      while (i < rawLines.length && isTableRow(rawLines[i]!)) {
        tableRows.push(rawLines[i]!);
        i++;
      }
      blocks.push(renderTableBlock(tableRows, blockKey++));
    } else {
      for (const line of splitProseLine(rawLines[i]!)) {
        blocks.push(renderProseLine(line, blockKey++));
      }
      i++;
    }
  }

  return blocks;
}

interface AgentStepPayload {
  cycleId: string;
  symbol: string;
  stage: string;
  status: 'started' | 'completed' | 'failed';
  detail?: string;
  timestamp: number;
}

function asStep(e: LiveEventItem): AgentStepPayload | null {
  if (e.type !== 'agent_step') return null;
  const p = e.payload;
  if (!p.cycleId || !p.symbol || !p.stage || !p.status) return null;
  return p as unknown as AgentStepPayload;
}

export function AgentControlCenterView() {
  const {
    cycles,
    agentTab,
    setAgentTab,
    selectedSymbol,
    liveEvents,
  } = useStore();

  useCycles();
  const triggerCycle = useTriggerCycle();

  const [triggerModel, setTriggerModel] = useState(AVAILABLE_MODELS[0]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { data: detailData } = useCycleDetail(selectedRunId);

  const steps = useMemo(
    () => liveEvents.map(asStep).filter((s): s is AgentStepPayload => s !== null),
    [liveEvents]
  );
  const symbolSteps = useMemo(
    () => steps.filter((s) => s.symbol === selectedSymbol),
    [steps, selectedSymbol]
  );

  // "Running" = the most recent step we've seen for that cycleId hasn't reached a
  // terminal (completed/failed) status yet. liveEvents is newest-first already.
  const activeRunCount = useMemo(() => {
    const latestByCycle = new Map<string, AgentStepPayload>();
    for (const s of steps) {
      if (!latestByCycle.has(s.cycleId)) latestByCycle.set(s.cycleId, s);
    }
    return [...latestByCycle.values()].filter((s) => s.status === 'started').length;
  }, [steps]);

  const avgConfidencePct = useMemo(() => {
    if (cycles.length === 0) return null;
    return (cycles.reduce((sum, c) => sum + c.confidence, 0) / cycles.length) * 100;
  }, [cycles]);

  const avgLlmLatencyMs = useMemo(() => {
    const startedAt = new Map<string, number>();
    const durations: number[] = [];
    // steps is newest-first; walk oldest-first to pair started -> completed/failed
    for (const s of [...steps].reverse()) {
      const key = `${s.cycleId}:${s.stage}`;
      if (s.status === 'started') {
        startedAt.set(key, s.timestamp);
      } else {
        const start = startedAt.get(key);
        if (start !== undefined) {
          durations.push(s.timestamp - start);
          startedAt.delete(key);
        }
      }
    }
    if (durations.length === 0) return null;
    return durations.reduce((a, b) => a + b, 0) / durations.length;
  }, [steps]);

  // Fleet tab (system-wide, not scoped to selectedSymbol): which pipeline stages
  // currently have an in-flight step, and each stage's average observed duration.
  const stageStats = useMemo(() => {
    const latestByCycleStage = new Map<string, AgentStepPayload>();
    for (const s of steps) {
      const key = `${s.cycleId}:${s.stage}`;
      if (!latestByCycleStage.has(key)) latestByCycleStage.set(key, s);
    }
    const activeStages = new Set<string>();
    for (const s of latestByCycleStage.values()) {
      if (s.status === 'started') activeStages.add(s.stage);
    }

    const startedAt = new Map<string, number>();
    const durationsByStage = new Map<string, number[]>();
    for (const s of [...steps].reverse()) {
      const key = `${s.cycleId}:${s.stage}`;
      if (s.status === 'started') {
        startedAt.set(key, s.timestamp);
      } else {
        const start = startedAt.get(key);
        if (start !== undefined) {
          const arr = durationsByStage.get(s.stage) ?? [];
          arr.push(s.timestamp - start);
          durationsByStage.set(s.stage, arr);
          startedAt.delete(key);
        }
      }
    }

    return {
      isActive: (stage: string) => activeStages.has(stage),
      avgLatencyLabel: (stage: string) => {
        const arr = durationsByStage.get(stage);
        if (!arr || arr.length === 0) return '—';
        return `${Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)}ms`;
      },
    };
  }, [steps]);

  const executedCount = cycles.filter((c) => c.executed).length;
  const noTradeCount = cycles.length - executedCount;

  return (
    <div className="space-y-5 font-mono text-xs select-none">
      {/* Top Intelligence KPI Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-3.5">
          <span className="text-[10px] text-gray-500 uppercase block">Active Runs</span>
          <span className="text-base font-black text-white">
            {activeRunCount} {activeRunCount > 0 ? 'Running' : 'Idle'}
          </span>
        </div>
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-3.5">
          <span className="text-[10px] text-gray-500 uppercase block">Decisions Today</span>
          <span className="text-base font-black text-white">{cycles.length}</span>
        </div>
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-3.5" title="Fund Manager approval on debate outcome — not a real paper order. Only the autonomous loop (candle close + setup + risk gate) submits real trades.">
          <span className="text-[10px] text-gray-500 uppercase block">Approved / Skipped</span>
          <span className="text-base font-black text-emerald-400">
            {executedCount} <span className="text-gray-500 font-normal">/ {noTradeCount}</span>
          </span>
        </div>
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-3.5">
          <span className="text-[10px] text-gray-500 uppercase block">Avg Confidence</span>
          <span className="text-base font-black text-blue-400">
            {avgConfidencePct === null ? '—' : `${avgConfidencePct.toFixed(1)}%`}
          </span>
        </div>
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-3.5">
          <span className="text-[10px] text-gray-500 uppercase block">Avg LLM Latency</span>
          <span className="text-base font-black text-purple-400">
            {avgLlmLatencyMs === null ? '—' : `${Math.round(avgLlmLatencyMs)} ms`}
          </span>
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
            {AVAILABLE_MODELS.map((m) => (
              <option key={m} value={m}>{m} (Local)</option>
            ))}
          </select>

          <button
            onClick={() => triggerCycle.mutate({ symbol: selectedSymbol, model: triggerModel })}
            disabled={triggerCycle.isPending}
            title="Runs the debate for inspection only — never submits a real paper order, even if approved. Only the autonomous loop (candle close + setup + risk gate) trades."
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-bold transition-all cursor-pointer disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            {triggerCycle.isPending ? 'Debating Pipeline...' : `Run Cycle (${selectedSymbol})`}
          </button>
        </div>
      </div>

      {/* Sub-View 1: Overview */}
      {agentTab === 'overview' && (
        <div className="space-y-5">
          <LiveTranscript symbol={selectedSymbol} steps={symbolSteps} />

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
            <DagNode title="Supervisor" subtitle="Market Coordinator" status={activeRunCount > 0 ? 'RUNNING' : 'IDLE'} />
            <ArrowRight className="w-4 h-4 text-gray-600 shrink-0" />
            <DagNode title="Analysts" subtitle="Structure / Flow" status={stageStats.isActive('analyst_team') ? 'ACTIVE' : 'IDLE'} />
            <ArrowRight className="w-4 h-4 text-gray-600 shrink-0" />
            <DagNode
              title="Debate Engine"
              subtitle="Bull vs Bear LLM"
              status={
                stageStats.isActive('debate_bull') || stageStats.isActive('debate_bear') || stageStats.isActive('debate_verdict')
                  ? 'ACTIVE'
                  : 'IDLE'
              }
            />
            <ArrowRight className="w-4 h-4 text-gray-600 shrink-0" />
            <DagNode title="Risk Gate" subtitle="Deterministic Check" status={stageStats.isActive('risk_team') ? 'ACTIVE' : 'IDLE'} />
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
              <span
                className={`px-3 py-1 rounded-lg text-xs font-bold ${
                  detailData.fundManagerApproval?.approved ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                }`}
                title="Debate outcome only — manually triggered cycles never submit a real paper order."
              >
                {detailData.fundManagerApproval?.approved ? 'APPROVED (NOT A REAL ORDER)' : 'REJECTED BY RISK'}
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
                    <div className="text-xs text-gray-300 leading-relaxed space-y-1.5">
                      {renderLiteMarkdown(entry.argument)}
                    </div>
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
          <FleetCard
            name="Derivatives Analyst"
            type="LLM (Ollama)"
            status={stageStats.isActive('analyst_team') ? 'ACTIVE' : 'IDLE'}
            latency={stageStats.avgLatencyLabel('analyst_team')}
          />
          <FleetCard
            name="Bull Researcher"
            type="LLM (Ollama)"
            status={stageStats.isActive('debate_bull') ? 'ACTIVE' : 'IDLE'}
            latency={stageStats.avgLatencyLabel('debate_bull')}
          />
          <FleetCard
            name="Bear Researcher"
            type="LLM (Ollama)"
            status={stageStats.isActive('debate_bear') ? 'ACTIVE' : 'IDLE'}
            latency={stageStats.avgLatencyLabel('debate_bear')}
          />
          <FleetCard
            name="Debate Judge"
            type="LLM (Ollama)"
            status={stageStats.isActive('debate_verdict') ? 'ACTIVE' : 'IDLE'}
            latency={stageStats.avgLatencyLabel('debate_verdict')}
          />
          <FleetCard
            name="Trader"
            type="LLM (Ollama)"
            status={stageStats.isActive('trader_decision') ? 'ACTIVE' : 'IDLE'}
            latency={stageStats.avgLatencyLabel('trader_decision')}
          />
          <FleetCard
            name="Risk Committee"
            type="Deterministic"
            status={stageStats.isActive('risk_team') ? 'ACTIVE' : 'IDLE'}
            latency={stageStats.avgLatencyLabel('risk_team')}
          />
          <FleetCard
            name="Fund Manager"
            type="Deterministic"
            status={stageStats.isActive('fund_manager') ? 'ACTIVE' : 'IDLE'}
            latency={stageStats.avgLatencyLabel('fund_manager')}
          />
          <FleetCard name="Execution Router" type="Deterministic" status="STANDBY" latency="—" />
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

function LiveTranscript({ symbol, steps }: { symbol: string; steps: AgentStepPayload[] }) {
  const isLive = steps.length > 0 && steps[0]?.status === 'started';

  return (
    <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between border-b border-[#1b2537] pb-2">
        <div className="flex items-center gap-2">
          <Radio className={`w-4 h-4 ${isLive ? 'text-emerald-400 animate-pulse' : 'text-gray-600'}`} />
          <h3 className="font-bold text-white uppercase text-xs">
            Live Agent Debate Stream • {symbol}
          </h3>
        </div>
        <span className="text-[10px] text-gray-500">{steps.length} Steps</span>
      </div>

      {steps.length === 0 ? (
        <div className="py-8 text-center text-gray-500 text-[11px] space-y-1">
          <p>No live steps captured yet for {symbol} in this browser tab.</p>
          <p className="text-gray-600">
            This feed only shows steps broadcast while this tab is open and connected — it
            does not replay history. Click &quot;Run Cycle ({symbol})&quot; above, or wait for
            the autonomous loop to evaluate a setup on this symbol.
          </p>
        </div>
      ) : (
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {steps.slice(0, 6).map((step, idx) => (
          <div
            key={idx}
            className="p-2.5 rounded-lg bg-[#080c14] border border-[#1b2537] flex items-start justify-between text-xs"
          >
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="font-bold text-blue-400 text-[11px]">
                  {STAGE_LABELS[step.stage] || step.stage}
                </span>
                <span
                  className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase ${
                    step.status === 'completed'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : step.status === 'failed'
                      ? 'bg-red-500/20 text-red-400'
                      : 'bg-amber-500/20 text-amber-400 animate-pulse'
                  }`}
                >
                  {step.status}
                </span>
              </div>
              {step.detail && (
                <p className="text-gray-300 text-[11px] leading-relaxed line-clamp-2">
                  {step.detail}
                </p>
              )}
            </div>
            <span className="text-gray-500 text-[9px] shrink-0 ml-3">
              {new Date(step.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
          </div>
        ))}
      </div>
      )}
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
