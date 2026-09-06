import { CANONICAL_TIMEFRAMES, type AnalysisTimeframe } from '../market/MtfStateEngine.js';
import type { FairValueGap, MultiTimeframeSmcContext, OrderBlock, SmcTimeframeContext } from '../market/smc/types.js';
import type { ConfluenceZone, Direction, PriceZone, ZoneStatus, ZoneType } from './types.js';

/**
 * Timeframe weight used when scoring zone strength. Mirrors the role
 * hierarchy: a 4h zone is a structural wall, a 5m zone is a micro target.
 */
const TF_ZONE_WEIGHT: Record<AnalysisTimeframe, number> = {
  '4h': 1.0,
  '2h': 0.85,
  '1h': 0.7,
  '15m': 0.5,
  '5m': 0.3,
};

export interface ZoneAggregationConfig {
  /** Min relative zone height to keep (filters micro-gaps). */
  minZoneHeightPct: number;
  /** Max members allowed in one merged confluence zone. */
  maxMergeMembers: number;
  /** Max merges per zone pass — keeps strong zones distinct. */
  mergeSpanPctCap: number;
}

export const DEFAULT_ZONE_AGGREGATION_CONFIG: ZoneAggregationConfig = {
  minZoneHeightPct: 0.0004,
  maxMergeMembers: 5,
  mergeSpanPctCap: 0.012,
};

/**
 * Aggregates raw FVG / Order-Block detections into unified confluence zones.
 *
 * This is what turns "102.68–102.76 FVG + 102.70–102.79 OB" into a single
 * machine-readable "102.68–102.79 CONFLUENCE DEMAND, strength 87" — the way
 * a discretionary trader draws ONE box around overlapping SMC evidence.
 *
 * Pure transformer over SmcLocationEngine output: deterministic, no clock,
 * no I/O, fully backtestable.
 */
export class ZoneAggregationEngine {
  private config: ZoneAggregationConfig;

  constructor(config: ZoneAggregationConfig = DEFAULT_ZONE_AGGREGATION_CONFIG) {
    this.config = config;
  }

  /**
   * Build merged confluence zones across all canonical timeframes.
   * Returned sorted by strength (strongest first).
   */
  aggregateZones(smc: MultiTimeframeSmcContext, asOf: number): ConfluenceZone[] {
    const rawZones: PriceZone[] = [];

    for (const tf of CANONICAL_TIMEFRAMES) {
      const ctx = smc.timeframes[tf];
      if (!ctx) continue;
      rawZones.push(...this.buildTimeframeZones(ctx, asOf));
    }

    return this.mergeZones(rawZones, asOf);
  }

  /** Public per-timeframe zone conversion (used by MarketContextEngine). */
  buildTimeframeZones(ctx: SmcTimeframeContext, asOf: number): PriceZone[] {
    return this.zonesFromTimeframe(ctx, asOf);
  }

  /** Convert one timeframe's FVGs + OBs into PriceZones. */
  private zonesFromTimeframe(ctx: SmcTimeframeContext, asOf: number): PriceZone[] {
    const zones: PriceZone[] = [];

    for (const fvg of ctx.fairValueGaps) {
      if (fvg.confirmedAt > asOf) continue;
      const status = this.fvgStatus(fvg);
      if (status === null) continue;
      zones.push(this.makeZone(fvg, 'FVG', status, asOf));
    }

    for (const ob of ctx.orderBlocks) {
      if (ob.confirmedAt > asOf) continue;
      const status = this.obStatus(ob);
      if (status === null) continue;
      zones.push(this.makeZone(ob, 'ORDER_BLOCK', status, asOf));
    }

    return zones;
  }

  /** Mitigated/partially-filled FVGs remain tradeable reference zones. */
  private fvgStatus(fvg: FairValueGap): ZoneStatus | null {
    switch (fvg.status) {
      case 'ACTIVE':
      case 'PARTIALLY_FILLED':
        return 'ACTIVE';
      case 'MITIGATED':
        return 'MITIGATED';
      case 'INVALIDATED':
        return 'BROKEN';
      default:
        return null;
    }
  }

  private obStatus(ob: OrderBlock): ZoneStatus | null {
    switch (ob.status) {
      case 'ACTIVE':
        return 'ACTIVE';
      case 'MITIGATED':
        return 'MITIGATED';
      case 'INVALIDATED':
        return 'BROKEN';
      default:
        return null;
    }
  }

