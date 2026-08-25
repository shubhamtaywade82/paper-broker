# REST API Reference

Base URL: `http://localhost:8080` (configurable via `PORT`). All bodies are JSON.

---

## GET /health

Liveness probe.

```json
{ "status": "ok", "uptimeMs": 11095, "startedAt": "2026-08-20T10:31:56.408Z" }
```

---

## GET /account

Paper account summary.

```json
{
  "walletBalance": 9999.895348,
  "unrealizedPnl": 0,
  "equity": 9999.895348,
  "totalFees": 0.104652,
  "totalFunding": 0,
  "totalRealizedPnl": -0.034884,
  "availableBalance": 9999.895348,
  "dayStartEquity": 10000,
  "currentUtcDay": "2026-08-20",
  "dailyPnl": -0.104652
}
```

---

## GET /positions

Open positions.

```json
[
  {
    "accountId": "paper-main",
    "symbol": "SOLUSDT",
    "positionSide": "LONG",
    "status": "OPEN",
    "qty": 1,
    "entryPrice": 87.227442,
    "markPrice": 87.19,
    "unrealizedPnl": -0.037442,
    "realizedPnl": 0,
    "leverage": 5,
    "initialMargin": 17.445,
    "maintenanceMargin": 0.087,
    "totalFees": 0.0348909768,
    "totalFunding": 0,
    "openedAtUtc": "2026-08-20T10:37:32.123Z",
    "updatedAtUtc": "2026-08-20T10:37:33.000Z"
  }
]
```

---

## GET /orders?symbol=BTCUSDT

Open orders, optionally filtered by symbol.

```json
[
  {
    "id": "01M0FBZ4Q3SF...",
    "clientOrderId": "...",
    "symbol": "SOLUSDT",
    "side": "BUY",
    "type": "LIMIT",
    "status": "NEW",
    "quantity": 0.5,
    "filledQty": 0,
    "limitPrice": 86.5,
    "reduceOnly": false,
    "leverage": 5
  }
]
```

---

## GET /fills

Recent fills, newest first.

```json
[
  {
    "id": "01M0FBZ4QADB...",
    "orderId": "01M0FBZ4Q3SF...",
    "symbol": "SOLUSDT",
    "side": "BUY",
    "quantity": 1,
    "price": 87.227442,
    "notional": 87.227442,
    "fee": 0.0348909768,
    "feeAsset": "USDT",
    "liquidity": "TAKER",
    "realizedPnl": 0,
    "fillTsUtc": "2026-08-20T10:37:32.123Z"
  }
]
```

---

## GET /signals

Most recent strategy signals (limit 100).

```json
[
  {
    "id": "...",
    "strategyId": "ema-trend-5m",
    "symbol": "SOLUSDT",
    "action": "BUY",
    "confidence": 0.72,
    "status": "EXECUTED",
    "orderId": "01M0FBZ4Q3SF...",
    "reason": "EMA fast cross above slow with RSI above lower band",
    "createdAtUtc": "2026-08-20T10:35:00.000Z"
  }
]
```

---

## GET /metrics

Prometheus text-format metrics:

```
# TYPE orders_submitted_total counter
orders_submitted_total 3
# TYPE market_ticks_written_total counter
market_ticks_written_total 1240
```

---

## POST /orders

Submit an order to the paper broker.

Body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `symbol` | string | yes | e.g. `BTCUSDT`, `ETHUSDT`, `SOLUSDT` |
| `side` | `BUY` \| `SELL` | yes | |
| `type` | `MARKET` \| `LIMIT` \| `STOP_MARKET` \| `TAKE_PROFIT_MARKET` | yes | |
| `quantity` | number > 0 | yes | base-asset quantity |
| `price` | number | for LIMIT | limit price |
| `stopPrice` | number | for STOP/TP | trigger price |
| `reduceOnly` | boolean | no | reject if the fill would increase the position |
| `postOnly` | boolean | no | |
| `leverage` | integer > 0 | no | default 5 |
| `strategyId` | string | no | attribution |

