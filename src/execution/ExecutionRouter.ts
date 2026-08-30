import type { RuntimeProfile } from '../config/modes/types.js';
import type {
  ExecutionBroker,
  OrderCommand,
  Order,
  Position,
  AccountState,
} from '../broker/types.js';
import { LiveTradingGuard } from './LiveTradingGuard.js';
import { ulid } from 'ulid';

export interface ExecutionRouterOptions {
  profile: RuntimeProfile;
  paperBroker: ExecutionBroker;
  coindcxBroker?: ExecutionBroker;
  guard?: LiveTradingGuard;
}

export class ExecutionRouter implements ExecutionBroker {
  private profile: RuntimeProfile;
  private paperBroker: ExecutionBroker;
  private coindcxBroker?: ExecutionBroker;
  private guard: LiveTradingGuard;

  constructor(options: ExecutionRouterOptions) {
    this.profile = options.profile;
    this.paperBroker = options.paperBroker;
    this.coindcxBroker = options.coindcxBroker;
    this.guard = options.guard || new LiveTradingGuard();
  }

  public getActiveBroker(): ExecutionBroker {
    if (this.wantsRealOrders() && this.coindcxBroker) {
      return this.coindcxBroker;
    }
    return this.paperBroker;
  }

  /** True when the profile is asking for orders to reach a real venue. */
  private wantsRealOrders(): boolean {
    return (
      this.profile.executionVenue === 'COINDCX' &&
      this.profile.liveArmed &&
      this.profile.realOrders
    );
  }

  /**
   * The profile demands real orders but no live venue adapter was supplied.
   *
   * Falling through to the paper broker here would be the worst possible
   * outcome: the operator has explicitly set TRADING_MODE=live and armed it,
   * the dashboard reports "REAL ORDERS: YES (ARMED)", and the fills would be
   * simulated. Every downstream number — PnL, equity, risk state — would be
   * fiction presented as live trading. Reject instead, loudly.
   */
  private isMissingLiveAdapter(): boolean {
    return this.wantsRealOrders() && !this.coindcxBroker;
  }

  public async submitOrder(command: OrderCommand): Promise<Order> {
    const check = this.isMissingLiveAdapter()
      ? {
          allowed: false,
          reason:
            'NO_LIVE_EXECUTION_ADAPTER: TRADING_MODE=live is armed but no live venue adapter is registered. ' +
            'Refusing to simulate fills while reporting live execution.',
        }
      : this.guard.canExecute(this.profile);

    if (!check.allowed) {
      const nowIso = new Date().toISOString();
      return {
        id: ulid(),
        clientOrderId: command.clientOrderId || ulid(),
        accountId: 'router-guard',
        symbol: command.symbol,
        strategyId: command.strategyId,
        signalId: command.signalId,
        side: command.side,
        type: command.type,
        timeInForce: command.timeInForce || 'GTC',
        status: 'REJECTED',
        positionSide: 'BOTH',
        quantity: command.quantity,
        filledQty: 0,
        avgFillPrice: 0,
        leverage: command.leverage ?? 1,
        reduceOnly: Boolean(command.reduceOnly),
        postOnly: Boolean(command.postOnly),
        closePosition: Boolean(command.closePosition),
        rejectReason: check.reason,
        submittedAtUtc: nowIso,
        updatedAtUtc: nowIso,
      };
    }

    const broker = this.getActiveBroker();
    return broker.submitOrder(command);
  }

  public async cancelOrder(orderId: string, reason?: string, nowIso?: string): Promise<Order | undefined> {
    return this.getActiveBroker().cancelOrder(orderId, reason, nowIso);
  }

  public async cancelAllOrders(symbol?: string): Promise<void> {
    return this.getActiveBroker().cancelAllOrders(symbol);
  }

  public async getOpenOrders(symbol?: string): Promise<Order[]> {
    return this.getActiveBroker().getOpenOrders(symbol);
  }

  public async getPositions(): Promise<Position[]> {
    return this.getActiveBroker().getPositions();
  }

  public async getPosition(symbol: string): Promise<Position | undefined> {
    return this.getActiveBroker().getPosition(symbol);
  }

  public async getAccount(): Promise<AccountState> {
    return this.getActiveBroker().getAccount();
  }

  public async resetAccount(startingUsdt?: number): Promise<AccountState> {
    const broker = this.getActiveBroker();
    if ('resetAccount' in broker && typeof (broker as unknown as { resetAccount: (val?: number) => AccountState }).resetAccount === 'function') {
      return (broker as unknown as { resetAccount: (val?: number) => AccountState }).resetAccount(startingUsdt);
    }
    return this.getAccount();
  }
}
