import type { Candle } from '../../strategy/indicators.js';
import type { StructureEvent } from '../structure/types.js';
import type { OrderBlock, SmcConfig } from './types.js';
import { DEFAULT_SMC_CONFIG } from './LiquidityDetector.js';

export class OrderBlockDetector {
  static detectOrderBlocks(
    candles: Candle[],
    events: StructureEvent[],
    config = DEFAULT_SMC_CONFIG
  ): OrderBlock[] {
    const obs: OrderBlock[] = [];
    const structureEvents = events.filter((e) => e.eventType.startsWith('BOS_') || e.eventType.startsWith('CHOCH_'));

    for (const evt of structureEvents) {
      const isBullish = evt.eventType.endsWith('_BULLISH');
      const ob = isBullish
        ? this.findBullishOb(candles, evt, config)
        : this.findBearishOb(candles, evt, config);

      if (ob) obs.push(ob);
    }

    return this.trackObLifecycles(candles, obs);
  }

  private static findBullishOb(candles: Candle[], evt: StructureEvent, config: SmcConfig): OrderBlock | null {
    const breakIdx = candles.findIndex((c) => c.openTime === evt.sourceCandleTime);
    if (breakIdx <= 0) return null;

    const lookback = Math.min(breakIdx, config.obLookbackBars);
    let origin: Candle | null = null;

    for (let i = breakIdx - 1; i >= breakIdx - lookback; i--) {
      const c = candles[i]!;
      if (c.close < c.open) {
        origin = c;
        break;
      }
    }
    if (!origin) origin = candles[breakIdx - 1]!;

    const breakCandle = candles[breakIdx]!;
    const displacement = (breakCandle.close - origin.low) / origin.low;
    if (displacement < config.obDisplacementThresholdPct) return null;

    return {
      id: `${evt.symbol}:${evt.timeframe}:OB:BULLISH:${origin.openTime}`,
      symbol: evt.symbol,
      timeframe: evt.timeframe,
      type: 'BULLISH',
      upperPrice: origin.high,
      lowerPrice: origin.low,
      invalidationPrice: origin.low,
      originCandleTime: origin.openTime,
      displacementCandleTime: breakCandle.openTime,
      confirmedStructureEventId: evt.id,
      sourceCandleTimes: [origin.openTime, breakCandle.openTime],
      createdAt: origin.openTime,
      confirmedAt: evt.confirmationTime,
      status: 'ACTIVE',
    };
  }

  private static findBearishOb(candles: Candle[], evt: StructureEvent, config: SmcConfig): OrderBlock | null {
    const breakIdx = candles.findIndex((c) => c.openTime === evt.sourceCandleTime);
    if (breakIdx <= 0) return null;

    const lookback = Math.min(breakIdx, config.obLookbackBars);
    let origin: Candle | null = null;

    for (let i = breakIdx - 1; i >= breakIdx - lookback; i--) {
      const c = candles[i]!;
      if (c.close > c.open) {
        origin = c;
        break;
      }
    }
    if (!origin) origin = candles[breakIdx - 1]!;

    const breakCandle = candles[breakIdx]!;
    const displacement = (origin.high - breakCandle.close) / origin.high;
    if (displacement < config.obDisplacementThresholdPct) return null;

    return {
      id: `${evt.symbol}:${evt.timeframe}:OB:BEARISH:${origin.openTime}`,
      symbol: evt.symbol,
      timeframe: evt.timeframe,
      type: 'BEARISH',
      upperPrice: origin.high,
      lowerPrice: origin.low,
      invalidationPrice: origin.high,
      originCandleTime: origin.openTime,
      displacementCandleTime: breakCandle.openTime,
      confirmedStructureEventId: evt.id,
      sourceCandleTimes: [origin.openTime, breakCandle.openTime],
      createdAt: origin.openTime,
      confirmedAt: evt.confirmationTime,
      status: 'ACTIVE',
    };
  }

  private static trackObLifecycles(candles: Candle[], obs: OrderBlock[]): OrderBlock[] {
    return obs.map((ob) => {
      let status = ob.status;
      let mitigatedAt: number | undefined;
      let invalidatedAt: number | undefined;

      // Mitigation requires price to enter the zone — for a bullish OB,
      // price must reach the midpoint (or deeper) rather than merely
      // touching the upper edge. Touching only the top is noise; true
      // mitigation means the zone was tested with intent.
      const mitigationLevel = ob.type === 'BULLISH'
        ? ob.lowerPrice + (ob.upperPrice - ob.lowerPrice) * 0.5
        : ob.upperPrice - (ob.upperPrice - ob.lowerPrice) * 0.5;

      for (const c of candles) {
        if (c.openTime < ob.confirmedAt) continue;

        if (ob.type === 'BULLISH') {
          if (c.close < ob.invalidationPrice) {
            status = 'INVALIDATED';
            invalidatedAt = c.closeTime ?? c.openTime;
            break;
          } else if (c.low <= mitigationLevel && status === 'ACTIVE') {
            status = 'MITIGATED';
            mitigatedAt = c.closeTime ?? c.openTime;
          }
        } else if (ob.type === 'BEARISH') {
          if (c.close > ob.invalidationPrice) {
            status = 'INVALIDATED';
            invalidatedAt = c.closeTime ?? c.openTime;
            break;
          } else if (c.high >= mitigationLevel && status === 'ACTIVE') {
            status = 'MITIGATED';
            mitigatedAt = c.closeTime ?? c.openTime;
          }
        }
      }

      return { ...ob, status, mitigatedAt, invalidatedAt };
    });
  }
}
