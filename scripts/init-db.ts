import { DatabaseManager } from '../src/persistence/db.js';
import { EventLog } from '../src/persistence/EventLog.js';
import { SnapshotStore } from '../src/persistence/SnapshotStore.js';
import { env } from '../src/config/env.js';

function main(): void {
  const dataDir = env.DB_FILE.replace(/\/[^/]+$/, '');

  const db = new DatabaseManager(dataDir);
  new EventLog(env.EVENT_LOG_FILE, db.raw);
  new SnapshotStore(env.SNAPSHOT_DIR, db.raw);

  console.log(`[init-db] Database initialized at ${env.DB_FILE}`);
  process.exit(0);
}

main();