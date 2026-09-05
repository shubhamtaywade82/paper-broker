import type {
  ConfluenceZone,
  Evidence,
  LiquidityMap,
  MarketContext,
  Thesis,
  TradeScenario,
} from './types.js';

export interface ScenarioEngineConfig {
  /** Min confluence-zone strength for an entry zone. */
  minZoneStrength: number;
  /** Buffer added beyond a zone's protective edge when computing stops. */
  stopBufferPct: number;
  /** Max scenarios returned per direction family. */
  maxScenarios: number;
}

export const DEFAULT_SCENARIO_CONFIG: ScenarioEngineConfig = {
  minZoneStrength: 35,
  stopBufferPct: 0.0025,
  maxScenarios: 5,
};

/**
 * Scenario Engine — instead of emitting one LONG/SHORT signal, generate the
 * ranked set of ways this market could be traded:
 *
 *   SCENARIO A — RETEST_CONTINUATION   (pullback into demand → continuation)
 *   SCENARIO B — BREAKOUT_RETEST       (break above liquidity → retest → go)
 *   SCENARIO C — LIQUIDITY_REJECTION   (sweep of buyside + CHOCH → reversal)
 *
 * Every scenario carries entry/trigger, invalidation, targets, R:R, a
 * narrative and evidence — the machine-readable form of "if price does X,
 * I do Y; if it does Z, I do W".
 *
 * Deterministic over MarketContext + Thesis: same candles → same scenarios.
 */
export class ScenarioEngine {
  private config: ScenarioEngineConfig;

  constructor(config: ScenarioEngineConfig = DEFAULT_SCENARIO_CONFIG) {
    this.config = config;
  }

  generateScenarios(context: MarketContext, thesis: Thesis): TradeScenario[] {
    const price = context.currentPrice;
    if (!Number.isFinite(price) || price <= 0) return [];

    const scenarios: TradeScenario[] = [];

    switch (thesis.type) {
      case 'BULLISH_CONTINUATION':
        scenarios.push(...this.bullishFamily(context, thesis, price));
        scenarios.push(...this.bearishReversalFamily(context, thesis, price));
        break;
      case 'BEARISH_CONTINUATION':
        scenarios.push(...this.bearishFamily(context, thesis, price));
        scenarios.push(...this.bullishReversalFamily(context, thesis, price));
        break;
      case 'BULLISH_REVERSAL':
        scenarios.push(...this.bullishReversalFamily(context, thesis, price));
        break;
      case 'BEARISH_REVERSAL':
        scenarios.push(...this.bearishReversalFamily(context, thesis, price));
        break;
      case 'RANGE':
        scenarios.push(...this.rangeFamily(context, thesis, price));
        break;
      case 'TRANSITION':
      case 'NO_CLEAR_THESIS':
      default:
        scenarios.push(this.noTradeScenario(context, thesis));
        break;
    }

    return scenarios
      .sort((a, b) => b.alignment - a.alignment)
      .slice(0, this.config.maxScenarios);
  }

  /** The scenario the thesis endorses most — undefined when no-trade. */
  pickPreferred(scenarios: TradeScenario[], thesis: Thesis): TradeScenario | undefined {
    if (thesis.type === 'TRANSITION' || thesis.type === 'NO_CLEAR_THESIS') return undefined;
    return scenarios.find((s) => s.type !== 'NO_TRADE' && s.direction !== 'NONE');
  }

  // -------------------------------------------------------------------------
  // Bullish family
  // -------------------------------------------------------------------------

