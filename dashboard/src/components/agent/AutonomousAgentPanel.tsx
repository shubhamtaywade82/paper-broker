import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle2,
  Clock,
  Gauge,
  Heart,
  Radio,
  Shield,
  Sparkles,
  TrendingDown,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react';
import { useAutonomousStore, type CircuitBreakerState } from '../../stores/autonomousStore.js';

/**
 * Live UI for the autonomous trading agent (src/agent/AutonomousTradingAgent.ts).
 *
 * Pulls from two sources:
 *  1. REST GET /api/v1/autonomous/snapshot — called once on mount via
 *     react-query to bootstrap before the first WS broadcast (the agent
 *     runs on a 30s clock; without this, the panel would be empty for
 *     up to 30s after page load).
 *  2. WS broadcasts (agent.autonomous.* event types) — pushed live into
 *     the autonomousStore by wsRouting.ts as each cycle / brain-module
 *     event fires.
 *
 * Every section renders defensively: if no cycle has run yet, we show a
 * "waiting for first cycle" placeholder instead of an empty grid.
 */

interface SnapshotResponse {
  enabled: boolean;
  running?: boolean;
  latestCycle?: import('../../lib/wsContracts.js').AutonomousCycle | null;
  runtimeRiskMultiplier?: number;
  rollingWinRate?: number;
  rollingSampleSize?: number;
  breaker?: CircuitBreakerState;
  health?: import('../../lib/wsContracts.js').AutonomousHealth | null;
  perSymbol?: Array<{
    symbol: string;
    state: string;
    regime: string | null;
    setupState?: string | null;
    setupType?: string | null;
    confluenceScore?: number | null;
  }>;
  reason?: string;
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtTimeAgo(epoch: number | null | undefined): string {
  if (epoch == null) return '—';
  const diff = Date.now() - epoch;
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

function StateBadge({ state }: { state: string }) {
  const palette: Record<string, string> = {
    monitoring: 'bg-slate-700/40 text-slate-300 border-slate-600/50',
    seeking_entry: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    in_position: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
    stand_aside: 'bg-zinc-700/40 text-zinc-400 border-zinc-600/50',
  };
  const cls = palette[state] ?? 'bg-zinc-700/40 text-zinc-300 border-zinc-600/50';
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${cls}`}>
      {state}
    </span>
  );
}

function ActionBadge({ action }: { action: string }) {
  const palette: Record<string, string> = {
    ENTRY_SUBMITTED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    REJECTED: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
    STAND_ASIDE: 'bg-zinc-700/40 text-zinc-400 border-zinc-600/50',
    MONITOR: 'bg-slate-700/40 text-slate-300 border-slate-600/50',
    IN_POSITION: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
  };
  const cls = palette[action] ?? 'bg-zinc-700/40 text-zinc-300 border-zinc-600/50';
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase border ${cls}`}>
      {action}
    </span>
  );
}

function RegimeBadge({ regime }: { regime: string | null | undefined }) {
  if (!regime) return <span className="text-zinc-600">—</span>;
  const palette: Record<string, string> = {
    TRENDING_UP: 'text-emerald-300',
    TRENDING_DOWN: 'text-rose-300',
    RANGING: 'text-amber-300',
    VOLATILE: 'text-purple-300',
    TRANSITIONING: 'text-sky-300',
  };
  const cls = palette[regime] ?? 'text-slate-300';
  const arrow = regime === 'TRENDING_UP' ? (
    <TrendingUp className="inline w-3 h-3 mr-1" />
  ) : regime === 'TRENDING_DOWN' ? (
    <TrendingDown className="inline w-3 h-3 mr-1" />
  ) : null;
  return (
    <span className={`font-mono text-xs ${cls}`}>
      {arrow}
      {regime}
    </span>
  );
}

