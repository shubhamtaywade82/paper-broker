import { describe, it, expect } from 'vitest';
import { LiquidityMapEngine } from '../../src/market/liquidity/LiquidityMapEngine.js';
import { ZoneAggregationEngine } from '../../src/analysis/ZoneAggregationEngine.js';
import { MarketLocationEngine } from '../../src/analysis/MarketLocationEngine.js';
import type { MultiTimeframeSmcContext, SmcTimeframeContext, LiquidityLevel, LiquiditySweep, FairValueGap, OrderBlock } from '../../src/market/smc/types.js';
import type { MultiTimeframeStructureState, TimeframeStructureState } from '../../src/market/structure/types.js';
import type { AnalysisTimeframe } from '../../src/market/MtfStateEngine.js';
import type { ConfluenceZone } from '../../src/analysis/types.js';

const T0 = 1_700_000_000_000;

function makeLevel(overrides: Partial<LiquidityLevel>): LiquidityLevel {
  return {
    id: overrides.id ?? 'L1',
    symbol: 'SOLUSDT',
    timeframe: '1h',
    type: 'BSL',
    price: 100,
    sourceSwingIds: ['s1'],
    sourceCandleTimes: [T0],
    createdAt: T0,
    confirmedAt: T0 + 1000,
    status: 'ACTIVE',
    ...overrides,
  };
}

function makeSweep(overrides: Partial<LiquiditySweep>): LiquiditySweep {
  return {
    id: overrides.id ?? 'SW1',
    symbol: 'SOLUSDT',
    timeframe: '15m',
    liquidityId: 'L1',
    liquidityType: 'SSL',
    liquidityPrice: 95,
    sweepExtreme: 94.5,
    sweepCandleTime: T0,
    confirmationTime: T0 + 900_000,
    sourceCandleTimes: [T0],
    sourceSwingIds: ['s1'],
    ...overrides,
  };
}

function emptyTfCtx(tf: AnalysisTimeframe): SmcTimeframeContext {
  return {
    timeframe: tf,
    liquidityLevels: [],
    sweeps: [],
    fairValueGaps: [],
    orderBlocks: [],
    activeLiquidity: [],
    activeFvgs: [],
    activeOrderBlocks: [],
  };
}

function makeSmcContext(timeframes: Partial<Record<AnalysisTimeframe, Partial<SmcTimeframeContext>>>): MultiTimeframeSmcContext {
  const full: Partial<Record<AnalysisTimeframe, SmcTimeframeContext>> = {};
  const all: AnalysisTimeframe[] = ['4h', '2h', '1h', '15m', '5m'];
  for (const tf of all) {
    full[tf] = { ...emptyTfCtx(tf), ...(timeframes[tf] ?? {}) };
  }
  return {
    symbol: 'SOLUSDT',
    asOfTimestamp: T0 + 3_600_000,
    timeframes: full as Record<AnalysisTimeframe, SmcTimeframeContext>,
  };
}

// ---------------------------------------------------------------------------
// LiquidityMapEngine
// ---------------------------------------------------------------------------

