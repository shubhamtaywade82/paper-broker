import { logger } from '../../telemetry/logger.js';

/**
 * ABTestRunner
 * =============
 *
 * Skeleton for parallel-paper-instance A/B testing of candidate parameter
 * sets. The full implementation would maintain N parallel "shadow" paper
 * brokers, each running the same strategy with different parameter sets,
 * and promote the rolling-window winner to the live paper broker.
 *
 * This file ships the data structures + the promotion logic + an
 * evaluation tick that operators can invoke manually (or wire to the
 * Scheduler). The parallel-instance hosting itself is a larger piece of
 * plumbing — it requires either N separate PaperBroker instances or a
 * per-instance ledger overlay. We deliberately leave that to a follow-up
 * ADR; this skeleton provides the evaluation contract so operators can
 * start recording outcomes today and the wiring lands later.
 *
 * Off by default (AGENT_AB_TESTING_ENABLED=true). When off, recordOutcome()
 * is a no-op and promote() returns null.
 */

export interface ABTestInstance {
  id: string;
  label: string;
  /** Free-form JSON-serializable parameter set being tested. */
  params: Record<string, unknown>;
  /** Closed-trade outcomes for this instance, oldest first. */
  outcomes: ABTestOutcome[];
}

export interface ABTestOutcome {
  ts: number;
  symbol: string;
  strategyId: string;
  pnlUsdt: number;
}

export interface ABTestRunnerConfig {
  enabled: boolean;
  /** Number of candidate instances to maintain. */
  instances: number;
  /** Rolling window in closed trades per instance. */
  windowTrades: number;
  /** How often the promotion check runs (ms). */
  evalIntervalMs: number;
}

export interface ABTestState {
  config: ABTestRunnerConfig;
  instances: ABTestInstance[];
  /** Currently-promoted instance id (null = baseline / no promotion). */
  promotedInstanceId: string | null;
  lastEvalAt: number | null;
  lastEvalSummary: string | null;
}

export class ABTestRunner {
  private config: ABTestRunnerConfig;
  private instances: ABTestInstance[] = [];
  private promotedInstanceId: string | null = null;
  private lastEvalAt: number | null = null;
  private lastEvalSummary: string | null = null;

  constructor(config: ABTestRunnerConfig, initialInstances: ABTestInstance[] = []) {
    this.config = config;
    if (config.enabled) {
      this.instances = initialInstances.slice(0, config.instances);
      while (this.instances.length < config.instances) {
        this.instances.push({
          id: `ab-${this.instances.length + 1}`,
          label: `instance-${this.instances.length + 1}`,
          params: {},
          outcomes: [],
        });
      }
    }
  }

  /**
   * Record a closed-trade outcome against an instance. The caller decides
   * which instance to attribute the outcome to — typically the one whose
   * params were in force when the trade was opened.
   */
  recordOutcome(instanceId: string, outcome: ABTestOutcome): void {
    if (!this.config.enabled) return;
    const instance = this.instances.find((i) => i.id === instanceId);
    if (!instance) {
      logger.warn({ instanceId }, '[ABTestRunner] recordOutcome: unknown instance id, ignoring');
      return;
    }
    instance.outcomes.push(outcome);
    // Keep only the last windowTrades outcomes.
    if (instance.outcomes.length > this.config.windowTrades) {
      instance.outcomes = instance.outcomes.slice(-this.config.windowTrades);
    }
  }

  /**
   * Evaluate the running window and promote the best instance. Returns the
   * promoted instance id (or null when no instance has enough samples yet
   * or when no instance beats the current promoted one by a margin).
   *
   * Operators can call this manually via /api/v1/ab-tests/evaluate, or wire
   * it to the Scheduler at `evalIntervalMs`.
   */
  evaluate(now = Date.now()): { promotedInstanceId: string | null; summary: string } {
    if (!this.config.enabled) return { promotedInstanceId: null, summary: 'A/B testing disabled' };
    this.lastEvalAt = now;

    // Score = sum of outcomes / count = avg PnL per trade. Simple and robust.
    const scored = this.instances.map((inst) => {
      const trades = inst.outcomes.length;
      const sum = inst.outcomes.reduce((a, o) => a + o.pnlUsdt, 0);
      const avg = trades === 0 ? 0 : sum / trades;
      return { inst, trades, sum, avg };
    });

    // Require min sample per instance before promoting.
    const withSamples = scored.filter((s) => s.trades >= Math.min(10, this.config.windowTrades));
    if (withSamples.length === 0) {
      this.lastEvalSummary = 'no instance has enough samples yet';
      return { promotedInstanceId: null, summary: this.lastEvalSummary };
    }

    // Promote the highest-avg instance.
    withSamples.sort((a, b) => b.avg - a.avg);
    const winner = withSamples[0]!;
    const summary = `promoted ${winner.inst.id} (avg ${winner.avg.toFixed(2)}/trade over ${winner.trades} trades, sum ${winner.sum.toFixed(2)})`;
    this.promotedInstanceId = winner.inst.id;
    this.lastEvalSummary = summary;
    return { promotedInstanceId: this.promotedInstanceId, summary };
  }

  /** Snapshot for /api/v1/ab-tests. */
  getState(): ABTestState {
    return {
      config: this.config,
      instances: this.instances.map((i) => ({
        id: i.id,
        label: i.label,
        params: i.params,
        outcomes: i.outcomes,
      })),
      promotedInstanceId: this.promotedInstanceId,
      lastEvalAt: this.lastEvalAt,
      lastEvalSummary: this.lastEvalSummary,
    };
  }
}
