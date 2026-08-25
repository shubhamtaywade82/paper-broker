import type { Candle } from '../../strategy/indicators.js';
import type { TradeSignal } from '../../trading/signal/types.js';
import { PaperAccount } from './PaperAccount.js';
import { PaperEventJournal } from './PaperEventJournal.js';
import { PaperFillEngine } from './PaperFillEngine.js';
import { PaperFundingModel } from './PaperFundingModel.js';
import { PaperLedger } from './PaperLedger.js';
import { PaperMetrics, type PerformanceMetrics } from './PaperMetrics.js';
import { PaperPositionManager } from './PaperPositionManager.js';
import type {
  PaperAccountState,
  PaperBrokerConfig,
  PaperFill,
  PaperOrder,
  PaperPosition,
  PaperTradeRecord,
  TradeTrace,
} from './types.js';

// H-12: taker fee here used to default to 5bps while PaperBroker.ts (the live
// paper-trading path) defaults to 4bps (real Binance USDM Futures VIP0 taker
// rate) — the same fee schedule applied twice, inconsistently, made backtest
// results not directly comparable to live paper trading. Aligned to 4bps.
export const DEFAULT_PAPER_CONFIG: PaperBrokerConfig = {
  makerFeeRate: 0.0002,
  takerFeeRate: 0.0004,
  slippageModel: 'NONE',
  ambiguousIntrabarPolicy: 'REJECT_AMBIGUOUS',
  breakevenEnabled: true,
  breakevenTriggerR: 1.5,
  breakevenOffsetTicks: 2,
  trailingEnabled: false,
  trailingTriggerR: 2.5,
  trailingDistanceTicks: 5,
  maintenanceMarginRate: 0.005,
  fundingMode: 'CANONICAL_ONLY',
};

export class SmcPaperBroker {
  public readonly mode = 'PAPER' as const;
  private config: PaperBrokerConfig;
  private account: PaperAccount;
  private journal: PaperEventJournal;
  private ledger: PaperLedger;

  private orders: Map<string, PaperOrder> = new Map();
  private fills: PaperFill[] = [];
  private positions: Map<string, PaperPosition> = new Map();
  private signals: Map<string, TradeSignal> = new Map();

  constructor(initialBalance = 10_000, config: PaperBrokerConfig = DEFAULT_PAPER_CONFIG) {
    this.config = config;
    this.account = new PaperAccount(initialBalance);
    this.journal = new PaperEventJournal();
    this.ledger = new PaperLedger();
  }

  submitTradeSignal(signal: TradeSignal, asOf = Date.now()): { accepted: boolean; reason?: string; orderId?: string } {
    if (signal.status !== 'PAPER_READY') {
      return { accepted: false, reason: `Signal is not in PAPER_READY status (current: ${signal.status})` };
    }
    if (this.orders.has(`ORD:${signal.signalKey}`)) {
      return { accepted: false, reason: 'DUPLICATE_SIGNAL_KEY' };
    }

    const orderId = `ORD:${signal.signalKey}`;
    const side = signal.direction === 'LONG' ? 'BUY' : 'SELL';
    const order: PaperOrder = {
      id: orderId,
      clientOrderId: `CLI:${signal.signalKey}`,
      symbol: signal.symbol,
      side,
      type: 'LIMIT',
      quantity: signal.sizing?.quantity ?? 0,
      filledQuantity: 0,
      price: signal.entryPrice,
      reduceOnly: false,
      status: 'NEW',
      createdAt: asOf,
      updatedAt: asOf,
      signalKey: signal.signalKey,
      setupId: signal.sourceSetupId,
      executionPlanId: signal.sourceExecutionPlanId,
    };

    this.orders.set(orderId, order);
    this.signals.set(signal.signalKey, signal);
    this.journal.recordEvent({
      timestamp: asOf,
      symbol: signal.symbol,
      eventType: 'ORDER_ACCEPTED',
      orderId: order.id,
      price: order.price,
      quantity: order.quantity,
      signalKey: signal.signalKey,
    });

    return { accepted: true, orderId: order.id };
  }

  cancelSignalOrder(signalKey: string): boolean {
    const orderId = `ORD:${signalKey}`;
    const order = this.orders.get(orderId);
    if (!order || order.status !== 'NEW') {
      return false;
    }
    order.status = 'CANCELED';
    order.updatedAt = Date.now();
    return true;
  }

  processCandle(candle: Candle): void {
    const pos = this.positions.get(candle.symbol);
    if (pos && pos.state === 'OPEN') {
      this.processOpenPosition(pos, candle);
    }
    this.processPendingOrders(candle);
  }

  processFunding(symbol: string, fundingRate: number, timestamp = Date.now()): void {
    const pos = this.positions.get(symbol);
    if (!pos || pos.state !== 'OPEN') return;
    const { payment } = PaperFundingModel.applyFundingToPosition(pos, fundingRate, timestamp);
    this.account.creditRealizedPnl(payment);
    this.journal.recordEvent({
      timestamp,
      symbol,
      eventType: 'FUNDING_APPLIED',
      price: fundingRate,
      quantity: payment,
    });
  }

