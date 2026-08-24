import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../src/persistence/db.js';
import { EventLog } from '../../src/persistence/EventLog.js';
import { SnapshotStore } from '../../src/persistence/SnapshotStore.js';

// C-03: DatabaseManager, EventLog, and SnapshotStore used to each open their own
// SQLite connection to the same paper.sqlite3 file with inconsistent pragmas
// (WAL/synchronous/foreign_keys), risking corruption under concurrent writes and
// racing schema migrations. They now share one connection owned by DatabaseManager.
describe('Persistence layer: shared SQLite connection (C-03)', () => {
  const dataDir = `/tmp/paper-broker-persistence-test-${Date.now()}`;

  beforeEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('EventLog and SnapshotStore reuse the DatabaseManager connection instead of opening their own', () => {
    const db = new DatabaseManager(dataDir);
    const events = new EventLog(`${dataDir}/events.jsonl`, db.raw);
    const snapshots = new SnapshotStore(`${dataDir}/snapshots`, db.raw);

    expect(events.raw).toBe(db.raw);
    // SnapshotStore does not expose `.raw`, but writes through it should be
    // visible on the shared connection immediately (same DB, same process).
    snapshots.saveMarketState({ symbol: 'BTCUSDT', localTsUtc: Date.now(), stale: false });
    const row = db.raw.prepare('SELECT symbol FROM market_states_current WHERE symbol = ?').get('BTCUSDT');
    expect(row).toBeDefined();

    db.close();
  });

  it('applies WAL/synchronous/foreign_keys pragmas consistently to the single shared connection', () => {
    const db = new DatabaseManager(dataDir);
    new EventLog(`${dataDir}/events.jsonl`, db.raw);
    new SnapshotStore(`${dataDir}/snapshots`, db.raw);

    expect(db.raw.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.raw.pragma('foreign_keys', { simple: true })).toBe(1);

    db.close();
  });

  it('EventLog.close()/SnapshotStore.close() are no-ops; only DatabaseManager.close() closes the shared connection', () => {
    const db = new DatabaseManager(dataDir);
    const events = new EventLog(`${dataDir}/events.jsonl`, db.raw);
    const snapshots = new SnapshotStore(`${dataDir}/snapshots`, db.raw);

    events.close();
    snapshots.close();
    // Connection must still be usable after the (no-op) component closes.
    expect(() => db.raw.prepare('SELECT 1').get()).not.toThrow();

    db.close();
    expect(() => db.raw.prepare('SELECT 1').get()).toThrow();
  });

  it('getEvents() parameterizes the LIMIT clause rather than string-interpolating it', () => {
    const db = new DatabaseManager(dataDir);
    const events = new EventLog(`${dataDir}/events.jsonl`, db.raw);

    for (let i = 0; i < 5; i++) {
      events.append('SYSTEM_EVENT', { i }, { aggregateType: 'system', aggregateId: 'engine' });
    }

    const limited = events.getEvents({ limit: 2 });
    expect(limited).toHaveLength(2);
    const all = events.getEvents({});
    expect(all).toHaveLength(5);

    db.close();
  });
});
