# ADR 0002: Decoupled Market Data and CoinDCX Execution Architecture

**Date**: 2026-08-21  
**Status**: Accepted  
**Author**: System Architect  

## Context

The trading system currently uses Binance WebSocket and REST APIs for market data and runs against a deterministic local `PaperBroker`. To transition safely to live trading on CoinDCX (using `@nemesis-oss/coindcx-sdk`) without risking dual-order execution or brittle exchange coupling, we must decouple four distinct planes:

1. **Market Data Feeds**: Primary (Binance) and Fallback (CoinDCX).
2. **Strategy & Intelligence**: Deterministic setup detection and LLM reasoning (`ollama-sdk`) operating exclusively on normalized canonical market state.
3. **Risk & Safety Guard**: Authoritative sizing, risk limits, kill-switches, and explicit live armed state.
4. **Execution Venue**: Unified `ExecutionBroker` interface implemented by `PaperBroker` and `CoinDCXBroker`.

## Decision

We establish a 6-layer decoupled architecture:

### 1. Market Data Plane & Feed Supervisor
- Both Binance and CoinDCX WebSocket/REST feeds can run concurrently under a `MarketDataSupervisor`.
- Raw exchange schemas are normalized into canonical `MarketEvent` and `MarketState` structures before reaching domain logic.
- **Failover Invariant**: Binance is primary for candles, orderbook, funding, and OI. If Binance becomes degraded or stale, failover to CoinDCX occurs ONLY after feed continuity, timestamp freshness, symbol mapping, and price divergence ($\Delta \text{price} \le \text{threshold}$) are validated.
- Cross-exchange price divergence triggers `MARKET_DATA_DIVERGENCE` and temporarily halts new entry setups.

### 2. Strategy & Signal Venue vs Execution Venue
- Strategy logic is venue-agnostic and does not hold exchange credentials or make exchange SDK calls.
- The system explicitly distinguishes:
  - `signalVenue`: The exchange feed that generated the market structure signal (e.g., `BINANCE`).
  - `executionVenue`: The venue where orders and positions reside (e.g., `PAPER` or `COINDCX`).

### 3. Unified Execution Broker Interface
All execution venues implement the `ExecutionBroker` interface:
```typescript
export interface ExecutionBroker {
  submitOrder(command: OrderCommand): Promise<Order> | Order;
  cancelOrder(orderId: string, reason?: string): Promise<Order | undefined> | Order | undefined;
  cancelAllOrders(symbol?: string): Promise<void> | void;
  getOpenOrders(symbol?: string): Promise<Order[]> | Order[];
  getPositions(): Promise<Position[]> | Position[];
  getPosition(symbol: string): Promise<Position | undefined> | Position | undefined;
  getAccount(): Promise<AccountState> | AccountState;
}
```

### 4. CoinDCX Live Execution Safety
- `CoinDCXBroker` translates `OrderCommand` into CoinDCX USD-M futures orders via `@nemesis-oss/coindcx-sdk`.
- Order fills are never assumed from REST HTTP `200 OK` responses; they are confirmed via private WebSocket streams (`orderUpdate`, `positionUpdate`).
- **Uncertain Write Invariant**: If an order submission times out or disconnects with unknown status, the execution router MUST NOT failover or retry blindly. It marks state `UNKNOWN`, queries the exchange, reconciles, and only then resumes.

### 5. Position Reconciliation (`PositionReconciler`)
- Continuous reconciliation loops compare internal memory/SQLite state against authoritative exchange state (positions, open orders, margin, balances).
- Any detected mismatch halts new trade entry and places the engine into `SAFE_MODE`.

### 6. Canonical Instrument & Symbol Mapping
Instruments are defined canonically (e.g., `SOL/USDT`) with explicit venue symbol maps:
```typescript
export interface Instrument {
  canonical: string; // "SOL/USDT"
  baseAsset: string; // "SOL"
  quoteAsset: string; // "USDT"
  venues: {
    binance: string; // "SOLUSDT"
    coindcx: string; // "B-SOL_USDT"
  };
  ...
}
```

### 7. Operating Modes (`TRADING_MODE`)
- `paper`: Real market data, simulated local execution via `PaperBroker`.
- `shadow`: Real market data, real CoinDCX account state (read-only), simulated execution.
- `live`: Real market data, real CoinDCX execution via `CoinDCXBroker` with explicit arming.

## Consequences

- **Safety**: Prevents accidental live order placement, duplicate exposure on timeouts, and false signal triggers from mid-setup feed divergence.
- **Portability**: Strategy engine and backtest runner remain 100% reusable across paper and live trading.
- **Observability**: Clear lifecycle events for feed health, failovers, execution states, and reconciliation status.
