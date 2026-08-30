import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ulid } from 'ulid';
import type { Reflection } from '../schemas.js';
import { logger } from '../../telemetry/logger.js';

/**
 * AgentMemoryStore
 * ================
 *
 * SQLite + FTS5 backing store for the agent's post-trade reflection memory.
 *
 * Two tables:
 *
 *  - `agent_reflections` (append-only): one row per closing trade, holding
 *    the LLM-generated structured reflection. Pruned by age — see
 *    {@link AgentMemoryStore.pruneOlderThan}. NOT in the existing
 *    `paper.sqlite3` events table (CONTRACTS.md §4: event log is the
 *    source of truth for *trading* history; reflections are mutable state).
 *
 *  - `agent_lessons` (mutable): distilled lessons derived from reflections.
 *    Each lesson has a `decay_score` that decreases over time; below the
 *    configured floor a lesson is retired. `hit_count` increments every
 *    time the lesson is surfaced into an analyst prompt (so we can tell
 *    which lessons are actually being read by the LLM).
 *
 *  Both tables are FTS-indexed so the retrieval path (find lessons relevant
 *  to a given symbol/regime) is fast and forgiving of partial-match queries.
 *
 * The store is single-process (matches the rest of the engine). It opens
 * its own SQLite file at `data/agent_memory.sqlite3` — a separate file from
 * `paper.sqlite3` so the WAL contention + foreign-keys story stays simple
 * and the existing event-log contract is not affected.
 */
export interface AgentMemoryStoreConfig {
  /** Path to the agent_memory SQLite file. */
  dbPath: string;
  /** Lessons whose decay_score falls below this are retired. */
  decayFloor: number;
  /** Reflections older than this many ms are pruned (best-effort, on access). */
  pruneOlderThanMs: number;
  /** How many top lessons to retrieve per query. */
  topK: number;
}

export interface ReflectionRecord {
  id: string;
  ts: number;
  symbol: string;
  regime: string | null;
  strategyId: string;
  action: string;
  outcomePnlUsdt: number;
  outcomeLabel: 'WIN' | 'LOSS' | 'BREAKEVEN';
  setupArchetype: string | null;
  reflectionText: string;
  lessonTags: string[];
  modelUsed: string;
  cycleId: string | null;
  rawPayload: string;
}

export interface LessonRecord {
  id: string;
  lessonText: string;
  tags: string[];
  sourceReflectionId: string;
  createdAt: number;
  lastUsedAt: number | null;
  hitCount: number;
  decayScore: number;
  regime: string | null;
  strategyId: string | null;
}

export interface RecordReflectionInput {
  ts: number;
  symbol: string;
  regime?: string;
  strategyId: string;
  action: string;
  outcomePnlUsdt: number;
  setupArchetype?: string;
  reflection: Reflection;
  modelUsed: string;
  cycleId?: string;
}

export interface RetrieveLessonsQuery {
  symbol?: string;
  regime?: string;
  strategyId?: string;
  action?: string;
  setupArchetype?: string;
  freeText?: string;
  limit?: number;
}

export class AgentMemoryStore {
  private db: Database.Database;
  private config: AgentMemoryStoreConfig;

