import type { AnalysisTimeframe } from '../../../src/market/MtfStateEngine.js';
import type {
  ConfluenceZone,
  LiquidityMap,
  LiquidityPool,
  MarketContext,
  PriceLevel,
  StructureAlignmentSummary,
  TimeframeContext,
} from '../../../src/analysis/types.js';

export const T0 = 1_700_000_000_000;

/**
 * Build a minimal-but-complete LiquidityPool.
 */
export function makePool(overrides: Partial<LiquidityPool>): LiquidityPool {
  return {
    id: 'POOL',
    side: 'BUY_SIDE',
    kind: 'BSL',
    price: 105,
    strength: 60,
    timeframe: '1h',
    scope: 'INTERNAL',
    status: 'ACTIVE',
    createdAt: T0,
    confirmedAt: T0,
    ...overrides,
  };
}

export function makeLiquidityMap(overrides: Partial<LiquidityMap> = {}): LiquidityMap {
  return {
    buySide: [],
    sellSide: [],
    nearestAbove: undefined,
    nearestBelow: undefined,
    recentlySwept: [],
    externalLiquidity: [],
    internalLiquidity: [],
    ...overrides,
  };
}

export function makeTimeframeContext(
  tf: AnalysisTimeframe,
  overrides: Partial<TimeframeContext> = {}
): TimeframeContext {
  return {
    timeframe: tf,
    role:
      tf === '4h' ? 'MACRO_REGIME'
      : tf === '2h' ? 'STRUCTURAL_CONTEXT'
      : tf === '1h' ? 'DIRECTIONAL_THESIS'
      : tf === '15m' ? 'SETUP_FORMATION'
      : 'EXECUTION_TRIGGER',
    trend: 'BULLISH',
    lastSwingHigh: 104,
    lastSwingLow: 100,
    structure: { hh: true, hl: true, lh: false, ll: false },
    liquidity: { buySide: [], sellSide: [], recentSweeps: [] },
    zones: { bullishFvg: [], bearishFvg: [], bullishOb: [], bearishOb: [] },
    position: {
      relativeToRange: 'EQUILIBRIUM',
      rangePosition: 0.5,
      distanceToHighPct: 2,
      distanceToLowPct: 2,
    },
    candleCount: 60,
    ...overrides,
  };
}

export function makeStructureSummary(overrides: Partial<StructureAlignmentSummary> = {}): StructureAlignmentSummary {
  return {
    trends: { '4h': 'BULLISH', '2h': 'BULLISH', '1h': 'BULLISH', '15m': 'BULLISH', '5m': 'BULLISH' },
    alignedCount: 5,
    conflicting: [],
    fullyStacked: true,
    lastEvents: { '4h': 'BOS_BULLISH', '2h': 'BOS_BULLISH', '1h': 'BOS_BULLISH', '15m': 'BOS_BULLISH', '5m': undefined },
    ...overrides,
  };
}

export function makeZone(overrides: Partial<ConfluenceZone> = {}): ConfluenceZone {
  return {
    id: 'CONFLUENCE:SOLUSDT:102.6800-102.7900',
    sourceZoneIds: ['FVG1', 'OB1'],
    direction: 'BULLISH',
    low: 102.68,
    high: 102.79,
    midpoint: 102.735,
    dominantTimeframe: '15m',
    timeframes: ['15m'],
    types: ['FVG', 'ORDER_BLOCK'],
    strength: 87,
    status: 'ACTIVE',
    touches: 2,
    createdAt: T0,
    lastConfirmedAt: T0 + 900_000,
    ...overrides,
  };
}

export interface ContextOverrides {
  currentPrice?: number;
  trends?: Partial<Record<AnalysisTimeframe, 'BULLISH' | 'BEARISH' | 'RANGE' | 'UNKNOWN'>>;
  regime?: MarketContext['regime'];
  bias?: Partial<MarketContext['directionalBias']>;
  liquidity?: LiquidityMap;
  zones?: ConfluenceZone[];
  location?: Partial<MarketContext['location']>;
  volatility?: Partial<MarketContext['volatility']>;
  lastEvent15m?: TimeframeContext['structure']['lastEvent'];
  lastEventAge15m?: number;
  candleCounts?: Partial<Record<AnalysisTimeframe, number>>;
}

