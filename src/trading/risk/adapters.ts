import { Decimal } from 'decimal.js';
import type { AccountState as BrokerAccountState, Order, Position as BrokerPosition } from '../../broker/types.js';
import type { AccountState as RiskAccountState, PortfolioPosition } from './types.js';

export function toRiskAccountState(account: BrokerAccountState): RiskAccountState {
  const dailyRealizedPnlDecimal = new Decimal(account.dailyRealizedPnl ?? 0);
  const dailyLoss = dailyRealizedPnlDecimal.isNegative()
    ? dailyRealizedPnlDecimal.abs().toNumber()
    : 0;

  return {
    equity: account.equity,
    availableBalance: account.availableBalance,
    dailyLoss,
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
        notional: new Decimal(Math.abs(p.qty)).mul(p.markPrice ?? p.entryPrice).toNumber(),
        unrealizedPnl: p.unrealizedPnl,
      };
    });
}
