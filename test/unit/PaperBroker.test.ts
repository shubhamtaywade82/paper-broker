import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaperBroker } from '../../src/broker/PaperBroker.js';
import type { Fill, Instrument, OrderEventSink } from '../../src/broker/types.js';

const BTC: Instrument = {
  symbol: 'BTCUSDT',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  contractType: 'PERPETUAL',
  status: 'TRADING',
  tickSize: '0.01',
  stepSize: '0.001',
  minQty: '0.001',
  maxQty: '1000',
  minNotional: '5',
  pricePrecision: 2,
  quantityPrecision: 3,
  maintenanceMarginRate: '0.005',
  createdAtUtc: new Date().toISOString(),
  updatedAtUtc: new Date().toISOString(),
};

function createBroker() {
  return new PaperBroker({
    dataDir: '/tmp/paper-broker-test',
    accountId: 'test-account',
    startingUsdt: 10000,
    instruments: [BTC],
    takerFeeRate: 0.0004,
    makerFeeRate: 0.0002,
  });
}

describe('PaperBroker', () => {
  let broker: PaperBroker;

  beforeEach(() => {
    broker = createBroker();
  });

  it('starts with the configured balance', () => {
    const account = broker.getAccount();
    expect(account.walletBalance).toBe(10000);
    expect(account.equity).toBe(10000);
    expect(account.availableBalance).toBe(10000);
  });

  it('rejects orders for unknown symbols', () => {
    expect(() =>
      broker.submitOrder({
        symbol: 'FAKEUSDT',
        side: 'BUY',
        type: 'MARKET',
        quantity: 1,
      })
    ).toThrow('Unknown instrument');
  });

  it('rejects orders when no market data is available', () => {
    const order = broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 1,
    });
    expect(order.status).toBe('REJECTED');
    expect(order.rejectReason).toBe('NO_MARKET_STATE');
  });

  it('opens a long position and realizes the fee', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      localTsUtc: Date.now(),
      stale: false,
    });

    const order = broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.1,
      leverage: 5,
    });

    expect(order.status).toBe('FILLED');

    const position = broker.getPosition('BTCUSDT');
    expect(position?.qty).toBeCloseTo(0.1, 10);
    expect(position?.entryPrice).toBeCloseTo(100.12, 2); // ask 100.1 + 2bps slippage

    const account = broker.getAccount();
    expect(account.walletBalance).toBeCloseTo(10000 - 0.1 * 100.12 * 0.0004, 6);
    expect(account.openPositionsCount).toBe(1);
  });

  it('closes a position and realizes PnL', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      localTsUtc: Date.now(),
      stale: false,
    });

    broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.1,
      leverage: 5,
    });

    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 110,
      ask: 110.1,
      last: 110.05,
      mark: 110,
      localTsUtc: Date.now(),
      stale: false,
    });

    const close = broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'SELL',
      type: 'MARKET',
      quantity: 0.1,
      reduceOnly: true,
      leverage: 5,
    });

    expect(close.status).toBe('FILLED');

    const position = broker.getPosition('BTCUSDT');
    expect(position?.qty).toBe(0);

    const account = broker.getAccount();
    expect(account.totalRealizedPnl).toBeGreaterThan(0);
    // Position record stays in the map (qty 0, status CLOSED) for history, but
    // a closed position must not count toward open-position exposure.
    expect(account.openPositionsCount).toBe(0);
    expect(position?.status).toBe('CLOSED');
  });

  it('never blocks a reduce-only order with an exposure cap, even once the position already exceeds it', () => {
    const tightBroker = new PaperBroker({
      dataDir: '/tmp/paper-broker-test',
      accountId: 'test-account',
      startingUsdt: 10000,
      instruments: [BTC],
      risk: { maxOrderNotional: 1000, maxPositionNotional: 1000 },
    });

    // Open within the cap: 5 BTC @ ~$100 = $500 notional, under the $1000 max.
    tightBroker.onMarket({
      symbol: 'BTCUSDT', bid: 100, ask: 100.1, last: 100.05, mark: 100,
      localTsUtc: Date.now(), stale: false,
    });
    const open = tightBroker.submitOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 5, leverage: 1 });
    expect(open.status).toBe('FILLED');

    // Price moves against the position enough that its notional now exceeds
    // the cap purely from mark-to-market movement (5 BTC @ $250 = $1250) —
    // simulating a position that grew past its risk limit without any new
    // order ever being submitted, exactly like the live account that got
    // stuck here.
    tightBroker.onMarket({
      symbol: 'BTCUSDT', bid: 250, ask: 250.1, last: 250.05, mark: 250,
      localTsUtc: Date.now(), stale: false,
    });

    // A reduce-only close on a position already past maxPositionNotional must
    // still be accepted — a risk cap must never block the only order that
    // shrinks risk.
    const close = tightBroker.submitOrder({
      symbol: 'BTCUSDT', side: 'SELL', type: 'MARKET', quantity: 5, reduceOnly: true, leverage: 1,
    });
    expect(close.status).toBe('FILLED');
    expect(close.rejectReason).toBeUndefined();
  });

  it('never blocks a reduce-only order with the daily-loss circuit breaker', () => {
    const lossyBroker = new PaperBroker({
      dataDir: '/tmp/paper-broker-test',
      accountId: 'test-account',
      startingUsdt: 10000,
      instruments: [BTC],
      risk: { maxDailyLoss: 100 },
    });

    lossyBroker.onMarket({
      symbol: 'BTCUSDT', bid: 100, ask: 100.1, last: 100.05, mark: 100,
      localTsUtc: Date.now(), stale: false,
    });
    lossyBroker.submitOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 5, leverage: 5 });

    // Price craters (5 BTC * $50 drop = $250 loss), blowing well past the
    // $100 daily loss limit while the position is still open.
    lossyBroker.onMarket({
      symbol: 'BTCUSDT', bid: 50, ask: 50.1, last: 50.05, mark: 50,
      localTsUtc: Date.now(), stale: false,
    });
    expect(lossyBroker.getAccount().equity).toBeLessThan(9900);

    // A fresh non-reduceOnly order should still be blocked (the breaker is
    // doing its job)...
    const newRisk = lossyBroker.submitOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.1, leverage: 5 });
    expect(newRisk.status).toBe('REJECTED');
    expect(newRisk.rejectReason).toBe('MAX_DAILY_LOSS_EXCEEDED');

    // ...but closing out must never be blocked by the same breaker, or the
    // account is stuck losing money with no way to stop.
    const close = lossyBroker.submitOrder({
      symbol: 'BTCUSDT', side: 'SELL', type: 'MARKET', quantity: 5, reduceOnly: true, leverage: 5,
    });
    expect(close.status).toBe('FILLED');
  });

  it('cancels stale reduce-only brackets when a position fully closes', () => {
    broker.onMarket({
      symbol: 'BTCUSDT', bid: 100, ask: 100.1, last: 100.05, mark: 100,
      localTsUtc: Date.now(), stale: false,
    });

    broker.submitOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.1, leverage: 5 });
    const stop = broker.submitOrder({
      symbol: 'BTCUSDT', side: 'SELL', type: 'STOP_MARKET', quantity: 0.1, stopPrice: 95, reduceOnly: true, leverage: 5,
    });
    expect(stop.status).toBe('NEW');

    broker.submitOrder({ symbol: 'BTCUSDT', side: 'SELL', type: 'MARKET', quantity: 0.1, reduceOnly: true, leverage: 5 });

    const staleStop = broker.getOpenOrders().find((o) => o.id === stop.id);
    expect(staleStop).toBeUndefined(); // canceled, no longer open
  });

  it('cancels stale reduce-only brackets when a position flips direction', () => {
    broker.onMarket({
      symbol: 'BTCUSDT', bid: 100, ask: 100.1, last: 100.05, mark: 100,
      localTsUtc: Date.now(), stale: false,
    });

    broker.submitOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.1, leverage: 5 });
    const staleLongStop = broker.submitOrder({
      symbol: 'BTCUSDT', side: 'SELL', type: 'STOP_MARKET', quantity: 0.1, stopPrice: 95, reduceOnly: true, leverage: 5,
    });

    // A large opposite-side non-reduceOnly order flips LONG 0.1 straight to SHORT 0.1
    broker.submitOrder({ symbol: 'BTCUSDT', side: 'SELL', type: 'MARKET', quantity: 0.2, leverage: 5 });

    const position = broker.getPosition('BTCUSDT');
    expect(position?.qty).toBeCloseTo(-0.1);

    const survivingOrder = broker.getOpenOrders().find((o) => o.id === staleLongStop.id);
    expect(survivingOrder).toBeUndefined(); // the old SELL-side stop can never fire against a SHORT
  });

  it('accumulates position qty without floating-point drift across repeated fills', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      localTsUtc: Date.now(),
      stale: false,
    });

    // 0.1 + 0.2 + 0.1 !== 0.4 in plain JS float math (0.30000000000000004 style
    // drift) — three increasing fills on the same side should still land exactly
    // on a clean, instrument-precision quantity.
    broker.submitOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.1, leverage: 5 });
    broker.submitOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.2, leverage: 5 });
    broker.submitOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.1, leverage: 5 });

    const position = broker.getPosition('BTCUSDT');
    expect(position?.qty).toBe(0.4);
    expect(String(position?.qty)).toBe('0.4'); // not "0.4000000000000001" or similar
  });

  it('reopening a closed position resets status to OPEN, not stuck at CLOSED', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      localTsUtc: Date.now(),
      stale: false,
    });

    broker.submitOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.1, leverage: 5 });
    broker.submitOrder({ symbol: 'BTCUSDT', side: 'SELL', type: 'MARKET', quantity: 0.1, reduceOnly: true, leverage: 5 });

    expect(broker.getPosition('BTCUSDT')?.status).toBe('CLOSED');
    expect(broker.getAccount().openPositionsCount).toBe(0);

    broker.submitOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.1, leverage: 5 });

    const reopened = broker.getPosition('BTCUSDT');
    expect(reopened?.status).toBe('OPEN');
    expect(reopened?.qty).toBeCloseTo(0.1);
    expect(broker.getAccount().openPositionsCount).toBe(1);
  });

  it('rejects reduce-only orders that would increase position', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      localTsUtc: Date.now(),
      stale: false,
    });

    broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.1,
      leverage: 5,
    });

    const bad = broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.1,
      reduceOnly: true,
      leverage: 5,
    });

    expect(bad.status).toBe('REJECTED');
    expect(bad.rejectReason).toBe('REDUCE_ONLY_WOULD_INCREASE');
  });

  it('rejects orders exceeding max notional', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      localTsUtc: Date.now(),
      stale: false,
    });

    const order = broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 100, // 100 * 100 = 10000 > maxOrderNotional 5000
      leverage: 5,
    });

    expect(order.status).toBe('REJECTED');
    expect(order.rejectReason).toBe('MAX_ORDER_NOTIONAL_EXCEEDED');
  });

  it('places a limit order that rests and fills later', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      localTsUtc: Date.now(),
      stale: false,
    });

    const limit = broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 0.06,
      price: 99,
      leverage: 5,
    });

    expect(limit.status).toBe('NEW');
    expect(broker.getOpenOrders().length).toBe(1);

    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 98,
      ask: 98.5,
      last: 98.2,
      mark: 98.3,
      localTsUtc: Date.now(),
      stale: false,
    });

    expect(limit.status).toBe('FILLED');
    expect(broker.getPosition('BTCUSDT')?.qty).toBeCloseTo(0.06, 10);
  });

  it('cancels open orders', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      localTsUtc: Date.now(),
      stale: false,
    });

    const limit = broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 0.06,
      price: 99,
      leverage: 5,
    });

    broker.cancelOrder(limit.id);
    expect(limit.status).toBe('CANCELED');
    expect(broker.getOpenOrders().length).toBe(0);
  });

  it('applies funding to open positions', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      fundingRate: 0.001,
      nextFundingTimeUtc: String(Date.now() + 3600000),
      localTsUtc: Date.now(),
      stale: false,
    });

    broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.1,
      leverage: 5,
    });

    broker.applyFunding();

    // funding payment = qty * mark * rate = 0.1 * 100 * 0.001 = 0.01 (long pays positive rate)
    expect(broker.getAccount().totalFunding).toBeCloseTo(0.01, 8);
  });

  it('emits order, fill, and position events to the event sink', () => {
    const sink: OrderEventSink = {
      appendOrderEvent: vi.fn(),
      appendFill: vi.fn(),
      appendPositionEvent: vi.fn(),
      appendFundingPayment: vi.fn(),
    };

    const brokerWithSink = new PaperBroker({
      dataDir: '/tmp/paper-broker-test',
      accountId: 'test-account',
      startingUsdt: 10000,
      instruments: [BTC],
      eventLog: sink,
    });

    brokerWithSink.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      localTsUtc: Date.now(),
      stale: false,
    });

    brokerWithSink.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.1,
      leverage: 5,
    });

    expect(sink.appendOrderEvent).toHaveBeenCalled();
    expect(sink.appendFill).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'BTCUSDT', side: 'BUY' })
    );
    expect(sink.appendPositionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'OPEN', qtyAfter: 0.1 })
    );
  });

  it('records correct position qty before/after on fills', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      localTsUtc: Date.now(),
      stale: false,
    });

    broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.1,
      leverage: 5,
    });

    const fill = broker.getFills()[0];
    expect(fill?.positionQtyBefore).toBe(0);
    expect(fill?.positionQtyAfter).toBeCloseTo(0.1, 10);
    expect(fill?.positionEntryAfter).toBeCloseTo(100.12, 2);
  });

  it('accumulates per-position fees across fills', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      localTsUtc: Date.now(),
      stale: false,
    });

    broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.1,
      leverage: 5,
    });
    broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.1,
      leverage: 5,
    });

    const fees = broker.getFills().reduce((sum, f) => sum + f.fee, 0);
    expect(broker.getPosition('BTCUSDT')?.totalFees).toBeCloseTo(fees, 10);
    expect(broker.getPosition('BTCUSDT')?.qty).toBeCloseTo(0.2, 10);
  });

  it('H-15: tracks a true intraday peak equity (not day-start) and computes drawdown from it', () => {
    broker.onMarket({
      symbol: 'BTCUSDT', bid: 100, ask: 100.1, last: 100.05, mark: 100,
      localTsUtc: Date.now(), stale: false,
    });
    broker.submitOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 1, leverage: 5 });

    // Price rallies -> equity rises well above the starting 10000 balance ->
    // a new peak, tracked independently of the UTC-day boundary.
    broker.onMarket({
      symbol: 'BTCUSDT', bid: 149.9, ask: 150.1, last: 150, mark: 150,
      localTsUtc: Date.now(), stale: false,
    });
    const atPeak = broker.getAccount();
    expect(atPeak.equity).toBeGreaterThan(10000);
    expect(atPeak.peakEquity).toBeCloseTo(atPeak.equity, 6);
    expect(atPeak.drawdown).toBe(0);

    // Price pulls back, but equity is STILL above the day-start balance of
    // 10000 — under the old (dayStartEquity - equity)/dayStartEquity
    // calculation this would clamp to 0 despite a real pullback from the peak.
    broker.onMarket({
      symbol: 'BTCUSDT', bid: 119.9, ask: 120.1, last: 120, mark: 120,
      localTsUtc: Date.now(), stale: false,
    });
    const afterPullback = broker.getAccount();
    expect(afterPullback.equity).toBeGreaterThan(10000);
    expect(afterPullback.equity).toBeLessThan(atPeak.equity);
    expect(afterPullback.peakEquity).toBeCloseTo(atPeak.peakEquity, 6); // peak persists, not reset
    expect(afterPullback.drawdown).toBeGreaterThan(0); // real pullback is now captured
  });

  describe('forced liquidation (C-04)', () => {
    // Previously, checkLiquidation() closed positions by calling applyPositionFill()
    // directly — no Fill record, no fee, no ORDER_FILLED event. It now routes
    // through executeFill() via a synthetic strategyId=LIQUIDATION order, so the
    // forced close leaves the same audit trail as any other close.
    it('creates a tagged Fill, charges a fee, updates the order/position event log, and closes the position', () => {
      const eventLog = {
        appendOrderEvent: vi.fn(),
        appendFill: vi.fn(),
        appendPositionEvent: vi.fn(),
        appendFundingPayment: vi.fn(),
      };

      const liqBroker = new PaperBroker({
        dataDir: '/tmp/paper-broker-test',
        accountId: 'test-account',
        startingUsdt: 10000,
        instruments: [BTC],
        takerFeeRate: 0.0004,
        makerFeeRate: 0.0002,
        risk: { maxLeverage: 20, maxOrderNotional: 50000, maxPositionNotional: 50000 },
        eventLog,
      });

      liqBroker.onMarket({
        symbol: 'BTCUSDT', bid: 99.9, ask: 100.1, last: 100, mark: 100,
        localTsUtc: Date.now(), stale: false,
      });

      const open = liqBroker.submitOrder({
        symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 200, leverage: 20,
      });
      expect(open.status).toBe('FILLED');
      expect(liqBroker.getAccount().liquidations).toBe(0);

      eventLog.appendFill.mockClear();
      eventLog.appendOrderEvent.mockClear();

      // Crash the mark price hard enough that equity falls well below
      // maintenanceMargin (0.5% of notional) — this must trip checkLiquidation()
      // synchronously inside onMarket().
      liqBroker.onMarket({
        symbol: 'BTCUSDT', bid: 39.9, ask: 40.1, last: 40, mark: 40,
        localTsUtc: Date.now(), stale: false,
      });

      const account = liqBroker.getAccount();
      expect(account.liquidations).toBe(1);

      const position = liqBroker.getPosition('BTCUSDT');
      expect(position?.qty).toBe(0);
      expect(position?.status).toBe('CLOSED');

      // A real Fill record was created and charged a fee (previously: neither).
      const liqFill = liqBroker.getFills().find((f) => f.price === 40);
      expect(liqFill).toBeDefined();
      expect(liqFill?.fee).toBeGreaterThan(0);
      expect(liqFill?.quantity).toBe(200);

      // The audit trail (EventLog) actually saw the fill and the order event —
      // this is the part that was silently skipped before the fix.
      expect(eventLog.appendFill).toHaveBeenCalledWith(
        expect.objectContaining({ price: 40, quantity: 200 })
      );
      expect(eventLog.appendOrderEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'ORDER_FILLED', reason: 'LIQUIDATION' })
      );
      expect(liqFill?.orderId).toBeDefined();
    });
  });
});
describe('PaperBroker onFill hook', () => {
  function brokerWithHook(onFill: (fill: Fill) => void) {
    const b = new PaperBroker({
      dataDir: '/tmp/paper-broker-test',
      accountId: 'test-account',
      startingUsdt: 10000,
      instruments: [BTC],
      takerFeeRate: 0.0004,
      makerFeeRate: 0.0002,
      onFill,
    });
    b.onMarket({ symbol: 'BTCUSDT', bid: 59_990, ask: 60_010, last: 60_000, mark: 60_000 });
    return b;
  }

  it('fires on every fill and carries realized PnL and strategyId', () => {
    const fills: Fill[] = [];
    const b = brokerWithHook((f) => fills.push(f));

    b.submitOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.01,
      strategyId: 'alpha',
    });

    expect(fills).toHaveLength(1);
    expect(fills[0]?.strategyId).toBe('alpha');
    // An opening fill realizes nothing.
    expect(fills[0]?.realizedPnl).toBe(0);

    // Close into a higher mark — this one realizes.
    b.onMarket({ symbol: 'BTCUSDT', bid: 60_990, ask: 61_010, last: 61_000, mark: 61_000 });
    b.submitOrder({
      symbol: 'BTCUSDT',
      side: 'SELL',
      type: 'MARKET',
      quantity: 0.01,
      strategyId: 'alpha',
      reduceOnly: true,
    });

    expect(fills).toHaveLength(2);
    expect(fills[1]?.realizedPnl).toBeGreaterThan(0);
  });

  it('isolates a throwing listener so the fill still completes', () => {
    const b = brokerWithHook(() => {
      throw new Error('observer exploded');
    });

    expect(() =>
      b.submitOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.01 })
    ).not.toThrow();

    // The ledger is intact despite the listener failing.
    const position = b.getPosition('BTCUSDT');
    expect(position?.qty).toBeCloseTo(0.01, 8);
  });

  it('is optional — a broker with no hook behaves exactly as before', () => {
    const b = createBroker();
    b.onMarket({ symbol: 'BTCUSDT', bid: 59_990, ask: 60_010, last: 60_000, mark: 60_000 });

    const order = b.submitOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.01 });
    expect(order.status).toBe('FILLED');
  });


});