/**
 * A fully-stacked bullish context by default (price 102.85 inside a 90–110
 * 4h range, demand confluence just below, buy-side liquidity just above) —
 * the SOLUSDT-style setup from the reference analysis.
 */
export function makeBullishContext(o: ContextOverrides = {}): MarketContext {
  const trends = {
    '4h': 'BULLISH', '2h': 'BULLISH', '1h': 'BULLISH', '15m': 'BULLISH', '5m': 'BULLISH',
    ...(o.trends ?? {}),
  } as Record<AnalysisTimeframe, 'BULLISH' | 'BEARISH' | 'RANGE' | 'UNKNOWN'>;

  const liquidity = o.liquidity ?? makeLiquidityMap({
    buySide: [makePool({ id: 'B1', side: 'BUY_SIDE', kind: 'BSL', price: 103.4, timeframe: '1h' }), makePool({ id: 'B2', side: 'BUY_SIDE', kind: 'BSL', price: 104.6, timeframe: '4h' })],
    sellSide: [makePool({ id: 'S1', side: 'SELL_SIDE', kind: 'SSL', price: 102.2, timeframe: '1h' }), makePool({ id: 'S2', side: 'SELL_SIDE', kind: 'SSL', price: 101.7, timeframe: '4h' })],
    nearestAbove: makePool({ id: 'B1', side: 'BUY_SIDE', kind: 'BSL', price: 103.4, timeframe: '1h' }),
    nearestBelow: makePool({ id: 'S1', side: 'SELL_SIDE', kind: 'SSL', price: 102.2, timeframe: '1h' }),
  });

  const zones = o.zones ?? [makeZone()];

  const timeframes = {} as Record<AnalysisTimeframe, TimeframeContext>;
  const all: AnalysisTimeframe[] = ['4h', '2h', '1h', '15m', '5m'];
  for (const tf of all) {
    timeframes[tf] = makeTimeframeContext(tf, {
      trend: trends[tf],
      candleCount: o.candleCounts?.[tf] ?? 60,
      ...(tf === '15m'
        ? {
            structure: {
              hh: true, hl: true, lh: false, ll: false,
              lastEvent: o.lastEvent15m ?? 'BOS_BULLISH',
              eventDirection: 'BULLISH' as const,
              lastEventAgeBars: o.lastEventAge15m ?? 2,
            },
          }
        : {}),
    });
  }

  const long = o.bias?.long ?? 0.82;
  const short = o.bias?.short ?? 0.18;
  const neutral = o.bias?.neutral ?? 0;
  const biasFinal =
    o.bias?.final ?? (long >= 0.55 && long > short * 1.5 ? 'LONG' : short >= 0.55 && short > long * 1.5 ? 'SHORT' : 'NEUTRAL');

  const structure = makeStructureSummary({ trends });

  return {
    symbol: 'SOLUSDT',
    asOf: T0 + 3_600_000,
    currentPrice: o.currentPrice ?? 102.85,
    regime: o.regime ?? { primary: 'BULLISH', confidence: 0.84, behavioral: 'TRENDING_NORMAL' },
    timeframes,
    directionalBias: { long, short, neutral, final: biasFinal },
    structure,
    liquidity,
    zones,
    volatility: { label: 'MODERATE', atr1h: 0.85, atrPct: 0.82, expansionRatio: 1.05, ...(o.volatility ?? {}) },
    location: {
      range: { high: 110, low: 90, equilibrium: 100, timeframe: '4h' },
      position: 'EQUILIBRIUM',
      rangePosition: 0.64,
      nearbyZones: zones.slice(0, 3),
      liquidityDistance: { upside: 0.53, downside: 0.63 },
      ...(o.location ?? {}),
    },
    nearestLevels: [] as PriceLevel[],
  };
}
