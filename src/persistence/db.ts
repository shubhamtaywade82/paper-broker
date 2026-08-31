import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SignalRepository } from './repositories/SignalRepository.js';

export class DatabaseManager {
  private db: Database.Database;
  readonly signals: SignalRepository;

  constructor(dataDir: string) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(path.join(dataDir, 'paper.sqlite3'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    this.initCoreSchema();
    this.signals = new SignalRepository(this.db);
  }

  private initCoreSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        account_mode TEXT NOT NULL,
        starting_usdt TEXT NOT NULL,
        wallet_balance TEXT NOT NULL,
        total_fees TEXT NOT NULL DEFAULT '0',
        total_funding TEXT NOT NULL DEFAULT '0',
        total_realized_pnl TEXT NOT NULL DEFAULT '0',
        liquidations INTEGER NOT NULL DEFAULT 0,
        created_at_utc TEXT NOT NULL,
        updated_at_utc TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS instruments (
        symbol TEXT PRIMARY KEY,
        base_asset TEXT NOT NULL,
        quote_asset TEXT NOT NULL,
        contract_type TEXT NOT NULL,
        status TEXT NOT NULL,
        tick_size TEXT NOT NULL,
        step_size TEXT NOT NULL,
        min_qty TEXT NOT NULL,
        max_qty TEXT,
        min_notional TEXT NOT NULL,
        price_precision INTEGER NOT NULL,
        quantity_precision INTEGER NOT NULL,
        maintenance_margin_rate TEXT NOT NULL,
        created_at_utc TEXT NOT NULL,
        updated_at_utc TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS wallets (
        account_id TEXT NOT NULL,
        product_type TEXT NOT NULL DEFAULT 'FUTURES',
        currency TEXT NOT NULL DEFAULT 'USDT',
        free TEXT NOT NULL DEFAULT '0',
        locked TEXT NOT NULL DEFAULT '0',
        total_fees TEXT NOT NULL DEFAULT '0',
        total_funding TEXT NOT NULL DEFAULT '0',
        total_realized_pnl TEXT NOT NULL DEFAULT '0',
        updated_at_utc TEXT NOT NULL,
        PRIMARY KEY (account_id, product_type, currency)
      );

      CREATE TABLE IF NOT EXISTS ledger_entries (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        currency TEXT NOT NULL,
        account_code TEXT NOT NULL,
        direction TEXT NOT NULL,
        amount TEXT NOT NULL,
        balance_after TEXT,
        related_order_id TEXT,
        related_fill_id TEXT,
        related_position_symbol TEXT,
        description TEXT,
        created_at_utc TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ledger_account_time
        ON ledger_entries(account_id, created_at_utc);

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        client_order_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        strategy_id TEXT,
        signal_id TEXT,
        side TEXT NOT NULL,
        type TEXT NOT NULL,
        time_in_force TEXT NOT NULL,
        status TEXT NOT NULL,
        position_side TEXT NOT NULL,
        quantity TEXT NOT NULL,
        filled_qty TEXT NOT NULL DEFAULT '0',
        limit_price TEXT,
        stop_price TEXT,
        avg_fill_price TEXT NOT NULL DEFAULT '0',
        leverage INTEGER NOT NULL DEFAULT 5,
        margin_type TEXT,
        reduce_only BOOLEAN NOT NULL DEFAULT FALSE,
        post_only BOOLEAN NOT NULL DEFAULT FALSE,
        close_position BOOLEAN NOT NULL DEFAULT FALSE,
        reject_reason TEXT,
        submitted_at_utc TEXT NOT NULL,
        updated_at_utc TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_strategy ON orders(strategy_id);
      CREATE INDEX IF NOT EXISTS idx_orders_signal_id ON orders(signal_id);

      CREATE TABLE IF NOT EXISTS fills (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        strategy_id TEXT,
        signal_id TEXT,
        side TEXT NOT NULL,
        quantity TEXT NOT NULL,
        price TEXT NOT NULL,
        notional TEXT NOT NULL,
        fee TEXT NOT NULL,
        fee_asset TEXT NOT NULL,
        liquidity TEXT NOT NULL,
        realized_pnl TEXT NOT NULL DEFAULT '0',
        position_qty_before TEXT NOT NULL,
        position_qty_after TEXT NOT NULL,
        fill_ts_utc TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_fills_symbol ON fills(symbol);
      CREATE INDEX IF NOT EXISTS idx_fills_order ON fills(order_id);

      CREATE TABLE IF NOT EXISTS positions (
        account_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        position_side TEXT NOT NULL,
        status TEXT NOT NULL,
        qty TEXT NOT NULL DEFAULT '0',
        entry_price TEXT NOT NULL DEFAULT '0',
        unrealized_pnl TEXT NOT NULL DEFAULT '0',
        realized_pnl TEXT NOT NULL DEFAULT '0',
        leverage INTEGER NOT NULL DEFAULT 5,
        margin_type TEXT,
        initial_margin TEXT NOT NULL DEFAULT '0',
        maintenance_margin TEXT NOT NULL DEFAULT '0',
        maintenance_margin_rate TEXT NOT NULL DEFAULT '0.005',
        total_fees TEXT NOT NULL DEFAULT '0',
        total_funding TEXT NOT NULL DEFAULT '0',
        opened_at_utc TEXT,
        updated_at_utc TEXT NOT NULL,
        closed_at_utc TEXT,
        PRIMARY KEY (account_id, symbol)
      );

      CREATE TABLE IF NOT EXISTS funding_payments (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        position_side TEXT NOT NULL,
        qty TEXT NOT NULL,
        mark_price TEXT NOT NULL,
        funding_rate TEXT NOT NULL,
        payment TEXT NOT NULL,
        wallet_balance_after TEXT NOT NULL,
        funding_time_utc TEXT NOT NULL,
        created_at_utc TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        position_id TEXT,
        order_id TEXT,
        fill_id TEXT,
        product_type TEXT NOT NULL DEFAULT 'FUTURES',
        transaction_type TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USDT',
        amount TEXT NOT NULL,
        fee TEXT NOT NULL DEFAULT '0',
        gross_pnl TEXT,
        net_pnl TEXT,
        balance_after TEXT NOT NULL,
        metadata TEXT,
        created_at_utc TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_transactions_account_time ON transactions(account_id, created_at_utc);
      CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(transaction_type);

      CREATE TABLE IF NOT EXISTS risk_events (
        id TEXT PRIMARY KEY,
        ts_utc TEXT NOT NULL,
        account_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        symbol TEXT,
        reason TEXT,
        payload TEXT,
        created_at_utc TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_risk_events_time ON risk_events(ts_utc);

      CREATE TABLE IF NOT EXISTS strategies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        symbols TEXT NOT NULL DEFAULT '[]',
        intervals TEXT NOT NULL DEFAULT '[]',
        priority INTEGER NOT NULL DEFAULT 0,
        cooldown_ms INTEGER NOT NULL DEFAULT 0,
        updated_at_utc TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_inferences (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        strategy_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt TEXT,
        raw_response TEXT,
        parsed_intent TEXT,
        status TEXT NOT NULL,
        latency_ms INTEGER,
        error TEXT,
        created_at_utc TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ai_inferences_time ON ai_inferences(ts);

      CREATE TABLE IF NOT EXISTS system_events (
        id TEXT PRIMARY KEY,
        ts_utc TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT,
        created_at_utc TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_system_events_time ON system_events(ts_utc);

      CREATE TABLE IF NOT EXISTS backtest_runs (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        duration_days REAL NOT NULL,
        initial_equity REAL NOT NULL,
        final_equity REAL NOT NULL,
        total_net_pnl REAL NOT NULL,
        total_return_pct REAL NOT NULL,
        total_trades INTEGER NOT NULL,
        win_rate REAL NOT NULL,
        profit_factor REAL NOT NULL,
        max_drawdown REAL NOT NULL,
        avg_r REAL NOT NULL,
        config_json TEXT NOT NULL,
        report_json TEXT NOT NULL,
        created_at_utc TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_backtest_runs_time ON backtest_runs(created_at_utc);

      CREATE TABLE IF NOT EXISTS metrics_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value REAL NOT NULL,
        ts INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_metrics_snapshots_name_ts ON metrics_snapshots(name, ts);

      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        level TEXT NOT NULL,
        summary TEXT NOT NULL,
        details TEXT,
        resolved BOOLEAN NOT NULL DEFAULT FALSE,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at);
    `);

    // Ensure wallets table has product_type, free, locked columns if created previously
    try {
      const tableInfo = this.db.pragma('table_info(wallets)') as Array<{ name: string }>;
      const columnNames = new Set(tableInfo.map((c) => c.name));
      if (!columnNames.has('product_type')) {
        this.db.exec(`ALTER TABLE wallets ADD COLUMN product_type TEXT NOT NULL DEFAULT 'FUTURES'`);
      }
      if (!columnNames.has('free')) {
        this.db.exec(`ALTER TABLE wallets ADD COLUMN free TEXT NOT NULL DEFAULT '0'`);
      }
      if (!columnNames.has('locked')) {
        this.db.exec(`ALTER TABLE wallets ADD COLUMN locked TEXT NOT NULL DEFAULT '0'`);
      }
    } catch {
      // Best effort schema migration
    }
  }

  get raw(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}