Success (`201`):

```json
{ "id": "01M0FBZ4Q3SF...", "symbol": "SOLUSDT", "side": "BUY", "type": "MARKET", "status": "FILLED", "filledQty": 1, "avgFillPrice": 87.227442 }
```

Failure (`400`):

```json
{ "error": "INVALID_ORDER", "details": { "fieldErrors": { "quantity": ["Required"] } } }
{ "error": "ORDER_FAILED", "message": "Unknown instrument: FAKEUSDT" }
```

Rejected by the broker's risk checks (`400`):

```json
{ "id": "...", "status": "REJECTED", "rejectReason": "REDUCE_ONLY_WOULD_INCREASE" }
```

Common rejection reasons: `UNKNOWN_INSTRUMENT`, `NO_MARKET_STATE`, `STALE_MARKET_DATA`, `EXCEEDS_MAX_LEVERAGE`, `EXCEEDS_MAX_NOTIONAL`, `BELOW_MIN_NOTIONAL`, `REDUCE_ONLY_WOULD_INCREASE`, `INVALID_ORDER_TYPE`.

---

## POST /orders/cancel

Cancel one open order.

```json
{ "orderId": "01M0FBZ4Q3SF..." }
```

Success: returns the canceled order. `404` `{ "error": "ORDER_NOT_FOUND" }` if unknown.

---

## POST /orders/cancel-all

Cancel all open orders, optionally for one symbol.

```json
{ "symbol": "SOLUSDT" }   // optional; omit for all symbols
```

```json
{ "canceled": true, "symbol": "SOLUSDT" }
```

---

## POST /engine/start

Resume the scheduler (market-data processing, funding, snapshots).

```json
{ "started": true }
```

## POST /engine/stop

Pause the scheduler. API remains up for inspection.

```json
{ "stopped": true }
```

## POST /engine/kill-switch

Cancel all orders and stop the engine. Emergency stop.

```json
{ "killSwitch": true }
```

---

## GET /api/v1/dashboard

Consolidated operational snapshot for the dashboard (account, positions, recent signals, health, and incidents).

```json
{
  "mode": "shadow",
  "liveArmed": false,
  "realOrders": false,
  "account": { "walletBalance": 10000, "equity": 10000 },
  "positions": [],
  "signals": [],
  "health": {
    "uptimeMs": 45000,
    "activeProvider": "BINANCE",
    "binance": { "status": "HEALTHY", "latencyMs": 38, "stale": false },
    "coindcx": { "status": "HEALTHY", "latencyMs": 42, "stale": false }
  },
  "incidents": []
}
```

---

## GET /api/v1/health/providers

Provider connection and latency health matrix for Binance and CoinDCX.

```json
{
  "activeProvider": "BINANCE",
  "binance": { "status": "HEALTHY", "latencyMs": 38, "stale": false },
  "coindcx": { "status": "HEALTHY", "latencyMs": 42, "stale": false }
}
```

---

## GET /api/v1/incidents

Recent normalized incidents from the error pipeline with deduplicated occurrence counts.

```json
{
  "incidents": [
    {
      "incidentId": "INC-20260821-X9A21",
      "timestampUtc": "2026-08-21T07:12:00.000Z",
      "severity": "WARNING",
      "classification": "RECOVERABLE",
      "component": "BinanceWs",
      "message": "Stream reconnecting",
      "occurrenceCount": 1
    }
  ]
}
```

---

## POST /api/v1/mode/arm

Arm live trading mode (enables order routing to CoinDCX when `TRADING_MODE=live`).

```json
{ "passcode": "optional-token" }
```

```json
{ "armed": true }
```

---

## GET /api/v1/risk

Live risk state. All limits reflect the `RiskConfig` actually in force — they are
no longer hardcoded literals.

