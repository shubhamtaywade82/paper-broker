import { z } from 'zod';

export const OrderIntentSchema = z
  .object({
    action: z.enum(['OPEN_LONG', 'OPEN_SHORT', 'CLOSE_LONG', 'CLOSE_SHORT', 'HOLD']),
    symbol: z.string().regex(/^[A-Z0-9]+$/, 'must be a valid Binance symbol'),
    confidence: z.number().min(0).max(1),
    stopLossPrice: z.string().regex(/^\d+(\.\d+)?$/).optional(),
    takeProfitPrice: z.string().regex(/^\d+(\.\d+)?$/).optional(),
    reasoning: z.string().optional(),
  })
  .strict();

export type OrderIntent = z.infer<typeof OrderIntentSchema>;

export const parseOrderIntent = (raw: unknown): OrderIntent => {
  return OrderIntentSchema.parse(raw);
};

export const AgentDecisionActionSchema = z.enum([
  'ENTER_LONG',
  'ENTER_SHORT',
  'WAIT',
  'NO_TRADE',
  'EXIT_LONG',
  'EXIT_SHORT',
  'REDUCE',
  'ADD',
  'REVERSE',
]);

export const AgentDecisionSchema = z
  .object({
    action: AgentDecisionActionSchema,
    symbol: z.string().regex(/^[A-Z0-9]+$/, 'must be a valid Binance symbol'),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1),
    requiredEvidence: z.array(z.string()).default([]),
    contradictions: z.array(z.string()).default([]),
    proposal: z
      .object({
        setupId: z.string().optional(),
        direction: z.enum(['LONG', 'SHORT']).optional(),
        entryZone: z.object({ low: z.number(), high: z.number() }).optional(),
        invalidation: z.number().optional(),
        targets: z.array(z.number()).default([]),
      })
      .optional(),
  })
  .strict();

export type AgentDecisionAction = z.infer<typeof AgentDecisionActionSchema>;
export type AgentDecision = z.infer<typeof AgentDecisionSchema>;

/* ============================================================
 * TRADINGAGENTS MULTI-AGENT SCHEMAS (Crypto Futures Adaptation)
 * ============================================================ */

export const AnalystReportSchema = z.object({
  agent: z.string(),
  symbol: z.string(),
  timestamp: z.number(),
  summary: z.string(),
  bullishSignals: z.array(z.string()),
  bearishSignals: z.array(z.string()),
  keyMetrics: z.record(z.string(), z.union([z.string(), z.number()])),
  confidence: z.number().min(0).max(1),
});
export type AnalystReport = z.infer<typeof AnalystReportSchema>;

export const DebateEntrySchema = z.object({
  role: z.enum(['BULL', 'BEAR']),
  round: z.number(),
  argument: z.string(),
});
export type DebateEntry = z.infer<typeof DebateEntrySchema>;

export const DebateVerdictSchema = z.object({
  prevailingSide: z.enum(['BULL', 'BEAR', 'NEUTRAL']),
  rationale: z.string(),
  conviction: z.number().min(0).max(1),
});
export type DebateVerdict = z.infer<typeof DebateVerdictSchema>;

export const TraderDecisionSchema = z.object({
  symbol: z.string(),
  action: z.enum(['LONG', 'SHORT', 'NEUTRAL']),
  leverage: z.number().min(1).max(20),
  sizePct: z.number().min(0).max(0.25),
  entryPrice: z.number().optional(),
  takeProfit: z.number().optional(),
  stopLoss: z.number().optional(),
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
});
export type TraderDecision = z.infer<typeof TraderDecisionSchema>;

export const RiskOpinionSchema = z.object({
  persona: z.enum(['RISKY', 'NEUTRAL', 'SAFE']),
  verdict: z.enum(['APPROVE', 'REDUCE_SIZE', 'REDUCE_LEVERAGE', 'REJECT']),
  adjustedLeverage: z.number().optional(),
  adjustedSizePct: z.number().optional(),
  rationale: z.string(),
});
export type RiskOpinion = z.infer<typeof RiskOpinionSchema>;

export const FundManagerApprovalSchema = z.object({
  approved: z.boolean(),
  finalDecision: TraderDecisionSchema,
  rationale: z.string(),
});
export type FundManagerApproval = z.infer<typeof FundManagerApprovalSchema>;

export const CycleRecordSchema = z.object({
  cycleId: z.string(),
  symbol: z.string(),
  startedAt: z.number(),
  analystReports: z.array(AnalystReportSchema),
  debate: z.array(DebateEntrySchema),
  verdict: DebateVerdictSchema,
  traderDecision: TraderDecisionSchema,
  riskOpinions: z.array(RiskOpinionSchema),
  fundManagerApproval: FundManagerApprovalSchema,
  executed: z.boolean(),
});
export type CycleRecord = z.infer<typeof CycleRecordSchema>;

/* ============================================================
 * AGENTIC LAYER — Reflection + Memory schemas (feature/agentic-upgrade)
 * ============================================================
 *
 * After every closing fill, the SelfImprovementLoop asks the LLM to produce a
 * structured ReflectionSchema — a short, evidence-grounded postmortem of why
 * the trade won or lost. The reflection is persisted to the agent_memory
 * SQLite DB and its distilled lessons are injected into the next analyst
 * cycle's prompt as `ctx.agentMemory`.
 *
 * LLM Authority Contract (CONTRACTS.md §5) is preserved: the reflection is
 * advisory-only, never mutates positions, and never influences the
 * deterministic risk/fund-manager stages.
 */

export const ReflectionSchema = z.object({
  /** What happened in plain language — the LLM's postmortem. */
  reflection: z.string().min(10).max(2_000),
  /** Short, tag-style lessons (e.g. ["SSL sweeps on SOL in ranging regime fade below the 50% retrace"]). */
  lessons: z.array(z.string().min(3).max(300)).max(10).default([]),
  /** Free-text confidence the LLM has in its own postmortem (0..1). */
  selfConfidence: z.number().min(0).max(1).default(0.5),
  /** What to do differently next time, in one sentence. */
  nextTime: z.string().max(500).optional(),
});
export type Reflection = z.infer<typeof ReflectionSchema>;
