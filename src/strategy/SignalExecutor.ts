import type { ExecutionBroker, Instrument, MarketState } from '../broker/types.js';
import type { Signal } from './signal.js';
import type { OrderFactory } from './OrderFactory.js';
import type { SignalRepository } from '../persistence/repositories/SignalRepository.js';
import type { SizingEngine, SizeResult } from './SizingEngine.js';

export interface SignalExecutorDeps {
  /**
   * Widened from PaperBroker to ExecutionBroker so orders can be routed
   * through ExecutionRouter, which applies the mode profile and the live
   * trading guard before anything reaches a venue. The executor must not know
   * or care which broker is behind the interface.
   */
  broker: ExecutionBroker;
  orderFactory: OrderFactory;
  signals: SignalRepository;
  getMarketState: (symbol: string) => MarketState | undefined;
  logger?: {
    warn: (msg: string) => void;
    error: (error: unknown, msg: string) => void;
  };

  // -----------------------------------------------------------------------
  // SizingEngine fallback for OPEN signals without features.quantity.
  //
  // Background: classic indicator strategies (ema-trend-5m, rsi-mean-reversion
  // -5m, momentum-5m, mean-reversion-5m, breakout-15m, grid-15m) emit signals
  // with stop-loss/take-profit but no quantity. The autonomous agent + SMC +
  // Adaptive Supertrend stack pre-computes quantity in their own pipelines
  // (ts.sizing?.quantity / qty from instrument state), but classic strategies
  // don't have access to account or instrument state — they only see candles
  // and market prices.
  //
  // Before this fallback existed, classic signals reached SignalExecutor with
  // features.quantity = undefined → 0 → ZERO_QUANTITY rejection. The fix:
  // when an OPEN signal arrives without an explicit quantity, SignalExecutor
  // computes one via SizingEngine using account equity, instrument lot size,
  // entry price, and stop-loss distance (or a fallback notional if no SL is
  // set). This is read-only with respect to the broker — sizing never mutates
  // positions (CONTRACTS.md §2).
  //
  // All three fields are optional — when any is missing, SignalExecutor falls
  // back to the historical behavior (quantity = 0 → ZERO_QUANTITY rejection),
  // preserving the contract for callers that never opted in.
  sizingEngine?: SizingEngine;
  getAccount?: () => { equity: number };
  getInstrument?: (symbol: string) => Instrument | undefined;
}

/**
 * Reject reason codes surfaced to the signal repository / event log when
 * SignalExecutor refuses to submit an order. Stable strings so dashboards and
 * alerting can group on them without parsing free-text.
 */
export type SignalRejectReason =
  | 'NO_MARKET_STATE'
  | 'ZERO_QUANTITY'
  | 'SIZING_FAILED'
  | 'ORDER_SUBMISSION_ERROR';

/**
 * Internal shape produced by the size-resolution step. Carries the computed
 * quantity plus a human-readable reason that downstream callers (logs, event
 * log, dashboard) can surface without re-deriving it.
 */
interface ResolvedSize {
  quantity: number;
  reason: string;
}

export class SignalExecutor {
  private deps: SignalExecutorDeps;

  constructor(deps: SignalExecutorDeps) {
    this.deps = deps;
  }

