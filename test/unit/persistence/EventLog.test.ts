import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../../src/persistence/db.js';
import { EventLog } from '../../../src/persistence/EventLog.js';

describe('EventLog persistence', () => {
  const dataDir = `/tmp/paper-broker-evt-test-${Date.now()}`;

  beforeEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('EVT-01: sequences are strictly monotonic within a session', () => {
    const db = new DatabaseManager(dataDir);
    const log = new EventLog(`${dataDir}/events.jsonl`, db.raw);

    log.appendOrderEvent({
      eventType: 'ORDER_CREATED',
      orderId: 'ord-1',
      accountId: 'acc-1',
      symbol: 'BTCUSDT',
    } as any);

    log.appendOrderEvent({
      eventType: 'ORDER_FILLED',
      orderId: 'ord-1',
      accountId: 'acc-1',
      symbol: 'BTCUSDT',
    } as any);

    log.appendOrderEvent({
      eventType: 'ORDER_FILLED',
      orderId: 'ord-2',
      accountId: 'acc-1',
      symbol: 'BTCUSDT',
    } as any);

    const events = log.getEvents();
    expect(events.length).toBe(3);
    // getEvents orders by seq DESC
    expect(events[0]?.seq).toBe(3);
    expect(events[1]?.seq).toBe(2);
    expect(events[2]?.seq).toBe(1);
    db.close();
  });

  it('EVT-02: recovers sequence counter after restart (H-08 regression)', () => {
    const db1 = new DatabaseManager(dataDir);
    const log1 = new EventLog(`${dataDir}/events.jsonl`, db1.raw);
    log1.appendOrderEvent({
      eventType: 'ORDER_CREATED',
      orderId: 'ord-1',
      accountId: 'acc-1',
      symbol: 'BTCUSDT',
    } as any);
    log1.appendOrderEvent({
      eventType: 'ORDER_FILLED',
      orderId: 'ord-1',
      accountId: 'acc-1',
      symbol: 'BTCUSDT',
    } as any);
    db1.close();

    const db2 = new DatabaseManager(dataDir);
    const log2 = new EventLog(`${dataDir}/events.jsonl`, db2.raw);
    log2.appendOrderEvent({
      eventType: 'ORDER_CREATED',
      orderId: 'ord-2',
      accountId: 'acc-1',
      symbol: 'BTCUSDT',
    } as any);

    const events = log2.getEvents();
    expect(events.length).toBe(3);
    expect(events[0]?.seq).toBe(3);
    expect(events[1]?.seq).toBe(2);
    expect(events[2]?.seq).toBe(1);
    db2.close();
  });

  it('EVT-03: append and query interface exists', () => {
    const db = new DatabaseManager(dataDir);
    const log = new EventLog(`${dataDir}/events.jsonl`, db.raw);
    expect(typeof log.appendOrderEvent).toBe('function');
    expect(typeof log.getEvents).toBe('function');
    db.close();
  });
});
