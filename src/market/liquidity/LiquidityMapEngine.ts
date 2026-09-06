import { CANONICAL_TIMEFRAMES, type AnalysisTimeframe } from '../MtfStateEngine.js';
import type { LiquidityLevel, MultiTimeframeSmcContext, SmcTimeframeContext } from '../smc/types.js';
import type {
  LiquidityMap,
  LiquidityPool,
  LiquiditySweepRecord,
} from '../../analysis/types.js';

/**
 * How much a liquidity pool from a given timeframe weighs in the narrative.
 * HTF pools are the ones HTF participants defend; LTF pools are noise unless
 * clustered.
 */
const TF_WEIGHT: Record<AnalysisTimeframe, number> = {
  '4h': 1.0,
  '2h': 0.85,
  '1h': 0.7,
  '15m': 0.5,
  '5m': 0.3,
};

export interface LiquidityMapConfig {
  /** Two pools within this relative distance merge into one cluster. */
  clusterTolerancePct: number;
  /** Sweeps confirmed within this window count as "recent". */
  recentSweepWindowMs: number;
  /** Pools confirmed before this many ms ago decay in strength. */
  strengthDecayHalfLifeMs: number;
}

export const DEFAULT_LIQUIDITY_MAP_CONFIG: LiquidityMapConfig = {
  clusterTolerancePct: 0.0008,
  recentSweepWindowMs: 4 * 3_600_000,
  strengthDecayHalfLifeMs: 24 * 3_600_000,
};

/**
 * Builds the symbol-wide LiquidityMap from the per-timeframe SMC contexts.
 *
 * The map answers narrative questions the raw detector output cannot:
 *   - "what is the nearest liquidity above/below?"
 *   - "which pools are external (range extremes) vs internal?"
 *   - "what got swept recently?" (sweep-and-reverse context)
 *
 * Pure transformer: takes already-computed SMC contexts, so the same inputs
 * always produce the same map (deterministic + backtestable).
 */
export class LiquidityMapEngine {
  private config: LiquidityMapConfig;

  constructor(config: LiquidityMapConfig = DEFAULT_LIQUIDITY_MAP_CONFIG) {
    this.config = config;
  }

  /**
   * @param smc Multi-timeframe SMC context (per-TF liquidity levels + sweeps).
   * @param currentPrice Anchor price for nearest-above/below.
   * @param asOf Point in time (filters sweeps, drives strength decay).
   * @param range Dealing range (high/low) used to classify external vs
   *   internal pools. Pools beyond the range are "external" — the draw on
   *   liquidity that ends a range; pools inside are internal targets.
   */
  buildLiquidityMap(
    smc: MultiTimeframeSmcContext,
    currentPrice: number,
    asOf: number,
    range: { high: number; low: number }
  ): LiquidityMap {
    const allPools: LiquidityPool[] = [];
    const sweepRecords: LiquiditySweepRecord[] = [];

    for (const tf of CANONICAL_TIMEFRAMES) {
      const ctx = smc.timeframes[tf];
      if (!ctx) continue;
      allPools.push(...this.poolsFromTimeframe(ctx, range));
      sweepRecords.push(...this.sweepsFromTimeframe(ctx, asOf));
    }

    const clustered = this.clusterPools(allPools, asOf);

    const active = clustered.filter((p) => p.status === 'ACTIVE');
    const buySide = active
      .filter((p) => p.side === 'BUY_SIDE' && p.price > currentPrice)
      .sort((a, b) => a.price - b.price);
    const sellSide = active
      .filter((p) => p.side === 'SELL_SIDE' && p.price < currentPrice)
      .sort((a, b) => b.price - a.price);

    const recentlySwept = sweepRecords
      .filter((s) => asOf - s.sweptAt <= this.config.recentSweepWindowMs)
      .sort((a, b) => b.sweptAt - a.sweptAt)
      .slice(0, 10);

    return {
      buySide,
      sellSide,
      nearestAbove: buySide[0],
      nearestBelow: sellSide[0],
      recentlySwept,
      externalLiquidity: clustered.filter((p) => p.scope === 'EXTERNAL'),
      internalLiquidity: clustered.filter((p) => p.scope === 'INTERNAL'),
    };
  }

