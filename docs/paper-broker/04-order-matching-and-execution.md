# 04. Order Management, Reservation & Matching Engine

**Target System:** `@nemesis-oss/paper-broker`  
**Execution Runtime:** Node.js (TypeScript 5.x) / Fastify / SQLite (`better-sqlite3` WAL) / `decimal.js`  

---

## 1. Supported Order Types & Execution Rules

The paper broker simulates the full spectrum of exchange order modalities:

| Order Type | Trigger Condition | Execution Mode | Liquidity Role | Default Slippage |
| :--- | :--- | :--- | :--- | :--- |
| `MARKET` | Immediate upon submission | Best Bid / Best Ask | `TAKER` | Configured `marketSlippageBps` (default 2 bps) |
| `LIMIT` | BUY: $\text{Ask} \le \text{LimitPrice}$<br>SELL: $\text{Bid} \ge \text{LimitPrice}$ | Order Limit Price | `MAKER` | 0 bps (Fills at limit price or better) |
| `STOP_MARKET` | BUY: $\text{Mark} \ge \text{StopPrice}$<br>SELL: $\text{Mark} \le \text{StopPrice}$ | Market order at trigger | `TAKER` | Configured `marketSlippageBps` |
| `TAKE_PROFIT_MARKET` | BUY: $\text{Mark} \le \text{StopPrice}$<br>SELL: $\text{Mark} \ge \text{StopPrice}$ | Market order at trigger | `TAKER` | Configured `marketSlippageBps` |
| `TRAILING_STOP_MARKET` | Trailing delta breached from peak mark | Market order at trigger | `TAKER` | Configured `marketSlippageBps` |

---

## 2. Pre-Flight Margin Reservation & Lock Mechanics

Before accepting an order into memory or database, the broker performs pre-flight validation:

1. **Notional & Sizing Check:**
   $$\text{Notional} = \text{Quantity} \times (\text{LimitPrice} \text{ or } \text{CurrentMark})$$
   $$\text{Assert } \text{Notional} \ge \text{Instrument.minNotional} \quad \text{and} \quad \text{Quantity} \ge \text{Instrument.minQty}$$

2. **Required Collateral Calculation:**
   $$\text{Required Margin} = \frac{\text{Notional}}{\text{Leverage}}$$
   $$\text{Estimated Fee} = \text{Notional} \times \text{TakerFeeRate}$$

3. **Available Capital Verification:**
   $$\text{Assert } \text{Available Balance} \ge \text{Required Margin} + \text{Estimated Fee}$$
   If false, the order is rejected immediately with reason `INSUFFICIENT_AVAILABLE_BALANCE`.

4. **Order Reservation Pool:**
   For resting `LIMIT` orders, collateral is locked in the order reservation pool to prevent double-spending across multiple simultaneous limit orders.

---

## 3. Real-Time Matching Engine

On every market tick received via WebSocket, [PaperBroker.evaluateOpenOrders()](file:///home/nemesis/project/trading-workspace/paper-broker/src/broker/PaperBroker.ts#L442-L465) evaluates all resting orders against real-time BBO:

```typescript
private evaluateOpenOrders(symbol: string): void {
  const market = this.getMarket(symbol);
  if (!market) return;

  for (const order of this.orders.values()) {
    if (order.symbol !== symbol) continue;
    if (order.status !== 'NEW' && order.status !== 'PARTIALLY_FILLED') continue;

    if (order.type === 'LIMIT') {
      if (this.isLimitMarketable(order, market)) {
        this.fillOrder(order, market, 'MAKER', new Date().toISOString());
      }
      continue;
    }

    if (order.type === 'STOP_MARKET' || order.type === 'TAKE_PROFIT_MARKET') {
      if (this.isStopTriggered(order, market)) {
        this.fillOrder(order, market, 'TAKER', new Date().toISOString());
      }
      continue;
    }
  }
}
```

---

## 4. Realistic Slippage Simulation Models

To accurately replicate live market execution drag, the broker supports four slippage models:

1. `NONE`: Fills exactly at the current bid/ask price.
2. `FIXED_TICKS`: Shifts fill price by $N$ tick sizes against the trader:
   $$\text{Fill Price}_{\text{BUY}} = \text{Ask} + (N \times \text{tickSize})$$
   $$\text{Fill Price}_{\text{SELL}} = \text{Bid} - (N \times \text{tickSize})$$
3. `BPS` (Basis Points - Default):
   $$\text{Fill Price}_{\text{BUY}} = \text{Ask} \times \left(1 + \frac{\text{SlippageBps}}{10,000}\right)$$
   $$\text{Fill Price}_{\text{SELL}} = \text{Bid} \times \left(1 - \frac{\text{SlippageBps}}{10,000}\right)$$
4. `VOLATILITY`: Dynamic slippage scaled proportionally to current ATR (Average True Range) and spread widening.

---

## 5. Maker / Taker Fee Schedule

* **Taker Fee (Default 0.04% / 4 bps):** Charged on `MARKET`, `STOP_MARKET`, `TAKE_PROFIT_MARKET`, and marketable limit fills.
* **Maker Fee (Default 0.02% / 2 bps):** Charged on passive resting `LIMIT` fills.
* **Calculation:**
  $$\text{Fee} = \text{Quantity} \times \text{Fill Price} \times \text{FeeRate}$$
* **Ledger Impact:** Deducted directly from `walletBalance` and recorded in `Fill.fee` and `Position.totalFees`.

---

## 6. Time-in-Force (TIF) Policies

* `GTC` (Good 'Til Canceled): Remains on the book until filled or explicitly canceled.
* `IOC` (Immediate Or Cancel): Fills any available quantity immediately; unfulfilled remainder is canceled immediately.
* `FOK` (Fill Or Kill): Entire quantity must fill immediately, otherwise the entire order is canceled.

---

### Navigation
- Previous: [03. Double-Entry General Ledger & Lifecycle Events](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/03-double-entry-ledger-and-events.md)
- Next: [05. Position Management, Mark-to-Market & Liquidation](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/05-position-management-and-liquidation.md)
