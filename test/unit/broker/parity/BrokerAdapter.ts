import { Decimal } from 'decimal.js';
import type { Candle } from '../fixtures.js';
import type { OrderSide, OrderType, OrderStatus, FillRole } from '../../../../src/broker/core/types.js';
import { PaperBroker } from '../../../../src/broker/PaperBroker.js';
import { SmcPaperBroker } from '../../../../src/broker/paper/SmcPaperBroker.js';
import type { PaperBrokerConfig } from '../../../../src/broker/paper/types.js';

export interface OrderInput {
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
  stopPrice?: number;
  reduceOnly?: boolean;
}

export interface NormalizedFill {
  side: OrderSide;
  price: number;
  quantity: number;
  fee: number;
  role: FillRole;
  orderStatusAfter: OrderStatus;
}

export interface NormalizedPosition {
  symbol: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  feesPaid: number;
  fundingPaid: number;
  liquidationPrice: number;
  mfe: number;
  mae: number;
  status: string;
}

export interface NormalizedAccount {
  balance: number;
  equity: number;
  marginUsed: number;
}

export interface StepSnapshot {
  fills: NormalizedFill[];
  positions: NormalizedPosition[];
  account: NormalizedAccount;
  eventTypes: string[];
}

export interface BrokerAdapter {
  label: 'live' | 'backtest';
  reset(opts: { initialBalance: number; takerBps: number; makerBps: number }): void;
  submitOrder(o: OrderInput): void;
  onCandle(c: Candle): void;
  applyFunding(symbol: string, rateBps: number): void;
  snapshot(): StepSnapshot;
}

export function createLiveAdapter(): BrokerAdapter {
  let broker: PaperBroker;
  let eventTypes: string[] = [];
  let symbol = 'BTCUSDT';

  return {
    label: 'live',
    reset(opts) {
      eventTypes = [];
      const instrument = {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        pricePrecision: 2,
        quantityPrecision: 3,
        tickSize: 0.01,
        stepSize: 0.001,
        minQty: 0.001,
        minNotional: 5,
      };
      broker = new PaperBroker({
        accountId: 'test-live',
        startingUsdt: opts.initialBalance,
        takerFeeRate: opts.takerBps / 10_000,
        makerFeeRate: opts.makerBps / 10_000,
        instruments: [instrument as any],
      });
      broker.onMarket({
        symbol: 'BTCUSDT',
        bid: 100,
        ask: 100.1,
        last: 100.05,
        mark: 100.05,
        stale: false,
        localTsUtc: Date.now(),
      });
    },

    submitOrder(o) {
      void broker.submitOrder({
        symbol,
        side: o.side,
        type: o.type as any,
        quantity: o.quantity,
        price: o.price,
        stopPrice: o.stopPrice,
        reduceOnly: o.reduceOnly,
      });
      eventTypes.push('ORDER_SUBMITTED');
    },

    onCandle(c) {
      symbol = c.symbol ?? symbol;
      broker.onMarket({
        symbol,
        bid: c.close - 0.05,
        ask: c.close + 0.05,
        last: c.close,
        mark: c.close,
        localTsUtc: c.openTime ?? Date.now(),
        stale: false,
      });
      eventTypes.push('CANDLE_PROCESSED');
    },

    applyFunding(sym, rateBps) {
      symbol = sym;
      broker.onMarket({
        symbol,
        fundingRate: rateBps / 10_000,
      });
      broker.applyFunding();
      eventTypes.push('FUNDING_APPLIED');
    },

    snapshot() {
      const acc = broker.getAccount();
      const posList = broker.getPositions();
      const positions: NormalizedPosition[] = posList.map((p) => ({
        symbol: p.symbol,
        side: p.positionSide === 'SHORT' ? 'SHORT' : 'LONG',
        quantity: Math.abs(p.positionAmt),
        entryPrice: p.entryPrice,
        unrealizedPnl: p.unrealizedProfit,
        realizedPnl: 0,
        feesPaid: 0,
        fundingPaid: 0,
        liquidationPrice: p.liquidationPrice,
        mfe: 0,
        mae: 0,
        status: p.positionAmt !== 0 ? 'OPEN' : 'CLOSED',
      }));

      return {
        fills: [],
        positions,
        account: {
          balance: acc.walletBalance,
          equity: acc.equity ?? acc.walletBalance,
          marginUsed: acc.initialMargin ?? 0,
        },
        eventTypes,
      };
    },
  };
}

export function createBacktestAdapter(): BrokerAdapter {
  let broker: SmcPaperBroker;
  let eventTypes: string[] = [];
  let symbol = 'BTCUSDT';

  return {
    label: 'backtest',
    reset(opts) {
      eventTypes = [];
      const config: PaperBrokerConfig = {
        makerFeeRate: opts.makerBps / 10_000,
        takerFeeRate: opts.takerBps / 10_000,
        slippageModel: 'NONE',
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
      broker = new SmcPaperBroker(opts.initialBalance, config);
    },

    submitOrder(o) {
      broker.submitTradeSignal({
        id: `sig-${Date.now()}`,
        signalKey: `key-${Date.now()}-${Math.random()}`,
        symbol,
        direction: o.side === 'BUY' ? 'LONG' : 'SHORT',
        status: 'PAPER_READY',
        createdAt: Date.now(),
        targetEntryPrice: o.price ?? 100,
        targetStopLoss: o.stopPrice ?? 90,
        takeProfitPrices: [o.price ? o.price * 1.05 : 105],
        positionSizePct: 0.1,
        riskScore: 0.5,
        setupId: 'setup-1',
        executionPlanId: 'plan-1',
      });
      eventTypes.push('ORDER_SUBMITTED');
    },

    onCandle(c) {
      symbol = c.symbol ?? symbol;
      broker.processCandle(c as any);
      eventTypes.push('CANDLE_PROCESSED');
    },

    applyFunding(_sym, rateBps) {
      broker.processFunding(symbol, rateBps / 10_000);
      eventTypes.push('FUNDING_APPLIED');
    },

    snapshot() {
      const acc = broker.getAccount();
      const posList = broker.getOpenPositions();
      const positions: NormalizedPosition[] = posList.map((p) => ({
        symbol: p.symbol,
        side: p.side,
        quantity: p.quantity,
        entryPrice: p.averageEntryPrice,
        unrealizedPnl: p.unrealizedPnl,
        realizedPnl: p.realizedPnl,
        feesPaid: p.fees,
        fundingPaid: 0,
        liquidationPrice: p.liquidationPrice,
        mfe: p.highestPriceReached - p.averageEntryPrice,
        mae: p.averageEntryPrice - p.lowestPriceReached,
        status: p.state,
      }));

      return {
        fills: [],
        positions,
        account: {
          balance: acc.balance,
          equity: acc.equity,
          marginUsed: acc.usedMargin,
        },
        eventTypes,
      };
    },
  };
}

export function assertSnapshotsEqual(
  live: StepSnapshot,
  backtest: StepSnapshot,
  step: number
): void {
  const tol = 1e-4;
  const fail = (msg: string) => {
    throw new Error(`[PARITY @step ${step}] ${msg}`);
  };

  for (const k of ['balance', 'equity'] as const) {
    if (new Decimal(live.account[k]).minus(backtest.account[k]).abs().gt(tol)) {
      fail(`account.${k}: live=${live.account[k]} backtest=${backtest.account[k]}`);
    }
  }
}
