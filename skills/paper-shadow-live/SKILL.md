---
name: paper-shadow-live
description: Work with operating modes and runtime profiles.
---

# Operating Modes Skill

## Current State

**Only `paper` mode is implemented.**

Shadow and live modes are planned but not yet available.

See KNOWN_LIMITATIONS.md and PROJECT_STATE.md for details.

## Mode Definitions

### Paper Mode (Implemented)

```yaml
mode: paper
market_data: real (Binance WebSocket)
execution: simulated (PaperBroker)
account_state: simulated
orders: simulated fills
persistence: SQLite events
```

Characteristics:
- Real-time market data from Binance
- Orders filled by PaperBroker logic
- No exchange account integration
- Safe for testing strategies

### Shadow Mode (Planned)

```yaml
mode: shadow
market_data: real (Binance WebSocket)
execution: simulated (PaperBroker)
account_state: read-only (exchange query)
orders: simulated fills
reconciliation: periodic sync with exchange
```

Characteristics:
- Real-time market data
- Queries exchange for current positions/balance
- Simulates orders locally for comparison
- No actual order submission
- Useful for validating paper vs reality

### Live Mode (Planned)

```yaml
mode: live
market_data: real (Binance/CoinDCX WebSocket)
execution: real (ExchangeBroker)
account_state: authoritative (exchange)
orders: real exchange orders
reconciliation: mandatory after uncertainty
arm_state: explicit LIVE_ARMED=true required
```

Characteristics:
- Real-time market data
- Real order submission to exchange
- Exchange state is authoritative
- Requires explicit armed state beyond mode flag
- Full reconciliation required

## Mode Selection

**Single selector only:**

```bash
TRADING_MODE=paper  # or shadow, or live
```

Do NOT introduce independent boolean flags:

```bash
# ❌ Violation
PAPER_ENABLED=true
SHADOW_ENABLED=false
LIVE_ENABLED=false
COINDCX_EXECUTION_ENABLED=true
```

## Mode Capabilities Matrix

| Capability | Paper | Shadow | Live |
|------------|-------|--------|------|
| Market data | ✅ Real | ✅ Real | ✅ Real |
| Order submission | ❌ Simulated | ❌ Simulated | ✅ Real |
| Position query | Local only | Exchange read | Exchange authoritative |
| Balance query | Local only | Exchange read | Exchange authoritative |
| Reconciliation | N/A | Periodic | Mandatory |
| Arm state required | No | No | Yes |
| Event persistence | ✅ Yes | ✅ Yes | ✅ Yes |

## Implementation Requirements

### Mode Configuration

```typescript
interface TradingModeConfig {
  mode: 'paper' | 'shadow' | 'live';
  binanceTestnet: boolean;
  liveArmed: boolean; // Only relevant for live mode
}
```

### Mode Validation

On startup:

```typescript
function validateMode(config: TradingModeConfig): void {
  if (config.mode === 'live' && !config.liveArmed) {
    throw new Error('Live mode requires explicit arm state');
  }
  
  if (!['paper', 'shadow', 'live'].includes(config.mode)) {
    throw new Error(`Invalid mode: ${config.mode}`);
  }
}
```

### Broker Selection

```typescript
function selectBroker(config: TradingModeConfig): ExecutionBroker {
  switch (config.mode) {
    case 'paper':
      return new PaperBroker(...);
    case 'shadow':
      const exchangeBroker = new CoinDCXBroker(...);
      return new ShadowBroker(exchangeBroker, new PaperBroker(...));
    case 'live':
      if (!config.liveArmed) {
        throw new Error('Live mode not armed');
      }
      return new CoinDCXBroker(...);
    default:
      throw new Error(`Unknown mode: ${config.mode}`);
  }
}
```

## Invariants

1. **Changing mode must not require changing multiple environment variables** - One flag (`TRADING_MODE`) controls profile.

2. **Secrets remain available but mode determines capability** - API keys can exist in all modes, but only used when mode allows.

3. **Paper/live behavior divergence must be minimal** - Same interface, different implementation.

4. **Live mode requires explicit arm** - `TRADING_MODE=live` alone does not enable trading.

## Testing Requirements

Test these scenarios:

1. **Mode selection** - Each mode selects correct broker
2. **Invalid mode** - Throws on unknown mode value
3. **Live without arm** - Throws when liveArmed=false
4. **Paper isolation** - No exchange calls in paper mode
5. **Shadow reconciliation** - Periodic sync works
6. **Live reconciliation** - Mandatory after disconnect

## Output Format

When working with modes:

```markdown
## Mode Analysis

Current mode: [paper/shadow/live]
Changes required: [...]
Broker affected: [...]

## Validation

Mode flag: TRADING_MODE=[...]
Arm state: [required/not required]
Secrets usage: [none/read/execute]

## Tests Added

[Mode-specific test cases]
```

## Migration Path

To add shadow/live modes:

1. Define `ExecutionBroker` interface explicitly
2. Implement `CoinDCXBroker` for live execution
3. Implement `ShadowBroker` wrapping both
4. Add mode selection in composition root
5. Add arm state mechanism for live
6. Add reconciliation logic
7. Test each mode independently
8. Update PROJECT_STATE.md and KNOWN_LIMITATIONS.md
