# 07. Fastify REST API & WebSocket Real-Time Gateway

**Target System:** `@nemesis-oss/paper-broker`  
**Execution Runtime:** Node.js (TypeScript 5.x) / Fastify / WebSocketGateway  

---

## 1. REST API Endpoint Catalog

Implemented in [src/api/server.ts](file:///home/nemesis/project/trading-workspace/paper-broker/src/api/server.ts):

### 1.1 Account & Wallet Endpoints

| Method | Route | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/account` | Optional | Returns current `AccountState` (equity, balance, margin, peak, drawdown). |
| `GET` | `/api/v1/wallets` | Optional | Returns balance breakdown across Spot, Futures, Options, and Earn wallets. |
| `POST` | `/api/v1/wallets/transfer` | Required | Transfers capital between product wallets (`fromProduct`, `toProduct`, `amount`, `currency`). |

### 1.2 Trading & Orders Endpoints

| Method | Route | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/orders` | Optional | Lists open orders (`status IN ('NEW', 'PARTIALLY_FILLED')`), optional `?symbol=BTCUSDT`. |
| `POST` | `/orders` | Required | Submits an order (`CreateOrderSchema`: `symbol`, `side`, `type`, `quantity`, `price`, `stopPrice`, `leverage`). |
| `POST` | `/orders/cancel` | Required | Cancels an active order by `orderId`. |
| `POST` | `/orders/cancel-all` | Required | Cancels all active orders across all or a specific symbol. |

### 1.3 Positions & Risk Endpoints

| Method | Route | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/positions` | Optional | Lists open and recently closed positions with unrealized PnL and liquidation price. |
| `GET` | `/api/v1/risk` | Optional | Returns active risk limits, daily loss usage, and `LiveTradingGuard` status. |
| `POST` | `/api/v1/reconcile` | Required | Triggers exchange position and order reconciliation (in live mode). |

### 1.4 History & Analytics Endpoints

| Method | Route | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/history/transactions` | Optional | Returns paginated UI transactions (`OPEN_POSITION`, `CLOSE_POSITION`, `FUNDING`, `TRANSFER`). |
| `GET` | `/api/v1/history/pnl-summary` | Optional | Returns aggregated PnL grouped by timeframe (`7D`, `30D`, `FY27`, `ALL`). |
| `GET` | `/api/v1/fills` | Optional | Returns fill audit trail with execution price, fees, and slippage. |
| `GET` | `/api/v1/journal` | Optional | Returns SMC Trade lifecycle records with MFE/MAE tracking. |
| `GET` | `/api/v1/equity-curve` | Optional | Returns historical equity series for chart rendering. |

---

## 2. Real-Time WebSocket Gateway Protocol

Connect via `ws://127.0.0.1:8080/ws`.

```typescript
export interface WebSocketMessage<T = unknown> {
  topic: 
    | 'order.updated' 
    | 'position.updated' 
    | 'account.updated' 
    | 'market.tick' 
    | 'trade.trace' 
    | 'agent.step' 
    | 'incident.created';
  data: T;
  timestamp: number;
}
```

### 2.1 Broadcast Topic Specifications

1. `order.updated`: Broadcast on order state transitions (`ORDER_ACCEPTED`, `ORDER_FILLED`, `ORDER_CANCELED`, `ORDER_REJECTED`).
2. `position.updated`: Broadcast when a position changes size, entry price, or recalculates unrealized PnL.
3. `account.updated`: Broadcast on every mark-to-market tick updating equity, available balance, or margin ratio.
4. `trade.trace`: Emitted when an autonomous SMC trade updates MFE/MAE or hits a take-profit/stop-loss bracket.

---

## 3. Rate Limiting & Control Plane Priority (Contract §20)

Implemented via [RateLimiter](file:///home/nemesis/project/trading-workspace/paper-broker/src/api/RateLimiter.ts):

* **Read Tier:** 120 requests/minute token bucket.
* **Control Tier (`/orders`, `/orders/cancel`, `/mode/arm`, `/reconcile`):** Isolated 60 requests/minute bucket.
* **Fail-Open Invariant:** If the rate limiter errors internally, requests pass through unimpeded to prevent locking out operators during emergencies.

---

### Navigation
- Previous: [06. SQLite Persistence, Schema & Hydration](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/06-sqlite-persistence-and-schema.md)
- Next: [08. Frontend Dashboard & Trading Terminal Mapping](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/08-frontend-terminal-mapping.md)
