import type { Candle } from '../../strategy/indicators.js';
import type { ConfirmedSwing } from '../structure/types.js';
import type { LiquidityLevel, LiquiditySweep, SmcConfig } from './types.js';

export const DEFAULT_SMC_CONFIG: SmcConfig = {
  equalLevelTolerancePct: 0.0005,
  fvgMinSizePct: 0.0002,
  obDisplacementThresholdPct: 0.005,
  obLookbackBars: 5,
};

export class LiquidityDetector {
  static extractLiquidityLevels(
    swings: ConfirmedSwing[],
    config = DEFAULT_SMC_CONFIG
  ): LiquidityLevel[] {
    const levels: LiquidityLevel[] = [];
    const tol = config.equalLevelTolerancePct;

    for (let i = 0; i < swings.length; i++) {
      const s = swings[i]!;
      const baseType = s.type === 'HIGH' ? 'BSL' : 'SSL';
      const eqType = s.type === 'HIGH' ? 'EQUAL_HIGH' : 'EQUAL_LOW';

      if (i > 0 && swings[i - 1]!.type === s.type) {
        const prev = swings[i - 1]!;
        const diff = Math.abs(s.price - prev.price) / ((s.price + prev.price) / 2);
        if (diff <= tol) {
          levels.push(this.makeLiquidityLevel(s, eqType, (s.price + prev.price) / 2, [prev.id, s.id], [prev.pivotTime, s.pivotTime]));
          continue;
        }
      }
      levels.push(this.makeLiquidityLevel(s, baseType, s.price, [s.id], [s.pivotTime]));
    }
    return levels;
  }

  static detectSweeps(
    candles: Candle[],
    levels: LiquidityLevel[]
  ): { sweeps: LiquiditySweep[]; updatedLevels: LiquidityLevel[] } {
    const sweeps: LiquiditySweep[] = [];
    const sweptIds = new Set<string>();

    for (const c of candles) {
      const cCloseTime = c.closeTime ?? c.openTime;
      const activeLevels = levels.filter((l) => l.confirmedAt <= c.openTime && !sweptIds.has(l.id));

      for (const lvl of activeLevels) {
        const sweep = this.checkCandleSweep(c, lvl, cCloseTime);
        if (sweep) {
          sweeps.push(sweep);
          sweptIds.add(lvl.id);
        }
      }
    }

    const updatedLevels = levels.map((l) => (sweptIds.has(l.id) ? { ...l, status: 'SWEPT' as const } : l));
    return { sweeps, updatedLevels };
  }

  private static makeLiquidityLevel(
    s: ConfirmedSwing,
    type: LiquidityLevel['type'],
    price: number,
    swingIds: string[],
    candleTimes: number[]
  ): LiquidityLevel {
    return {
      id: `${s.symbol}:${s.timeframe}:LIQ:${type}:${s.pivotTime}`,
      symbol: s.symbol,
      timeframe: s.timeframe,
      type,
      price,
      sourceSwingIds: swingIds,
      sourceCandleTimes: candleTimes,
      createdAt: s.pivotTime,
      confirmedAt: s.confirmationTime,
      status: 'ACTIVE',
    };
  }

  private static checkCandleSweep(c: Candle, lvl: LiquidityLevel, closeTime: number): LiquiditySweep | null {
    if (lvl.type === 'BSL' || lvl.type === 'EQUAL_HIGH') {
      if (c.high > lvl.price && c.close <= lvl.price) {
        return this.buildSweepObject(c, lvl, c.high, closeTime);
      }
    } else if (lvl.type === 'SSL' || lvl.type === 'EQUAL_LOW') {
      if (c.low < lvl.price && c.close >= lvl.price) {
        return this.buildSweepObject(c, lvl, c.low, closeTime);
      }
    }
    return null;
  }

  private static buildSweepObject(c: Candle, lvl: LiquidityLevel, extreme: number, closeTime: number): LiquiditySweep {
    return {
      id: `${lvl.symbol}:${lvl.timeframe}:SWEEP:${lvl.id}:${c.openTime}`,
      symbol: lvl.symbol,
      timeframe: lvl.timeframe,
      liquidityId: lvl.id,
      liquidityType: lvl.type,
      liquidityPrice: lvl.price,
      sweepExtreme: extreme,
      sweepCandleTime: c.openTime,
      confirmationTime: closeTime,
      sourceCandleTimes: [lvl.createdAt, c.openTime],
      sourceSwingIds: lvl.sourceSwingIds,
    };
  }
}
