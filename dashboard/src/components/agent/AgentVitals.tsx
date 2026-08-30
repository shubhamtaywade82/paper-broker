import type { ReactNode } from 'react';
import type { AccountInfo } from '../../store/useStore';
import type { AutonomousCycle, AutonomousHealth } from '../../lib/wsContracts';
import type { CircuitBreakerState } from '../../stores/autonomousStore';

type Tone = 'plain' | 'good' | 'warn' | 'bad' | 'dead';

const TONE_CLASS: Record<Tone, string> = {
  plain: 'text-white',
  good: 'text-emerald-400',
  warn: 'text-amber-400',
  bad: 'text-red-400',
  dead: 'text-gray-600',
};

function Vital({ label, value, note, tone = 'plain' }: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="px-4 py-3 border-r border-[#1b2537]/60 last:border-r-0">
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</span>
      <span className={`block font-mono tabular-nums text-xl font-medium mt-1 ${TONE_CLASS[tone]}`}>{value}</span>
      {note && <span className="block text-[11px] text-gray-500 mt-0.5">{note}</span>}
    </div>
  );
}

interface Props {
  account: AccountInfo | null;
  cycle: AutonomousCycle | null;
  breaker: CircuitBreakerState;
  health: AutonomousHealth | null;
  /** Mean LLM step latency, or null when no step has ever completed. */
  avgLlmLatencyMs: number | null;
}

/**
 * Six vitals, every one a number that actually moves.
 *
 * The ribbon this replaces carried "Active runs 0 Idle", "Avg LLM latency —"
 * and a hardcoded "Pipeline mode AUTONOMOUS" on a system that had been halted
 * for 2239 consecutive cycles. A metric that never changes is chrome; worse,
 * three tiles reporting capability while the agent refused every entry made
 * the page actively misleading. Each tile here is either live or explicitly
 * marked as never having run.
 */
export function AgentVitals({ account, cycle, breaker, health, avgLlmLatencyMs }: Props) {
  const equity = account?.equity;
  const peak = account?.peakEquity;
  const drawdownPct = account?.drawdown != null ? account.drawdown * 100 : null;

  const fees = account?.totalFees;
  const realized = account?.totalRealizedPnl;
  // Only meaningful while the account is net down: it answers "how much of the
  // loss was execution cost rather than the strategy being wrong".
  const feeShare =
    fees != null && realized != null && realized < 0 ? (fees / Math.abs(realized)) * 100 : null;

  const submitted = cycle?.signalsSubmitted ?? null;
  const scanned = cycle?.symbolsScanned ?? null;

  const healthIssues = health?.issues?.length ?? 0;
  const blockers = (breaker.tripped ? 1 : 0) + (healthIssues > 0 ? 1 : 0);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 bg-[#0f1623] border border-[#1b2537] rounded-xl overflow-hidden">
      <Vital
        label="Equity"
        value={equity == null ? '—' : `$${equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
        note={
          drawdownPct != null && peak != null
            ? `${drawdownPct.toFixed(1)}% below peak $${peak.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
            : undefined
        }
        tone={drawdownPct != null && drawdownPct >= 20 ? 'bad' : 'plain'}
      />

      <Vital
        label="Entries submitted"
        value={submitted ?? '—'}
        note={scanned != null ? `of ${scanned} symbols scanned` : undefined}
        tone={submitted === 0 ? 'bad' : submitted != null && submitted > 0 ? 'good' : 'plain'}
      />

      <Vital
        label="Blocked by"
        value={blockers}
        note={
          blockers === 0
            ? 'nothing'
            : [breaker.tripped && 'circuit breaker', healthIssues > 0 && `${healthIssues} health issues`]
                .filter(Boolean)
                .join(' · ')
        }
        tone={blockers > 0 ? 'bad' : 'good'}
      />

      <Vital
        label="Fees vs P&L"
        value={feeShare == null ? '—' : `${feeShare.toFixed(0)}%`}
        note={
          fees != null && realized != null
            ? `$${Math.round(fees).toLocaleString()} of $${Math.round(Math.abs(realized)).toLocaleString()} lost`
            : 'account net positive'
        }
        tone={feeShare != null && feeShare >= 25 ? 'warn' : 'plain'}
      />

      <Vital
        label="Last cycle"
        value={cycle ? <>{cycle.durationMs}<span className="text-sm text-gray-600">ms</span></> : '—'}
        note={cycle ? `${cycle.readySetups} ready · ${cycle.standingAsideSymbols} standing aside` : 'no cycle yet'}
      />

      <Vital
        label="LLM latency"
        value={avgLlmLatencyMs == null ? 'Never run' : <>{Math.round(avgLlmLatencyMs)}<span className="text-sm text-gray-600">ms</span></>}
        note={avgLlmLatencyMs == null ? 'no inference recorded' : 'mean per stage'}
        tone={avgLlmLatencyMs == null ? 'dead' : 'plain'}
      />
    </div>
  );
}
