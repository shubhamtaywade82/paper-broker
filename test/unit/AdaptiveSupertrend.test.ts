import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  adx,
  bollingerBands,
  macd,
  supertrend,
  type Candle,
} from '../../src/strategy/indicators.js';
import {
  extractMarketFeatures,
  formatRegimeKey,
  AdaptiveParameterAI,
  calculateAdaptiveSupertrend,
  FuzzySignalAI,
} from '../../src/strategy/adaptive-supertrend/index.js';
import { createAdaptiveSupertrendStrategy } from '../../src/strategy/strategies/adaptive-supertrend.js';
import { createStrategyContext } from '../../src/strategy/StrategyContext.js';
import { KlineStore } from '../../src/market/Klines.js';
import type { Position } from '../../src/broker/types.js';

function createMockCandles(count: number, basePrice = 100, trend = 0.5): Candle[] {
  const candles: Candle[] = [];
  let price = basePrice;

  for (let i = 0; i < count; i++) {
    const open = price;
    const high = open + 2 + Math.sin(i / 5) * 1.5;
    const low = open - 2 - Math.cos(i / 5) * 1.5;
    const close = open + trend + (Math.sin(i / 3) * 1.2);
    const volume = 1000 + Math.abs(Math.sin(i)) * 500;

    candles.push({
      symbol: 'BTCUSDT',
      interval: '15m',
      openTime: 1700000000000 + i * 900_000,
      open,
      high: Math.max(open, high, close),
      low: Math.min(open, low, close),
      close,
      volume,
    });
    price = close;
  }
  return candles;
}

describe('Technical Indicators Suite', () => {
  const candles = createMockCandles(60, 100, 1.0);
  const closes = candles.map((c) => c.close);

  it('calculates Bollinger Bands correctly', () => {
    const bb = bollingerBands(closes, 20, 2);
    expect(bb.middle.length).toBe(closes.length);
    expect(bb.upper.length).toBe(closes.length);
    expect(bb.lower.length).toBe(closes.length);

    const lastIdx = closes.length - 1;
    expect(bb.upper[lastIdx]).toBeGreaterThan(bb.middle[lastIdx]!);
    expect(bb.middle[lastIdx]).toBeGreaterThan(bb.lower[lastIdx]!);
    expect(bb.bandWidth[lastIdx]).toBeGreaterThan(0);
  });

  it('calculates MACD correctly', () => {
    const res = macd(closes, 12, 26, 9);
    expect(res.macd.length).toBe(closes.length);
    expect(res.signal.length).toBe(closes.length);
    expect(res.histogram.length).toBe(closes.length);
    const lastIdx = closes.length - 1;
    expect(typeof res.histogram[lastIdx]).toBe('number');
    expect(Number.isNaN(res.histogram[lastIdx])).toBe(false);
  });

  it('H-19: masks MACD warm-up bars with NaN instead of returning misleading seeded values', () => {
    const res = macd(closes, 12, 26, 9); // slowPeriod=26, signalPeriod=9

    // macdLine needs slowPeriod bars before it's not dominated by ema()'s
    // seed-from-values[0] behavior.
    expect(Number.isNaN(res.macd[0])).toBe(true);
    expect(Number.isNaN(res.macd[24])).toBe(true); // index slowPeriod-2
    expect(Number.isNaN(res.macd[25])).toBe(false); // index slowPeriod-1: valid

    // signal/histogram need signalPeriod MORE bars on top of that.
    expect(Number.isNaN(res.signal[32])).toBe(true); // index slowPeriod-1+signalPeriod-2
    expect(Number.isNaN(res.signal[33])).toBe(false); // index slowPeriod-1+signalPeriod-1: valid
    expect(Number.isNaN(res.histogram[32])).toBe(true);
    expect(Number.isNaN(res.histogram[33])).toBe(false);
  });

  it('calculates ADX correctly', () => {
    const res = adx(candles, 14);
    expect(res.adx.length).toBe(candles.length);
    expect(res.plusDI.length).toBe(candles.length);
    expect(res.minusDI.length).toBe(candles.length);
    const lastIdx = candles.length - 1;
    expect(res.adx[lastIdx]).toBeGreaterThanOrEqual(0);
  });

  it('calculates Supertrend correctly', () => {
    const res = supertrend(candles, 10, 3);
    expect(res.supertrend.length).toBe(candles.length);
    expect(res.direction.length).toBe(candles.length);
    const lastIdx = candles.length - 1;
    expect([1, -1]).toContain(res.direction[lastIdx]);
  });

  it('H-20: Supertrend direction is NaN (not a placeholder 1) during warm-up', () => {
    const res = supertrend(candles, 10, 3);
    // Indices before atrPeriod are never computed by the loop — they must
    // read as "not yet valid", not as a placeholder "uptrend" that a
    // crossover check could compare against as if it were real.
    for (let i = 0; i < 10; i++) {
      expect(Number.isNaN(res.direction[i])).toBe(true);
    }
    expect(Number.isNaN(res.direction[10])).toBe(false);
  });

  it('H-20: calculateAdaptiveSupertrend does not report a false crossover on the very first computed bar', () => {
    const atrPeriod = 5;
    // atrPeriod + 1 candles -> exactly one bar (index atrPeriod) is ever
    // actually computed by the loop; index atrPeriod-1 is still warm-up.
    const candles: Candle[] = Array.from({ length: atrPeriod + 1 }, (_, i) => ({
      symbol: 'BTCUSDT', interval: '15m', openTime: i * 900_000,
      open: 100, high: 101, low: 99, close: 100, volume: 100,
    }));

    const result = calculateAdaptiveSupertrend(candles, { atrPeriod, multiplier: 3 });

    // With only one real bar there is nothing to compare against — this
    // must never report a crossover, regardless of which direction that
    // one bar resolves to (previously: comparing it against the
    // uninitialized placeholder default of 1 could false-positive).
    expect(result.isCrossover).toBe(false);
  });

  it('H-20: calculateAdaptiveSupertrend still detects a genuine crossover once two real bars exist', () => {
    const atrPeriod = 5;
    const candles: Candle[] = Array.from({ length: atrPeriod + 1 }, (_, i) => ({
      symbol: 'BTCUSDT', interval: '15m', openTime: i * 900_000,
      open: 100, high: 101, low: 99, close: 100, volume: 100,
    }));
    // A sharp crash flips direction bullish -> bearish on the second
    // computed bar.
    candles.push({
      symbol: 'BTCUSDT', interval: '15m', openTime: (atrPeriod + 1) * 900_000,
      open: 100, high: 101, low: 40, close: 42, volume: 100,
    });

    const result = calculateAdaptiveSupertrend(candles, { atrPeriod, multiplier: 3 });

    expect(result.direction[atrPeriod]).toBe(1);
    expect(result.direction[atrPeriod + 1]).toBe(-1);
    expect(result.isCrossover).toBe(true);
  });
});