describe('LiquidityMapEngine', () => {
  const engine = new LiquidityMapEngine();

  it('splits pools into buy-side above / sell-side below the current price', () => {
    const smc = makeSmcContext({
      '4h': {
        liquidityLevels: [
          makeLevel({ id: 'BSL4H', timeframe: '4h', type: 'BSL', price: 105 }),
          makeLevel({ id: 'SSL4H', timeframe: '4h', type: 'SSL', price: 95 }),
        ],
      },
      '1h': {
        liquidityLevels: [
          makeLevel({ id: 'SSL1H', timeframe: '1h', type: 'SSL', price: 100 }),
        ],
      },
    });

    const map = engine.buildLiquidityMap(smc, 102, T0 + 3_600_000, { high: 104, low: 96 });

    expect(map.buySide.map((p) => p.price)).toEqual([105]);
    expect(map.sellSide.map((p) => p.price)).toEqual([100, 95]); // nearest first
    expect(map.nearestAbove?.price).toBe(105);
    expect(map.nearestBelow?.price).toBe(100);
  });

  it('merges clustered pools across timeframes into one stronger pool', () => {
    const smc = makeSmcContext({
      '4h': {
        liquidityLevels: [
          makeLevel({ id: 'BSL4H', timeframe: '4h', type: 'BSL', price: 105.0 }),
        ],
      },
      '1h': {
        liquidityLevels: [
          // 0.01 apart on 105 → well inside the 0.08% cluster tolerance.
          makeLevel({ id: 'EQH1H', timeframe: '1h', type: 'EQUAL_HIGH', price: 105.01 }),
        ],
      },
    });

    const map = engine.buildLiquidityMap(smc, 102, T0 + 3_600_000, { high: 104, low: 96 });

    const above = map.buySide.filter((p) => p.price > 104);
    expect(above).toHaveLength(1);
    // Cluster strength = max member + convergence bonus, capped, HTF-dominant.
    expect(above[0]!.strength).toBeGreaterThanOrEqual(60);
  });

  it('classifies pools beyond the dealing range as external, inside as internal', () => {
    const smc = makeSmcContext({
      '4h': {
        liquidityLevels: [
          makeLevel({ id: 'EXT_ABOVE', price: 105.5 }), // > range.high 104
          makeLevel({ id: 'EXT_BELOW', type: 'SSL', price: 94 }), // < range.low 96
          makeLevel({ id: 'INT_MID', type: 'SSL', price: 99 }),
        ],
      },
    });

    const map = engine.buildLiquidityMap(smc, 102, T0 + 3_600_000, { high: 104, low: 96 });

    expect(map.externalLiquidity.map((p) => p.id).sort()).toEqual(['EXT_ABOVE', 'EXT_BELOW']);
    expect(map.internalLiquidity.map((p) => p.id)).toContain('INT_MID');
  });

  it('only reports sweeps inside the recency window, newest first', () => {
    const now = T0 + 3_600_000;
    const smc = makeSmcContext({
      '15m': {
        sweeps: [
          makeSweep({ id: 'OLD', liquidityId: 'L_OLD', confirmationTime: now - 10 * 3_600_000, liquidityPrice: 90 }),
          makeSweep({ id: 'FRESH2', liquidityId: 'L_F2', confirmationTime: now - 30 * 60_000, liquidityPrice: 99 }),
          makeSweep({ id: 'FRESH1', liquidityId: 'L_F1', confirmationTime: now - 10 * 60_000, liquidityPrice: 98 }),
        ],
      },
    });

    const map = engine.buildLiquidityMap(smc, 102, now, { high: 104, low: 96 });

    expect(map.recentlySwept.map((s) => s.poolId)).toEqual(['L_F1', 'L_F2']);
  });
});

// ---------------------------------------------------------------------------
// ZoneAggregationEngine
// ---------------------------------------------------------------------------

