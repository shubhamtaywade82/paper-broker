import { AlertTriangle, Activity, Radar, ShieldOff } from 'lucide-react';
import type { CircuitBreakerState } from '../../stores/autonomousStore';
import type { AutonomousCycle, AutonomousHealth } from '../../lib/wsContracts';

export type AgentPosture = 'halted' | 'degraded' | 'scanning' | 'in-market' | 'trading';

export interface AgentState {
  posture: AgentPosture;
  /** One line: what the agent is doing right now. */
  headline: string;
  /** Why it is in that state, in the operator's terms. */
  because: string;
  since: number | null;
}

/**
 * Reduces breaker + health + last cycle into the single question this page
 * exists to answer: is the agent trading, and if not, why?
 *
 * Pure and exported so the precedence can be tested directly. Order matters —
 * a tripped breaker outranks stale data, because the breaker is what actually
 * refuses the entry.
 */
export function deriveAgentState(
  breaker: CircuitBreakerState,
  health: AutonomousHealth | null,
  cycle: AutonomousCycle | null,
  openPositions = 0
): AgentState {
  if (breaker.tripped) {
    return {
      posture: 'halted',
      headline: 'Not trading',
      because: breaker.reason
        ? `Circuit breaker tripped: ${breaker.reason.replace(/_/g, ' ').toLowerCase()}.`
        : 'Circuit breaker tripped.',
      since: breaker.trippedAt,
    };
  }

  const issues = health?.issues?.length ?? 0;
  if (issues > 0) {
    return {
      posture: 'degraded',
      headline: 'Degraded — entries at risk',
      because: `${issues} health ${issues === 1 ? 'issue' : 'issues'} reported. Entries are blocked while market data is unhealthy.`,
      since: health?.lastCheckedAt ?? null,
    };
  }

  if (cycle && cycle.signalsSubmitted > 0) {
    return {
      posture: 'trading',
      headline: 'Trading',
      because: `${cycle.signalsSubmitted} ${cycle.signalsSubmitted === 1 ? 'entry' : 'entries'} submitted last cycle across ${cycle.symbolsScanned} symbols.`,
      since: cycle.startedAt ?? null,
    };
  }

  // The agent cycles every ~30s but enters far less often, so "did the LAST
  // cycle submit an entry" is the wrong question once a position is open —
  // without this, an agent holding three winners reads "no qualifying setup"
  // on almost every cycle and flickers to "Trading" for one cycle at a time.
  if (openPositions > 0) {
    return {
      posture: 'in-market',
      headline: `In market — ${openPositions} open ${openPositions === 1 ? 'position' : 'positions'}`,
      because: cycle
        ? `Managing open risk. ${cycle.symbolsScanned} symbols scanned last cycle, no new entry qualified.`
        : 'Managing open risk.',
      since: cycle?.startedAt ?? null,
    };
  }

  return {
    posture: 'scanning',
    headline: 'Scanning — no qualifying setup',
    because: cycle
      ? `${cycle.symbolsScanned} symbols scanned, ${cycle.readySetups} ready, none cleared the entry gates.`
      : 'Waiting for the first cycle.',
    since: cycle?.startedAt ?? null,
  };
}

/** "21h 11m ago" / "3m ago" — coarse on purpose, this is a duration not a clock. */
export function formatSince(ts: number | null, now = Date.now()): string | null {
  if (!ts || ts <= 0 || ts > now) return null;
  const totalMinutes = Math.floor((now - ts) / 60_000);
  if (totalMinutes < 1) return 'just now';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m ago`;
  return `${hours}h ${minutes}m ago`;
}

const POSTURE_STYLE: Record<AgentPosture, { stripe: string; dot: string; ring: string; Icon: typeof AlertTriangle }> = {
  halted: { stripe: 'border-l-red-500', dot: 'bg-red-500', ring: 'shadow-[0_0_0_4px_rgba(240,71,71,0.14)]', Icon: ShieldOff },
  degraded: { stripe: 'border-l-amber-500', dot: 'bg-amber-500', ring: 'shadow-[0_0_0_4px_rgba(210,153,34,0.14)]', Icon: AlertTriangle },
  scanning: { stripe: 'border-l-blue-500', dot: 'bg-blue-500', ring: 'shadow-[0_0_0_4px_rgba(59,130,246,0.14)]', Icon: Radar },
  'in-market': { stripe: 'border-l-emerald-500', dot: 'bg-emerald-500', ring: 'shadow-[0_0_0_4px_rgba(46,160,67,0.14)]', Icon: Activity },
  trading: { stripe: 'border-l-emerald-500', dot: 'bg-emerald-500', ring: 'shadow-[0_0_0_4px_rgba(46,160,67,0.14)]', Icon: Activity },
};

interface Props {
  breaker: CircuitBreakerState;
  health: AutonomousHealth | null;
  cycle: AutonomousCycle | null;
  /** Count of positions with non-zero quantity. */
  openPositions?: number;
  /** Effective size dampener from the loss streak (1 = none). */
  lossStreakDampener?: number;
  onClear?: () => void;
  clearPending?: boolean;
}

/**
 * The page's answer line. Sits above the tabs so it stays on screen whichever
 * panel is open — the state that matters must not be reachable only by
 * navigating to the right tab.
 */
export function AgentStateBar({ breaker, health, cycle, openPositions = 0, lossStreakDampener = 1, onClear, clearPending }: Props) {
  const state = deriveAgentState(breaker, health, cycle, openPositions);
  const style = POSTURE_STYLE[state.posture];
  const since = formatSince(state.since);
  const dampened = lossStreakDampener < 1;

  return (
    <div
      className={`flex flex-wrap items-center gap-4 bg-[#0f1623] border border-[#1b2537] ${style.stripe} border-l-[3px] rounded-xl px-4 py-3.5`}
      role="status"
    >
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${style.dot} ${style.ring}`} aria-hidden="true" />

      <div className="flex-1 min-w-[260px]">
        <div className="flex items-center gap-2 text-[15px] font-semibold text-white">
          <style.Icon className="w-4 h-4 opacity-80" aria-hidden="true" />
          <span>{state.headline}</span>
          {since && <span className="text-xs font-normal text-gray-500">· {since}</span>}
        </div>
        <p className="text-[12.5px] text-gray-400 mt-1">
          {state.because}
          {dampened && (
            <>
              {' '}
              Size dampened{' '}
              <span className="font-mono text-amber-400">×{lossStreakDampener.toFixed(2)}</span> by the loss
              streak — the agent keeps trading smaller rather than stopping.
            </>
          )}
        </p>
      </div>

      {breaker.tripped && onClear && (
        <button
          onClick={onClear}
          disabled={clearPending}
          className="text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3.5 py-2 rounded-lg cursor-pointer transition"
        >
          {clearPending ? 'Clearing…' : 'Clear & resume'}
        </button>
      )}
    </div>
  );
}