describe('AI-Based Adaptive Supertrend Module', () => {
  const testMemoryFile = path.resolve(process.cwd(), 'data/test_qtable.json');

  beforeEach(() => {
    if (fs.existsSync(testMemoryFile)) {
      fs.unlinkSync(testMemoryFile);
    }
  });

  afterEach(() => {
    if (fs.existsSync(testMemoryFile)) {
      fs.unlinkSync(testMemoryFile);
    }
  });

  it('extracts market features and formats regime key', () => {
    const candles = createMockCandles(50, 100, 0.5);
    const features = extractMarketFeatures(candles);
    expect(features).not.toBeNull();
    if (features) {
      expect(['low', 'medium', 'high']).toContain(features.volatility);
      expect(['weak', 'medium', 'strong']).toContain(features.trendStrength);
      expect(['oversold', 'neutral', 'overbought']).toContain(features.momentum);
      const key = formatRegimeKey(features);
      expect(typeof key).toBe('string');
      expect(key.split('_').length).toBe(3);
    }
  });

  it('AdaptiveParameterAI chooses actions and learns with persistence', () => {
    const ai = new AdaptiveParameterAI({
      epsilon: 0, // Exploit mode for deterministic testing
      persistencePath: testMemoryFile,
    });

    const candles = createMockCandles(50, 100, 1.0);
    const features = extractMarketFeatures(candles)!;
    const { params, state, actionIndex } = ai.chooseAction(features);

    expect(params.atrPeriod).toBeGreaterThan(0);
    expect(params.multiplier).toBeGreaterThan(0);

    // Perform learning update
    ai.learn(state, actionIndex, 1.0);
    expect(fs.existsSync(testMemoryFile)).toBe(true);

    // Reload in new instance
    const reloadedAI = new AdaptiveParameterAI({
      persistencePath: testMemoryFile,
    });
    expect(reloadedAI.getLearnedStatesCount()).toBeGreaterThan(0);
  });

  it('C-08: bootstraps the Bellman update from the next state, not the state being updated', () => {
    // Two distinct, pre-seeded regimes with very different Q-values, so the
    // choice of bootstrap source is observable in the result. Both builds
    // start from the identical (state, action, reward) triple; only the
    // `nextState` argument to the final learn() call differs.
    const lowValueState = 'low_weak_neutral';
    const highValueState = 'high_strong_overbought';
    const targetReward = 0.2;

    function buildDivergedTable(): AdaptiveParameterAI {
      const ai = new AdaptiveParameterAI({ epsilon: 0 });
      ai.learn(lowValueState, 0, 0);
      for (let i = 0; i < 5; i++) ai.learn(lowValueState, 0, -1); // drives low state's action-0 value down
      ai.learn(highValueState, 0, 0);
      for (let i = 0; i < 5; i++) ai.learn(highValueState, 1, 1); // drives high state's action-1 value up
      return ai;
    }

    const bootstrapFromLowState = buildDivergedTable();
    bootstrapFromLowState.learn(lowValueState, 1, targetReward, lowValueState);

    const bootstrapFromHighState = buildDivergedTable();
    bootstrapFromHighState.learn(lowValueState, 1, targetReward, highValueState);

    // Bootstrapping off the high-value state must yield a strictly larger
    // updated Q-value than bootstrapping off the (still-low) same state, for
    // an identical (state, action, reward) triple — proving the fix actually
    // consults the passed-in nextState rather than the state being updated.
    const qLow = bootstrapFromLowState['qTable' as never] as unknown as Map<string, number[]>;
    const qHigh = bootstrapFromHighState['qTable' as never] as unknown as Map<string, number[]>;
    const valueWithLowBootstrap = qLow.get(lowValueState)![1]!;
    const valueWithHighBootstrap = qHigh.get(lowValueState)![1]!;
    expect(valueWithHighBootstrap).toBeGreaterThan(valueWithLowBootstrap);
  });

  it('C-08: omitting nextState does not bootstrap off the state being updated (no self-reuse bug)', () => {
    const state = 'medium_medium_neutral';
    const ai = new AdaptiveParameterAI({ epsilon: 0 });
    // Push action 1's value high so, under the old buggy behavior, updating
    // action 0 in the SAME state (with no explicit nextState) would bootstrap
    // off that high value via Math.max(...qValues) over the current state's
    // own array.
    ai.learn(state, 1, 0);
    for (let i = 0; i < 10; i++) ai.learn(state, 1, 1);

    // Update action 0 with reward 0 and no nextState — correct behavior:
    // future-value term is 0, so the result should trend toward 0, not get
    // pulled up toward action 1's high value.
    ai.learn(state, 0, 0);
    const qTable = ai['qTable' as never] as unknown as Map<string, number[]>;
    const action0Value = qTable.get(state)![0]!;
    expect(action0Value).toBeLessThan(0.3);
  });

  it('calculateAdaptiveSupertrend computes dynamic bands & crossover', () => {
    const candles = createMockCandles(50, 100, 2.0);
    const res = calculateAdaptiveSupertrend(candles, { atrPeriod: 10, multiplier: 2.0 });
    expect(res.supertrend.length).toBe(50);
    expect(res.direction.length).toBe(50);
    expect(typeof res.isCrossover).toBe('boolean');
  });

  it('FuzzySignalAI generates probabilistic signals with dynamic stop/target', () => {
    const signalAI = new FuzzySignalAI();
    const candles = createMockCandles(50, 100, 1.5);
    const features = extractMarketFeatures(candles)!;

    const signal = signalAI.generateSignal({
      stDirection: 1,
      isCrossover: true,
      features,
      params: { atrPeriod: 10, multiplier: 2.0 },
      currentPrice: 150,
      supertrendValue: 145,
      minConfidence: 0.2, // Lower threshold for unit testing confluence
    });

    expect(['OPEN_LONG', 'OPEN_SHORT', 'HOLD']).toContain(signal.action);
    expect(signal.confidence).toBeGreaterThanOrEqual(0);
    expect(signal.confidence).toBeLessThanOrEqual(1);
    if (signal.action === 'OPEN_LONG') {
      expect(signal.stopLossPrice).toBeLessThan(150);
      expect(signal.takeProfitPrice).toBeGreaterThan(150);
    }
  });
});

