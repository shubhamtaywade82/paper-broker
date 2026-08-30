import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../telemetry/logger.js';

/**
 * StrategyParamLearner
 * =====================
 *
 * Generic per-(strategyId, regime, paramKey) Q-learning store. Extends the
 * existing Q-learning (currently only on Supertrend params, see
 * `src/strategy/adaptive-supertrend/parameter-ai.ts`) to ANY strategy's
 * tunable parameter.
 *
 * Q-table structure (persisted as JSON):
 *
 *   {
 *     "smc-agent-v1": {
 *       "trending_up": {
 *         "minConfluence": {
 *           "65": { count: 12, sumReward: 0.05, avg: 0.0042 },
 *           "70": { count: 18, sumReward: 1.27, avg: 0.0706 }
 *         }
 *       }
 *     }
 *   }
 *
 * Selection: ε-greedy. With prob ε, return a random candidate (explore).
 * Otherwise, return the candidate with the highest avg reward whose
 * sample count ≥ minTrades. If no candidate has enough samples yet, return
 * the defaultValue (the operator's configured baseline).
 *
 * Reward = realized directional return on position close (same convention
 * as Supertrend's parameter-ai.ts).
 *
 * Off by default (AGENT_PARAM_LEARNING_ENABLED=true). When off, select()
 * always returns the defaultValue — strategies are unaffected.
 *
 * LLM Authority Contract (CONTRACTS.md §5) preserved: this learner is
 * deterministic, not LLM-driven. It only feeds strategy thresholds, never
 * risk limits or position sizes.
 */

export interface StrategyParamLearnerConfig {
  /** Path to the JSON file holding the Q-table. */
  persistencePath: string;
  /** Learning rate α ∈ [0,1]. Higher = faster adaptation, more noise. */
  alpha: number;
  /** Discount γ ∈ [0,1]. Higher = more long-term. */
  gamma: number;
  /** ε-greedy exploration rate ∈ [0,1]. */
  epsilon: number;
  /** Min trades per (strategyId, regime, paramKey, paramValue) before the
     learned avg is trusted. Below this, the default value is used. */
  minTrades: number;
  /** When true, select() applies ε-greedy. When false, always returns default. */
  enabled: boolean;
}

interface QCell {
  count: number;
  sumReward: number;
  avg: number;
}

interface QTableShape {
  [strategyId: string]: {
    [regime: string]: {
      [paramKey: string]: {
        // paramValue keys are stringified to keep JSON portable.
        [paramValueKey: string]: QCell;
      };
    };
  };
}

export interface ParamLearnerStats {
  strategyId: string;
  regime: string;
  paramKey: string;
  cells: Array<{ paramValueKey: string; count: number; avg: number; sumReward: number }>;
}

export class StrategyParamLearner {
  private config: StrategyParamLearnerConfig;
  private qtable: QTableShape = {};
  private dirty = false;

  constructor(config: StrategyParamLearnerConfig) {
    this.config = config;
    this.load();
  }

  // ----- Selection (ε-greedy) -------------------------------------------

  /**
   * Pick a value for the given (strategyId, regime, paramKey) from the
   * candidate list.
   *
   * - When the learner is disabled, returns `defaultValue` unchanged.
   * - With prob ε, returns a random candidate (exploration).
   * - Otherwise, returns the candidate with the highest avg reward whose
   *   sample count ≥ minTrades (exploitation). Ties broken by higher count.
   * - If no candidate has enough samples yet, returns `defaultValue`.
   *
   * The caller MUST later call `recordOutcome()` with the actual reward
   * observed when this value was used — that's how the Q-table grows.
   */
  select<T extends string | number>(
    strategyId: string,
    regime: string,
    paramKey: string,
    candidates: T[],
    defaultValue: T
  ): T {
    if (!this.config.enabled) return defaultValue;
    if (candidates.length === 0) return defaultValue;

    // ε-greedy exploration
    if (Math.random() < this.config.epsilon) {
      const idx = Math.floor(Math.random() * candidates.length);
      return candidates[idx]!;
    }

    // Exploitation: best avg reward with enough samples.
    const cell = this.qtable[strategyId]?.[regime]?.[paramKey];
    if (!cell) return defaultValue;

    let bestValue: T | undefined;
    let bestAvg = -Infinity;
    let bestCount = 0;
    for (const c of candidates) {
      const qcell = cell[String(c)];
      if (!qcell || qcell.count < this.config.minTrades) continue;
      if (qcell.avg > bestAvg || (qcell.avg === bestAvg && qcell.count > bestCount)) {
        bestAvg = qcell.avg;
        bestCount = qcell.count;
        bestValue = c;
      }
    }
    return bestValue ?? defaultValue;
  }

