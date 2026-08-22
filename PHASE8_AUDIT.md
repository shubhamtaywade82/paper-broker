# PHASE 8 AUDIT: Paper Broker Architecture & SMC Execution Simulation

## 1. Existing Broker Architecture
- `PaperBroker.ts` (~940 lines): A generic paper execution broker with basic order lifecycle (`NEW`, `FILLED`, `CANCELED`), market/limit orders, basic position tracking, balance updates, and SQLite event logging.
- `types.ts`: Canonical contracts for `Order`, `Position`, `AccountState`, `MarketState`, `Instrument`.
- `MarketState.ts`: Monotonic price tracking and data health machine (`HEALTHY`, `DEGRADED`, `STALE`, `INVALID`, `DISCONNECTED`).

## 2. Reusable Components
- Binance instrument normalization contracts (`stepSize`, `tickSize`, `minQty`, `maxQty`, `minNotional`).
- Data quality validation and monotonic timestamping from Phase 1.
- `TradeSignal` (from Phase 7) containing risk-budgeted quantity, multiple Take Profit allocations, and complete causal provenance.
- `ExecutionPlan` (from Phase 6) containing structural entry, structural stop loss, and structural take profit targets.

## 3. Missing Functionality
- **SMC-Native Trade Lifecycle**:
  - `SIGNAL_RECEIVED` -> `WAITING_FOR_ENTRY` -> `ENTRY_FILLED` -> `TP1_PARTIAL` -> `BREAKEVEN` -> `TP2_PARTIAL` -> `TP3_REACHED` -> `CLOSED`.
- **Candle-Based Fill Engine**:
  - Deterministic limit fills (`low <= limitPrice` for Long; `high >= limitPrice` for Short).
  - Intrabar ambiguity detection (`REJECT_AMBIGUOUS` policy).
- **Multi-Level Partial Take Profits**:
  - Executing 33% TP1, 33% TP2, and 34% TP3 without exceeding position size.
- **Structural Stop Loss & Breakeven Ratcheting**:
  - Moving stop loss to breakeven (`entryPrice + offset`) after TP1 / trigger R without loosening.
- **Isolated Margin & Liquidation Safety**:
  - Accurate maintenance margin and liquidation price modeling.
- **Configurable Fees & Slippage**:
  - Maker / Taker fee deduction and fixed-tick / bps slippage.
- **Trade Traceability**:
  - End-to-end `getTradeTrace(tradeId)` reconstructing the complete lineage from market data -> MTF -> Structure -> SMC -> Setup -> Plan -> Risk -> Signal -> Order -> Fill -> Position -> Exit -> PnL.

## 4. Proposed Phase 8 Modular Architecture
```text
src/broker/paper/
├── types.ts                   (Paper order, position, fill, trade, account contracts)
├── PaperAccount.ts            (Equity, margin, balance, and realized PnL accounting)
├── PaperOrder.ts              (Generic and SMC order objects with clientOrderId)
├── PaperFeeModel.ts           (Maker/Taker fee calculations)
├── PaperSlippageModel.ts      (Configurable slippage simulation)
├── PaperLiquidation.ts        (Isolated margin liquidation threshold calculator)
├── PaperFillEngine.ts         (Deterministic candle fill logic with ambiguous detection)
├── PaperPositionManager.ts    (Partial TPs, structural SL, breakeven, trailing stops)
├── PaperEventJournal.ts       (Immutable append-only broker event stream)
├── PaperLedger.ts             (Persistent trade record with MFE, MAE, R:R realized)
├── PaperMetrics.ts            (Win rate, profit factor, drawdown, average R metrics)
└── SmcPaperBroker.ts          (Unified high-level facade consuming TradeSignal)
```

## 5. Invariants
1. `positionQuantity >= 0`
2. `closedQuantity <= openedQuantity`
3. `fees >= 0`
4. Stop Loss can ONLY ratchet closer to price, NEVER loosen.
5. Take profits must never close more than the remaining open quantity.
6. Realized PnL + Unrealized PnL + Fees reconcile with total account equity.
7. `PaperBroker` CANNOT emit live orders or call Binance execution endpoints.
8. Zero future candle lookahead.

## 6. Test Plan
- Unit tests for each modular component:
  - `PaperFillEngine.test.ts`
  - `PaperPositionManager.test.ts`
  - `PaperLedger.test.ts`
  - `SmcPaperBroker.test.ts`
- End-to-end Long trade: SSL sweep -> Bullish CHoCH -> FVG -> Retest -> 5m Trigger -> Limit fill -> TP1 -> Breakeven -> TP2 -> TP3 -> Closed.
- End-to-end Short trade: BSL sweep -> Bearish CHoCH -> FVG -> Retest -> Limit fill -> SL hit -> Closed.
- Invariant & property validation tests.
