import { ulid } from 'ulid';
import { Decimal } from 'decimal.js';
import type {
  OrderSide,
  Liquidity,
  Instrument,
  MarketState,
  OrderCommand,
  Order,
  Fill,
  Position,
  PositionEvent,
  AccountState,
  RiskLimits,
  PaperBrokerConfig,
  MarketStateProvider,
  OrderEventSink,
  OrderEventType,
  BrokerPersister,
  FundingPayment,
  RiskCheckResult,
  ExecutionBroker,
} from './types.js';

const D = (value: string | number) => new Decimal(value);

function roundStep(value: Decimal, stepSize: Decimal): Decimal {
  return value.div(stepSize).floor().mul(stepSize);
}

function roundTick(value: Decimal, tickSize: Decimal): Decimal {
  return value.div(tickSize).round().mul(tickSize);
}

function parseNum(str: string | number | undefined): number {
  if (str === undefined) return 0;
  const n = typeof str === 'string' ? Number(str) : str;
  return Number.isFinite(n) ? n : 0;
}

export class PaperBroker implements ExecutionBroker {
  private instruments = new Map<string, Instrument>();
  private orders = new Map<string, Order>();
  private positions = new Map<string, Position>();
  private fills: Fill[] = [];
  private localMarkets = new Map<string, MarketState>();
  private marketState?: MarketStateProvider;
  private eventLog?: OrderEventSink;
  private persister?: BrokerPersister;

  private walletBalance: number;
  private totalFees = 0;
  private totalFunding = 0;
  private totalRealizedPnl = 0;
  private liquidations = 0;

  private account: AccountState;

  private takerFeeRate: number;
  private makerFeeRate: number;
  private marketSlippageBps: number;

  private risk: RiskLimits;

  private dayStartEquity: number;
  private currentUtcDay: string;
  private isLiquidating = false;

  constructor(config: PaperBrokerConfig) {
    this.walletBalance = config.startingUsdt;
    this.dayStartEquity = config.startingUsdt;
    this.currentUtcDay = new Date().toISOString().slice(0, 10);
    this.marketState = config.marketState;
    this.eventLog = config.eventLog;
    this.persister = config.persister;

    this.takerFeeRate = config.takerFeeRate ?? 0.0004;
    this.makerFeeRate = config.makerFeeRate ?? 0.0002;
    this.marketSlippageBps = config.marketSlippageBps ?? 2;

    this.risk = {
      maxLeverage: 10,
      maxOrderNotional: 5000,
      maxPositionNotional: 20000,
      maxDailyLoss: 1000,
      maxOpenOrders: 50,
      allowMarketOrders: true,
      allowLimitOrders: true,
      allowStopOrders: true,
      staleMarketMaxAgeMs: 5000,
      ...config.risk,
    };

    for (const instrument of config.instruments) {
      this.instruments.set(instrument.symbol, instrument);
    }

    if (this.persister?.loadOpenPositions) {
      const persistedPositions = this.persister.loadOpenPositions(config.accountId);
      for (const pos of persistedPositions) {
        // Self-heal any qty/entryPrice float drift baked into older persisted
        // rows (from before qty accumulation was made Decimal-safe) — re-round
        // to this instrument's own precision on every load.
        const instrument = this.instruments.get(pos.symbol);
        if (instrument) {
          pos.qty = Number(D(pos.qty).toFixed(instrument.quantityPrecision));
          pos.entryPrice = Number(D(pos.entryPrice).toFixed(instrument.pricePrecision));
        }
        this.positions.set(pos.symbol, pos);
      }
    }

    if (this.persister?.loadOpenOrders) {
      const persistedOrders = this.persister.loadOpenOrders(config.accountId);
      for (const ord of persistedOrders) {
        this.orders.set(ord.id, ord);
      }
    }

    this.account = this.calculateAccountState();
  }

  // --------------------------------------------------
  // Market data
  // --------------------------------------------------

  onMarket(update: Partial<MarketState> & { symbol: string }): void {
    const instrument = this.instruments.get(update.symbol);

    if (!instrument) {
      console.warn(`[Market] Unknown symbol: ${update.symbol}`);
      return;
    }

    const existing = this.localMarkets.get(update.symbol);
    this.localMarkets.set(update.symbol, {
      ...(existing ?? { symbol: update.symbol, localTsUtc: Date.now(), stale: true }),
      ...update,
      symbol: update.symbol,
      localTsUtc: Date.now(),
      stale: false,
    });

    this.evaluateOpenOrders(update.symbol);
    this.recalculateAccount();
    this.checkLiquidation();
  }

