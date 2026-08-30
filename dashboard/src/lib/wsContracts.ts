import { z } from 'zod';

/**
 * WebSocket message contracts.
 *
 * IMPORTANT: the backend `WebSocketGateway.broadcast()` (see
 * src/api/websocket/WebSocketGateway.ts) emits messages in the shape
 *   { type: '<event-name>', payload: <object>, timestampUtc: '<iso>' }
 * The dashboard previously used a different shape ({ channel, data }) which
 * silently failed `WsMessageSchema.parse()` on every backend broadcast and
 * dropped the frame. These contracts now match the backend exactly so the
 * dashboard actually receives events.
 *
 * Strict (non-passthrough) schemas are used throughout — adding `.passthrough()`
 * widens declared fields to `T | {}` via TypeScript's index-signature widening,
 * which breaks type-narrowed access in the UI. Unknown extra fields are dropped
 * at parse time, which is the safe default for a UI client.
 */

export const TickSchema = z.object({
  symbol: z.string(),
  price: z.number(),
  markPrice: z.number().optional(),
  orderbook: z
    .object({
      bids: z.array(z.tuple([z.number(), z.number()])),
      asks: z.array(z.tuple([z.number(), z.number()])),
    })
    .optional(),
  candle: z.unknown().optional(),
});

export const PositionUpdatedSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  side: z.enum(['LONG', 'SHORT']),
  quantity: z.number(),
  entryPrice: z.number(),
  markPrice: z.number(),
  unrealizedPnl: z.number(),
  status: z.enum(['OPEN', 'CLOSED', 'LIQUIDATED']),
});

export const OrderUpdatedSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  side: z.enum(['BUY', 'SELL']),
  type: z.string(),
  status: z.string(),
  filledQuantity: z.number(),
});

export const SignalSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  action: z.string(),
  confidence: z.number().optional(),
  timestamp: z.number().optional(),
});

export const IncidentSchema = z.object({
  id: z.string(),
  level: z.enum(['warning', 'critical', 'info', 'error']),
  summary: z.string(),
});

/**
 * Autonomous agent event schemas. The agent broadcasts 8 distinct event
 * types — one per brain module or per-cycle transition. We only validate
 * the discriminator + a handful of fields the UI reads directly; everything
 * else flows through as `unknown` and is rendered defensively.
 */
export const AutonomousCycleSchema = z
  .object({
    cycleId: z.string(),
    startedAt: z.number(),
    completedAt: z.number(),
    durationMs: z.number(),
    symbolsScanned: z.number(),
    regimesChanged: z.number(),
    formingSetups: z.number(),
    readySetups: z.number(),
    signalsSubmitted: z.number(),
    signalsRejected: z.number(),
    standingAsideSymbols: z.number(),
    circuitBreakerTripped: z.boolean(),
    runtimeRiskMultiplier: z.number(),
    rollingWinRate: z.number(),
    /** Inline health snapshot — same shape as `agent.autonomous.health`. */
    health: z.object({
      healthy: z.boolean(),
      issues: z
        .array(
          z.object({
            kind: z.string(),
            symbol: z.string().optional(),
            timeframe: z.string().optional(),
            detail: z.string(),
          }),
        )
        .default([]),
      lastCheckedAt: z.number(),
    }),
    /** Inline exit decisions taken this cycle. */
    exits: z
      .array(
        z.object({
          symbol: z.string(),
          action: z.string(),
          reason: z.string().nullable(),
          confidence: z.number(),
          context: z.record(z.unknown()).default({}),
        }),
      )
      .default([]),
    decisions: z
      .array(
        z.object({
          symbol: z.string(),
          state: z.string(),
          regime: z.string().nullable(),
          setupState: z.string().nullable(),
          setupType: z.string().nullable(),
          confluenceScore: z.number().nullable(),
          action: z.string(),
          reason: z.string(),
        }),
      )
      .default([]),
  });

export const AutonomousFormingSchema = z.object({
  cycleId: z.string(),
  symbol: z.string(),
  setupId: z.string().optional(),
  setupType: z.string(),
  state: z.string(),
  direction: z.string().optional(),
  confluenceScore: z.number().optional(),
});

export const AutonomousRegimeSchema = z.object({
  cycleId: z.string(),
  symbol: z.string(),
  from: z.string(),
  to: z.string(),
  confidence: z.number(),
  /** Per-regime confirmation bars that were required to commit this change (Finding 6). */
  confirmations: z.number().optional(),
});

export const AutonomousSignalSchema = z.object({
  cycleId: z.string(),
  symbol: z.string(),
  action: z.string(),
  confidence: z.number(),
  regime: z.string(),
  setupType: z.string(),
  confluenceScore: z.number(),
  entryPrice: z.number(),
  stopLossPrice: z.number(),
  takeProfitPrice: z.number(),
  leverage: z.number(),
  sizePct: z.number(),
  rr: z.number(),
  rationale: z.string(),
  submittedAt: z.number(),
  signalId: z.string().optional(),
});

export const AutonomousRejectedSchema = z.object({
  cycleId: z.string(),
  symbol: z.string(),
  action: z.string(),
  reason: z.string(),
  signalId: z.string().nullable().optional(),
});

export const AutonomousCircuitBreakerSchema = z.object({
  action: z.enum(['tripped', 'cleared']),
  reason: z.string(),
  trippedAt: z.number().optional(),
  clearedAt: z.number().optional(),
  cooldownEndsAt: z.number().optional(),
});

