import type { PaperAccountState, PaperPosition } from './types.js';

export class PaperAccount {
  private balance: number;
  private totalFees = 0;
  private realizedPnl = 0;

  constructor(initialBalance = 10_000) {
    this.balance = initialBalance;
  }

  getAccountState(positions: PaperPosition[] = []): PaperAccountState {
    let usedMargin = 0;
    let unrealizedPnl = 0;

    for (const pos of positions) {
      if (pos.state === 'OPEN') {
        usedMargin += pos.usedMargin;
        unrealizedPnl += pos.unrealizedPnl;
      }
    }

    const equity = this.balance + unrealizedPnl;
    const availableBalance = Math.max(0, equity - usedMargin);

    return {
      balance: Number(this.balance.toFixed(2)),
      equity: Number(equity.toFixed(2)),
      availableBalance: Number(availableBalance.toFixed(2)),
      usedMargin: Number(usedMargin.toFixed(2)),
      unrealizedPnl: Number(unrealizedPnl.toFixed(4)),
      realizedPnl: Number(this.realizedPnl.toFixed(4)),
      totalFees: Number(this.totalFees.toFixed(4)),
    };
  }

  chargeFee(fee: number): void {
    this.totalFees += fee;
    this.balance = Number((this.balance - fee).toFixed(4));
  }

  creditRealizedPnl(grossPnl: number): void {
    this.realizedPnl += grossPnl;
    this.balance = Number((this.balance + grossPnl).toFixed(4));
  }

  reset(initialBalance = 10_000): void {
    this.balance = initialBalance;
    this.totalFees = 0;
    this.realizedPnl = 0;
  }
}