describe('Adaptive Supertrend Strategy Integration', () => {
  it('evaluates candle and generates pre-sized SignalInput', () => {
    const klines = new KlineStore(500);
    const mockCandles = createMockCandles(60, 100, 2.0);
    for (const c of mockCandles) {
      klines.upsertCandle(c);
    }

    const strategy = createAdaptiveSupertrendStrategy({
      getInstrument: () => ({
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        pricePrecision: 2,
        quantityPrecision: 3,
        tickSize: 0.01,
        stepSize: 0.001,
        minQuantity: 0.001,
        maxQuantity: 100,
        minNotional: 5,
        defaultLeverage: 10,
        maxLeverage: 50,
        maintenanceMarginRate: 0.01,
        makerFeeRate: 0.0002,
        takerFeeRate: 0.0005,
      }),
      minConfidence: 0.1, // test threshold
    });

    const ctx = createStrategyContext(
      'adaptive-supertrend-v1',
      () => ({
        symbol: 'BTCUSDT',
        bid: 199.9,
        ask: 200.1,
        last: 200.0,
        mark: 200.0,
        index: 200.0,
        fundingRate: 0.0001,
        nextFundingTime: Date.now() + 3600000,
        volume24h: 100000,
        quoteVolume24h: 20000000,
        high24h: 210,
        low24h: 190,
        priceChangePercent24h: 5.0,
        updatedAt: Date.now(),
      }),
      klines,
      () => ({
        accountId: 'paper-main',
        walletBalance: 10000,
        availableBalance: 9000,
        marginBalance: 10000,
        unrealizedPnl: 0,
        equity: 10000,
        marginUsed: 1000,
        freeMargin: 9000,
        marginLevel: 10,
        leverage: 10,
        updatedAt: Date.now(),
      }),
      () => undefined,
      () => [],
      () => ({} as any)
    );

    const lastCandle = mockCandles[mockCandles.length - 1]!;
    const signal = strategy.onCandleClose!(ctx, lastCandle);

    expect(signal).not.toBeNull();
    if (signal) {
      expect(signal.strategyId).toBe('adaptive-supertrend-v1');
      expect(signal.symbol).toBe('BTCUSDT');
      expect(['OPEN_LONG', 'OPEN_SHORT']).toContain(signal.action);
      expect(signal.features?.quantity).toBeGreaterThan(0);
      expect(signal.features?.leverage).toBe(5);
    }
  });

  it('C-08: settles the pending decision with the real realized outcome once the position closes, not a hardcoded reward', () => {
    const klines = new KlineStore(500);
    const mockCandles = createMockCandles(60, 100, 2.0);
    for (const c of mockCandles) klines.upsertCandle(c);

    const learnSpy = vi.spyOn(AdaptiveParameterAI.prototype, 'learn');

    const strategy = createAdaptiveSupertrendStrategy({
      getInstrument: () => ({
        symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT',
        pricePrecision: 2, quantityPrecision: 3, tickSize: 0.01, stepSize: 0.001,
        minQuantity: 0.001, maxQuantity: 100, minNotional: 5, defaultLeverage: 10,
        maxLeverage: 50, maintenanceMarginRate: 0.01, makerFeeRate: 0.0002, takerFeeRate: 0.0005,
      } as any),
      minConfidence: 0.1,
    });

    let currentPosition: Position | undefined = undefined;
    const ctx = createStrategyContext(
      'adaptive-supertrend-v1',
      () => ({
        symbol: 'BTCUSDT', bid: 199.9, ask: 200.1, last: 200.0, mark: 200.0,
        localTsUtc: Date.now(), stale: false,
      }),
      klines,
      () => ({
        walletBalance: 10000, unrealizedPnl: 0, equity: 10000, initialMargin: 0,
        maintenanceMargin: 0, availableBalance: 10000, totalFees: 0, totalFunding: 0,
        totalRealizedPnl: 0, openPositionsCount: 0, openOrdersCount: 0, dailyRealizedPnl: 0,
      } as any),
      () => currentPosition,
      () => [],
      () => ({} as any)
    );

    const lastCandle = mockCandles[mockCandles.length - 1]!;
    const openSignal = strategy.onCandleClose!(ctx, lastCandle) as ReturnType<NonNullable<typeof strategy.onCandleClose>>;
    expect(openSignal).not.toBeNull();
    // No outcome is known yet at entry — learn() must not fire until settlement.
    expect(learnSpy).not.toHaveBeenCalled();

    // Position is now open; further candles must not settle until it's flat.
    currentPosition = { qty: 1 } as Position;
    strategy.onCandleClose!(ctx, { ...lastCandle, close: lastCandle.close + 50 });
    expect(learnSpy).not.toHaveBeenCalled();

    // Position closes favorably in whichever direction was actually opened.
    currentPosition = undefined;
    const action = (openSignal as { action: string }).action;
    const winningClose = action === 'OPEN_LONG' ? lastCandle.close + 20 : lastCandle.close - 20;
    strategy.onCandleClose!(ctx, { ...lastCandle, close: winningClose });

    expect(learnSpy).toHaveBeenCalledTimes(1);
    const [state, actionIndex, reward, nextState] = learnSpy.mock.calls[0]!;
    expect(typeof state).toBe('string');
    expect(typeof actionIndex).toBe('number');
    // A winning trade must produce a positive reward derived from the actual
    // price move — not the old hardcoded 0.5 regardless of outcome.
    expect(reward).toBeGreaterThan(0);
    expect(typeof nextState).toBe('string');
    expect(nextState).not.toBe('');

    learnSpy.mockRestore();
  });
});
