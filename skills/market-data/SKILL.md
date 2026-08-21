---
name: market-data
description: Work with Binance market data safely.
---

# Market Data Skill

## Source of Truth

The exchange provider (Binance) is responsible for raw market-data truth.

This system normalizes raw payloads into canonical `MarketState` via `MarketStateManager`.

## Required Properties

Every market event should include:

| Property | Description |
|----------|-------------|
| `symbol` | Normalized symbol (e.g., `BTCUSDT`) |
| `provider` | Source provider (`binance`) |
| `eventTimestamp` | Exchange timestamp (ms) |
| `localTimestamp` | Local receive timestamp (ms) |
| `eventType` | `bookTicker` / `markPrice` / `kline` |
| `payload` | Typed payload based on event type |

## MarketState Structure

```typescript
interface MarketState {
  symbol: string;
  bid: Decimal;
  ask: Decimal;
  last: Decimal;
  mark: Decimal;
  fundingRate?: Decimal;
  nextFundingTime?: number;
  stale: boolean;
  lastUpdate: number; // ms
}
```

## Never

- ❌ Silently substitute stale data
- ❌ Invent missing values
- ❌ Mix symbols (ensure correct mapping)
- ❌ Mix spot and futures semantics
- ❌ Silently switch providers
- ❌ Treat fallback data as equivalent without validation

## Staleness Detection

Market state becomes stale when:

```typescript
const STALE_THRESHOLD_MS = 10_000; // 10 seconds

function isStale(state: MarketState): boolean {
  return Date.now() - state.lastUpdate > STALE_THRESHOLD_MS;
}
```

When stale:
1. Mark state as `stale: true`
2. Reject new signals with `STALE_MARKET_DATA`
3. Emit `MARKET_STALE` event
4. Do NOT use for fills

## Provider Failover (Future)

When implementing failover to CoinDCX or other providers:

Require before promotion:
- ✅ Health check passed
- ✅ Timestamps are fresh (< threshold)
- ✅ Symbol mapping is valid
- ✅ Price divergence is acceptable (< X%)
- ✅ Candle continuity is validated

Emit events:
- `ProviderDegraded`
- `ProviderFailed`
- `ProviderRecovered`
- `ProviderSwitched`

## Implementation Locations

| Component | File |
|-----------|------|
| WebSocket subscription | `src/binance/streams.ts` |
| Market state management | `src/market/state.ts` |
| Candle building | `src/market/candles.ts` |
| Kline persistence | `src/market/kline.ts` |

## Testing Requirements

Test these scenarios:

1. **Normal operation** - Updates arrive, state stays fresh
2. **Stale detection** - No updates → stale flag set
3. **Recovery** - Updates resume → stale flag cleared
4. **Symbol isolation** - BTCUSDT stale does not affect ETHUSDT
5. **Fill pricing** - Fills use current mark/ask/bid correctly

## Output Format

When working with market data:

```markdown
## Market Data Analysis

Component modified: [...]
Event types affected: [...]
Staleness handling: [verified / needs fix]

## Validation

Freshness threshold: [...]ms
Symbol mapping: [verified]
Provider isolation: [verified]

## Tests Added

[Unit test descriptions]
```