function BreakerCard({ breaker }: { breaker: CircuitBreakerState }) {
  const tripped = breaker.tripped;
  const Icon = tripped ? AlertTriangle : CheckCircle2;
  const color = tripped ? 'text-rose-300 border-rose-500/40 bg-rose-500/10' : 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10';
  return (
    <div className={`rounded-xl border p-3 ${color}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" />
        <span className="text-[10px] font-bold uppercase tracking-wider">Circuit Breaker</span>
      </div>
      <div className="text-sm font-mono">
        {tripped ? 'TRIPPED' : 'HEALTHY'}
      </div>
      <div className="text-[10px] text-zinc-400 mt-1">
        {tripped ? (
          breaker.cooldownEndsAt ? (
            <>cooldown ends {fmtTimeAgo(breaker.cooldownEndsAt)}</>
          ) : (
            'indefinite — manual reset required'
          )
        ) : breaker.clearedAt ? (
          <>last cleared {fmtTimeAgo(breaker.clearedAt)}</>
        ) : (
          'never tripped'
        )}
      </div>
      {breaker.reason && (
        <div className="text-[10px] text-zinc-500 mt-1 truncate" title={breaker.reason}>
          {breaker.reason}
        </div>
      )}
    </div>
  );
}

function HealthCard({ health }: { health: import('../../lib/wsContracts.js').AutonomousHealth | null }) {
  const healthy = health?.healthy ?? true;
  const Icon = healthy ? Heart : AlertTriangle;
  const color = healthy ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : 'text-rose-300 border-rose-500/40 bg-rose-500/10';
  const issues = health?.issues ?? [];
  return (
    <div className={`rounded-xl border p-3 ${color}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" />
        <span className="text-[10px] font-bold uppercase tracking-wider">Health Monitor</span>
      </div>
      <div className="text-sm font-mono">{healthy ? 'OK' : `${issues.length} issue${issues.length === 1 ? '' : 's'}`}</div>
      {issues.length > 0 && (
        <ul className="text-[10px] text-zinc-400 mt-1 space-y-0.5 max-h-16 overflow-y-auto">
          {issues.slice(0, 4).map((i, idx) => (
            <li key={idx} className="truncate" title={i.detail}>
              <span className="text-rose-300">[{i.kind}]</span>{i.symbol ? ` ${i.symbol}` : ''}{i.timeframe ? ` ${i.timeframe}` : ''}: {i.detail}
            </li>
          ))}
        </ul>
      )}
      <div className="text-[10px] text-zinc-500 mt-1">
        {health?.lastCheckedAt ? `probed ${fmtTimeAgo(health.lastCheckedAt)}` : 'no probe yet'}
      </div>
    </div>
  );
}

function LearningCard({ multiplier, winRate, sampleSize }: { multiplier: number; winRate: number; sampleSize: number }) {
  // Visual dial — render a horizontal bar with the multiplier position.
  // Multiplier ranges from 0.5 to 1.5 (configurable floor/ceiling). Map to 0..100%.
  const pct = Math.max(0, Math.min(100, ((multiplier - 0.5) / 1.0) * 100));
  return (
    <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-3">
      <div className="flex items-center gap-2 mb-1">
        <Gauge className="w-4 h-4 text-sky-300" />
        <span className="text-[10px] font-bold uppercase tracking-wider">Learning Loop</span>
      </div>
      <div className="text-sm font-mono text-sky-200">risk mult ×{multiplier.toFixed(2)}</div>
      <div className="h-1.5 bg-zinc-800 rounded-full mt-2 relative">
        <div
          className="absolute top-0 h-full bg-sky-400 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[9px] text-zinc-500 mt-1">
        <span>×0.5</span>
        <span>×1.0</span>
        <span>×1.5</span>
      </div>
      <div className="text-[10px] text-zinc-400 mt-2">
        rolling win rate <span className="text-sky-300 font-mono">{fmtPct(winRate)}</span> over <span className="font-mono">{sampleSize}</span> trades
      </div>
    </div>
  );
}

export function AutonomousAgentPanel() {
  const {
    latestCycle,
    hasReceivedCycle,
    breaker,
    health,
    forming,
    signals,
    rejections,
    exits,
    learning,
    regimes,
    hydrateFromSnapshot,
  } = useAutonomousStore();

  // Bootstrap from REST on mount. refetchInterval: false (we don't poll —
  // WS broadcasts keep the store fresh after the initial hydrate).
  const { data: snap, isLoading } = useQuery<SnapshotResponse>({
    queryKey: ['autonomous-snapshot'],
    queryFn: async () => {
      const res = await fetch('/api/v1/autonomous/snapshot');
      if (!res.ok) throw new Error(`snapshot failed: ${res.status}`);
      return res.json() as Promise<SnapshotResponse>;
    },
    staleTime: Infinity,
    retry: 1,
  });

  // Hydrate the store once when the snapshot arrives. After this, WS
  // broadcasts keep everything fresh.
  useEffect(() => {
    if (!snap) return;
    if (snap.enabled) {
      hydrateFromSnapshot({
        latestCycle: snap.latestCycle ?? null,
        breaker: snap.breaker ?? null,
        health: snap.health ?? null,
        // REST snapshot doesn't include forming/signals/etc. history —
        // those only arrive via WS. We intentionally leave the existing
        // store arrays untouched so we don't wipe recent activity if the
        // snapshot is re-fetched.
        forming: [],
        signals: [],
        rejections: [],
        exits: [],
        learning: [],
        regimes: [],
      });
    }
  }, [snap, hydrateFromSnapshot]);

  if (isLoading && !hasReceivedCycle) {
    return (
      <div className="p-6 text-zinc-400 font-mono text-sm">
        <Activity className="inline w-4 h-4 mr-2 animate-pulse" />
        Loading autonomous agent snapshot…
      </div>
    );
  }

  if (snap && !snap.enabled) {
    return (
      <div className="p-6 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-200 font-mono text-sm">
        <AlertTriangle className="inline w-4 h-4 mr-2" />
        Autonomous agent is disabled. Set <code className="px-1 py-0.5 bg-zinc-800 rounded">AUTONOMOUS_AGENT_ENABLED=true</code> or run <code className="px-1 py-0.5 bg-zinc-800 rounded">pnpm start</code> to enable.
        {snap.reason ? <div className="text-[11px] text-amber-300/70 mt-1">{snap.reason}</div> : null}
      </div>
    );
  }

  const cycle = latestCycle;
  const runtimeMult = cycle?.runtimeRiskMultiplier ?? snap?.runtimeRiskMultiplier ?? 1.0;
  const winRate = cycle?.rollingWinRate ?? snap?.rollingWinRate ?? 0;
  const sampleSize = snap?.rollingSampleSize ?? 0;
  const decisions = cycle?.decisions ?? [];

  return (
    <div className="space-y-4">
      {/* Header strip — last cycle summary */}
      <div className="rounded-xl border border-[#1b2537] bg-[#0f1623] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-blue-400" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-blue-300">Autonomous Agent</h3>
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
              snap?.running
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                : 'bg-zinc-700/40 text-zinc-400 border-zinc-600/50'
            }`}>
              {snap?.running ? 'RUNNING' : 'STOPPED'}
            </span>
          </div>
          <div className="text-[11px] text-zinc-500 font-mono">
            {cycle ? (
              <>last cycle {fmtTimeAgo(cycle.completedAt)} · {fmtMs(cycle.durationMs)} · cycle <span className="text-zinc-300">{cycle.cycleId.slice(0, 8)}</span></>
            ) : (
              'no cycle completed yet'
            )}
          </div>
        </div>

        {/* Quick stats row */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-center">
          <div className="bg-[#080c14] rounded-lg p-2">
            <div className="text-[9px] uppercase text-zinc-500 tracking-wider">Scanned</div>
            <div className="text-base font-mono text-zinc-200">{cycle?.symbolsScanned ?? 0}</div>
          </div>
          <div className="bg-[#080c14] rounded-lg p-2">
            <div className="text-[9px] uppercase text-zinc-500 tracking-wider">Forming</div>
            <div className="text-base font-mono text-amber-300">{cycle?.formingSetups ?? 0}</div>
          </div>
          <div className="bg-[#080c14] rounded-lg p-2">
            <div className="text-[9px] uppercase text-zinc-500 tracking-wider">Ready</div>
            <div className="text-base font-mono text-emerald-300">{cycle?.readySetups ?? 0}</div>
          </div>
          <div className="bg-[#080c14] rounded-lg p-2">
            <div className="text-[9px] uppercase text-zinc-500 tracking-wider">Submitted</div>
            <div className="text-base font-mono text-blue-300">{cycle?.signalsSubmitted ?? 0}</div>
          </div>
          <div className="bg-[#080c14] rounded-lg p-2">
            <div className="text-[9px] uppercase text-zinc-500 tracking-wider">Rejected</div>
            <div className="text-base font-mono text-rose-300">{cycle?.signalsRejected ?? 0}</div>
          </div>
          <div className="bg-[#080c14] rounded-lg p-2">
            <div className="text-[9px] uppercase text-zinc-500 tracking-wider">Stand Aside</div>
            <div className="text-base font-mono text-zinc-400">{cycle?.standingAsideSymbols ?? 0}</div>
          </div>
        </div>
      </div>

      {/* Brain modules row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <BreakerCard breaker={breaker} />
        <HealthCard health={health} />
        <LearningCard multiplier={runtimeMult} winRate={winRate} sampleSize={sampleSize} />
      </div>

      {/* Per-symbol scan table */}
      <div className="rounded-xl border border-[#1b2537] bg-[#0f1623] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Radio className="w-4 h-4 text-blue-400" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-300">Per-Symbol Scan</h4>
        </div>
        {decisions.length === 0 ? (
          <div className="text-zinc-500 text-xs font-mono">no decisions yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-[10px] uppercase text-zinc-500 border-b border-[#1b2537]">
                  <th className="text-left py-2 px-2">Symbol</th>
                  <th className="text-left py-2 px-2">State</th>
                  <th className="text-left py-2 px-2">Regime</th>
                  <th className="text-left py-2 px-2">Setup</th>
                  <th className="text-right py-2 px-2">Confluence</th>
                  <th className="text-left py-2 px-2">Action</th>
                  <th className="text-left py-2 px-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d) => (
                  <tr key={d.symbol} className="border-b border-[#141d2e] hover:bg-[#141d2e]/40">
                    <td className="py-1.5 px-2 text-zinc-200 font-semibold">{d.symbol}</td>
                    <td className="py-1.5 px-2"><StateBadge state={d.state} /></td>
                    <td className="py-1.5 px-2"><RegimeBadge regime={d.regime} /></td>
                    <td className="py-1.5 px-2 text-zinc-400">
                      {d.setupType ? `${d.setupType}/${d.setupState ?? '?'}` : '—'}
                    </td>
                    <td className="py-1.5 px-2 text-right text-zinc-300">
                      {d.confluenceScore != null ? `${d.confluenceScore.toFixed(1)}` : '—'}
                    </td>
                    <td className="py-1.5 px-2"><ActionBadge action={d.action} /></td>
                    <td className="py-1.5 px-2 text-zinc-500 truncate max-w-xs" title={d.reason}>{d.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Forming setups radar + Recent signals/rejections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Forming setups */}
        <div className="rounded-xl border border-[#1b2537] bg-[#0f1623] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-300">Forming Setups Radar</h4>
            <span className="ml-auto text-[10px] text-zinc-500 font-mono">{forming.length} recent</span>
          </div>
          {forming.length === 0 ? (
            <div className="text-zinc-500 text-xs font-mono">no forming setups detected</div>
          ) : (
            <ul className="space-y-1.5 max-h-64 overflow-y-auto">
              {forming.slice(0, 12).map((f, idx) => (
                <li key={`${f.symbol}-${f.setupId ?? idx}`} className="text-xs font-mono flex items-center justify-between gap-2">
                  <span className="text-zinc-200">{f.symbol}</span>
                  <span className="text-amber-300">{f.setupType}</span>
                  <span className="text-zinc-500">{f.state}{f.direction ? ` · ${f.direction}` : ''}</span>
                  {f.confluenceScore != null && (
                    <span className="text-zinc-600">conf={f.confluenceScore.toFixed(0)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Recent signals + rejections */}
        <div className="rounded-xl border border-[#1b2537] bg-[#0f1623] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-emerald-400" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-300">Signals & Rejections</h4>
            <span className="ml-auto text-[10px] text-zinc-500 font-mono">
              {signals.length} submitted · {rejections.length} rejected
            </span>
          </div>
          {signals.length === 0 && rejections.length === 0 ? (
            <div className="text-zinc-500 text-xs font-mono">no entries attempted</div>
          ) : (
            <ul className="space-y-1.5 max-h-64 overflow-y-auto">
              {signals.slice(0, 5).map((s, idx) => (
                <li key={`sig-${s.signalId ?? idx}`} className="text-xs font-mono flex items-center gap-2">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span className="text-zinc-200">{s.symbol}</span>
                  <span className="text-emerald-300">{s.action}</span>
                  <span className="text-zinc-500">{s.regime}/{s.setupType}</span>
                  <span className="text-zinc-500">conf={s.confluenceScore.toFixed(0)}</span>
                  <span className="text-zinc-500">RR={s.rr.toFixed(2)}</span>
                </li>
              ))}
              {rejections.slice(0, 5).map((r, idx) => (
                <li key={`rej-${r.signalId ?? idx}`} className="text-xs font-mono flex items-center gap-2">
                  <XCircle className="w-3 h-3 text-rose-400" />
                  <span className="text-zinc-200">{r.symbol}</span>
                  <span className="text-rose-300">{r.action}</span>
                  <span className="text-zinc-500 truncate" title={r.reason}>{r.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Recent exits + learning adjustments + regime changes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border border-[#1b2537] bg-[#0f1623] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-sky-400" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-300">Recent Exits</h4>
          </div>
          {exits.length === 0 ? (
            <div className="text-zinc-500 text-xs font-mono">no exit decisions</div>
          ) : (
            <ul className="space-y-1.5 max-h-40 overflow-y-auto text-xs font-mono">
              {exits.slice(0, 8).map((e, idx) => (
                <li key={`exit-${idx}`} className="flex items-center gap-2">
                  <span className="text-zinc-200">{e.symbol}</span>
                  <span className={e.accepted ? 'text-emerald-300' : 'text-rose-300'}>{e.action}</span>
                  <span className="text-zinc-500 truncate" title={e.reason}>{e.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-[#1b2537] bg-[#0f1623] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Gauge className="w-4 h-4 text-sky-400" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-300">Learning Adjustments</h4>
          </div>
          {learning.length === 0 ? (
            <div className="text-zinc-500 text-xs font-mono">no risk-multiplier changes yet</div>
          ) : (
            <ul className="space-y-1.5 max-h-40 overflow-y-auto text-xs font-mono">
              {learning.slice(0, 8).map((l, idx) => (
                <li key={`learn-${idx}`} className="flex items-center justify-between">
                  <span className="text-zinc-200">{l.parameter}</span>
                  <span className="text-zinc-500">×{l.from.toFixed(2)} →</span>
                  <span className={l.to > l.from ? 'text-emerald-300' : l.to < l.from ? 'text-rose-300' : 'text-zinc-300'}>×{l.to.toFixed(2)}</span>
                  <span className="text-zinc-600">[{fmtPct(l.rollingWinRate)}/{l.rollingSampleSize}]</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-[#1b2537] bg-[#0f1623] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-purple-400" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-300">Regime Changes</h4>
          </div>
          {regimes.length === 0 ? (
            <div className="text-zinc-500 text-xs font-mono">no regime transitions</div>
          ) : (
            <ul className="space-y-1.5 max-h-40 overflow-y-auto text-xs font-mono">
              {regimes.slice(0, 8).map((r, idx) => (
                <li key={`reg-${idx}`} className="flex items-center gap-2">
                  <span className="text-zinc-200">{r.symbol}</span>
                  <span className="text-zinc-500">{r.from}</span>
                  <span className="text-zinc-600">→</span>
                  <RegimeBadge regime={r.to} />
                  <span className="text-zinc-600 ml-auto">{Math.round(r.confidence * 100)}%</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="text-[10px] text-zinc-600 text-center font-mono pb-2">
        <Shield className="inline w-3 h-3 mr-1" />
        State hydrates from REST on mount · WS broadcasts keep it live · ring buffers bounded to last 50 events per channel
      </div>
    </div>
  );
}
