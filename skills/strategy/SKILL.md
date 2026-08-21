---
name: strategy
description: Implement event-driven trading strategies.
---

# Strategy Skill

Strategies must operate on structured market state and emit typed signals.

## Core Sequence

```
Market Event
  → Feature Update
  → Structure Update (if applicable)
  → Liquidity Update (if applicable)
  → Setup Detection
  → Signal Emission (BUY/SELL/HOLD/CANCEL_ALL)
```

## Strategy Responsibilities

### A Strategy DOES:

- ✅ Detect setups based on market state
- ✅ Produce evidence (structure, indicators, patterns)
- ✅ Define entry conditions
- ✅ Define invalidation conditions
- ✅ Define targets (optional)
- ✅ Classify direction (long/short/neutral)
- ✅ Emit typed signals with required metadata

### A Strategy does NOT:

- ❌ Place orders directly
- ❌ Hold exchange credentials
- ❌ Bypass signal validation
- ❌ Invoke broker methods
- ❌ Access exchange SDKs directly
- ❌ Know about execution mode (paper/live)

## Signal Schema

All signals must conform to:

```typescript
interface Signal {
  id: string;           // ULID
  strategy: string;     // Strategy name
  symbol: string;       // e.g., 'BTCUSDT'
  action: 'BUY' | 'SELL' | 'HOLD' | 'CANCEL_ALL';
  timestamp: number;    // Epoch ms
  expiry?: number;      // Optional expiry ms
  timeframe: string;    // e.g., '5m', '15m'
  price?: Decimal;      // Reference price
  stopPrice?: Decimal;  // Stop-loss price (optional)
  takeProfitPrice?: Decimal; // Take-profit (optional)
  confidence?: number;  // 0-1 confidence score
  reason: string;       // Human-readable explanation
}
```

## Direction Symmetry

Long and short implementations should share primitives:

| Long | Short | Shared Primitive |
|------|-------|------------------|
| Sell-side sweep | Buy-side sweep | `detectLiquiditySweep(direction)` |
| Bullish CHoCH/BOS | Bearish CHoCH/BOS | `detectStructuralBreak(direction)` |
| Bullish displacement | Bearish displacement | `detectDisplacement(direction)` |
| Discount/retest | Premium/retest | `findRetracementLevel(direction)` |

## Required Signal Metadata

Every signal must include:

| Field | Purpose |
|-------|---------|
| `strategy` | Attribution and cooldown tracking |
| `symbol` | Routing and conflict detection |
| `action` | Execution decision |
| `timeframe` | Context for analysis |
| `reason` | Audit trail and debugging |
| `timestamp` | Expiry and ordering |

## Conflict Rules

Signals conflict when:

1. Same symbol + opposite actions (BUY vs SELL)
2. Same symbol + both unexpired
3. Same strategy + cooldown not elapsed

The StrategyEngine rejects conflicting signals.

## Implementation Pattern

```typescript
class MyStrategy {
  constructor(
    private marketState: MarketStateManager,
    private config: StrategyConfig
  ) {}

  async onCandleClose(candle: Candle): Promise<Signal | null> {
    // 1. Gather evidence
    const state = this.marketState.getState(candle.symbol);
    if (!state || isStale(state)) return null;

    // 2. Run analysis
    const setup = this.detectSetup(candle, state);
    if (!setup) return null;

    // 3. Build signal
    return {
      id: generateUlid(),
      strategy: 'my-strategy',
      symbol: candle.symbol,
      action: setup.direction === 'long' ? 'BUY' : 'SELL',
      timestamp: Date.now(),
      timeframe: this.config.timeframe,
      price: state.mark,
      stopPrice: setup.invalidatesAt,
      reason: setup.reason,
    };
  }
}
```

## Testing Requirements

Test these scenarios:

1. **No setup** - Returns HOLD or null
2. **Valid setup** - Returns BUY/SELL with correct metadata
3. **Stale market** - Returns null / no signal
4. **Conflict detection** - Opposing signal rejected
5. **Expiry** - Expired signal not executed
6. **Cooldown** - Rapid signals throttled

## Output Format

When implementing/modifying a strategy:

```markdown
## Strategy Analysis

Strategy name: [...]
Setup type: [...]
Timeframe: [...]

## Signal Characteristics

Action types emitted: [BUY/SELL/HOLD]
Required metadata: [...]
Validation rules: [...]

## Tests Added

[Unit test descriptions for setup detection, conflicts, expiry]
```