  // --------------------------------------------------
  // Orders
  // --------------------------------------------------

  submitOrder(command: OrderCommand): Order {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    const instrument = this.instruments.get(command.symbol);
    const market = this.getMarket(command.symbol);

    if (!instrument) {
      throw new Error(`Unknown instrument: ${command.symbol}`);
    }

    const quantity = D(command.quantity);
    const stepSize = D(instrument.stepSize);
    const roundedQuantity = roundStep(quantity, stepSize);

    const price = command.price !== undefined
      ? roundTick(D(command.price), D(instrument.tickSize))
      : undefined;

    const stopPrice = command.stopPrice !== undefined
      ? roundTick(D(command.stopPrice), D(instrument.tickSize))
      : undefined;

    const order: Order = {
      id: ulid(),
      clientOrderId: command.clientOrderId ?? ulid(),
      accountId: 'paper-main',
      symbol: command.symbol,
      strategyId: command.strategyId,
      signalId: command.signalId,
      side: command.side,
      type: command.type,
      timeInForce: command.timeInForce ?? 'GTC',
      status: 'NEW',
      positionSide: 'BOTH',
      quantity: roundedQuantity.toNumber(),
      filledQty: 0,
      limitPrice: price?.toNumber(),
      stopPrice: stopPrice?.toNumber(),
      activationPrice: command.activationPrice,
      callbackRate: command.callbackRate,
      avgFillPrice: 0,
      leverage: command.leverage ?? 5,
      marginType: command.marginType,
      reduceOnly: command.reduceOnly ?? false,
      postOnly: command.postOnly ?? false,
      closePosition: command.closePosition ?? false,
      workingType: command.workingType,
      rejectReason: undefined,
      submittedAtUtc: nowIso,
      updatedAtUtc: nowIso,
    };

    this.orders.set(order.id, order);
    this.emitOrderEvent('ORDER_RECEIVED', order);

    if (!market) {
      return this.rejectOrder(order, 'NO_MARKET_STATE', nowIso);
    }

    if (this.isMarketStale(command.symbol)) {
      return this.rejectOrder(order, 'STALE_MARKET_DATA', nowIso);
    }

    const riskCheck = this.checkOrderRisk(order, instrument, market);
    if (!riskCheck.ok) {
      return this.rejectOrder(order, riskCheck.reason ?? 'RISK_CHECK_FAILED', nowIso);
    }

    if (order.type === 'MARKET') {
      this.fillOrder(order, market, 'TAKER', nowIso);
      return order;
    }

    if (order.type === 'LIMIT') {
      if (!order.limitPrice) {
        return this.rejectOrder(order, 'MISSING_LIMIT_PRICE', nowIso);
      }

      const marketable = this.isLimitMarketable(order, market);
      if (order.postOnly && marketable) {
        return this.rejectOrder(order, 'POST_ONLY_WOULD_FILL', nowIso);
      }

      if (marketable) {
        this.fillOrder(order, market, 'TAKER', nowIso);
        return order;
      }

      if (order.timeInForce === 'IOC') {
        const canceled = this.cancelOrder(order.id, 'IOC_NOT_MARKETABLE', nowIso);
        return canceled ?? order;
      }

      if (order.timeInForce === 'FOK') {
        return this.rejectOrder(order, 'FOK_CANNOT_FILL_FULLY', nowIso);
      }

      return order;
    }

    if (order.type === 'STOP_MARKET' || order.type === 'TAKE_PROFIT_MARKET') {
      if (!order.stopPrice) {
        return this.rejectOrder(order, 'MISSING_STOP_PRICE', nowIso);
      }

      if (this.isStopTriggered(order, market)) {
        this.fillOrder(order, market, 'TAKER', nowIso);
      }

      return order;
    }

    if (order.type === 'STOP' || order.type === 'TRAILING_STOP_MARKET') {
      console.warn(`[Order] ${order.type} not yet implemented, rejecting`);
      return this.rejectOrder(order, 'UNSUPPORTED_ORDER_TYPE', nowIso);
    }

    return this.rejectOrder(order, 'UNSUPPORTED_ORDER_TYPE', nowIso);
  }

  cancelOrder(orderId: string, _reason = 'USER_CANCEL', nowIso?: string): Order | undefined {
    const order = this.orders.get(orderId);
    const now = nowIso ?? new Date().toISOString();

    if (!order) return undefined;

    if (order.status !== 'NEW' && order.status !== 'PARTIALLY_FILLED') {
      return order;
    }

    order.status = 'CANCELED';
    order.updatedAtUtc = now;
    this.emitOrderEvent('ORDER_CANCELED', order, { reason: _reason });

    return order;
  }

