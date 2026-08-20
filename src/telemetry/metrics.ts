export interface MetricCounter {
  name: string;
  value: number;
}

export class Metrics {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();

  inc(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  setGauge(name: string, value: number): void {
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
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name} ${value}`);
    }

    for (const [name, value] of this.gauges) {
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