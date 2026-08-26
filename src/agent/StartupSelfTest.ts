import { logger } from '../telemetry/logger.js';
import type { AutonomousTradingAgent } from './AutonomousTradingAgent.js';
import type { ModelManager } from '../ai/ModelManager.js';
import type { MarketDataSupervisor } from '../market/supervisor/MarketDataSupervisor.js';
import type { ExecutionBroker } from '../broker/types.js';
import { metrics } from '../telemetry/metrics.js';

/**
 * Startup self-test for the autonomous trading agent.
 *
 * The autonomous agent depends on a constellation of modules — its own five
 * "brain" sub-modules (HealthMonitor, PerformanceTracker, CircuitBreaker,
 * ExitManager, itself) plus external dependencies (Ollama LLM, market data
 * supervisor, broker account). A failure in any one of these silently
 * degrades the agent's decisions: e.g. an unreachable Ollama forces every
 * LLM probe to fall back to NEUTRAL (no trades), or a broken broker account
 * means size calculations divide by zero.
 *
 * This self-test runs once at startup, logs a structured pass/fail table,
 * emits a Prometheus gauge (`autonomous_startup_self_test_passed`), and
 * (when `failOnCritical` is true) throws to halt the engine so the operator
 * sees the problem immediately rather than discovering it hours later when
 * the dashboard shows zero activity.
 *
 * Design notes:
 *
 * - Each check runs in parallel for speed (default 30s overall timeout).
 * - Failures are classified as `critical` (the agent cannot function) or
 *   `warning` (the agent can function but degraded).
 * - We never throw on `warning` — only on `critical` AND when `failOnCritical`
 *   is true. Operators who want to boot anyway can set
 *   `AUTONOMOUS_SELF_TEST_FAIL_ON_CRITICAL=false` (defaults to true).
 */

export type SelfTestStatus = 'pass' | 'fail' | 'warn';
export type SelfTestSeverity = 'critical' | 'warning';

export interface SelfTestCheck {
  name: string;
  description: string;
  severity: SelfTestSeverity;
  status: SelfTestStatus;
  detail: string;
  durationMs: number;
}

export interface SelfTestResult {
  passed: boolean;
  criticalFailures: number;
  warnings: number;
  checks: SelfTestCheck[];
  durationMs: number;
}

export interface SelfTestDeps {
  autonomousAgent: AutonomousTradingAgent;
  modelManager: ModelManager;
  supervisor?: MarketDataSupervisor;
  broker?: ExecutionBroker;
  /** Fail-fast toggle. When true (default), critical failures throw. */
  failOnCritical?: boolean;
  /** Per-check timeout. Default 10_000ms. */
  perCheckTimeoutMs?: number;
}

const DEFAULT_PER_CHECK_TIMEOUT_MS = 10_000;

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      t.unref?.();
    }),
  ]);
}

/**
 * Run the startup self-test. Returns the structured result; throws if any
 * CRITICAL check fails and `failOnCritical` is true (the default).
 */