  private bullishFamily(context: MarketContext, thesis: Thesis, price: number): TradeScenario[] {
    const out: TradeScenario[] = [];

    // A) Retest continuation into the nearest demand confluence below.
    const demand = this.nearestZoneBelow(context.zones, price, 'BULLISH');
    const buysideTargets = this.targetsAbove(context, price);
    if (demand) {
      const invalidation = this.stopBelow(demand.low, context);
      const entry = { upper: demand.high, lower: demand.low };
      const rr = this.computeRr(midOf(entry), invalidation, buysideTargets);
      out.push({
        id: `${context.symbol}:L1:RETEST:${demand.low.toFixed(2)}`,
        symbol: context.symbol,
        type: 'RETEST_CONTINUATION',
        direction: 'LONG',
        status: price <= entry.upper && price >= entry.lower ? 'ARMED' : 'WATCHING',
        alignment: Math.min(1, 0.55 + thesis.confidence * 0.35 + (demand.strength / 100) * 0.1),
        entry: { zone: entry },
        invalidation,
        invalidationReason: `Loss of the ${demand.dominantTimeframe} demand confluence at ${demand.low.toFixed(2)}`,
        targets: buysideTargets,
        rr,
        narrative: `Pullback continuation: long the ${demand.dominantTimeframe} demand confluence ${demand.low.toFixed(2)}–${demand.high.toFixed(2)} (strength ${demand.strength}) while the HTF thesis stays bullish; invalidation on acceptance below ${invalidation.toFixed(2)}.`,
        evidence: this.zoneEvidence(demand, thesis),
        linkedSetupIds: [],
        createdAt: context.asOf,
      });
    }

    // B) Breakout-retest above the nearest buy-side liquidity.
    const breakout = context.liquidity.nearestAbove;
    if (breakout && buysideTargets.length > 0) {
      const triggerBand = this.bandAround(breakout.price);
      const invalidation = this.stopBelow(Math.max(price * 0.99, breakout.price * 0.994), context);
      const rr = this.computeRr(breakout.price, invalidation, buysideTargets);
      out.push({
        id: `${context.symbol}:L2:BREAKOUT:${breakout.price.toFixed(2)}`,
        symbol: context.symbol,
        type: 'BREAKOUT_RETEST',
        direction: 'LONG',
        status: 'WATCHING',
        alignment: Math.min(1, 0.5 + thesis.confidence * 0.3),
        entry: {
          zone: { upper: breakout.price * 1.002, lower: breakout.price * 0.998 },
          trigger: {
            kind: 'PRICE_LEVEL',
            level: breakout.price,
            band: triggerBand,
            description: `Close above buy-side liquidity at ${breakout.price} then hold the retest`,
            confirmation: '5m close above level, then retest that does not lose the level',
          },
        },
        invalidation,
        invalidationReason: `Breakout fails and price loses the retest level ${breakout.price.toFixed(2)}`,
        targets: buysideTargets,
        rr,
        narrative: `Breakout-retest: buy-side liquidity sits at ${breakout.price} (+${context.location.liquidityDistance.upside.toFixed(2)}%). A 5m close above with a held retest opens ${buysideTargets[0]?.price ?? 'the next draw'}.`,
        evidence: this.liquidityEvidence(context, 'BULLISH'),
        linkedSetupIds: [],
        createdAt: context.asOf,
      });
    }

    return out;
  }

  private bullishReversalFamily(context: MarketContext, thesis: Thesis, price: number): TradeScenario[] {
    const out: TradeScenario[] = [];
    const demand = this.nearestZoneBelow(context.zones, price, 'BULLISH');
    const buysideTargets = this.targetsAbove(context, price);

    // Sweep-and-CHOCH long: price sweeps sell-side, then flips structure.
    const ssl = context.liquidity.nearestBelow;
    if (ssl) {
      const invalidation = this.stopBelow(ssl.price * 0.997, context);
      const rr = this.computeRr(price, invalidation, buysideTargets.length ? buysideTargets : [{ price: context.location.range.equilibrium, label: 'Range equilibrium' }]);
      out.push({
        id: `${context.symbol}:LR1:SWEEP_LONG:${ssl.price.toFixed(2)}`,
        symbol: context.symbol,
        type: 'LIQUIDITY_REJECTION',
        direction: 'LONG',
        status: 'CONDITIONAL',
        alignment: 0.5 + thesis.confidence * 0.3,
        entry: {
          zone: { upper: ssl.price * 1.002, lower: ssl.price * 0.995 },
          trigger: {
            kind: 'SWEEP_AND_CHOCH',
            level: ssl.price,
            band: this.bandAround(ssl.price),
            description: `Sweep sell-side liquidity at ${ssl.price}, then 15m bullish CHoCH`,
            confirmation: '15m bullish CHOCH after the sweep',
          },
        },
        invalidation,
        invalidationReason: `Sweep continues — price accepts below ${ssl.price.toFixed(2)}`,
        targets: buysideTargets.length ? buysideTargets : [{ price: context.location.range.equilibrium, label: 'Range equilibrium' }],
        rr,
        narrative: `Reversal conditional: sell-side liquidity at ${ssl.price} (-${context.location.liquidityDistance.downside.toFixed(2)}%) is the draw. A sweep + 15m bullish CHoCH turns it into fuel; direct acceptance below invalidates.`,
        evidence: this.liquidityEvidence(context, 'BULLISH'),
        linkedSetupIds: [],
        createdAt: context.asOf,
      });
    }

    if (demand) {
      const invalidation = this.stopBelow(demand.low, context);
      const rr = this.computeRr(midOf({ upper: demand.high, lower: demand.low }), invalidation, buysideTargets);
      out.push({
        id: `${context.symbol}:LR2:DEMAND_LONG:${demand.low.toFixed(2)}`,
        symbol: context.symbol,
        type: 'REVERSAL',
        direction: 'LONG',
        status: price <= demand.high ? 'ARMED' : 'WATCHING',
        alignment: Math.min(1, 0.45 + (demand.strength / 100) * 0.3 + thesis.confidence * 0.2),
        entry: { zone: { upper: demand.high, lower: demand.low } },
        invalidation,
        invalidationReason: `Demand confluence ${demand.low.toFixed(2)} fails`,
        targets: buysideTargets.length ? buysideTargets : [{ price: context.location.range.equilibrium, label: 'Range equilibrium' }],
        rr,
        narrative: `Reversal at demand: the ${demand.dominantTimeframe} confluence ${demand.low.toFixed(2)}–${demand.high.toFixed(2)} is the first level bulls defend; target the equilibrium / buy-side above.`,
        evidence: this.zoneEvidence(demand, thesis),
        linkedSetupIds: [],
        createdAt: context.asOf,
      });
    }

    return out;
  }

