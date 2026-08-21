---
name: risk-management
description: Implement and review trading risk controls.
---

# Risk Management Skill

Risk validation is authoritative over execution.

## Current State

**Status: Partial implementation**

Current risk controls exist in `SignalExecutor` (sizing logic) but a full `RiskEngine` is not yet implemented.

See KNOWN_LIMITATIONS.md for details.

## Required Validations

Risk must validate before any order reaches the broker:

### Pre-Execution Checks

| Check | Purpose | Current Status |
|-------|---------|----------------|
| Account equity | Sufficient collateral | ✅ Via sizing |
| Per-trade risk | Risk-per-trade vs stop distance | ✅ Via sizing |
| Position size | Max notional cap | ✅ Via sizing |
| Leverage | Max leverage allowed | ⏳ Planned |
| Daily loss | Daily drawdown limit | ❌ Not implemented |
| Symbol exposure | Max per-symbol notional | ❌ Not implemented |
| Open position limits | Max concurrent positions | ❌ Not implemented |
| Cooldowns | Strategy cooldown enforcement | ✅ Strategy-level |
| Stop-loss existence | Require SL on entry | ⏳ Partial |
| Stale market state | No fills on stale data | ✅ MarketStateManager |
| Kill-switch state | Global trading halt | ❌ Not implemented |

## Sizing Logic (Current)

```typescript
// SignalExecutor calculates size based on:
const riskAmount = accountBalance * (riskPerTrade / 100);
const stopDistance = entryPrice.minus(stopPrice).abs();
const qty = riskAmount.div(stopDistance);
const notional = qty.times(entryPrice);

// Capped by maxNotional
const finalQty = Decimal.min(qty, maxNotional.div(entryPrice));
```

## Future RiskEngine Interface

When implemented, RiskEngine should provide:

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
