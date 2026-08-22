import type { Instrument } from '../../broker/types.js';
import type { SetupCandidate } from '../setup/types.js';
import type { MultiTimeframeStructureState } from '../structure/types.js';

export class StopLossCalculator {
  static calculateStopLoss(
    candidate: SetupCandidate,
    structure: MultiTimeframeStructureState,
    instrument?: Instrument,
    tickBufferMultiplier = 2
  ): { stopLossPrice: number; stopLossReason: string } | null {
    const isLong = candidate.direction === 'LONG';
    const tickSize = instrument ? Number(instrument.tickSize) : 0.01;
    const precision = instrument?.pricePrecision ?? 2;
    const buffer = tickSize * tickBufferMultiplier;

    if (isLong) {
      return this.calculateLongStopLoss(candidate, structure, buffer, precision);
    }
    return this.calculateShortStopLoss(candidate, structure, buffer, precision);
  }

  private static calculateLongStopLoss(
    candidate: SetupCandidate,
    structure: MultiTimeframeStructureState,
    buffer: number,
    precision: number
  ): { stopLossPrice: number; stopLossReason: string } | null {
    const anchors: Array<{ price: number; reason: string }> = [];

    if (candidate.sweepEvidence) {
      anchors.push({ price: candidate.sweepEvidence.sweepExtreme, reason: 'SSL sweep extreme' });
    }
    if (candidate.orderBlockEvidence) {
      anchors.push({ price: candidate.orderBlockEvidence.invalidationPrice, reason: 'Bullish OB invalidation' });
    }
    const struct15m = structure.timeframes['15m'];
    if (struct15m?.lastConfirmedSwingLow) {
      anchors.push({ price: struct15m.lastConfirmedSwingLow.price, reason: '15m swing low' });
    }

    if (anchors.length === 0) return null;
    anchors.sort((a, b) => a.price - b.price);
    const chosen = anchors[0]!;
    const sl = Number((chosen.price - buffer).toFixed(precision));

    return {
      stopLossPrice: sl,
      stopLossReason: `${chosen.reason} (${chosen.price}) minus ${buffer.toFixed(precision)} buffer`,
    };
  }

  private static calculateShortStopLoss(
    candidate: SetupCandidate,
    structure: MultiTimeframeStructureState,
    buffer: number,
    precision: number
  ): { stopLossPrice: number; stopLossReason: string } | null {
    const anchors: Array<{ price: number; reason: string }> = [];

    if (candidate.sweepEvidence) {
      anchors.push({ price: candidate.sweepEvidence.sweepExtreme, reason: 'BSL sweep extreme' });
    }
    if (candidate.orderBlockEvidence) {
      anchors.push({ price: candidate.orderBlockEvidence.invalidationPrice, reason: 'Bearish OB invalidation' });
    }
    const struct15m = structure.timeframes['15m'];
    if (struct15m?.lastConfirmedSwingHigh) {
      anchors.push({ price: struct15m.lastConfirmedSwingHigh.price, reason: '15m swing high' });
    }

    if (anchors.length === 0) return null;
    anchors.sort((a, b) => b.price - a.price);
    const chosen = anchors[0]!;
    const sl = Number((chosen.price + buffer).toFixed(precision));

    return {
      stopLossPrice: sl,
      stopLossReason: `${chosen.reason} (${chosen.price}) plus ${buffer.toFixed(precision)} buffer`,
    };
  }
}