  constructor(config: AgentMemoryStoreConfig) {
    this.config = config;
    const dir = path.dirname(config.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(config.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_reflections (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        regime TEXT,
        strategy_id TEXT NOT NULL,
        action TEXT NOT NULL,
        outcome_pnl_usdt REAL NOT NULL,
        outcome_label TEXT NOT NULL,
        setup_archetype TEXT,
        reflection_text TEXT NOT NULL,
        lesson_tags TEXT NOT NULL,
        model_used TEXT NOT NULL,
        cycle_id TEXT,
        raw_payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reflections_ts ON agent_reflections(ts);
      CREATE INDEX IF NOT EXISTS idx_reflections_symbol ON agent_reflections(symbol);
      CREATE INDEX IF NOT EXISTS idx_reflections_strategy ON agent_reflections(strategy_id);

      CREATE TABLE IF NOT EXISTS agent_lessons (
        id TEXT PRIMARY KEY,
        lesson_text TEXT NOT NULL,
        tags TEXT NOT NULL,
        source_reflection_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        hit_count INTEGER NOT NULL DEFAULT 0,
        decay_score REAL NOT NULL DEFAULT 1.0,
        regime TEXT,
        strategy_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_lessons_decay ON agent_lessons(decay_score);
      CREATE INDEX IF NOT EXISTS idx_lessons_regime ON agent_lessons(regime);
      CREATE INDEX IF NOT EXISTS idx_lessons_strategy ON agent_lessons(strategy_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS agent_lessons_fts USING fts5(
        lesson_text, tags, content='agent_lessons', content_rowid='rowid'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS agent_reflections_fts USING fts5(
        reflection_text, lesson_tags, symbol, regime, content='agent_reflections', content_rowid='rowid'
      );
    `);

    // FTS triggers keep the indexes in sync with the tables.
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS agent_lessons_ai AFTER INSERT ON agent_lessons BEGIN
        INSERT INTO agent_lessons_fts(rowid, lesson_text, tags)
        VALUES (new.rowid, new.lesson_text, new.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS agent_lessons_ad AFTER DELETE ON agent_lessons BEGIN
        INSERT INTO agent_lessons_fts(agent_lessons_fts, rowid, lesson_text, tags)
        VALUES ('delete', old.rowid, old.lesson_text, old.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS agent_lessons_au AFTER UPDATE ON agent_lessons BEGIN
        INSERT INTO agent_lessons_fts(agent_lessons_fts, rowid, lesson_text, tags)
        VALUES ('delete', old.rowid, old.lesson_text, old.tags);
        INSERT INTO agent_lessons_fts(rowid, lesson_text, tags)
        VALUES (new.rowid, new.lesson_text, new.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS agent_reflections_ai AFTER INSERT ON agent_reflections BEGIN
        INSERT INTO agent_reflections_fts(rowid, reflection_text, lesson_tags, symbol, regime)
        VALUES (new.rowid, new.reflection_text, new.lesson_tags, new.symbol, new.regime);
      END;
      CREATE TRIGGER IF NOT EXISTS agent_reflections_ad AFTER DELETE ON agent_reflections BEGIN
        INSERT INTO agent_reflections_fts(agent_reflections_fts, rowid, reflection_text, lesson_tags, symbol, regime)
        VALUES ('delete', old.rowid, old.reflection_text, old.lesson_tags, old.symbol, old.regime);
      END;
    `);
  }

  /**
   * Persist a fresh reflection + extract its lessons into the lessons table.
   * Each lesson starts with decay_score=1.0; it decays via {@link decayLessons}
   * which is called once per cycle by the SelfImprovementLoop.
   *
   * Returns the stored reflection's id.
   */
  recordReflection(input: RecordReflectionInput): string {
    const id = ulid();
    const outcomeLabel: 'WIN' | 'LOSS' | 'BREAKEVEN' =
      input.outcomePnlUsdt > 0 ? 'WIN' : input.outcomePnlUsdt < 0 ? 'LOSS' : 'BREAKEVEN';
    const lessonTags = input.reflection.lessons.slice(0, 10);
    const rawPayload = JSON.stringify({ ...input });

    const insertReflection = this.db.prepare(`
      INSERT INTO agent_reflections
        (id, ts, symbol, regime, strategy_id, action, outcome_pnl_usdt, outcome_label,
         setup_archetype, reflection_text, lesson_tags, model_used, cycle_id, raw_payload)
      VALUES (@id, @ts, @symbol, @regime, @strategyId, @action, @pnl, @label,
              @archetype, @text, @tags, @model, @cycleId, @raw)
    `);

    insertReflection.run({
      id,
      ts: input.ts,
      symbol: input.symbol,
      regime: input.regime ?? null,
      strategyId: input.strategyId,
      action: input.action,
      pnl: input.outcomePnlUsdt,
      label: outcomeLabel,
      archetype: input.setupArchetype ?? null,
      text: input.reflection.reflection,
      tags: JSON.stringify(lessonTags),
      model: input.modelUsed,
      cycleId: input.cycleId ?? null,
      raw: rawPayload,
    });

    // Each lesson gets its own row. Multiple lessons per reflection is fine;
    // we'll let decay + retrieval rank them later.
    const insertLesson = this.db.prepare(`
      INSERT INTO agent_lessons
        (id, lesson_text, tags, source_reflection_id, created_at, decay_score, regime, strategy_id)
      VALUES (@id, @text, @tags, @src, @ts, 1.0, @regime, @strategyId)
    `);
    for (const lesson of lessonTags) {
      insertLesson.run({
        id: ulid(),
        text: lesson,
        tags: JSON.stringify([input.action, input.regime ?? 'unknown'].filter(Boolean)),
        src: id,
        ts: input.ts,
        regime: input.regime ?? null,
        strategyId: input.strategyId,
      });
    }

    return id;
  }

  /**
   * Retrieve the top-K lessons relevant to a query, ranked by
   * `decay_score * bm25`. Marks the returned lessons as used (increments
   * `hit_count`, sets `last_used_at`) so we can later analyze which lessons
   * the LLM actually sees.
   */
  retrieveRelevantLessons(query: RetrieveLessonsQuery): LessonRecord[] {
    const limit = query.limit ?? this.config.topK;
    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) {
      // Fallback: return the top-K by decay_score.
      const rows = this.db
        .prepare(`SELECT * FROM agent_lessons WHERE decay_score >= ? ORDER BY decay_score DESC LIMIT ?`)
        .all(this.config.decayFloor, limit) as Array<Omit<LessonRecord, 'tags'> & { tags: string }>;
      return rows.map((r) => ({ ...r, tags: safeParseTags(r.tags) }));
    }

    try {
      const rows = this.db
        .prepare(`
          SELECT l.*, bm5(agent_lessons_fts) AS rank
          FROM agent_lessons_fts fts
          JOIN agent_lessons l ON l.rowid = fts.rowid
          WHERE agent_lessons_fts MATCH ?
            AND l.decay_score >= ?
          ORDER BY rank ASC, l.decay_score DESC
          LIMIT ?
        `)
        .all(ftsQuery, this.config.decayFloor, limit) as Array<
          Omit<LessonRecord, 'tags'> & { tags: string; rank: number }
        >;

      const lessons = rows.map((r) => ({ ...r, tags: safeParseTags(r.tags) }));
      this.markLessonsUsed(lessons.map((l) => l.id));
      return lessons;
    } catch (err) {
      logger.warn({ err, ftsQuery }, '[AgentMemoryStore] FTS query failed, returning top-decay fallback');
      const fallback = this.db
        .prepare(`SELECT * FROM agent_lessons WHERE decay_score >= ? ORDER BY decay_score DESC LIMIT ?`)
        .all(this.config.decayFloor, limit) as Array<Omit<LessonRecord, 'tags'> & { tags: string }>;
      return fallback.map((r) => ({ ...r, tags: safeParseTags(r.tags) }));
    }
  }

  /**
   * Render the top-K lessons for a query as a single text block, ready to
   * drop into an analyst prompt as `ctx.agentMemory`.
   *
   * Returns an empty string when no lessons are above the decay floor — the
   * analyst stage treats an empty string as "no memory" and proceeds
   * normally (soft dependency, same contract as Ollama reachability).
   */
  renderAgentMemoryForPrompt(query: RetrieveLessonsQuery): string {
    const lessons = this.retrieveRelevantLessons(query);
    if (lessons.length === 0) return '';
    const lines = lessons.map((l, i) => `${i + 1}. [${(l.decayScore * 100).toFixed(0)}%] ${l.lessonText}`);
    return `Past lessons (decay-weighted, most-relevant first):\n${lines.join('\n')}`;
  }

  /**
   * Apply exponential decay to every lesson. Called once per cycle by the
   * SelfImprovementLoop. Decay rate is set so a lesson's score halves every
   * 14 days (~0.95^N per cycle, with N=1 cycle per day baseline).
   *
   * Lessons below {@link AgentMemoryStoreConfig.decayFloor} are deleted.
   */
  decayLessons(decayFactor = 0.995): number {
    const info = this.db.prepare(`
      UPDATE agent_lessons
      SET decay_score = decay_score * ?
      WHERE decay_score >= ?
    `).run(decayFactor, this.config.decayFloor);

    const prune = this.db.prepare(`
      DELETE FROM agent_lessons WHERE decay_score < ?
    `).run(this.config.decayFloor);

    void info;
    return prune.changes;
  }

  /**
   * Best-effort prune of reflections older than {@link AgentMemoryStoreConfig.pruneOlderThanMs}.
   * Called lazily on every recordReflection — keeps the table bounded without
   * needing a separate scheduler job.
   */
  pruneOlderThan(now = Date.now()): number {
    const cutoff = now - this.config.pruneOlderThanMs;
    const info = this.db.prepare(`
      DELETE FROM agent_reflections WHERE ts < ?
    `).run(cutoff);
    return info.changes;
  }

  /**
   * Recent reflections — for the /api/v1/agent/reflections endpoint.
   */
  recentReflections(limit = 50): ReflectionRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM agent_reflections ORDER BY ts DESC LIMIT ?`)
      .all(limit) as Array<
        Omit<ReflectionRecord, 'lessonTags'> & { lesson_tags: string }
      >;
    return rows.map((r) => {
      const { lesson_tags, ...rest } = r;
      return { ...rest, lessonTags: safeParseTags(lesson_tags) };
    });
  }

  /** List all lessons above the decay floor — for /api/v1/agent/memory. */
  listLessons(limit = 200): LessonRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM agent_lessons WHERE decay_score >= ? ORDER BY decay_score DESC LIMIT ?`)
      .all(this.config.decayFloor, limit) as Array<
        Omit<LessonRecord, 'tags'> & { tags: string }
      >;
    return rows.map((r) => ({ ...r, tags: safeParseTags(r.tags) }));
  }

  close(): void {
    this.db.close();
  }

  private markLessonsUsed(ids: string[]): void {
    if (ids.length === 0) return;
    const stmt = this.db.prepare(`
      UPDATE agent_lessons SET hit_count = hit_count + 1, last_used_at = ? WHERE id = ?
    `);
    const now = Date.now();
    const tx = this.db.transaction((items: string[]) => {
      for (const id of items) stmt.run(now, id);
    });
    tx(ids);
  }
}

function buildFtsQuery(q: RetrieveLessonsQuery): string {
  const parts: string[] = [];
  if (q.symbol) parts.push(quote(q.symbol));
  if (q.regime) parts.push(quote(q.regime));
  if (q.strategyId) parts.push(quote(q.strategyId));
  if (q.action) parts.push(quote(q.action));
  if (q.setupArchetype) parts.push(quote(q.setupArchetype));
  if (q.freeText) {
    // Tokenize free text into prefix-wildcard terms.
    const words = q.freeText.split(/\s+/).filter((w) => w.length >= 3).slice(0, 5);
    for (const w of words) parts.push(`${escapeFts(w)}*`);
  }
  return parts.join(' OR ');
}

function quote(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

function escapeFts(s: string): string {
  // Strip FTS5 special characters so the term is treated as a literal prefix.
  return s.replace(/["*]/g, '');
}

function safeParseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string');
  } catch {
    // fall through
  }
  return [];
}
