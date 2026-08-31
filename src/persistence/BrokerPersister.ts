import type Database from 'better-sqlite3';
import type { Fill, Order, Position, FundingPayment, LedgerEntry, TransactionRecord, BrokerPersister } from '../broker/types.js';

export class SQLiteBrokerPersister implements BrokerPersister {
  private db: Database.Database;
  private insertOrder: Database.Statement;
  private insertFill: Database.Statement;
  private insertPosition: Database.Statement;
  private insertFundingPayment: Database.Statement;
  private insertLedgerEntry: Database.Statement;
  private insertTransaction: Database.Statement;

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

    this.insertFundingPayment = db.prepare(`
      INSERT OR IGNORE INTO funding_payments (
        id, account_id, symbol, position_side,
        qty, mark_price, funding_rate, payment,
        wallet_balance_after, funding_time_utc, created_at_utc
      ) VALUES (
        @id, @accountId, @symbol, @positionSide,
        @qty, @markPrice, @fundingRate, @payment,
        @walletBalanceAfter, @fundingTimeUtc, @createdAtUtc
      )
    `);

    this.insertLedgerEntry = db.prepare(`
      INSERT INTO ledger_entries (
        id, account_id, event_id, event_type, currency,
        account_code, direction, amount, balance_after,
        related_order_id, related_fill_id, related_position_symbol,
        description, created_at_utc
      ) VALUES (
        @id, @accountId, @eventId, @eventType, @currency,
        @accountCode, @direction, @amount, @balanceAfter,
        @relatedOrderId, @relatedFillId, @relatedPositionSymbol,
        @description, @createdAtUtc
      )
    `);

