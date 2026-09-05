import type { Candle } from '../strategy/indicators.js';

/** How long a candidate's current setup is good for. A coin can qualify for
 * more than one at once (a yearly uptrend that is also breaking out). */
export type TradeHorizon = 'SWING' | 'SHORT_TERM' | 'LONG_TERM';

/** All derived from real daily OHLCV. `null` means "not enough history to
 * say" and is never silently treated as zero. */
export interface PerformanceMetrics {
  close: number;
  return20d: number | null;
  return60d: number | null;
  return250d: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  sma200Rising: boolean | null;
  high52w: number;
  low52w: number;
  pctFrom52wHigh: number | null;
  volatilityPct: number | null;
  avgTradedValue: number;
  relativeStrength60d: number | null;
  relativeStrength250d: number | null;
  candleCount: number;
}

const TRADING_DAYS = { swing: 20, short: 60, long: 250 } as const;

function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const val = closes[i];
    if (val == null) return null;
    sum += val;
  }
  return sum / period;
}

function pctReturn(closes: number[], period: number): number | null {
  if (closes.length <= period) return null;
  const past = closes[closes.length - 1 - period];
  const latest = closes[closes.length - 1];
  if (past == null || latest == null || !(past > 0)) return null;
  return ((latest - past) / past) * 100;
}

function volatilityPct(closes: number[], period = 20): number | null {
  if (closes.length <= period) return null;
  const rets: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    const prev = closes[i - 1];
    const current = closes[i];
    if (prev == null || current == null || !(prev > 0)) continue;
    rets.push((current - prev) / prev);
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * 100;
}

export function computePerformance(candles: Candle[], benchmark?: Candle[]): PerformanceMetrics | null {
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.close);
  const close = closes[closes.length - 1];
  if (close == null || !(close > 0)) return null;

  const window = candles.slice(-TRADING_DAYS.long);
  const high52w = Math.max(...window.map((c) => c.high));
  const low52w = Math.min(...window.map((c) => c.low));

  const recent = candles.slice(-20);
  const avgTradedValue = recent.reduce((sum, c) => sum + c.close * c.volume, 0) / recent.length;

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const sma200Prev = closes.length >= 220 ? sma(closes.slice(0, -20), 200) : null;

  const benchCloses = benchmark?.map((c) => c.close) || [];
  const relativeStrength = (period: number): number | null => {
    const own = pctReturn(closes, period);
    const bench = benchCloses.length ? pctReturn(benchCloses, period) : null;
    if (own == null || bench == null) return null;
    return own - bench;
  };

  return {
    close,
    return20d: pctReturn(closes, TRADING_DAYS.swing),
    return60d: pctReturn(closes, TRADING_DAYS.short),
    return250d: pctReturn(closes, TRADING_DAYS.long),
    sma20, sma50, sma200,
    sma200Rising: sma200 != null && sma200Prev != null ? sma200 > sma200Prev : null,
    high52w,
    low52w,
    // A high/low computed from fewer than 250 sessions isn't a real 52-week
    // range — a newly-listed coin would trivially look "near its high" with
    // no real year of history to have fallen from. Fail closed like sma200Rising.
    pctFrom52wHigh: candles.length >= TRADING_DAYS.long && high52w > 0 ? ((close - high52w) / high52w) * 100 : null,
    volatilityPct: volatilityPct(closes),
    avgTradedValue,
    relativeStrength60d: relativeStrength(TRADING_DAYS.short),
    relativeStrength250d: relativeStrength(TRADING_DAYS.long),
    candleCount: candles.length,
  };
}

/** A coin can qualify for several horizons at once — a long-term uptrend
 * that is also breaking out is both LONG_TERM and SWING. */
export function classifyHorizons(p: PerformanceMetrics): TradeHorizon[] {
  const horizons: TradeHorizon[] = [];

  if (p.sma20 != null && p.close > p.sma20 && (p.return20d ?? 0) > 0
    && p.pctFrom52wHigh != null && p.pctFrom52wHigh > -15) {
    horizons.push('SWING');
  }
  if (p.sma50 != null && p.close > p.sma50 && (p.return60d ?? 0) > 0
    && (p.relativeStrength60d ?? 0) > 0) {
    horizons.push('SHORT_TERM');
  }
  // sma200Rising being null (short history) fails this on purpose rather
  // than assuming the trend is up.
  if (p.sma200 != null && p.close > p.sma200 && p.sma200Rising === true
    && (p.relativeStrength250d ?? 0) > 0) {
    horizons.push('LONG_TERM');
  }

  return horizons;
}

/** 0-100 composite, weighted toward relative strength with trend alignment
 * as confirmation. */
export function performanceScore(p: PerformanceMetrics): number {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  const rs60 = p.relativeStrength60d != null ? clamp(p.relativeStrength60d + 10, 0, 40) : 0;
  const rs250 = p.relativeStrength250d != null ? clamp((p.relativeStrength250d + 20) / 2, 0, 25) : 0;
  const trend = [
    p.sma20 != null && p.close > p.sma20,
    p.sma50 != null && p.close > p.sma50,
    p.sma200 != null && p.close > p.sma200,
    p.sma200Rising === true,
  ].filter(Boolean).length * 5;
  const proximity = clamp(15 + (p.pctFrom52wHigh ?? -100) / 2, 0, 15);

  return Math.round(clamp(rs60 + rs250 + trend + proximity, 0, 100));
}
