import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Metrics } from '../../src/telemetry/metrics.js';
import { logger } from '../../src/telemetry/logger.js';

describe('Metrics (Medium)', () => {
  let metrics: Metrics;

  beforeEach(() => {
    metrics = new Metrics();
  });

  it('increments counters and tracks gauges', () => {
    metrics.inc('orders_submitted_total');
    metrics.inc('orders_submitted_total', 2);
    metrics.setGauge('instruments_total', 5);

    expect(metrics.getCounter('orders_submitted_total')).toBe(3);
    expect(metrics.getGauge('instruments_total')).toBe(5);
  });

  it('renders HELP and TYPE lines for known metrics in Prometheus exposition format', () => {
    metrics.inc('orders_submitted_total');
    metrics.setGauge('instruments_total', 5);

    const output = metrics.renderPrometheus();

    expect(output).toContain('# HELP orders_submitted_total Number of orders submitted to the broker');
    expect(output).toContain('# TYPE orders_submitted_total counter');
    expect(output).toContain('orders_submitted_total 1');
    expect(output).toContain('# HELP instruments_total Number of trading instruments currently loaded');
    expect(output).toContain('# TYPE instruments_total gauge');
    expect(output).toContain('instruments_total 5');
  });

  it('falls back to a generic HELP line for a metric name not in the registry', () => {
    metrics.inc('some_new_metric_total');
    const output = metrics.renderPrometheus();
    expect(output).toContain('# HELP some_new_metric_total some_new_metric_total (counter)');
  });

  it('warns once on a non-snake_case metric name instead of silently accepting it', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    metrics.inc('camelCaseMetric');
    metrics.inc('camelCaseMetric'); // second call must not warn again

    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});
