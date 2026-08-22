import type { Instrument } from '../../broker/types.js';
import type { SetupCandidate } from '../setup/types.js';

export class EntryCalculator {
  static calculateEntry(
    candidate: SetupCandidate,
    instrument?: Instrument
  ): { entryPrice: number; entryZone: { upper: number; lower: number } } | null {
    let upper = 0;
    let lower = 0;
    let price = 0;

    if (candidate.fvgEvidence) {
      upper = candidate.fvgEvidence.upperPrice;
      lower = candidate.fvgEvidence.lowerPrice;
      price = candidate.fvgEvidence.midpoint;
    } else if (candidate.orderBlockEvidence) {
      upper = candidate.orderBlockEvidence.upperPrice;
      lower = candidate.orderBlockEvidence.lowerPrice;
      price = (upper + lower) / 2;
    } else if (candidate.retestEvidence) {
      price = candidate.retestEvidence.retestPrice;
      upper = price;
      lower = price;
    } else {
      return null;
    }

    const precision = instrument?.pricePrecision ?? 2;
    const roundedPrice = Number(price.toFixed(precision));
    const roundedUpper = Number(upper.toFixed(precision));
    const roundedLower = Number(lower.toFixed(precision));

    return {
      entryPrice: roundedPrice,
      entryZone: { upper: roundedUpper, lower: roundedLower },
    };
  }
}
