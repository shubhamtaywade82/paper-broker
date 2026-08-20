import type Database from 'better-sqlite3';
import type { Fill, Order, Position, BrokerPersister } from '../broker/types.js';

export class SQLiteBrokerPersister implements BrokerPersister {
  private insertOrder: Database.Statement;
  private insertFill: Database.Statement;
  private insertPosition: Database.Statement;

  constructor(db: Database.Database) {
    this.insertOrder = db.prepare(`
      INSERT INTO orders (
        id, client_order_id, account_id, symbol, strategy_id, signal_id,
        side, type, time_in_force, status, position_side,
        quantity, filled_qty, limit_price, stop_price, avg_fill_price,
        leverage, margin_type, reduce_only, post_only, close_position,
        reject_reason, submitted_at_utc, updated_at_utc
      ) VALUES (
        @id, @clientOrderId, @accountId, @symbol, @strategyId, @signalId,
        @side, @type, @timeInForce, @status, @positionSide,
        @quantity, @filledQty, @limitPrice, @stopPrice, @avgFillPrice,
        @leverage, @marginType, @reduceOnly, @postOnly, @closePosition,
        @rejectReason, @submittedAtUtc, @updatedAtUtc
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        filled_qty = excluded.filled_qty,
        avg_fill_price = excluded.avg_fill_price,
        reject_reason = excluded.reject_reason,
        updated_at_utc = excluded.updated_at_utc
    `);

    this.insertFill = db.prepare(`
      INSERT OR IGNORE INTO fills (
        id, order_id, account_id, symbol, strategy_id, signal_id,
        side, quantity, price, notional, fee, fee_asset, liquidity,
        realized_pnl, position_qty_before, position_qty_after, fill_ts_utc
      ) VALUES (
        @id, @orderId, @accountId, @symbol, @strategyId, @signalId,
        @side, @quantity, @price, @notional, @fee, @feeAsset, @liquidity,
        @realizedPnl, @positionQtyBefore, @positionQtyAfter, @fillTsUtc
      )
    `);

    this.insertPosition = db.prepare(`
      INSERT INTO positions (
        account_id, symbol, position_side, status,
        qty, entry_price, unrealized_pnl, realized_pnl, leverage, margin_type,
        initial_margin, maintenance_margin, maintenance_margin_rate,
        total_fees, total_funding, opened_at_utc, updated_at_utc, closed_at_utc
      ) VALUES (
        @accountId, @symbol, @positionSide, @status,
        @qty, @entryPrice, @unrealizedPnl, @realizedPnl, @leverage, @marginType,
        @initialMargin, @maintenanceMargin, @maintenanceMarginRate,
        @totalFees, @totalFunding, @openedAtUtc, @updatedAtUtc, @closedAtUtc
      )
      ON CONFLICT(account_id, symbol) DO UPDATE SET
        position_side = excluded.position_side,
        status = excluded.status,
        qty = excluded.qty,
        entry_price = excluded.entry_price,
        unrealized_pnl = excluded.unrealized_pnl,
        realized_pnl = excluded.realized_pnl,
        leverage = excluded.leverage,
        margin_type = excluded.margin_type,
        initial_margin = excluded.initial_margin,
        maintenance_margin = excluded.maintenance_margin,
        maintenance_margin_rate = excluded.maintenance_margin_rate,
        total_fees = excluded.total_fees,
        total_funding = excluded.total_funding,
        opened_at_utc = excluded.opened_at_utc,
        updated_at_utc = excluded.updated_at_utc,
        closed_at_utc = excluded.closed_at_utc
    `);
  }

  saveOrder(order: Order): void {
    this.insertOrder.run({
      id: order.id,
      clientOrderId: order.clientOrderId,
      accountId: order.accountId,
      symbol: order.symbol,
      strategyId: order.strategyId ?? null,
      signalId: order.signalId ?? null,
      side: order.side,
      type: order.type,
      timeInForce: order.timeInForce,
      status: order.status,
      positionSide: order.positionSide,
      quantity: String(order.quantity),
      filledQty: String(order.filledQty),
      limitPrice: order.limitPrice === undefined ? null : String(order.limitPrice),
      stopPrice: order.stopPrice === undefined ? null : String(order.stopPrice),
      avgFillPrice: String(order.avgFillPrice),
      leverage: order.leverage,
      marginType: order.marginType ?? null,
      reduceOnly: order.reduceOnly ? 1 : 0,
      postOnly: order.postOnly ? 1 : 0,
      closePosition: order.closePosition ? 1 : 0,
      rejectReason: order.rejectReason ?? null,
      submittedAtUtc: order.submittedAtUtc,
      updatedAtUtc: order.updatedAtUtc,
    });
  }

  saveFill(fill: Fill): void {
    this.insertFill.run({
      id: fill.id,
      orderId: fill.orderId,
      accountId: fill.accountId,
      symbol: fill.symbol,
      strategyId: fill.strategyId ?? null,
      signalId: fill.signalId ?? null,
      side: fill.side,
      quantity: String(fill.quantity),
      price: String(fill.price),
      notional: String(fill.notional),
      fee: String(fill.fee),
      feeAsset: fill.feeAsset,
      liquidity: fill.liquidity,
      realizedPnl: String(fill.realizedPnl),
      positionQtyBefore: String(fill.positionQtyBefore),
      positionQtyAfter: String(fill.positionQtyAfter),
      fillTsUtc: fill.fillTsUtc,
    });
  }

  savePosition(position: Position): void {
    this.insertPosition.run({
      accountId: position.accountId,
      symbol: position.symbol,
      positionSide: position.positionSide,
      status: position.status,
      qty: String(position.qty),
      entryPrice: String(position.entryPrice),
      unrealizedPnl: String(position.unrealizedPnl),
      realizedPnl: String(position.realizedPnl),
      leverage: position.leverage,
      marginType: position.marginType ?? null,
      initialMargin: String(position.initialMargin),
      maintenanceMargin: String(position.maintenanceMargin),
      maintenanceMarginRate: String(position.maintenanceMarginRate),
      totalFees: String(position.totalFees),
      totalFunding: String(position.totalFunding),
      openedAtUtc: position.openedAtUtc ?? null,
      updatedAtUtc: position.updatedAtUtc,
      closedAtUtc: position.closedAtUtc ?? null,
    });
  }
}