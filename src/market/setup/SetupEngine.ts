import type { MtfStateEngine } from '../MtfStateEngine.js';
import type { MarketStructureEngine } from '../structure/MarketStructureEngine.js';
import type { SmcLocationEngine } from '../smc/SmcLocationEngine.js';
import type { SetupCandidate, SetupConfig } from './types.js';
import { DEFAULT_SETUP_CONFIG } from './ConfluenceScorer.js';
import { SetupStateMachine } from './SetupStateMachine.js';

export class SetupEngine {
  private mtfEngine: MtfStateEngine;
  private structureEngine: MarketStructureEngine;
  private smcEngine: SmcLocationEngine;
  private config: SetupConfig;

  constructor(
    mtfEngine: MtfStateEngine,
    structureEngine: MarketStructureEngine,
    smcEngine: SmcLocationEngine,
    config: SetupConfig = DEFAULT_SETUP_CONFIG
  ) {
    this.mtfEngine = mtfEngine;
    this.structureEngine = structureEngine;
    this.smcEngine = smcEngine;
    this.config = config;
  }

  getSetupsAsOf(symbol: string, asOfTimestamp = Date.now(), config = this.config): SetupCandidate[] {
    const mtf = this.mtfEngine.computeState(symbol, asOfTimestamp);
    const struct = this.structureEngine.computeMultiTimeframeStructure(symbol, asOfTimestamp);
    const smc = this.smcEngine.computeMultiTimeframeSmcContext(symbol, asOfTimestamp);

    const isDataHealthy = mtf.isFullySynchronized;
    const candidates: SetupCandidate[] = [];

    const longCand = this.evaluateLongSetup(symbol, asOfTimestamp, mtf, struct, smc, config, isDataHealthy);
    if (longCand) candidates.push(longCand);

    const shortCand = this.evaluateShortSetup(symbol, asOfTimestamp, mtf, struct, smc, config, isDataHealthy);
    if (shortCand) candidates.push(shortCand);

    return candidates;
  }

  getActiveSetups(symbol: string, asOfTimestamp = Date.now()): SetupCandidate[] {
    return this.getSetupsAsOf(symbol, asOfTimestamp).filter((s) => s.status === 'ACTIVE');
  }

  getReadySetups(symbol: string, asOfTimestamp = Date.now()): SetupCandidate[] {
    return this.getSetupsAsOf(symbol, asOfTimestamp).filter((s) => s.status === 'READY');
  }

  private evaluateLongSetup(
    symbol: string,
    asOf: number,
    mtf: ReturnType<MtfStateEngine['computeState']>,
    struct: ReturnType<MarketStructureEngine['computeMultiTimeframeStructure']>,
    smc: ReturnType<SmcLocationEngine['computeMultiTimeframeSmcContext']>,
    config: SetupConfig,
    isDataHealthy: boolean
  ): SetupCandidate | null {
    const struct15m = struct.timeframes['15m'];
    const smc15m = smc.timeframes['15m'];
    const smc5m = smc.timeframes['5m'];

    const sslSweep = smc15m.sweeps.find((s) => s.liquidityType === 'SSL' || s.liquidityType === 'EQUAL_LOW');
    const bullChoch = struct15m.events.find((e) => e.eventType === 'CHOCH_BULLISH');
    const bullBos = struct15m.events.find((e) => e.eventType === 'BOS_BULLISH');
    const bullFvg = smc15m.fairValueGaps.find((f) => f.type === 'BULLISH');
    const bullOb = smc15m.orderBlocks.find((o) => o.type === 'BULLISH');

    if (!sslSweep && !bullChoch && !bullBos && !bullFvg && !bullOb) return null;

    // Determine setup archetype: BOS = trend continuation, CHoCH = reversal.
    // A sweep with any structural break (BOS or CHoCH) is the strongest
    // reversal signal. A CHoCH without sweep is also a reversal entry.
    // A BOS without sweep is a continuation entry.
    let setupType: SetupCandidate['setupType'];
    if (sslSweep && (bullChoch || bullBos)) {
      setupType = 'SSL_SWEEP_REVERSAL_LONG';
    } else if (bullChoch) {
      setupType = 'BULLISH_CHOCH_RETEST_LONG';
    } else if (bullBos) {
      setupType = 'BULLISH_BOS_CONTINUATION_LONG';
    } else {
      // FVG or OB only, no structural event
      setupType = 'BULLISH_CHOCH_RETEST_LONG';
    }

    const ttlMs = config.maxCandleAgeBars * 900_000;
    const initial = SetupStateMachine.createWatchingCandidate({
      id: `${symbol}:LONG:${asOf}`,
      symbol,
      direction: 'LONG',
      setupType,
      timeframes: {
        regime4h: struct.timeframes['4h'].trend,
        bias1h: struct.timeframes['1h'].trend,
        structure15m: struct15m.trend,
        trigger5m: struct.timeframes['5m'].trend,
      },
      sweepEvidence: sslSweep,
      structureEvidence: bullChoch ?? bullBos,
      fvgEvidence: bullFvg,
      orderBlockEvidence: bullOb,
      retestEvidence: bullFvg?.status === 'MITIGATED' || bullFvg?.status === 'PARTIALLY_FILLED' || bullOb?.status === 'MITIGATED'
        ? { retestCandleTime: asOf, retestPrice: bullFvg?.lowerPrice ?? bullOb?.upperPrice ?? 0 }
        : undefined,
      triggerEvidence: struct.timeframes['5m'].trend === 'BULLISH' || smc5m.sweeps.length > 0
        ? { triggerCandleTime: asOf, triggerType: '5M_CONFIRMATION' }
        : undefined,
      sourceCandleTimes: [asOf],
      sourceEventIds: [bullChoch?.id, bullBos?.id, sslSweep?.id, bullFvg?.id, bullOb?.id].filter(Boolean) as string[],
    }, asOf, ttlMs);

    return SetupStateMachine.advanceState(initial, asOf, config, isDataHealthy);
  }

