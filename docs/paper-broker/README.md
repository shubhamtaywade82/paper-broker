# Paper Broker Core Specification & Architecture Suite

**Package:** `@nemesis-oss/paper-broker`  
**Runtime:** Node.js (TypeScript 5.x) / Fastify / SQLite (`better-sqlite3` WAL) / `decimal.js`  
**Market Data Truth:** Binance WebSocket & REST (`@nemesis-oss/binance-sdk`)  
**Execution Venues:** Simulated Paper Ledger (`PaperBroker`) & Live Exchange (`CoinDCXBroker`) via `ExecutionRouter`  

---

## 📚 Documentation Index

This directory contains the complete, modular technical specification for the **Paper Broker Simulation Engine**, multi-product wallet accounting, order matching, mark-to-market risk management, persistence, APIs, and dashboard integration.

### Core Modules

1. [**01. Architecture & System Topology**](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/01-architecture-and-topology.md)
   - Hexagonal architecture boundaries, decoupled market data and execution venues.
   - Signal-to-settlement execution pipeline.
   - Safety contracts and LLM advisory boundaries.

2. [**02. Multi-Wallet Architecture & Dual-Currency Accounting**](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/02-multi-wallet-and-accounting.md)
   - Segregated product wallets: Spot (`COINS`), Futures (`DERIVATIVES`), Options (`CONTRACTS`), and Earn (`VAULTS`).
   - Dual-currency valuation engine (USDT base collateral with dynamic INR conversion for CoinDCX UX).
   - Monetary precision standards using `decimal.js` and SQLite exact string persistence.

3. [**03. Double-Entry General Ledger & Lifecycle Events**](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/03-double-entry-ledger-and-events.md)
   - Double-entry chart of accounts (`ASSETS`, `LIABILITIES`, `EQUITY`, `REVENUE`, `EXPENSE`).
   - Debit/Credit posting rules for order locks, fills, fees, funding, realized PnL, and internal transfers.
   - Position lifecycle state machine (`OPEN`, `INCREASE`, `REDUCE`, `CLOSE`, `FLIP`, `FUNDING`, `LIQUIDATION`).
   - Unified transaction history (`transactions` table for UI).

4. [**04. Order Management, Reservation & Matching Engine**](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/04-order-matching-and-execution.md)
   - Supported order types: `MARKET`, `LIMIT`, `STOP_MARKET`, `TAKE_PROFIT_MARKET`, `TRAILING_STOP_MARKET`.
   - Pre-flight margin reservation and lock mechanics.
   - Real-time BBO (Bid/Ask/Mark) depth matching.
   - Execution simulation: slippage models (`NONE`, `FIXED_TICKS`, `BPS`, `VOLATILITY`), maker/taker fee schedules, and time-in-force policies (`GTC`, `IOC`, `FOK`).

5. [**05. Position Management, Mark-to-Market & Liquidation**](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/05-position-management-and-liquidation.md)
   - Volume-Weighted Average Price (VWAP) entry math.
   - Continuous mark-to-market settlement on every market tick.
   - Cross-margin vs. isolated margin calculations.
   - Cross-margin liquidation engine: trigger condition ($\text{Equity} \le \text{Maintenance Margin}$) and synthetic `LIQUIDATION` order execution.
   - Periodic 8-hour funding rate calculation and settlement mechanics.

6. [**06. SQLite Persistence, Schema & Hydration**](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/06-sqlite-persistence-and-schema.md)
   - SQLite WAL mode configuration and performance tuning.
   - Complete production DDL schemas (`accounts`, `wallets`, `ledger_entries`, `orders`, `fills`, `positions`, `funding_payments`, `transactions`, `risk_events`).
   - In-memory state hydration, startup fill replay, and `SQLiteBrokerPersister` write paths.
   - Append-only audit trail (`EventLog` table and `events.jsonl`).

7. [**07. Fastify REST API & WebSocket Real-Time Gateway**](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/07-api-and-websocket-gateway.md)
   - Complete REST API endpoint catalog (`/account`, `/orders`, `/positions`, `/api/v1/wallets`, `/api/v1/history/transactions`, `/api/v1/risk`, etc.).
   - WebSocket Gateway protocol and real-time message topics (`order.updated`, `position.updated`, `account.updated`, `trade.trace`, etc.).
   - Rate limiting tiers, token bucket algorithms, and control plane priority isolation.

8. [**08. Frontend Dashboard & Trading Terminal Mapping**](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/08-frontend-terminal-mapping.md)
   - CoinDCX / Binance-style trading terminal UX mapping.
   - Global Portfolio Overview card (INR / USDT toggle).
   - Segregated Assets view (Spot, Futures, Options, Earn).
   - Trading terminal: Lightweight Charts, Orderbook & BBO depth, Order Entry Ticket with leverage slider and TP/SL brackets.
   - Positions, Open Orders, and Futures History / PnL Analytics tabs.

9. [**09. Concurrency, Atomicity & Test-Driven Verification**](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/09-concurrency-and-testing-strategy.md)
   - Single-threaded Node.js event-loop isolation vs async I/O boundaries.
   - Idempotency via `clientOrderId` and ULID.
   - SQLite immediate transaction locking to prevent race conditions and double-spending.
   - Test-Driven Development (TDD) strategy: unit test specs, decimal math precision, long/short PnL symmetry, concurrency race condition tests, liquidation integration tests, and ReplayEngine backtesting parity.

---

### Invariant References
- **Architecture Contracts:** [CONTRACTS.md](file:///home/nemesis/project/trading-workspace/paper-broker/CONTRACTS.md)
- **Agent Rules & Protocol:** [AGENTS.md](file:///home/nemesis/project/trading-workspace/paper-broker/AGENTS.md)
- **Signal-to-Settlement Lifecycle:** [wallet-lifecycle.md](file:///home/nemesis/project/trading-workspace/paper-broker/docs/wallet-lifecycle.md)
- **Broker Engine Source:** [src/broker/PaperBroker.ts](file:///home/nemesis/project/trading-workspace/paper-broker/src/broker/PaperBroker.ts)
