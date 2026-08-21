import { ulid } from 'ulid';
import { CoinDCXClient } from '@nemesis-oss/coindcx-sdk';
import type {
  ExecutionBroker,
  OrderCommand,
  Order,
  Position,
  AccountState,
  OrderType,
  PositionSide,
} from '../broker/types.js';

export interface CoinDCXBrokerConfig {
  apiKey?: string;
  apiSecret?: string;
  client?: CoinDCXClient;
}

export class CoinDCXBroker implements ExecutionBroker {
  private client: CoinDCXClient;
  private orders = new Map<string, Order>();
  private positions = new Map<string, Position>();

  constructor(config: CoinDCXBrokerConfig) {
    this.client =
      config.client ??
      new CoinDCXClient({
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
      });
  }

  private mapToPair(symbol: string): { pair: string; base: string; quote: string } {
    const clean = symbol.replace('/', '').toUpperCase();
    const base = clean.replace(/USDT$/, '');
    const quote = 'USDT';
    const pair = `B-${base}_${quote}`;
    return { pair, base, quote };
  }

  private mapOrderType(type: OrderType): 'market_order' | 'limit_order' | 'stop_limit_order' {
    if (type === 'LIMIT') return 'limit_order';
    if (type === 'STOP_MARKET' || type === 'STOP' || type === 'TRAILING_STOP_MARKET') {
      return 'stop_limit_order';
    }
    return 'market_order';
  }

  public async submitOrder(command: OrderCommand): Promise<Order> {
    const { base, quote } = this.mapToPair(command.symbol);
    const side = command.side.toLowerCase() as 'buy' | 'sell';
    const orderType = this.mapOrderType(command.type);

    const res = await this.client.futures.trading.createOrder({
      side,
      order_type: orderType,
      base_currency: base,
      quote_currency: quote,
      target_quantity: command.quantity,
      price: command.price,
      leverage: command.leverage ?? 5,
      client_order_id: command.clientOrderId,
      time_in_force: 'gtc',
      stop_loss: command.stopPrice,
      take_profit: undefined,
      margin_type: command.marginType === 'ISOLATED' ? 'isolated' : 'cross',
    });

    const nowIso = new Date().toISOString();
    const orderId = (res as { id?: string; order_id?: string })?.id ||
      (res as { id?: string; order_id?: string })?.order_id ||
      ulid();

    const order: Order = {
      id: orderId,
      clientOrderId: command.clientOrderId || ulid(),
      accountId: 'coindcx-live',
      symbol: command.symbol,
      strategyId: command.strategyId,
      signalId: command.signalId,
      side: command.side,
      type: command.type,
      timeInForce: command.timeInForce || 'GTC',
      status: 'NEW',
      positionSide: 'BOTH',
      quantity: command.quantity,
      filledQty: 0,
      limitPrice: command.price,
      stopPrice: command.stopPrice,
      avgFillPrice: 0,
      leverage: command.leverage ?? 5,
      reduceOnly: Boolean(command.reduceOnly),
      postOnly: Boolean(command.postOnly),
      closePosition: Boolean(command.closePosition),
      submittedAtUtc: nowIso,
      updatedAtUtc: nowIso,
    };

    this.orders.set(order.id, order);
    return order;
  }

  public async cancelOrder(orderId: string, _reason = 'USER_CANCEL', nowIso = new Date().toISOString()): Promise<Order | undefined> {
    await this.client.futures.trading.cancelOrder({ id: orderId });
    const order = this.orders.get(orderId);
    if (order) {
      order.status = 'CANCELED';
      order.updatedAtUtc = nowIso;
    }
    return order;
  }

  public async cancelAllOrders(symbol?: string): Promise<void> {
    const pair = symbol ? this.mapToPair(symbol).pair : undefined;
    await this.client.futures.trading.cancelAllOrders({ pair, side: undefined });
    for (const order of this.orders.values()) {
      if (!symbol || order.symbol === symbol) {
        order.status = 'CANCELED';
        order.updatedAtUtc = new Date().toISOString();
      }
    }
  }

  public async getOpenOrders(symbol?: string): Promise<Order[]> {
    const active = Array.from(this.orders.values()).filter(
      (o) => o.status === 'NEW' || o.status === 'PARTIALLY_FILLED'
    );
    if (!symbol) return active;
    return active.filter((o) => o.symbol === symbol);
  }

  public async getPositions(): Promise<Position[]> {
    const res = await this.client.futures.trading.getPositions({});
    const list: Position[] = [];
    const nowIso = new Date().toISOString();

    if (Array.isArray(res)) {
      for (const p of res) {
        const pair = String(p.pair || '');
        const cleanSymbol = pair.replace(/^B-/, '').replace('_', '');
        const qty = Number(p.size || 0);
        if (qty === 0) continue;

        const pos: Position = {
          accountId: 'coindcx-live',
          symbol: cleanSymbol,
          positionSide: (p.side === 'short' ? 'SHORT' : 'LONG') as PositionSide,
          status: 'OPEN',
          qty: Math.abs(qty),
          entryPrice: Number(p.entry_price || 0),
          unrealizedPnl: Number(p.unrealized_pnl || 0),
          realizedPnl: Number(p.realized_pnl || 0),
          leverage: Number(p.leverage || 5),
          initialMargin: Number(p.margin || 0),
          maintenanceMargin: 0,
          maintenanceMarginRate: 0.005,
          totalFees: 0,
          totalFunding: 0,
          updatedAtUtc: nowIso,
        };
        list.push(pos);
        this.positions.set(pos.symbol, pos);
      }
    }

    return list;
  }

  public async getPosition(symbol: string): Promise<Position | undefined> {
    const positions = await this.getPositions();
    return positions.find((p) => p.symbol === symbol || p.symbol === symbol.replace('/', ''));
  }

  public async getAccount(): Promise<AccountState> {
    const wallet = await this.client.futures.account.getWallet();
    const balance = Number((wallet as { balance?: number; cross_margin_balance?: number })?.balance ?? 0);
    const unrealized = Number((wallet as { unrealized_pnl?: number })?.unrealized_pnl ?? 0);

    return {
      walletBalance: balance,
      unrealizedPnl: unrealized,
      equity: balance + unrealized,
      initialMargin: Number((wallet as { margin?: number })?.margin ?? 0),
      maintenanceMargin: 0,
      availableBalance: balance,
      totalFees: 0,
      totalFunding: 0,
      totalRealizedPnl: 0,
      openPositionsCount: this.positions.size,
      openOrdersCount: Array.from(this.orders.values()).filter((o) => o.status === 'NEW').length,
      liquidations: 0,
    };
  }
}
