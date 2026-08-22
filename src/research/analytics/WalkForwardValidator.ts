import type { Candle } from '../../strategy/indicators.js';

export interface WalkForwardWindow {
  windowIndex: number;
  trainStart: number;
  trainEnd: number;
  validationStart: number;
  validationEnd: number;
  testStart: number;
  testEnd: number;
  trainCandles: Candle[];
  validationCandles: Candle[];
  testCandles: Candle[];
}

export class WalkForwardValidator {
  static generateWindows(
    candles: Candle[],
    trainDurationMs: number,
    valDurationMs: number,
    testDurationMs: number
  ): WalkForwardWindow[] {
    if (candles.length === 0) return [];
    const firstTime = candles[0]!.openTime;
    const lastTime = candles[candles.length - 1]!.openTime;
    const stepDuration = testDurationMs;

    const windows: WalkForwardWindow[] = [];
    let currentStart = firstTime;
    let windowIndex = 1;

    while (currentStart + trainDurationMs + valDurationMs + testDurationMs <= lastTime) {
      const trainEnd = currentStart + trainDurationMs;
      const valEnd = trainEnd + valDurationMs;
      const testEnd = valEnd + testDurationMs;

      windows.push({
        windowIndex,
        trainStart: currentStart,
        trainEnd,
        validationStart: trainEnd,
        validationEnd: valEnd,
        testStart: valEnd,
        testEnd,
        trainCandles: candles.filter((c) => c.openTime >= currentStart && c.openTime < trainEnd),
        validationCandles: candles.filter((c) => c.openTime >= trainEnd && c.openTime < valEnd),
        testCandles: candles.filter((c) => c.openTime >= valEnd && c.openTime < testEnd),
      });

      currentStart += stepDuration;
      windowIndex++;
    }

    return windows;
  }
}
