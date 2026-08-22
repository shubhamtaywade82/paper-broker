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

export const OllamaCompletionSchema = z.object({
  response: z.string(),
  model: z.string().optional(),
  done: z.boolean().optional(),
});

export const parseOrderIntent = (raw: unknown): OrderIntent => {
  return OrderIntentSchema.parse(raw);
};

export const extractJsonFromResponse = (response: string): unknown => {
  const trimmed = response.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1]);
  }

  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');

  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    return JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
  }

  throw new Error('No JSON object found in response');
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