  cancelAllOrders(symbol?: string): void {
    for (const order of this.orders.values()) {
      if (symbol && order.symbol !== symbol) continue;
      if (order.status === 'NEW' || order.status === 'PARTIALLY_FILLED') {
        this.cancelOrder(order.id, 'CANCEL_ALL');
      }
    }
  }

  // --------------------------------------------------
  // Funding
  // --------------------------------------------------

  applyFunding(): void {
    for (const position of this.positions.values()) {
      if (position.qty === 0) continue;

      const market = this.getMarket(position.symbol);
      if (!market?.mark || market.fundingRate === undefined) continue;

      const payment = D(position.qty).mul(D(market.mark)).mul(D(market.fundingRate)).toNumber();

      this.walletBalance = D(this.walletBalance).sub(payment).toNumber();
      this.totalFunding = D(this.totalFunding).add(payment).toNumber();

      position.totalFunding = D(position.totalFunding).add(payment).toNumber();
      position.unrealizedPnl = D(position.unrealizedPnl).sub(payment).toNumber();

      const fundingPayment: FundingPayment = {
        id: ulid(),
        accountId: position.accountId,
        symbol: position.symbol,
        positionSide: position.positionSide,
        qty: position.qty,
        markPrice: market.mark,
        fundingRate: market.fundingRate,
        payment,
        walletBalanceAfter: this.walletBalance,
        fundingTimeUtc: new Date().toISOString(),
        createdAtUtc: new Date().toISOString(),
      };
      this.eventLog?.appendFundingPayment(fundingPayment);
      this.emitPositionEvent('FUNDING', position, position.qty, position.qty, market.mark);
    }

    this.recalculateAccount();
  }

  // --------------------------------------------------
  // Queries
  // --------------------------------------------------

  getAccount(): AccountState {
    return this.account;
  }

  getPositions(): Position[] {
    this.recalculateAccount();
    return Array.from(this.positions.values());
  }

  getPosition(symbol: string): Position | undefined {
    return this.positions.get(symbol);
  }

  getMarket(symbol: string): MarketState | undefined {
    const external = this.marketState?.getState(symbol);
    if (external) return external;
    return this.localMarkets.get(symbol);
  }

  getOpenOrders(symbol?: string): Order[] {
    return Array.from(this.orders.values()).filter((order) => {
      const open = order.status === 'NEW' || order.status === 'PARTIALLY_FILLED';
      if (!open) return false;
      if (symbol && order.symbol !== symbol) return false;
      return true;
    });
  }

  getFills(): Fill[] {
    return [...this.fills];
  }

  getInstrument(symbol: string): Instrument | undefined {
    return this.instruments.get(symbol);
  }

  getSnapshot() {
    return {
      ts: Date.now(),
      walletBalance: this.walletBalance,
      account: this.account,
      positions: Object.fromEntries(this.positions),
      orders: Object.fromEntries(this.orders),
      fills: this.fills,
    };
  }

  // --------------------------------------------------
  // Internal matching
  // --------------------------------------------------

  private evaluateOpenOrders(symbol: string): void {
    const market = this.getMarket(symbol);
    if (!market) return;

    for (const order of this.orders.values()) {
      if (order.symbol !== symbol) continue;
      if (order.status !== 'NEW' && order.status !== 'PARTIALLY_FILLED') continue;

      if (order.type === 'LIMIT') {
        if (this.isLimitMarketable(order, market)) {
          this.fillOrder(order, market, 'MAKER', new Date().toISOString());
        }
        continue;
      }

      if (order.type === 'STOP_MARKET' || order.type === 'TAKE_PROFIT_MARKET') {
        if (this.isStopTriggered(order, market)) {
          this.fillOrder(order, market, 'TAKER', new Date().toISOString());
        }
        continue;
      }
    }
  }