  // -------------------------------------------------------------------------
  // Bearish family (mirror)
  // -------------------------------------------------------------------------

  private bearishFamily(context: MarketContext, thesis: Thesis, price: number): TradeScenario[] {
    const out: TradeScenario[] = [];

    const supply = this.nearestZoneAbove(context.zones, price, 'BEARISH');
    const sellsideTargets = this.targetsBelow(context, price);
    if (supply) {
      const invalidation = this.stopAbove(supply.high, context);
      const entry = { upper: supply.high, lower: supply.low };
      const rr = this.computeRr(midOf(entry), invalidation, sellsideTargets);
      out.push({
        id: `${context.symbol}:S1:RETEST:${supply.high.toFixed(2)}`,
        symbol: context.symbol,
        type: 'RETEST_CONTINUATION',
        direction: 'SHORT',
        status: price <= entry.upper && price >= entry.lower ? 'ARMED' : 'WATCHING',
        alignment: Math.min(1, 0.55 + thesis.confidence * 0.35 + (supply.strength / 100) * 0.1),
        entry: { zone: entry },
        invalidation,
        invalidationReason: `Reclaim of the ${supply.dominantTimeframe} supply confluence at ${supply.high.toFixed(2)}`,
        targets: sellsideTargets,
        rr,
        narrative: `Pullback continuation short: the ${supply.dominantTimeframe} supply confluence ${supply.low.toFixed(2)}–${supply.high.toFixed(2)} (strength ${supply.strength}) is the retest; invalidation on acceptance above ${invalidation.toFixed(2)}.`,
        evidence: this.zoneEvidence(supply, thesis),
        linkedSetupIds: [],
        createdAt: context.asOf,
      });
    }

    const breakout = context.liquidity.nearestBelow;
    if (breakout && sellsideTargets.length > 0) {
      const invalidation = this.stopAbove(Math.min(price * 1.01, breakout.price * 1.006), context);
      const rr = this.computeRr(breakout.price, invalidation, sellsideTargets);
      out.push({
        id: `${context.symbol}:S2:BREAKOUT:${breakout.price.toFixed(2)}`,
        symbol: context.symbol,
        type: 'BREAKOUT_RETEST',
        direction: 'SHORT',
        status: 'WATCHING',
        alignment: Math.min(1, 0.5 + thesis.confidence * 0.3),
        entry: {
          zone: { upper: breakout.price * 1.002, lower: breakout.price * 0.998 },
          trigger: {
            kind: 'PRICE_LEVEL',
            level: breakout.price,
            band: this.bandAround(breakout.price),
            description: `Close below sell-side liquidity at ${breakout.price} then fail the retest`,
            confirmation: '5m close below level, then retest that cannot reclaim it',
          },
        },
        invalidation,
        invalidationReason: `Breakdown fails — price reclaims ${breakout.price.toFixed(2)}`,
        targets: sellsideTargets,
        rr,
        narrative: `Breakdown-retest: sell-side liquidity sits at ${breakout.price} (-${context.location.liquidityDistance.downside.toFixed(2)}%). Losing it with a failed retest opens ${sellsideTargets[0]?.price ?? 'the next draw'}.`,
        evidence: this.liquidityEvidence(context, 'BEARISH'),
        linkedSetupIds: [],
        createdAt: context.asOf,
      });
    }

    return out;
  }

