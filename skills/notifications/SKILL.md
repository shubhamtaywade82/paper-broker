---
name: notifications
description: Implement Telegram and operational alerting.
---

# Notifications Skill

## Current State

**Notifications not implemented.**

No notification subsystem exists. Logging is via Pino only.

See KNOWN_LIMITATIONS.md for details.

## Severity Levels

All major runtime events should be publishable to `NotificationService`.

| Severity | When to Send | Examples |
|----------|--------------|----------|
| DEBUG | Never sent (local logs only) | Internal state dumps |
| INFO | Optional (user-configurable) | System startup, daily summary |
| WARNING | Sent by default | Provider degraded, high latency |
| ERROR | Sent | Order rejected, signal validation failed |
| CRITICAL | Sent immediately | Position closed at loss, reconciliation failure |
| FATAL | Sent immediately + page | System halt, database corruption |

## Events Requiring Notifications

### System Lifecycle

- ✅ SYSTEM_STARTED - Engine initialized
- ✅ SYSTEM_STOPPED - Graceful shutdown
- ❌ SYSTEM_FATAL - Unrecoverable error

### Provider Status

- ❌ PROVIDER_FAILED - WebSocket disconnected, health check failed
- ❌ PROVIDER_RECOVERED - Connection restored
- ❌ PROVIDER_SWITCHED - Failover occurred (future)

### Trading Events

- ❌ SIGNAL_EXECUTED - Signal accepted and orders submitted
- ❌ ORDER_SUBMITTED - Order placed with broker
- ❌ ORDER_FILLED - Order fully/partially filled
- ❌ POSITION_OPENED - New position established
- ❌ POSITION_CLOSED - Position exited (include P&L)
- ❌ STOP_LOSS_HIT - Position closed at stop
- ❌ TAKE_PROFIT_HIT - Position closed at target
- ❌ LIQUIDATION_WARNING - Position near liquidation (future live mode)

### Risk Events

- ❌ RISK_REJECTED - Signal rejected by risk checks
- ❌ DAILY_LOSS_LIMIT - Daily drawdown limit reached
- ❌ KILL_SWITCH_TRIGGERED - Trading halted

### Persistence Events

- ❌ PERSISTENCE_ERROR - Database write failed
- ❌ RECONCILIATION_FAILED - Exchange state mismatch (future live mode)

## Notification Interface

Future implementation:

```typescript
interface NotificationService {
  send(level: NotificationLevel, message: string, context?: object): Promise<void>;
  
  // Convenience methods
  systemStarted(): Promise<void>;
  orderFilled(fill: Fill): Promise<void>;
  positionClosed(position: Position, pnl: Decimal): Promise<void>;
  riskRejected(signal: Signal, reason: string): Promise<void>;
  providerFailed(provider: string, error: Error): Promise<void>;
}

type NotificationLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' | 'FATAL';
```

## Telegram Integration (Future)

Telegram provider should:

1. **Deduplicate** - Don't spam repeated incidents
2. **Correlate** - Include incident/event ID for tracking
3. **Rate limit** - Max N messages per minute
4. **Escape markdown** - Proper text formatting
5. **Handle failures** - Queue notifications if API fails

Example Telegram message:

```
🔴 CRITICAL: Position Closed

Symbol: BTCUSDT
Side: LONG
Entry: $67,500
Exit: $66,800
P&L: -$210.00 (-0.31%)
Reason: Stop loss hit
Time: 2025-01-XX 14:32:00 UTC

Incident: pos_close_01JXYZ123
```

## Implementation Locations

| Component | File | Status |
|-----------|------|--------|
| NotificationService | (not yet created) | ❌ Planned |
| TelegramProvider | (not yet created) | ❌ Planned |
| Event → Notification mapping | (not yet created) | ❌ Planned |

## Testing Requirements

Test these scenarios:

1. **Severity routing** - Each level routed correctly
2. **Deduplication** - Repeated incidents coalesced
3. **Rate limiting** - Flood prevention works
4. **Failure handling** - Queue on API error
5. **Formatting** - Markdown/text properly escaped
6. **Correlation IDs** - Present in all messages

## Output Format

When implementing notifications:

```markdown
## Notification Analysis

Event type: [...]
Severity: [DEBUG/INFO/WARNING/ERROR/CRITICAL/FATAL]
Provider: [Telegram/Email/etc]

## Message Template

[Draft of notification message format]

## Deduplication

Key for dedup: [incident ID / event type + symbol]
Window: [time window for coalescing]

## Tests Added

[Unit tests for routing, formatting, rate limiting]
```

## Migration Path

To add notifications:

1. Create `NotificationService` interface
2. Implement in-memory queue (no-op when no provider configured)
3. Add `TelegramProvider` implementation
4. Wire into event sinks (EventLog can emit notifications)
5. Add configuration (bot token, chat ID, severity filter)
6. Test with mock Telegram API
7. Update PROJECT_STATE.md when complete