  private fillOrder(
    order: Order,
    market: MarketState,
    liquidity: Liquidity,
    nowIso: string
  ): void {
    const remaining = D(order.quantity).sub(order.filledQty);
    if (remaining.lte(0)) {
      order.status = 'FILLED';
      return;
    }

    const price = this.getExecutionPrice(order, market);
    if (!Number.isFinite(price) || price <= 0) {
      this.rejectOrder(order, 'INVALID_EXECUTION_PRICE', nowIso);
      return;
    }

    this.executeFill(order, remaining.toNumber(), price, liquidity, nowIso);

    if (order.filledQty >= order.quantity) {
      order.status = 'FILLED';
      this.emitOrderEvent('ORDER_FILLED', order, { executionPrice: price });
    } else {
      order.status = 'PARTIALLY_FILLED';
      this.emitOrderEvent('ORDER_PARTIALLY_FILLED', order, { executionPrice: price });
    }
    order.updatedAtUtc = nowIso;
  }

  private executeFill(
    order: Order,
    quantity: number,
    price: number,
    liquidity: Liquidity,
    nowIso: string
  ): void {
    const feeRate = liquidity === 'MAKER' ? this.makerFeeRate : this.takerFeeRate;
    const notional = D(quantity).mul(price);
    const fee = notional.mul(feeRate).toNumber();

    this.walletBalance = D(this.walletBalance).sub(fee).toNumber();
    this.totalFees = D(this.totalFees).add(fee).toNumber();

    const position = this.positions.get(order.symbol);
    const qtyBefore = position?.qty ?? 0;
    const entryBefore = position?.entryPrice;

    const realizedPnl = this.applyPositionFill(
      order.symbol,
      order.side,
      quantity,
      price,
      order.leverage,
      nowIso
    );

    const positionAfter = this.positions.get(order.symbol);
    if (positionAfter) {
      positionAfter.totalFees = D(positionAfter.totalFees).add(fee).toNumber();
      this.persister?.savePosition(positionAfter);
    }

    this.walletBalance = D(this.walletBalance).add(realizedPnl).toNumber();
    this.totalRealizedPnl = D(this.totalRealizedPnl).add(realizedPnl).toNumber();

    order.filledQty = D(order.filledQty).add(quantity).toNumber();
    order.avgFillPrice =
      order.filledQty === 0
        ? 0
        : D(order.avgFillPrice)
            .mul(order.filledQty - quantity)
            .add(D(price).mul(quantity))
            .div(order.filledQty)
            .toNumber();

    const market = this.getMarket(order.symbol);

    const fill: Fill = {
      id: ulid(),
      orderId: order.id,
      accountId: order.accountId,
      symbol: order.symbol,
      strategyId: order.strategyId,
      signalId: order.signalId,
      side: order.side,
      quantity,
      price,
      notional: notional.toNumber(),
      fee,
      feeAsset: 'USDT',
      liquidity,
      realizedPnl,
      positionQtyBefore: qtyBefore,
      positionQtyAfter: positionAfter?.qty ?? qtyBefore,
      positionEntryBefore: entryBefore,
      positionEntryAfter: positionAfter?.entryPrice,
      marketBid: market?.bid,
      marketAsk: market?.ask,
      marketLast: market?.last,
      marketMark: market?.mark,
      expectedPrice: order.limitPrice ?? price,
      slippageBps:
        order.type === 'MARKET' || order.type === 'STOP_MARKET'
          ? this.marketSlippageBps
          : undefined,
      fillTsUtc: nowIso,
    };

    this.fills.push(fill);
    this.eventLog?.appendFill(fill);
    this.persister?.saveFill(fill);
    this.recalculateAccount();
  }

