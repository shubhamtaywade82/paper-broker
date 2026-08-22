import type { AccountState as BrokerAccountState, Order, Position as BrokerPosition } from '../../broker/types.js';
import type { AccountState as RiskAccountState, PortfolioPosition } from './types.js';

export function toRiskAccountState(account: BrokerAccountState): RiskAccountState {
  return {
    equity: account.equity,
    availableBalance: account.availableBalance,
    dailyLoss: Math.max(0, -(account.dailyRealizedPnl ?? 0)),
    realizedPnl: account.totalRealizedPnl,
  };
}

export function toPortfolioPositions(
  positions: BrokerPosition[],
  openOrders: Order[]
): PortfolioPosition[] {
  return positions
    .filter((p) => p.status === 'OPEN')
    .map((p) => {
      const stopOrder = openOrders.find(
        (o) => o.symbol === p.symbol && o.type === 'STOP_MARKET' && o.reduceOnly
      );
      return {
        symbol: p.symbol,
        side: p.qty >= 0 ? 'LONG' : 'SHORT',
        quantity: Math.abs(p.qty),
        entryPrice: p.entryPrice,
        stopLossPrice: stopOrder?.stopPrice ?? p.entryPrice,
        notional: Math.abs(p.qty) * (p.markPrice ?? p.entryPrice),
        unrealizedPnl: p.unrealizedPnl,
      };
    });
}
