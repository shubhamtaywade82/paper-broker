# 02. Multi-Wallet Architecture & Dual-Currency Accounting

**Target System:** `@nemesis-oss/paper-broker`  
**Execution Runtime:** Node.js (TypeScript 5.x) / Fastify / SQLite (`better-sqlite3` WAL) / `decimal.js`  

---

## 1. Segregated Product Wallets

To accurately simulate modern multi-product exchanges (such as CoinDCX, Binance, or Bybit), user capital is segregated into dedicated wallets under a single master `Account`.

```text
                                  ┌───────────────────────────┐
                                  │      Account (Master)     │
                                  │  ID: "acc_usr_paper_01"   │
                                  │  Base Currency: "USDT"    │
                                  └─────────────┬─────────────┘
                                                │
         ┌──────────────────────┬───────────────┴──────────────┬──────────────────────┐
         ▼                      ▼                              ▼                      ▼
┌──────────────────┐  ┌──────────────────┐           ┌──────────────────┐  ┌──────────────────┐
│   Spot Wallet    │  │  Futures Wallet  │           │  Options Wallet  │  │   Earn Wallet    │
│  Type: 'SPOT'    │  │ Type: 'FUTURES'  │           │ Type: 'OPTIONS'  │  │  Type: 'EARN'    │
│──────────────────│  │──────────────────│           │──────────────────│  │──────────────────│
│ USDT: Free/Locked│  │ USDT: Collateral │           │ USDT: Collateral │  │ USDT: Staked     │
│ BTC:  Free/Locked│  │ Initial Margin   │           │ Option Contracts │  │ Yield Accrued    │
│ ETH:  Free/Locked│  │ Maint. Margin    │           │ Premium Locked   │  │ Auto-Compound    │
│ INR:  Fiat Cash  │  │ Unrealized PnL   │           │ Expiry PnL       │  │ Fixed / Flexible │
└──────────────────┘  └──────────────────┘           └──────────────────┘  └──────────────────┘
```

### 1.1 Spot Wallet (`productType: 'SPOT'`)
* **Core Function:** Direct token ownership and spot exchange trading.
* **Balance Model:** Distinct `(asset, free, locked)` tuples for each token (`USDT`, `BTC`, `ETH`, `SOL`, `INR`).
* **Locking Rules:**
  * **Limit Buy:** Locks quote currency amount: $\text{Locked Quote} = \text{Price} \times \text{Quantity} \times (1 + \text{TakerFeeRate})$.
  * **Limit Sell:** Locks base currency amount: $\text{Locked Base} = \text{Quantity}$.
  * **Settlement:** On execution, locked funds are deducted, and the acquired asset is credited to the `free` balance.

### 1.2 Futures Wallet (`productType: 'FUTURES'`)
* **Core Function:** USDT-Margined Perpetual and Delivery Futures.
* **Balance Model:** Collateral held in `USDT` (or `INR` on localized fiat-first accounts).
* **Key Mathematical Formulas:**
  1. **Wallet Balance:**
     $$\text{Wallet Balance} = \text{Starting USDT} + \sum \text{Realized PnL} - \sum \text{Fees} - \sum \text{Funding}$$
  2. **Unrealized PnL:**
     $$\text{Unrealized PnL} = \sum \left[ \text{Position Qty} \times (\text{Mark Price} - \text{Entry Price}) \right]$$
  3. **Total Margin Balance (Equity):**
     $$\text{Equity} = \text{Wallet Balance} + \text{Unrealized PnL}$$
  4. **Initial Margin Required:**
     $$\text{Initial Margin} = \sum \frac{|\text{Position Qty}| \times \text{Mark Price}}{\text{Leverage}}$$
  5. **Maintenance Margin Required:**
     $$\text{Maintenance Margin} = \sum |\text{Position Qty}| \times \text{Mark Price} \times \text{Maintenance Margin Rate}$$
  6. **Available Balance for New Orders:**
     $$\text{Available Balance} = \max(0, \text{Equity} - \text{Initial Margin})$$
  7. **Maintenance Margin Ratio (Binance/CoinDCX standard):**
     $$\text{Margin Ratio} = \begin{cases} \frac{\text{Maintenance Margin}}{\text{Equity}}, & \text{if } \text{Equity} > 0 \\ 1.0, & \text{if } \text{Equity} \le 0 \end{cases}$$

