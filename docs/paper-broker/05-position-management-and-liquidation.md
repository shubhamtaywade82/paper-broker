# 05. Position Management, Mark-to-Market & Liquidation

**Target System:** `@nemesis-oss/paper-broker`  
**Execution Runtime:** Node.js (TypeScript 5.x) / Fastify / SQLite (`better-sqlite3` WAL) / `decimal.js`  

---

## 1. Position Sizing & VWAP Entry Math

Positions in `paper-broker` maintain directional sign conventions ($+1$ for `LONG`, $-1$ for `SHORT`).

### 1.1 Volume-Weighted Average Price (VWAP) on Scale-In
When an incoming fill increases an existing position in the same direction:

$$\text{New Entry Price} = \frac{(\text{Existing Qty} \times \text{Existing Entry Price}) + (\text{Fill Qty} \times \text{Fill Price})}{\text{Existing Qty} + \text{Fill Qty}}$$

### 1.2 Partial Position Reductions & Realized PnL
When a fill partially reduces a position:
* **Entry Price:** Remains completely invariant.
* **Realized PnL:** Calculated exclusively on the closed portion:
  $$\text{Realized PnL} = \text{Closed Qty} \times (\text{Exit Price} - \text{Entry Price}) \times \text{Direction}$$
  $$\text{where } \text{Direction} = +1 \text{ for Long}, -1 \text{ for Short}$$

### 1.3 Position Flip Math
If an incoming fill exceeds the existing position size in the opposite direction:
1. Portion matching existing position closes the position to $0$, realizing PnL against original entry price.
2. Excess quantity opens a new position in the opposing direction with entry price equal to the fill price.

---

## 2. Continuous Mark-to-Market (MTM) Settlement

On every market tick delivered to [PaperBroker.onMarket()](file:///home/nemesis/project/trading-workspace/paper-broker/src/broker/PaperBroker.ts#L160-L180):

```typescript
// src/broker/PaperBroker.ts
for (const position of this.positions.values()) {
  if (position.qty === 0) continue;

  const markPrice = market?.mark ?? market?.last ?? position.entryPrice;
  position.markPrice = markPrice;

  // uPnL = qty * (markPrice - entryPrice)
  position.unrealizedPnl = D(position.qty).mul(D(markPrice).sub(position.entryPrice)).toNumber();

  const notional = D(Math.abs(position.qty)).mul(markPrice);
  position.initialMargin = notional.div(position.leverage).toNumber();
  position.maintenanceMargin = notional.mul(position.maintenanceMarginRate).toNumber();
}

const equity = D(this.walletBalance).add(totalUnrealizedPnl).toNumber();
const availableBalance = Math.max(0, D(equity).sub(totalInitialMargin).toNumber());
const marginRatio = equity > 0 ? totalMaintenanceMargin / equity : 0;
```

---

## 3. Cross-Margin vs. Isolated Margin

* **Cross-Margin Mode (Default):** All positions share total `walletBalance`. Unrealized profits on one symbol increase available margin to buffer losses on another.
* **Isolated Margin Mode:** Collateral is allocated per-position up to $\text{Initial Margin}$. Losses cannot breach the isolated collateral allocation.

---

## 4. Cross-Margin Liquidation Engine

When adverse market moves cause total account equity to fall to or below total maintenance margin:

$$\text{Liquidation Trigger Condition:} \quad \text{Equity} \le \text{Maintenance Margin}$$

### 4.1 Synthetic Order Execution Protocol (Contract C-04)

Rather than abruptly deleting positions, the broker routes liquidations through the standard order pipeline:

1. Flag `isLiquidating = true` is set.
2. System increments `liquidations` counter.
3. For each open position, a synthetic `MARKET` order is created:
   * `strategyId: 'LIQUIDATION'`
   * `reduceOnly: true`
   * `closePosition: true`
4. The order executes at current `markPrice`, incurring normal taker fees and generating standard `Fill` and `ORDER_FILLED` audit records.
5. All open orders on the account are canceled (`cancelAllOrders()`).
6. Position size resets to $0$, margin is unlocked, and an incident event is logged.

```typescript
// Liquidation execution path
const order: Order = {
  id: ulid(),
  clientOrderId: `liq-${ulid()}`,
  accountId: position.accountId,
  symbol: position.symbol,
  strategyId: 'LIQUIDATION',
  side: position.qty > 0 ? 'SELL' : 'BUY',
  type: 'MARKET',
  timeInForce: 'GTC',
  status: 'NEW',
  positionSide: position.positionSide,
  quantity: Math.abs(position.qty),
  filledQty: 0,
  avgFillPrice: 0,
  leverage: position.leverage,
  reduceOnly: true,
  postOnly: false,
  closePosition: true,
  submittedAtUtc: nowIso,
  updatedAtUtc: nowIso,
};

this.orders.set(order.id, order);
this.executeFill(order, Math.abs(position.qty), market.mark, 'TAKER', nowIso);
order.status = 'FILLED';
this.emitOrderEvent('ORDER_FILLED', order, { executionPrice: market.mark, reason: 'LIQUIDATION' });
```

---

## 5. Periodic 8-Hour Funding Rate Engine

At funding boundaries (00:00, 08:00, 16:00 UTC), funding payments are settled:

$$\text{Payment} = \text{Position Qty} \times \text{Mark Price} \times \text{Funding Rate}$$

* **Long Position (`qty > 0`):**
  * $\text{Funding Rate} > 0 \implies \text{Long pays Short}$ (Deducted from `walletBalance`).
  * $\text{Funding Rate} < 0 \implies \text{Long receives Funding}$ (Credited to `walletBalance`).
* **Short Position (`qty < 0`):**
  * $\text{Funding Rate} > 0 \implies \text{Short receives Funding}$ (Credited to `walletBalance`).
  * $\text{Funding Rate} < 0 \implies \text{Short pays Long}$ (Deducted from `walletBalance`).

Every funding event persists a `FundingPayment` row and emits an immutable `FUNDING` event to `EventLog`.

---

### Navigation
- Previous: [04. Order Management, Reservation & Matching Engine](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/04-order-matching-and-execution.md)
- Next: [06. SQLite Persistence, Schema & Hydration](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/06-sqlite-persistence-and-schema.md)
