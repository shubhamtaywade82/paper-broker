import { useEffect, useRef, useState } from 'react';
import { useStore, type LiveEventItem } from '../../store/useStore';
import { Bot, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

// How long a toast stays visible before it auto-dismisses. This is the "threshold
// disappearing time" — long enough to read a short line, short enough that the
// stack doesn't pile up during a fast-moving cycle.
const TOAST_TTL_MS = 8000;
const MAX_VISIBLE = 4;

const STAGE_LABELS: Record<string, string> = {
  analyst_team: 'Derivatives Analyst',
  debate_bull: 'Bull Researcher',
  debate_bear: 'Bear Researcher',
  debate_verdict: 'Debate Judge',
  trader_decision: 'Trader',
  risk_team: 'Risk Committee',
  fund_manager: 'Fund Manager',
};

interface Toast {
  id: string;
  expiresAt: number;
  kind: 'step' | 'cycle';
  symbol: string;
  status?: 'started' | 'completed' | 'failed';
  label: string;
  detail?: string;
}

function toToast(evt: LiveEventItem): Toast | null {
  const p = evt.payload;
  const id = evt.id || `${evt.type}_${evt.timestamp}`;

  if (evt.type === 'agent_step' && p.cycleId && p.symbol && p.stage && p.status) {
    return {
      id,
      expiresAt: 0,
      kind: 'step',
      symbol: String(p.symbol),
      status: p.status as Toast['status'],
      label: STAGE_LABELS[String(p.stage)] || String(p.stage),
      detail: p.detail ? String(p.detail).slice(0, 100) : undefined,
    };
  }
  if (evt.type === 'cycle' && p.symbol) {
    return {
      id,
      expiresAt: 0,
      kind: 'cycle',
      symbol: String(p.symbol),
      label: `Cycle complete: ${String(p.action ?? 'NEUTRAL')}`,
      detail: p.rationale ? String(p.rationale).slice(0, 100) : undefined,
    };
  }
  return null;
}

/**
 * Global, always-mounted toast stack for agentic background activity (debate
 * steps, completed cycles). Independent of which page/tab is active — this is
 * the only place a user watching e.g. the Risk Engine page would see that the
 * agent just ran a cycle on SOLUSDT, since the full transcript otherwise only
 * lives on Agent -> Overview.
 */
export function AgentActivityToasts() {
  const { liveEvents } = useStore();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    // Seed with whatever's already buffered on mount so we don't dump the
    // entire backlog as toasts the instant the page loads.
    if (seenIds.current === null) {
      seenIds.current = new Set(liveEvents.map((e) => e.id || `${e.type}_${e.timestamp}`));
      return;
    }

    const fresh: Toast[] = [];
    for (const evt of liveEvents) {
      const key = evt.id || `${evt.type}_${evt.timestamp}`;
      if (seenIds.current.has(key)) continue;
      seenIds.current.add(key);
      const toast = toToast(evt);
      if (toast) fresh.push(toast);
    }
    if (fresh.length === 0) return;

    const now = Date.now();
    setToasts((prev) => [
      ...fresh.map((t) => ({ ...t, expiresAt: now + TOAST_TTL_MS })),
      ...prev,
    ].slice(0, MAX_VISIBLE + 10));
  }, [liveEvents]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => t.expiresAt > now));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const visible = toasts.slice(0, MAX_VISIBLE);
  if (visible.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 space-y-2 w-80 font-mono pointer-events-none">
      {visible.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto p-3 rounded-xl border shadow-lg backdrop-blur-sm bg-[#0f1623]/95 ${
            t.kind === 'cycle'
              ? 'border-blue-500/40'
              : t.status === 'failed'
              ? 'border-red-500/30'
              : t.status === 'completed'
              ? 'border-emerald-500/30'
              : 'border-amber-500/30'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            {t.kind === 'cycle' ? (
              <Bot className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            ) : t.status === 'failed' ? (
              <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
            ) : t.status === 'completed' ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <Loader2 className="w-3.5 h-3.5 text-amber-400 shrink-0 animate-spin" />
            )}
            <span className="text-[10px] font-bold text-white uppercase truncate">
              {t.symbol} · {t.label}
            </span>
          </div>
          {t.detail && (
            <p className="text-[10px] text-gray-400 leading-snug line-clamp-2">{t.detail}</p>
          )}
        </div>
      ))}
    </div>
  );
}
