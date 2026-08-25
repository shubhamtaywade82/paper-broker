# Strategies

Strategies run on candle close. Each emits a typed signal (`OPEN_LONG` / `OPEN_SHORT` / `CLOSE_LONG` / `CLOSE_SHORT` / `HOLD` / `CANCEL_ALL`) with optional confidence; the `StrategyEngine` validates and de-duplicates it (cooldown, confidence threshold, TTL), and the `SignalExecutor` converts it into orders:

- **OPEN signals** — arrive **pre-sized**. `TradeIntentEngine`/`RiskEngine` compute quantity and leverage upstream and place them on `signal.features`; `SignalExecutor` no longer sizes anything itself. If the signal carries a stop-loss price, a `STOP_MARKET` bracket is attached.
- **CLOSE signals** — reduce-only market order at current position size.
- **HOLD / CANCEL_ALL** — no-op / cancel outstanding orders.

All strategies share the candle-close interface:

```ts
onCandleClose(ctx: StrategyContext, candle: Candle): Signal | null
```

`StrategyContext` provides `getCandles(symbol, interval, limit)`, `getMarket(symbol)` and `submitOrder(command)` (used by the grid strategy for direct ladder placement).

## Which strategies actually run

Only two strategies are registered by `engine.ts` and produce trades:

| Strategy | Type | Notes |
|----------|------|-------|
| `smc-agent-v1` | SMC structure + LLM confirmation | The deterministic SMC engine produces a candidate; the agent debate can only confirm or veto it. |
| adaptive Supertrend | Q-learning parameter selection | Learns which ATR/factor set suits which market regime from realized outcomes. No LLM. |

The classic indicator strategies documented below remain on disk and are
reachable via `cli.ts --engine=indicators`, but they produce **zero trades**:
they emit unsized signals, and `SignalExecutor` rejects a signal that carries no
quantity. Treat the sections below as reference for a retired path.

## Performance feedback

When `STRATEGY_FEEDBACK_ENABLED=true`, `StrategyPerformanceTracker` watches
realized PnL, win rate and peak-to-trough drawdown per strategy. A strategy that
breaches `STRATEGY_FEEDBACK_MAX_DRAWDOWN_USDT` or falls below
`STRATEGY_FEEDBACK_MIN_WIN_RATE` (after `STRATEGY_FEEDBACK_MIN_TRADES`) is
**quarantined**: `StrategyEngine` stops routing candles and ticks to it.

Quarantine persists across restarts. Lifting one is an operator action via
`POST /api/v1/strategies/:id/release` — the system never re-enables a strategy
on its own, because a strategy that "recovers" while shut off has not
demonstrated anything.

---

## ema-trend-5m — EMA Trend

Long/short trend following on 5m candles.

- Computes EMA(fast) vs EMA(slow) on closes.
- Filters with RSI: only long when RSI is not overbought, only short when not oversold.
- Cooldown: 300 s.

Tuning (env): `EMA_FAST_PERIOD`, `EMA_SLOW_PERIOD`, `EMA_RSI_UPPER`, `EMA_RSI_LOWER`.

## breakout-15m — Breakout

Channel breakout on 15m candles with ATR-based brackets.

- Tracks rolling high/low over `lookback` candles (default 20).
- Buys on close above channel high; sells on close below channel low.
- Stop-loss = entry ∓ `atrStopMultiplier × ATR(14)`; take-profit = entry ± `atrTakeProfitMultiplier × ATR(14)`.
- Cooldown: 300 s.

Tuning (env): `BREAKOUT_LOOKBACK`, `BREAKOUT_ATR_STOP_MULT`, `BREAKOUT_ATR_TP_MULT`.

## rsi-mean-reversion-5m — RSI Mean Reversion

Fades RSI extremes on 5m candles.

- Buys when RSI(14) ≤ `oversold` (30), sells when RSI ≥ `overbought` (70).
- Exits when RSI returns to the neutral band (`neutralLow` 45 / `neutralHigh` 55).
- Cooldown: 300 s.

Tuning (env): `RSI_OVERSOLD`, `RSI_OVERBOUGHT`, `RSI_NEUTRAL_HIGH`, `RSI_NEUTRAL_LOW`.

## momentum-5m — Momentum

Premium/momentum trading on 5m candles (port from the legacy engine).

- Computes the premium `last − mark` on the current market state: trades long when `last > mark`, short when `last < mark`.
- Only opens when flat (no open position) and available balance ≥ 100 USDT.
- Cooldown: 300 s.

## grid-15m — Grid

Static limit-order ladder around the mid-price on 15m candles (port from the legacy engine).

- Places `gridLevels` (5) buy and sell limit orders spaced `gridSpacing` (0.5%) apart at `baseQty` (0.5) each.
- Uses `StrategyContext.submitOrder` for direct order placement.
- Re-arms the ladder after fills/cancellations.

## mean-reversion-5m — Mean Reversion

Bollinger-style fade of the mark price on 5m candles (port from the legacy engine).

- Computes the mean and standard deviation of the last `lookbackPeriods` (20) closes.
- Buys when `mark ≤ mean − 2σ`, sells when `mark ≥ mean + 2σ`; only when flat.
- Cooldown: 300 s.

## ollama-trend-5m — Ollama Trend

LLM-assisted trend confirmation on 5m candles.

- Computes EMA(9)/EMA(21), ATR(14), RSI(14) and recent price action, and asks the configured Ollama model for a structured BUY/SELL/HOLD recommendation with a confidence score.
- Registered only when the model responds to a startup ping (`OLLAMA_MODEL` must be loaded in Ollama).
- Cooldown: 300 s.

---

## Signal contract

Signals are validated against `SignalActionSchema`:

```ts
{ action: 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE_LONG' | 'CLOSE_SHORT' | 'HOLD' | 'CANCEL_ALL', symbol: string, confidence: number, reason: string, stopLossPrice?: number, takeProfitPrice?: number, ttlMs?: number }
```

Engine rules: per-strategy cooldown enforced; confidence below threshold → `REJECTED`; signals older than their TTL (default 60 s) at execution → expired; duplicate conflicting actions on the same symbol within the window are deduplicated. Statuses: `CREATED` → `ACCEPTED` → `EXECUTED` / `REJECTED`.