import { describe, expect, it } from 'vitest';
import {
  TradingAgentsPipeline,
  DEFAULT_AGENT_RISK_POLICY,
  type AgentCycleStep,
  type MarketFactContext,
} from '../../src/ai/tradingAgents.js';
import type { TraderDecision, RiskOpinion, FundManagerApproval } from '../../src/ai/schemas.js';

/**
 * The risk team and fund manager are deterministic by contract (CONTRACTS.md
 * Section 5 — the LLM may not override risk checks), so they can be tested
 * exactly, with no model and no network.
 */
function makePipeline(): TradingAgentsPipeline {
  return new TradingAgentsPipeline({ model: 'test-model', baseUrl: 'http://127.0.0.1:1' });
}

function ctx(overrides: Partial<MarketFactContext> = {}): MarketFactContext {
  return {
    symbol: 'SOLUSDT',
    lastPrice: 100,
    bid: 99.9,
    ask: 100.1,
    spread: 0.2,
    mark: 100,
    accountEquity: 10_000,
    availableBalance: 10_000,
    ...overrides,
  };
}

function decision(overrides: Partial<TraderDecision> = {}): TraderDecision {
  return {
    symbol: 'SOLUSDT',
    action: 'LONG',
    leverage: 5,
    sizePct: 0.05,
    confidence: 0.8,
    stopLoss: 95,
    takeProfit: 115,
    rationale: 'test',
    ...overrides,
  };
}

// The stages under test are private; exercise them through the public surface.
type Internals = {
  runRiskTeam(
    cycleId: string,
    ctx: MarketFactContext,
    decision: TraderDecision,
    onStep?: (s: AgentCycleStep) => void
  ): Promise<RiskOpinion[]>;
  runFundManager(
    cycleId: string,
    decision: TraderDecision,
    opinions: RiskOpinion[],
    onStep?: (s: AgentCycleStep) => void
  ): Promise<FundManagerApproval>;
};

const internals = (p: TradingAgentsPipeline): Internals => p as unknown as Internals;

describe('Agent risk policy (deterministic stages)', () => {
  it('evaluates all three declared personas, not two', async () => {
    const opinions = await internals(makePipeline()).runRiskTeam('c1', ctx(), decision());

    expect(opinions.map((o) => o.persona).sort()).toEqual(['NEUTRAL', 'RISKY', 'SAFE']);
  });

  it('tags its steps as deterministic, never as LLM output', async () => {
    const steps: AgentCycleStep[] = [];
    const pipeline = makePipeline();
    await internals(pipeline).runRiskTeam('c1', ctx(), decision(), (s) => steps.push(s));
    await internals(pipeline).runFundManager('c1', decision(), [], (s) => steps.push(s));

    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => s.engine === 'deterministic')).toBe(true);
  });

  it('caps leverage per persona and reports REDUCE_LEVERAGE', async () => {
    const opinions = await internals(makePipeline()).runRiskTeam(
      'c1',
      ctx(),
      decision({ leverage: 20, sizePct: 0.01 })
    );

    const safe = opinions.find((o) => o.persona === 'SAFE');
    const risky = opinions.find((o) => o.persona === 'RISKY');

    expect(safe?.adjustedLeverage).toBe(DEFAULT_AGENT_RISK_POLICY.personaCeilings.SAFE.maxLeverage);
    expect(safe?.verdict).toBe('REDUCE_LEVERAGE');
    expect(risky?.adjustedLeverage).toBe(DEFAULT_AGENT_RISK_POLICY.personaCeilings.RISKY.maxLeverage);
  });

  it('caps position size per persona and reports REDUCE_SIZE', async () => {
    const opinions = await internals(makePipeline()).runRiskTeam(
      'c1',
      ctx(),
      decision({ leverage: 1, sizePct: 0.9 })
    );

    const safe = opinions.find((o) => o.persona === 'SAFE');
    expect(safe?.adjustedSizePct).toBe(DEFAULT_AGENT_RISK_POLICY.personaCeilings.SAFE.maxSizePct);
    expect(safe?.verdict).toBe('REDUCE_SIZE');
  });

  it('rejects a proposal with no stop loss', async () => {
    const opinions = await internals(makePipeline()).runRiskTeam(
      'c1',
      ctx(),
      decision({ stopLoss: undefined })
    );

    expect(opinions.every((o) => o.verdict === 'REJECT')).toBe(true);
    expect(opinions[0]?.rationale).toContain('no stop loss');
  });

  it('rejects a stop on the wrong side of entry', async () => {
    // A LONG with a stop ABOVE entry would trigger instantly at a loss.
    const long = await internals(makePipeline()).runRiskTeam(
      'c1',
      ctx({ lastPrice: 100 }),
      decision({ action: 'LONG', stopLoss: 105 })
    );
    expect(long.every((o) => o.verdict === 'REJECT')).toBe(true);

    const short = await internals(makePipeline()).runRiskTeam(
      'c1',
      ctx({ lastPrice: 100 }),
      decision({ action: 'SHORT', stopLoss: 95 })
    );
    expect(short.every((o) => o.verdict === 'REJECT')).toBe(true);
  });

  it('rejects per-persona when confidence is below that persona floor', async () => {
    const opinions = await internals(makePipeline()).runRiskTeam(
      'c1',
      ctx(),
      decision({ confidence: 0.5 })
    );

    // 0.5 clears RISKY (0.45) but not NEUTRAL (0.55) or SAFE (0.65).
    expect(opinions.find((o) => o.persona === 'SAFE')?.verdict).toBe('REJECT');
    expect(opinions.find((o) => o.persona === 'NEUTRAL')?.verdict).toBe('REJECT');
    expect(opinions.find((o) => o.persona === 'RISKY')?.verdict).not.toBe('REJECT');
  });

  it('limits size to available free margin', async () => {
    const opinions = await internals(makePipeline()).runRiskTeam(
      'c1',
      ctx({ accountEquity: 10_000, availableBalance: 200 }),
      decision({ sizePct: 0.05 }) // wants 500 of margin, only 200 free
    );

    const neutral = opinions.find((o) => o.persona === 'NEUTRAL');
    expect(neutral?.adjustedSizePct).toBeCloseTo(0.02, 6);
    expect(neutral?.verdict).toBe('REDUCE_SIZE');
  });

  it('approves a NEUTRAL proposal without adjusting anything', async () => {
    const opinions = await internals(makePipeline()).runRiskTeam(
      'c1',
      ctx(),
      decision({ action: 'NEUTRAL' })
    );

    expect(opinions.every((o) => o.verdict === 'APPROVE')).toBe(true);
  });
});

