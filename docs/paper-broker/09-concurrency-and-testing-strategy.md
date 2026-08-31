# 09. Concurrency, Atomicity & Test-Driven Verification

**Target System:** `@nemesis-oss/paper-broker`  
**Execution Runtime:** Node.js (TypeScript 5.x) / Vitest / SQLite (`better-sqlite3`)  

---

## 1. Concurrency Model & Race Condition Prevention

### 1.1 Single-Threaded Event Loop & In-Memory Isolation

Node.js executes JavaScript on a single thread. This ensures that synchronous in-memory state updates in [PaperBroker](file:///home/nemesis/project/trading-workspace/paper-broker/src/broker/PaperBroker.ts) cannot be interrupted by competing WebSocket ticks or incoming HTTP requests.

* **Critical Pattern:** All order matching, fill execution, VWAP recalculation, and account margin updates run **synchronously in memory** before yielding to asynchronous I/O (such as disk writes or network broadcasts).
* **Observer Isolation (Contract §19):** Listeners attached to `onFill` (e.g. telemetry, profit goals) are isolated inside `try/catch` blocks so throwing observers never abort execution or corrupt the ledger.

### 1.2 Double-Spend Prevention via Atomic SQLite Transactions

Database operations for multi-wallet transfers and order placements execute within synchronous SQLite transaction blocks:

```typescript
// Synchronous atomic transfer using better-sqlite3
const executeAtomicTransfer = db.transaction((sourceId: string, destId: string, currency: string, amount: string) => {
  const source = getWalletStmt.get(sourceId, currency);
  if (D(source.free).lt(amount)) {
    throw new Error('INSUFFICIENT_FUNDS');
  }
  debitWalletStmt.run(amount, sourceId, currency);
  creditWalletStmt.run(amount, destId, currency);
  insertLedgerStmt.run(...);
});
```

### 1.3 Idempotency via `clientOrderId`

Every order submission requires a `clientOrderId` (generated via ULID if omitted). The `orders` table enforces `UNIQUE(client_order_id)`. Duplicate submissions return the existing order record without duplicating margin locks or fills.

---

## 2. Test-Driven Verification Strategy (TDD)

```text
               ┌───────────────────────────────┐
               │    End-to-End System Tests    │ (ReplayEngine, CLI trade smoke)
               ├───────────────────────────────┤
               │   Integration Boundary Tests  │ (Fastify REST, WebSocket Gateway)
               ├───────────────────────────────┤
               │   Broker Domain Engine Tests  │ (PaperBroker, FillEngine, Margin)
               ├───────────────────────────────┤
               │   Decimal Unit Math Tests     │ (VWAP, PnL Symmetry, Fees, MTM)
               └───────────────────────────────┘
```

### 2.1 PnL Symmetry Invariant Verification

A fundamental trading engine invariant is **mirrored PnL symmetry**: a long and a short of identical size subjected to identical price movements must produce mirrored gross PnL, differing only by the fee charged on the closing notional.

```typescript
// test/unit/PaperBroker.test.ts
describe('PaperBroker PnL Symmetry & Account Math', () => {
  it('produces mirrored PnL for identical long and short moves', () => {
    // 1 BTC Long entered at $100, exited at $110 -> Gross PnL: +$10.00
    // 1 BTC Short entered at $100, exited at $90  -> Gross PnL: +$10.00
    const longGross = calculateRealizedPnl(1, 100, 110, 'LONG');
    const shortGross = calculateRealizedPnl(1, 100, 90, 'SHORT');
    expect(longGross.toNumber()).toEqual(10.0);
    expect(shortGross.toNumber()).toEqual(10.0);
  });
});
```

### 2.2 Liquidation Invariant Tests

```typescript
// test/unit/PaperLiquidation.test.ts
describe('Cross-Margin Liquidation Invariant', () => {
  it('triggers synthetic liquidation orders when equity drops below maintenance margin', () => {
    const broker = new PaperBroker({ startingUsdt: 1000, ... });
    // Open 10x long position
    broker.submitOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 1, leverage: 10 });
    
    // Simulate catastrophic adverse price drop
    broker.onMarket({ symbol: 'BTCUSDT', mark: 50000 });
    
    const account = broker.getAccount();
    const position = broker.getPosition('BTCUSDT');
    
    expect(position?.qty).toEqual(0);
    expect(account.liquidations).toBeGreaterThanOrEqual(1);
    expect(account.openPositionsCount).toEqual(0);
  });
});
```

---

## 3. Canonical Verification Suite

Before accepting any changes, the full repository verification must pass:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

---

### Navigation
- Previous: [08. Frontend Dashboard & Trading Terminal Mapping](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/08-frontend-terminal-mapping.md)
- Back to Index: [00. Paper Broker Index](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/README.md)
