import { describe, expect, it } from 'vitest';
import { EventDrivenMarketStateEngine, PositionStateMachine, TradingEventBus, candleClosedEvent } from '../../src/strategy/market-state/index.js';
import { buildMarketState, deriveTradeSetup, detectLiquiditySweeps, detectSwings } from '../../src/strategy/market-state/index.js';
import type { Candle } from '../../src/strategy/indicators.js';

function candle(i: number, open: number, high: number, low: number, close: number, volume = 100): Candle {
  return { symbol: 'SOLUSDT', interval: '15m', openTime: 1_700_000_000_000 + i * 900_000, open, high, low, close, volume };
}

describe('market-state engine', () => {
  it('detects sell-side and buy-side liquidity sweeps symmetrically', () => {
    const candles = [
      candle(0, 76, 77, 75, 76),
      candle(1, 76, 78, 75.5, 77),
      candle(2, 77, 77.5, 74.2, 75),
      candle(3, 75, 77, 75, 76),
      candle(4, 76, 76.8, 73.8, 74.5),
      candle(5, 74.5, 82.5, 74.4, 81),
      candle(6, 81, 80, 76, 77),
      candle(7, 77, 82.9, 76.8, 82.2),
      candle(8, 82.2, 81, 78, 79),
    ];
    const swings = detectSwings(candles, { pivotLeft: 1, pivotRight: 1, sweepLookback: 5 });
    const sweeps = detectLiquiditySweeps(candles, swings, { pivotLeft: 1, pivotRight: 1, sweepLookback: 5 });
    expect(sweeps.some((s) => s.side === 'SELL_SIDE')).toBe(true);
    expect(sweeps.some((s) => s.side === 'BUY_SIDE')).toBe(true);
  });

  it('builds a bullish long candidate from shared market-state primitives', () => {
    const candles = [
      candle(0, 74, 75, 73, 74, 100),
      candle(1, 74, 76, 73.5, 75, 100),
      candle(2, 75, 75.5, 72, 73, 100),
      candle(3, 73, 76.5, 72.8, 76, 100),
      candle(4, 76, 75.5, 74, 75, 100),
      candle(5, 75, 78, 74.5, 77.5, 100),
      candle(6, 77.5, 77, 75, 76, 100),
      candle(7, 76, 79, 75.8, 78.5, 100),
      candle(8, 78.5, 78.2, 76.2, 77, 100),
      candle(9, 77, 81, 76.8, 80.5, 100),
      candle(10, 80.5, 80, 78.5, 79, 100),
      candle(11, 79, 82, 78.8, 81.5, 100),
      candle(12, 81.5, 81, 79.8, 80.2, 100),
      candle(13, 80.2, 83, 80, 82.5, 100),
      candle(14, 82.5, 82, 81, 81.5, 100),
      candle(15, 81.5, 84, 81.2, 83.5, 100),
      candle(16, 83.5, 83, 82, 82.5, 100),
      candle(17, 82.5, 85, 82.3, 84.5, 100),
      candle(18, 84.5, 84, 83, 83.5, 100),
      candle(19, 83.5, 86, 83.2, 85.5, 100),
      candle(20, 85.5, 85.4, 83.7, 84.2, 100),
      candle(21, 84.2, 88.8, 84, 88.6, 600),
    ];
    const state = buildMarketState('SOLUSDT', '15m', candles, { openInterest: 'RISING', takerDelta: 'POSITIVE', funding: 'POSITIVE' }, { pivotLeft: 1, pivotRight: 1, sweepLookback: 20 });
    const setup = deriveTradeSetup(state);
    expect(state.regime).toBe('BULLISH');
    expect(state.displacement.bullish).toBe(true);
    expect(setup?.direction).toBe('LONG');
    expect(setup?.score).toBeGreaterThanOrEqual(75);
  });
});

