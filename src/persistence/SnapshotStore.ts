import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { AccountState, MarketState } from '../broker/types.js';

export class SnapshotStore {
  private db: Database.Database;
  private snapshotDir: string;

  /**
   * `db` must be a shared connection to the same `paper.sqlite3` file owned by
   * `DatabaseManager` (see C-03 in the code review) rather than a connection
   * SnapshotStore opens itself — three independent connections to one SQLite
   * file with inconsistent pragmas risked corruption under concurrent writes.
   */
  constructor(snapshotDir: string, db: Database.Database) {
    this.snapshotDir = snapshotDir;
    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, { recursive: true });
    }

    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS account_snapshots (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        ts_utc TEXT NOT NULL,
        wallet_balance TEXT NOT NULL,
        unrealized_pnl TEXT NOT NULL,
        equity TEXT NOT NULL,
        initial_margin TEXT NOT NULL,
        maintenance_margin TEXT NOT NULL,
        available_balance TEXT NOT NULL,
        margin_ratio TEXT,
        total_fees TEXT NOT NULL,
        total_funding TEXT NOT NULL,
        total_realized_pnl TEXT NOT NULL,
        open_positions_count INTEGER NOT NULL,
        open_orders_count INTEGER NOT NULL,
        peak_equity TEXT,
        drawdown TEXT,
        liquidations INTEGER NOT NULL DEFAULT 0,
        payload TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_account_snapshots_account_time
        ON account_snapshots(account_id, ts_utc);

      CREATE TABLE IF NOT EXISTS market_states_current (
        symbol TEXT PRIMARY KEY,
        bid TEXT,
        ask TEXT,
        bid_qty TEXT,
        ask_qty TEXT,
        last TEXT,
        mark TEXT,
        index_price TEXT,
        funding_rate TEXT,
        next_funding_time_utc TEXT,
        exchange_ts_utc TEXT,
        local_ts_utc TEXT NOT NULL,
        stale BOOLEAN NOT NULL DEFAULT FALSE
      );

      CREATE TABLE IF NOT EXISTS market_ticks_1s (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        ts_utc TEXT NOT NULL,
        bid TEXT,
        ask TEXT,
        last TEXT,
        mark TEXT,
        index_price TEXT,
        funding_rate TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_market_ticks_1s_symbol_time
        ON market_ticks_1s(symbol, ts_utc);

      CREATE TABLE IF NOT EXISTS klines_1m (
        symbol TEXT NOT NULL,
        open_time_utc TEXT NOT NULL,
        open TEXT NOT NULL,
        high TEXT NOT NULL,
        low TEXT NOT NULL,
        close TEXT NOT NULL,
        volume TEXT NOT NULL,
        quote_volume TEXT,
        PRIMARY KEY (symbol, open_time_utc)
      );
    `);
  }

  saveAccountSnapshot(account: AccountState, accountId: string): void {
    const id = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO account_snapshots (
        id, account_id, ts_utc, wallet_balance, unrealized_pnl, equity,
        initial_margin, maintenance_margin, available_balance, margin_ratio,
        total_fees, total_funding, total_realized_pnl, open_positions_count,
        open_orders_count, peak_equity, drawdown, liquidations, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      accountId,
      now,
      String(account.walletBalance),
      String(account.unrealizedPnl),
      String(account.equity),
      String(account.initialMargin),
      String(account.maintenanceMargin),
      String(account.availableBalance),
      account.marginRatio ? String(account.marginRatio) : null,
      String(account.totalFees),
      String(account.totalFunding),
      String(account.totalRealizedPnl),
      account.openPositionsCount,
      account.openOrdersCount,
      account.peakEquity ? String(account.peakEquity) : null,
      account.drawdown ? String(account.drawdown) : null,
      account.liquidations,
      null
    );

    const snapshotFile = path.join(this.snapshotDir, `account-${accountId}-latest.json`);
    fs.writeFileSync(snapshotFile, JSON.stringify({ id, ts: now, account }, null, 2));
  }

  saveMarketState(market: MarketState): void {
    this.db.prepare(`
      INSERT INTO market_states_current (
        symbol, bid, ask, bid_qty, ask_qty, last, mark, index_price,
        funding_rate, next_funding_time_utc, exchange_ts_utc, local_ts_utc, stale
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        bid = excluded.bid, ask = excluded.ask, bid_qty = excluded.bid_qty,
        ask_qty = excluded.ask_qty, last = excluded.last, mark = excluded.mark,
        index_price = excluded.index_price, funding_rate = excluded.funding_rate,
        next_funding_time_utc = excluded.next_funding_time_utc,
        exchange_ts_utc = excluded.exchange_ts_utc,
        local_ts_utc = excluded.local_ts_utc, stale = excluded.stale
    `).run(
      market.symbol,
      market.bid ? String(market.bid) : null,
      market.ask ? String(market.ask) : null,
      market.bidQty ? String(market.bidQty) : null,
      market.askQty ? String(market.askQty) : null,
      market.last ? String(market.last) : null,
      market.mark ? String(market.mark) : null,
      market.index ? String(market.index) : null,
      market.fundingRate ? String(market.fundingRate) : null,
      market.nextFundingTimeUtc ?? null,
      market.exchangeTsUtc ?? null,
      String(market.localTsUtc),
      market.stale ? 1 : 0
    );
  }

  saveMarketTick1s(tick: {
    symbol: string;
    ts: number;
    bid?: number;
    ask?: number;
    last?: number;
    mark?: number;
    index?: number;
    fundingRate?: number;
  }): void {
    const id = `tick-${tick.ts}-${tick.symbol}`;

    this.db.prepare(`
      INSERT OR IGNORE INTO market_ticks_1s (
        id, symbol, ts_utc, bid, ask, last, mark, index_price, funding_rate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      tick.symbol,
      new Date(tick.ts).toISOString(),
      tick.bid ? String(tick.bid) : null,
      tick.ask ? String(tick.ask) : null,
      tick.last ? String(tick.last) : null,
      tick.mark ? String(tick.mark) : null,
      tick.index ? String(tick.index) : null,
      tick.fundingRate ? String(tick.fundingRate) : null
    );
  }

  saveKline1m(kline: {
    symbol: string;
    openTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    quoteVolume: number;
  }): void {
    this.db.prepare(`
      INSERT INTO klines_1m (
        symbol, open_time_utc, open, high, low, close, volume, quote_volume
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol, open_time_utc) DO UPDATE SET
        open = excluded.open, high = excluded.high, low = excluded.low,
        close = excluded.close, volume = excluded.volume, quote_volume = excluded.quote_volume
    `).run(
      kline.symbol,
      new Date(kline.openTime).toISOString(),
      String(kline.open),
      String(kline.high),
      String(kline.low),
      String(kline.close),
      String(kline.volume),
      String(kline.quoteVolume)
    );
  }

  queryAccountSnapshots(accountId: string, limit = 100): Array<{
    ts: string;
    equity: number;
    walletBalance: number;
    totalRealizedPnl: number;
    drawdown: number | null;
  }> {
    const rows = this.db.prepare(`
      SELECT ts_utc, equity, wallet_balance, total_realized_pnl, drawdown
      FROM account_snapshots
      WHERE account_id = ?
      ORDER BY ts_utc DESC
      LIMIT ?
    `).all(accountId, limit) as Array<{
      ts_utc: string;
      equity: string;
      wallet_balance: string;
      total_realized_pnl: string;
      drawdown: string | null;
    }>;

    return rows.reverse().map(r => ({
      ts: r.ts_utc,
      equity: Number(r.equity),
      walletBalance: Number(r.wallet_balance),
      totalRealizedPnl: Number(r.total_realized_pnl),
      drawdown: r.drawdown ? Number(r.drawdown) : null,
    }));
  }

  /** No-op: the underlying connection is shared and owned/closed by DatabaseManager. */
  close(): void {
    // intentionally does not close `this.db` — see constructor doc.
  }
}