  private applyPositionFill(
    symbol: string,
    side: OrderSide,
    quantity: number,
    price: number,
    leverage: number,
    nowIso: string
  ): number {
    const instrument = this.instruments.get(symbol);
    if (!instrument) throw new Error(`Unknown instrument: ${symbol}`);

    let position = this.positions.get(symbol);
    if (!position) {
      position = {
        accountId: 'paper-main',
        symbol,
        positionSide: 'BOTH',
        status: 'OPEN',
        qty: 0,
        entryPrice: 0,
        leverage,
        maintenanceMarginRate: parseNum(instrument.maintenanceMarginRate),
        realizedPnl: 0,
        unrealizedPnl: 0,
        initialMargin: 0,
        maintenanceMargin: 0,
        totalFees: 0,
        totalFunding: 0,
        updatedAtUtc: nowIso,
      };
      this.positions.set(symbol, position);
    }

    const signedQty = side === 'BUY' ? quantity : -quantity;
    const oldQty = position.qty;
    // Decimal-safe accumulation, rounded to the instrument's own precision — plain
    // JS float addition across many fills drifts (e.g. 221.53000000000003) even
    // when each individual fill quantity was already step-rounded at submission.
    const newQty = Number(D(oldQty).add(signedQty).toFixed(instrument.quantityPrecision));
    let realized = 0;

    if (oldQty === 0) {
      position.status = 'OPEN';
      position.entryPrice = price;
      position.qty = newQty;
      position.leverage = leverage;
      position.maintenanceMarginRate = parseNum(instrument.maintenanceMarginRate);
      position.openedAtUtc = nowIso;
      position.closedAtUtc = undefined;
      position.updatedAtUtc = nowIso;
      this.emitPositionEvent('OPEN', position, 0, newQty, price);

      return 0;
    }

    if (newQty === 0) {
      const direction = oldQty > 0 ? 1 : -1;
      const closedQty = Math.abs(oldQty);
      realized = D(closedQty).mul(D(price).sub(position.entryPrice)).mul(direction).toNumber();

      position.qty = 0;
      position.entryPrice = 0;
      position.realizedPnl = D(position.realizedPnl).add(realized).toNumber();
      position.status = 'CLOSED';
      position.closedAtUtc = nowIso;
      position.updatedAtUtc = nowIso;
      this.emitPositionEvent('CLOSE', position, oldQty, 0, price);
      this.cancelStaleBracketOrders(symbol, nowIso);

      return realized;
    }

    if (Math.sign(oldQty) === Math.sign(newQty) && Math.abs(newQty) < Math.abs(oldQty)) {
      const direction = oldQty > 0 ? 1 : -1;
      const closedQty = Math.abs(oldQty) - Math.abs(newQty);
      realized = D(closedQty).mul(D(price).sub(position.entryPrice)).mul(direction).toNumber();

      position.qty = newQty;
      position.realizedPnl = D(position.realizedPnl).add(realized).toNumber();
      position.updatedAtUtc = nowIso;
      this.emitPositionEvent('REDUCE', position, oldQty, newQty, price);

      return realized;
    }

    if (Math.sign(oldQty) === Math.sign(newQty) && Math.abs(newQty) > Math.abs(oldQty)) {
      const oldNotional = D(Math.abs(oldQty)).mul(position.entryPrice);
      const addedNotional = D(Math.abs(signedQty)).mul(price);
      position.entryPrice = Number(
        oldNotional.add(addedNotional).div(Math.abs(newQty)).toFixed(instrument.pricePrecision)
      );
      position.qty = newQty;
      position.leverage = leverage;
      position.updatedAtUtc = nowIso;
      this.emitPositionEvent('INCREASE', position, oldQty, newQty, price);

      return 0;
    }

    const direction = oldQty > 0 ? 1 : -1;
    const closedQty = Math.abs(oldQty);
    realized = D(closedQty).mul(D(price).sub(position.entryPrice)).mul(direction).toNumber();

    position.qty = newQty;
    position.entryPrice = price;
    position.leverage = leverage;
    position.realizedPnl = D(position.realizedPnl).add(realized).toNumber();
    position.updatedAtUtc = nowIso;
    this.emitPositionEvent('FLIP', position, oldQty, newQty, price);
    // Brackets placed for the old direction (e.g. a SELL stop protecting a LONG)
    // can never fill against the new opposite-side position — cancel them so
    // they don't sit in the book looking like protection that doesn't exist.
    this.cancelStaleBracketOrders(symbol, nowIso);

    return realized;
  }

  /** Cancels a symbol's outstanding reduce-only SL/TP orders — used when a
   * position closes or flips direction, since those brackets can never fill
   * against the position's new state (or lack of one) and would otherwise
   * sit in the order book indefinitely, misrepresenting real protection. */
  private cancelStaleBracketOrders(symbol: string, nowIso: string): void {
    for (const order of this.orders.values()) {
      if (order.symbol !== symbol) continue;
      if (order.status !== 'NEW' && order.status !== 'PARTIALLY_FILLED') continue;
      if (!order.reduceOnly) continue;
      if (order.type !== 'STOP_MARKET' && order.type !== 'TAKE_PROFIT_MARKET') continue;
      this.cancelOrder(order.id, 'STALE_BRACKET_POSITION_CHANGED', nowIso);
    }
  }

  // --------------------------------------------------
  // Execution prices
  // --------------------------------------------------

