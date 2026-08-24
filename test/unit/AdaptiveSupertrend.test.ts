import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
});
