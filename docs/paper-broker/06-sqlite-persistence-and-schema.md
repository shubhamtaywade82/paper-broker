# 06. SQLite Persistence, Schema & Hydration

**Target System:** `@nemesis-oss/paper-broker`  
**Execution Runtime:** Node.js (TypeScript 5.x) / Fastify / SQLite (`better-sqlite3` WAL) / `decimal.js`  

---

## 1. SQLite WAL Engine Configuration

The database engine is configured via [DatabaseManager](file:///home/nemesis/project/trading-workspace/paper-broker/src/persistence/db.ts) using `better-sqlite3`:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
```

* **WAL Mode (Write-Ahead Logging):** Enables concurrent readers without blocking synchronous writer operations.
* **Synchronous = NORMAL:** Balances ACID durability with low latency during rapid WebSocket tick processing.
* **Foreign Keys = ON:** Enforces relational integrity across fills, orders, positions, and accounts.

---

## 2. Production DDL Schema (`paper.sqlite3`)

```sql
-- 1. Accounts Master
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  account_mode TEXT NOT NULL,          -- 'PAPER' | 'TESTNET_MIRROR' | 'LIVE'
  starting_usdt TEXT NOT NULL,
  wallet_balance TEXT NOT NULL,
  total_fees TEXT NOT NULL DEFAULT '0',
  total_funding TEXT NOT NULL DEFAULT '0',
  total_realized_pnl TEXT NOT NULL DEFAULT '0',
  liquidations INTEGER NOT NULL DEFAULT 0,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

-- 2. Multi-Product Segregated Wallets
CREATE TABLE IF NOT EXISTS wallets (
  account_id TEXT NOT NULL,
  product_type TEXT NOT NULL,          -- 'SPOT' | 'FUTURES' | 'OPTIONS' | 'EARN'
  currency TEXT NOT NULL,              -- 'USDT' | 'INR' | 'BTC' | 'ETH'
  free TEXT NOT NULL DEFAULT '0',
  locked TEXT NOT NULL DEFAULT '0',
  total_fees TEXT NOT NULL DEFAULT '0',
  total_funding TEXT NOT NULL DEFAULT '0',
  total_realized_pnl TEXT NOT NULL DEFAULT '0',
  updated_at_utc TEXT NOT NULL,
  PRIMARY KEY (account_id, product_type, currency),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

-- 3. Double-Entry General Ledger
CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  currency TEXT NOT NULL,
  account_code TEXT NOT NULL,          -- e.g. 'ASSETS:WALLET:USDT:FREE'
  direction TEXT NOT NULL,             -- 'DEBIT' | 'CREDIT'
  amount TEXT NOT NULL,
  balance_after TEXT,
  related_order_id TEXT,
  related_fill_id TEXT,
  related_position_symbol TEXT,
  description TEXT,
  created_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_account_time ON ledger_entries(account_id, created_at_utc);

-- 4. Orders
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  client_order_id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  product_type TEXT NOT NULL DEFAULT 'FUTURES',
  strategy_id TEXT,
  signal_id TEXT,
  side TEXT NOT NULL,
  type TEXT NOT NULL,
  time_in_force TEXT NOT NULL,
  status TEXT NOT NULL,
  position_side TEXT NOT NULL,
  quantity TEXT NOT NULL,
  filled_qty TEXT NOT NULL DEFAULT '0',
  limit_price TEXT,
  stop_price TEXT,
  avg_fill_price TEXT NOT NULL DEFAULT '0',
  leverage INTEGER NOT NULL DEFAULT 5,
  margin_type TEXT,
  reduce_only BOOLEAN NOT NULL DEFAULT FALSE,
  post_only BOOLEAN NOT NULL DEFAULT FALSE,
  close_position BOOLEAN NOT NULL DEFAULT FALSE,
  reject_reason TEXT,
  submitted_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_strategy ON orders(strategy_id);

-- 5. Fills (Immutable)
CREATE TABLE IF NOT EXISTS fills (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  strategy_id TEXT,
  signal_id TEXT,
  side TEXT NOT NULL,
  quantity TEXT NOT NULL,
  price TEXT NOT NULL,
  notional TEXT NOT NULL,
  fee TEXT NOT NULL,
  fee_asset TEXT NOT NULL,
  liquidity TEXT NOT NULL,             -- 'MAKER' | 'TAKER'
  realized_pnl TEXT NOT NULL DEFAULT '0',
  position_qty_before TEXT NOT NULL,
  position_qty_after TEXT NOT NULL,
  fill_ts_utc TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);
CREATE INDEX IF NOT EXISTS idx_fills_symbol ON fills(symbol);
CREATE INDEX IF NOT EXISTS idx_fills_order ON fills(order_id);

-- 6. Positions
CREATE TABLE IF NOT EXISTS positions (
  account_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  product_type TEXT NOT NULL DEFAULT 'FUTURES',
  position_side TEXT NOT NULL,
  status TEXT NOT NULL,
  qty TEXT NOT NULL DEFAULT '0',
  entry_price TEXT NOT NULL DEFAULT '0',
  unrealized_pnl TEXT NOT NULL DEFAULT '0',
  realized_pnl TEXT NOT NULL DEFAULT '0',
  leverage INTEGER NOT NULL DEFAULT 5,
  margin_type TEXT,
  initial_margin TEXT NOT NULL DEFAULT '0',
  maintenance_margin TEXT NOT NULL DEFAULT '0',
  maintenance_margin_rate TEXT NOT NULL DEFAULT '0.005',
  total_fees TEXT NOT NULL DEFAULT '0',
  total_funding TEXT NOT NULL DEFAULT '0',
  opened_at_utc TEXT,
  updated_at_utc TEXT NOT NULL,
  closed_at_utc TEXT,
  PRIMARY KEY (account_id, symbol, product_type)
);

-- 7. Funding Payments
CREATE TABLE IF NOT EXISTS funding_payments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  position_side TEXT NOT NULL,
  qty TEXT NOT NULL,
  mark_price TEXT NOT NULL,
  funding_rate TEXT NOT NULL,
  payment TEXT NOT NULL,
  wallet_balance_after TEXT NOT NULL,
  funding_time_utc TEXT NOT NULL,
  created_at_utc TEXT NOT NULL
);

-- 8. UI Transactions History
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  position_id TEXT,
  order_id TEXT,
  fill_id TEXT,
  product_type TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount TEXT NOT NULL,
  fee TEXT NOT NULL DEFAULT '0',
  gross_pnl TEXT,
  net_pnl TEXT,
  balance_after TEXT NOT NULL,
  metadata TEXT,
  created_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_account_time ON transactions(account_id, created_at_utc);
```

---

## 3. In-Memory State Hydration & Restart Recovery

On startup, [PaperBroker](file:///home/nemesis/project/trading-workspace/paper-broker/src/broker/PaperBroker.ts) reconstructs complete runtime state from SQLite:

1. **Load Open Positions:** Retrieves all records where `status = 'OPEN' AND CAST(qty AS REAL) != 0`. Self-heals any precision drift by re-rounding to instrument precision.
2. **Load Open Orders:** Retrieves all records where `status IN ('NEW', 'PARTIALLY_FILLED')`.
3. **Replay Fills & Funding:** Iterates over historical fills to reconstruct exact cumulative financial totals:
   $$\text{walletBalance} = \text{startingUsdt} + \sum \text{realizedPnl} - \sum \text{fees} - \sum \text{funding}$$

---

## 4. `SQLiteBrokerPersister` & `EventLog` Pipeline

* **[SQLiteBrokerPersister](file:///home/nemesis/project/trading-workspace/paper-broker/src/persistence/BrokerPersister.ts):** Performs fast, prepared UPSERT operations to maintain queryable state in `orders`, `fills`, `positions`, and `wallets`.
* **[EventLog](file:///home/nemesis/project/trading-workspace/paper-broker/src/persistence/EventLog.ts):** Appends raw event streams to the `events` table and the streaming `events.jsonl` log.

---

### Navigation
- Previous: [05. Position Management, Mark-to-Market & Liquidation](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/05-position-management-and-liquidation.md)
- Next: [07. Fastify REST API & WebSocket Real-Time Gateway](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/07-api-and-websocket-gateway.md)
