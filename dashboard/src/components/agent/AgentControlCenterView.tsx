import { useMemo, useState, type ReactNode } from 'react';
import { useStore, type LiveEventItem } from '../../store/useStore';
import { useCycles, useCycleDetail, useTriggerCycle, useAgentModels } from '../../hooks/useApi';
import { Play, CheckCircle2, XCircle, Shield, Layers, ArrowLeft, Radio } from 'lucide-react';
import { AdaptiveSupertrendInspector } from './AdaptiveSupertrendInspector';
import { AutonomousAgentPanel } from './AutonomousAgentPanel';
import { AgentStateBar } from './AgentStateBar';
import { AgentVitals } from './AgentVitals';
import { useAutonomousStore } from '../../stores/autonomousStore';
import { useQuery } from '@tanstack/react-query';

// Agent step ids as the operator reads them in the live transcript.
const STAGE_LABELS: Record<string, string> = {
  analyst_team: 'Derivatives Analyst',
  debate_bull: 'Bull Researcher',
  debate_bear: 'Bear Researcher',
  debate_verdict: 'Debate Judge',
  trader_decision: 'Trader',
  risk_team: 'Risk Committee',
  fund_manager: 'Fund Manager',
};

// Three tabs, down from six. Overview, Pipeline and Fleet each rendered the
// same five idle stages or static prose, so they collapse into "Now" — which
// carries live state — while Runs becomes "Decisions": what the agent chose,
// and whether it reached the broker.
const AGENT_TABS: Array<{
  id: 'now' | 'decisions' | 'supertrend';
  label: string;
  badge: (blockers: number, decisions: number) => number | null;
}> = [
  { id: 'now', label: 'Now', badge: (blockers) => (blockers > 0 ? blockers : null) },
  { id: 'decisions', label: 'Decisions', badge: (_b, decisions) => (decisions > 0 ? decisions : null) },
  { id: 'supertrend', label: 'Supertrend', badge: () => null },
];

// The five pipeline stages, each mapped to the agent step ids that make it
// active. This is the merge of the old Pipeline DAG (five nodes) and the Fleet
// grid (eight cards): the fleet members ARE the pipeline stages, so drawing
// them as two separate idle views told the operator nothing.
const PIPELINE_STAGES: Array<{ name: string; role: string; stages: string[] }> = [
  { name: 'Scan', role: 'Market coordinator', stages: [] },
  { name: 'Analysts', role: 'Structure · flow', stages: ['analyst_team'] },
  { name: 'Debate', role: 'Bull / bear · LLM', stages: ['debate_bull', 'debate_bear', 'debate_verdict'] },
  { name: 'Risk gate', role: 'Deterministic', stages: ['risk_team', 'fund_manager'] },
  { name: 'Broker', role: 'Execution', stages: [] },
];