  private bearishReversalFamily(context: MarketContext, thesis: Thesis, price: number): TradeScenario[] {
    const out: TradeScenario[] = [];
    const supply = this.nearestZoneAbove(context.zones, price, 'BEARISH');
    const sellsideTargets = this.targetsBelow(context, price);

    const bsl = context.liquidity.nearestAbove;
    if (bsl) {
      const invalidation = this.stopAbove(bsl.price * 1.003, context);
      const rr = this.computeRr(price, invalidation, sellsideTargets.length ? sellsideTargets : [{ price: context.location.range.equilibrium, label: 'Range equilibrium' }]);
      out.push({
        id: `${context.symbol}:SR1:SWEEP_SHORT:${bsl.price.toFixed(2)}`,
        symbol: context.symbol,
        type: 'LIQUIDITY_REJECTION',
        direction: 'SHORT',
        status: 'CONDITIONAL',
        alignment: 0.5 + thesis.confidence * 0.3,
        entry: {
          zone: { upper: bsl.price * 1.005, lower: bsl.price * 0.998 },
          trigger: {
            kind: 'SWEEP_AND_CHOCH',
            level: bsl.price,
            band: this.bandAround(bsl.price),
            description: `Sweep buy-side liquidity at ${bsl.price}, then 15m bearish CHoCH`,
            confirmation: '15m bearish CHOCH after the sweep',
          },
        },
        invalidation,
        invalidationReason: `Sweep continues — price accepts above ${bsl.price.toFixed(2)}`,
        targets: sellsideTargets.length ? sellsideTargets : [{ price: context.location.range.equilibrium, label: 'Range equilibrium' }],
        rr,
        narrative: `Reversal conditional: buy-side liquidity at ${bsl.price} (+${context.location.liquidityDistance.upside.toFixed(2)}%) is the draw. Sweep + 15m bearish CHoCH is the short trigger; acceptance above invalidates.`,
        evidence: this.liquidityEvidence(context, 'BEARISH'),
        linkedSetupIds: [],
        createdAt: context.asOf,
      });
    }

    if (supply) {
      const invalidation = this.stopAbove(supply.high, context);
      const rr = this.computeRr(midOf({ upper: supply.high, lower: supply.low }), invalidation, sellsideTargets);
      out.push({
        id: `${context.symbol}:SR2:SUPPLY_SHORT:${supply.high.toFixed(2)}`,
        symbol: context.symbol,
        type: 'REVERSAL',
        direction: 'SHORT',
        status: price >= supply.low ? 'ARMED' : 'WATCHING',
        alignment: Math.min(1, 0.45 + (supply.strength / 100) * 0.3 + thesis.confidence * 0.2),
        entry: { zone: { upper: supply.high, lower: supply.low } },
        invalidation,
        invalidationReason: `Supply confluence ${supply.high.toFixed(2)} is reclaimed`,
        targets: sellsideTargets.length ? sellsideTargets : [{ price: context.location.range.equilibrium, label: 'Range equilibrium' }],
        rr,
        narrative: `Reversal at supply: the ${supply.dominantTimeframe} confluence ${supply.low.toFixed(2)}–${supply.high.toFixed(2)} caps price; target the equilibrium / sell-side below.`,
        evidence: this.zoneEvidence(supply, thesis),
        linkedSetupIds: [],
        createdAt: context.asOf,
      });
    }

    return out;
  }

  // -------------------------------------------------------------------------
  // Range / no-trade
  // -------------------------------------------------------------------------