  private getExecutionPrice(order: Order, market: MarketState): number {
    if (order.type === 'MARKET' || order.type === 'STOP_MARKET' || order.type === 'TAKE_PROFIT_MARKET') {
      const slippage = D(this.marketSlippageBps).div(10000);

      if (order.side === 'BUY') {
        const ask = market.ask ?? market.last ?? market.mark;
        if (!ask || !Number.isFinite(ask) || ask <= 0) return NaN;
        return D(ask).mul(D(1).add(slippage)).toNumber();
      }

      const bid = market.bid ?? market.last ?? market.mark;
      if (!bid || !Number.isFinite(bid) || bid <= 0) return NaN;
      return D(bid).mul(D(1).sub(slippage)).toNumber();
    }

    if (order.type === 'LIMIT') {
      if (!order.limitPrice) return NaN;

      if (order.side === 'BUY') {
        return market.ask ?? order.limitPrice;
      }

      return market.bid ?? order.limitPrice;
    }

    return NaN;
  }

  private isLimitMarketable(order: Order, market: MarketState): boolean {
    if (!order.limitPrice) return false;

    if (order.side === 'BUY') {
      return !!market.ask && market.ask <= order.limitPrice;
    }

    return !!market.bid && market.bid >= order.limitPrice;
  }

  private isStopTriggered(order: Order, market: MarketState): boolean {
    if (!order.stopPrice) return false;

    const triggerReference =
      market.mark ??
      market.last ??
      (market.bid && market.ask ? D(market.bid).add(market.ask).div(2).toNumber() : undefined);

    if (!triggerReference) return false;

    const isTakeProfit = order.type === 'TAKE_PROFIT_MARKET';

    if (isTakeProfit) {
      if (order.side === 'SELL') {
        return triggerReference >= order.stopPrice;
      }
      return triggerReference <= order.stopPrice;
    }

    if (order.side === 'BUY') {
      return triggerReference >= order.stopPrice;
    }

    return triggerReference <= order.stopPrice;
  }

  // --------------------------------------------------
  // Risk
  // --------------------------------------------------

  private checkOrderRisk(
    order: Order,
    instrument: Instrument,
    market: MarketState
  ): RiskCheckResult {
    this.rollDailyEquityIfNeeded();

    if (order.type === 'MARKET' && !this.risk.allowMarketOrders) {
      return { ok: false, reason: 'MARKET_ORDERS_DISABLED' };
    }
    if (order.type === 'LIMIT' && !this.risk.allowLimitOrders) {
      return { ok: false, reason: 'LIMIT_ORDERS_DISABLED' };
    }
    if ((order.type === 'STOP_MARKET' || order.type === 'TAKE_PROFIT_MARKET') && !this.risk.allowStopOrders) {
      return { ok: false, reason: 'STOP_ORDERS_DISABLED' };
    }

    if (order.quantity <= 0) return { ok: false, reason: 'INVALID_QTY' };
    if (D(order.quantity).lt(D(instrument.minQty))) return { ok: false, reason: 'MIN_QTY_NOT_MET' };
    if (order.leverage > this.risk.maxLeverage) return { ok: false, reason: 'MAX_LEVERAGE_EXCEEDED' };

    const estimatedPrice = this.estimatePrice(order, market);
    if (!Number.isFinite(estimatedPrice) || estimatedPrice <= 0) return { ok: false, reason: 'NO_VALID_PRICE' };

    const notional = D(order.quantity).mul(estimatedPrice);
    if (notional.lt(D(instrument.minNotional))) return { ok: false, reason: 'MIN_NOTIONAL_NOT_MET' };
    // A reduce-only order can only ever shrink exposure, never grow it — the
    // per-order and per-position notional caps below exist to stop exposure
    // from growing, so they must never apply here. Without this exemption, a
    // position that's already over the cap (from earlier fills) permanently
    // blocks every future order on that symbol, including the reduce-only
    // closes that would fix it — a deadlock the system can never recover from.
    if (!order.reduceOnly && notional.gt(this.risk.maxOrderNotional)) {
      return { ok: false, reason: 'MAX_ORDER_NOTIONAL_EXCEEDED' };
    }

    const currentPosition = this.positions.get(order.symbol);
    const currentQty = currentPosition?.qty ?? 0;
    const signedQty = order.side === 'BUY' ? order.quantity : -order.quantity;
    const newQty = currentQty + signedQty;

    const increasesPosition = Math.abs(newQty) > Math.abs(currentQty);
    if (order.reduceOnly && increasesPosition) {
      return { ok: false, reason: 'REDUCE_ONLY_WOULD_INCREASE' };
    }

    if (!order.reduceOnly) {
      const currentNotional = D(Math.abs(currentQty)).mul(estimatedPrice);
      const addedNotional = increasesPosition
        ? D(Math.abs(newQty) - Math.abs(currentQty)).mul(estimatedPrice)
        : D(0);

      if (currentNotional.add(addedNotional).gt(this.risk.maxPositionNotional)) {
        return { ok: false, reason: 'MAX_POSITION_NOTIONAL_EXCEEDED' };
      }
    }

    // Circuit breakers exist to stop new risk-taking, not to trap the account
    // in existing losing positions forever — a reduce-only order must always
    // be able to get out, even (especially) when these limits are breached.
    if (!order.reduceOnly) {
      const openOrders = this.getOpenOrders().length;
      if (openOrders >= this.risk.maxOpenOrders) {
        return { ok: false, reason: 'MAX_OPEN_ORDERS_EXCEEDED' };
      }
    }

    const account = this.calculateAccountState();
    if (!order.reduceOnly && account.equity < this.dayStartEquity - this.risk.maxDailyLoss) {
      return { ok: false, reason: 'MAX_DAILY_LOSS_EXCEEDED' };
    }

    if (increasesPosition) {
      const requiredMargin = notional.div(order.leverage);
      const feeRate = order.type === 'LIMIT' ? this.makerFeeRate : this.takerFeeRate;
      const estimatedFee = notional.mul(feeRate);

      if (D(account.availableBalance).lt(requiredMargin.add(estimatedFee))) {
        return { ok: false, reason: 'INSUFFICIENT_AVAILABLE_BALANCE' };
      }
    }

    return { ok: true };
  }

