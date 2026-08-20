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