  private rangeFamily(context: MarketContext, thesis: Thesis, price: number): TradeScenario[] {
    const { range } = context.location;
    const out: TradeScenario[] = [];

    const discountZone = { upper: range.low + (range.high - range.low) * 0.3, lower: range.low };
    const premiumZone = { upper: range.high, lower: range.low + (range.high - range.low) * 0.7 };

    out.push({
      id: `${context.symbol}:R1:RANGE_LONG:${range.low.toFixed(2)}`,
      symbol: context.symbol,
      type: 'RANGE_ROTATION',
      direction: 'LONG',
      status: price <= discountZone.upper ? 'ARMED' : 'WATCHING',
      alignment: 0.45,
      entry: { zone: discountZone },
      invalidation: this.stopBelow(range.low, context),
      invalidationReason: 'Range low loses — range is breaking',
      targets: [{ price: range.equilibrium, label: 'Range equilibrium' }, { price: range.high, label: 'Range high' }],
      rr: this.computeRr(midOf(discountZone), this.stopBelow(range.low, context), [{ price: range.equilibrium, label: 'EQ' }]),
      narrative: `Range rotation: buy the discount half (${discountZone.lower.toFixed(2)}–${discountZone.upper.toFixed(2)}) targeting equilibrium ${range.equilibrium.toFixed(2)}.`,
      evidence: [{ source: 'LOCATION', timeframe: range.timeframe, statement: `Price rotating inside a ${range.timeframe} range ${range.low.toFixed(2)}–${range.high.toFixed(2)}`, weight: 0.6 }],
      linkedSetupIds: [],
      createdAt: context.asOf,
    });

    out.push({
      id: `${context.symbol}:R2:RANGE_SHORT:${range.high.toFixed(2)}`,
      symbol: context.symbol,
      type: 'RANGE_ROTATION',
      direction: 'SHORT',
      status: price >= premiumZone.lower ? 'ARMED' : 'WATCHING',
      alignment: 0.45,
      entry: { zone: premiumZone },
      invalidation: this.stopAbove(range.high, context),
      invalidationReason: 'Range high breaks — range is breaking',
      targets: [{ price: range.equilibrium, label: 'Range equilibrium' }, { price: range.low, label: 'Range low' }],
      rr: this.computeRr(midOf(premiumZone), this.stopAbove(range.high, context), [{ price: range.equilibrium, label: 'EQ' }]),
      narrative: `Range rotation: sell the premium half (${premiumZone.lower.toFixed(2)}–${premiumZone.upper.toFixed(2)}) targeting equilibrium ${range.equilibrium.toFixed(2)}.`,
      evidence: [{ source: 'LOCATION', timeframe: range.timeframe, statement: `Price rotating inside a ${range.timeframe} range ${range.low.toFixed(2)}–${range.high.toFixed(2)}`, weight: 0.6 }],
      linkedSetupIds: [],
      createdAt: context.asOf,
    });

    return out;
  }

  private noTradeScenario(context: MarketContext, thesis: Thesis): TradeScenario {
    return {
      id: `${context.symbol}:NT:NO_TRADE`,
      symbol: context.symbol,
      type: 'NO_TRADE',
      direction: 'NONE',
      status: 'CONDITIONAL',
      alignment: 0,
      invalidation: 0,
      invalidationReason: 'No actionable structure',
      targets: [],
      rr: 0,
      narrative: `No clear thesis (${thesis.type.toLowerCase()}, confidence ${(thesis.confidence * 100).toFixed(0)}%) — stand aside and let the market prove direction.`,
      evidence: [{ source: 'REGIME', timeframe: 'composite', statement: `Thesis ${thesis.type} with insufficient alignment`, weight: 0.8 }],
      linkedSetupIds: [],
      createdAt: context.asOf,
    };
  }

  // -------------------------------------------------------------------------
  // Selection helpers
  // -------------------------------------------------------------------------

  private nearestZoneBelow(zones: ConfluenceZone[], price: number, direction: 'BULLISH' | 'BEARISH'): ConfluenceZone | undefined {
    // "Below" includes the zone price currently sits inside — that's the
    // ARMED-at-zone case, not just the pullback case.
    return zones
      .filter((z) => z.low <= price && (z.direction === direction || z.direction === 'NEUTRAL') && z.strength >= this.config.minZoneStrength && z.status !== 'BROKEN')
      .sort((a, b) => b.high - a.high)[0];
  }

  private nearestZoneAbove(zones: ConfluenceZone[], price: number, direction: 'BULLISH' | 'BEARISH'): ConfluenceZone | undefined {
    return zones
      .filter((z) => z.high >= price && (z.direction === direction || z.direction === 'NEUTRAL') && z.strength >= this.config.minZoneStrength && z.status !== 'BROKEN')
      .sort((a, b) => a.low - b.low)[0];
  }

