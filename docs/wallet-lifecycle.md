# Wallet Lifecycle: Signal to Settlement

How a strategy signal becomes a filled position, how the wallet changes shape
at each step, and how a long and a short with the identical price move end up
with mirrored numbers. Every formula is cited to the line it's read from in
`PaperBroker.ts`, and every number below is asserted in
`test/unit/PaperBroker.test.ts` (describe blocks `PaperBroker account math`
and `PaperBroker reset survives a process restart`).

**Scope:** this describes `src/broker/PaperBroker.ts`, the engine behind the
live `paper:trade` / `paper:autonomous` CLI path and the dashboard. The
separate backtest engine (`SmcPaperBroker` / `PaperAccount`, used by
`ReplayEngine`) tracks the same concepts with native floats instead of
`decimal.js` and its own `PaperAccount.getAccountState()` — not covered here.

## 1. The full lifecycle

```text
Candle closes                                     (market/candles.ts)
      │
      ▼
Strategy emits a signal                            (strategies/*.ts)
      │
      ▼
StrategyEngine validates: schema, cooldown, expiry
      │
      ▼
TradeIntentEngine + RiskEngine                      sizes qty + leverage,
      │                                             can reject
      ▼
SignalExecutor submits order                        + SL/TP brackets
      │
      ▼
ExecutionRouter                                     picks paper vs. live venue
      │
      ▼
PaperBroker fills: price ± slippage,
fee = notional × rate                               wallet −= openFee (:507)
      │
      ▼
┌──────────────────────────────────────────┐
│ Position OPEN                             │◄──── onMarket() ticks:
│ equity = wallet + Σ unrealizedPnl         │      recalc every tick
│ avail  = equity − initMargin              │      (recalculateAccount())
└──────────────────────────────────────────┘
      │
      │  exit trigger checked every tick
      ▼
   ┌──────────────┬───────────────────────┬─────────────────────────┐
   │ Manual close  │ Bracket fires         │ Liquidation (forced)    │
   │ reduce-only   │ STOP_MARKET /         │ equity ≤ maintMargin    │
   │ order, any qty│ TAKE_PROFIT_MARKET    │ checkLiquidation():973  │
   │ (:submitOrder)│ evaluateOpenOrders:442│                         │
   └──────────────┴───────────────────────┴─────────────────────────┘
      │
      ▼
Close Fill
realizedPnl = closedQty × (exit − entry) × direction   (direction: +1 long / −1 short)
closingFee  = notional(exit) × feeRate
      │
      ▼
Wallet Settled                              Audit Trail
wallet += realizedPnl − closingFee    ──►    EventLog (events.jsonl) +
                                              BrokerPersister (fills/positions/orders)
```

The loop on **Position OPEN** runs on every market tick, not just at entry
and exit — equity, margin and available balance are live numbers, not
snapshots.

## 2. Wallet state machine

Two real states per symbol — flat or holding a position — but the numbers
reported differ sharply between them. This is the exact shape of the bug
fixed in `PaperAccount.ts` (the *other* engine): `availableBalance` used the
flat-state formula while a position was open.

```text
   FLAT                          OPEN                            FLAT
┌──────────┐  fill: submit-  ┌──────────────────────┐  close fill  ┌──────────┐
│ equity   │  Order()        │ equity = wallet +     │  (reduce-    │ wallet  += │
│ = wallet │  wallet -=      │   Σ unrealizedPnl      │  only /      │ realizedPnl│
│ = avail  │  openFee   ───► │ initMargin = notional  │  bracket /   │  − closing │
│ margins  │                 │   / leverage            │  liquidation)│  Fee       │
│ = 0      │                 │ avail = equity −       │  ─────────►  │ ready for  │
└──────────┘                 │   initMargin            │              │ next signal│
                              │ marginRatio =           │              └──────────┘
              onMarket():     │   maintMargin / equity  │
              recalc every    │                          │
              tick ───────────┤ (self-loop)              │
                              └──────────────────────────┘
```

Unrealized P&L only ever lives inside `equity` while a position is OPEN. The
moment it closes, it's folded into `walletBalance` as realized P&L and stops
moving with the market.

### Formula reference