  /**
   * Record the reward observed for a (strategyId, regime, paramKey, paramValue).
   * Updates the Q-table using a moving average (α controls the step size).
   */
  recordOutcome(
    strategyId: string,
    regime: string,
    paramKey: string,
    paramValue: string | number,
    reward: number
  ): void {
    if (!this.config.enabled) return;
    const key = String(paramValue);
    this.qtable[strategyId] ??= {};
    this.qtable[strategyId][regime] ??= {};
    this.qtable[strategyId][regime][paramKey] ??= {};
    const cell = this.qtable[strategyId][regime][paramKey][key] ?? { count: 0, sumReward: 0, avg: 0 };

    // α-weighted update of the running average — equivalent to Q-learning
    // when γ=0 and reward is the immediate outcome.
    const newCount = cell.count + 1;
    const newAvg = cell.avg + this.config.alpha * (reward - cell.avg);
    cell.count = newCount;
    cell.sumReward = cell.sumReward + reward;
    cell.avg = newAvg;
    this.qtable[strategyId][regime][paramKey][key] = cell;
    this.dirty = true;
  }

  /**
   * Persist the Q-table to disk. Cheap no-op when nothing has changed since
   * the last save. Safe to call from the scheduler every cycle.
   */
  save(): void {
    if (!this.dirty) return;
    try {
      const dir = path.dirname(this.config.persistencePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.config.persistencePath, JSON.stringify(this.qtable, null, 2));
      this.dirty = false;
    } catch (err) {
      logger.warn({ err, path: this.config.persistencePath }, '[StrategyParamLearner] failed to persist Q-table');
    }
  }

  /**
   * Reload from disk — useful for tests and for re-syncing after an
   * external edit. Overwrites the in-memory table.
   */
  load(): void {
    try {
      if (!fs.existsSync(this.config.persistencePath)) {
        this.qtable = {};
        return;
      }
      const raw = fs.readFileSync(this.config.persistencePath, 'utf8');
      this.qtable = JSON.parse(raw) as QTableShape;
    } catch (err) {
      logger.warn({ err, path: this.config.persistencePath }, '[StrategyParamLearner] failed to load Q-table, starting empty');
      this.qtable = {};
    }
  }

  /**
   * Snapshot for /api/v1/agent/param-learning. Returns the cells for a given
   * (strategyId, regime, paramKey) so operators can inspect what the learner
   * has discovered.
   */
  listParamStats(strategyId: string, regime: string, paramKey: string): ParamLearnerStats | null {
    const cell = this.qtable[strategyId]?.[regime]?.[paramKey];
    if (!cell) return null;
    return {
      strategyId,
      regime,
      paramKey,
      cells: Object.entries(cell).map(([paramValueKey, c]) => ({
        paramValueKey,
        count: c.count,
        avg: c.avg,
        sumReward: c.sumReward,
      })),
    };
  }

  /**
   * Full snapshot of the Q-table — for /api/v1/agent/param-learning?full=true.
   */
  listAllStats(): ParamLearnerStats[] {
    const out: ParamLearnerStats[] = [];
    for (const [strategyId, regimes] of Object.entries(this.qtable)) {
      for (const [regime, params] of Object.entries(regimes)) {
        for (const [paramKey, cells] of Object.entries(params)) {
          out.push({
            strategyId,
            regime,
            paramKey,
            cells: Object.entries(cells).map(([paramValueKey, c]) => ({
              paramValueKey,
              count: c.count,
              avg: c.avg,
              sumReward: c.sumReward,
            })),
          });
        }
      }
    }
    return out;
  }
}