  private targetsAbove(context: MarketContext, price: number): Array<{ price: number; label: string }> {
    const targets: Array<{ price: number; label: string }> = [];
    const pools = context.liquidity.buySide
      .filter((p) => p.price > price)
      .sort((a, b) => a.price - b.price)
      .slice(0, 3);
    for (const p of pools) targets.push({ price: p.price, label: `${p.timeframe} buy-side liquidity` });

    // Always include the range high as the macro draw if beyond the pools.
    const rh = context.location.range.high;
    if (rh > price && !targets.some((t) => Math.abs(t.price - rh) / price < 0.002)) {
      targets.push({ price: rh, label: `${context.location.range.timeframe} range high` });
    }
    return targets.sort((a, b) => a.price - b.price).slice(0, 3);
  }

  private targetsBelow(context: MarketContext, price: number): Array<{ price: number; label: string }> {
    const targets: Array<{ price: number; label: string }> = [];
    const pools = context.liquidity.sellSide
      .filter((p) => p.price < price)
      .sort((a, b) => b.price - a.price)
      .slice(0, 3);
    for (const p of pools) targets.push({ price: p.price, label: `${p.timeframe} sell-side liquidity` });

    const rl = context.location.range.low;
    if (rl < price && !targets.some((t) => Math.abs(t.price - rl) / price < 0.002)) {
      targets.push({ price: rl, label: `${context.location.range.timeframe} range low` });
    }
    return targets.sort((a, b) => b.price - a.price).slice(0, 3);
  }

  private stopBelow(level: number, context: MarketContext): number {
    const buffer = level * this.config.stopBufferPct;
    const atrFloor = Number.isFinite(context.volatility.atr1h) ? context.volatility.atr1h * 0.25 : 0;
    return level - Math.max(buffer, atrFloor);
  }

  private stopAbove(level: number, context: MarketContext): number {
    const buffer = level * this.config.stopBufferPct;
    const atrFloor = Number.isFinite(context.volatility.atr1h) ? context.volatility.atr1h * 0.25 : 0;
    return level + Math.max(buffer, atrFloor);
  }

  private bandAround(level: number): { upper: number; lower: number } {
    return { upper: level * 1.0015, lower: level * 0.9985 };
  }

  private computeRr(entry: number, invalidation: number, targets: Array<{ price: number; label: string }>): number {
    const risk = Math.abs(entry - invalidation);
    if (risk <= 0 || targets.length === 0) return 0;
    const final = targets[targets.length - 1]!;
    return round2(Math.abs(final.price - entry) / risk);
  }

  private zoneEvidence(zone: ConfluenceZone, thesis: Thesis): Evidence[] {
    return [
      {
        source: 'ZONES',
        timeframe: zone.dominantTimeframe,
        statement: `${zone.direction.toLowerCase()} confluence zone ${zone.low.toFixed(2)}–${zone.high.toFixed(2)} (strength ${zone.strength}, ${zone.types.join('+')}, ${zone.timeframes.join('/')})`,
        weight: zone.strength / 100,
      },
      {
        source: 'STRUCTURE',
        timeframe: 'composite',
        statement: `Thesis ${thesis.type} at ${(thesis.confidence * 100).toFixed(0)}% confidence`,
        weight: thesis.confidence,
      },
    ];
  }

  private liquidityEvidence(context: MarketContext, dir: 'BULLISH' | 'BEARISH'): Evidence[] {
    const ev: Evidence[] = [];
    const map: LiquidityMap = context.liquidity;
    if (dir === 'BULLISH' && map.nearestBelow) {
      ev.push({ source: 'LIQUIDITY', timeframe: map.nearestBelow.timeframe, statement: `Sell-side liquidity at ${map.nearestBelow.price} is the downside draw`, weight: 0.7 });
    }
    if (dir === 'BEARISH' && map.nearestAbove) {
      ev.push({ source: 'LIQUIDITY', timeframe: map.nearestAbove.timeframe, statement: `Buy-side liquidity at ${map.nearestAbove.price} is the upside draw`, weight: 0.7 });
    }
    ev.push({
      source: 'LOCATION',
      timeframe: 'composite',
      statement: `Price at ${context.location.position.toLowerCase()} (${(context.location.rangePosition * 100).toFixed(0)}% of range)`,
      weight: 0.5,
    });
    return ev;
  }
}

function midOf(zone: { upper: number; lower: number }): number {
  return (zone.upper + zone.lower) / 2;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
