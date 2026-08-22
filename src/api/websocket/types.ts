export type WebSocketEventType =
  | 'market.tick'
  | 'signal.created'
  | 'order.updated'
  | 'order.filled'
  | 'position.updated'
  | 'health.updated'
  | 'incident.reported'
  | 'mode.changed'
  | 'kill_switch.activated'
  | 'trade.stream'
  | 'book.update'
  | 'agent.cycle';

export interface WebSocketMessage<T = unknown> {
  type: WebSocketEventType;
  payload: T;
  timestampUtc: string;
}
