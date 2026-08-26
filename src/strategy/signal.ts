import { z } from 'zod';

export const SignalActionSchema = z.enum([
  'OPEN_LONG',
  'OPEN_SHORT',
  'CLOSE_LONG',
  'CLOSE_SHORT',
  'CANCEL_ALL',
  'HOLD',
]);

export const SignalStatusSchema = z.enum([
  'CREATED',
  'ACCEPTED',
  'REJECTED',
  'EXECUTED',
  'EXPIRED',
]);

const decimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal string')
  .optional();

export const SignalInputSchema = z.object({
  strategyId: z.string().min(1),
  symbol: z.string().min(1),
  action: SignalActionSchema,
  confidence: z.number().min(0).max(1),
  stopLossPrice: decimalString,
  takeProfitPrice: decimalString,
  ttlMs: z.number().int().positive().default(60000),
  features: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
  reasoning: z.string().optional(),
});

export const SignalSchema = SignalInputSchema.extend({
  id: z.string().min(1),
  ts: z.number().int(),
  status: SignalStatusSchema,
  orderId: z.string().optional(),
  rejectReason: z.string().optional(),
});

export type SignalAction = z.infer<typeof SignalActionSchema>;
export type SignalStatus = z.infer<typeof SignalStatusSchema>;
export type SignalInput = z.infer<typeof SignalInputSchema>;
export type Signal = z.infer<typeof SignalSchema>;

export function parseSignalInput(input: unknown): SignalInput {
  return SignalInputSchema.parse(input);
}

export function toSignal(input: SignalInput, ts: number = Date.now()): Signal {
  return {
    ...input,
    id: crypto.randomUUID(),
    ts,
    status: 'CREATED',
  };
}

export function signalIsExpired(signal: Signal, now: number = Date.now()): boolean {
  return now - signal.ts > signal.ttlMs;
}

export function signalsEqual(a: SignalInput, b: SignalInput): boolean {
  const sameIdentity =
    a.strategyId === b.strategyId && a.symbol === b.symbol && a.action === b.action;
  if (!sameIdentity) return false;
  // Identity dedup by default. Signals that carry an explicit `dedupKey`
  // feature only dedup against another signal with the SAME key — this lets
  // the autonomous agent submit multiple OPEN/CLOSE signals for the same
  // symbol + action (pyramiding adds, partial de-risks) without being
  // silently dropped, while still protecting each logical intent from
  // double-submission.
  const aKey = a.features['dedupKey'];
  const bKey = b.features['dedupKey'];
  if (aKey !== undefined || bKey !== undefined) {
    return aKey !== undefined && aKey === bKey;
  }
  return true;
}