```json
{
  "riskRating": "LOW",
  "exposurePct": 12.4,
  "marginUsagePct": 2.5,
  "openPositionsCount": 1,
  "maxOpenPositions": 3,
  "dailyLossLimitPct": 3.0,
  "dailyLossRemainingPct": 3.0,
  "safeMode": false,
  "liveArmed": false,
  "mode": "paper",
  "limits": {
    "maxLeverage": 10,
    "maxRiskPerTradePct": 1.0,
    "maxAccountRiskPct": 5.0,
    "maxPositionsPerSymbol": 1,
    "maxNotionalPerTrade": 50000
  },
  "profitGoals": { "enabled": false },
  "quarantinedStrategies": []
}
```

---

## GET /api/v1/profit-goals

Returns `{ "enabled": false }` when `PROFIT_GOALS_ENABLED` is not set. Otherwise:

```json
{
  "enabled": true,
  "config": { "dailyTargetPct": 0.02, "targetAchievedAction": "REDUCE_RISK", "...": "..." },
  "state": { "dailyPnL": 250, "dailyTargetAchieved": true, "currentRiskMultiplier": 0.5, "...": "..." },
  "progress": { "dailyPct": 100, "weeklyPct": 31.25, "monthlyPct": 0 },
  "riskMultiplier": 0.5,
  "tradingAllowed": false,
  "metrics": { "daysTargetAchieved": 1, "totalDaysTraded": 1, "...": "..." }
}
```

`tradingAllowed: false` means `RiskEngine` will reject new signals with
`PROFIT_GOAL_TRADING_HALTED` until the cooldown expires or the window resets.

---

## GET /api/v1/strategies/performance

```json
{
  "enabled": true,
  "quarantined": ["adaptive-supertrend"],
  "strategies": [
    {
      "strategyId": "adaptive-supertrend",
      "trades": 24,
      "wins": 6,
      "losses": 18,
      "winRate": 0.25,
      "realizedPnl": -320.5,
      "peakPnl": 110.0,
      "drawdown": 430.5,
      "quarantined": true,
      "quarantineReason": "WIN_RATE_BELOW_FLOOR: 25.0% < 30.0%",
      "lastTradeAtUtc": "2026-08-25T14:02:11.000Z"
    }
  ]
}
```

A quarantined strategy stops receiving candles and ticks from `StrategyEngine`.

---

## POST /api/v1/strategies/:id/release

Requires `API_KEY` when configured. Lifts a quarantine and rebases the drawdown
baseline on current realized PnL. Release is always an operator action — the
system never re-enables a strategy on its own.

```bash
curl -X POST http://localhost:8080/api/v1/strategies/adaptive-supertrend/release \
  -H "Authorization: Bearer $API_KEY"
```

```json
{ "released": true, "strategyId": "adaptive-supertrend" }
```

`404` if performance tracking is disabled, or if the strategy is not quarantined.

---

## WebSocket Stream: `ws://localhost:8080/ws`

Event types include `market.tick`, `kline.closed`, `book.update`,
`trade.stream`, `order.updated`, `order.filled`, `position.updated`,
`signal.created`, `health.updated`, `incident.reported`, `mode.changed`,
`mode.aggressive`, `kill_switch.activated`, `agent.cycle`, `agent.step`,
`profit.goal`, `strategy.performance`, and `trailing.stop`.

`agent.step` payloads carry `engine: "llm" | "deterministic"` — the risk team
and fund manager stages are deterministic policy, not model output.


Real-time push events for the dashboard:

- `market.tick` — Price updates
- `signal.created` — Strategy and LLM setup detections
- `order.updated` — Order placement, fill, and cancellation updates
- `position.updated` — Position PnL and breakeven state changes
- `health.updated` — Provider status and failover events
- `incident.reported` — Normalized error alerts
- `mode.changed` — Mode and live arming state transitions
- `kill_switch.activated` — Emergency kill-switch trigger

---

## Errors

| Code | Meaning |
| --- | --- |
| `INVALID_ORDER` | Body failed schema validation (`400`) |
| `ORDER_FAILED` | Broker threw during submission (`400`) |
| `ORDER_NOT_FOUND` | Unknown order id on cancel (`404`) |
| `INVALID_REQUEST` | Body failed schema validation (`400`) |