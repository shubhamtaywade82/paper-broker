export type WebSocketEventType =
  | 'market.tick'
  | 'kline.closed'
  | 'signal.created'
  | 'order.updated'
  | 'order.filled'
  | 'position.updated'
  | 'health.updated'
  | 'incident.reported'
  | 'mode.changed'
  | 'mode.aggressive'
  | 'kill_switch.activated'
  | 'trade.stream'
  | 'book.update'
  | 'agent.cycle'
  | 'agent.step'
  | 'profit.goal'
  | 'strategy.performance'
  | 'setup.performance'
  | 'trailing.stop'
  | 'reconciliation.report';

export interface WebSocketMessage<T = unknown> {
  type: WebSocketEventType;
  payload: T;
  timestampUtc: string;
}