    this.insertTransaction = db.prepare(`
      INSERT INTO transactions (
        id, account_id, position_id, order_id, fill_id,
        product_type, transaction_type, currency,
        amount, fee, gross_pnl, net_pnl, balance_after,
        metadata, created_at_utc
      ) VALUES (
        @id, @accountId, @positionId, @orderId, @fillId,
        @productType, @transactionType, @currency,
        @amount, @fee, @grossPnl, @netPnl, @balanceAfter,
        @metadata, @createdAtUtc
      )
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

  saveFundingPayment(payment: FundingPayment): void {
    this.insertFundingPayment.run({
      id: payment.id,
      accountId: payment.accountId,
      symbol: payment.symbol,
      positionSide: payment.positionSide,
      qty: String(payment.qty),
      markPrice: String(payment.markPrice),
      fundingRate: String(payment.fundingRate),
      payment: String(payment.payment),
      walletBalanceAfter: String(payment.walletBalanceAfter),
      fundingTimeUtc: payment.fundingTimeUtc,
      createdAtUtc: payment.createdAtUtc,
    });
  }

  saveLedgerEntry(entry: LedgerEntry): void {
    this.insertLedgerEntry.run({
      id: entry.id,
      accountId: entry.accountId,
      eventId: entry.eventId,
      eventType: entry.eventType,
      currency: entry.currency,
      accountCode: entry.accountCode,
      direction: entry.direction,
      amount: String(entry.amount),
      balanceAfter: entry.balanceAfter !== undefined ? String(entry.balanceAfter) : null,
      relatedOrderId: entry.relatedOrderId ?? null,
      relatedFillId: entry.relatedFillId ?? null,
      relatedPositionSymbol: entry.relatedPositionSymbol ?? null,
      description: entry.description ?? null,
      createdAtUtc: entry.createdAtUtc,
    });
  }

  saveTransaction(tx: TransactionRecord): void {
    this.insertTransaction.run({
      id: tx.id,
      accountId: tx.accountId,
      positionId: tx.positionId ?? null,
      orderId: tx.orderId ?? null,
      fillId: tx.fillId ?? null,
      productType: tx.productType,
      transactionType: tx.transactionType,
      currency: tx.currency,
      amount: String(tx.amount),
      fee: String(tx.fee),
      grossPnl: tx.grossPnl !== undefined ? String(tx.grossPnl) : null,
      netPnl: tx.netPnl !== undefined ? String(tx.netPnl) : null,
      balanceAfter: String(tx.balanceAfter),
      metadata: tx.metadata ? JSON.stringify(tx.metadata) : null,
      createdAtUtc: tx.createdAtUtc,
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

  loadFills(accountId = 'paper-main'): Fill[] {
    const rows = this.db.prepare(`
      SELECT * FROM fills
      WHERE account_id = ?
      ORDER BY fill_ts_utc
    `).all(accountId) as Array<{
      id: string;
      order_id: string;
      account_id: string;
      symbol: string;
      strategy_id: string | null;
      signal_id: string | null;
      side: string;
      quantity: string;
      price: string;
      notional: string;
      fee: string;
      fee_asset: string;
      liquidity: string;
      realized_pnl: string;
      position_qty_before: string;
      position_qty_after: string;
      fill_ts_utc: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      orderId: r.order_id,
      accountId: r.account_id,
      symbol: r.symbol,
      strategyId: r.strategy_id ?? undefined,
      signalId: r.signal_id ?? undefined,
      side: r.side as Fill['side'],
      quantity: parseFloat(r.quantity || '0'),
      price: parseFloat(r.price || '0'),
      notional: parseFloat(r.notional || '0'),
      fee: parseFloat(r.fee || '0'),
      feeAsset: r.fee_asset,
      liquidity: r.liquidity as Fill['liquidity'],
      realizedPnl: parseFloat(r.realized_pnl || '0'),
      positionQtyBefore: parseFloat(r.position_qty_before || '0'),
      positionQtyAfter: parseFloat(r.position_qty_after || '0'),
      fillTsUtc: r.fill_ts_utc,
    }));
  }

  loadFundingPayments(accountId = 'paper-main'): FundingPayment[] {
    const rows = this.db.prepare(`
      SELECT * FROM funding_payments
      WHERE account_id = ?
      ORDER BY funding_time_utc
    `).all(accountId) as Array<{
      id: string;
      account_id: string;
      symbol: string;
      position_side: string;
      qty: string;
      mark_price: string;
      funding_rate: string;
      payment: string;
      wallet_balance_after: string;
      funding_time_utc: string;
      created_at_utc: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      symbol: r.symbol,
      positionSide: r.position_side as FundingPayment['positionSide'],
      qty: parseFloat(r.qty || '0'),
      markPrice: parseFloat(r.mark_price || '0'),
      fundingRate: parseFloat(r.funding_rate || '0'),
      payment: parseFloat(r.payment || '0'),
      walletBalanceAfter: parseFloat(r.wallet_balance_after || '0'),
      fundingTimeUtc: r.funding_time_utc,
      createdAtUtc: r.created_at_utc,
    }));
  }

  loadLedgerEntries(accountId = 'paper-main', limit = 100): LedgerEntry[] {
    const rows = this.db.prepare(`
      SELECT * FROM ledger_entries
      WHERE account_id = ?
      ORDER BY created_at_utc DESC
      LIMIT ?
    `).all(accountId, limit) as Array<{
      id: string;
      account_id: string;
      event_id: string;
      event_type: string;
      currency: string;
      account_code: string;
      direction: string;
      amount: string;
      balance_after: string | null;
      related_order_id: string | null;
      related_fill_id: string | null;
      related_position_symbol: string | null;
      description: string | null;
      created_at_utc: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      eventId: r.event_id,
      eventType: r.event_type,
      currency: r.currency,
      accountCode: r.account_code,
      direction: r.direction as 'DEBIT' | 'CREDIT',
      amount: parseFloat(r.amount || '0'),
      balanceAfter: r.balance_after !== null ? parseFloat(r.balance_after) : undefined,
      relatedOrderId: r.related_order_id ?? undefined,
      relatedFillId: r.related_fill_id ?? undefined,
      relatedPositionSymbol: r.related_position_symbol ?? undefined,
      description: r.description ?? undefined,
      createdAtUtc: r.created_at_utc,
    }));
  }

  loadTransactions(
    accountId = 'paper-main',
    options: { period?: string; type?: string; limit?: number; offset?: number } = {}
  ): TransactionRecord[] {
    let sql = 'SELECT * FROM transactions WHERE account_id = ?';
    const params: (string | number)[] = [accountId];

    if (options.type) {
      sql += ' AND transaction_type = ?';
      params.push(options.type);
    }

    if (options.period) {
      const now = Date.now();
      let startTime = 0;
      if (options.period === '7D') {
        startTime = now - 7 * 24 * 60 * 60 * 1000;
      } else if (options.period === '30D') {
        startTime = now - 30 * 24 * 60 * 60 * 1000;
      } else if (options.period === 'FY27') {
        startTime = new Date('2026-04-01T00:00:00.000Z').getTime();
      }
      if (startTime > 0) {
        sql += ' AND created_at_utc >= ?';
        params.push(new Date(startTime).toISOString());
      }
    }

    sql += ' ORDER BY created_at_utc DESC LIMIT ? OFFSET ?';
    params.push(options.limit ?? 50, options.offset ?? 0);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      account_id: string;
      position_id: string | null;
      order_id: string | null;
      fill_id: string | null;
      product_type: string;
      transaction_type: string;
      currency: string;
      amount: string;
      fee: string;
      gross_pnl: string | null;
      net_pnl: string | null;
      balance_after: string;
      metadata: string | null;
      created_at_utc: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      positionId: r.position_id ?? undefined,
      orderId: r.order_id ?? undefined,
      fillId: r.fill_id ?? undefined,
      productType: r.product_type as TransactionRecord['productType'],
      transactionType: r.transaction_type as TransactionRecord['transactionType'],
      currency: r.currency,
      amount: parseFloat(r.amount || '0'),
      fee: parseFloat(r.fee || '0'),
      grossPnl: r.gross_pnl !== null ? parseFloat(r.gross_pnl) : undefined,
      netPnl: r.net_pnl !== null ? parseFloat(r.net_pnl) : undefined,
      balanceAfter: parseFloat(r.balance_after || '0'),
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      createdAtUtc: r.created_at_utc,
    }));
  }

  resetAccountData(accountId = 'paper-main'): void {
    this.db.prepare(`DELETE FROM positions WHERE account_id = ?`).run(accountId);
    this.db.prepare(`UPDATE orders SET status = 'CANCELED', reject_reason = 'ACCOUNT_RESET' WHERE account_id = ? AND status IN ('NEW', 'PARTIALLY_FILLED')`).run(accountId);
    // PaperBroker's constructor rebuilds walletBalance/totalFees/totalRealizedPnl/totalFunding
    // by replaying every persisted fill and funding payment for the account.
    // Leaving old fills/funding behind resurrects pre-reset PnL/fees/funding on the next restart.
    this.db.prepare(`DELETE FROM fills WHERE account_id = ?`).run(accountId);
    this.db.prepare(`DELETE FROM funding_payments WHERE account_id = ?`).run(accountId);
    this.db.prepare(`DELETE FROM transactions WHERE account_id = ?`).run(accountId);
    this.db.prepare(`DELETE FROM ledger_entries WHERE account_id = ?`).run(accountId);
  }
}