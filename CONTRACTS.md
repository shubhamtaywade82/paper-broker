# CONTRACTS.md

## Architectural Contracts

These are the non-negotiable invariants that define this system's architecture.
**Do not change these without creating an ADR and updating PROJECT_STATE.md.**

---

## 1. Execution Contract

**Strategy never places orders directly.**

Strategies produce signals (BUY/SELL/HOLD/CANCEL_ALL). The SignalExecutor owns:
- Sizing calculation
- Risk validation
- Order type selection
- Bracket order attachment
- Submission to broker

```typescript
// ✅ Correct
strategy.emit({ action: 'BUY', symbol: 'BTCUSDT', ... });
executor.process(signal); // handles sizing, validation, submission

// ❌ Violation
broker.submitOrder({ ... }); // called directly from strategy
```

---

## 2. Broker Ownership Contract

**PaperBroker owns all trading state mutation.**

No strategy, scheduler, signal executor, or API handler may directly mutate:
- Orders
- Fills
- Positions
- Account balance

All state changes flow through broker methods and emit events via EventLog.

---

## 3. Market Data Truth Contract

**Market data owns price truth.**

All fills must be priced off current market state (bid/ask/last/mark).
Stale or missing market data causes `NO_MARKET_STATE` / `STALE_MARKET_DATA` rejection.

Never invent prices when market data is unavailable.

```typescript
// ✅ Correct
if (!marketState || isStale(marketState)) {
  return reject(signal, 'NO_MARKET_STATE');
}
const fillPrice = marketState.mark;

// ❌ Violation
const fillPrice = signal.price || lastKnownPrice || 0; // invented
```

---

## 4. Event Log Contract

**The event log is append-only and immutable.**

The `events` table and `events.jsonl` stream are the source of truth for history.
Events are never updated or deleted after insertion.

Queryable tables (`orders`, `fills`, `positions`) are UPSERTed mirrors maintained by BrokerPersister.

---

## 5. LLM Authority Contract

**LLM produces intent, not authority.**

The LLM (via OllamaSignalGenerator) may:
- Analyze market data
- Produce BUY/SELL/HOLD signals
- Provide reasoning

The LLM may NOT:
- Submit orders directly
- Bypass signal validation
- Override risk checks
- Modify position state

---

## 6. Live Execution Contract

**Live mode requires explicit arm state.**

`TRADING_MODE=live` selects the live profile but does NOT automatically enable live order submission.

`LIVE_TRADING_ARMED=true` is required before any order reaches a real exchange,
and is enforced by `LiveTradingGuard` inside `ExecutionRouter`.

**Live execution is never simulated.**

If the profile demands real orders but no usable live adapter is available —
no adapter registered, or missing `COINDCX_API_KEY`/`COINDCX_API_SECRET` — the
router MUST reject the order with `NO_LIVE_EXECUTION_ADAPTER`. It MUST NOT fall
through to the paper broker. A simulated fill reported as live execution would
make every downstream number (PnL, equity, risk state) fiction presented as
real, which is worse than refusing to trade.

Reconciliation with exchange state is mandatory after:
- Startup ✅ enforced by `ExchangeReconciler`
- Reconnect ✅ enforced by `ExchangeReconciler`
- Timeout on write ⚠️ trigger defined (`WRITE_TIMEOUT`), not yet called
- Provider recovery ⚠️ trigger defined (`PROVIDER_RECOVERY`), not yet called

Unknown order state blocks duplicate submission: a failed or mismatched
reconciliation trips `LiveTradingGuard` into safe mode, and `ExecutionRouter`
rejects every submission while it is set. Safe mode clears only through
`POST /api/v1/reconcile` on a clean re-run — never automatically, because the
system cannot know which side of a disagreement was right.

---

## 7. Mode Selection Contract

**TRADING_MODE is the single operational profile selector.**

Mode is controlled by one environment variable:

```bash
TRADING_MODE=paper|shadow|live
```

Do NOT introduce independent boolean flags:
- ❌ PAPER_ENABLED
- ❌ SHADOW_ENABLED
- ❌ LIVE_ENABLED
- ❌ COINDCX_EXECUTION_ENABLED

Secrets belong in environment variables. Mode-dependent behavior belongs in mode profiles.

---

## 8. Signal Validation Contract

**All signals require validation before execution.**

Validation includes:
- Schema validation (Zod)
- Expiry check
- Conflict detection (no opposing open signals for same symbol)
- Cooldown enforcement
- Market state availability

Invalid signals are rejected with explicit reason, never silently dropped.

---

## 9. Persistence Contract

**Database owns audit trail.**

Every state transition is:
1. Emitted as an event to EventLog
2. Appended to `events` table (immutable)
3. Appended to `events.jsonl` stream
4. UPSERTed to queryable tables by BrokerPersister

Broker memory is live state; database is persistent history.

---

## 10. Strategy Agnosticism Contract

**Strategy code is broker-agnostic.**

Strategies must not:
- Import broker implementation details
- Know whether execution is paper or live
- Access exchange SDKs directly
- Assume specific order types exist

Strategies consume normalized market state and emit typed signals only.

---

## 11. Notification Contract (Future)

**Critical execution/system failures generate alerts.**

