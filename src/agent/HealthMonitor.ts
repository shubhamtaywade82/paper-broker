import type { EventLog } from '../persistence/EventLog.js';
import type { WebSocketGateway } from '../api/websocket/WebSocketGateway.js';
import type { ModelManager } from '../ai/ModelManager.js';
import type { MtfStateEngine } from '../market/MtfStateEngine.js';
import type { MarketStateManager } from '../market/MarketState.js';
import { logger } from '../telemetry/logger.js';
import { metrics } from '../telemetry/metrics.js';

export type HealthIssueKind =
  | 'KLINE_STALE'
  | 'MARKET_STATE_STALE'
  | 'MODEL_UNREACHABLE'
  | 'WS_DISCONNECT_RECENT';

export interface HealthIssue {
  kind: HealthIssueKind;
  symbol?: string;
  timeframe?: string;
  detail: string;
}

export interface HealthState {
  /** True iff there are zero issues. */
  healthy: boolean;
  /** List of detected issues. Empty when healthy. */
  issues: HealthIssue[];
  /** Last time the monitor ran a full probe. */
  lastCheckedAt: number;
}

export interface HealthMonitorConfig {
  /** Per-symbol staleness threshold in ms (kline + market state). */
  staleMs: number;
  /** How often to probe the model for reachability (ms). 0 = never. */
  modelProbeIntervalMs: number;
  /** Symbols to probe each cycle. */
  symbols: string[];
  /** Timeframes to check for kline staleness. */
  timeframes: Array<'4h' | '1h' | '15m' | '5m'>;
}

export interface HealthMonitorDeps {
  eventLog: EventLog;
  wsGateway: WebSocketGateway;
  mtfEngine: MtfStateEngine;
  marketState: MarketStateManager;
  modelManager: ModelManager;
}

/**
 * Self-diagnostics for the autonomous agent.
 *
 * Each cycle, the agent asks this monitor: "is everything I depend on
 * still alive?" If the answer is no, the circuit breaker trips and the
 * agent stands aside until the monitor reports healthy again.
 *
 * The monitor checks:
 *   1. Kline freshness per symbol/timeframe (via MtfStateEngine's syncStatus)
 *   2. Market-state tick freshness (via MarketStateManager.isStale)
 *   3. Model reachability (via ModelManager.isReachable) — throttled to
 *      once per `modelProbeIntervalMs` because the probe actually calls
 *      the model endpoint.
 *   4. Recent WebSocket disconnects (via EventLog.getEvents)
 *
 * All issues are surfaced via:
 *   - `agent.autonomous.health` WebSocket broadcast
 *   - `AUTONOMOUS_HEALTH_DEGRADED` / `AUTONOMOUS_HEALTH_RECOVERED` system events
 *   - `autonomous_health_*` metrics gauges
 *
 * The monitor never throws — it always returns a HealthState, even if
 * individual probes fail. A failed probe is itself an issue to report.
 */
export class HealthMonitor {
  private state: HealthState = { healthy: true, issues: [], lastCheckedAt: 0 };
  private lastModelProbeAt = 0;
  private modelReachable = true;
  private firstRun = true;

  constructor(
    private readonly config: HealthMonitorConfig,
    private readonly deps: HealthMonitorDeps
  ) {
    metrics.setGauge('autonomous_health_healthy', 1);
    metrics.setGauge('autonomous_health_issues', 0);
  }

