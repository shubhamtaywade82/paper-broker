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
  | 'trailing.stop'
  | 'agent.autonomous.cycle'
  | 'agent.autonomous.forming'
  | 'agent.autonomous.regime'
  | 'agent.autonomous.analysis'
  | 'agent.autonomous.signal'
  | 'agent.autonomous.rejected'
  | 'agent.autonomous.circuit_breaker'
  | 'agent.autonomous.health'
  | 'agent.autonomous.exit'
  | 'agent.autonomous.learning'
  | 'setup.performance'
  | 'reconciliation.report'
  | 'account.reset';

export interface WebSocketMessage<T = unknown> {
  type: WebSocketEventType;
  payload: T;
  timestampUtc: string;
}