### 1.3 Options Wallet (`productType: 'OPTIONS'`)
* **Core Function:** European and American cash-settled options contracts.
* **Locking Rules:**
  * **Buying Options:** Locks the premium: $\text{Locked} = \text{Contracts} \times \text{Premium} + \text{Fee}$.
  * **Writing Options:** Locks standard portfolio margin collateral.
* **Expiry Settlement:** Cash-settled against the 30-minute settlement mark price index:
  $$\text{Payoff}_{\text{CALL}} = \max(0, \text{Settlement Price} - \text{Strike}) \times \text{Contracts}$$
  $$\text{Payoff}_{\text{PUT}} = \max(0, \text{Strike} - \text{Settlement Price}) \times \text{Contracts}$$

### 1.4 Earn Wallet (`productType: 'EARN'`)
* **Core Function:** Yield farming and staking vault simulation.
* **Isolation Rule:** Earn balances are strictly isolated from futures trading risk; staked assets cannot be seized during futures liquidations.

---

## 2. Dual-Currency Valuation Engine (USDT & INR)

To replicate Indian crypto exchanges (such as CoinDCX), the engine supports dual-currency accounting and presentation.

```typescript
export interface ExchangeRateConfig {
  inrUsdtRate: number;        // e.g. 89.50 INR per USDT
  dynamicRateEnabled: boolean;
  rateFeedSymbol?: string;    // Forex feed or CoinDCX proxy
}
```

### 2.1 Consolidated Portfolio Valuation Formulas

1. **Consolidated USDT Portfolio Value:**
   $$\text{Portfolio}_{\text{USDT}} = \text{Futures Equity} + \text{Spot Assets}_{\text{USDT}} + \text{Options Equity} + \text{Earn Assets}_{\text{USDT}} + \frac{\text{INR Cash}}{\text{inrUsdtRate}}$$

2. **Consolidated INR Portfolio Value:**
   $$\text{Portfolio}_{\text{INR}} = \text{Portfolio}_{\text{USDT}} \times \text{inrUsdtRate}$$

---

## 3. Monetary Precision Rules & Math Kernel

In strict compliance with [CONTRACTS.md §14](file:///home/nemesis/project/trading-workspace/paper-broker/CONTRACTS.md), floating-point arithmetic is strictly forbidden for balances, orders, fills, fees, and PnL.

```typescript
import { Decimal } from 'decimal.js';

// Global precision configuration
Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export const D = (val: string | number | Decimal): Decimal => new Decimal(val);

// Example: Safe Weighted Average Price calculation on scale-in
export function calculateVwapEntry(
  existingQty: Decimal,
  existingPrice: Decimal,
  fillQty: Decimal,
  fillPrice: Decimal
): Decimal {
  const totalQty = existingQty.add(fillQty);
  if (totalQty.isZero()) return new Decimal(0);
  return existingQty.mul(existingPrice).add(fillQty.mul(fillPrice)).div(totalQty);
}
```

### 3.1 Storage & Serialization Standards
* **In-Memory:** Maintained as `Decimal` instances inside core math calculations.
* **In Database:** Persisted as exact-precision strings (`TEXT` columns in SQLite) to prevent IEEE-754 rounding degradation across restarts.
* **API Display:** Formatted to instrument-specific precision (e.g. 2 decimals for USDT/INR, 8 decimals for BTC).

---

### Navigation
- Previous: [01. Architecture & System Topology](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/01-architecture-and-topology.md)
- Next: [03. Double-Entry General Ledger & Lifecycle Events](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/03-double-entry-ledger-and-events.md)
