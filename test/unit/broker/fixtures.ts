import { Decimal } from 'decimal.js';
import { PaperFillEngine } from '../../../src/broker/paper/PaperFillEngine.js';
import { PaperFeeModel } from '../../../src/broker/paper/PaperFeeModel.js';
import { PaperLedger } from '../../../src/broker/paper/PaperLedger.js';
import type { PaperBrokerConfig, PaperOrder, PaperPosition } from '../../../src/broker/paper/types.js';

export const FEES = { makerBps: 2, takerBps: 4 };

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openTime: number;
  closeTime?: number;
  symbol?: string;
  interval?: string;
  isClosed?: boolean;
}

export function makeCandle(o: {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  openTime?: number;
}): Candle {
  const { open, high, low, close } = o;
  if (high < Math.max(open, close) || low > Math.min(open, close) || low > high) {
    throw new Error(`Malformed candle O=${open} H=${high} L=${low} C=${close}`);
  }
  return {
    symbol: 'BTCUSDT',
    interval: '5m',
    open,
    high,
    low,
    close,
    volume: o.volume ?? 1000,
    openTime: o.openTime ?? 0,
    closeTime: (o.openTime ?? 0) + 300_000,
    isClosed: true,
  };
}

export type OrderSide = 'BUY' | 'SELL';
export type OrderType =
  | 'LIMIT'
  | 'MARKET'
  | 'STOP'
  | 'STOP_MARKET'
  | 'TAKE_PROFIT'
  | 'TAKE_PROFIT_MARKET';

export interface FillResult {
  orderId: string;
  price: number;
  quantity: number;
  fee: number;
  role: 'maker' | 'taker';
}

let seq = 0;
export function makeOrder(p: {
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
  stopPrice?: number;
  reduceOnly?: boolean;
  symbol?: string;
}): PaperOrder {
  return {
    id: `test-order-${++seq}`,
    clientOrderId: `client-order-${seq}`,
    symbol: p.symbol ?? 'BTCUSDT',
    side: p.side,
    type: p.type,
    quantity: p.quantity,
    price: p.price,
    stopPrice: p.stopPrice ?? p.price,
    filledQuantity: 0,
    status: 'NEW',
    reduceOnly: p.reduceOnly ?? false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    signalKey: `sig-${seq}`,
    setupId: `setup-${seq}`,
    executionPlanId: `plan-${seq}`,
  };
}

export function expectMoney(
  actual: number | string | Decimal,
  expected: number | string | Decimal,
  tol: number | string = 1e-9
): void {
  const a = new Decimal(actual);
  const e = new Decimal(expected);
  if (a.minus(e).abs().gt(tol)) {
    throw new Error(
      `Money mismatch: actual=${a.toString()} expected=${e.toString()} delta=${a.minus(e).toString()} (tol=${tol})`
    );
  }
}

export function expectFill(result: FillResult | null | undefined): FillResult {
  if (result == null) throw new Error('Expected order to FILL but engine returned no fill');
  return result;
}

export function expectNoFill(result: FillResult | null | undefined): void {
  if (result != null) {
    throw new Error(`Expected NO fill but got one: price=${result.price} qty=${result.quantity}`);
  }
}

export interface EngineOpts {
  makerBps?: number;
  takerBps?: number;
  slippageBps?: number;
}

export function createFillEngine(opts?: EngineOpts) {
  const makerBps = opts?.makerBps ?? FEES.makerBps;
  const takerBps = opts?.takerBps ?? FEES.takerBps;
  const slippageBps = opts?.slippageBps;

  const config: PaperBrokerConfig = {
    makerFeeRate: makerBps / 10_000,
    takerFeeRate: takerBps / 10_000,
    slippageModel: slippageBps !== undefined && slippageBps > 0 ? 'BPS' : 'NONE',
    slippageBps: slippageBps ?? 0,
    ambiguousIntrabarPolicy: 'CONSERVATIVE',
    breakevenEnabled: false,
    breakevenTriggerR: 1,
    breakevenOffsetTicks: 1,
    trailingEnabled: false,
    trailingTriggerR: 1.5,
    trailingDistanceTicks: 5,
    maintenanceMarginRate: 0.005,
    fundingMode: 'CANONICAL_ONLY',
  };

  return {
    processCandle(order: PaperOrder, candle: Candle): FillResult | null {
      const fill = PaperFillEngine.evaluateOrderFill(order, candle as any, config, 0.01);
      if (!fill) return null;
      return {
        orderId: fill.orderId,
        price: fill.price,
        quantity: fill.quantity,
        fee: fill.fee,
        role: fill.isMaker ? 'maker' : 'taker',
      };
    },
  };
}

export interface LedgerEvent {
  type: string;
  positionId?: string;
  fillId?: string;
  fee?: number;
  payload?: Record<string, unknown>;
}

export interface LedgerContract {
  openPosition(p: {
    symbol: string;
    side: 'LONG' | 'SHORT';
    entryPrice: number;
    quantity: number;
    leverage: number;
    stopLoss?: number;
    takeProfit?: number;
  }): { id: string };
  markPrice(positionId: string, price: number): void;
  applyFunding(positionId: string, amount: number): void;
  closePosition(positionId: string, exitPrice: number, reason: string): void;
  getPosition(positionId: string): {
    status: string;
    mfe: number;
    mae: number;
    realizedPnl?: number;
    margin: number;
    quantity: number;
  };
  getEquity(): number;
  getEvents(): LedgerEvent[];
}

