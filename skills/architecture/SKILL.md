---
name: architecture
description: Implement and review system architecture without violating boundaries.
---

# Architecture Skill

## Canonical Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                     Market Providers                             │
│  ┌──────────────┐  ┌──────────────┐                             │
│  │   Binance    │  │  CoinDCX     │ (future)                    │
│  └──────┬───────┘  └──────┬───────┘                             │
└─────────┼─────────────────┼──────────────────────────────────────┘
          │                 │
          ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Market Data Layer                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              MarketStateManager                           │   │
│  │  - Normalizes provider-specific payloads                  │   │
│  │  - Tracks staleness                                       │   │
│  │  - Serves canonical MarketState                           │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Strategy Layer                                 │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐     │
│  │  SMA Crossover │  │  RSI Strategy  │  │  Ollama Trend   │     │
│  └────────┬───────┘  └────────┬───────┘  └────────┬────────┘     │
│           └───────────────────┴───────────────────┘               │
│                           │                                       │
│                           ▼                                       │
│                  Signal Output (BUY/SELL/HOLD)                    │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Signal Executor                                  │
│  - Validates signal (schema, expiry, conflicts)                 │
│  - Calculates size (risk-per-trade, stop distance)              │
│  - Attaches brackets (stop-loss, take-profit)                   │
│  - Submits to Broker                                            │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PaperBroker                                   │
│  - Owns all trading state (orders, fills, positions, balance)   │
│  - Matches orders against market state                          │
│  - Applies fees, funding                                        │
│  - Emits events via EventLog                                    │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Persistence                                    │
│  - EventLog (append-only events table + JSONL)                  │
│  - BrokerPersister (UPSERT orders/fills/positions)              │
│  - SnapshotStore (account snapshots, market ticks)              │
└─────────────────────────────────────────────────────────────────┘
```

## Rules

1. **Strategy is exchange-agnostic** - Strategies consume normalized `MarketState`, not raw WebSocket payloads.

2. **Agent is broker-agnostic** - LLM produces signals only; it does not know about broker implementation.

3. **Broker is strategy-agnostic** - PaperBroker processes any valid signal; it does not know which strategy produced it.

4. **Exchange SDKs remain exchange-specific** - Provider-specific code lives in adapters (`src/binance/`).

5. **Domain events are provider-neutral** - Events use canonical types, not exchange-specific schemas.

6. **Runtime configuration selects operating mode** - `TRADING_MODE` controls behavior, not hardcoded paths.

7. **No direct exchange access from strategy code** - Strategies go through `MarketStateManager`.

8. **No direct live order access from LLM code** - LLM produces signals that flow through validation.

## Review Questions

Before approving an architectural change, ask:

| Question | Red Flag |
|----------|----------|
| Does this introduce exchange coupling? | Strategy imports `@nemesis-oss/binance-sdk` |
| Does this bypass a safety boundary? | Order submitted without validation |
| Does this create duplicated state? | Two sources of truth for positions |
| Does this introduce another source of truth? | Position tracked outside broker |
| Does this make replay harder? | Events not captured |
| Does this make paper/live behavior diverge? | Different logic paths per mode |

## Import Boundaries

Enforce these import restrictions:

| Package | Cannot Import |
|---------|---------------|
| `src/strategy/**` | `src/broker/**`, `@nemesis-oss/binance-sdk` |
| `src/ai/**` | `src/broker/**`, `src/execution/**` |
| `src/api/**` | Exchange SDKs (except via broker interface) |
| `src/market/**` | `src/strategy/**`, `src/broker/**` |

## Change Impact Analysis

When modifying architecture:

1. **Identify affected layers** - Which boxes in the diagram change?

2. **Check contracts** - Does this violate CONTRACTS.md?

3. **Update documentation** - ADR required for material changes.

4. **Test boundaries** - Add tests for layer isolation.

5. **Verify composition** - Check `src/engine.ts` wiring still works.

## Output Format

After architectural review:

```markdown
## Architecture Review

Layers affected: [...]
Import violations found: [none / list]
Contract violations: [none / list]

## Required Changes

Files to modify: [...]
New abstractions needed: [...]
Deprecated code: [...]

## Migration Plan

(if applicable)
1. ...
2. ...
3. ...

## Tests Required

Boundary tests: [...]
Integration tests: [...]
```