  private makeZone(
    source: FairValueGap | OrderBlock,
    type: ZoneType,
    status: ZoneStatus,
    asOf: number
  ): PriceZone {
    const low = source.lowerPrice;
    const high = source.upperPrice;
    const heightPct = (high - low) / ((high + low) / 2);

    // Base detector quality 0..100: TF weight dominates, sensible size and
    // freshness add. Broken zones keep identity but score low.
    let strength = TF_ZONE_WEIGHT[source.timeframe] * 55;
    if (heightPct >= 0.001 && heightPct <= 0.015) strength += 10; // meaningful, not extreme
    if (type === 'ORDER_BLOCK') strength += 8; // OBs carry displacement proof
    const ageMs = Math.max(0, asOf - source.confirmedAt);
    const freshness = Math.max(0, 1 - ageMs / (72 * 3_600_000)); // 72h half-life-ish
    strength += freshness * 15;
    if (status !== 'ACTIVE') strength *= 0.6;

    return {
      id: source.id,
      symbol: source.symbol,
      type,
      direction: source.type === 'BULLISH' ? 'BULLISH' : 'BEARISH',
      low,
      high,
      timeframe: source.timeframe,
      strength: Math.max(1, Math.min(100, Math.round(strength))),
      status,
      touches: 1,
      createdAt: source.createdAt,
      confirmedAt: source.confirmedAt,
      midpoint: (high + low) / 2,
    };
  }

  /**
   * Greedy overlap merging, strongest zone first. A zone joins a cluster
   * when its range overlaps the cluster's range AND the resulting span stays
   * within a sane multiple of price (prevents chaining tiny zones into one
   * giant fake "confluence" band).
   */
  private mergeZones(zones: PriceZone[], asOf: number): ConfluenceZone[] {
    const usable = zones.filter((z) => {
      const h = (z.high - z.low) / ((z.high + z.low) / 2);
      return h >= this.config.minZoneHeightPct;
    });

    const sorted = [...usable].sort((a, b) => b.strength - a.strength);
    const clusters: PriceZone[][] = [];

    for (const zone of sorted) {
      let placed = false;
      for (const cluster of clusters) {
        const span = this.clusterSpan(cluster, zone);
        const mid = span.mid;
        if (
          this.overlaps(cluster, zone) &&
          span.height / mid <= this.config.mergeSpanPctCap &&
          cluster.length < this.config.maxMergeMembers
        ) {
          cluster.push(zone);
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push([zone]);
    }

    const merged = clusters.map((c) => this.buildConfluenceZone(c, asOf));

    // Sort: strength desc, then HTF dominance, then lower edge.
    return merged.sort((a, b) => {
      if (b.strength !== a.strength) return b.strength - a.strength;
      return a.low - b.low;
    });
  }

  private overlaps(cluster: PriceZone[], zone: PriceZone): boolean {
    const span = this.clusterSpan(cluster);
    return zone.low <= span.high && zone.high >= span.low;
  }

  private clusterSpan(cluster: PriceZone[], extra?: PriceZone): { low: number; high: number; mid: number; height: number } {
    let low = extra ? extra.low : Infinity;
    let high = extra ? extra.high : -Infinity;
    for (const z of cluster) {
      low = Math.min(low, z.low);
      high = Math.max(high, z.high);
    }
    if (!extra && cluster.length === 0) return { low: 0, high: 0, mid: 0, height: 0 };
    const mid = (low + high) / 2;
    return { low, high, mid, height: high - low };
  }

  private buildConfluenceZone(members: PriceZone[], _asOf: number): ConfluenceZone {
    const span = this.clusterSpan(members);
    const dominant = members[0]!; // members were inserted strongest-first

    const directions = new Set(members.map((m) => m.direction));
    const direction: ConfluenceZone['direction'] =
      directions.size === 1 ? (members[0]!.direction ?? 'NEUTRAL') : 'NEUTRAL';

    const timeframes = [...new Set(members.map((m) => m.timeframe))].sort(
      (a, b) => TF_ZONE_WEIGHT[b] - TF_ZONE_WEIGHT[a]
    );
    const types = [...new Set(members.map((m) => m.type))];

    // Strength: strongest member + overlap convergence bonus + touch bonus.
    const maxMember = Math.max(...members.map((m) => m.strength));
    const overlapBonus = Math.min(25, (members.length - 1) * 10);
    const touchBonus = Math.min(15, members.reduce((s, m) => s + m.touches, 0) * 3);
    const strength = Math.max(1, Math.min(100, Math.round(maxMember + overlapBonus + touchBonus)));

    const statuses = members.map((m) => m.status);
    const status: ZoneStatus = statuses.includes('ACTIVE')
      ? 'ACTIVE'
      : statuses.includes('MITIGATED')
        ? 'MITIGATED'
        : 'BROKEN';

    const dominantTimeframe = timeframes[0] ?? dominant.timeframe;

    return {
      id: `CONFLUENCE:${dominant.symbol}:${span.low.toFixed(4)}-${span.high.toFixed(4)}`,
      sourceZoneIds: members.map((m) => m.id),
      direction,
      low: span.low,
      high: span.high,
      midpoint: span.mid,
      dominantTimeframe,
      timeframes,
      types,
      strength,
      status,
      touches: members.length,
      createdAt: Math.min(...members.map((m) => m.createdAt)),
      lastConfirmedAt: Math.max(...members.map((m) => m.confirmedAt)),
    };
  }
}

export type { Direction };
