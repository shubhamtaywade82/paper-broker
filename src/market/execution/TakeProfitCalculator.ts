import type { Instrument } from '../../broker/types.js';
import type { SetupCandidate } from '../setup/types.js';
import type { MultiTimeframeSmcContext } from '../smc/types.js';
import type { MultiTimeframeStructureState } from '../structure/types.js';
import type { TakeProfitTarget } from './types.js';

export class TakeProfitCalculator {
  static calculateTakeProfits(
    candidate: SetupCandidate,
    entryPrice: number,
    riskDistance: number,
    structure: MultiTimeframeStructureState,
    smc: MultiTimeframeSmcContext,
    instrument?: Instrument
  ): TakeProfitTarget[] {
    const isLong = candidate.direction === 'LONG';
    const precision = instrument?.pricePrecision ?? 2;
    const candidates = isLong
      ? this.collectLongTargets(entryPrice, structure, smc)
      : this.collectShortTargets(entryPrice, structure, smc);

    return this.buildThreeTargets(isLong, entryPrice, riskDistance, candidates, precision);
  }

  private static collectLongTargets(
    entry: number,
    structure: MultiTimeframeStructureState,
    smc: MultiTimeframeSmcContext
  ): Array<{ price: number; reason: string; id?: string }> {
    const list: Array<{ price: number; reason: string; id?: string }> = [];

    for (const tf of ['15m', '1h', '4h'] as const) {
      const smcTf = smc.timeframes[tf];
      for (const l of smcTf?.liquidityLevels ?? []) {
        if ((l.type === 'BSL' || l.type === 'EQUAL_HIGH') && l.price > entry) {
          list.push({ price: l.price, reason: `${tf} ${l.type}`, id: l.id });
        }
      }
      const high = structure.timeframes[tf]?.lastConfirmedSwingHigh;
      if (high && high.price > entry) {
        list.push({ price: high.price, reason: `${tf} swing high`, id: high.id });
      }
    }
    return list.sort((a, b) => a.price - b.price);
  }

  private static collectShortTargets(
    entry: number,
    structure: MultiTimeframeStructureState,
    smc: MultiTimeframeSmcContext
  ): Array<{ price: number; reason: string; id?: string }> {
    const list: Array<{ price: number; reason: string; id?: string }> = [];

    for (const tf of ['15m', '1h', '4h'] as const) {
      const smcTf = smc.timeframes[tf];
      for (const l of smcTf?.liquidityLevels ?? []) {
        if ((l.type === 'SSL' || l.type === 'EQUAL_LOW') && l.price < entry) {
          list.push({ price: l.price, reason: `${tf} ${l.type}`, id: l.id });
        }
      }
      const low = structure.timeframes[tf]?.lastConfirmedSwingLow;
      if (low && low.price < entry) {
        list.push({ price: low.price, reason: `${tf} swing low`, id: low.id });
      }
    }
    return list.sort((a, b) => b.price - a.price);
  }

  private static buildThreeTargets(
    isLong: boolean,
    entry: number,
    risk: number,
    candidates: Array<{ price: number; reason: string; id?: string }>,
    precision: number
  ): TakeProfitTarget[] {
    const defaultMultipliers = [1.5, 2.5, 3.5];
    const targets: TakeProfitTarget[] = [];

    for (let i = 0; i < 3; i++) {
      const level = (i + 1) as 1 | 2 | 3;
      const cand = candidates[i];
      let price = cand?.price;
      let reason = cand?.reason;

      if (!price) {
        const mult = defaultMultipliers[i]!;
        price = isLong ? entry + risk * mult : entry - risk * mult;
        reason = `Synthetic ${mult}R projection`;
      }

      const rewardDist = Math.abs(price - entry);
      const rr = risk > 0 ? Number((rewardDist / risk).toFixed(2)) : 0;
      const roundedPrice = Number(price.toFixed(precision));

      targets.push({
        level,
        price: roundedPrice,
        riskReward: rr,
        rewardDistance: Number(rewardDist.toFixed(precision)),
        liquidityId: cand?.id,
        reason: reason ?? `TP${level}`,
      });
    }

    return targets;
  }
}