export async function runStartupSelfTest(deps: SelfTestDeps): Promise<SelfTestResult> {
  const failOnCritical = deps.failOnCritical ?? true;
  const perCheckTimeout = deps.perCheckTimeoutMs ?? DEFAULT_PER_CHECK_TIMEOUT_MS;
  const startedAt = Date.now();

  const checks: SelfTestCheck[] = [];
  const runCheck = async (
    name: string,
    description: string,
    severity: SelfTestSeverity,
    fn: () => Promise<{ status: SelfTestStatus; detail: string }>
  ): Promise<void> => {
    const t0 = Date.now();
    try {
      const result = await withTimeout(fn(), perCheckTimeout, name);
      checks.push({
        name,
        description,
        severity,
        status: result.status,
        detail: result.detail,
        durationMs: Date.now() - t0,
      });
    } catch (err) {
      checks.push({
        name,
        description,
        severity,
        status: 'fail',
        detail: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - t0,
      });
    }
  };

  // Run all checks in parallel for speed.
  await Promise.all([
    // 1. Ollama LLM reachability (the agent's brain relies on this for
    // confidence probing; unreachable = silent NEUTRAL fallback = no trades).
    runCheck(
      'ollama_reachable',
      'Ollama LLM endpoint is reachable (used for confidence probing)',
      'warning', // warning because the agent falls back to deterministic confluence
      async () => {
        const reachable = await deps.modelManager.isReachable('llm');
        return {
          status: reachable ? 'pass' : 'fail',
          detail: reachable
            ? 'Ollama reachable — confidence probing will use the model'
            : 'Ollama unreachable — agent will fall back to deterministic confluence (no LLM probing)',
        };
      }
    ),

    // 2. Autonomous agent instance exists.
    runCheck(
      'autonomous_agent_constructed',
      'AutonomousTradingAgent instance is constructed and ready',
      'critical',
      async () => {
        // The agent's getSnapshot reads its private state; calling it
        // forces lazy initialization of every dep and surfaces any
        // "agent not wired" issue immediately.
        const snap = deps.autonomousAgent.getSnapshot();
        return {
          status: 'pass',
          detail: `agent constructed; running=${snap.running}; perSymbol=${snap.perSymbol.length}`,
        };
      }
    ),

    // 3. Circuit breaker is wired + reads its initial state.
    runCheck(
      'circuit_breaker_initialized',
      'CircuitBreaker reads its initial state without error',
      'critical',
      async () => {
        const snap = deps.autonomousAgent.getSnapshot();
        const b = snap.breaker;
        return {
          status: b.tripped ? 'warn' : 'pass',
          detail: `breaker tripped=${b.tripped}; reason=${b.reason ?? 'none'}; totalTrips=${b.totalTrips}`,
        };
      }
    ),

    // 4. Health monitor reads its initial state.
    runCheck(
      'health_monitor_initialized',
      'HealthMonitor returns a health snapshot',
      'critical',
      async () => {
        const snap = deps.autonomousAgent.getSnapshot();
        const h = snap.health;
        return {
          status: h.healthy ? 'pass' : 'warn',
          detail: `healthy=${h.healthy}; issues=${h.issues.length}; lastCheckedAt=${h.lastCheckedAt}`,
        };
      }
    ),

    // 5. Performance tracker reads its rolling stats (initial = 0 trades).
    runCheck(
      'performance_tracker_initialized',
      'PerformanceTracker returns rolling stats (initial sample = 0)',
      'critical',
      async () => {
        const snap = deps.autonomousAgent.getSnapshot();
        return {
          status: 'pass',
          detail: `rollingWinRate=${snap.rollingWinRate}; sampleSize=${snap.rollingSampleSize}`,
        };
      }
    ),

    // 6. Market data supervisor is reachable (if wired). Not critical
    // because the agent can run on cached klines, but the dashboard will
    // show stale data.
    runCheck(
      'market_data_supervisor_active',
      'MarketDataSupervisor reports an active provider',
      'warning',
      async () => {
        if (!deps.supervisor) {
          return { status: 'warn', detail: 'supervisor not wired (skipped)' };
        }
        const provider = deps.supervisor.getActiveProvider();
        return {
          status: provider ? 'pass' : 'fail',
          detail: provider ? `active provider: ${provider}` : 'no active provider',
        };
      }
    ),

    // 7. Broker account returns a non-zero equity (the agent sizes
    // positions off equity; zero equity would cause divide-by-zero).
    runCheck(
      'broker_account_has_equity',
      'Broker account returns non-zero equity (required for position sizing)',
      'critical',
      async () => {
        if (!deps.broker) {
          return { status: 'warn', detail: 'broker not wired (skipped)' };
        }
        // getAccount() may return sync or async — normalize both.
        const account = await Promise.resolve(deps.broker.getAccount());
        const eq = account.equity;
        if (eq <= 0) {
          return {
            status: 'fail',
            detail: `account equity is ${eq} — agent cannot size positions`,
          };
        }
        return {
          status: 'pass',
          detail: `account equity=${eq} available=${account.availableBalance}`,
        };
      }
    ),
  ]);

  const criticalFailures = checks.filter(
    (c) => c.severity === 'critical' && c.status === 'fail'
  ).length;
  const warnings =
    checks.filter((c) => c.status === 'warn').length +
    checks.filter((c) => c.severity === 'warning' && c.status === 'fail').length;

  const result: SelfTestResult = {
    passed: criticalFailures === 0,
    criticalFailures,
    warnings,
    checks,
    durationMs: Date.now() - startedAt,
  };

  // Log a structured table.
  const status = (s: SelfTestStatus) =>
    s === 'pass' ? '✓ PASS' : s === 'warn' ? '! WARN' : '✗ FAIL';
  const lines = checks.map(
    (c) =>
      `  ${status(c.status).padEnd(7)} [${c.severity.padEnd(8)}] ${c.name.padEnd(34)} ${c.durationMs}ms — ${c.detail}`
  );
  logger.info(
    { passed: result.passed, criticalFailures, warnings, durationMs: result.durationMs },
    `[AutonomousSelfTest] ${result.passed ? 'PASSED' : 'FAILED'} — ${criticalFailures} critical, ${warnings} warning(s), ${result.durationMs}ms`
  );
  for (const line of lines) {
    logger.info({ check: line.trim() }, `[AutonomousSelfTest]${line}`);
  }

  // Prometheus gauge so the dashboard / alerts can monitor self-test state.
  metrics.setGauge(
    'autonomous_startup_self_test_passed',
    result.passed ? 1 : 0
  );
  metrics.setGauge('autonomous_startup_self_test_critical_failures', criticalFailures);
  metrics.setGauge('autonomous_startup_self_test_warnings', warnings);

  if (!result.passed && failOnCritical) {
    const failed = checks
      .filter((c) => c.severity === 'critical' && c.status === 'fail')
      .map((c) => `${c.name}: ${c.detail}`)
      .join('; ');
    throw new Error(
      `Autonomous startup self-test FAILED with ${criticalFailures} critical failure(s): ${failed}`
    );
  }

  return result;
}