  private estimatePrice(order: Order, market: MarketState): number {
    if (order.type === 'LIMIT' && order.limitPrice) return order.limitPrice;
    if ((order.type === 'STOP_MARKET' || order.type === 'TAKE_PROFIT_MARKET') && order.stopPrice) return order.stopPrice;

    if (order.side === 'BUY') return market.ask ?? NaN;
    return market.bid ?? NaN;
  }

  // --------------------------------------------------
  // Account / margin / PnL
  // --------------------------------------------------

  private recalculateAccount(): void {
    this.account = this.calculateAccountState();
  }

  private calculateAccountState(): AccountState {
    let unrealizedPnl = 0;
    let initialMargin = 0;
    let maintenanceMargin = 0;
    let openPositionsCount = 0;

    for (const position of this.positions.values()) {
      if (position.qty !== 0) openPositionsCount++;

      const market = this.getMarket(position.symbol);
      const markPrice =
        market?.mark ??
        market?.last ??
        (market?.bid && market?.ask ? D(market.bid).add(market.ask).div(2).toNumber() : undefined) ??
        position.entryPrice;

      if (!markPrice || !Number.isFinite(markPrice)) continue;
      if (position.qty === 0) {
        position.unrealizedPnl = 0;
        continue;
      }

      position.unrealizedPnl = D(position.qty).mul(D(markPrice).sub(position.entryPrice)).toNumber();
      unrealizedPnl = D(unrealizedPnl).add(position.unrealizedPnl).toNumber();

      const notional = D(Math.abs(position.qty)).mul(markPrice);
      initialMargin = D(initialMargin).add(notional.div(position.leverage)).toNumber();
      maintenanceMargin = D(maintenanceMargin).add(notional.mul(position.maintenanceMarginRate)).toNumber();
    }

    const equity = D(this.walletBalance).add(unrealizedPnl).toNumber();
    const availableBalance = Math.max(0, D(equity).sub(initialMargin).toNumber());
    const marginRatio = maintenanceMargin > 0 ? equity / maintenanceMargin : 0;

    return {
      walletBalance: this.walletBalance,
      unrealizedPnl,
      equity,
      initialMargin,
      maintenanceMargin,
      availableBalance,
      marginRatio,
      totalFees: this.totalFees,
      totalFunding: this.totalFunding,
      totalRealizedPnl: this.totalRealizedPnl,
      openPositionsCount,
      openOrdersCount: this.getOpenOrders().length,
      peakEquity: this.dayStartEquity,
      drawdown: this.dayStartEquity > 0 ? Math.max(0, (this.dayStartEquity - equity) / this.dayStartEquity) : 0,
      liquidations: this.liquidations,
    };
  }

  private rollDailyEquityIfNeeded(): void {
    const utcDay = new Date().toISOString().slice(0, 10);
    if (utcDay !== this.currentUtcDay) {
      this.currentUtcDay = utcDay;
      this.dayStartEquity = this.calculateAccountState().equity;
    }
  }

  // --------------------------------------------------
  // Liquidation
  // --------------------------------------------------

