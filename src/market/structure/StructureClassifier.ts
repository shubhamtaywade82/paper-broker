import type { Candle } from '../../strategy/indicators.js';
import type {
  ConfirmedSwing,
  MarketTrend,
  StructureEvent,
  StructureForm,
  StructureScope,
} from './types.js';

export class StructureClassifier {
  static evaluateTrendAndStructure(
    swings: ConfirmedSwing[],
    events?: StructureEvent[]
  ): { trend: MarketTrend; structure: StructureForm } {
    // Primary: last structural event defines trend (ICT/SMC standard)
    // BOS confirms existing trend, CHoCH reverses it
    if (events && events.length > 0) {
      const lastEvent = events[events.length - 1]!;
      if (lastEvent.eventType === 'BOS_BULLISH' || lastEvent.eventType === 'CHOCH_BULLISH') {
        return { trend: 'BULLISH', structure: 'HH_HL' };
      }
      if (lastEvent.eventType === 'BOS_BEARISH' || lastEvent.eventType === 'CHOCH_BEARISH') {
        return { trend: 'BEARISH', structure: 'LH_LL' };
      }
    }

    // Fallback: swing-based classification with weighted scoring
    if (swings.length < 2) return { trend: 'UNKNOWN', structure: 'UNKNOWN' };

    const recentHighs = swings.filter((s) => s.type === 'HIGH').slice(-2);
    const recentLows = swings.filter((s) => s.type === 'LOW').slice(-2);

    const hasHH = recentHighs.length === 2 && recentHighs[1]!.price > recentHighs[0]!.price;
    const hasHL = recentLows.length === 2 && recentLows[1]!.price > recentLows[0]!.price;
    const hasLH = recentHighs.length === 2 && recentHighs[1]!.price < recentHighs[0]!.price;
    const hasLL = recentLows.length === 2 && recentLows[1]!.price < recentLows[0]!.price;

    // Weight bullish vs bearish swing signals instead of requiring perfect alignment
    const bullish = (hasHH ? 1 : 0) + (hasHL ? 1 : 0);
    const bearish = (hasLH ? 1 : 0) + (hasLL ? 1 : 0);

    if (bullish > bearish) return { trend: 'BULLISH', structure: 'HH_HL' };
    if (bearish > bullish) return { trend: 'BEARISH', structure: 'LH_LL' };
    if (bullish > 0 && bearish > 0) return { trend: 'RANGE', structure: 'MIXED' };

    return { trend: 'RANGE', structure: 'RANGE' };
  }

  static detectBreaks(
    candles: Candle[],
    swings: ConfirmedSwing[],
    scope: StructureScope = 'EXTERNAL'
  ): StructureEvent[] {
    const events: StructureEvent[] = [];
    let currentTrend: MarketTrend = 'UNKNOWN';
    const brokenHighs = new Set<string>();
    const brokenLows = new Set<string>();
    let sIdx = 0;
    const availableSwings: ConfirmedSwing[] = [];

    for (let cIdx = 0; cIdx < candles.length; cIdx++) {
      const c = candles[cIdx]!;
      const cTime = c.closeTime ?? c.openTime;
      while (sIdx < swings.length && swings[sIdx]!.confirmationTime <= cTime) {
        availableSwings.push(swings[sIdx]!);
        sIdx++;
      }
      const trendResult = this.evaluateTrendAndStructure(availableSwings);
      currentTrend = trendResult.trend;

      const lastHigh = availableSwings.filter((s) => s.type === 'HIGH').pop();
      const lastLow = availableSwings.filter((s) => s.type === 'LOW').pop();

      this.checkHighBreak(c, lastHigh, currentTrend, brokenHighs, events, scope);
      this.checkLowBreak(c, lastLow, currentTrend, brokenLows, events, scope);
    }
    return events;
  }

  private static checkHighBreak(
    c: Candle,
    lastHigh: ConfirmedSwing | undefined,
    trend: MarketTrend,
    brokenHighs: Set<string>,
    events: StructureEvent[],
    scope: StructureScope
  ): void {
    if (!lastHigh || brokenHighs.has(lastHigh.id) || c.close <= lastHigh.price) return;
    brokenHighs.add(lastHigh.id);

    const isChoch = trend === 'BEARISH' || lastHigh.classification === 'LH';
    const eventType = isChoch ? 'CHOCH_BULLISH' : 'BOS_BULLISH';
    const confTime = c.closeTime ?? c.openTime;

    events.push({
      id: `${lastHigh.symbol}:${lastHigh.timeframe}:${scope}:${eventType}:${c.openTime}`,
      symbol: lastHigh.symbol,
      timeframe: lastHigh.timeframe,
      scope,
      eventType,
      price: c.close,
      brokenSwingPrice: lastHigh.price,
      brokenSwingTime: lastHigh.pivotTime,
      pivotTime: lastHigh.pivotTime,
      confirmationTime: confTime,
      sourceCandleTime: c.openTime,
    });
  }

  private static checkLowBreak(
    c: Candle,
    lastLow: ConfirmedSwing | undefined,
    trend: MarketTrend,
    brokenLows: Set<string>,
    events: StructureEvent[],
    scope: StructureScope
  ): void {
    if (!lastLow || brokenLows.has(lastLow.id) || c.close >= lastLow.price) return;
    brokenLows.add(lastLow.id);

    const isChoch = trend === 'BULLISH' || lastLow.classification === 'HL';
    const eventType = isChoch ? 'CHOCH_BEARISH' : 'BOS_BEARISH';
    const confTime = c.closeTime ?? c.openTime;

    events.push({
      id: `${lastLow.symbol}:${lastLow.timeframe}:${scope}:${eventType}:${c.openTime}`,
      symbol: lastLow.symbol,
      timeframe: lastLow.timeframe,
      scope,
      eventType,
      price: c.close,
      brokenSwingPrice: lastLow.price,
      brokenSwingTime: lastLow.pivotTime,
      pivotTime: lastLow.pivotTime,
      confirmationTime: confTime,
      sourceCandleTime: c.openTime,
    });
  }
}
