import type Database from 'better-sqlite3';
import type { Fill, Order, Position, BrokerPersister } from '../broker/types.js';

export class SQLiteBrokerPersister implements BrokerPersister {
  private db: Database.Database;
  private insertOrder: Database.Statement;
  private insertFill: Database.Statement;
  private insertPosition: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;
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

  loadOpenPositions(accountId = 'paper-main'): Position[] {
    const rows = this.db.prepare(`
      SELECT * FROM positions
      WHERE account_id = ? AND status = 'OPEN' AND CAST(qty AS REAL) != 0
    `).all(accountId) as Array<{
      account_id: string;
      symbol: string;
      position_side: string;
      status: string;
      qty: string;
      entry_price: string;
      unrealized_pnl: string;
      realized_pnl: string;
      leverage: number;
      margin_type: string | null;
      initial_margin: string;
      maintenance_margin: string;
      maintenance_margin_rate: string;
      total_fees: string;
      total_funding: string;
      opened_at_utc: string | null;
      updated_at_utc: string;
      closed_at_utc: string | null;
    }>;

    return rows.map((r) => ({
      accountId: r.account_id,
      symbol: r.symbol,
      positionSide: r.position_side as Position['positionSide'],
      status: r.status as 'OPEN' | 'CLOSED',
      qty: parseFloat(r.qty || '0'),
      entryPrice: parseFloat(r.entry_price || '0'),
      unrealizedPnl: parseFloat(r.unrealized_pnl || '0'),
      realizedPnl: parseFloat(r.realized_pnl || '0'),
      leverage: Number(r.leverage || 5),
      marginType: r.margin_type as Position['marginType'],
      initialMargin: parseFloat(r.initial_margin || '0'),
      maintenanceMargin: parseFloat(r.maintenance_margin || '0'),
      maintenanceMarginRate: parseFloat(r.maintenance_margin_rate || '0.005'),
      totalFees: parseFloat(r.total_fees || '0'),
      totalFunding: parseFloat(r.total_funding || '0'),
      openedAtUtc: r.opened_at_utc ?? undefined,
      updatedAtUtc: r.updated_at_utc || new Date().toISOString(),
      closedAtUtc: r.closed_at_utc ?? undefined,
    }));
  }

  loadOpenOrders(accountId = 'paper-main'): Order[] {
    const rows = this.db.prepare(`
      SELECT * FROM orders
      WHERE account_id = ? AND status IN ('NEW', 'PARTIALLY_FILLED')
    `).all(accountId) as Array<{
      id: string;
      client_order_id: string | null;
      account_id: string;
      symbol: string;
      strategy_id: string | null;
      signal_id: string | null;
      side: string;
      type: string;
      time_in_force: string;
      status: string;
      position_side: string;
      quantity: string;
      filled_qty: string;
      limit_price: string | null;
      stop_price: string | null;
      avg_fill_price: string;
      leverage: number;
      margin_type: string | null;
      reduce_only: number;
      post_only: number;
      close_position: number;
      reject_reason: string | null;
      submitted_at_utc: string;
      updated_at_utc: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      clientOrderId: r.client_order_id || r.id,
      accountId: r.account_id,
      symbol: r.symbol,
      strategyId: r.strategy_id ?? undefined,
      signalId: r.signal_id ?? undefined,
      side: r.side as Order['side'],
      type: r.type as Order['type'],
      timeInForce: r.time_in_force as Order['timeInForce'],
      status: r.status as Order['status'],
      positionSide: r.position_side as Order['positionSide'],
      quantity: parseFloat(r.quantity || '0'),
      filledQty: parseFloat(r.filled_qty || '0'),
      limitPrice: r.limit_price !== null ? parseFloat(r.limit_price) : undefined,
      stopPrice: r.stop_price !== null ? parseFloat(r.stop_price) : undefined,
      avgFillPrice: parseFloat(r.avg_fill_price || '0'),
      leverage: Number(r.leverage || 5),
      marginType: r.margin_type as Order['marginType'],
      reduceOnly: Boolean(r.reduce_only),
      postOnly: Boolean(r.post_only),
      closePosition: Boolean(r.close_position),
      rejectReason: r.reject_reason ?? undefined,
      submittedAtUtc: r.submitted_at_utc || new Date().toISOString(),
      updatedAtUtc: r.updated_at_utc || new Date().toISOString(),
    }));
  }
}