describe('Fund manager (deterministic gate)', () => {
  it('takes the most conservative leverage and size across personas', async () => {
    const pipeline = makePipeline();
    const d = decision({ leverage: 20, sizePct: 0.9 });
    const opinions = await internals(pipeline).runRiskTeam('c1', ctx(), d);
    const approval = await internals(pipeline).runFundManager('c1', d, opinions);

    expect(approval.approved).toBe(true);
    expect(approval.finalDecision.leverage).toBe(
      DEFAULT_AGENT_RISK_POLICY.personaCeilings.SAFE.maxLeverage
    );
    expect(approval.finalDecision.sizePct).toBe(
      DEFAULT_AGENT_RISK_POLICY.personaCeilings.SAFE.maxSizePct
    );
  });

  it('blocks the trade when any single persona rejects', async () => {
    const pipeline = makePipeline();
    const d = decision();
    const opinions = await internals(pipeline).runRiskTeam('c1', ctx(), d);
    opinions.push({ persona: 'SAFE', verdict: 'REJECT', rationale: 'stress test' });

    const approval = await internals(pipeline).runFundManager('c1', d, opinions);

    expect(approval.approved).toBe(false);
    expect(approval.rationale).toContain('Rejected by risk team');
  });

  it('never approves a NEUTRAL decision', async () => {
    const pipeline = makePipeline();
    const d = decision({ action: 'NEUTRAL' });
    const opinions = await internals(pipeline).runRiskTeam('c1', ctx(), d);
    const approval = await internals(pipeline).runFundManager('c1', d, opinions);

    expect(approval.approved).toBe(false);
  });

  it('rejects below the fund manager confidence floor even with no persona rejects', async () => {
    const pipeline = makePipeline();
    const d = decision({ confidence: 0.47 });
    // Only the RISKY persona clears 0.45; force a clean slate to isolate the floor.
    const approval = await internals(pipeline).runFundManager('c1', d, [
      { persona: 'RISKY', verdict: 'APPROVE', adjustedLeverage: 3, adjustedSizePct: 0.02, rationale: 'ok' },
    ]);

    expect(approval.approved).toBe(false);
    expect(approval.rationale).toContain('below approval floor');
  });

  it('rejects when risk reduced the size to zero', async () => {
    const pipeline = makePipeline();
    const d = decision();
    const approval = await internals(pipeline).runFundManager('c1', d, [
      { persona: 'SAFE', verdict: 'REDUCE_SIZE', adjustedLeverage: 3, adjustedSizePct: 0, rationale: 'no margin' },
    ]);

    expect(approval.approved).toBe(false);
    expect(approval.rationale).toContain('zero');
  });
});
