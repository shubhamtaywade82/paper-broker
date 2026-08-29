import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env['AGENT_DB_PATH'] || path.resolve(__dirname, "../../../../local-agent-stack/db/shared-agent-memory.db");

// Ensure directory exists before connecting
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let dbInstance: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(DB_PATH);
    dbInstance.exec("PRAGMA journal_mode = WAL;");
    dbInstance.exec("PRAGMA synchronous = NORMAL;");
    dbInstance.exec("PRAGMA busy_timeout = 5000;");
  }
  return dbInstance;
}

export interface MemoryEntry {
  id: number;
  topic: string;
  fact: string;
  source: string;
  created_at: string;
}

export interface SystemRule {
  id: number;
  rule: string;
  pattern: string;
  hit_count: number;
}

/**
 * Searches shared memory database for historical execution and market structure notes.
 */
export function searchMemories(query: string, limit = 5): MemoryEntry[] {
  const words = query.replace(/[^\w\s]/gi, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const ftsQuery = words.map((w) => `${w}*`).join(" OR ");
  const stmt = getDb().prepare(`
    SELECT m.id, m.topic, m.fact, m.source, m.created_at
    FROM memories_fts fts
    JOIN memories m ON fts.rowid = m.id
    WHERE memories_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `);
  return stmt.all(ftsQuery, limit) as unknown as MemoryEntry[];
}

/**
 * Loads active rules promoted from previous self-healing cycles.
 */
export function loadSystemRules(): SystemRule[] {
  const stmt = getDb().prepare(`
    SELECT id, rule, pattern, hit_count 
    FROM system_rules 
    ORDER BY id ASC
  `);
  return stmt.all() as unknown as SystemRule[];
}

/**
 * Persists trade execution metrics into durable memory.
 */
export function recordExecutionMetrics(symbol: string, slippageBps: number, fillPrice: number): void {
  const stmt = getDb().prepare(`
    INSERT INTO memories (topic, fact, source, memory_type)
    VALUES (?, ?, 'paper-broker', 'metric')
  `);
  stmt.run(`slippage_${symbol}`, `Observed slippage of ${slippageBps} bps at price ${fillPrice}`);
}

/**
 * Streams simulated order failures and margin errors into central audit logs.
 */
export function logExecutionError(sessionId: string, error: unknown, metadata: Record<string, unknown> = {}): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const payload = JSON.stringify({
    error: errorMessage,
    bot: "paper-broker",
    ...metadata,
  });

  const stmt = getDb().prepare(`
    INSERT INTO audit_logs (session_id, event_type, payload)
    VALUES (?, 'error', ?)
  `);
  stmt.run(sessionId, payload);
}
