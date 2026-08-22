export interface Candle {
  symbol: string;
  interval: string;
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume?: number;
  trades?: number;
  closeTime?: number;
  isClosed?: boolean;
  eventTime?: number;
  receivedAt?: number;
}

export function ema(values: number[], period: number): number[] {
  if (values.length === 0 || period <= 0) return [];

  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = values[0]!;

  result.push(prev);

  for (let i = 1; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    result.push(prev);
  }

  return result;
}

export function sma(values: number[], period: number): number[] {
  if (values.length < period || period <= 0) return [];

  const result: number[] = [];
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;

    if (i >= period - 1) {
      result.push(sum / period);
    } else {
      result.push(NaN);
    }
  }

  return result;
}

export function rsi(values: number[], period = 14): number[] {
  if (values.length < period + 1) return values.map(() => NaN);

  const result: number[] = values.map(() => NaN);
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = values[i]! - values[i - 1]!;
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }

  avgGain /= period;
  avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i]! - values[i - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return result;
}

export function atr(candles: Candle[], period = 14): number[] {
  if (candles.length < 2) return candles.map(() => NaN);

  const trs: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i]!.high;
    const low = candles[i]!.low;
    const prevClose = candles[i - 1]!.close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trs.push(tr);
  }

  const result: number[] = candles.map(() => NaN);
  const firstPeriod = trs.slice(0, period);
  if (firstPeriod.length < period) return result;

  let prevAtr = firstPeriod.reduce((a, b) => a + b, 0) / period;
  result[period] = prevAtr;

  for (let i = period; i < trs.length; i++) {
    prevAtr = (prevAtr * (period - 1) + trs[i]!) / period;
    result[i + 1] = prevAtr;
  }

  return result;
}

export function trueRange(candle: Candle, prevClose: number): number {
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - prevClose),
    Math.abs(candle.low - prevClose)
  );
}

export function highest(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - period + 1);
    const window = values.slice(start, i + 1).filter((v) => !Number.isNaN(v));
    result.push(window.length > 0 ? Math.max(...window) : NaN);
  }
  return result;
}

export function lowest(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - period + 1);
    const window = values.slice(start, i + 1).filter((v) => !Number.isNaN(v));
    result.push(window.length > 0 ? Math.min(...window) : NaN);
  }
  return result;
}