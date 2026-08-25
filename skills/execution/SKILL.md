---
name: execution
description: Implement paper/live execution safely.
---

# Execution Skill

Execution is downstream of risk and signal validation.

## Current State

**PaperBroker is the only implementation.**

Live execution via CoinDCX or Binance is planned but not implemented.

See KNOWN_LIMITATIONS.md for details.

## Execution Flow

```
Signal
  → Validation (schema, expiry, conflicts)
  → Risk Check (sizing, limits)
  → Execution Plan (order type, brackets)
  → Broker.submitOrder()
  → Exchange/Paper matching
  → Fill events
  → Persistence
```

## PaperBroker Interface

The broker interface that strategies/executors use:

```typescript
interface ExecutionBroker {
  submitOrder(signal: Signal): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<CancelResult>;
  cancelAll(symbol?: string): Promise<CancelAllResult>;
  getOpenOrders(symbol?: string): OpenOrder[];
  getPositions(): Position[];
  getAccount(): AccountState;
  closePosition(symbol: string): Promise<CloseResult>;
}
```

## Order Types Supported

| Order Type | Paper Status | Live Status |
|------------|--------------|-------------|
| MARKET | ✅ Implemented | ✅ Via `CoinDCXBroker` (arm-gated) |
| LIMIT | ✅ Implemented | ✅ Via `CoinDCXBroker` (arm-gated) |
| STOP_MARKET | ✅ Implemented | ✅ Mapped to `stop_limit_order` |
| TAKE_PROFIT_MARKET | ✅ Implemented | ⚠️ Mapped to `market_order` by `CoinDCXBroker` |
| TRAILING_STOP | ⚠️ Emulated | ⚠️ Emulated |

`TRAILING_STOP` is not a native order type here. `TrailingStopController`
emulates it by cancelling and replacing a resting reduce-only `STOP_MARKET`
order as price moves in favour. The replacement is submitted **before** the
original is cancelled, so the position is never momentarily unprotected.

All order submission goes through `ExecutionRouter`, which applies the runtime
profile and `LiveTradingGuard`. An armed live profile with no usable adapter
rejects with `NO_LIVE_EXECUTION_ADAPTER` — it must never fall back to a
simulated fill.

## Never

- ❌ Retry an uncertain live write blindly
- ❌ Assume API response means fill
- ❌ Assume order state from local memory
- ❌ Submit duplicate orders after timeout
- ❌ Use stale market data for fills

## Live Uncertainty Handling (Future)

When implementing live execution:

If order submission state is unknown:

1. Mark execution `UNKNOWN`
2. Stop duplicate submission
3. Query exchange for order status
4. Reconcile internal state
5. Resume only after state is known

Never retry a live order without knowing if the first one filled.

## Paper/Live Parity

PaperBroker and future CoinDCXBroker/BinanceBroker should implement the same interface:

| Behavior | Paper | Live |
|----------|-------|------|
| Order submission | `submitOrder()` | `submitOrder()` |
| Market pricing | From MarketState | From exchange |
| Fill logic | Simulated | Exchange-determined |
| Fee tracking | Configured rates | Exchange rates |
| Funding | Simulated 8h | Exchange actuals |
| Event emission | Same events | Same events |

Strategies must not know which implementation is active.

## Order Result Schema

```typescript
interface OrderResult {
  success: boolean;
  orderId?: string;
  rejectedReason?: string;
  orders: {
    entry?: Order;
    stopLoss?: Order;
    takeProfit?: Order;
  };
  timestamp: number;
}
```

## Implementation Locations

| Component | File | Status |
|-----------|------|--------|
| PaperBroker | `src/broker/PaperBroker.ts` | ✅ Implemented |
| Signal Executor | `src/strategy/executor.ts` | ✅ Implemented |
| Live Broker | (not yet created) | ❌ Planned |
| Execution Router | (not yet created) | ❌ Planned |

## Testing Requirements

Test these scenarios:

### Paper Execution

1. **MARKET order** - Fills immediately at mark with slippage
2. **LIMIT order** - Rests until price crosses
3. **STOP_MARKET** - Triggers on stop price, fills at market
4. **TAKE_PROFIT_MARKET** - Triggers on TP price, fills at market
5. **Reduce-only** - Rejects if would increase position
6. **Insufficient balance** - Rejects with reason
7. **Min notional** - Rejects orders below minimum
8. **Max leverage** - Rejects excessive leverage

### Future Live Execution

9. **Reconciliation** - Queries exchange after disconnect
10. **Duplicate prevention** - Blocks double-submit
11. **Timeout handling** - Handles slow/missing responses
12. **Partial fills** - Tracks partial execution

## Output Format

When implementing execution logic:

```markdown
## Execution Analysis

Order type: [...]
Broker implementation: [PaperBroker / LiveBroker]
Market source: [MarketState / Exchange]

## Validation

Pre-checks performed: [...]
Rejection reasons: [...]
Event types emitted: [...]

## Tests Added

[Unit tests for execution paths and rejections]
```

## Migration Path to Live

To add live execution without breaking paper:

1. Define `ExecutionBroker` interface explicitly
2. Ensure PaperBroker implements it fully
3. Create `CoinDCXBroker` implementing same interface
4. Add `ExecutionRouter` to select broker by mode
5. Add reconciliation layer for live mode
6. Test paper and live paths independently
7. Update PROJECT_STATE.md when complete
