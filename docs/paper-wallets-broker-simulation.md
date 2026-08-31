# Paper Broker Simulation Engine & Multi-Wallet Accounting System

**Target Package:** `@nemesis-oss/paper-broker`  
**Execution Runtime:** Node.js (TypeScript 5.x) / Fastify / SQLite (`better-sqlite3` WAL) / `decimal.js`  
**Market Data Truth:** Binance WebSocket & REST API (`@nemesis-oss/binance-sdk`)  
**Execution Venues:** Simulated Paper Ledger (`PaperBroker`) & Live Exchange (`CoinDCXBroker`) via `ExecutionRouter`  

---

## Executive Overview

The **Paper Broker Simulation Engine** provides a deterministic, local-first, high-fidelity exchange simulation designed for algorithmic strategies and autonomous multi-agent pipelines. It features multi-product segregated wallets, double-entry general ledger accounting, continuous mark-to-market settlement, cross-margin liquidation, 8-hour funding rates, realistic slippage/fees, and dual-currency (USDT/INR) valuation.

The full specification is organized into modular documents under [`docs/paper-broker/`](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/README.md):

---

## 📚 Specification Modules

| Module | Description |
| :--- | :--- |
| [**01. Architecture & System Topology**](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/01-architecture-and-topology.md) | Hexagonal architecture, decoupled market data and execution venues, signal-to-settlement pipeline, and safety contracts. |
| [**02. Multi-Wallet Architecture & Accounting**](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/02-multi-wallet-and-accounting.md) | Segregated wallets (Spot, Futures, Options, Earn), dual-currency valuation (USDT & INR), and monetary precision rules. |
| [**03. Double-Entry General Ledger & Events**](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/03-double-entry-ledger-and-events.md) | Double-entry chart of accounts, debit/credit rules, position lifecycle state transitions, and UI transactions ledger. |
| [**04. Order Management & Matching Engine**](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/04-order-matching-and-execution.md) | Order types (`MARKET`, `LIMIT`, `STOP_MARKET`, `TAKE_PROFIT_MARKET`, `TRAILING_STOP`), pre-flight margin reservation, BBO matching, slippage, and fee models. |
| [**05. Position Management & Liquidation**](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/05-position-management-and-liquidation.md) | VWAP entry calculations, continuous mark-to-market recalculation, cross-margin liquidation engine, and 8-hour funding payments. |
| [**06. SQLite Persistence, Schema & Hydration**](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/06-sqlite-persistence-and-schema.md) | Production SQLite WAL DDL schemas, in-memory state hydration, `SQLiteBrokerPersister`, and append-only `EventLog`. |
| [**07. Fastify REST API & WebSocket Gateway**](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/07-api-and-websocket-gateway.md) | Fastify HTTP endpoints (`/account`, `/orders`, `/positions`, `/api/v1/wallets`), WebSocket topics, and rate limiting isolation. |
| [**08. Frontend Dashboard & Terminal Mapping**](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/08-frontend-terminal-mapping.md) | CoinDCX/Binance-style trading terminal UX, React component to backend API/WS data source mapping, and Zustand stores. |
| [**09. Concurrency, Atomicity & TDD Strategy**](file:///home/nemesis/project/trading-workspace/paper-broker/docs/paper-broker/09-concurrency-and-testing-strategy.md) | Single-threaded event-loop atomicity, `clientOrderId` idempotency, double-spend prevention, and test suite specifications. |

---

### Invariant References
- **Architecture Contracts:** [CONTRACTS.md](file:///home/nemesis/project/trading-workspace/paper-broker/CONTRACTS.md)
- **Agent Rules & Protocol:** [AGENTS.md](file:///home/nemesis/project/trading-workspace/paper-broker/AGENTS.md)
- **Signal-to-Settlement Lifecycle:** [wallet-lifecycle.md](file:///home/nemesis/project/trading-workspace/paper-broker/docs/wallet-lifecycle.md)
- **Broker Engine Source:** [src/broker/PaperBroker.ts](file:///home/nemesis/project/trading-workspace/paper-broker/src/broker/PaperBroker.ts)