  private evaluateShortSetup(
    symbol: string,
    asOf: number,
    mtf: ReturnType<MtfStateEngine['computeState']>,
    struct: ReturnType<MarketStructureEngine['computeMultiTimeframeStructure']>,
    smc: ReturnType<SmcLocationEngine['computeMultiTimeframeSmcContext']>,
    config: SetupConfig,
    isDataHealthy: boolean
  ): SetupCandidate | null {
    const struct15m = struct.timeframes['15m'];
    const smc15m = smc.timeframes['15m'];
    const smc5m = smc.timeframes['5m'];

    const bslSweep = smc15m.sweeps.find((s) => s.liquidityType === 'BSL' || s.liquidityType === 'EQUAL_HIGH');
    const bearChoch = struct15m.events.find((e) => e.eventType === 'CHOCH_BEARISH');
    const bearBos = struct15m.events.find((e) => e.eventType === 'BOS_BEARISH');
    const bearFvg = smc15m.fairValueGaps.find((f) => f.type === 'BEARISH');
    const bearOb = smc15m.orderBlocks.find((o) => o.type === 'BEARISH');

    if (!bslSweep && !bearChoch && !bearBos && !bearFvg && !bearOb) return null;

    // Determine setup archetype: BOS = trend continuation, CHoCH = reversal.
    // A sweep with any structural break (BOS or CHoCH) is the strongest
    // reversal signal. A CHoCH without sweep is also a reversal entry.
    // A BOS without sweep is a continuation entry.
    let setupType: SetupCandidate['setupType'];
    if (bslSweep && (bearChoch || bearBos)) {
      setupType = 'BSL_SWEEP_REVERSAL_SHORT';
    } else if (bearChoch) {
      setupType = 'BEARISH_CHOCH_RETEST_SHORT';
    } else if (bearBos) {
      setupType = 'BEARISH_BOS_CONTINUATION_SHORT';
    } else {
      setupType = 'BEARISH_CHOCH_RETEST_SHORT';
    }

    const ttlMs = config.maxCandleAgeBars * 900_000;
    const initial = SetupStateMachine.createWatchingCandidate({
      id: `${symbol}:SHORT:${asOf}`,
      symbol,
      direction: 'SHORT',
      setupType,
      timeframes: {
        regime4h: struct.timeframes['4h'].trend,
        bias1h: struct.timeframes['1h'].trend,
        structure15m: struct15m.trend,
        trigger5m: struct.timeframes['5m'].trend,
      },
      sweepEvidence: bslSweep,
      structureEvidence: bearChoch ?? bearBos,
      fvgEvidence: bearFvg,
      orderBlockEvidence: bearOb,
      retestEvidence: bearFvg?.status === 'MITIGATED' || bearFvg?.status === 'PARTIALLY_FILLED' || bearOb?.status === 'MITIGATED'
        ? { retestCandleTime: asOf, retestPrice: bearFvg?.upperPrice ?? bearOb?.lowerPrice ?? 0 }
        : undefined,
      triggerEvidence: struct.timeframes['5m'].trend === 'BEARISH' || smc5m.sweeps.length > 0
        ? { triggerCandleTime: asOf, triggerType: '5M_CONFIRMATION' }
        : undefined,
      sourceCandleTimes: [asOf],
      sourceEventIds: [bearChoch?.id, bearBos?.id, bslSweep?.id, bearFvg?.id, bearOb?.id].filter(Boolean) as string[],
    }, asOf, ttlMs);

    return SetupStateMachine.advanceState(initial, asOf, config, isDataHealthy);
  }
}
