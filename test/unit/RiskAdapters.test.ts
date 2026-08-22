import { describe, it, expect } from 'vitest';
import { toRiskAccountState, toPortfolioPositions } from '../../src/trading/risk/adapters.js';
import type { AccountState, Position, Order } from '../../src/broker/types.js';

describe('toRiskAccountState', () => {
  it('maps broker account fields to risk account shape', () => {
    const account: AccountState = {
      walletBalance: 10000,
      unrealizedPnl: 50,
      equity: 10050,
      initialMargin: 500,
      maintenanceMargin: 100,
      availableBalance: 9550,
      totalFees: 20,
      totalFunding: 5,
      totalRealizedPnl: 300,
      openPositionsCount: 1,
      openOrdersCount: 2,
      dailyRealizedPnl: -75,
      liquidations: 0,
    };

    const risk = toRiskAccountState(account);

    expect(risk.equity).toBe(10050);
    expect(risk.availableBalance).toBe(9550);
    expect(risk.dailyLoss).toBe(75);
    expect(risk.realizedPnl).toBe(300);
  });

  it('treats a positive dailyRealizedPnl as zero daily loss', () => {
    const account = {
      walletBalance: 10000, unrealizedPnl: 0, equity: 10200, initialMargin: 0,
      maintenanceMargin: 0, availableBalance: 10200, totalFees: 0, totalFunding: 0,
      totalRealizedPnl: 200, openPositionsCount: 0, openOrdersCount: 0, dailyRealizedPnl: 200,
      liquidations: 0,
    } as AccountState;

    expect(toRiskAccountState(account).dailyLoss).toBe(0);
  });

  it('defaults to zero daily loss when dailyRealizedPnl is absent', () => {
    const account = {
      walletBalance: 10000, unrealizedPnl: 0, equity: 10000, initialMargin: 0,
      maintenanceMargin: 0, availableBalance: 10000, totalFees: 0, totalFunding: 0,
      totalRealizedPnl: 0, openPositionsCount: 0, openOrdersCount: 0,
      liquidations: 0,
    } as AccountState;

    expect(toRiskAccountState(account).dailyLoss).toBe(0);
  });
});

describe('toPortfolioPositions', () => {
  it('maps an open long position with a matching stop order', () => {
    const positions: Position[] = [{
      accountId: 'paper-main', symbol: 'BTCUSDT', positionSide: 'LONG', status: 'OPEN',
      qty: 0.5, entryPrice: 60000, unrealizedPnl: 100, realizedPnl: 0, leverage: 5,
      initialMargin: 6000, maintenanceMargin: 300, maintenanceMarginRate: 0.05,
      totalFees: 0, totalFunding: 0, updatedAtUtc: '2026-08-22T00:00:00Z',
    } as Position];
    const orders: Order[] = [{
      id: 'o1', clientOrderId: 'c1', accountId: 'paper-main', symbol: 'BTCUSDT',
      side: 'SELL', type: 'STOP_MARKET', timeInForce: 'GTC', status: 'NEW',
      positionSide: 'LONG', quantity: 0.5, filledQty: 0, stopPrice: 58500,
      avgFillPrice: 0, leverage: 5, reduceOnly: true, postOnly: false, closePosition: false,
      submittedAtUtc: '2026-08-22T00:00:00Z', updatedAtUtc: '2026-08-22T00:00:00Z',
    } as Order];

    const result = toPortfolioPositions(positions, orders);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      symbol: 'BTCUSDT', side: 'LONG', quantity: 0.5, entryPrice: 60000,
      stopLossPrice: 58500, unrealizedPnl: 100,
    });
  });

  it('falls back to entry price when no matching stop order exists', () => {
    const positions: Position[] = [{
      accountId: 'paper-main', symbol: 'ETHUSDT', positionSide: 'SHORT', status: 'OPEN',
      qty: -2, entryPrice: 3000, unrealizedPnl: -10, realizedPnl: 0, leverage: 3,
      initialMargin: 2000, maintenanceMargin: 100, maintenanceMarginRate: 0.05,
      totalFees: 0, totalFunding: 0, updatedAtUtc: '2026-08-22T00:00:00Z',
    } as Position];

    const result = toPortfolioPositions(positions, []);

    expect(result[0]?.side).toBe('SHORT');
    expect(result[0]?.stopLossPrice).toBe(3000);
    expect(result[0]?.quantity).toBe(2);
  });

  it('excludes closed positions', () => {
    const positions: Position[] = [{
      accountId: 'paper-main', symbol: 'SOLUSDT', positionSide: 'LONG', status: 'CLOSED',
      qty: 0, entryPrice: 140, unrealizedPnl: 0, realizedPnl: 20, leverage: 5,
      initialMargin: 0, maintenanceMargin: 0, maintenanceMarginRate: 0.05,
      totalFees: 0, totalFunding: 0, updatedAtUtc: '2026-08-22T00:00:00Z',
    } as Position];

    expect(toPortfolioPositions(positions, [])).toHaveLength(0);
  });
});