  private checkLiquidation(): void {
    if (this.isLiquidating) return;

    const account = this.calculateAccountState();
    if (account.maintenanceMargin <= 0) return;
    if (account.equity > account.maintenanceMargin) return;

    this.isLiquidating = true;
    this.liquidations++;

    for (const position of this.positions.values()) {
      if (position.qty === 0) continue;

      const market = this.getMarket(position.symbol);
      if (!market?.mark) continue;

      const closeSide: OrderSide = position.qty > 0 ? 'SELL' : 'BUY';
      const closeQty = Math.abs(position.qty);
      const nowIso = new Date().toISOString();

      // C-04: forced liquidation used to close positions by calling
      // applyPositionFill() directly, bypassing fillOrder/executeFill entirely —
      // no Fill record, no fee, no ORDER_FILLED event, and the close was
      // effectively invisible to the append-only audit trail. Route it through
      // a synthetic MARKET order tagged strategyId=LIQUIDATION so it gets the
      // same Fill/fee/event treatment as any other close.
      const order: Order = {
        id: ulid(),
        clientOrderId: `liq-${ulid()}`,
        accountId: position.accountId,
        symbol: position.symbol,
        strategyId: 'LIQUIDATION',
        side: closeSide,
        type: 'MARKET',
        timeInForce: 'GTC',
        status: 'NEW',
        positionSide: position.positionSide,
        quantity: closeQty,
        filledQty: 0,
        avgFillPrice: 0,
        leverage: position.leverage,
        reduceOnly: true,
        postOnly: false,
        closePosition: true,
        submittedAtUtc: nowIso,
        updatedAtUtc: nowIso,
      };
      this.orders.set(order.id, order);

      this.executeFill(order, closeQty, market.mark, 'TAKER', nowIso);

      order.status = 'FILLED';
      order.updatedAtUtc = nowIso;
      this.emitOrderEvent('ORDER_FILLED', order, { executionPrice: market.mark, reason: 'LIQUIDATION' });
    }

    this.recalculateAccount();
    this.isLiquidating = false;
  }

  // --------------------------------------------------
  // Order helpers
  // --------------------------------------------------

  private emitOrderEvent(
    eventType: OrderEventType['eventType'],
    order: Order,
    extra?: Partial<OrderEventType>
  ): void {
    this.persister?.saveOrder(order);
    this.eventLog?.appendOrderEvent({
      eventType,
      orderId: order.id,
      accountId: order.accountId,
      symbol: order.symbol,
      oldStatus: extra?.oldStatus,
      newStatus: order.status,
      filledQty: order.filledQty,
      executionPrice: extra?.executionPrice,
      reason: extra?.reason,
      createdAtUtc: new Date().toISOString(),
    });
  }

  private emitPositionEvent(
    eventType: PositionEvent['eventType'],
    position: Position,
    qtyBefore: number,
    qtyAfter: number,
    price?: number,
    orderId?: string,
    fillId?: string
  ): void {
    this.persister?.savePosition(position);
    this.eventLog?.appendPositionEvent({
      id: ulid(),
      accountId: position.accountId,
      symbol: position.symbol,
      positionSide: position.positionSide,
      eventType,
      fillId,
      orderId,
      qtyBefore,
      qtyAfter,
      price,
      createdAtUtc: new Date().toISOString(),
    });
  }

  private rejectOrder(order: Order, reason: string, nowIso?: string): Order {
    const now = nowIso ?? new Date().toISOString();
    order.status = 'REJECTED';
    order.rejectReason = reason;
    order.updatedAtUtc = now;
    this.emitOrderEvent('ORDER_REJECTED', order, { reason });
    return order;
  }

  private isMarketStale(symbol: string): boolean {
    const market = this.getMarket(symbol);
    if (!market) return true;
    return market.stale || Date.now() - market.localTsUtc > this.risk.staleMarketMaxAgeMs;
  }

  // --------------------------------------------------
  // Maintenance
  // --------------------------------------------------

  startMaintenanceTimers(): void {
    setInterval(() => {
      this.applyFunding();
    }, 60000);

    setInterval(() => {
      const snapshot = this.getSnapshot();
      console.log({
        equity: snapshot.account.equity.toFixed(2),
        wallet: snapshot.account.walletBalance.toFixed(2),
        available: snapshot.account.availableBalance.toFixed(2),
        unrealized: snapshot.account.unrealizedPnl.toFixed(2),
        positions: snapshot.positions,
      });
    }, 10000);
  }

  shutdown(): void {
    console.log('[PaperBroker] Shutdown');
  }
}