export const AutonomousHealthSchema = z.object({
  healthy: z.boolean(),
  issues: z
    .array(
      z.object({
        kind: z.string(),
        symbol: z.string().optional(),
        timeframe: z.string().optional(),
        detail: z.string(),
      }),
    )
    .default([]),
  lastCheckedAt: z.number(),
});

export const AutonomousExitSchema = z.object({
  cycleId: z.string(),
  symbol: z.string(),
  action: z.string(),
  reason: z.string(),
  accepted: z.boolean(),
  signalId: z.string().nullable().optional(),
});

export const AutonomousLearningSchema = z.object({
  cycleId: z.string(),
  parameter: z.string(),
  from: z.number(),
  to: z.number(),
  rollingWinRate: z.number(),
  rollingSampleSize: z.number(),
});

export const KlineClosedSchema = z.object({
  symbol: z.string(),
  interval: z.string(),
  openTime: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});

/**
 * One stage transition inside a manually triggered or strategy-driven agent
 * cycle. Broadcast from engine.ts (`onCycleStep`, adaptive-supertrend signals)
 * and from the `/agents/trigger` route in server.ts.
 *
 * `payload` is intentionally permissive beyond the four fields consumers
 * actually read — the backend adds context (detail, tokens, model) per stage
 * and a strict schema here would silently drop frames again.
 */
export const AgentStepSchema = z
  .object({
    cycleId: z.string(),
    symbol: z.string(),
    stage: z.string(),
    status: z.string(),
    detail: z.string().optional(),
    timestamp: z.number().optional(),
  })
  .passthrough();

/** Completed agent cycle summary (distinct from `agent.autonomous.cycle`). */
export const AgentCycleSchema = z.object({}).passthrough();

export const WsMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('market.tick'), payload: TickSchema, timestampUtc: z.string().optional() }),
  z.object({ type: z.literal('position.updated'), payload: PositionUpdatedSchema, timestampUtc: z.string().optional() }),
  z.object({ type: z.literal('order.updated'), payload: OrderUpdatedSchema, timestampUtc: z.string().optional() }),
  z.object({ type: z.literal('signal.created'), payload: SignalSchema, timestampUtc: z.string().optional() }),
  z.object({ type: z.literal('incident.alert'), payload: IncidentSchema, timestampUtc: z.string().optional() }),
  // Autonomous agent events (8 types) — see src/agent/AutonomousTradingAgent.ts
  // and its brain-module collaborators for the broadcast sites.
  z.object({ type: z.literal('agent.autonomous.cycle'), payload: AutonomousCycleSchema, timestampUtc: z.string().optional() }),
  z.object({ type: z.literal('agent.autonomous.forming'), payload: AutonomousFormingSchema, timestampUtc: z.string().optional() }),
  z.object({ type: z.literal('agent.autonomous.regime'), payload: AutonomousRegimeSchema, timestampUtc: z.string().optional() }),
  z.object({ type: z.literal('agent.autonomous.signal'), payload: AutonomousSignalSchema, timestampUtc: z.string().optional() }),
  z.object({ type: z.literal('agent.autonomous.rejected'), payload: AutonomousRejectedSchema, timestampUtc: z.string().optional() }),
  z.object({ type: z.literal('agent.autonomous.circuit_breaker'), payload: AutonomousCircuitBreakerSchema, timestampUtc: z.string().optional() }),
  z.object({ type: z.literal('agent.autonomous.health'), payload: AutonomousHealthSchema, timestampUtc: z.string().optional() }),
  z.object({ type: z.literal('agent.autonomous.exit'), payload: AutonomousExitSchema, timestampUtc: z.string().optional() }),
  z.object({ type: z.literal('agent.autonomous.learning'), payload: AutonomousLearningSchema, timestampUtc: z.string().optional() }),
  z.object({ type: z.literal('kline.closed'), payload: KlineClosedSchema, timestampUtc: z.string().optional() }),
  // Debate-pipeline events. Omitting these from the union did not merely leave
  // them unhandled — wsConnection parses every frame against this schema and
  // drops parse failures silently, so the backend's agent.step broadcasts were
  // discarded at the socket boundary and never reached any store.
  z.object({ type: z.literal('agent.step'), payload: AgentStepSchema, timestampUtc: z.string().optional() }),
  z.object({ type: z.literal('agent.cycle'), payload: AgentCycleSchema, timestampUtc: z.string().optional() }),
  z.object({ type: z.literal('account.reset'), payload: z.object({}).passthrough(), timestampUtc: z.string().optional() }),
]);

export type WsMessage = z.infer<typeof WsMessageSchema>;
export type Position = z.infer<typeof PositionUpdatedSchema>;
export type Order = z.infer<typeof OrderUpdatedSchema>;
export type Signal = z.infer<typeof SignalSchema>;
export type Incident = z.infer<typeof IncidentSchema>;

// Re-export the autonomous payload types so the UI/store can reference them
// without re-inferring from the schema.
export type AutonomousCycle = z.infer<typeof AutonomousCycleSchema>;
export type AutonomousForming = z.infer<typeof AutonomousFormingSchema>;
export type AutonomousRegime = z.infer<typeof AutonomousRegimeSchema>;
export type AutonomousSignal = z.infer<typeof AutonomousSignalSchema>;
export type AutonomousRejected = z.infer<typeof AutonomousRejectedSchema>;
export type AutonomousCircuitBreaker = z.infer<typeof AutonomousCircuitBreakerSchema>;
export type AutonomousHealth = z.infer<typeof AutonomousHealthSchema>;
export type AutonomousExit = z.infer<typeof AutonomousExitSchema>;
export type AutonomousLearning = z.infer<typeof AutonomousLearningSchema>;