describe('ZoneAggregationEngine', () => {
  const engine = new ZoneAggregationEngine();

  function makeFvg(overrides: Partial<FairValueGap>): FairValueGap {
    return {
      id: 'FVG1',
      symbol: 'SOLUSDT',
      timeframe: '15m',
      type: 'BULLISH',
      upperPrice: 102.76,
      lowerPrice: 102.68,
      midpoint: 102.72,
      sourceCandleTimes: [T0, T0, T0],
      createdAt: T0,
      confirmedAt: T0 + 900_000,
      status: 'ACTIVE',
      ...overrides,
    };
  }

  function makeOb(overrides: Partial<OrderBlock>): OrderBlock {
    return {
      id: 'OB1',
      symbol: 'SOLUSDT',
      timeframe: '15m',
      type: 'BULLISH',
      upperPrice: 102.79,
      lowerPrice: 102.7,
      invalidationPrice: 102.7,
      originCandleTime: T0,
      displacementCandleTime: T0 + 900_000,
      confirmedStructureEventId: 'E1',
      sourceCandleTimes: [T0],
      createdAt: T0,
      confirmedAt: T0 + 900_000,
      status: 'ACTIVE',
      ...overrides,
    };
  }

  it('merges overlapping bullish FVG + OB into one confluence demand zone', () => {
    const smc = makeSmcContext({
      '15m': {
        fairValueGaps: [makeFvg({})],
        orderBlocks: [makeOb({})],
      },
    });

    const zones = engine.aggregateZones(smc, T0 + 3_600_000);

    // Both members overlap → exactly one zone on the 102.6x-102.8x area.
    const demand = zones.filter((z) => z.low >= 102.5 && z.high <= 103);
    expect(demand).toHaveLength(1);

    const merged = demand[0] as ConfluenceZone;
    expect(merged.low).toBeCloseTo(102.68, 2);
    expect(merged.high).toBeCloseTo(102.79, 2);
    expect(merged.direction).toBe('BULLISH');
    expect(merged.types.sort()).toEqual(['FVG', 'ORDER_BLOCK'].sort());
    expect(merged.timeframes).toEqual(['15m']);
    // Confluence must outrank either single member's strength.
    expect(merged.strength).toBeGreaterThan(60);
    expect(merged.touches).toBe(2);
  });

  it('keeps distant non-overlapping zones separate and sorts by strength', () => {
    const smc = makeSmcContext({
      '15m': {
        fairValueGaps: [makeFvg({})],
      },
      '4h': {
        fairValueGaps: [
          makeFvg({ id: 'FVG4H', timeframe: '4h', type: 'BEARISH', lowerPrice: 109, upperPrice: 111, midpoint: 110 }),
        ],
      },
    });

    const zones = engine.aggregateZones(smc, T0 + 3_600_000);

    expect(zones).toHaveLength(2);
    // Supply zone on 4h carries the higher TF weight → stronger.
    expect(zones[0]!.direction).toBe('BEARISH');
    expect(zones[0]!.dominantTimeframe).toBe('4h');
    expect(zones[0]!.strength).toBeGreaterThan(zones[1]!.strength);
  });

  it('maps invalidated FVGs to BROKEN and discounted strength', () => {
    const smc = makeSmcContext({
      '15m': {
        fairValueGaps: [
          makeFvg({ id: 'FVG_DEAD', status: 'INVALIDATED' }),
        ],
      },
    });

    const zones = engine.aggregateZones(smc, T0 + 3_600_000);
    expect(zones).toHaveLength(1);
    expect(zones[0]!.status).toBe('BROKEN');
  });

  it('produces identical output for identical input (determinism)', () => {
    const smc = makeSmcContext({
      '15m': { fairValueGaps: [makeFvg({})], orderBlocks: [makeOb({})] },
    });

    const a = engine.aggregateZones(smc, T0 + 3_600_000);
    const b = engine.aggregateZones(smc, T0 + 3_600_000);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// MarketLocationEngine
// ---------------------------------------------------------------------------

describe('MarketLocationEngine', () => {
  const engine = new MarketLocationEngine();

  function makeStructure(swingHigh?: number, swingLow?: number, tf: AnalysisTimeframe = '4h'): MultiTimeframeStructureState {
    const tfState = (t: AnalysisTimeframe): TimeframeStructureState => ({
      timeframe: t,
      scope: 'EXTERNAL',
      trend: 'UNKNOWN',
      structure: 'UNKNOWN',
      swings: [],
      events: [],
      lastConfirmedSwingHigh: swingHigh !== undefined && t === tf ? { id: 'SH', symbol: 'SOLUSDT', timeframe: t, scope: 'EXTERNAL', type: 'HIGH', classification: 'HH', price: swingHigh, pivotTime: T0, confirmationTime: T0, candleIndex: 0 } : undefined,
      lastConfirmedSwingLow: swingLow !== undefined && t === tf ? { id: 'SL', symbol: 'SOLUSDT', timeframe: t, scope: 'EXTERNAL', type: 'LOW', classification: 'HL', price: swingLow, pivotTime: T0, confirmationTime: T0, candleIndex: 0 } : undefined,
    });
    const all: AnalysisTimeframe[] = ['4h', '2h', '1h', '15m', '5m'];
    const record: Partial<Record<AnalysisTimeframe, TimeframeStructureState>> = {};
    for (const t of all) record[t] = tfState(t);
    return {
      symbol: 'SOLUSDT',
      asOfTimestamp: T0,
      timeframes: record as Record<AnalysisTimeframe, TimeframeStructureState>,
    };
  }

  const zones: ConfluenceZone[] = [
    {
      id: 'Z1', sourceZoneIds: [], direction: 'BULLISH', low: 91, high: 93, midpoint: 92,
      dominantTimeframe: '1h', timeframes: ['1h'], types: ['FVG'], strength: 80, status: 'ACTIVE',
      touches: 1, createdAt: T0, lastConfirmedAt: T0,
    },
  ];

  it('classifies deep discount / discount / equilibrium / premium / deep premium', () => {
    const structure = makeStructure(110, 90);

    const cases: Array<[number, string]> = [
      [91.5, 'DEEP_DISCOUNT'], // 7.5% of range
      [95.5, 'DISCOUNT'],      // 27.5%
      [100.2, 'EQUILIBRIUM'],  // ~51%
      [105, 'PREMIUM'],        // 75% — the premium/deep-premium boundary
      [108.8, 'DEEP_PREMIUM'], // 94%
    ];

    for (const [price, expected] of cases) {
      const loc = engine.computeLocation(structure, [], null, price);
      expect(loc.position).toBe(expected);
    }
  });

  it('derives the range from 4h swings and reports equilibrium', () => {
    const structure = makeStructure(110, 90);
    const loc = engine.computeLocation(structure, zones, null, 100);

    expect(loc.range.high).toBe(110);
    expect(loc.range.low).toBe(90);
    expect(loc.range.equilibrium).toBe(100);
    expect(loc.range.timeframe).toBe('4h');
  });

  it('finds nearby zones around the current price', () => {
    const structure = makeStructure(110, 90);
    const loc = engine.computeLocation(structure, zones, null, 92);

    expect(loc.nearbyZones).toHaveLength(1);
    expect(loc.nearbyZones[0]!.id).toBe('Z1');
  });

  it('falls back to a synthetic range when no swings exist', () => {
    const structure = makeStructure(undefined, undefined);
    const loc = engine.computeLocation(structure, [], null, 100);

    expect(loc.range.timeframe).toBe('15m');
    expect(loc.range.high).toBeGreaterThan(100);
    expect(loc.range.low).toBeLessThan(100);
  });

  it('reports liquidity distances from the map', () => {
    const structure = makeStructure(110, 90);
    const loc = engine.computeLocation(
      structure,
      [],
      {
        buySide: [], sellSide: [],
        nearestAbove: { id: 'A', side: 'BUY_SIDE', kind: 'BSL', price: 103, strength: 50, timeframe: '1h', scope: 'INTERNAL', status: 'ACTIVE', createdAt: T0, confirmedAt: T0 },
        nearestBelow: { id: 'B', side: 'SELL_SIDE', kind: 'SSL', price: 98, strength: 50, timeframe: '1h', scope: 'INTERNAL', status: 'ACTIVE', createdAt: T0, confirmedAt: T0 },
        recentlySwept: [], externalLiquidity: [], internalLiquidity: [],
      },
      100
    );

    expect(loc.liquidityDistance.upside).toBeCloseTo(3, 5);
    expect(loc.liquidityDistance.downside).toBeCloseTo(2, 5);
  });
});
