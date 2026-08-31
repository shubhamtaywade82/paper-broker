# 08. Frontend Dashboard & Trading Terminal Mapping

**Target System:** `@nemesis-oss/paper-broker`  
**Frontend Stack:** React 19 / Vite / Tailwind CSS / Lightweight Charts / Zustand  

---

## 1. Trading Terminal & Portfolio UI Architecture

The frontend terminal in `dashboard/src/` replicates a high-performance exchange interface (CoinDCX / Binance layout):

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ [LOGO] Paper Broker Terminal    ● LIVE (Paper)  | Wallet: $10,240.50 | Equity: $10,480.20│
├──────────────────────────────────────┬─────────────────────────────────────────────────┤
│ PORTFOLIO OVERVIEW                   │ ASSET SEGREGATION                               │
│ Total Balance: ₹9,38,017.90 (USDT eq)│ [ Spot: ₹1,50,000 ] [ Futures: ₹7,50,000 ]      │
│ Active PnL:   +₹21,452.30 (+2.34%)   │ [ Options: ₹38,017 ] [ Earn: ₹0.00 ]            │
├──────────────────────────────────────┴─────────────────────────────────────────────────┤
│ TRADING TERMINAL — SOL/USDT Perpetual (5x Leverage)                                    │
│ ┌──────────────────────────────────────────────┬──────────────────┬──────────────────┐ │
│ │                                              │ ORDERBOOK (BBO)  │ ORDER ENTRY      │ │
│ │ Lightweight-Charts Candlestick & Overlays   │ Ask: 142.55 (25) │ [Buy/Long] [Sell]│ │
│ │ (Live Binance WebSockets 1m/5m/15m/1h)       │ Bid: 142.50 (40) │ Qty: [ 10.0 SOL] │ │
│ │                                              │ Spread: 0.05     │ Lev: [ 5x Slider]│ │
│ │ Indicators: Supertrend, SMC Zones, Orderflow │ Depth Imbalance: │ TP:  [ 155.00  ] │ │
│ │                                              │ +15.4% (Bullish) │ SL:  [ 138.00  ] │ │
│ └──────────────────────────────────────────────┴──────────────────┴──────────────────┘ │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ POSITIONS & ORDERS                                                                     │
│ [Open Positions (1)]  [Open Orders (2)]  [Futures History (24)]  [Ledger Journal]      │
│ ┌─────────┬──────┬────────┬────────────┬───────────┬──────────────┬──────────┬───────────┐│
│ │ Symbol  │ Side │ Size   │ Entry Price│ Mark Price│ Unr. PnL (%) │ Liq Price│ Action    ││
│ │ SOLUSDT │ LONG │ 10 SOL │ $140.00    │ $142.50   │ +$25.00 (+9%)│ $112.50  │ [Close Mkt]││
│ └─────────┴──────┴────────┴────────────┴───────────┴──────────────┴──────────┴───────────┘│
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. UI Component to Backend Data Source Mapping

| UI Area | React Component | Backend API & WebSocket Topics |
| :--- | :--- | :--- |
| **Top Navbar & Account State** | `dashboard/src/components/Header.tsx` | `/account` & WS topic `account.updated` |
| **Portfolio Overview Tab** | `components/dashboard/DashboardView.tsx` | `/api/v1/equity-curve`, `/api/v1/win-rate` |
| **Multi-Wallet Assets View** | `components/system/SystemSettingsView.tsx` | `/api/v1/wallets` & `/api/v1/wallets/transfer` |
| **Interactive Candlestick Chart** | `components/charts/TradingChart.tsx` | Binance REST Kline API + WS `market.tick` |
| **Order Entry Ticket** | `components/trading/TradingView.tsx` | `POST /orders` (with SL/TP brackets and leverage slider) |
| **Positions Table** | `components/trading/TradingView.tsx` | `/positions` & WS topic `position.updated` |
| **Open Orders Table** | `components/trading/TradingView.tsx` | `/orders` & `POST /orders/cancel` |
| **Futures History & Transactions**| `components/activity/ActivityView.tsx` | `/api/v1/history/transactions`, `/api/v1/fills` |
| **Autonomous AI Agent Panel** | `components/agent/AgentControlCenterView.tsx`| `/api/v1/autonomous/snapshot`, `/api/v1/agents/cycles` |

---

## 3. UI State Management (Zustand Stores)

1. **[`accountStore.ts`](file:///home/nemesis/project/trading-workspace/paper-broker/dashboard/src/stores/accountStore.ts):** Holds live `balance`, `equity`, `available`, `marginUsed`, `peakEquity`, and `dailyPnl`. Updated immediately on incoming WebSocket messages.
2. **[`tradingStore.ts`](file:///home/nemesis/project/trading-workspace/paper-broker/dashboard/src/stores/tradingStore.ts):** Manages active symbol, selected leverage, open orders, and positions.
3. **[`agentStore.ts`](file:///home/nemesis/project/trading-workspace/paper-broker/dashboard/src/stores/agentStore.ts):** Maintains agent debate transcripts, reflection memories, and regime classifications.

---

### Navigation
- Previous: [07. Fastify REST API & WebSocket Real-Time Gateway](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/07-api-and-websocket-gateway.md)
- Next: [09. Concurrency, Atomicity & Test-Driven Verification](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/09-concurrency-and-testing-strategy.md)