  private poolsFromTimeframe(ctx: SmcTimeframeContext, range: { high: number; low: number }): LiquidityPool[] {
    return ctx.liquidityLevels.map((lvl) => this.poolFromLevel(lvl, range));
  }

  private poolFromLevel(lvl: LiquidityLevel, range: { high: number; low: number }): LiquidityPool {
    const side: LiquidityPool['side'] =
      lvl.type === 'BSL' || lvl.type === 'EQUAL_HIGH' ? 'BUY_SIDE' : 'SELL_SIDE';
    const strength = this.baseStrength(lvl);
    const scope: LiquidityPool['scope'] =
      lvl.price > range.high || lvl.price < range.low ? 'EXTERNAL' : 'INTERNAL';

    return {
      id: lvl.id,
      side,
      kind: lvl.type,
      price: lvl.price,
      strength,
      timeframe: lvl.timeframe,
      scope,
      status: lvl.status === 'SWEPT' ? 'SWEPT' : lvl.status === 'EXPIRED' ? 'EXPIRED' : 'ACTIVE',
      createdAt: lvl.createdAt,
      confirmedAt: lvl.confirmedAt,
    };
  }

  /**
   * Base 0..100 strength: equal-high/low clusters are stronger than single
   * swings, HTF pools outweigh LTF pools.
   */
  private baseStrength(lvl: LiquidityLevel): number {
    const isCluster = lvl.type === 'EQUAL_HIGH' || lvl.type === 'EQUAL_LOW';
    let s = TF_WEIGHT[lvl.timeframe] * 60;
    if (isCluster) s += 20;
    if (lvl.sourceSwingIds.length > 2) s += 5;
    return Math.min(100, Math.round(s));
  }

  private sweepsFromTimeframe(ctx: SmcTimeframeContext, asOf: number): LiquiditySweepRecord[] {
    return ctx.sweeps
      .filter((s) => s.confirmationTime <= asOf)
      .map((s) => ({
        poolId: s.liquidityId,
        side:
          s.liquidityType === 'BSL' || s.liquidityType === 'EQUAL_HIGH'
            ? ('BUY_SIDE' as const)
            : ('SELL_SIDE' as const),
        kind: s.liquidityType,
        price: s.liquidityPrice,
        sweepExtreme: s.sweepExtreme,
        sweptAt: s.confirmationTime,
        timeframe: s.timeframe,
      }));
  }

  /**
   * Merge pools that sit (almost) on top of each other — a 4h swing high and
   * a 1h equal-high at the same price are ONE pool with more conviction, not
   * two separate levels. The cluster keeps the strongest member as host;
   * strength gains a convergence bonus per extra member and decays with age.
   */
  private clusterPools(pools: LiquidityPool[], asOf: number): LiquidityPool[] {
    const sorted = [...pools].sort((a, b) => {
      if (b.strength !== a.strength) return b.strength - a.strength;
      return TF_WEIGHT[b.timeframe] - TF_WEIGHT[a.timeframe];
    });

    const clusters: LiquidityPool[] = [];

    for (const pool of sorted) {
      const host = clusters.find(
        (c) =>
          c.side === pool.side &&
          Math.abs(c.price - pool.price) <=
            Math.max(c.price, pool.price) * this.config.clusterTolerancePct
      );
      if (!host) {
        clusters.push({ ...pool });
        continue;
      }
      const merged: LiquidityPool = {
        ...host,
        price: (host.price + pool.price) / 2,
        strength: Math.min(100, Math.round(Math.max(host.strength, pool.strength) + 8)),
        scope: host.scope === 'EXTERNAL' || pool.scope === 'EXTERNAL' ? 'EXTERNAL' : host.scope,
        status: host.status === 'ACTIVE' && pool.status === 'ACTIVE' ? 'ACTIVE' : host.status,
        sweptAt: host.sweptAt ?? pool.sweptAt,
      };
      clusters[clusters.indexOf(host)] = merged;
    }

    // Recency decay: older pools lose strength, halving per half-life.
    return clusters.map((p) => {
      const age = Math.max(0, asOf - p.confirmedAt);
      const decay = Math.pow(0.5, age / this.config.strengthDecayHalfLifeMs);
      return { ...p, strength: Math.max(5, Math.round(p.strength * (0.6 + 0.4 * decay))) };
    });
  }
}
