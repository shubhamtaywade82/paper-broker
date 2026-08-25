import { z } from 'zod';

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

export const WsMessageSchema = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('market.tick'), data: TickSchema }),
  z.object({ channel: z.literal('position.updated'), data: PositionUpdatedSchema }),
  z.object({ channel: z.literal('order.updated'), data: OrderUpdatedSchema }),
  z.object({ channel: z.literal('signal.created'), data: SignalSchema }),
  z.object({ channel: z.literal('incident.alert'), data: IncidentSchema }),
]);

export type WsMessage = z.infer<typeof WsMessageSchema>;
export type Position = z.infer<typeof PositionUpdatedSchema>;
export type Order = z.infer<typeof OrderUpdatedSchema>;
export type Signal = z.infer<typeof SignalSchema>;
export type Incident = z.infer<typeof IncidentSchema>;