Notification severity levels:
- DEBUG - internal debugging (not sent)
- INFO - informational (optional)
- WARNING - attention needed (sent)
- ERROR - failure occurred (sent)
- CRITICAL - trading impacted (sent immediately)
- FATAL - system halted (sent immediately)

Notifications MUST include incident/event identifier for correlation.

---

## 12. Error Classification Contract

**Errors are normalized and classified.**

Error categories:
- `VALIDATION_ERROR` - signal/order failed validation
- `MARKET_ERROR` - stale/missing market data
- `RISK_ERROR` - risk limits exceeded
- `EXECUTION_ERROR` - broker/internal failure
- `PERSISTENCE_ERROR` - database failure
- `PROVIDER_ERROR` - exchange/WebSocket failure

Each error category has defined handling and alerting behavior.

---

## 13. Timestamp Contract

**All timestamps are UTC.**

- Epoch milliseconds (integers) for internal computation
- ISO-8601 UTC strings for persistence and APIs

No timezone ambiguity is permitted.

---

## 14. Monetary Precision Contract

**Money uses decimal arithmetic.**

- Runtime: `decimal.js` `Decimal` values
- Database: decimal strings
- Never: float comparison for monetary values

```typescript
// ✅ Correct
const pnl = position.qty.times(closePrice.minus(entryPrice));

// ❌ Violation
const pnl = qty * (close - entry); // float arithmetic
```

---

## 15. Decoupled Execution & Market Data Contract (ADR 0002)

**Market data source, strategy intelligence, and execution venues are strictly decoupled.**

- Strategy & Risk engines consume normalized canonical domain events only.
- Strategy never references exchange-specific pair syntax or exchange SDKs.
- `ExecutionBroker` interface abstracts `PaperBroker` and `CoinDCXBroker`.
- The system explicitly distinguishes `signalVenue` (market structure source) from `executionVenue` (order destination).

---

## 16. Feed Continuity & Failover Guard Contract (ADR 0002)

**Failover to fallback data feeds requires multi-factor validation.**

Failover from Binance to CoinDCX must NOT occur on single packet loss. Promotion of fallback feed requires:
- Verified provider connection health & latency.
- Fresh timestamps without drift.
- Valid canonical symbol mapping.
- Price divergence within configured threshold ($\Delta \text{price} \le \text{divergenceLimit}$).
- Candle continuity validation.

Cross-exchange divergence above threshold triggers `MARKET_DATA_DIVERGENCE` and halts new entries.

---

## 17. Uncertain Execution State Reconciliation Contract (ADR 0002)

**Never retry or failover uncertain write operations blindly.**

If an order submission or cancellation times out or returns an indeterminate status:
1. Mark execution state `UNKNOWN`.
2. Stop new order submissions on affected symbols.
3. Query the exchange and reconcile positions and open orders.
4. Resume execution only after exchange state is authoritatively confirmed.

---

## 18. Execution Routing Contract

**Every order submission goes through `ExecutionRouter`.**

No component may hold a direct reference to a concrete broker for the purpose
of submitting orders. `SignalExecutor` and any future order-submitting
component accept `ExecutionBroker`, and `engine.ts` supplies the router.

Read paths (positions, account, instruments) may address the paper broker
directly — it owns the simulated ledger — but writes must not.

---

## 19. Observer Isolation Contract

**Observers must never break execution.**

`PaperBrokerConfig.onFill` and equivalent hooks are notification channels for
non-authoritative consumers (profit goals, performance tracking, telemetry). A
throwing observer MUST NOT abort the fill path after the ledger has been
updated. The broker isolates the call and records the failure.

Observers MUST NOT mutate broker state.

---

## 20. Rate Limiting Contract

**Read and control budgets are independent.**

A client exhausting the read budget MUST still be able to reach control
endpoints. An operator hitting the kill switch during an incident is exactly
when the dashboard is polling hardest, and a shared bucket would lock them out
at the worst possible moment.

The limiter MUST fail open on its own internal error. A rate limiter that takes
the API down is worse than no rate limiter.

---

## 21. Performance Feedback Contract

**Quarantine is automatic; release is not.**

`StrategyPerformanceTracker` may stop a strategy from trading when it breaches
its configured drawdown or win-rate limits. It MUST NOT re-enable a strategy on
its own: a strategy that "recovers" after being shut off has not demonstrated
anything, because it stopped trading. Release is an operator action
(`POST /api/v1/strategies/:id/release`) and is recorded.

Quarantine state MUST survive a restart, or bouncing the process would silently
re-enable a strategy that was shut off for losing money.

---

## Enforcement

Violations of these contracts MUST be caught by:
1. Architecture tests (import boundaries)
2. Code review
3. ESLint rules (when implemented)
4. Runtime guards

If you discover a contract violation in existing code:
1. Document it in KNOWN_LIMITATIONS.md
2. Fix it in a dedicated commit with tests
3. Do not introduce new violations while fixing old ones

---

## Change Process

To modify a contract:

1. Create ADR in `docs/decisions/` explaining:
   - Current contract
   - Proposed change
   - Rationale
   - Impact analysis
   - Migration plan

2. Update this file

3. Update PROJECT_STATE.md if capabilities change

4. Update KNOWN_LIMITATIONS.md if temporary violations exist during migration

5. Implement changes with tests

6. Get explicit approval before merging
