---
name: risk-management
description: Implement and review trading risk controls.
---

# Risk Management Skill

Risk validation is authoritative over execution.

## Current State

**Status: implemented.**

`RiskEngine` (`src/trading/risk/RiskEngine.ts`) is the authoritative gate. It is
constructed by `TradeIntentEngine`, which `smc-agent.ts` calls before any order
is built. Sizing lives in `PositionSizer`, not `SignalExecutor` — the executor
consumes pre-sized signals.

## Required Validations

Risk must validate before any order reaches the broker:

### Pre-Execution Checks

| Check | Purpose | Current Status |
|-------|---------|----------------|
| Account equity | Sufficient collateral | ✅ `PositionSizer` |
| Per-trade risk | Risk-per-trade vs stop distance | ✅ `PositionSizer` |
| Position size | Max notional cap | ✅ `maxNotionalPerTrade` |
| Leverage | Max leverage allowed | ✅ `maxLeverage` in `RiskConfig` |
| Daily loss | Daily drawdown limit | ✅ `DAILY_LOSS_LIMIT_REACHED` |
| Symbol exposure | Max per-symbol positions | ✅ `maxPositionsPerSymbol` |
| Open position limits | Max concurrent positions | ✅ `MAX_OPEN_POSITIONS_REACHED` |
| Account risk | Aggregate risk cap | ✅ `MAX_ACCOUNT_RISK_EXCEEDED` |
| Cooldowns | Cooldown enforcement | ✅ `COOLDOWN_ACTIVE` |
| Duplicate signals | Reject repeats | ✅ `DUPLICATE_SIGNAL` |
| Stop-loss existence | Require SL on entry | ✅ Agent risk personas reject a missing or wrong-side stop |
| Stale market state | No fills on stale data | ✅ `MarketStateManager` → `NO_MARKET_STATE` |
| Kill-switch state | Global trading halt | ✅ `POST /api/v1/kill_switch`; `LiveTradingGuard.triggerSafeMode()` |
| Profit-goal halt | Stop after target hit | ✅ `PROFIT_GOAL_TRADING_HALTED` |
| Strategy quarantine | Stop a losing strategy | ✅ `StrategyPerformanceTracker` |

**Still missing:** weekly/monthly *loss* limits (profit goals track gains), and
correlated exposure across symbols — each symbol is capped independently.

## Two independent gates

Do not collapse these:

1. **`AgentRiskPolicy`** (`src/ai/tradingAgents.ts`) bounds what the agent
   pipeline is willing to *propose* — per-persona leverage, size and confidence
   ceilings, stop validation, free-margin limits.
2. **`RiskConfig`/`RiskEngine`** (`src/trading/risk/`) independently
   re-validates whatever survives, before an order is built.

The agent policy is deliberately deterministic. CONTRACTS.md §5 forbids the LLM
from overriding risk checks, so routing risk approval through a model call is a
contract violation, not an improvement.

## Sizing Logic (Current)

`PositionSizer.calculatePositionSize()` takes equity, the effective
risk-per-trade fraction, entry and stop prices, and the instrument, and rounds
to the instrument's step size. The effective risk fraction is
`config.riskPerTradePct × profitGoalRiskMultiplier`, so an achieved profit
target automatically shrinks every subsequent position.

## RiskEngine Interface (as built)

```typescript
class RiskEngine {
  constructor(options?: RiskConfig | RiskEngineDeps);

  validateSignalRisk(
    signal: TradeSignal,
    account: AccountState,
    openPositions: PortfolioPosition[],
    instrument?: Instrument,
    existingSignalKeys?: Set<string>,
    cooldownSymbols?: Set<string>,
    timestamp?: number
  ): RiskCheckResult;
}
```

`RiskEngineDeps` carries an optional `ProfitGoalManager`. Passing a bare
`RiskConfig` is still supported for call sites that predate profit goals.

## Legacy interface sketch (not built this way)

The original design sketch, kept for reference:

```typescript
interface RiskEngine {
  // Validate before entry
  validateEntry(signal: Signal, account: Account): RiskResult;
  
  // Validate before exit
  validateExit(position: Position, signal: Signal): RiskResult;
  
  // Get current limits
  getLimits(): RiskLimits;
  
  // Update limits (admin only)
  updateLimits(limits: Partial<RiskLimits>): void;
  
  // Trigger kill switch
  triggerKillSwitch(reason: string): void;
  
  // Reset kill switch (admin only)
  resetKillSwitch(): void;
}

interface RiskResult {
  approved: boolean;
  reason?: string;
  adjustedQty?: Decimal;
  warnings: string[];
}
```

## Safe Failure Principle

If risk state is:
- Missing
- Stale
- Inconsistent
- Unavailable

Then: **NO NEW TRADE**

Never assume safe values or bypass checks.

## Error Categories

| Error Code | Meaning | Action |
|------------|---------|--------|
| `RISK_DAILY_LOSS_EXCEEDED` | Daily loss limit hit | Block new trades until reset |
| `RISK_POSITION_LIMIT` | Max position notional exceeded | Reduce size or reject |
| `RISK_SYMBOL_EXPOSURE` | Too much exposure to one symbol | Reject or reduce |
| `RISK_MAX_POSITIONS` | Too many open positions | Reject new entries |
| `RISK_KILL_SWITCH_ACTIVE` | Trading halted | Block all trades |
| `RISK_STALE_MARKET` | Market data stale | Reject until fresh |
| `RISK_INVALID_SIGNAL` | Signal missing required fields | Reject with details |

## Implementation Locations

| Component | File | Status |
|-----------|------|--------|
| Sizing logic | `src/strategy/executor.ts` | ✅ Implemented |
| Strategy cooldowns | `src/strategy/engine.ts` | ✅ Implemented |
| Market staleness | `src/market/state.ts` | ✅ Implemented |
| Full RiskEngine | (not yet created) | ❌ Planned |
| Kill switch | (not yet created) | ❌ Planned |

## Testing Requirements

Test these scenarios:

1. **Valid trade** - Passes all checks, approved
2. **Daily loss exceeded** - Rejected with code
3. **Position limit** - Rejected or size-adjusted
4. **Stale market** - Rejected with `STALE_MARKET_DATA`
5. **Kill switch active** - All trades blocked
6. **Missing stop-loss** - Rejected if required
7. **Cooldown active** - Signal rejected

## Output Format

When implementing risk controls:

```markdown
## Risk Control Analysis

Check implemented: [...]
Validation point: [pre-entry / pre-exit / both]
Rejection behavior: [...]

## Integration

Checks performed in: [component name]
Blocks execution: [yes/no]
Emits event: [event type]

## Tests Added

[Unit tests for approval and rejection paths]
```

## Migration Path

To add full RiskEngine without breaking existing functionality:

1. Create `RiskEngine` class with current sizing logic
2. Add new validations incrementally
3. Wire into SignalExecutor → Broker path
4. Add tests for each new check
5. Emit `RISK_EVENT` for all rejections
6. Document in PROJECT_STATE.md when complete
