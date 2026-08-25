import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../../src/persistence/db.js';
import { PersistentMetrics } from '../../../src/telemetry/PersistentMetrics.js';

describe('PersistentMetrics (M-13 regression)', () => {
  const dataDir = `/tmp/paper-broker-metrics-test-${Date.now()}`;

  beforeEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('MET-01: gauges persist to SQLite and reload on restart', () => {
    const db1 = new DatabaseManager(dataDir);
    const m1 = new PersistentMetrics(db1.raw);
    m1.setGauge('equity', 10500.25);
    m1.setGauge('open_positions', 3);
    m1.flush();
    m1.close();
    db1.close();

    const db2 = new DatabaseManager(dataDir);
    const m2 = new PersistentMetrics(db2.raw);
    expect(m2.getGauge('equity')).toBe(10500.25);
    expect(m2.getGauge('open_positions')).toBe(3);
    m2.close();
    db2.close();
  });
});
