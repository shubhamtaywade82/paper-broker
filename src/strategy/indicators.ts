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

export interface BollingerBandsResult {
  upper: number[];
  middle: number[];
  lower: number[];
  bandWidth: number[];
}

export function bollingerBands(closes: number[], period = 20, stdDevMult = 2): BollingerBandsResult {
  const middle = sma(closes, period);
  const upper: number[] = closes.map(() => NaN);
  const lower: number[] = closes.map(() => NaN);
  const bandWidth: number[] = closes.map(() => NaN);

  for (let i = period - 1; i < closes.length; i++) {
    const mid = middle[i]!;
    const slice = closes.slice(i - period + 1, i + 1);
    const variance = slice.reduce((sum, v) => sum + (v - mid) ** 2, 0) / period;
    const sd = Math.sqrt(variance);

    upper[i] = mid + stdDevMult * sd;
    lower[i] = mid - stdDevMult * sd;
    bandWidth[i] = mid > 0 ? (upper[i]! - lower[i]!) / mid : 0;
  }

  return { upper, middle, lower, bandWidth };
}

export interface MacdResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export function macd(closes: number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): MacdResult {
  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);
  const macdLine: number[] = closes.map((_, i) => fast[i]! - slow[i]!);
  const signalLine = ema(macdLine, signalPeriod);
  const histogram: number[] = macdLine.map((val, i) => val - (signalLine[i] ?? 0));

  return { macd: macdLine, signal: signalLine, histogram };
}

export interface AdxResult {
  adx: number[];
  plusDI: number[];
  minusDI: number[];
}

export function adx(candles: Candle[], period = 14): AdxResult {
  const len = candles.length;
  const adxRes: number[] = candles.map(() => NaN);
  const plusDI: number[] = candles.map(() => NaN);
  const minusDI: number[] = candles.map(() => NaN);

  if (len < period * 2) return { adx: adxRes, plusDI, minusDI };

  const trs: number[] = [0];
  const plusDMs: number[] = [0];
  const minusDMs: number[] = [0];

  for (let i = 1; i < len; i++) {
    const curr = candles[i]!;
    const prev = candles[i - 1]!;
    trs.push(trueRange(curr, prev.close));

    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;

    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  let trSmooth = trs.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let plusDMSmooth = plusDMs.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let minusDMSmooth = minusDMs.slice(1, period + 1).reduce((a, b) => a + b, 0);

  const dxList: number[] = [];

  for (let i = period; i < len; i++) {
    if (i > period) {
      trSmooth = trSmooth - trSmooth / period + trs[i]!;
      plusDMSmooth = plusDMSmooth - plusDMSmooth / period + plusDMs[i]!;
      minusDMSmooth = minusDMSmooth - minusDMSmooth / period + minusDMs[i]!;
    }

    const pDI = trSmooth > 0 ? (plusDMSmooth / trSmooth) * 100 : 0;
    const mDI = trSmooth > 0 ? (minusDMSmooth / trSmooth) * 100 : 0;
    plusDI[i] = pDI;
    minusDI[i] = mDI;

    const diSum = pDI + mDI;
    const dx = diSum > 0 ? (Math.abs(pDI - mDI) / diSum) * 100 : 0;
    dxList.push(dx);

    if (dxList.length === period) {
      adxRes[i] = dxList.reduce((a, b) => a + b, 0) / period;
    } else if (dxList.length > period) {
      adxRes[i] = (adxRes[i - 1]! * (period - 1) + dx) / period;
    }
  }

  return { adx: adxRes, plusDI, minusDI };
}

export interface SupertrendResult {
  supertrend: number[];
  direction: number[];
  upperBand: number[];
  lowerBand: number[];
}

export function supertrend(candles: Candle[], atrPeriod = 10, multiplier = 3): SupertrendResult {
  const atrValues = atr(candles, atrPeriod);
  const len = candles.length;
  const st: number[] = candles.map(() => NaN);
  const dir: number[] = candles.map(() => 1);
  const upperBand: number[] = candles.map(() => NaN);
  const lowerBand: number[] = candles.map(() => NaN);

  let finalUpper = 0;
  let finalLower = 0;
  let prevSt = 0;
  let prevDir = 1;

  for (let i = atrPeriod; i < len; i++) {
    const c = candles[i]!;
    const prevC = candles[i - 1]!;
    const curAtr = atrValues[i] || 0;
    const hl2 = (c.high + c.low) / 2;

    const basicUpper = hl2 + multiplier * curAtr;
    const basicLower = hl2 - multiplier * curAtr;

    finalUpper = basicUpper < finalUpper || prevC.close > finalUpper ? basicUpper : finalUpper;
    finalLower = basicLower > finalLower || prevC.close < finalLower ? basicLower : finalLower;

    if (prevSt === finalUpper) {
      prevDir = c.close <= finalUpper ? -1 : 1;
    } else {
      prevDir = c.close >= finalLower ? 1 : -1;
    }

    const currentSt = prevDir === 1 ? finalLower : finalUpper;
    st[i] = currentSt;
    dir[i] = prevDir;
    upperBand[i] = finalUpper;
    lowerBand[i] = finalLower;
    prevSt = currentSt;
  }

  return { supertrend: st, direction: dir, upperBand, lowerBand };
}