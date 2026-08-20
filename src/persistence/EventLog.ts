import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ulid } from 'ulid';
import type {
  Fill,
  PositionEvent,
  AccountState,
  FundingPayment,
  OrderEventType,
  SystemEventType,
} from '../broker/types.js';

export interface EventEnvelope {
  id: string;
  seq: number;
  ts: number;
  type: string;
  payload: unknown;
}

export class EventLog {
  private seq = 0;
  private jsonlFile: string;
  private db: Database.Database;

  constructor(jsonlFile: string) {
    const dataDir = path.dirname(jsonlFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.jsonlFile = jsonlFile;
    this.db = new Database(path.join(dataDir, 'paper.sqlite3'));
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        account_id TEXT,
        symbol TEXT,
        correlation_id TEXT,
        causation_id TEXT,
        schema_version INTEGER NOT NULL DEFAULT 1,
        payload TEXT NOT NULL,
        created_at_utc TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_aggregate ON events(aggregate_type, aggregate_id);
      CREATE INDEX IF NOT EXISTS idx_events_account_time ON events(account_id, created_at_utc);
      CREATE INDEX IF NOT EXISTS idx_events_symbol_time ON events(symbol, created_at_utc);
      CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(event_type, created_at_utc);
    `);
  }

  append(
    type: string,
    payload: unknown,
    options?: {
      aggregateType?: string;
      aggregateId?: string;
      accountId?: string;
      symbol?: string;
      correlationId?: string;
      causationId?: string;
    }
  ): void {
    const now = Date.now();
    const event: EventEnvelope = {
      id: ulid(),
      seq: ++this.seq,
      ts: now,
      type,
      payload,
    };

    const jsonLine = JSON.stringify(event);
    fs.appendFileSync(this.jsonlFile, `${jsonLine}\n`);

    this.db.prepare(`
      INSERT INTO events (id, seq, event_type, aggregate_type, aggregate_id, account_id, symbol, correlation_id, causation_id, payload, created_at_utc)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.seq,
      type,
      options?.aggregateType ?? 'unknown',
      options?.aggregateId ?? 'unknown',
      options?.accountId ?? null,
      options?.symbol ?? null,
      options?.correlationId ?? null,
      options?.causationId ?? null,
      jsonLine,
      new Date(now).toISOString()
    );
  }

  appendOrderEvent(event: OrderEventType): void {
    this.append(event.eventType, event, {
      aggregateType: 'order',
      aggregateId: event.orderId,
      accountId: event.accountId,
      symbol: event.symbol,
    });
  }

  appendFill(fill: Fill): void {
    this.append('FILL_CREATED', fill, {
      aggregateType: 'fill',
      aggregateId: fill.id,
      accountId: fill.accountId,
      symbol: fill.symbol,
    });
  }

  appendPositionEvent(event: PositionEvent): void {
    this.append(event.eventType, event, {
      aggregateType: 'position',
      aggregateId: `${event.accountId}-${event.symbol}-${event.positionSide}`,
      accountId: event.accountId,
      symbol: event.symbol,
    });
  }

  appendAccountSnapshot(account: AccountState, accountId: string): void {
    this.append('ACCOUNT_SNAPSHOT', account, {
      aggregateType: 'account',
      aggregateId: accountId,
      accountId,
    });
  }

  appendFundingPayment(payment: FundingPayment): void {
    this.append('FUNDING_APPLIED', payment, {
      aggregateType: 'funding',
      aggregateId: payment.id,
      accountId: payment.accountId,
      symbol: payment.symbol,
    });
  }

  appendRiskEvent(
    eventType: OrderEventType['eventType'],
    accountId: string,
    payload: Record<string, unknown>
  ): void {
    this.append(eventType, payload, {
      aggregateType: 'risk',
      aggregateId: accountId,
      accountId,
    });
  }

  appendSystemEvent(event: SystemEventType): void {
    this.append(event.eventType, event.payload ?? {}, {
      aggregateType: 'system',
      aggregateId: 'engine',
    });
  }

  getEvents(
    options?: {
      aggregateType?: string;
      aggregateId?: string;
      accountId?: string;
      symbol?: string;
      type?: string;
      fromSeq?: number;
      toSeq?: number;
      limit?: number;
    }
  ): EventEnvelope[] {
    let sql = 'SELECT * FROM events WHERE 1=1';
    const params: unknown[] = [];

    if (options?.aggregateType) {
      sql += ' AND aggregate_type = ?';
      params.push(options.aggregateType);
    }
    if (options?.aggregateId) {
      sql += ' AND aggregate_id = ?';
      params.push(options.aggregateId);
    }
    if (options?.accountId) {
      sql += ' AND account_id = ?';
      params.push(options.accountId);
    }
    if (options?.symbol) {
      sql += ' AND symbol = ?';
      params.push(options.symbol);
    }
    if (options?.type) {
      sql += ' AND event_type = ?';
      params.push(options.type);
    }
    if (options?.fromSeq) {
      sql += ' AND seq >= ?';
      params.push(options.fromSeq);
    }
    if (options?.toSeq) {
      sql += ' AND seq <= ?';
      params.push(options.toSeq);
    }

    sql += ' ORDER BY seq DESC';
    if (options?.limit) {
      sql += ` LIMIT ${options.limit}`;
    }

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      seq: number;
      event_type: string;
      aggregate_type: string;
      aggregate_id: string;
      account_id: string | null;
      symbol: string | null;
      correlation_id: string | null;
      causation_id: string | null;
      schema_version: number;
      payload: string;
      created_at_utc: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      seq: row.seq,
      ts: new Date(row.created_at_utc).getTime(),
      type: row.event_type,
      payload: JSON.parse(row.payload),
    }));
  }

  close(): void {
    this.db.close();
  }
}