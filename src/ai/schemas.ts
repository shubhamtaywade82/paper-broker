import { z } from 'zod';

/* ============================================================
 * TRADINGAGENTS MULTI-AGENT SCHEMAS (Crypto Futures Adaptation)
 * ============================================================ */

export const AnalystReportSchema = z.object({
  agent: z.string().default('DerivativesAnalyst'),
  symbol: z.string().default(''),
  timestamp: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === 'number' ? v : Date.now()))
    .default(() => Date.now()),
  summary: z.string().default(''),
  bullishSignals: z.array(z.string()).default([]),
  bearishSignals: z.array(z.string()).default([]),
  keyMetrics: z.record(z.string(), z.unknown()).default({}),
  confidence: z
    .coerce
    .number()
    .transform((v) => (v > 1 ? Math.min(1, v / 100) : Math.max(0, v)))
    .default(0.5),
});
export type AnalystReport = z.infer<typeof AnalystReportSchema>;

export const DebateEntrySchema = z.object({
  role: z.enum(['BULL', 'BEAR']),
  round: z.coerce.number().default(1),
  argument: z.string().default(''),
});
export type DebateEntry = z.infer<typeof DebateEntrySchema>;

export const DebateVerdictSchema = z.object({
  prevailingSide: z
    .preprocess((v) => {
      if (typeof v === 'string') {
        const upper = v.toUpperCase().trim();
        if (upper.includes('BULL') || upper === 'LONG' || upper === 'BUY') return 'BULL';
        if (upper.includes('BEAR') || upper === 'SHORT' || upper === 'SELL') return 'BEAR';
        return 'NEUTRAL';
      }
      return v;
    }, z.enum(['BULL', 'BEAR', 'NEUTRAL']))
    .default('NEUTRAL'),
  rationale: z.string().default('Debate evaluated'),
  conviction: z
    .coerce
    .number()
    .transform((v) => (v > 1 ? Math.min(1, v / 100) : Math.max(0, v)))
    .default(0.5),
});
export type DebateVerdict = z.infer<typeof DebateVerdictSchema>;

export const TraderDecisionSchema = z.object({
  symbol: z.string().default(''),
  action: z
    .preprocess((v) => {
      if (typeof v === 'string') {
        const upper = v.toUpperCase().trim();
        if (upper === 'BUY' || upper.includes('LONG')) return 'LONG';
        if (upper === 'SELL' || upper.includes('SHORT')) return 'SHORT';
        return 'NEUTRAL';
      }
      return v;
    }, z.enum(['LONG', 'SHORT', 'NEUTRAL']))
    .default('NEUTRAL'),
  leverage: z
    .coerce
    .number()
    .transform((v) => Math.max(1, Math.min(20, Math.round(v))))
    .default(1),
  sizePct: z
    .coerce
    .number()
    .transform((v) => (v > 1 ? Math.min(0.25, v / 100) : Math.max(0, Math.min(0.25, v))))
    .default(0.05),
  entryPrice: z.coerce.number().optional(),
  takeProfit: z.coerce.number().optional(),
  stopLoss: z.coerce.number().optional(),
  rationale: z.string().default('Trader decision'),
  confidence: z
    .coerce
    .number()
    .transform((v) => (v > 1 ? Math.min(1, v / 100) : Math.max(0, v)))
    .default(0.5),
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
