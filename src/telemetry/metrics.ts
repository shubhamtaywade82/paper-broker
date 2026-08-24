import { logger } from './logger.js';

export interface MetricCounter {
  name: string;
  value: number;
}

// Medium finding ("no HELP annotations or naming convention enforcement").
// Metric names are arbitrary strings supplied by any caller across the
// codebase, so a complete/mandatory registry isn't practical here — this is
// a best-effort description table for the metrics currently emitted
// (enumerated via grep across src/ for metrics.inc/setGauge call sites).
// Falls back to a generic description for anything not listed, rather than
// omitting HELP entirely.
const METRIC_HELP: Record<string, string> = {
  account_snapshots_total: 'Number of account state snapshots persisted',
  api_auth_rejections_total: 'Number of API requests rejected by the auth guard',
  backtest_runs_total: 'Number of backtest runs executed via /api/v1/backtest/run',
  daily_baseline_rolls_total: 'Number of times the daily equity baseline was rolled',
  engine_starts_total: 'Number of times the strategy engine was started',
  engine_stops_total: 'Number of times the strategy engine was stopped',
  funding_payments_total: 'Number of funding payment application ticks',
  instruments_total: 'Number of trading instruments currently loaded',
  kill_switch_activations_total: 'Number of times the kill switch was activated',
  market_ticks_written_total: 'Number of market ticks persisted to the snapshot store',
  orders_cancel_all_total: 'Number of cancel-all-orders requests processed',
  orders_canceled_total: 'Number of individual orders canceled',
  orders_submitted_total: 'Number of orders submitted to the broker',
  signals_expired_total: 'Number of signals expired by the strategy engine',
  signals_received_total: 'Number of signals received from strategies',
  signals_rejected_total: 'Number of signals rejected during validation or execution',
  signals_validated_total: 'Number of signals that passed validation',
  strategies_total: 'Number of strategies currently registered',
};

/** snake_case, optionally dotted/underscored words only — Prometheus's own recommended metric name convention. */
const METRIC_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const warnedNonConformingNames = new Set<string>();

export class Metrics {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();

  private checkNamingConvention(name: string): void {
    if (METRIC_NAME_PATTERN.test(name) || warnedNonConformingNames.has(name)) return;
    warnedNonConformingNames.add(name);
    logger.warn({ metricName: name }, '[Metrics] metric name does not follow the snake_case naming convention');
  }

  inc(name: string, by = 1): void {
    this.checkNamingConvention(name);
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  setGauge(name: string, value: number): void {
    this.checkNamingConvention(name);
    this.gauges.set(name, value);
  }

  getCounter(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  getGauge(name: string): number {
    return this.gauges.get(name) ?? 0;
  }

  snapshot(): {
    counters: MetricCounter[];
    gauges: MetricCounter[];
  } {
    return {
      counters: Array.from(this.counters.entries()).map(([name, value]) => ({ name, value })),
      gauges: Array.from(this.gauges.entries()).map(([name, value]) => ({ name, value })),
    };
  }

  renderPrometheus(): string {
    const lines: string[] = [];

    for (const [name, value] of this.counters) {
      lines.push(`# HELP ${name} ${METRIC_HELP[name] ?? `${name} (counter)`}`);
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name} ${value}`);
    }

    for (const [name, value] of this.gauges) {
      lines.push(`# HELP ${name} ${METRIC_HELP[name] ?? `${name} (gauge)`}`);
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${value}`);
    }

    return lines.join('\n');
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
  }
}

export const metrics = new Metrics();