import { describe, it, expect, vi } from 'vitest';
import {
  AnalystReportSchema,
  DebateVerdictSchema,
  TraderDecisionSchema,
  RiskOpinionSchema,
  FundManagerApprovalSchema,
  CycleRecordSchema,
} from '../../src/ai/schemas.js';
import { TradingAgentsPipeline } from '../../src/ai/tradingAgents.js';

describe('TradingAgents Multi-Agent Schemas & Pipeline', () => {
  it('validates AnalystReport schema successfully', () => {
    const valid = {
      agent: 'DerivativesAnalyst',
      symbol: 'SOLUSDT',
      timestamp: Date.now(),
      summary: 'Funding rate neutral, OI rising',
      bullishSignals: ['OI increasing with upward momentum'],
      bearishSignals: [],
      keyMetrics: { fundingRate: 0.0001, openInterest: 50000 },
      confidence: 0.75,
    };

    const parsed = AnalystReportSchema.parse(valid);
    expect(parsed.agent).toBe('DerivativesAnalyst');
    expect(parsed.confidence).toBe(0.75);
  });

  it('validates DebateVerdict and TraderDecision schemas', () => {
    const verdict = DebateVerdictSchema.parse({
      prevailingSide: 'BULL',
      rationale: 'Long setup supported by high OI and spot demand',
      conviction: 0.8,
    });
    expect(verdict.prevailingSide).toBe('BULL');

    const decision = TraderDecisionSchema.parse({
      symbol: 'SOLUSDT',
      action: 'LONG',
      leverage: 5,
      sizePct: 0.15,
      entryPrice: 142.5,
      stopLoss: 139.0,
      takeProfit: 148.0,
      rationale: 'Breakout above key level with tight invalidation',
      confidence: 0.8,
    });
    expect(decision.action).toBe('LONG');
    expect(decision.leverage).toBe(5);
  });

  it('validates RiskOpinion and FundManagerApproval schemas', () => {
    const opinion = RiskOpinionSchema.parse({
      persona: 'SAFE',
      verdict: 'REDUCE_LEVERAGE',
      adjustedLeverage: 3,
      rationale: 'Cap leverage to 3x to survive volatility',
    });
    expect(opinion.persona).toBe('SAFE');
    expect(opinion.adjustedLeverage).toBe(3);

    const approval = FundManagerApprovalSchema.parse({
      approved: true,
      finalDecision: {
        symbol: 'SOLUSDT',
        action: 'LONG',
        leverage: 3,
        sizePct: 0.1,
        stopLoss: 139.0,
        takeProfit: 148.0,
        rationale: 'Approved with adjusted leverage',
        confidence: 0.8,
      },
      rationale: 'Consensus risk approval',
    });
    expect(approval.approved).toBe(true);
    expect(approval.finalDecision.leverage).toBe(3);
  });

  it('toSignalInput converts approved decisions into canonical SignalInput', () => {
    const pipeline = new TradingAgentsPipeline({ model: 'llama3.1:8b' });

    const approval = {
      approved: true,
      finalDecision: {
        symbol: 'SOLUSDT',
        action: 'LONG' as const,
        leverage: 3,
        sizePct: 0.1,
        stopLoss: 139.0,
        takeProfit: 148.0,
        rationale: 'High probability long setup',
        confidence: 0.82,
      },
      rationale: 'Risk team consensus',
    };

    const signal = pipeline.toSignalInput(approval, 'trading-agents-v1');
    expect(signal).not.toBeNull();
    expect(signal?.action).toBe('OPEN_LONG');
    expect(signal?.symbol).toBe('SOLUSDT');
    expect(signal?.confidence).toBe(0.82);
    expect(signal?.stopLossPrice).toBe('139');
    expect(signal?.takeProfitPrice).toBe('148');
    expect(signal?.features.leverage).toBe(3);
  });

  it('toSignalInput returns null for rejected or neutral approvals', () => {
    const pipeline = new TradingAgentsPipeline({ model: 'llama3.1:8b' });

    const rejected = {
      approved: false,
      finalDecision: {
        symbol: 'SOLUSDT',
        action: 'LONG' as const,
        leverage: 3,
        sizePct: 0.1,
        rationale: 'Rejected',
        confidence: 0.2,
      },
      rationale: 'Risk limit breached',
    };
    expect(pipeline.toSignalInput(rejected)).toBeNull();

    const neutral = {
      approved: true,
      finalDecision: {
        symbol: 'SOLUSDT',
        action: 'NEUTRAL' as const,
        leverage: 1,
        sizePct: 0,
        rationale: 'Hold flat',
        confidence: 0.5,
      },
      rationale: 'Neutral hold',
    };
    expect(pipeline.toSignalInput(neutral)).toBeNull();
  });

  it('runs complete cycle with deterministic fallback when offline', async () => {
    const pipeline = new TradingAgentsPipeline({ model: 'llama3.1:8b' });

    const cycle = await pipeline.runCycle({
      symbol: 'SOLUSDT',
      lastPrice: 142.5,
      bid: 142.48,
      ask: 142.52,
      spread: 0.04,
      mark: 142.5,
      fundingRate: 0.0001,
      openInterest: 120000,
    });

    expect(cycle.symbol).toBe('SOLUSDT');
    expect(cycle.analystReports.length).toBeGreaterThan(0);
    // H-17: debateRounds defaults to 2, and now actually drives the number of
    // rounds run (previously always exactly 1 round / 2 entries regardless of
    // config) — 2 rounds x (BULL + BEAR) = 4 entries.
    expect(cycle.debate.length).toBe(4);
    expect(cycle.verdict).toBeDefined();
    expect(cycle.fundManagerApproval).toBeDefined();
    expect(CycleRecordSchema.safeParse(cycle).success).toBe(true);
  }, 30_000);

  it('H-17: debateRounds actually controls the number of debate rounds run', async () => {
    const pipeline = new TradingAgentsPipeline({ model: 'llama3.1:8b', debateRounds: 1 });

    const cycle = await pipeline.runCycle({
      symbol: 'SOLUSDT',
      lastPrice: 142.5,
      bid: 142.48,
      ask: 142.52,
      spread: 0.04,
      mark: 142.5,
    });

    expect(cycle.debate.length).toBe(2); // 1 round x (BULL + BEAR)
    expect(cycle.debate.filter((d) => d.round === 1).length).toBe(2);
  }, 10_000);
});