  private processPendingOrders(candle: Candle): void {
    for (const order of this.orders.values()) {
      if (order.symbol !== candle.symbol || order.status !== 'NEW' || order.reduceOnly) continue;
      const fill = PaperFillEngine.evaluateOrderFill(order, candle, this.config);
      if (fill) {
        this.executeEntryFill(order, fill, candle);
      }
    }
  }

  private executeEntryFill(order: PaperOrder, fill: PaperFill, _candle: Candle): void {
    order.status = 'FILLED';
    order.filledQuantity = fill.quantity;
    order.updatedAt = fill.timestamp;
    this.fills.push(fill);
    this.account.chargeFee(fill.fee);

    const sig = this.signals.get(order.signalKey)!;
    const side = sig.direction === 'LONG' ? 'LONG' : 'SHORT';
    const tpPrices = sig.takeProfits.map((t) => t.price);

    const pos = PaperPositionManager.openPosition(
      fill,
      side,
      sig.sizing?.leverage ?? 5,
      sig.stopLossPrice,
      tpPrices,
      order.signalKey,
      order.setupId,
      order.executionPlanId,
      this.config.maintenanceMarginRate
    );

    this.positions.set(order.symbol, pos);
    fill.positionId = pos.id;
    this.ledger.recordTradeOpen(pos, sig.riskReward.tp1, sig.id, sig.setupType);
    this.attachExitOrders(pos, sig);

    this.journal.recordEvent({
      timestamp: fill.timestamp,
      symbol: fill.symbol,
      orderId: order.id,
      positionId: pos.id,
      signalKey: order.signalKey,
      eventType: 'ENTRY_FILLED',
      price: fill.price,
      quantity: fill.quantity,
    });
  }

  private attachExitOrders(pos: PaperPosition, sig: TradeSignal): void {
    const exitSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
    const slOrder: PaperOrder = {
      id: `SL:${pos.id}`,
      clientOrderId: `CLI:SL:${pos.id}`,
      symbol: pos.symbol,
      side: exitSide,
      type: 'STOP',
      quantity: pos.quantity,
      filledQuantity: 0,
      stopPrice: pos.stopLossPrice,
      reduceOnly: true,
      status: 'NEW',
      createdAt: pos.openedAt,
      updatedAt: pos.openedAt,
      signalKey: pos.signalKey,
      setupId: pos.setupId,
      executionPlanId: pos.executionPlanId,
      positionId: pos.id,
    };
    this.orders.set(slOrder.id, slOrder);

    for (const tp of sig.takeProfits) {
      const tpQty = Number((pos.quantity * tp.allocationPct).toFixed(3));
      const tpOrder: PaperOrder = {
        id: `TP:${pos.id}:${tp.level}`,
        clientOrderId: `CLI:TP:${pos.id}:${tp.level}`,
        symbol: pos.symbol,
        side: exitSide,
        type: 'TAKE_PROFIT',
        quantity: tpQty,
        filledQuantity: 0,
        price: tp.price,
        reduceOnly: true,
        status: 'NEW',
        createdAt: pos.openedAt,
        updatedAt: pos.openedAt,
        signalKey: pos.signalKey,
        setupId: pos.setupId,
        executionPlanId: pos.executionPlanId,
        positionId: pos.id,
        targetLevel: tp.level,
      };
      this.orders.set(tpOrder.id, tpOrder);
    }
  }

  private processOpenPosition(pos: PaperPosition, candle: Candle): void {
    PaperPositionManager.updateMarkPrice(pos, candle.close);
    if (PaperPositionManager.checkLiquidation(pos, this.config)) {
      this.handleLiquidation(pos, candle);
      return;
    }
    this.processExitFills(pos, candle);
    this.ledger.updateTradeProgress(pos);
  }

  private processExitFills(pos: PaperPosition, candle: Candle): void {
    const slOrder = this.orders.get(`SL:${pos.id}`);
    if (slOrder && slOrder.status === 'NEW') {
      const slFill = PaperFillEngine.evaluateOrderFill(slOrder, candle, this.config);
      if (slFill) {
        this.executeStopLoss(pos, slOrder, slFill, candle);
        return;
      }
    }

    for (let i = 1; i <= 3; i++) {
      const tpOrder = this.orders.get(`TP:${pos.id}:${i}`);
      if (tpOrder && tpOrder.status === 'NEW') {
        const tpFill = PaperFillEngine.evaluateOrderFill(tpOrder, candle, this.config);
        if (tpFill) {
          this.executeTakeProfit(pos, tpOrder, tpFill, i, candle);
        }
      }
    }
  }

