/**
 * Profit Goal Store
 *
 * File-backed persistence for ProfitGoalManager, following the same
 * JSON-on-disk pattern the adaptive-supertrend Q-table and the aggressive-mode
 * flag already use (see engine.ts). Profit goals gate trading, so losing the
 * state on restart would silently re-arm a system the operator had deliberately
 * throttled after hitting a target — the state has to survive a process bounce.
 */

import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../telemetry/logger.js';
import { ProfitGoalManager } from './ProfitGoalManager.js';
import type { ProfitGoalConfig } from './ProfitGoalTypes.js';

export class ProfitGoalStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Restore a manager from disk, falling back to a fresh one when no state
   * exists or the file is unreadable/corrupt. Never throws — a broken state
   * file must not stop the engine from starting.
   */
  load(startingEquity: number, config: ProfitGoalConfig): ProfitGoalManager {
    try {
      if (!fs.existsSync(this.filePath)) {
        return new ProfitGoalManager(startingEquity, config);
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const manager = ProfitGoalManager.fromJSON(raw);
      logger.info(
        { file: this.filePath, state: manager.getState() },
        '[ProfitGoalStore] Restored profit goal state'
      );
      return manager;
    } catch (error) {
      logger.warn(
        { file: this.filePath, error: error instanceof Error ? error.message : error },
        '[ProfitGoalStore] Could not restore profit goal state, starting fresh'
      );
      return new ProfitGoalManager(startingEquity, config);
    }
  }

  /** Persist current state. Never throws — a failed save must not break a fill. */
  save(manager: ProfitGoalManager): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(manager.toJSON(), null, 2), 'utf8');
    } catch (error) {
      logger.error(
        { file: this.filePath, error: error instanceof Error ? error.message : error },
        '[ProfitGoalStore] Failed to persist profit goal state'
      );
    }
  }
}
