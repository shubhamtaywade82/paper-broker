import type Database from 'better-sqlite3';

export class PersistentMetrics {
  private registry = new Map<string, number>();
  private flushTimer: NodeJS.Timeout;

  constructor(private db: Database.Database) {
    this.loadLastSnapshot();
    this.flushTimer = setInterval(() => this.flush(), 30_000);
    this.flushTimer.unref();
  }

  setGauge(name: string, value: number): void {
    this.registry.set(name.startsWith('gauge:') ? name : `gauge:${name}`, value);
  }

  getGauge(name: string): number | undefined {
    return this.registry.get(name.startsWith('gauge:') ? name : `gauge:${name}`);
  }

  flush(): void {
    const entries = Array.from(this.registry.entries());
    if (entries.length === 0) return;

    const stmt = this.db.prepare('INSERT INTO metrics_snapshots (name, value, ts) VALUES (?, ?, ?)');
    const tx = this.db.transaction((items: Array<[string, number]>) => {
      const now = Date.now();
      for (const [name, value] of items) {
        stmt.run(name, value, now);
      }
    });
    tx(entries);
  }

  private loadLastSnapshot(): void {
    try {
      const rows = this.db
        .prepare(
          `SELECT name, value FROM metrics_snapshots
           WHERE ts = (SELECT MAX(ts) FROM metrics_snapshots)`
        )
        .all() as Array<{ name: string; value: number }>;

      for (const r of rows) {
        if (r.name.startsWith('gauge:')) {
          this.registry.set(r.name, r.value);
        }
      }
    } catch {
      // Table might not exist yet during initial boot before migration
    }
  }

  close(): void {
    clearInterval(this.flushTimer);
    this.flush();
  }
}