  /**
   * Run all probes and update internal state. Returns the freshly-computed
   * state. Broadcasts + emits events only on healthy→unhealthy and
   * unhealthy→healthy transitions (and on the very first run).
   */
  async check(now = Date.now()): Promise<HealthState> {
    const issues: HealthIssue[] = [];

    // 1. Kline freshness per symbol/timeframe.
    for (const symbol of this.config.symbols) {
      const mtf = this.deps.mtfEngine.computeState(symbol, now);
      for (const tf of this.config.timeframes) {
        const tfState = mtf.timeframes[tf];
        if (!tfState) continue;
        if (tfState.syncStatus === 'STALE' || tfState.syncStatus === 'MISSING_DATA' || tfState.dataHealth === 'STALE') {
          issues.push({
            kind: 'KLINE_STALE',
            symbol,
            timeframe: tf,
            detail: `4h syncStatus=${tfState.syncStatus} dataHealth=${tfState.dataHealth}`,
          });
        }
      }
    }

    // 2. Market-state tick freshness.
    for (const symbol of this.config.symbols) {
      if (this.deps.marketState.isStale(symbol, this.config.staleMs)) {
        issues.push({
          kind: 'MARKET_STATE_STALE',
          symbol,
          detail: `no fresh tick within ${this.config.staleMs}ms`,
        });
      }
    }

    // 3. Model reachability — throttled.
    if (
      this.config.modelProbeIntervalMs > 0 &&
      (now - this.lastModelProbeAt >= this.config.modelProbeIntervalMs || this.firstRun)
    ) {
      this.lastModelProbeAt = now;
      try {
        this.modelReachable = await this.deps.modelManager.isReachable('llm');
      } catch {
        this.modelReachable = false;
      }
    }
    if (!this.modelReachable) {
      issues.push({
        kind: 'MODEL_UNREACHABLE',
        detail: 'ModelManager.isReachable returned false — LLM confidence probes will use deterministic fallback',
      });
    }

    // 4. Recent WS disconnect.
    const recentDisconnects = this.deps.eventLog.getEvents({ type: 'WS_DISCONNECTED', limit: 1 });
    if (recentDisconnects.length > 0) {
      const ev = recentDisconnects[0]!;
      const ts = typeof ev.ts === 'number' ? ev.ts : Date.parse(String(ev.ts));
      if (Number.isFinite(ts) && now - ts < this.config.staleMs * 4) {
        issues.push({
          kind: 'WS_DISCONNECT_RECENT',
          detail: `WebSocket disconnect at ${new Date(ts).toISOString()}`,
        });
      }
    }

    const newState: HealthState = {
      healthy: issues.length === 0,
      issues,
      lastCheckedAt: now,
    };

    // Broadcast on transition (and on the very first run if degraded).
    const wasHealthy = this.state.healthy;
    const nowHealthy = newState.healthy;
    this.state = newState;
    metrics.setGauge('autonomous_health_healthy', nowHealthy ? 1 : 0);
    metrics.setGauge('autonomous_health_issues', issues.length);

    if (this.firstRun || wasHealthy !== nowHealthy) {
      if (!nowHealthy) {
        this.deps.eventLog.appendSystemEvent({
          eventType: 'AUTONOMOUS_HEALTH_DEGRADED',
          payload: { issues: issues.map((i) => ({ kind: i.kind, symbol: i.symbol, timeframe: i.timeframe, detail: i.detail })) },
          createdAtUtc: new Date(now).toISOString(),
        });
        logger.warn({ issues }, 'Autonomous agent health degraded');
      } else if (!this.firstRun) {
        // healthy→healthy transition isn't logged; we only log unhealthy→healthy.
        this.deps.eventLog.appendSystemEvent({
          eventType: 'AUTONOMOUS_HEALTH_RECOVERED',
          payload: { previouslyDegraded: issues.length === 0 ? true : false },
          createdAtUtc: new Date(now).toISOString(),
        });
        logger.info('Autonomous agent health recovered');
      }
      this.deps.wsGateway.broadcast('agent.autonomous.health', {
        healthy: nowHealthy,
        issues: issues.map((i) => ({ kind: i.kind, symbol: i.symbol, timeframe: i.timeframe, detail: i.detail })),
        checkedAt: now,
      });
    }
    this.firstRun = false;
    return newState;
  }

  /** Cached last-known state (no probes). */
  getState(): HealthState {
    return this.state;
  }
}