function StageCell({ name, role, active, latency }: {
  name: string;
  role: string;
  active: boolean;
  latency: string;
}) {
  return (
    <div className="flex-1 min-w-[168px] px-4 py-3.5 border-r border-[#1b2537]/60 last:border-r-0">
      <div className={`h-[3px] rounded-sm mb-3 ${active ? 'bg-emerald-500' : 'bg-[#1b2537]'}`} />
      <div className="text-[13px] font-semibold text-white">{name}</div>
      <div className="text-[11px] text-gray-600 mt-0.5">{role}</div>
      <div className="font-mono text-[11.5px] mt-2">
        <span className={active ? 'text-emerald-400' : 'text-gray-600'}>{latency}</span>
        <span className="text-gray-600"> {active ? 'running' : 'idle'}</span>
      </div>
    </div>
  );
}

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
    account,
    positions,
  } = useStore();
  const { breaker, health, latestCycle } = useAutonomousStore();

  // The loss-streak dampener is a standing multiplier, not an event, so it
  // arrives on the agent snapshot rather than any WS broadcast.
  const { data: agentSnapshot } = useQuery<{ lossStreakDampener?: number }>({
    queryKey: ['autonomous-snapshot'],
    queryFn: async () => {
      const res = await fetch('/api/v1/autonomous/snapshot');
      if (!res.ok) throw new Error(`snapshot failed: ${res.status}`);
      return res.json();
    },
    refetchInterval: 15000,
  });

  useCycles();
  const triggerCycle = useTriggerCycle();
  const { data: modelsData } = useAgentModels();

  const [triggerModel, setTriggerModel] = useState<string>('');
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

  // What the "Now" badge counts: each independent thing refusing entries.
  const blockerCount = (breaker.tripped ? 1 : 0) + ((health?.issues?.length ?? 0) > 0 ? 1 : 0);


  return (
    <div className="space-y-5 text-xs select-none">
      {/* The page's answer line: is the agent trading, and if not, why? Above
          the tabs so it stays on screen whichever panel is open. */}
      <AgentStateBar
        breaker={breaker}
        health={health}
        cycle={latestCycle}
        openPositions={positions.filter((p) => p.quantity !== 0).length}
        lossStreakDampener={agentSnapshot?.lossStreakDampener ?? 1}
      />

      <AgentVitals
        account={account}
        cycle={latestCycle}
        breaker={breaker}
        health={health}
        avgLlmLatencyMs={avgLlmLatencyMs}
      />

      {/* Navigation & manual run trigger */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#0f1623] border border-[#1b2537] p-4 rounded-xl">
        <div className="flex flex-wrap items-center gap-2">
          {AGENT_TABS.map(({ id, label, badge }) => {
            const count = badge(blockerCount, cycles.length);
            return (
              <button
                key={id}
                onClick={() => {
                  setAgentTab(id);
                  setSelectedRunId(null);
                }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all cursor-pointer ${
                  agentTab === id
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30'
                    : 'bg-[#080c14] text-gray-400 hover:text-white border border-[#1b2537]'
                }`}
              >
                {label}
                {count !== null && (
                  <span
                    className={`font-mono text-[10px] px-1.5 py-0.5 rounded-full border ${
                      id === 'now' && blockerCount > 0
                        ? 'text-red-400 border-red-500/60 bg-red-500/10'
                        : 'text-gray-400 border-[#1b2537] bg-[#080c14]'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <select
            value={triggerModel || modelsData?.defaultModel || ''}
            onChange={(e) => setTriggerModel(e.target.value)}
            className="bg-[#080c14] border border-[#1b2537] rounded-lg px-3 py-2 text-white text-xs"
          >
            {(modelsData?.models ?? [{ name: modelsData?.defaultModel || 'qwen3.5:4b', isCloud: false }]).map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} {m.isCloud ? '(Cloud)' : '(Local)'}
              </option>
            ))}
          </select>

          <button
            onClick={() =>
              triggerCycle.mutate({
                symbol: selectedSymbol,
                model: triggerModel || modelsData?.defaultModel,
              })
            }
            disabled={triggerCycle.isPending}
            title="Runs the debate for inspection only — never submits a real paper order, even if approved. Only the autonomous loop (candle close + setup + risk gate) trades."
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-medium transition-all cursor-pointer disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            {triggerCycle.isPending ? 'Running…' : `Run cycle (${selectedSymbol})`}
          </button>
        </div>
      </div>

      {/* Now: live state. The stage rail carries each stage's own throughput,
          so an idle stage shows where the funnel actually dies. */}
      {agentTab === 'now' && (
        <div className="space-y-5">
          <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1b2537]/60">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-blue-400" />
                Decision pipeline
              </h3>
              <span className="font-mono text-[11px] text-gray-600">observed latency per stage</span>
            </div>
            <div className="flex overflow-x-auto">
              {PIPELINE_STAGES.map((stage) => (
                <StageCell
                  key={stage.name}
                  name={stage.name}
                  role={stage.role}
                  active={stage.stages.some((id) => stageStats.isActive(id))}
                  latency={stage.stages.length > 0 ? stageStats.avgLatencyLabel(stage.stages[0]!) : '—'}
                />
              ))}
            </div>
          </div>

          <LiveTranscript symbol={selectedSymbol} steps={symbolSteps} />

          <AutonomousAgentPanel />

          <details className="group">
            <summary className="cursor-pointer list-none text-xs text-gray-500 hover:text-white px-4 py-2.5 border border-dashed border-[#1b2537] hover:border-blue-500/60 rounded-xl transition">
              How the pipeline decides
            </summary>
            <div className="px-4 py-4 text-xs text-gray-400 leading-relaxed border border-t-0 border-[#1b2537] rounded-b-xl bg-[#0f1623] max-w-[78ch]">
              Deterministic tools extract market structure, orderbook depth and funding rates. A bull
              versus bear LLM debate stress-tests the thesis across rounds. A deterministic risk gate
              then sizes the position, sets invalidation and routes the order — the model never
              reaches the broker directly.
            </div>
          </details>
        </div>
      )}

      {/* Decisions: what the agent chose, and whether it reached the broker. */}
      {agentTab === 'decisions' && (
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

      {agentTab === 'supertrend' && <AdaptiveSupertrendInspector />}
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
        <div className="py-4 text-gray-500 text-[11px] space-y-1">
          <p>Nothing streaming. Steps appear here while a cycle runs.</p>
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
