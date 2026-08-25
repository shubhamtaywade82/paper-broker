import { describe, it, expect, beforeEach } from 'vitest';
import { useSystemStore } from '../systemStore.js';
import { useAccountStore } from '../accountStore.js';
import { useAgentStore } from '../agentStore.js';
import { useUiStore } from '../uiStore.js';

describe('System, Account, Agent, and UI Stores', () => {
  beforeEach(() => {
    useSystemStore.getState().reset();
    useAccountStore.getState().reset();
    useAgentStore.getState().reset();
  });

  it('SYS-01: setSystem performs partial updates while preserving other state', () => {
    useSystemStore.getState().setSystem({ mode: 'live', liveArmed: true });
    expect(useSystemStore.getState().mode).toBe('live');
    expect(useSystemStore.getState().liveArmed).toBe(true);
    expect(useSystemStore.getState().engineRunning).toBe(false);

    useSystemStore.getState().setSystem({ engineRunning: true });
    expect(useSystemStore.getState().mode).toBe('live');
    expect(useSystemStore.getState().engineRunning).toBe(true);
  });

  it('SYS-02: reset returns systemStore to defaults', () => {
    useSystemStore.getState().setSystem({ mode: 'live', incidentCount: 5 });
    useSystemStore.getState().reset();
    expect(useSystemStore.getState().mode).toBe('paper');
    expect(useSystemStore.getState().incidentCount).toBe(0);
  });

  it('ACC-01: setSnapshot updates all account fields cleanly', () => {
    useAccountStore.getState().setSnapshot({
      balance: 10000,
      equity: 10250,
      available: 9000,
      marginUsed: 1000,
      peakEquity: 10500,
      dailyPnl: 250,
    });
    expect(useAccountStore.getState().equity).toBe(10250);
    expect(useAccountStore.getState().dailyPnl).toBe(250);
  });

  it('ACC-02: reset clears account balances to zero', () => {
    useAccountStore.getState().setBalance(5000, 5200);
    expect(useAccountStore.getState().balance).toBe(5000);
    useAccountStore.getState().reset();
    expect(useAccountStore.getState().balance).toBe(0);
  });

  it('AGENT-01: addCycle adds cycles and caps at 100 entries', () => {
    for (let i = 0; i < 110; i++) {
      useAgentStore.getState().addCycle({
        cycleId: `cycle-${i}`,
        symbol: 'BTCUSDT',
        action: 'ENTER_LONG',
        confidence: 0.85,
        verdict: 'TRADE',
        startedAt: Date.now(),
      });
    }
    expect(useAgentStore.getState().cycles).toHaveLength(100);
    expect(useAgentStore.getState().cycles[0]?.cycleId).toBe('cycle-109');
  });

  it('UI-01: tab and symbol selection updates correctly', () => {
    useUiStore.getState().setActiveTab('trading');
    useUiStore.getState().setSelectedSymbol('SOLUSDT');
    expect(useUiStore.getState().activeTab).toBe('trading');
    expect(useUiStore.getState().selectedSymbol).toBe('SOLUSDT');
  });
});
