/**
 * File-backed persistence for StrategyPerformanceTracker.
 *
 * A quarantine decision must outlive a restart: if it did not, bouncing the
 * process would silently re-enable a strategy that was shut off for losing
 * money, which is the exact failure the tracker exists to prevent.
 */

import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../telemetry/logger.js';
import type { StrategyStats } from './StrategyPerformanceTracker.js';

export class StrategyPerformanceStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** Never throws — unreadable state must not stop the engine from starting. */
  load(): StrategyStats[] {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed as StrategyStats[];
    } catch (error) {
      logger.warn(
        { file: this.filePath, error: error instanceof Error ? error.message : error },
        '[StrategyPerformanceStore] Could not restore strategy performance, starting fresh'
      );
      return [];
    }
  }

  /** Never throws — a failed save must not break a fill. */
  save(stats: StrategyStats[]): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(stats, null, 2), 'utf8');
    } catch (error) {
      logger.error(
        { file: this.filePath, error: error instanceof Error ? error.message : error },
        '[StrategyPerformanceStore] Failed to persist strategy performance'
      );
    }
  }
}
