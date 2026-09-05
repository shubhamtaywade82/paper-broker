# 0006 — Market Intelligence Layer (hierarchical analysis under the agent)

- Status: Accepted
- Date: 2026-09-05
- Branch: `feature/market-intelligence-layer`

## Context

The repo already had the deterministic machinery: canonical MTF state
(4h/1h/15m/5m), market-structure detection (HH/HL/LH/LL, BOS/CHoCH), SMC
detection (FVG/OB/liquidity/sweeps), setup generation, confluence scoring and
state transitions. What it lacked was the layer that turns those individual
measurements into a coherent, hierarchical market narrative and an executable
setup family:

- No answer to "what is the market doing **before** we decide whether there is
  a trade?" (regime / location / liquidity map / volatility as one object).
- No liquidity narrative: raw `BSL/SSL` levels, but no nearest draws,
  external vs internal liquidity, or recent-sweep context.
- No zone confluence: overlapping FVG + OB stayed separate detections instead
  of one confluent demand/supply area.
- No premium/discount awareness: the same bullish BOS scored identically at
  range extremes and at equilibrium.
- No directional thesis, no scenario family: the pipeline produced one
  candidate direction instead of ranked "if price does X, we do Y" branches.
- Confluence was a flat weighted count; evidence quality, timeframe relevance
  and location did not interact.
- A single 15m-sourced OR-filter could turn "FVG alone" into a tradeable
  candidate (too permissive for the final decision).
- The risk engine invented ATR stops even when a setup had a structural
  invalidation available.

## Decision

Introduce a **Market Intelligence layer** between the raw market engines and
execution, with these modules:

| Module | Path | Responsibility |
| --- | --- | --- |
| Types | `src/analysis/types.ts` | `MarketContext`, `TimeframeContext`, `LiquidityMap`, `ConfluenceZone`, `MarketLocation`, `Thesis`, `TradeScenario`, `HierarchicalConfluenceBreakdown`, `MarketAnalysis` |
| Liquidity Map | `src/market/liquidity/LiquidityMapEngine.ts` | Cross-TF liquidity pools, clustering, nearest above/below, external vs internal, recent sweeps |
| Zone Aggregation | `src/analysis/ZoneAggregationEngine.ts` | Merge overlapping FVG/OB into confluent zones with 0–100 strength |
| Market Location | `src/analysis/MarketLocationEngine.ts` | HTF dealing range, DEEP_DISCOUNT…DEEP_PREMIUM, nearby zones, liquidity distance |
| Market Context | `src/analysis/MarketContextEngine.ts` | Orchestrates everything into one deterministic `MarketContext` (regime, per-TF narrative, bias, structure alignment, volatility) |
| Thesis | `src/analysis/ThesisEngine.ts` | Directional thesis type + confidence + per-TF reasoning + evidence |
| Scenarios | `src/analysis/ScenarioEngine.ts` | Ranked trade scenarios (retest-continuation, breakout-retest, liquidity-rejection, range rotation, no-trade) with entry/invalidation/targets/R:R |
| Hierarchical Confluence | `src/analysis/HierarchicalConfluenceScorer.ts` | 100-pt weighted evidence-quality model with A+/A/B/C/REJECT grades |
| Market Analysis | `src/analysis/MarketAnalysisEngine.ts` | Final `MarketAnalysis` object (dashboard + agent + LLM contract) |

Canonical timeframes are now `4h, 2h, 1h, 15m, 5m` with explicit roles
(`TIMEFRAME_ROLES`): 4H = macro regime, 2H = structural context, 1H =
directional thesis, 15M = setup formation, 5M = execution trigger.
`env.TIMEFRAMES` now preloads `2h` by default.

SetupEngine gains an optional two-stage pipeline:

```
Stage 1: Candidate discovery (unchanged, permissive OR-filter)
Stage 2: Qualification (getQualifiedSetupsAsOf)
   → hierarchical confluence score + grade
   → context gate (regime, volatility)
   → thesis gate (thesis must back the direction)
   → scenario linkage + structural execution plan
   → canonical state progression WATCHING → APPROACHING → AT_ZONE →
     TRIGGER_DETECTED → CONFIRMED → READY
```

Legacy `getSetupsAsOf` and the legacy setup states remain valid so existing
callers (smc-agent, replay, diagnostic funnel) are unaffected.

Risk contract: `AdaptiveRiskManager.computeTradePlan` accepts an optional
`StructuralRiskContext` (setup entry / structural stop / target). When valid
the structural invalidation replaces the ATR stop — the setup defines risk,
the risk manager sizes it.

Agent integration (all optional-chained): the autonomous agent computes a
`MarketAnalysis` per symbol per cycle, broadcasts `agent.autonomous.analysis`,
gates entries on the thesis (RANGE/TRANSITION/NO_CLEAR_THESIS ⇒ monitor),
ranks READY setups by hierarchical score, and passes structural invalidation
into the trade plan. REST: `GET /api/v1/analysis[?symbol=]`.

## Design principles

1. **Deterministic** — same closed candles produce the same facts; no wall
   clock inside the engines (point-in-time via `asOf`).
2. **Backtestable** — every structure is reconstructible historically; the
   replay/diagnostic stack can adopt the same engines unchanged.
3. **Agentic** — the LLM (Ollama/Gemma layer) consumes structured
   `MarketAnalysis` facts for explanation / ranking / narrative; it is never
   the source of the measurements.

## Consequences

- Environments that do not feed 2h data will report `DEGRADED`/`NOT_READY`
  MTF sync (the 5-pt data-quality confluence bonus drops). Test fixtures and
  production config must preload `2h` (this is the default now).
- The flat `ConfluenceScorer` stays for the legacy pipeline; the hierarchical
  scorer is additive, so historical confluence-score analytics remain
  comparable for legacy setups.
- Scenarios are recomputed per cycle (stateless); persistence of scenario
  state transitions is future work.

## Alternatives considered

- *Keep 4 TFs, treat 2h as an optional derived series* — rejected: the 2h
  structural-context role resolves real ambiguity between the 4h regime and
  1h thesis (the spec's "4H bullish / 2H bearish" case).
- *Let the LLM detect structure from raw candles* — rejected: non-deterministic,
  not backtestable; the LLM narrates structured facts instead.
- *Make the qualification gates hard env flags* — rejected: the gates are
  pure functions of context/thesis; a soft flag would reintroduce the
  "FVG alone becomes LONG READY" failure.