export function createLedger(opts: { initialBalance: number }): LedgerContract {
  let equity = new Decimal(opts.initialBalance);
  const ledger = new PaperLedger();
  const positions = new Map<string, PaperPosition>();
  const events: LedgerEvent[] = [];
  let posSeq = 0;

  return {
    openPosition(p) {
      const id = `pos-${++posSeq}`;
      const notional = new Decimal(p.entryPrice).times(p.quantity);
      const margin = notional.div(p.leverage).toNumber();
      const openFee = PaperFeeModel.calculateFee(notional.toNumber(), false, FEES.makerBps / 10_000, FEES.takerBps / 10_000);
      equity = equity.minus(openFee);

      const pos: PaperPosition = {
        id,
        symbol: p.symbol,
        side: p.side,
        state: 'OPEN',
        quantity: p.quantity,
        initialQuantity: p.quantity,
        remainingQuantity: p.quantity,
        averageEntryPrice: p.entryPrice,
        currentMarkPrice: p.entryPrice,
        liquidationPrice: p.side === 'LONG'
          ? p.entryPrice * (1 - 1 / p.leverage + 0.005)
          : p.entryPrice * (1 + 1 / p.leverage - 0.005),
        leverage: p.leverage,
        initialMargin: margin,
        usedMargin: margin,
        unrealizedPnl: 0,
        realizedPnl: 0,
        fees: openFee,
        stopLossPrice: p.stopLoss ?? 0,
        plannedStopPrice: p.stopLoss ?? 0,
        takeProfitPrices: p.takeProfit ? [p.takeProfit] : [],
        highestPriceReached: p.entryPrice,
        lowestPriceReached: p.entryPrice,
        openedAt: Date.now(),
        lifecycle: 'POSITION_OPEN',
        signalKey: `sig-${id}`,
      };

      positions.set(id, pos);
      const plannedRR = p.stopLoss && p.takeProfit
        ? Math.abs(p.takeProfit - p.entryPrice) / Math.abs(p.entryPrice - p.stopLoss)
        : 1;
      ledger.recordTradeOpen(pos, plannedRR, `sig-${id}`, 'TEST');

      return { id };
    },

    markPrice(positionId, price) {
      const pos = positions.get(positionId);
      if (!pos || pos.state === 'CLOSED') return;

      pos.currentMarkPrice = price;
      pos.highestPriceReached = Math.max(pos.highestPriceReached, price);
      pos.lowestPriceReached = Math.min(pos.lowestPriceReached, price);

      const isLong = pos.side === 'LONG';
      const priceDiff = isLong ? price - pos.averageEntryPrice : pos.averageEntryPrice - price;
      pos.unrealizedPnl = priceDiff * pos.quantity;

      ledger.updateTradeProgress(pos);

      // Check liquidation threshold
      const mmr = 0.005;
      const maintenanceMargin = pos.averageEntryPrice * pos.quantity * mmr;
      const marginBalance = pos.initialMargin + pos.unrealizedPnl;

      if (marginBalance <= maintenanceMargin && pos.lifecycle !== 'LIQUIDATED') {
        pos.lifecycle = 'LIQUIDATED';
        pos.state = 'CLOSED';
        const liqFee = price * pos.quantity * 0.005;
        // Cap isolated loss to margin + liquidation fee
        const rawLoss = -pos.unrealizedPnl;
        const cappedLoss = Math.min(rawLoss, pos.initialMargin + liqFee);
        pos.realizedPnl = -cappedLoss;
        pos.fees += liqFee;
        equity = equity.minus(cappedLoss).minus(liqFee);

        ledger.finalizeTrade(pos, price, 'liquidation', Date.now());

        events.push({
          type: 'LIQUIDATION_EXECUTED',
          positionId: pos.id,
          fillId: `FILL-LIQ-${pos.id}`,
          fee: liqFee,
          payload: { price, realizedPnl: pos.realizedPnl },
        });
      }
    },

    applyFunding(positionId, amount) {
      const pos = positions.get(positionId);
      if (!pos) return;
      // positive funding credits short, debits long
      const delta = pos.side === 'SHORT' ? amount : -amount;
      equity = equity.plus(delta);
    },

    closePosition(positionId, exitPrice, reason) {
      const pos = positions.get(positionId);
      if (!pos || pos.state === 'CLOSED') return;

      const isLong = pos.side === 'LONG';
      const grossPnl = isLong
        ? (exitPrice - pos.averageEntryPrice) * pos.quantity
        : (pos.averageEntryPrice - exitPrice) * pos.quantity;

      const closeFee = PaperFeeModel.calculateFee(exitPrice * pos.quantity, false, FEES.makerBps / 10_000, FEES.takerBps / 10_000);
      pos.fees += closeFee;
      pos.realizedPnl = grossPnl;
      pos.state = 'CLOSED';
      pos.lifecycle = 'CLOSED';

      equity = equity.plus(grossPnl).minus(closeFee);

      ledger.finalizeTrade(pos, exitPrice, reason, Date.now());
    },

    getPosition(positionId) {
      const pos = positions.get(positionId);
      if (!pos) throw new Error(`Position ${positionId} not found`);
      const record = ledger.getRecord(`TRD:${pos.id}`);
      return {
        status: pos.lifecycle === 'LIQUIDATED' ? 'LIQUIDATED' : pos.state,
        mfe: record?.maxFavorableExcursion ?? 0,
        mae: record?.maxAdverseExcursion ?? 0,
        realizedPnl: pos.realizedPnl,
        margin: pos.initialMargin,
        quantity: pos.quantity,
      };
    },

    getEquity() {
      return equity.toNumber();
    },

    getEvents() {
      return events;
    },
  };
}
