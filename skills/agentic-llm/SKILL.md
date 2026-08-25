---
name: agentic-llm
description: Use Ollama as a constrained reasoning/orchestration agent.
---

# Agentic LLM Skill

## Current State

**A multi-agent pipeline is implemented; tool orchestration is not.**

`TradingAgentsPipeline` (`src/ai/tradingAgents.ts`) runs a seven-stage cycle over
`@nemesis-oss/ollama-sdk`, with a local daemon plus an optional cloud key pool
and failover. `OllamaSignalGenerator` and the `ollama-trend-5m` strategy no
longer exist — do not reference them.

| Stage | Engine |
|-------|--------|
| `analyst_team` | LLM |
| `debate_bull` / `debate_bear` | LLM |
| `debate_verdict` | LLM |
| `trader_decision` | LLM |
| `risk_team` | **deterministic** |
| `fund_manager` | **deterministic** |

Every `AgentCycleStep` carries `engine: 'llm' | 'deterministic'`. Never present a
deterministic stage as model output.

Still missing: tool-calling agent loop, MCP orchestration, skill selection, and
any memory across cycles. Every cycle starts cold.

See KNOWN_LIMITATIONS.md for details.

## LLM Role

The LLM is a **reasoning layer over verified facts**.

### Valid Responsibilities

The LLM MAY:

- ✅ Analyze structured market data
- ✅ Select relevant skills/tools
- ✅ Request additional evidence
- ✅ Inspect conflicting evidence
- ✅ Compare setups
- ✅ Rank candidates
- ✅ Recommend WAIT / NO_TRADE / HOLD
- ✅ Propose position-management intent
- ✅ Produce structured signal with evidence

### Invalid Responsibilities

The LLM MUST NOT:

- ❌ Fabricate market data
- ❌ Calculate authoritative account state
- ❌ Bypass SignalEngine validation
- ❌ Directly place live orders
- ❌ Decide from raw hallucinated values
- ❌ Override reconciliation failures
- ❌ Modify risk limits

## Tool Policy (Future)

When implementing tool-calling:

Tools should be:

| Property | Requirement |
|----------|-------------|
| Read-only by default | No write tools without explicit approval |
| Schema validated | Zod validation on all inputs/outputs |
| Timeout constrained | Max 30s per tool call |
| Output bounded | Max tokens defined per tool |
| Logged | All tool calls logged with timing |

The agent must have a **finite iteration budget**:

```typescript
const MAX_ITERATIONS = 5; // Prevent infinite loops
```

## Required Output Schema

Prefer structured schema over free text:

```typescript
interface LLMSignal {
  decision: 'ENTER_LONG' | 'ENTER_SHORT' | 'WAIT' | 'NO_TRADE' | 'EXIT' | 'REDUCE' | 'ADD';
  symbol: string;
  confidence: number; // 0-1
  
  evidence: {
    structure?: string;      // e.g., "bullish BOS on 15m"
    liquidity?: string;      // e.g., "sell-side sweep complete"
    volume?: string;         // e.g., "above average on breakout"
    derivatives?: string;    // e.g., "funding neutral"
    location?: string;       // e.g., "retracing to discount"
    contradictions?: string; // e.g., "HTF bearish, LTF bullish"
  };
  
  entry?: {
    price: Decimal;
    stopPrice: Decimal;
    takeProfitPrice?: Decimal;
  };
  
  reason: string; // Short operational explanation
}
```

## Integration Points

Current integration:

```
src/market/setup/SetupEngine    → deterministic SMC candidate
  → TradingAgentsPipeline.runCycle(ctx)
      analyst → debate → verdict → trader   (LLM)
      → risk team → fund manager            (deterministic policy)
  → smc-agent.ts: DISCARD unless agentDirection === candidate.direction
  → TradeIntentEngine → RiskEngine → SignalExecutor → ExecutionRouter
```

**The pipeline's authority is a veto, not a decision.** The SMC engine produces
the candidate; the agents can only confirm or kill it. The LLM cannot originate
a trade, choose a symbol, set a stop, or size a position. If no model is
reachable, the debate resolves to `NEUTRAL` and no SMC trades occur.

Future integration:

```
Agent Loop
  → Select skill
  → Invoke tool (market data, positions, analysis)
  → Analyze evidence
  → Produce LLMSignal
  → Validate schema
  → Emit to StrategyEngine
```

## Hallucination Prevention

Strategies to prevent hallucination:

1. **Ground in verified data** - Pass actual MarketState, not summaries
2. **Require evidence fields** - Force explicit citation of data used
3. **Validate against reality** - Cross-check LLM claims with actual state
4. **Confidence scoring** - Require 0-1 confidence with justification
5. **Contradiction detection** - Ask LLM to identify conflicting signals
6. **Bounded reasoning** - Limit context window to relevant data only

## Implementation Locations

| Component | File | Status |
|-----------|------|--------|
| TradingAgentsPipeline | `src/ai/tradingAgents.ts` | ✅ Implemented |
| Structured output schemas | `src/ai/schemas.ts` | ✅ Implemented |
| SMC agent strategy | `src/strategy/strategies/smc-agent.ts` | ✅ Implemented |
| Deterministic risk policy | `src/ai/tradingAgents.ts` (`AgentRiskPolicy`) | ✅ Implemented |
| Circuit breaker around the pipeline | `src/strategy/strategies/smc-agent.ts` | ✅ Implemented (5 failures) |
| Agent memory across cycles | (not created) | ❌ Not implemented |
| MCP Integration | (not created) | ❌ Not implemented |
| Tool Framework | (not created) | ❌ Not implemented |

## Testing Requirements

Test these scenarios:

1. **Valid signal** - LLM produces conformant output
2. **Schema validation** - Reject malformed output
3. **Timeout** - Handle slow LLM responses
4. **Error handling** - Graceful failure on API error
5. **Hallucination check** - Verify claims against actual data
6. **Confidence calibration** - High confidence = high accuracy (measure over time)

## Output Format

When working with LLM integration:

```markdown
## LLM Integration Analysis

Component modified: [...]
Tool/skill affected: [...]
Output schema: [verified / needs update]

## Validation

Input grounding: [verified - uses actual MarketState]
Output validation: [Zod schema applied]
Hallucination checks: [describe]

## Tests Added

[Unit tests for signal generation and validation]
```

## Migration Path to Full Agent

To add agent capabilities without breaking existing signals:

1. Keep current `OllamaSignalGenerator` interface stable
2. Create `AgentLoop` class that uses it internally
3. Add tool definitions (market data, positions, etc.)
4. Implement skill selection logic
5. Add structured output parsing
6. Test agent path separately from simple signal path
7. Update PROJECT_STATE.md when complete