  private executeStopLoss(pos: PaperPosition, slOrder: PaperOrder, fill: PaperFill, candle: Candle): void {
    slOrder.status = 'FILLED';
    fill.positionId = pos.id;
    this.fills.push(fill);
    this.account.chargeFee(fill.fee);

    const closeResult = PaperPositionManager.applyPartialClose(pos, fill);
    this.account.creditRealizedPnl(closeResult.realizedGross);
    this.cancelOutstandingTps(pos.id);

    pos.state = 'CLOSED';
    pos.lifecycle = 'STOPPED';
    this.ledger.finalizeTrade(pos, fill.price, 'STOP_LOSS', candle.closeTime ?? candle.openTime);

    this.journal.recordEvent({
      timestamp: fill.timestamp,
      symbol: pos.symbol,
      orderId: slOrder.id,
      positionId: pos.id,
      eventType: 'STOP_FILLED',
      price: fill.price,
      quantity: fill.quantity,
    });
  }

  private executeTakeProfit(pos: PaperPosition, tpOrder: PaperOrder, fill: PaperFill, level: number, candle: Candle): void {
    tpOrder.status = 'FILLED';
    fill.positionId = pos.id;
    this.fills.push(fill);
    this.account.chargeFee(fill.fee);

    const closeResult = PaperPositionManager.applyPartialClose(pos, fill);
    this.account.creditRealizedPnl(closeResult.realizedGross);

    const sl = this.orders.get(`SL:${pos.id}`);
    if (sl && pos.state === 'OPEN') {
      // Keep the resting stop sized to what's actually left — otherwise a
      // later stop-out overcharges fee and overstates fill quantity against
      // the pre-TP position size (P0 #3).
      sl.quantity = pos.remainingQuantity;
      if (level === 1 && this.config.breakevenEnabled) {
        PaperPositionManager.moveStopToBreakeven(pos, this.config.breakevenOffsetTicks);
        sl.stopPrice = pos.stopLossPrice;
      }
    }

    if (pos.remainingQuantity <= 0) {
      pos.state = 'CLOSED';
      pos.lifecycle = 'CLOSED';
      this.ledger.finalizeTrade(pos, fill.price, `TP${level}_FULL`, candle.closeTime ?? candle.openTime);
    }

    this.journal.recordEvent({
      timestamp: fill.timestamp,
      symbol: pos.symbol,
      orderId: tpOrder.id,
      positionId: pos.id,
      eventType: `TP${level}_FILLED`,
      price: fill.price,
      quantity: fill.quantity,
    });
  }

  private handleLiquidation(pos: PaperPosition, candle: Candle): void {
    // The lost margin is a realized loss, not a fee — booking it via chargeFee
    // inflated totalFees and hid the loss from realizedPnl (P0 #4/P2 #20).
    this.account.creditRealizedPnl(-pos.usedMargin);
    this.cancelOutstandingTps(pos.id);
    this.ledger.finalizeTrade(pos, pos.liquidationPrice, 'LIQUIDATED', candle.closeTime ?? candle.openTime);

    this.journal.recordEvent({
      timestamp: candle.closeTime ?? candle.openTime,
      symbol: pos.symbol,
      positionId: pos.id,
      eventType: 'POSITION_LIQUIDATED',
      price: pos.liquidationPrice,
      quantity: pos.remainingQuantity,
    });
  }

  private cancelOutstandingTps(posId: string): void {
    for (let i = 1; i <= 3; i++) {
      const tp = this.orders.get(`TP:${posId}:${i}`);
      if (tp && (tp.status === 'NEW' || (tp.status as string) === 'PENDING')) tp.status = 'CANCELED';
    }
  }

  getTradeTrace(tradeId: string): TradeTrace | null {
    const tradeRecord = this.ledger.getRecord(tradeId);
    if (!tradeRecord) return null;

    const posId = tradeId.replace('TRD:', '');
    const pos = Array.from(this.positions.values()).find((p) => p.id === posId);
    if (!pos) return null;

    const sig = this.signals.get(pos.signalKey);
    if (!sig) return null;

    const orders = Array.from(this.orders.values()).filter((o) => o.positionId === pos.id || o.signalKey === pos.signalKey);
    const fills = this.fills.filter((f) => f.positionId === pos.id);
    const events = this.journal.getEvents(pos.symbol).filter((e) => e.positionId === pos.id || e.signalKey === pos.signalKey);

    return {
      tradeRecord,
      signal: sig,
      orders,
      fills,
      position: pos,
      events: events.map((e) => ({ timestamp: e.timestamp, type: e.eventType, payload: e })),
    };
  }

  getPosition(symbol: string): PaperPosition | undefined {
    return this.positions.get(symbol);
  }

  getOpenPositions(): PaperPosition[] {
    return Array.from(this.positions.values()).filter((p) => p.state === 'OPEN');
  }

  getAccount(): PaperAccountState {
    return this.account.getAccountState(Array.from(this.positions.values()));
  }

  getLedger(): PaperTradeRecord[] {
    return this.ledger.getAllRecords();
  }

  getMetrics(): PerformanceMetrics {
    return PaperMetrics.calculateMetrics(this.ledger.getAllRecords());
  }

  reset(initialBalance = 10_000): void {
    this.account.reset(initialBalance);
    this.journal.clear();
    this.ledger.clear();
    this.orders.clear();
    this.fills = [];
    this.positions.clear();
    this.signals.clear();
  }
}