  async execute(signal: Signal): Promise<boolean> {
    const { broker, orderFactory, signals, getMarketState } = this.deps;
    const log = this.deps.logger ?? {
      warn: () => undefined,
      error: () => undefined,
    };

    if (signal.action === 'HOLD' || signal.action === 'CANCEL_ALL') {
      return true;
    }

    const position = await broker.getPosition(signal.symbol);
    const market = getMarketState(signal.symbol);

    const entryPrice =
      signal.action === 'CLOSE_LONG' || signal.action === 'OPEN_SHORT'
        ? market?.bid ?? market?.last ?? market?.mark
        : market?.ask ?? market?.last ?? market?.mark;

    if (entryPrice === undefined || !Number.isFinite(entryPrice) || entryPrice <= 0) {
      // H-18: this used to `return true` — StrategyEngine.processSignal treats
      // a truthy return as success and never marks the signal REJECTED or
      // fires onSignalRejected, so a skipped-for-no-price signal looked
      // identical to a genuinely executed one (no order, no rejection event,
      // no metric, ambiguous persisted status). CONTRACTS.md's Signal
      // Validation Contract requires rejection with an explicit reason, never
      // a silent drop.
      log.warn(`[Signal] No price for ${signal.symbol}, skipping order`);
      signals.updateStatus(signal.id, 'REJECTED', undefined, 'NO_MARKET_STATE');
      return false;
    }

    // Partial closes: when `features.closeFraction` is present (0..1), close
    // only that fraction of the current position instead of flattening it.
    // Used by the autonomous agent's ExitManager for downside de-risking
    // (SCALE_OUT). Absent or invalid → 1 (full close) — the historical
    // behaviour every other caller relies on.
    const rawFraction = Number(signal.features['closeFraction'] ?? 1);
    const closeFraction =
      Number.isFinite(rawFraction) && rawFraction > 0 ? Math.min(1, rawFraction) : 1;
    const closeQty =
      signal.action.startsWith('CLOSE') && position
        ? Math.abs(position.qty) * closeFraction
        : 0;

    // OPEN signals: take explicit quantity from features if supplied (the
    // autonomous agent + SMC + Adaptive Supertrend stack pre-computes one),
    // otherwise fall back to SizingEngine. Classic indicator strategies hit
    // this path because they only set indicators (emaFast, rsi, atr, …) and
    // stop-loss / take-profit.
    let openQty = signal.action.startsWith('OPEN')
      ? Number(signal.features['quantity'] ?? 0)
      : 0;

    if (signal.action.startsWith('OPEN') && (!Number.isFinite(openQty) || openQty <= 0)) {
      const resolved = this.resolveOpenSize(signal, entryPrice);
      if (resolved === null) {
        log.warn(
          `[Signal] Cannot resolve size for ${signal.symbol} ${signal.action} (no sizing engine, account, or instrument), skipping`
        );
        signals.updateStatus(signal.id, 'REJECTED', undefined, 'SIZING_FAILED');
        return false;
      }
      openQty = resolved.quantity;
    }

    const quantity = closeQty > 0 ? closeQty : openQty;
    if (quantity <= 0) {
      // Same fix as the no-price case above — must not report success for a
      // signal that was never actually submitted to the broker.
      log.warn(`[Signal] Zero quantity for ${signal.symbol} ${signal.action}, skipping`);
      signals.updateStatus(signal.id, 'REJECTED', undefined, 'ZERO_QUANTITY');
      return false;
    }

    const leverage = Number(signal.features['leverage'] ?? 5);

    const orderCommand = orderFactory.buildOrder({ signal, quantity, leverage }) ?? {
      symbol: signal.symbol,
      side: signal.action === 'OPEN_LONG' || signal.action === 'CLOSE_SHORT' ? 'BUY' : 'SELL',
      type: 'MARKET',
      quantity,
      leverage,
      reduceOnly: signal.action.startsWith('CLOSE'),
      strategyId: signal.strategyId,
      signalId: signal.id,
    };

    try {
      const order = await broker.submitOrder(orderCommand);

      if (order.status === 'REJECTED') {
        log.warn(`[Signal] Order rejected: ${order.rejectReason ?? 'unknown'}`);
        signals.updateStatus(signal.id, 'REJECTED', undefined, order.rejectReason);
        return false;
      }

      signals.updateStatus(signal.id, 'EXECUTED', order.id);

      if (signal.action.startsWith('OPEN')) {
        if (signal.stopLossPrice) {
          const stop = orderFactory.buildStopLossOrder(signal, quantity, leverage);
          if (stop) {
            const stopOrder = await broker.submitOrder(stop);
            if (stopOrder.status === 'REJECTED') {
              log.warn(`[Signal] Stop order rejected: ${stopOrder.rejectReason ?? 'unknown'}`);
            }
          }
        }
        if (signal.takeProfitPrice) {
          const tp = orderFactory.buildTakeProfitOrder(signal, quantity, leverage);
          if (tp) {
            const tpOrder = await broker.submitOrder(tp);
            if (tpOrder.status === 'REJECTED') {
              log.warn(`[Signal] TP order rejected: ${tpOrder.rejectReason ?? 'unknown'}`);
            }
          }
        }
      }

      return true;
    } catch (error) {
      log.error(error, 'Signal order submission failed');
      // updateStatus(id, status, orderId?, rejectReason?) — the reason belongs
      // in the 4th slot; passing it 3rd wrote 'ORDER_SUBMISSION_ERROR' into the
      // signal's order_id column and left reject_reason null.
      signals.updateStatus(signal.id, 'REJECTED', undefined, 'ORDER_SUBMISSION_ERROR');
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // SizingEngine fallback for OPEN signals without features.quantity.
  // Returns null when sizing can't be computed (any of the three deps missing,
  // or SizingEngine itself throws — e.g. position too small for instrument's
  // min notional). The caller must surface a SIZING_FAILED rejection so the
  // signal's persisted status is unambiguous.
  // -----------------------------------------------------------------------
  private resolveOpenSize(signal: Signal, entryPrice: number): ResolvedSize | null {
    const { sizingEngine, getAccount, getInstrument } = this.deps;
    if (!sizingEngine || !getAccount || !getInstrument) return null;

    const account = getAccount();
    const instrument = getInstrument(signal.symbol);
    if (!account || !instrument) return null;

    const stopLossPrice = signal.stopLossPrice !== undefined
      ? Number(signal.stopLossPrice)
      : undefined;

    let sized: SizeResult;
    try {
      sized = sizingEngine.sizePosition({
        account,
        instrument,
        entryPrice,
        stopLossPrice:
          stopLossPrice !== undefined && Number.isFinite(stopLossPrice) && stopLossPrice > 0
            ? stopLossPrice
            : undefined,
      });
    } catch {
      // SizingEngine throws when the resulting notional is below the
      // instrument's minNotional (e.g. equity too small or stop too tight).
      // That's a real, recoverable condition (the next signal on a different
      // instrument / different stop may succeed) — surface as rejection so
      // the operator sees it in the dashboard.
      return null;
    }

    if (!Number.isFinite(sized.quantity) || sized.quantity <= 0) return null;
    return { quantity: sized.quantity, reason: sized.reason };
  }
}
