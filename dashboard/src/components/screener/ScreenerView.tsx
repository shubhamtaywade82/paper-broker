// dashboard/src/components/screener/ScreenerView.tsx
import { RefreshCw, Loader2, Radar, Info } from 'lucide-react';
import { useScreenerWatchlist, useScreenerActivity, useRunScreener, type ScreenerCandidate } from '../../hooks/useApi';

const HORIZONS = [
  { key: 'SWING' as const, label: 'Swing', hint: 'Days to ~2 weeks — above 20DMA, pushing at the highs' },
  { key: 'SHORT_TERM' as const, label: 'Short Term', hint: 'Weeks to a quarter — above 50DMA, beating BTC over 60d' },
  { key: 'LONG_TERM' as const, label: 'Long Term', hint: 'Months — above a rising 200DMA, beating BTC over a year' },
];

const fmtPct = (v: number | null | undefined) =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
const tone = (v: number | null | undefined) =>
  v == null ? 'text-zinc-500' : v > 0 ? 'text-emerald-400' : 'text-rose-400';

export function ScreenerView() {
  const { data: watchlistData } = useScreenerWatchlist();
  const { data: activityData } = useScreenerActivity();
  const runScreener = useRunScreener();

  const candidates = watchlistData?.result?.candidates ?? [];
  const passed = candidates.filter((c) => c.passed);
  const byHorizon = (key: 'SWING' | 'SHORT_TERM' | 'LONG_TERM'): ScreenerCandidate[] =>
    passed.filter((c) => c.horizons.includes(key)).sort((a, b) => b.score - a.score);

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto pb-10">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Radar size={16} className="text-accent" />
            Coin Screener
          </h2>
          <p className="text-[11px] text-muted">
            {passed.length} of {candidates.length} scanned coins with a current setup
          </p>
        </div>
        <button
          onClick={() => runScreener.mutate()}
          disabled={runScreener.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent hover:brightness-110 disabled:opacity-50 text-black font-bold text-xs cursor-pointer transition-all"
        >
          {runScreener.isPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          <span>{runScreener.isPending ? 'Scanning…' : 'Run Scan'}</span>
        </button>
      </div>

      <div className="flex items-start gap-2 px-3 py-2 rounded border border-border bg-surface-100 text-[11px] text-muted">
        <Info size={13} className="mt-0.5 shrink-0 text-sky-400" />
        <span>
          Ranked on real price and volume only — relative strength vs BTCUSDT, trend alignment
          and liquidity. No fundamentals feed exists for crypto here, so no valuation claim is made.
        </span>
      </div>

      <div className="bg-surface-100 border border-border rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-border/60 text-xs font-semibold text-white">
          Background Activity
        </div>
        <div className="max-h-40 overflow-y-auto px-3 py-2 space-y-1">
          {(activityData?.steps ?? []).length === 0 ? (
            <p className="text-[11px] text-muted font-mono py-2 text-center">
              No scan activity yet — run a scan to see each step here.
            </p>
          ) : (
            (activityData?.steps ?? []).map((s, i) => (
              <div key={i} className="text-[11px] font-mono text-zinc-300">
                <span className="text-[9px] font-bold text-sky-400 mr-1.5">RULES</span>
                {s.message}
              </div>
            ))
          )}
        </div>
      </div>

      {candidates.length === 0 ? (
        <div className="text-center py-10 bg-surface-100 border border-border rounded-lg">
          <p className="text-sm text-white font-semibold">No scan yet</p>
          <p className="text-[11px] text-muted mt-1">Click "Run Scan" above to screen the live universe.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {HORIZONS.map(({ key, label, hint }) => {
            const picks = byHorizon(key);
            return (
              <div key={key} className="bg-surface-100 border border-border rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-border/60">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-white">{label}</span>
                    <span className="ml-auto text-[10px] font-mono text-muted">{picks.length}</span>
                  </div>
                  <p className="text-[10px] text-muted mt-0.5">{hint}</p>
                </div>
                <div className="divide-y divide-border/30">
                  {picks.length === 0 ? (
                    <p className="px-3 py-4 text-[11px] text-muted text-center">Nothing qualifying right now.</p>
                  ) : (
                    picks.slice(0, 8).map((c) => (
                      <div key={c.symbol} className="w-full px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-bold text-white text-xs">{c.symbol}</span>
                          <span className="font-mono font-bold text-accent text-xs">{c.score}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[10px] font-mono">
                          <span className={tone(c.metrics.return20d)}>20d {fmtPct(c.metrics.return20d)}</span>
                          <span className={tone(c.metrics.relativeStrength60d)}>
                            vs BTC {fmtPct(c.metrics.relativeStrength60d)}
                          </span>
                          <span className="text-zinc-500">{fmtPct(c.metrics.pctFrom52wHigh)} off high</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