describe('PaperBroker reduce-only clamping', () => {
  let broker: PaperBroker;

  beforeEach(() => {
    broker = createBroker();
  });

  // Regression: an oversized reduce-only order (a full-size resting stop left
  // behind after a partial close) used to slip past REDUCE_ONLY_WOULD_INCREASE
  // — a flip to a SMALLER absolute size is not an "increase" — and land in
  // applyPositionFill's FLIP branch, opening an opposite-side position from a
  // reduce-only order. Exchange semantics clamp to the open position instead.
  it('clamps an oversized reduce-only order to the open position', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 100,
      ask: 100.1,
      last: 100.05,
      mark: 100,
      localTsUtc: Date.now(),
      stale: false,
    });

    broker.submitOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 1, leverage: 5 });
    expect(broker.getPosition('BTCUSDT')?.qty).toBe(1);

    const oversizedClose = broker.submitOrder({
      symbol: 'BTCUSDT',
      side: 'SELL',
      type: 'MARKET',
      quantity: 1.5,
      leverage: 5,
      reduceOnly: true,
    });

    expect(oversizedClose.status).toBe('FILLED');
    expect(oversizedClose.quantity).toBe(1);
    expect(broker.getPosition('BTCUSDT')?.qty).toBe(0);
    expect(broker.getPosition('BTCUSDT')?.status).toBe('CLOSED');
  });

  it('resetAccount cancels open orders, clears positions, and resets balance', () => {
    broker.onMarket({
      symbol: 'BTCUSDT',
      bid: 50000,
      ask: 50001,
      last: 50000,
      mark: 50000,
      localTsUtc: Date.now(),
      stale: false,
    });

    broker.submitOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.1, leverage: 5 });
    expect(broker.getPositions().length).toBeGreaterThan(0);

    const account = broker.resetAccount(12000);
    expect(account.walletBalance).toBe(12000);
    expect(account.equity).toBe(12000);
    expect(account.openPositionsCount).toBe(0);
    expect(account.openOrdersCount).toBe(0);
    expect(broker.getPositions().length).toBe(0);
    expect(broker.getOpenOrders().length).toBe(0);
  });
});
