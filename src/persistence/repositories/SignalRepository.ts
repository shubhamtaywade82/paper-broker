import type Database from 'better-sqlite3';
import type { Signal, SignalInput, SignalStatus } from '../../strategy/signal.js';

interface Row {
  id: string;
  ts: number;
  strategy_id: string;
  symbol: string;
  action: string;
  confidence: number;
  stop_loss_price: string | null;
  take_profit_price: string | null;
  ttl_ms: number;
  features: string;
  reasoning: string | null;
  status: string;
  order_id: string | null;
  reject_reason: string | null;
}

export class SignalRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS signals (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        strategy_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        action TEXT NOT NULL,
        confidence REAL NOT NULL,
        stop_loss_price TEXT,
        take_profit_price TEXT,
        ttl_ms INTEGER NOT NULL DEFAULT 60000,
        features TEXT NOT NULL DEFAULT '{}',
        reasoning TEXT,
        status TEXT NOT NULL DEFAULT 'CREATED',
        order_id TEXT,
        reject_reason TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_signals_ts ON signals(ts);
      CREATE INDEX IF NOT EXISTS idx_signals_strategy ON signals(strategy_id);
      CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol);
      CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
    `);
  }

  insert(signal: Signal): void {
    this.db.prepare(`
      INSERT INTO signals (
        id, ts, strategy_id, symbol, action, confidence, stop_loss_price,
        take_profit_price, ttl_ms, features, reasoning, status, order_id, reject_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      signal.id,
      signal.ts,
      signal.strategyId,
      signal.symbol,
      signal.action,
      signal.confidence,
      signal.stopLossPrice ?? null,
      signal.takeProfitPrice ?? null,
      signal.ttlMs,
      JSON.stringify(signal.features),
      signal.reasoning ?? null,
      signal.status,
      signal.orderId ?? null,
      signal.rejectReason ?? null
    );
  }

  updateStatus(id: string, status: SignalStatus, orderId?: string, rejectReason?: string): void {
    this.db.prepare(`
      UPDATE signals SET status = ?, order_id = COALESCE(?, order_id), reject_reason = ?
      WHERE id = ?
    `).run(status, orderId ?? null, rejectReason ?? null, id);
  }

  findById(id: string): Signal | undefined {
    const row = this.db.prepare('SELECT * FROM signals WHERE id = ?').get(id) as
      | Row
      | undefined;

    if (!row) return undefined;
    return this.mapRow(row);
  }

  list(options?: { limit?: number; status?: SignalStatus; strategyId?: string }): Signal[] {
    let sql = 'SELECT * FROM signals WHERE 1=1';
    const params: unknown[] = [];

    if (options?.status) {
      sql += ' AND status = ?';
      params.push(options.status);
    }
    if (options?.strategyId) {
      sql += ' AND strategy_id = ?';
      params.push(options.strategyId);
    }

    sql += ' ORDER BY ts DESC';
    sql += ` LIMIT ${options?.limit ?? 100}`;

    const rows = this.db.prepare(sql).all(...params) as Row[];
    return rows.map((row) => this.mapRow(row));
  }

  private mapRow(row: Row): Signal {
    return {
      id: String(row.id),
      ts: Number(row.ts),
      strategyId: String(row.strategy_id),
      symbol: String(row.symbol),
      action: String(row.action) as SignalInput['action'],
      confidence: Number(row.confidence),
      stopLossPrice: row.stop_loss_price ? String(row.stop_loss_price) : undefined,
      takeProfitPrice: row.take_profit_price ? String(row.take_profit_price) : undefined,
      ttlMs: Number(row.ttl_ms),
      features: JSON.parse(String(row.features)),
      reasoning: row.reasoning ? String(row.reasoning) : undefined,
      status: String(row.status) as SignalStatus,
      orderId: row.order_id ? String(row.order_id) : undefined,
      rejectReason: row.reject_reason ? String(row.reject_reason) : undefined,
    };
  }
}