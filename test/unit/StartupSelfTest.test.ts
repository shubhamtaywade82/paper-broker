import { describe, it, expect } from 'vitest';
import { runStartupSelfTest } from '../../src/agent/StartupSelfTest.js';
import type { SelfTestDeps } from '../../src/agent/StartupSelfTest.js';
import type { AutonomousTradingAgent } from '../../src/agent/AutonomousTradingAgent.js';
import type { ModelManager } from '../../src/ai/ModelManager.js';
import type { MarketDataSupervisor } from '../../src/market/supervisor/MarketDataSupervisor.js';
import type { ExecutionBroker, AccountState } from '../../src/broker/types.js';
import type { CircuitBreakerState } from '../../src/agent/CircuitBreaker.js';
import type { HealthState } from '../../src/agent/HealthMonitor.js';
import type { RollingStats } from '../../src/agent/PerformanceTracker.js';

// We don't need to exercise the real agent — the self-test only calls
// `getSnapshot()` + `modelManager.isReachable()` + `broker.getAccount()`.
// Build a minimal mock that satisfies the shape.

interface AgentSnapshot {
  latestCycle: unknown;
  runtimeRiskMultiplier: number;
  rollingWinRate: number;
  rollingSampleSize: number;
  breaker: CircuitBreakerState;
  health: HealthState;
  running: boolean;
  perSymbol: unknown[];
}

function makeDeps(overrides: Partial<{
  reachable: boolean;
  breakerTripped: boolean;
  brokerEquity: number;
  supervisorProvider: string | null;
  failOnCritical: boolean;
}> = {}): SelfTestDeps {
  const reachable = overrides.reachable ?? true;
  const breakerTripped = overrides.breakerTripped ?? false;
  const brokerEquity = overrides.brokerEquity ?? 10_000;
  // Use explicit hasOwnProperty check so null is preserved (?? would coerce
  // null back to 'BINANCE' which would defeat the test).
  const supervisorProvider =
    overrides.supervisorProvider !== undefined ? overrides.supervisorProvider : 'BINANCE';
  const failOnCritical = overrides.failOnCritical ?? false; // tests don't throw by default

  const snapshot: AgentSnapshot = {
    latestCycle: null,
    runtimeRiskMultiplier: 1.0,
    rollingWinRate: 0,
    rollingSampleSize: 0,
    breaker: {
      tripped: breakerTripped,
      reason: breakerTripped ? 'DAILY_LOSS' : null,
      trippedAt: breakerTripped ? 1 : 0,
      cooldownEndsAt: breakerTripped ? 2 : 0,
      totalTrips: breakerTripped ? 1 : 0,
    },
    health: {
      healthy: true,
      issues: [],
      lastCheckedAt: 1,
    },
    running: false,
    perSymbol: [],
  };

  const agent = {
    getSnapshot: () => snapshot,
  } as unknown as AutonomousTradingAgent;

  const modelManager = {
    isReachable: async () => reachable,
  } as unknown as ModelManager;

  const supervisor = {
    getActiveProvider: () => supervisorProvider,
  } as unknown as MarketDataSupervisor;

  const account: AccountState = {
    walletBalance: brokerEquity,
    unrealizedPnl: 0,
    equity: brokerEquity,
    initialMargin: 0,
    maintenanceMargin: 0,
    availableBalance: brokerEquity,
    totalFees: 0,
  };

  const broker = {
    getAccount: () => account,
  } as unknown as ExecutionBroker;

  return { autonomousAgent: agent, modelManager, supervisor, broker, failOnCritical };
}

describe('StartupSelfTest', () => {
  it('SELF-TEST-01: all-pass when Ollama reachable + broker has equity + modules wired', async () => {
    const result = await runStartupSelfTest(makeDeps());
    expect(result.passed).toBe(true);
    expect(result.criticalFailures).toBe(0);
    // 7 checks total: ollama + 4 brain modules + supervisor + broker.
    expect(result.checks.length).toBe(7);
    // All pass or warn (Ollama fail is a warn-severity, but we set reachable=true).
    for (const c of result.checks) {
      expect(c.status).toMatch(/pass|warn/);
    }
    // The agent + breaker + health + perf + broker + supervisor checks should all pass.
    const agentCheck = result.checks.find((c) => c.name === 'autonomous_agent_constructed');
    expect(agentCheck?.status).toBe('pass');
    const breakerCheck = result.checks.find((c) => c.name === 'circuit_breaker_initialized');
    expect(breakerCheck?.status).toBe('pass');
    const brokerCheck = result.checks.find((c) => c.name === 'broker_account_has_equity');
    expect(brokerCheck?.status).toBe('pass');
  });

  it('SELF-TEST-02: critical broker equity failure is recorded', async () => {
    const result = await runStartupSelfTest(makeDeps({ brokerEquity: 0 }));
    expect(result.criticalFailures).toBe(1);
    expect(result.passed).toBe(false);
    const brokerCheck = result.checks.find((c) => c.name === 'broker_account_has_equity');
    expect(brokerCheck?.status).toBe('fail');
    expect(brokerCheck?.severity).toBe('critical');
    expect(brokerCheck?.detail).toMatch(/equity is 0/);
  });

  it('SELF-TEST-03: Ollama unreachable is a WARNING (not critical) — agent falls back to deterministic confluence', async () => {
    const result = await runStartupSelfTest(makeDeps({ reachable: false }));
    // Ollama is warning-severity, so criticalFailures should still be 0.
    expect(result.criticalFailures).toBe(0);
    expect(result.passed).toBe(true);
    const ollamaCheck = result.checks.find((c) => c.name === 'ollama_reachable');
    expect(ollamaCheck?.status).toBe('fail');
    expect(ollamaCheck?.severity).toBe('warning');
    expect(ollamaCheck?.detail).toMatch(/fall back to deterministic confluence/);
  });

  it('SELF-TEST-04: tripped circuit breaker is a WARN, not a fail (still functional)', async () => {
    const result = await runStartupSelfTest(makeDeps({ breakerTripped: true }));
    const breakerCheck = result.checks.find((c) => c.name === 'circuit_breaker_initialized');
    expect(breakerCheck?.status).toBe('warn');
    expect(result.passed).toBe(true);
  });

  it('SELF-TEST-05: no active market data provider is a WARNING (not critical)', async () => {
    const result = await runStartupSelfTest(makeDeps({ supervisorProvider: null }));
    const supervisorCheck = result.checks.find((c) => c.name === 'market_data_supervisor_active');
    expect(supervisorCheck?.status).toBe('fail');
    expect(supervisorCheck?.severity).toBe('warning');
  });

  it('SELF-TEST-06: failOnCritical=true throws on critical failure', async () => {
    await expect(
      runStartupSelfTest(makeDeps({ brokerEquity: 0, failOnCritical: true }))
    ).rejects.toThrow(/Autonomous startup self-test FAILED/);
  });

  it('SELF-TEST-07: failOnCritical=false returns result without throwing (even with critical failures)', async () => {
    const result = await runStartupSelfTest(makeDeps({ brokerEquity: 0, failOnCritical: false }));
    expect(result.passed).toBe(false);
    expect(result.criticalFailures).toBe(1);
  });

  it('SELF-TEST-08: each check records durationMs', async () => {
    const result = await runStartupSelfTest(makeDeps());
    for (const c of result.checks) {
      expect(c.durationMs).toBeGreaterThanOrEqual(0);
      expect(c.durationMs).toBeLessThan(10_000); // per-check timeout
    }
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