describe('event-driven market-state pipeline', () => {
  it('emits market-state, setup, and entry-intent events from candle-close input', async () => {
    const bus = new TradingEventBus();
    const observed: string[] = [];
    bus.subscribeAll((event) => observed.push(event.type));
    const engine = new EventDrivenMarketStateEngine(
      bus,
      (symbol, timeframe, candles) => buildMarketState(symbol, timeframe, candles, { openInterest: 'RISING', takerDelta: 'POSITIVE' }, { pivotLeft: 1, pivotRight: 1, sweepLookback: 20 }),
      deriveTradeSetup
    );
    engine.start();

    const candles = [
      candle(0, 74, 75, 73, 74, 100),
      candle(1, 74, 76, 73.5, 75, 100),
      candle(2, 75, 75.5, 72, 73, 100),
      candle(3, 73, 76.5, 72.8, 76, 100),
      candle(4, 76, 75.5, 74, 75, 100),
      candle(5, 75, 78, 74.5, 77.5, 100),
      candle(6, 77.5, 77, 75, 76, 100),
      candle(7, 76, 79, 75.8, 78.5, 100),
      candle(8, 78.5, 78.2, 76.2, 77, 100),
      candle(9, 77, 81, 76.8, 80.5, 100),
      candle(10, 80.5, 80, 78.5, 79, 100),
      candle(11, 79, 82, 78.8, 81.5, 100),
      candle(12, 81.5, 81, 79.8, 80.2, 100),
      candle(13, 80.2, 83, 80, 82.5, 100),
      candle(14, 82.5, 82, 81, 81.5, 100),
      candle(15, 81.5, 84, 81.2, 83.5, 100),
      candle(16, 83.5, 83, 82, 82.5, 100),
      candle(17, 82.5, 85, 82.3, 84.5, 100),
      candle(18, 84.5, 84, 83, 83.5, 100),
      candle(19, 83.5, 86, 83.2, 85.5, 100),
      candle(20, 85.5, 85.4, 83.7, 84.2, 100),
      candle(21, 84.2, 88.8, 84, 88.6, 600),
    ];

    for (const item of candles) await bus.publish(candleClosedEvent(bus, item));

    expect(observed).toContain('REGIME_CHANGED');
    expect(observed).toContain('DISPLACEMENT');
    expect(observed).toContain('SETUP_CREATED');
    expect(observed).toContain('SETUP_ARMED');
    expect(observed).toContain('ENTRY_INTENT');
  });

  it('tracks explicit position lifecycle transitions from intents and fills', async () => {
    const bus = new TradingEventBus();
    const position = new PositionStateMachine(bus);
    const setup = deriveTradeSetup(buildMarketState('SOLUSDT', '15m', [
      candle(0, 74, 75, 73, 74), candle(1, 74, 76, 73.5, 75), candle(2, 75, 75.5, 72, 73), candle(3, 73, 78, 72.8, 77.5),
      candle(4, 77.5, 77, 75, 76), candle(5, 76, 79, 75.8, 78.5), candle(6, 78.5, 78, 77, 77.5), candle(7, 77.5, 80, 77, 79.5),
      candle(8, 79.5, 79, 78, 78.5), candle(9, 78.5, 82, 78, 81.5), candle(10, 81.5, 81, 80, 80.5), candle(11, 80.5, 83, 80, 82.5),
      candle(12, 82.5, 82, 81, 81.5), candle(13, 81.5, 84, 81, 83.5), candle(14, 83.5, 83, 82, 82.5), candle(15, 82.5, 86.5, 82, 86.2, 600),
    ], { openInterest: 'RISING', takerDelta: 'POSITIVE' }, { pivotLeft: 1, pivotRight: 1, sweepLookback: 20 }));

    expect(setup).toBeTruthy();
    await position.applyIntent({
      setupId: setup!.id,
      symbol: setup!.symbol,
      direction: setup!.direction,
      action: 'OPEN',
      reason: setup!.type,
      confidence: setup!.score / 100,
      evidence: setup!.evidence,
    });
    expect(position.getState('SOLUSDT')).toBe('PENDING_ENTRY');
    await position.applyFill('SOLUSDT', 'LONG');
    expect(position.getState('SOLUSDT')).toBe('LONG');
  });
});
