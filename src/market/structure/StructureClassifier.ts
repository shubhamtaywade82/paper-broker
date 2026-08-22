import type { Candle } from '../../strategy/indicators.js';
import type {
  ConfirmedSwing,
  MarketTrend,
  StructureEvent,
  StructureForm,
  StructureScope,
} from './types.js';

export class StructureClassifier {
  static evaluateTrendAndStructure(swings: ConfirmedSwing[]): { trend: MarketTrend; structure: StructureForm } {
    if (swings.length < 2) return { trend: 'UNKNOWN', structure: 'UNKNOWN' };

    const recentHighs = swings.filter((s) => s.type === 'HIGH').slice(-2);
    const recentLows = swings.filter((s) => s.type === 'LOW').slice(-2);

    const hasHH = recentHighs.length === 2 && recentHighs[1]!.price > recentHighs[0]!.price;
    const hasHL = recentLows.length === 2 && recentLows[1]!.price > recentLows[0]!.price;
    const hasLH = recentHighs.length === 2 && recentHighs[1]!.price < recentHighs[0]!.price;
    const hasLL = recentLows.length === 2 && recentLows[1]!.price < recentLows[0]!.price;

    if (hasHH && hasHL) return { trend: 'BULLISH', structure: 'HH_HL' };
    if (hasLH && hasLL) return { trend: 'BEARISH', structure: 'LH_LL' };
    if ((hasHH && hasLL) || (hasLH && hasHL)) return { trend: 'RANGE', structure: 'MIXED' };
    if (hasHH || hasHL) return { trend: 'BULLISH', structure: 'HH_HL' };
    if (hasLH || hasLL) return { trend: 'BEARISH', structure: 'LH_LL' };

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

    for (let cIdx = 0; cIdx < candles.length; cIdx++) {
      const c = candles[cIdx]!;
      const availableSwings = swings.filter((s) => s.confirmationTime <= (c.closeTime ?? c.openTime));
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
