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

  /**
   * CoinDCX futures accepts exactly three order types (see the SDK's
   * CreateFuturesOrderRequest). Anything else has no representation here and
   * must be routed elsewhere or rejected — never silently coerced.
   */
  private mapEntryOrderType(type: OrderType): 'market_order' | 'limit_order' | null {
    if (type === 'LIMIT') return 'limit_order';
    if (type === 'MARKET') return 'market_order';
    return null;
  }

  /** Stop/take-profit types, which CoinDCX models as position brackets rather than orders. */
  private isBracketType(type: OrderType): boolean {
    return (
      type === 'STOP_MARKET' ||
      type === 'STOP' ||
      type === 'TAKE_PROFIT_MARKET' ||
      type === 'TRAILING_STOP_MARKET'
    );
  }

  private isStopSide(type: OrderType): boolean {
    return type === 'STOP_MARKET' || type === 'STOP' || type === 'TRAILING_STOP_MARKET';
  }

  private rejected(command: OrderCommand, reason: string): Order {
    const nowIso = new Date().toISOString();
    return {
      id: ulid(),
      clientOrderId: command.clientOrderId || ulid(),
      accountId: 'coindcx-live',
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
      rejectReason: reason,
      submittedAtUtc: nowIso,
      updatedAtUtc: nowIso,
    };
  }

  /** Raw venue position for a symbol, needed for bracket and close operations. */
  private async findVenuePosition(
    symbol: string
  ): Promise<{ id: string | number; size: number } | undefined> {
    const res = await this.client.futures.trading.getPositions({});
    if (!Array.isArray(res)) return undefined;
    const { pair } = this.mapToPair(symbol);
    const match = res.find((p) => String(p.pair || '') === pair && Number(p.size || 0) !== 0);
    return match ? { id: match.id, size: Math.abs(Number(match.size || 0)) } : undefined;
  }

  private accepted(command: OrderCommand, id: string, note?: string): Order {
    const nowIso = new Date().toISOString();
    const order: Order = {
      id,
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
      rejectReason: note,
      submittedAtUtc: nowIso,
      updatedAtUtc: nowIso,
    };
    this.orders.set(order.id, order);
    return order;
  }

  /**
   * Routes an OrderCommand onto the CoinDCX primitive that actually expresses it.
   *
   * CoinDCX models stops and take-profits as brackets attached to a position
   * (createTPSL), and full exits as exitPosition — not as standalone orders.
   * Anything with no faithful representation is REJECTED with an explicit
   * reason rather than approximated.
   */
  public async submitOrder(command: OrderCommand): Promise<Order> {
    // 1. Stop / take-profit brackets -> createTPSL against the open position.
    if (this.isBracketType(command.type)) {
      if (!command.reduceOnly) {
        return this.rejected(
          command,
          `UNSUPPORTED_ENTRY_ORDER_TYPE: ${command.type} is only supported as a reduce-only bracket on an open position`
        );
      }
      if (command.stopPrice === undefined || !Number.isFinite(command.stopPrice)) {
        return this.rejected(command, `MISSING_TRIGGER_PRICE: ${command.type} requires a stopPrice`);
      }

      const position = await this.findVenuePosition(command.symbol);
      if (!position) {
        return this.rejected(
          command,
          `NO_OPEN_POSITION: cannot attach a ${command.type} bracket with no position on ${command.symbol}`
        );
      }

      const isStop = this.isStopSide(command.type);
      await this.client.futures.trading.createTPSL({
        position_id: position.id,
        stop_loss: isStop ? command.stopPrice : undefined,
        take_profit: isStop ? undefined : command.stopPrice,
      });

      return this.accepted(command, `tpsl-${position.id}-${isStop ? 'sl' : 'tp'}`);
    }

    // 2. Reduce-only exits -> exitPosition. createOrder cannot express
    //    reduce-only at all, so this is the only faithful close primitive.
    if (command.reduceOnly) {
      const position = await this.findVenuePosition(command.symbol);
      if (!position) {
        return this.rejected(
          command,
          `NO_OPEN_POSITION: reduce-only order on ${command.symbol} with no open position`
        );
      }

      // exitPosition closes the WHOLE position. Treating a partial reduce as a
      // full exit would silently close more than asked, so refuse instead.
      const EPSILON = 1e-8;
      if (command.quantity < position.size - EPSILON) {
        return this.rejected(
          command,
          `PARTIAL_REDUCE_ONLY_UNSUPPORTED: requested ${command.quantity} of ${position.size}; CoinDCX exitPosition closes the full position`
        );
      }

      const { pair } = this.mapToPair(command.symbol);
      await this.client.futures.trading.exitPosition({ pair });
      return this.accepted(command, `exit-${position.id}`);
    }

    // 3. Plain entries -> createOrder, but only for types the venue accepts.
    const orderType = this.mapEntryOrderType(command.type);
    if (!orderType) {
      return this.rejected(
        command,
        `UNSUPPORTED_ORDER_TYPE: ${command.type} has no CoinDCX equivalent`
      );
    }
    if (orderType === 'limit_order' && (command.price === undefined || !Number.isFinite(command.price))) {
      return this.rejected(command, 'MISSING_LIMIT_PRICE: LIMIT order requires a price');
    }

    const { base, quote } = this.mapToPair(command.symbol);
    const res = await this.client.futures.trading.createOrder({
      side: command.side.toLowerCase() as 'buy' | 'sell',
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

    const orderId =
      (res as { id?: string; order_id?: string })?.id ||
      (res as { id?: string; order_id?: string })?.order_id ||
      ulid();

    return this.accepted(command, orderId);
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