| Field | Formula | Notes |
|---|---|---|
| `walletBalance` | `startingUsdt + Σ realizedPnl − Σ fees − Σ funding` | only moves on a completed fill or a funding tick (`PaperBroker.ts:150`) |
| `equity` | `walletBalance + Σ unrealizedPnl` | the number that matters for liquidation (`:930`) |
| `initialMargin` | `Σ notional / leverage` | notional priced at current mark, not entry (`:926`) |
| `maintenanceMargin` | `Σ notional × maintenanceMarginRate` | 0.5% for BTCUSDT in this repo's fixtures (`:927`) |
| `availableBalance` | `max(0, equity − initialMargin)` | free margin for new orders (`:931`) |
| `marginRatio` | `maintenanceMargin / equity` | → 1 at liquidation, Binance convention (`:932`) |

## 3. Long vs. short: same move, mirrored wallet

Only one thing changes between a long and a short: the sign of `qty`. Every
formula above is identical for both sides — a long carries positive `qty`, a
short carries negative `qty`, and that single sign flip is what makes a
falling price profitable for a short and unprofitable for a long.

`realizedPnl = qty × (exit − entry)` — 1 BTC at 5× leverage, gross before fees:

| | Price → $110 | Price → $90 |
|---|---|---|
| **LONG** (qty = +1) | +$10 gross (profit) | −$10 gross (loss) |
| **SHORT** (qty = −1) | −$10 gross (loss) | +$10 gross (profit) |

The tables below walk one long and one short through three checkpoints — at
entry, mid-trade while the position is still open (unrealized), and at close
(realized) — for both a favorable and an adverse $10 move. Numbers assume 1
BTC, 5× leverage, 0.04% taker fee, 0.5% maintenance margin rate, and zero
slippage for readability (a real market fill adds ~2bps by default).

### LONG — 1 BTC @ $100, 5× leverage (qty = +1)

| Checkpoint | Mark | Unrealized PnL | Wallet | Equity | Avail. Balance | Margin Ratio |
|---|---|---|---|---|---|---|
| Entry (fee charged) | $100 | 0.000 | 9999.960 | 9999.960 | 9979.960 | 0.0050% |
| Mid-trade, price rising | $105 | +5.000 | 9999.960 | 10004.960 | 9983.960 | 0.0052% |
| Close reduce-only | $110 | realized +10.000 | **10009.916** | 10009.916 | 10009.916 | 0% |
| Mid-trade, price falling | $95 | −5.000 | 9999.960 | 9994.960 | 9975.960 | 0.0048% |
| Close reduce-only | $90 | realized −10.000 | **9989.924** | 9989.924 | 9989.924 | 0% |

Net on favorable move: **+9.916** · Net on adverse move: **−10.076** ·
round-trip fee drag: 0.076–0.084.

### SHORT — 1 BTC @ $100, 5× leverage (qty = −1)

| Checkpoint | Mark | Unrealized PnL | Wallet | Equity | Avail. Balance | Margin Ratio |
|---|---|---|---|---|---|---|
| Entry (fee charged) | $100 | 0.000 | 9999.960 | 9999.960 | 9979.960 | 0.0050% |
| Mid-trade, price falling | $95 | +5.000 | 9999.960 | 10004.960 | 9985.960 | 0.0047% |
| Close reduce-only | $90 | realized +10.000 | **10009.924** | 10009.924 | 10009.924 | 0% |
| Mid-trade, price rising | $105 | −5.000 | 9999.960 | 9994.960 | 9973.960 | 0.0053% |
| Close reduce-only | $110 | realized −10.000 | **9989.916** | 9989.916 | 9989.916 | 0% |

Net on favorable move: **+9.924** · Net on adverse move: **−10.084** ·
round-trip fee drag: 0.076–0.084.

**Why the numbers aren't exactly ±10:** fee is charged on notional at that
fill, not a fixed dollar amount. A favorable move grows the closing notional
slightly (costs a bit more fee); an adverse move shrinks it (costs a bit
less) — the fee always leans against the side of the trade that made money,
by a fraction of a percent.

## 4. Liquidation is a forced version of the same close

Every tick, after mark-to-market recalculation, the broker checks the whole
account: if `equity ≤ maintenanceMargin` across every open position
combined, it force-closes everything at the current mark, tagged with
strategyId `LIQUIDATION` (`PaperBroker.ts:973–990`). It goes through the
identical fill path as a manual close — same fee, same event log entry, same
wallet-settlement formula — so nothing about the ledger math changes, only
who initiated the order. This repo's paper broker checks liquidation against
total account equity (cross-margin style), not per-position isolated margin.
