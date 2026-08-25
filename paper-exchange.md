> **Status: research transcript, not a specification.**
>
> This file is a captured design conversation, kept for provenance. It does
> **not** describe current behaviour and is not maintained against the code.
> For what the system actually does today see `PROJECT_STATE.md`,
> `KNOWN_LIMITATIONS.md`, and the source.

---

**Yes, `@shubhamtaywade82/binance-client-ts` provides near 1:1 coverage of the entire Binance USDⓈ-M Futures API catalog you listed.**

The SDK was explicitly designed to wrap these exact endpoints with Zod-validated TypeScript schemas. For your local paper engine, this means you will rarely need to write raw HTTP requests or use `binance-cli` for programmatic execution—the SDK handles the complexity under the hood.

Here is how the endpoints you listed map to the SDK's architecture:

### 1. Account & Configuration (`FuturesAccount.ts`)

The SDK groups all user-specific data and configuration into the `client.futures.account` namespace.

* **Balance & Risk:** `client.futures.account.balanceV3()`, `client.futures.account.accountV3()`, `client.futures.account.positionRiskV3()`
* **Fees & Limits:** `client.futures.account.commissionRate('BTCUSDT')`, `client.futures.account.leverageBrackets('BTCUSDT')`
* **Configuration:** `client.futures.account.accountConfig()`, `client.futures.account.multiAssetsMargin()`, `client.futures.account.feeBurnStatus()`
* **History Downloads:** `client.futures.account.requestOrderDownload()` and `client.futures.account.getOrderDownloadStatus()` (maps to the `/asyn` endpoints).

### 2. Market Data (`FuturesMarket.ts` & `FuturesData.ts`)

Public data is split between real-time market state and historical/statistical data.

* **Prices & Order Book:** `client.futures.market.tickerPriceV2('SOLUSDT')`, `client.futures.market.bookTickerV2('SOLUSDT')`, `client.futures.market.rpiDepth('XRPUSDT')`
* **Klines:** `client.futures.market.continuousKlines('ETHUSDT', 'PERPETUAL', '15m')`, `client.futures.market.markPriceKlines()`
* **Derivatives Data:** `client.futures.data.openInterest('SOLUSDT')`, `client.futures.data.fundingRateHistory('ETHUSDT')`, `client.futures.data.topLongShortAccountRatio()`
* *Note:* Basic endpoints like `/ping` and `/time` are handled internally by the SDK's `HttpClient` for latency tracking and clock synchronization, rather than being exposed as user-facing methods.

### 3. Trade & Execution (`FuturesTrading.ts` & `FuturesOps.ts`)

This is the core of your paper engine's execution layer.

* **Standard Orders:** `client.futures.trading.createOrder()`, `client.futures.trading.modifyOrder()` (PUT), `client.futures.trading.cancelOrder()`
* **Batch Operations:** `client.futures.trading.placeBatchOrders()`, `client.futures.trading.cancelAllOpenOrders()`
* **Algo Orders:** `client.futures.trading.createAlgoOrder()`, `client.futures.trading.cancelAlgoOrder()`
* **Leverage & Margin:** `client.futures.trading.changeLeverage('BTCUSDT', 10)`, `client.futures.trading.modifyPositionMargin()`
* **Composite Operations (`FuturesOps`):** The SDK includes high-level helpers like `client.futures.ops.sizePosition()` and `client.futures.ops.placeBracketOrder()` which abstract away the math of calculating step sizes and stop-loss prices.

### 4. Convert & Portfolio Margin

* **Convert:** `client.futures.trading.convertGetQuote()`, `client.futures.trading.convertAcceptQuote()`
* **Portfolio Margin:** `client.futures.account.pmAccountInfo()`

### 5. User Data Streams (`UserDataStream.ts`)

The SDK automates the lifecycle of the `listenKey`:

* `client.startUserStream()`
* `client.keepAliveUserStream()`
* `client.closeUserStream()`

---

### Advanced Feature: Built-in MCP Server

A unique feature of `@shubhamtaywade82/binance-client-ts` is that it includes a `src/mcp/` directory. This means the SDK **can be run as its own MCP Server**.

If you configure your AI coding assistant (Cursor, Claude, etc.) to connect to this SDK's MCP server, your AI agent will have direct access to tools like `futures-market-data` and `futures-trading`. This allows your AI co-pilot to:

1. Query the real-time order book for XRPUSDT to verify your paper engine's matching logic.
2. Fetch your current testnet positions via `positionRiskV3()` to ensure your local `positions.json` is perfectly synchronized with the Binance Testnet.

### Summary for your Paper Engine Setup

You have everything you need in this single package:

1. **Initialize:** `const client = new BinanceClient({ testnet: true });`
2. **Stream:** Use `client.futures.ws.subscribe([...])` for real-time SOL/ETH/XRP data.
3. **Execute:** Use `client.futures.trading.createOrder()` to send paper trades to the testnet.
4. **Audit:** Use the SDK's MCP tools to let your local AI verify that your paper engine's state matches the testnet reality.
5.

Because the Binance REST API only allows querying **one interval per request**, you cannot fetch multiple timeframes in a single HTTP call. However, you can achieve this efficiently using **concurrent requests (`Promise.all`)** for historical data, and **combined WebSocket streams** for real-time updates in your paper engine.

Here is exactly how to do both using `@shubhamtaywade82/binance-client-ts`.

### 1. REST API: Fetching Historical OHLC (Hydration & Indicators)

When your paper engine starts up, you need historical candles to calculate indicators (like EMA, RSI, or ATR). You should use `Promise.allSettled` to fetch all timeframes simultaneously without blocking the main thread.

```typescript
import { BinanceClient } from '@shubhamtaywade82/binance-client-ts';

const client = new BinanceClient({ testnet: true });

async function fetchMultipleTimeframes(symbol: string) {
  // Define the timeframes you want
  const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];
  const limit = 500; // Number of candles to fetch per timeframe

  console.log(`Fetching historical OHLC for ${symbol} across ${timeframes.length} timeframes...`);

  // Create an array of Promises for continuousKlines
  const promises = timeframes.map(interval =>
    client.futures.market.continuousKlines(symbol, 'PERPETUAL', interval, { limit })
  );

  // Fire them all at once
  const results = await Promise.allSettled(promises);

  // Structure the data into a clean dictionary
  const ohlcData: Record<string, any[]> = {};

  results.forEach((result, index) => {
    const interval = timeframes[index];
    if (result.status === 'fulfilled') {
      // The SDK's Zod schema automatically parses Binance's raw arrays
      // into typed objects (e.g., { openTime, open, high, low, close, volume })
      ohlcData[interval] = result.value;
    } else {
      console.error(`Failed to fetch ${interval}:`, result.reason);
      ohlcData[interval] = [];
    }
  });

  return ohlcData;
}

// Usage:
// const solKlines = await fetchMultipleTimeframes('SOLUSDT');
// console.log(solKlines['1h'][0].close); // Typed and ready for your indicator math
```

### 2. WebSocket: Real-Time OHLC Updates (For Live Paper Engine)

REST calls are too slow for a live paper engine. To keep your local candle states updated in real-time across multiple timeframes, you subscribe to multiple **combined WebSocket streams**.

The SDK handles the multiplexing under the hood. You just pass an array of stream generators to `subscribe()`.

```typescript
const symbols = ['SOLUSDT', 'ETHUSDT', 'XRPUSDT'];
const timeframes = ['1m', '5m', '15m'];

// 1. Generate an array of WebSocket stream subscription strings
const streams: string[] = [];
for (const symbol of symbols) {
  for (const interval of timeframes) {
    // This generates the correct stream name, e.g., "solusdt@kline_1m"
    streams.push(client.futures.ws.kline(symbol, interval));
  }
}

console.log(`Subscribing to ${streams.length} real-time kline streams...`);

// 2. Subscribe to all of them at once via the combined stream
client.futures.ws.subscribe(streams);

// 3. Listen for incoming real-time candle updates
client.futures.ws.on('message', (streamName, payload) => {
  // payload is Zod-validated and contains the live candle state
  const {
    symbol,
    interval,
    open,
    high,
    low,
    close,
    volume,
    isKlineClosed
  } = payload.k; // The 'k' object holds the kline data

  // Update your local paper engine state
  if (isKlineClosed) {
    console.log(`[${symbol} ${interval}] Candle closed: Close = ${close}`);
    // Trigger your trading logic/indicator recalculation here
  } else {
    // Just update the current live wick/price
    // console.log(`[${symbol} ${interval}] Live update: High = ${high}, Low = ${low}`);
  }
});

// Optional: Handle connection errors or auto-reconnects
client.futures.ws.on('error', (err) => console.error('WS Error:', err));
```

### Pro-Tip: Mark Price vs. Last Price

For a USDⓈ-M Futures paper engine, you should be careful about *which* OHLC data you use:

* **`continuousKlines` / `kline` WebSocket:** Uses the **Last Traded Price**. This is subject to sudden wicks and manipulation (scam wicks).
* **`markPriceKlines` / `markPrice` WebSocket:** Uses the **Mark Price** (an index of spot prices + funding basis).

If your paper engine is calculating liquidations or stop-losses, it is highly recommended to use **Mark Price** klines to prevent your engine from being stopped out by temporary flash crashes that don't reflect the actual market index.

To use Mark Price klines via REST:

```typescript
client.futures.market.markPriceKlines('SOLUSDT', '1h', { limit: 500 })
```

To stream real-time prices for your local paper engine using `@shubhamtaywade82/binance-client-ts`, you need to use the WebSocket market data streams.

For USDⓈ-M Futures (SOL, ETH, XRP), there are **three main types of price streams** you should care about. Here is how to connect to them and extract the exact data you need.

### 1. Choose the Right Price Stream

Depending on what your paper engine needs to calculate, you will subscribe to different streams:

1. **`aggTrade` (Tick-by-Tick Trades):** Streams every single executed trade. Best for simulating exact market orders and calculating the `lastPrice`.
2. **`bookTicker` (Best Bid/Ask):** Streams the highest bid and lowest ask in real-time. Best for simulating limit orders, calculating the spread, and finding the `midPrice`.
3. **`markPrice` (Index Price):** Streams the mark price, index price, and funding rate. **Crucial for Futures** because this is the price Binance uses to calculate Unrealized PnL and trigger liquidations (protects your engine from "scam wicks" on the order book).

---

### 2. The Implementation Code

Here is the complete TypeScript setup to stream all three price types for SOL, ETH, and XRP simultaneously.

```typescript
import { BinanceClient } from '@shubhamtaywade82/binance-client-ts';

// Initialize the client (Testnet for paper trading)
const client = new BinanceClient({ testnet: true });

const symbols = ['SOLUSDT', 'ETHUSDT', 'XRPUSDT'];

// 1. Build your stream subscriptions
const streams: string[] = [];

for (const symbol of symbols) {
  // Tick-by-tick trades (Last Price)
  streams.push(client.futures.ws.aggTrade(symbol));

  // Best Bid/Ask (Order Book Top)
  streams.push(client.futures.ws.bookTicker(symbol));

  // Mark Price (Updates every 1 second. Use '1s' for high frequency)
  streams.push(client.futures.ws.markPrice(symbol, '1s'));
}

console.log(`Connecting to ${streams.length} real-time streams...`);

// 2. Subscribe to all streams at once via the Combined Stream
client.futures.ws.subscribe(streams);

// 3. Listen for incoming messages
client.futures.ws.on('message', (streamName, payload) => {

  // The SDK automatically parses the raw JSON into Zod-validated objects.

  if (streamName.includes('@aggTrade')) {
    // payload is typed as AggTrade
    console.log(`[TRADE] ${payload.s} | Price: ${payload.p} | Qty: ${payload.q}`);

    // Update your paper engine's Last Price state
    // engine.updateLastPrice(payload.s, parseFloat(payload.p));

  } else if (streamName.includes('@bookTicker')) {
    // payload is typed as BookTicker
    const bid = parseFloat(payload.b);
    const ask = parseFloat(payload.a);
    const midPrice = (bid + ask) / 2;

    // console.log(`[BOOK] ${payload.s} | Bid: ${bid} | Ask: ${ask} | Mid: ${midPrice}`);

    // Update your paper engine's Order Book state
    // engine.updateOrderBook(payload.s, bid, ask);

  } else if (streamName.includes('@markPrice')) {
    // payload is typed as MarkPrice
    const markPrice = parseFloat(payload.p);
    const indexPrice = parseFloat(payload.i);
    const fundingRate = parseFloat(payload.r);

    // console.log(`[MARK] ${payload.s} | Mark: ${markPrice} | Index: ${indexPrice} | FR: ${fundingRate}`);

    // Update your paper engine's Mark Price state (Used for PnL & Liquidation checks)
    // engine.updateMarkPrice(payload.s, markPrice);
  }
});

// 4. Handle Connection Lifecycle
client.futures.ws.on('open', () => console.log('WebSocket Connected!'));
client.futures.ws.on('error', (err) => console.error('WebSocket Error:', err));
client.futures.ws.on('close', () => console.log('WebSocket Disconnected. SDK will auto-reconnect...'));
```

---

### 3. Streaming User Data (Orders, Balances, Positions)

For a paper engine, you also need to know when your testnet orders are filled or when your margin balance changes. The SDK handles the complex `listenKey` lifecycle (creation and keep-alive pings) automatically.

```typescript
// Start the User Data Stream
await client.startUserStream();

// Listen for Account Updates (Balance & Position changes)
client.futures.wsUser.on('ACCOUNT_UPDATE', (event) => {
  // event.a.B contains your wallet balances
  // event.a.P contains your open positions and unrealized PnL
  console.log('Account Update:', event.a);

  // Sync your local paper engine's virtual balance with the testnet
  // engine.syncBalance(event.a.B);
});

// Listen for Order Trade Updates (Fills, Cancellations)
client.futures.wsUser.on('ORDER_TRADE_UPDATE', (event) => {
  const order = event.o;
  console.log(`Order Update: ${order.s} | Status: ${order.X} | Filled: ${order.z}`);

  // If an order is filled, update your paper engine's open positions
  // if (order.X === 'FILLED') engine.handleFill(order);
});
```

### Pro-Tips for your Paper Engine Architecture

1. **Debounce / Throttle:** `aggTrade` and `bookTicker` are *extremely* high frequency (hundreds of messages per second for SOL/ETH). Do not write to your database or recalculate heavy indicators on every single tick. Buffer the ticks in memory and update your UI/Database every 100ms or 500ms.
2. **Use Mark Price for PnL:** In your paper engine's logic, **always** calculate Unrealized PnL using the `markPrice` stream, not the `aggTrade` (last price). This exactly mimics how Binance calculates real liquidations.
3. **Auto-Reconnection:** The `@shubhamtaywade82/binance-client-ts` SDK has built-in auto-reconnection logic. If your local network drops, the SDK will reconnect and automatically re-subscribe to your streams. Just listen for the `close` event to log warnings to your console.

To wire Binance USDⓈ‑M Futures WebSockets into a **local paper trading engine**, you need an event-driven system with 5 core parts:

1. **Market data ingestion** — WebSocket streams for price/order book/mark price.
2. **Local market state** — normalized latest bid/ask/last/mark per symbol.
3. **Paper order gateway** — accepts order intents and applies risk checks.
4. **Simulated execution engine** — fills orders using your market state and slippage/fee model.
5. **Accounting engine** — tracks balances, positions, margin, PnL, funding, fees.

If you are using **market data only**, you do **not** need Binance API keys. Your paper engine simulates fills locally. If you later want to mirror orders to Binance Testnet, then you need testnet API keys and REST trading endpoints.

---

## 1. High-level architecture

```text
Binance USD-M Futures
        │
        │ WebSocket streams
        ▼
Market Data Normalizer
        │
        │ MarketState updates: bid/ask/last/mark/funding
        ▼
Paper Engine Event Bus
        │
        ├── Order Risk Gateway
        ├── Simulated Matching Engine
        ├── Position / Margin / PnL Engine
        ├── Funding / Fee Engine
        ├── Persistence / Event Log
        └── Strategy / AI Agent Interface
```

Your strategy or AI agent should only emit **order intents**. The paper engine decides whether the order is accepted, rejected, filled, or rested.

---

## 2. Required Binance data

For SOLUSDT, ETHUSDT, XRPUSDT you need both REST bootstrap data and WebSocket updates.

### A. REST bootstrap data

Before streaming, fetch static and initial data:

| Purpose | Binance data | Why needed |
| --- | --- | --- |
| Symbol filters | `exchangeInfo` | tick size, step size, min qty, min notional, price precision |
| Leverage brackets | `leverageBracket` | maintenance margin, max leverage |
| Mark price | `premiumIndex` or mark price endpoint | PnL and liquidation checks |
| Funding rate | `fundingInfo` / `fundingRate` | simulate funding payments |
| Order book snapshot | `depth` | optional but recommended for realistic fills |
| Klines | `klines` / `continuousKlines` | indicators, backtest state hydration |

With your library, examples:

```ts
const exchangeInfo = await client.futures.market.instrumentDetails('SOLUSDT');
const mark = await client.futures.data.premiumIndex('SOLUSDT');
const funding = await client.futures.data.fundingInfo();
const depth = await client.futures.market.orderBook('SOLUSDT', 20);
```

### B. WebSocket streams

For a paper engine, stream at least these:

| Stream | Use |
| --- | --- |
| `bookTicker` | best bid/ask, fastest for order matching |
| `aggTrade` | last traded price, trade tape |
| `markPrice` | mark price, index price, funding rate |
| `kline` | optional, if your strategy uses candles |
| user data stream | optional, only if mirroring Binance Testnet orders |

For a realistic futures paper engine, `bookTicker` + `markPrice` are the most important.

---

## 3. Required local state

You need state for each symbol and each account.

### Market state per symbol

```ts
interface MarketState {
  symbol: string;

  bid?: number;
  ask?: number;

  last?: number;
  lastQty?: number;

  markPrice?: number;
  indexPrice?: number;
  fundingRate?: number;

  exchangeTs?: number;
  localTs: number;

  stale: boolean;
}
```

### Order state

```ts
type OrderSide = 'BUY' | 'SELL';
type OrderType = 'MARKET' | 'LIMIT';
type OrderStatus =
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'REJECTED';

interface PaperOrder {
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;

  quantity: number;
  filledQty: number;

  price?: number;

  reduceOnly: boolean;
  postOnly: boolean;

  status: OrderStatus;

  createdAt: number;
  updatedAt: number;

  rejectReason?: string;
}
```

### Position state

For a simple paper engine, use **net position**:

* positive quantity = long
* negative quantity = short

```ts
interface PaperPosition {
  symbol: string;

  qty: number;              // signed
  entryPrice: number;

  leverage: number;
  marginType: 'CROSSED' | 'ISOLATED';

  unrealizedPnl: number;
  realizedPnl: number;

  updatedAt: number;
}
```

### Account state

```ts
interface PaperAccount {
  walletBalance: number;     // USDT
  marginBalance: number;
  unrealizedPnl: number;
  availableBalance: number;

  totalFeesPaid: number;
  totalFundingPaid: number;
}
```

---

## 4. Required engine components

### A. Market data normalizer

WebSocket payloads must be converted into one internal format.

Example:

```ts
function normalizeBookTicker(payload: any): Partial<MarketState> {
  return {
    symbol: payload.s,
    bid: Number(payload.b),
    ask: Number(payload.a),
    localTs: Date.now(),
  };
}

function normalizeMarkPrice(payload: any): Partial<MarketState> {
  return {
    symbol: payload.s,
    markPrice: Number(payload.p),
    indexPrice: Number(payload.i),
    fundingRate: Number(payload.r),
    localTs: Date.now(),
  };
}

function normalizeAggTrade(payload: any): Partial<MarketState> {
  return {
    symbol: payload.s,
    last: Number(payload.p),
    lastQty: Number(payload.q),
    localTs: Date.now(),
  };
}
```

### B. Paper matching engine

This is the core. It decides fills.

#### Market orders

For a market order:

* BUY fills against ask
* SELL fills against bid

Add slippage if you do not walk the real order book.

```ts
const slippageBps = 2; // 0.02%

function marketFillPrice(
  side: OrderSide,
  market: MarketState
): number {
  if (side === 'BUY') {
    if (!market.ask) throw new Error('No ask price');
    return market.ask * (1 + slippageBps / 10_000);
  } else {
    if (!market.bid) throw new Error('No bid price');
    return market.bid * (1 - slippageBps / 10_000);
  }
}
```

#### Limit orders

For limit orders:

* BUY fills when `ask <= limitPrice`
* SELL fills when `bid >= limitPrice`

```ts
function isLimitMarketable(
  order: PaperOrder,
  market: MarketState
): boolean {
  if (!order.price) return false;

  if (order.side === 'BUY') {
    return !!market.ask && market.ask <= order.price;
  }

  return !!market.bid && market.bid >= order.price;
}
```

#### Post-only behavior

If an order is `postOnly` and it would fill immediately, reject or cancel it.

```ts
if (order.postOnly && isLimitMarketable(order, market)) {
  order.status = 'REJECTED';
  order.rejectReason = 'POST_ONLY_WOULD_FILL';
  return;
}
```

---

## 5. Required accounting model

Binance USDⓈ‑M futures are linear USDT-margined contracts.

### Notional

```ts
notional = abs(quantity) * price
```

### Unrealized PnL

For long:

```ts
unrealizedPnl = qty * (markPrice - entryPrice)
```

For short, if `qty` is negative:

```ts
unrealizedPnl = qty * (markPrice - entryPrice)
```

Using signed quantity works for both:

```ts
function unrealizedPnl(
  qty: number,
  entryPrice: number,
  markPrice: number
): number {
  return qty * (markPrice - entryPrice);
}
```

### Realized PnL

When reducing a position:

```ts
realizedPnl = closedQty * (exitPrice - entryPrice) * direction
```

Where:

* long direction = `1`
* short direction = `-1`

If using signed quantity:

```ts
function realizedPnl(
  closedQty: number,
  entryPrice: number,
  exitPrice: number
): number {
  // closedQty is signed: positive for long reduction, negative for short reduction
  return closedQty * (exitPrice - entryPrice);
}
```

### Fees

Binance USDⓈ‑M fees are usually charged in USDT.

```ts
fee = notional * feeRate
```

Example:

```ts
const takerFeeRate = 0.0004; // 0.04%
const makerFeeRate = 0.0002; // 0.02%
```

### Funding

For Binance perpetual futures:

* if funding rate is positive, longs pay shorts
* if funding rate is negative, shorts pay longs

Approximate funding payment:

```ts
fundingPayment = positionNotional * fundingRate
```

For a long position:

```ts
fundingPaid = qty * markPrice * fundingRate
```

If `qty` is positive and funding is positive, the long pays.

For short, `qty` is negative, so the sign naturally reverses.

```ts
function fundingPayment(
  qty: number,
  markPrice: number,
  fundingRate: number
): number {
  return qty * markPrice * fundingRate;
}
```

### Margin

Initial margin:

```ts
initialMargin = notional / leverage
```

Maintenance margin requires Binance leverage brackets. For MVP, you can estimate it, but for accuracy you should fetch `leverageBracket`.

```ts
maintenanceMargin = notional * maintenanceMarginRate
```

---

## 6. Required risk checks

Before accepting any order, the paper engine should validate:

1. Symbol is enabled.
2. Market data is not stale.
3. Bid/ask exists.
4. Mark price exists.
5. Quantity is positive.
6. Quantity respects `stepSize`.
7. Price respects `tickSize`.
8. Order notional meets minimum.
9. Leverage is allowed.
10. Enough available margin.
11. Max position size not exceeded.
12. Max daily loss not exceeded.
13. Reduce-only orders cannot increase position.
14. Post-only orders cannot cross the book.
15. Kill switch is not active.

Example:

```ts
interface RiskResult {
  ok: boolean;
  reason?: string;
}

function checkOrderRisk(
  order: PaperOrder,
  market: MarketState,
  account: PaperAccount
): RiskResult {
  if (!market.ask || !market.bid) {
    return { ok: false, reason: 'NO_MARKET_DATA' };
  }

  if (market.stale) {
    return { ok: false, reason: 'STALE_MARKET_DATA' };
  }

  if (order.quantity <= 0) {
    return { ok: false, reason: 'INVALID_QTY' };
  }

  if (account.availableBalance <= 0) {
    return { ok: false, reason: 'NO_AVAILABLE_BALANCE' };
  }

  return { ok: true };
}
```

---

## 7. Minimal paper engine skeleton

```ts
import { randomUUID } from 'node:crypto';

type OrderSide = 'BUY' | 'SELL';
type OrderType = 'MARKET' | 'LIMIT';
type OrderStatus =
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'REJECTED';

interface MarketState {
  symbol: string;
  bid?: number;
  ask?: number;
  last?: number;
  markPrice?: number;
  fundingRate?: number;
  localTs: number;
  stale: boolean;
}

interface PaperOrder {
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  filledQty: number;
  price?: number;
  reduceOnly: boolean;
  postOnly: boolean;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
  rejectReason?: string;
}

interface PaperPosition {
  symbol: string;
  qty: number;
  entryPrice: number;
  leverage: number;
  unrealizedPnl: number;
  realizedPnl: number;
  updatedAt: number;
}

interface PaperAccount {
  walletBalance: number;
  unrealizedPnl: number;
  realizedPnl: number;
  feesPaid: number;
  fundingPaid: number;
}

class PaperEngine {
  private market = new Map<string, MarketState>();
  private orders = new Map<string, PaperOrder>();
  private positions = new Map<string, PaperPosition>();

  private account: PaperAccount = {
    walletBalance: 10_000,
    unrealizedPnl: 0,
    realizedPnl: 0,
    feesPaid: 0,
    fundingPaid: 0,
  };

  private symbols = ['SOLUSDT', 'ETHUSDT', 'XRPUSDT'];

  private takerFeeRate = 0.0004;
  private makerFeeRate = 0.0002;
  private marketSlippageBps = 2;

  updateMarket(update: Partial<MarketState> & { symbol: string }) {
    const current = this.market.get(update.symbol);

    const next: MarketState = {
      symbol: update.symbol,
      bid: update.bid ?? current?.bid,
      ask: update.ask ?? current?.ask,
      last: update.last ?? current?.last,
      markPrice: update.markPrice ?? current?.markPrice,
      fundingRate: update.fundingRate ?? current?.fundingRate,
      localTs: Date.now(),
      stale: false,
    };

    this.market.set(update.symbol, next);

    this.evaluateOpenOrders(update.symbol);
    this.updatePositionPnl(update.symbol);
  }

  submitOrder(input: {
    symbol: string;
    side: OrderSide;
    type: OrderType;
    quantity: number;
    price?: number;
    reduceOnly?: boolean;
    postOnly?: boolean;
  }): PaperOrder {
    const now = Date.now();

    const order: PaperOrder = {
      orderId: randomUUID(),
      clientOrderId: randomUUID(),
      symbol: input.symbol,
      side: input.side,
      type: input.type,
      quantity: input.quantity,
      filledQty: 0,
      price: input.price,
      reduceOnly: input.reduceOnly ?? false,
      postOnly: input.postOnly ?? false,
      status: 'NEW',
      createdAt: now,
      updatedAt: now,
    };

    this.orders.set(order.orderId, order);

    const market = this.market.get(order.symbol);

    if (!market) {
      this.rejectOrder(order, 'NO_MARKET_STATE');
      return order;
    }

    if (!market.ask || !market.bid) {
      this.rejectOrder(order, 'NO_BID_ASK');
      return order;
    }

    if (order.type === 'LIMIT' && !order.price) {
      this.rejectOrder(order, 'MISSING_LIMIT_PRICE');
      return order;
    }

    if (order.postOnly && this.wouldFillImmediately(order, market)) {
      this.rejectOrder(order, 'POST_ONLY_WOULD_FILL');
      return order;
    }

    if (order.type === 'MARKET') {
      this.fillOrder(order, market);
      return order;
    }

    if (order.type === 'LIMIT' && this.wouldFillImmediately(order, market)) {
      this.fillOrder(order, market);
      return order;
    }

    // Limit order rests in the paper book.
    return order;
  }

  private rejectOrder(order: PaperOrder, reason: string) {
    order.status = 'REJECTED';
    order.rejectReason = reason;
    order.updatedAt = Date.now();
  }

  private wouldFillImmediately(order: PaperOrder, market: MarketState): boolean {
    if (order.type === 'MARKET') return true;

    if (!order.price) return false;

    if (order.side === 'BUY') {
      return !!market.ask && market.ask <= order.price;
    }

    return !!market.bid && market.bid >= order.price;
  }

  private evaluateOpenOrders(symbol: string) {
    const market = this.market.get(symbol);
    if (!market) return;

    for (const order of this.orders.values()) {
      if (order.symbol !== symbol) continue;
      if (order.status !== 'NEW' && order.status !== 'PARTIALLY_FILLED') continue;
      if (order.type !== 'LIMIT') continue;

      if (this.wouldFillImmediately(order, market)) {
        this.fillOrder(order, market);
      }
    }
  }

  private fillOrder(order: PaperOrder, market: MarketState) {
    if (!market.ask || !market.bid) {
      this.rejectOrder(order, 'NO_BID_ASK');
      return;
    }

    const remainingQty = order.quantity - order.filledQty;

    if (remainingQty <= 0) {
      order.status = 'FILLED';
      return;
    }

    let fillPrice: number;

    if (order.type === 'MARKET') {
      fillPrice = this.getMarketFillPrice(order.side, market);
    } else {
      fillPrice = order.price!;
    }

    const feeRate = order.type === 'MARKET'
      ? this.takerFeeRate
      : this.makerFeeRate;

    const notional = remainingQty * fillPrice;
    const fee = notional * feeRate;

    this.account.feesPaid += fee;
    this.applyFillToPosition(order.symbol, order.side, remainingQty, fillPrice);

    order.filledQty += remainingQty;
    order.status = 'FILLED';
    order.updatedAt = Date.now();
  }

  private getMarketFillPrice(side: OrderSide, market: MarketState): number {
    if (side === 'BUY') {
      return market.ask! * (1 + this.marketSlippageBps / 10_000);
    }

    return market.bid! * (1 - this.marketSlippageBps / 10_000);
  }

  private applyFillToPosition(
    symbol: string,
    side: OrderSide,
    qty: number,
    price: number
  ) {
    const signedQty = side === 'BUY' ? qty : -qty;

    let position = this.positions.get(symbol);

    if (!position) {
      position = {
        symbol,
        qty: 0,
        entryPrice: 0,
        leverage: 5,
        unrealizedPnl: 0,
        realizedPnl: 0,
        updatedAt: Date.now(),
      };

      this.positions.set(symbol, position);
    }

    const oldQty = position.qty;
    const newQty = oldQty + signedQty;

    const isClosing =
      (oldQty > 0 && signedQty < 0) ||
      (oldQty < 0 && signedQty > 0);

    if (isClosing) {
      const closedQty = Math.min(Math.abs(oldQty), Math.abs(signedQty));
      const direction = oldQty > 0 ? 1 : -1;

      const realized =
        closedQty * (price - position.entryPrice) * direction;

      position.realizedPnl += realized;
      this.account.realizedPnl += realized;
    }

    if (newQty === 0) {
      position.entryPrice = 0;
    } else if (Math.sign(newQty) !== Math.sign(oldQty) && oldQty !== 0) {
      // Position flipped.
      position.entryPrice = price;
    } else if (Math.abs(newQty) > Math.abs(oldQty)) {
      // Position increased.
      const oldNotional = Math.abs(oldQty) * position.entryPrice;
      const addedNotional = Math.abs(signedQty) * price;

      position.entryPrice =
        (oldNotional + addedNotional) / Math.abs(newQty);
    }

    position.qty = newQty;
    position.updatedAt = Date.now();
  }

  private updatePositionPnl(symbol: string) {
    const position = this.positions.get(symbol);
    const market = this.market.get(symbol);

    if (!position || !market?.markPrice) return;

    if (position.qty === 0) {
      position.unrealizedPnl = 0;
      return;
    }

    position.unrealizedPnl =
      position.qty * (market.markPrice - position.entryPrice);
  }

  getState() {
    return {
      account: this.account,
      positions: Object.fromEntries(this.positions),
      orders: Object.fromEntries(this.orders),
      market: Object.fromEntries(this.market),
    };
  }
}
```

---

## 8. Wiring the WebSocket to the paper engine

```ts
import { BinanceClient } from '@shubhamtaywade82/binance-client-ts';

const client = new BinanceClient({
  testnet: true,
});

const engine = new PaperEngine();

const symbols = ['SOLUSDT', 'ETHUSDT', 'XRPUSDT'];

const streams: string[] = [];

for (const symbol of symbols) {
  streams.push(
    client.futures.ws.bookTicker(symbol),
    client.futures.ws.aggTrade(symbol),
    client.futures.ws.markPrice(symbol, '1s')
  );
}

client.futures.ws.subscribe(streams);

client.futures.ws.on('message', (streamName, payload) => {
  if (streamName.includes('@bookTicker')) {
    engine.updateMarket({
      symbol: payload.s,
      bid: Number(payload.b),
      ask: Number(payload.a),
    });
  }

  if (streamName.includes('@aggTrade')) {
    engine.updateMarket({
      symbol: payload.s,
      last: Number(payload.p),
    });
  }

  if (streamName.includes('@markPrice')) {
    engine.updateMarket({
      symbol: payload.s,
      markPrice: Number(payload.p),
      indexPrice: Number(payload.i),
      fundingRate: Number(payload.r),
    });
  }
});

client.futures.ws.on('open', () => {
  console.log('Binance WS connected');
});

client.futures.ws.on('error', (err) => {
  console.error('Binance WS error', err);
});

client.futures.ws.on('close', () => {
  console.warn('Binance WS closed');
});
```

---

## 9. Required bootstrap before WebSocket trading

Do not start matching orders until you have fetched static exchange rules.

```ts
async function bootstrap(engine: PaperEngine) {
  const symbols = ['SOLUSDT', 'ETHUSDT', 'XRPUSDT'];

  for (const symbol of symbols) {
    const info = await client.futures.market.instrumentDetails(symbol);
    const mark = await client.futures.data.premiumIndex(symbol);
    const funding = await client.futures.data.fundingInfo();

    // Store filters: tickSize, stepSize, minQty, minNotional, etc.
    // You should keep these in a SymbolRules map.
    console.log('Bootstrap', symbol, info, mark, funding);
  }
}
```

You need `SymbolRules` per symbol:

```ts
interface SymbolRules {
  symbol: string;
  tickSize: number;
  stepSize: number;
  minQty: number;
  maxQty?: number;
  minNotional: number;
  pricePrecision: number;
  quantityPrecision: number;
}
```

Use these rules to round orders before submitting:

```ts
function roundStep(value: number, stepSize: number): number {
  return Math.floor(value / stepSize) * stepSize;
}

function roundTick(value: number, tickSize: number): number {
  return Math.round(value / tickSize) * tickSize;
}
```

---

## 10. Required persistence

For a serious paper engine, do not keep state only in memory.

Use one of:

* SQLite, best for local paper trading
* JSONL event log
* Postgres, if you want a server setup

Recommended design:

### Event log

Append every event:

```json
{ "type": "MARKET_UPDATE", "symbol": "SOLUSDT", "bid": 145.1, "ask": 145.2, "ts": 1700000000000 }
{ "type": "ORDER_SUBMIT", "orderId": "abc", "symbol": "SOLUSDT", "side": "BUY", "qty": 1 }
{ "type": "ORDER_FILL", "orderId": "abc", "price": 145.2, "qty": 1, "fee": 0.05808 }
{ "type": "POSITION_UPDATE", "symbol": "SOLUSDT", "qty": 1, "entryPrice": 145.2 }
```

### Snapshot

Periodically write:

```json
{
  "account": { "walletBalance": 10000 },
  "positions": { "SOLUSDT": { "qty": 1, "entryPrice": 145.2 } },
  "openOrders": []
}
```

This gives you replayability.

---

## 11. Required timing logic

Your paper engine needs timers.

### Every tick

* update market state
* evaluate open limit orders
* update unrealized PnL

### Every second

* update mark price state
* check stale data
* update margin ratio

### Every funding interval

* apply funding payments
* log funding event

Binance funding is usually every 8 hours, but the funding rate stream updates continuously. For paper trading, you can apply funding at funding timestamps.

```ts
function shouldApplyFunding(lastApplied: number, now: number): boolean {
  const eightHoursMs = 8 * 60 * 60 * 1000;
  return now - lastApplied >= eightHoursMs;
}
```

---

## 12. Required stale-data handling

If WebSocket disconnects or stops sending updates, your paper engine should stop opening new orders.

```ts
function isMarketStale(market: MarketState): boolean {
  const maxAgeMs = 5_000;
  return Date.now() - market.localTs > maxAgeMs;
}
```

If stale:

* reject new orders
* optionally cancel resting orders
* optionally flatten positions
* emit warning event

---

## 13. Required strategy interface

Your strategy should not touch WebSocket payloads directly.

Use a clean interface:

```ts
interface StrategyContext {
  getMarket(symbol: string): MarketState | undefined;
  getPosition(symbol: string): PaperPosition | undefined;
  getAccount(): PaperAccount;
  submitOrder(order: OrderIntent): PaperOrder;
}

interface OrderIntent {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
  reduceOnly?: boolean;
  postOnly?: boolean;
}
```

Example strategy:

```ts
function momentumStrategy(ctx: StrategyContext) {
  const market = ctx.getMarket('SOLUSDT');
  const position = ctx.getPosition('SOLUSDT');

  if (!market?.ask || !market?.bid || !market.markPrice) return;
  if (position && position.qty !== 0) return;

  // Example only.
  if (market.last && market.markPrice && market.last > market.markPrice) {
    ctx.submitOrder({
      symbol: 'SOLUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 1,
    });
  }
}
```

If you use Ollama/AI, the LLM should output only an `OrderIntent` through a Zod schema. The deterministic paper engine validates it.

---

## 14. Required risk engine

Do not let the strategy send raw orders directly.

Use this flow:

```text
Strategy/AI -> OrderIntent -> Zod validation -> Risk engine -> Paper engine
```

Risk limits to implement:

```ts
interface RiskLimits {
  maxLeverage: number;
  maxPositionNotional: number;
  maxDailyLoss: number;
  maxOpenOrders: number;
  maxOrderNotional: number;
  allowReduceOnly: boolean;
  allowMarketOrders: boolean;
  allowLimitOrders: boolean;
}
```

Example:

```ts
const limits: RiskLimits = {
  maxLeverage: 5,
  maxPositionNotional: 1000,
  maxDailyLoss: 200,
  maxOpenOrders: 10,
  maxOrderNotional: 250,
  allowReduceOnly: true,
  allowMarketOrders: true,
  allowLimitOrders: true,
};
```

---

## 15. Required observability

You need logs and metrics.

Log:

* market updates
* order submit
* order reject
* order fill
* position change
* funding payment
* PnL snapshot
* WebSocket disconnect
* stale data events

Track:

* equity curve
* realized PnL
* unrealized PnL
* fees paid
* funding paid
* win rate
* max drawdown
* order reject rate
* fill slippage
* WebSocket latency

Use a simple logger:

```ts
import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-pretty',
  },
});
```

---

## 16. Minimum viable paper engine

For MVP, you need:

1. WebSocket subscription for SOL/ETH/XRP.
2. Local market state for bid/ask/mark.
3. Paper account with USDT balance.
4. Net position per symbol.
5. Market order fills using ask/bid plus slippage.
6. Limit order fills when price crosses.
7. Fee deduction.
8. Unrealized PnL using mark price.
9. SQLite or JSONL persistence.
10. Basic risk checks.

That is enough to paper trade.

---

## 17. Production-grade additions

For a more realistic engine, add:

1. Real order book depth.
2. Order book walking for large orders.
3. Partial fills.
4. Maker/taker fee distinction.
5. Funding payments at exact funding timestamps.
6. Maintenance margin and liquidation simulation.
7. ADL simulation.
8. Position mode: one-way vs hedge mode.
9. Binance Testnet reconciliation.
10. Deterministic event replay.
11. Backtesting mode.
12. Shadow mode: live market data, paper orders.

---

## 18. Important design rule

Your paper engine should be deterministic.

This means:

```text
Same event sequence + same engine state = same trading result
```

To achieve this:

* do not use `Date.now()` inside core matching logic unless the timestamp comes from the event
* do not let async race conditions decide fills
* keep all state changes inside the engine
* log every input event
* make strategy decisions based only on engine state

---

## 19. Recommended file structure

```text
paper-engine/
├── src/
│   ├── config/
│   │   └── symbols.ts
│   ├── binance/
│   │   ├── client.ts
│   │   ├── streams.ts
│   │   └── bootstrap.ts
│   ├── engine/
│   │   ├── PaperEngine.ts
│   │   ├── MatchingEngine.ts
│   │   ├── AccountEngine.ts
│   │   ├── PositionEngine.ts
│   │   ├── RiskEngine.ts
│   │   └── FundingEngine.ts
│   ├── market/
│   │   ├── MarketState.ts
│   │   └── normalizers.ts
│   ├── strategy/
│   │   ├── Strategy.ts
│   │   └── strategies/
│   ├── persistence/
│   │   ├── EventLog.ts
│   │   └── SnapshotStore.ts
│   ├── telemetry/
│   │   └── logger.ts
│   └── index.ts
├── data/
│   ├── events.jsonl
│   └── snapshots/
├── package.json
└── tsconfig.json
```

---

## 20. Final checklist

To wire WebSocket to a paper engine, you need:

### Market data

* [ ] `exchangeInfo` for symbol filters
* [ ] `bookTicker` for bid/ask
* [ ] `aggTrade` for last price
* [ ] `markPrice` for PnL/funding/liquidation
* [ ] optional `depth` for realistic fills
* [ ] optional `kline` for indicator strategies

### Engine

* [ ] normalized market state
* [ ] order model
* [ ] position model
* [ ] account model
* [ ] fee model
* [ ] slippage model
* [ ] funding model
* [ ] risk checks
* [ ] persistence
* [ ] event logging

### Operations

* [ ] WebSocket reconnect handling
* [ ] stale market data detection
* [ ] kill switch
* [ ] daily loss limit
* [ ] max position limit
* [ ] local SQLite/JSONL storage
* [ ] PnL reporting
* [ ] strategy interface separated from execution

In short: use WebSocket only as the market data source. Keep the paper engine fully local and deterministic. Use `bookTicker` and `markPrice` as your primary inputs, simulate fills against bid/ask with slippage and fees, and track positions/PnL using mark price.

Below is a **production-shaped local paper trading engine** for Binance USDⓈ-M Futures. It is designed like a small broker core:

* demo/paper wallet
* order lifecycle
* fills
* positions
* margin
* unrealized/realized PnL
* fees
* funding
* risk checks
* liquidation-style protection
* event log
* WebSocket market-data wiring

This is written for your stack:

* `SOLUSDT`
* `ETHUSDT`
* `XRPUSDT`
* Binance USDⓈ-M Futures
* WebSocket market data
* local paper execution
* `@shubhamtaywade82/binance-client-ts`

---

# 1. Production architecture

```text
Strategy / AI Agent
        │
        │ OrderIntent
        ▼
Zod Validation
        │
        ▼
Risk Engine
        │
        ▼
Paper Broker Core
        │
        ├── Wallet Engine
        ├── Order Engine
        ├── Matching Engine
        ├── Position Engine
        ├── Margin Engine
        ├── Funding Engine
        ├── Liquidation Engine
        ├── Event Log
        └── Snapshot Store
        ▲
        │
Market Data Normalizer
        ▲
        │
Binance USD-M WebSocket
        │
        ├── bookTicker
        ├── aggTrade
        ├── markPrice
        └── optional depth/kline
```

Important rule:

> The strategy does not trade directly.
> It submits an order intent.
> The broker engine decides accept/reject/fill/cancel.

---

# 2. Required domain models

You need these core objects:

## Wallet

```ts
interface Wallet {
  USDT: number;
}
```

For USDⓈ-M futures, your demo wallet is usually USDT.

## Instrument

```ts
interface Instrument {
  symbol: string;

  tickSize: number;
  stepSize: number;

  minQty: number;
  minNotional: number;

  maintenanceMarginRate: number;
}
```

You should fetch these from Binance `exchangeInfo` and `leverageBracket`.

## Market state

```ts
interface MarketState {
  symbol: string;

  bid?: number;
  ask?: number;

  last?: number;
  mark?: number;
  index?: number;

  fundingRate?: number;

  localTs: number;
  stale: boolean;
}
```

## Order

```ts
type OrderSide = 'BUY' | 'SELL';

type OrderType =
  | 'MARKET'
  | 'LIMIT'
  | 'STOP_MARKET';

type OrderStatus =
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'REJECTED';

type TimeInForce =
  | 'GTC'
  | 'IOC'
  | 'FOK';

interface Order {
  id: string;
  clientOrderId: string;

  symbol: string;
  side: OrderSide;
  type: OrderType;
  timeInForce: TimeInForce;

  quantity: number;
  filledQty: number;

  price?: number;
  stopPrice?: number;

  avgPrice: number;

  leverage: number;

  reduceOnly: boolean;
  postOnly: boolean;

  status: OrderStatus;
  rejectReason?: string;

  createdAt: number;
  updatedAt: number;
}
```

## Fill

```ts
interface Fill {
  id: string;
  orderId: string;
  clientOrderId: string;

  symbol: string;
  side: OrderSide;

  quantity: number;
  price: number;

  fee: number;
  feeAsset: 'USDT';

  liquidity: 'MAKER' | 'TAKER';

  realizedPnl: number;

  ts: number;
}
```

## Position

Use signed quantity for net position:

* positive quantity = long
* negative quantity = short

```ts
interface Position {
  symbol: string;

  qty: number;
  entryPrice: number;

  leverage: number;
  maintenanceMarginRate: number;

  realizedPnl: number;
  unrealizedPnl: number;

  updatedAt: number;
}
```

## Account

```ts
interface AccountState {
  walletBalance: number;

  unrealizedPnl: number;
  equity: number;

  initialMargin: number;
  maintenanceMargin: number;

  availableBalance: number;

  totalFees: number;
  totalFunding: number;
  totalRealizedPnl: number;
}
```

---

# 3. Production-grade reference implementation

This is a single-file reference implementation. In a real repo, split it into modules.

> Important: this example uses `number` for readability.
> For real production money math, replace `number` with `decimal.js`, `big.js`, or fixed-point `bigint`.
> Never use JavaScript floating point for a real broker ledger.

Install:

```bash
npm install @shubhamtaywade82/binance-client-ts
```

Create:

```text
src/paper-broker.ts
```

```ts
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type OrderSide = 'BUY' | 'SELL';

export type OrderType =
  | 'MARKET'
  | 'LIMIT'
  | 'STOP_MARKET';

export type OrderStatus =
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'REJECTED';

export type TimeInForce =
  | 'GTC'
  | 'IOC'
  | 'FOK';

export interface Instrument {
  symbol: string;

  tickSize: number;
  stepSize: number;

  minQty: number;
  minNotional: number;

  maintenanceMarginRate: number;
}

export interface MarketState {
  symbol: string;

  bid?: number;
  ask?: number;

  last?: number;
  mark?: number;
  index?: number;

  fundingRate?: number;

  localTs: number;
  stale: boolean;
}

export interface OrderCommand {
  clientOrderId?: string;

  symbol: string;
  side: OrderSide;
  type: OrderType;

  quantity: number;

  price?: number;
  stopPrice?: number;

  leverage?: number;

  reduceOnly?: boolean;
  postOnly?: boolean;

  timeInForce?: TimeInForce;
}

export interface Order {
  id: string;
  clientOrderId: string;

  symbol: string;
  side: OrderSide;
  type: OrderType;
  timeInForce: TimeInForce;

  quantity: number;
  filledQty: number;

  price?: number;
  stopPrice?: number;

  avgPrice: number;

  leverage: number;

  reduceOnly: boolean;
  postOnly: boolean;

  status: OrderStatus;
  rejectReason?: string;

  createdAt: number;
  updatedAt: number;
}

export interface Fill {
  id: string;
  orderId: string;
  clientOrderId: string;

  symbol: string;
  side: OrderSide;

  quantity: number;
  price: number;

  fee: number;
  feeAsset: 'USDT';

  liquidity: 'MAKER' | 'TAKER';

  realizedPnl: number;

  ts: number;
}

export interface Position {
  symbol: string;

  qty: number;
  entryPrice: number;

  leverage: number;
  maintenanceMarginRate: number;

  realizedPnl: number;
  unrealizedPnl: number;

  updatedAt: number;
}

export interface AccountState {
  walletBalance: number;

  unrealizedPnl: number;
  equity: number;

  initialMargin: number;
  maintenanceMargin: number;

  availableBalance: number;

  totalFees: number;
  totalFunding: number;
  totalRealizedPnl: number;

  liquidations: number;
}

export interface RiskLimits {
  maxLeverage: number;

  maxOrderNotional: number;
  maxPositionNotional: number;

  maxDailyLoss: number;

  maxOpenOrders: number;

  allowMarketOrders: boolean;
  allowLimitOrders: boolean;
  allowStopOrders: boolean;

  staleMarketMaxAgeMs: number;
}

export interface PaperBrokerConfig {
  dataDir: string;

  startingUsdt: number;

  instruments: Instrument[];

  takerFeeRate?: number;
  makerFeeRate?: number;

  marketSlippageBps?: number;

  risk?: Partial<RiskLimits>;
}

interface EventEnvelope {
  seq: number;
  ts: number;
  type: string;
  payload: unknown;
}

class EventLog {
  private seq = 0;
  private file: string;

  constructor(dataDir: string) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.file = path.join(dataDir, 'events.jsonl');
  }

  append(type: string, payload: unknown): void {
    const event: EventEnvelope = {
      seq: ++this.seq,
      ts: Date.now(),
      type,
      payload,
    };

    fs.appendFileSync(this.file, `${JSON.stringify(event)}\n`);
  }
}

function roundStep(value: number, stepSize: number): number {
  return Math.floor(value / stepSize) * stepSize;
}

function roundTick(value: number, tickSize: number): number {
  return Math.round(value / tickSize) * tickSize;
}

export class PaperBroker {
  private instruments = new Map<string, Instrument>();
  private markets = new Map<string, MarketState>();
  private orders = new Map<string, Order>();
  private positions = new Map<string, Position>();
  private fills: Fill[] = [];

  private walletBalance: number;

  private totalFees = 0;
  private totalFunding = 0;
  private totalRealizedPnl = 0;
  private liquidations = 0;

  private account: AccountState;

  private eventLog: EventLog;

  private takerFeeRate: number;
  private makerFeeRate: number;
  private marketSlippageBps: number;

  private risk: RiskLimits;

  private dayStartEquity: number;
  private currentUtcDay: string;

  private isLiquidating = false;

  constructor(config: PaperBrokerConfig) {
    this.eventLog = new EventLog(config.dataDir);

    this.walletBalance = config.startingUsdt;
    this.dayStartEquity = config.startingUsdt;
    this.currentUtcDay = new Date().toISOString().slice(0, 10);

    this.takerFeeRate = config.takerFeeRate ?? 0.0004;
    this.makerFeeRate = config.makerFeeRate ?? 0.0002;
    this.marketSlippageBps = config.marketSlippageBps ?? 2;

    this.risk = {
      maxLeverage: 10,
      maxOrderNotional: 5_000,
      maxPositionNotional: 20_000,
      maxDailyLoss: 1_000,
      maxOpenOrders: 50,
      allowMarketOrders: true,
      allowLimitOrders: true,
      allowStopOrders: true,
      staleMarketMaxAgeMs: 5_000,
      ...config.risk,
    };

    for (const instrument of config.instruments) {
      this.instruments.set(instrument.symbol, instrument);
    }

    this.account = this.calculateAccountState();

    this.eventLog.append('BROKER_INIT', {
      walletBalance: this.walletBalance,
      instruments: config.instruments,
      risk: this.risk,
    });
  }

  // --------------------------------------------------
  // Market data
  // --------------------------------------------------

  onMarket(update: Partial<MarketState> & { symbol: string }): void {
    const existing = this.markets.get(update.symbol);

    const market: MarketState = {
      symbol: update.symbol,
      bid: update.bid ?? existing?.bid,
      ask: update.ask ?? existing?.ask,
      last: update.last ?? existing?.last,
      mark: update.mark ?? existing?.mark,
      index: update.index ?? existing?.index,
      fundingRate: update.fundingRate ?? existing?.fundingRate,
      localTs: Date.now(),
      stale: false,
    };

    this.markets.set(update.symbol, market);

    this.eventLog.append('MARKET_UPDATE', market);

    this.evaluateOpenOrders(update.symbol);
    this.recalculateAccount();
    this.checkLiquidation();
  }

  markStaleMarkets(): void {
    const now = Date.now();

    for (const market of this.markets.values()) {
      const age = now - market.localTs;

      if (age > this.risk.staleMarketMaxAgeMs) {
        market.stale = true;
      }
    }
  }

  // --------------------------------------------------
  // Orders
  // --------------------------------------------------

  submitOrder(command: OrderCommand): Order {
    const now = Date.now();

    const instrument = this.instruments.get(command.symbol);

    if (!instrument) {
      throw new Error(`Unknown instrument: ${command.symbol}`);
    }

    const market = this.markets.get(command.symbol);

    const quantity = roundStep(command.quantity, instrument.stepSize);

    const price =
      command.price !== undefined
        ? roundTick(command.price, instrument.tickSize)
        : undefined;

    const stopPrice =
      command.stopPrice !== undefined
        ? roundTick(command.stopPrice, instrument.tickSize)
        : undefined;

    const order: Order = {
      id: randomUUID(),
      clientOrderId: command.clientOrderId ?? randomUUID(),

      symbol: command.symbol,
      side: command.side,
      type: command.type,
      timeInForce: command.timeInForce ?? 'GTC',

      quantity,
      filledQty: 0,

      price,
      stopPrice,

      avgPrice: 0,

      leverage: command.leverage ?? 5,

      reduceOnly: command.reduceOnly ?? false,
      postOnly: command.postOnly ?? false,

      status: 'NEW',

      createdAt: now,
      updatedAt: now,
    };

    this.orders.set(order.id, order);

    this.eventLog.append('ORDER_NEW', order);

    if (!market) {
      return this.rejectOrder(order, 'NO_MARKET_STATE');
    }

    if (market.stale) {
      return this.rejectOrder(order, 'STALE_MARKET_DATA');
    }

    const riskCheck = this.checkOrderRisk(order, instrument, market);

    if (!riskCheck.ok) {
      return this.rejectOrder(order, riskCheck.reason ?? 'RISK_CHECK_FAILED');
    }

    if (order.type === 'MARKET') {
      this.fillOrder(order, market, 'TAKER');
      return order;
    }

    if (order.type === 'LIMIT') {
      if (!order.price) {
        return this.rejectOrder(order, 'MISSING_LIMIT_PRICE');
      }

      const marketable = this.isLimitMarketable(order, market);

      if (order.postOnly && marketable) {
        return this.rejectOrder(order, 'POST_ONLY_WOULD_FILL');
      }

      if (marketable) {
        this.fillOrder(order, market, 'TAKER');
        return order;
      }

      if (order.timeInForce === 'IOC') {
        return this.cancelOrder(order.id, 'IOC_NOT_MARKETABLE');
      }

      if (order.timeInForce === 'FOK') {
        return this.rejectOrder(order, 'FOK_CANNOT_FILL_FULLY');
      }

      // Resting maker order.
      return order;
    }

    if (order.type === 'STOP_MARKET') {
      if (!order.stopPrice) {
        return this.rejectOrder(order, 'MISSING_STOP_PRICE');
      }

      if (this.isStopTriggered(order, market)) {
        this.fillOrder(order, market, 'TAKER');
      }

      // Otherwise rests until triggered.
      return order;
    }

    return this.rejectOrder(order, 'UNSUPPORTED_ORDER_TYPE');
  }

  cancelOrder(orderId: string, reason = 'USER_CANCEL'): Order | undefined {
    const order = this.orders.get(orderId);

    if (!order) {
      return undefined;
    }

    if (order.status !== 'NEW' && order.status !== 'PARTIALLY_FILLED') {
      return order;
    }

    order.status = 'CANCELED';
    order.updatedAt = Date.now();

    this.eventLog.append('ORDER_CANCELED', {
      orderId: order.id,
      reason,
    });

    return order;
  }

  cancelAllOrders(symbol?: string): void {
    for (const order of this.orders.values()) {
      if (symbol && order.symbol !== symbol) {
        continue;
      }

      if (order.status === 'NEW' || order.status === 'PARTIALLY_FILLED') {
        this.cancelOrder(order.id, 'CANCEL_ALL');
      }
    }
  }

  // --------------------------------------------------
  // Funding
  // --------------------------------------------------

  applyFunding(): void {
    for (const position of this.positions.values()) {
      if (position.qty === 0) {
        continue;
      }

      const market = this.markets.get(position.symbol);

      if (!market?.mark || market.fundingRate === undefined) {
        continue;
      }

      // Positive funding: longs pay shorts.
      // Negative funding: shorts pay longs.
      const payment = position.qty * market.mark * market.fundingRate;

      this.walletBalance -= payment;
      this.totalFunding += payment;

      this.eventLog.append('FUNDING_PAYMENT', {
        symbol: position.symbol,
        qty: position.qty,
        markPrice: market.mark,
        fundingRate: market.fundingRate,
        payment,
      });
    }

    this.recalculateAccount();
  }

  // --------------------------------------------------
  // Queries
  // --------------------------------------------------

  getAccount(): AccountState {
    return this.account;
  }

  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  getPosition(symbol: string): Position | undefined {
    return this.positions.get(symbol);
  }

  getOpenOrders(symbol?: string): Order[] {
    return Array.from(this.orders.values()).filter((order) => {
      const open =
        order.status === 'NEW' || order.status === 'PARTIALLY_FILLED';

      if (!open) {
        return false;
      }

      if (symbol && order.symbol !== symbol) {
        return false;
      }

      return true;
    });
  }

  getFills(): Fill[] {
    return [...this.fills];
  }

  getSnapshot() {
    return {
      ts: Date.now(),
      walletBalance: this.walletBalance,
      account: this.account,
      positions: Object.fromEntries(this.positions),
      orders: Object.fromEntries(this.orders),
      markets: Object.fromEntries(this.markets),
      fills: this.fills,
    };
  }

  // --------------------------------------------------
  // Internal matching
  // --------------------------------------------------

  private evaluateOpenOrders(symbol: string): void {
    const market = this.markets.get(symbol);

    if (!market) {
      return;
    }

    for (const order of this.orders.values()) {
      if (order.symbol !== symbol) {
        continue;
      }

      if (order.status !== 'NEW' && order.status !== 'PARTIALLY_FILLED') {
        continue;
      }

      if (order.type === 'LIMIT') {
        if (this.isLimitMarketable(order, market)) {
          this.fillOrder(order, market, 'MAKER');
        }

        continue;
      }

      if (order.type === 'STOP_MARKET') {
        if (this.isStopTriggered(order, market)) {
          this.fillOrder(order, market, 'TAKER');
        }

        continue;
      }
    }
  }

  private fillOrder(
    order: Order,
    market: MarketState,
    liquidity: 'MAKER' | 'TAKER'
  ): void {
    const remaining = order.quantity - order.filledQty;

    if (remaining <= 0) {
      order.status = 'FILLED';
      return;
    }

    const price = this.getExecutionPrice(order, market);

    if (!Number.isFinite(price) || price <= 0) {
      this.rejectOrder(order, 'INVALID_EXECUTION_PRICE');
      return;
    }

    this.executeFill(order, remaining, price, liquidity);

    if (order.filledQty >= order.quantity) {
      order.status = 'FILLED';
    } else {
      order.status = 'PARTIALLY_FILLED';
    }

    order.updatedAt = Date.now();
  }

  private executeFill(
    order: Order,
    quantity: number,
    price: number,
    liquidity: 'MAKER' | 'TAKER'
  ): void {
    const feeRate =
      liquidity === 'MAKER' ? this.makerFeeRate : this.takerFeeRate;

    const notional = quantity * price;
    const fee = notional * feeRate;

    this.walletBalance -= fee;
    this.totalFees += fee;

    const realizedPnl = this.applyPositionFill(
      order.symbol,
      order.side,
      quantity,
      price,
      order.leverage
    );

    this.walletBalance += realizedPnl;
    this.totalRealizedPnl += realizedPnl;

    order.filledQty += quantity;

    order.avgPrice =
      order.filledQty === 0
        ? 0
        : (order.avgPrice * (order.filledQty - quantity) + price * quantity) /
          order.filledQty;

    const fill: Fill = {
      id: randomUUID(),
      orderId: order.id,
      clientOrderId: order.clientOrderId,

      symbol: order.symbol,
      side: order.side,

      quantity,
      price,

      fee,
      feeAsset: 'USDT',

      liquidity,

      realizedPnl,

      ts: Date.now(),
    };

    this.fills.push(fill);

    this.eventLog.append('FILL', fill);

    this.recalculateAccount();
  }

  private applyPositionFill(
    symbol: string,
    side: OrderSide,
    quantity: number,
    price: number,
    leverage: number
  ): number {
    const instrument = this.instruments.get(symbol);

    if (!instrument) {
      throw new Error(`Unknown instrument: ${symbol}`);
    }

    let position = this.positions.get(symbol);

    if (!position) {
      position = {
        symbol,
        qty: 0,
        entryPrice: 0,
        leverage,
        maintenanceMarginRate: instrument.maintenanceMarginRate,
        realizedPnl: 0,
        unrealizedPnl: 0,
        updatedAt: Date.now(),
      };

      this.positions.set(symbol, position);
    }

    const signedQty = side === 'BUY' ? quantity : -quantity;

    const oldQty = position.qty;
    const newQty = oldQty + signedQty;

    let realized = 0;

    // Open new position.
    if (oldQty === 0) {
      position.entryPrice = price;
      position.qty = newQty;
      position.leverage = leverage;
      position.updatedAt = Date.now();

      this.eventLog.append('POSITION_UPDATE', position);

      return 0;
    }

    // Close full position.
    if (newQty === 0) {
      const direction = oldQty > 0 ? 1 : -1;
      const closedQty = Math.abs(oldQty);

      realized = closedQty * (price - position.entryPrice) * direction;

      position.qty = 0;
      position.entryPrice = 0;
      position.realizedPnl += realized;
      position.updatedAt = Date.now();

      this.eventLog.append('POSITION_UPDATE', position);

      return realized;
    }

    // Reduce position.
    if (Math.sign(oldQty) === Math.sign(newQty) && Math.abs(newQty) < Math.abs(oldQty)) {
      const direction = oldQty > 0 ? 1 : -1;
      const closedQty = Math.abs(oldQty) - Math.abs(newQty);

      realized = closedQty * (price - position.entryPrice) * direction;

      position.qty = newQty;
      position.realizedPnl += realized;
      position.updatedAt = Date.now();

      this.eventLog.append('POSITION_UPDATE', position);

      return realized;
    }

    // Increase position.
    if (Math.sign(oldQty) === Math.sign(newQty) && Math.abs(newQty) > Math.abs(oldQty)) {
      const oldNotional = Math.abs(oldQty) * position.entryPrice;
      const addedNotional = Math.abs(signedQty) * price;

      position.entryPrice = (oldNotional + addedNotional) / Math.abs(newQty);
      position.qty = newQty;
      position.leverage = leverage;
      position.updatedAt = Date.now();

      this.eventLog.append('POSITION_UPDATE', position);

      return 0;
    }

    // Flip position.
    const direction = oldQty > 0 ? 1 : -1;
    const closedQty = Math.abs(oldQty);

    realized = closedQty * (price - position.entryPrice) * direction;

    position.qty = newQty;
    position.entryPrice = price;
    position.leverage = leverage;
    position.realizedPnl += realized;
    position.updatedAt = Date.now();

    this.eventLog.append('POSITION_UPDATE', position);

    return realized;
  }

  // --------------------------------------------------
  // Execution prices
  // --------------------------------------------------

  private getExecutionPrice(order: Order, market: MarketState): number {
    if (order.type === 'MARKET' || order.type === 'STOP_MARKET') {
      const slippage = this.marketSlippageBps / 10_000;

      if (order.side === 'BUY') {
        if (!market.ask) {
          return NaN;
        }

        return market.ask * (1 + slippage);
      }

      if (!market.bid) {
        return NaN;
      }

      return market.bid * (1 - slippage);
    }

    if (order.type === 'LIMIT') {
      if (!order.price) {
        return NaN;
      }

      if (order.side === 'BUY') {
        return market.ask ?? order.price;
      }

      return market.bid ?? order.price;
    }

    return NaN;
  }

  private isLimitMarketable(order: Order, market: MarketState): boolean {
    if (!order.price) {
      return false;
    }

    if (order.side === 'BUY') {
      return !!market.ask && market.ask <= order.price;
    }

    return !!market.bid && market.bid >= order.price;
  }

  private isStopTriggered(order: Order, market: MarketState): boolean {
    if (!order.stopPrice) {
      return false;
    }

    const triggerReference =
      market.mark ??
      market.last ??
      (market.bid && market.ask ? (market.bid + market.ask) / 2 : undefined);

    if (!triggerReference) {
      return false;
    }

    if (order.side === 'BUY') {
      return triggerReference >= order.stopPrice;
    }

    return triggerReference <= order.stopPrice;
  }

  // --------------------------------------------------
  // Risk
  // --------------------------------------------------

  private checkOrderRisk(
    order: Order,
    instrument: Instrument,
    market: MarketState
  ): { ok: boolean; reason?: string } {
    this.rollDailyEquityIfNeeded();

    if (order.type === 'MARKET' && !this.risk.allowMarketOrders) {
      return { ok: false, reason: 'MARKET_ORDERS_DISABLED' };
    }

    if (order.type === 'LIMIT' && !this.risk.allowLimitOrders) {
      return { ok: false, reason: 'LIMIT_ORDERS_DISABLED' };
    }

    if (order.type === 'STOP_MARKET' && !this.risk.allowStopOrders) {
      return { ok: false, reason: 'STOP_ORDERS_DISABLED' };
    }

    if (order.quantity <= 0) {
      return { ok: false, reason: 'INVALID_QTY' };
    }

    if (order.quantity < instrument.minQty) {
      return { ok: false, reason: 'MIN_QTY_NOT_MET' };
    }

    if (order.leverage > this.risk.maxLeverage) {
      return { ok: false, reason: 'MAX_LEVERAGE_EXCEEDED' };
    }

    const estimatedPrice = this.estimatePrice(order, market);

    if (!Number.isFinite(estimatedPrice) || estimatedPrice <= 0) {
      return { ok: false, reason: 'NO_VALID_PRICE' };
    }

    const notional = order.quantity * estimatedPrice;

    if (notional < instrument.minNotional) {
      return { ok: false, reason: 'MIN_NOTIONAL_NOT_MET' };
    }

    if (notional > this.risk.maxOrderNotional) {
      return { ok: false, reason: 'MAX_ORDER_NOTIONAL_EXCEEDED' };
    }

    const currentPosition = this.positions.get(order.symbol);
    const currentQty = currentPosition?.qty ?? 0;

    const signedQty = order.side === 'BUY' ? order.quantity : -order.quantity;
    const newQty = currentQty + signedQty;

    const increasesPosition = Math.abs(newQty) > Math.abs(currentQty);

    if (order.reduceOnly && increasesPosition) {
      return { ok: false, reason: 'REDUCE_ONLY_WOULD_INCREASE' };
    }

    const currentNotional = Math.abs(currentQty) * estimatedPrice;
    const addedNotional = increasesPosition
      ? (Math.abs(newQty) - Math.abs(currentQty)) * estimatedPrice
      : 0;

    if (currentNotional + addedNotional > this.risk.maxPositionNotional) {
      return { ok: false, reason: 'MAX_POSITION_NOTIONAL_EXCEEDED' };
    }

    const openOrders = this.getOpenOrders().length;

    if (openOrders >= this.risk.maxOpenOrders) {
      return { ok: false, reason: 'MAX_OPEN_ORDERS_EXCEEDED' };
    }

    const account = this.calculateAccountState();

    if (
      account.equity <
      this.dayStartEquity - this.risk.maxDailyLoss
    ) {
      return { ok: false, reason: 'MAX_DAILY_LOSS_EXCEEDED' };
    }

    if (increasesPosition) {
      const requiredMargin = notional / order.leverage;

      const feeRate =
        order.type === 'LIMIT' ? this.makerFeeRate : this.takerFeeRate;

      const estimatedFee = notional * feeRate;

      if (account.availableBalance < requiredMargin + estimatedFee) {
        return { ok: false, reason: 'INSUFFICIENT_AVAILABLE_BALANCE' };
      }
    }

    return { ok: true };
  }

  private estimatePrice(order: Order, market: MarketState): number {
    if (order.type === 'LIMIT' && order.price) {
      return order.price;
    }

    if (order.type === 'STOP_MARKET' && order.stopPrice) {
      return order.stopPrice;
    }

    if (order.side === 'BUY') {
      return market.ask ?? NaN;
    }

    return market.bid ?? NaN;
  }

  // --------------------------------------------------
  // Account / margin / PnL
  // --------------------------------------------------

  private recalculateAccount(): void {
    this.account = this.calculateAccountState();
  }

  private calculateAccountState(): AccountState {
    let unrealizedPnl = 0;
    let initialMargin = 0;
    let maintenanceMargin = 0;

    for (const position of this.positions.values()) {
      const market = this.markets.get(position.symbol);

      if (!market?.mark) {
        continue;
      }

      if (position.qty === 0) {
        position.unrealizedPnl = 0;
        continue;
      }

      position.unrealizedPnl =
        position.qty * (market.mark - position.entryPrice);

      unrealizedPnl += position.unrealizedPnl;

      const notional = Math.abs(position.qty) * market.mark;

      initialMargin += notional / position.leverage;

      maintenanceMargin += notional * position.maintenanceMarginRate;
    }

    const equity = this.walletBalance + unrealizedPnl;

    const availableBalance = Math.max(0, equity - initialMargin);

    return {
      walletBalance: this.walletBalance,
      unrealizedPnl,
      equity,
      initialMargin,
      maintenanceMargin,
      availableBalance,
      totalFees: this.totalFees,
      totalFunding: this.totalFunding,
      totalRealizedPnl: this.totalRealizedPnl,
      liquidations: this.liquidations,
    };
  }

  private rollDailyEquityIfNeeded(): void {
    const utcDay = new Date().toISOString().slice(0, 10);

    if (utcDay !== this.currentUtcDay) {
      this.currentUtcDay = utcDay;
      this.dayStartEquity = this.calculateAccountState().equity;

      this.eventLog.append('DAILY_RESET', {
        utcDay,
        dayStartEquity: this.dayStartEquity,
      });
    }
  }

  // --------------------------------------------------
  // Liquidation
  // --------------------------------------------------

  private checkLiquidation(): void {
    if (this.isLiquidating) {
      return;
    }

    const account = this.calculateAccountState();

    if (account.maintenanceMargin <= 0) {
      return;
    }

    if (account.equity > account.maintenanceMargin) {
      return;
    }

    this.isLiquidating = true;

    this.eventLog.append('LIQUIDATION_STARTED', {
      account,
    });

    for (const position of this.positions.values()) {
      if (position.qty === 0) {
        continue;
      }

      const market = this.markets.get(position.symbol);

      if (!market?.mark) {
        continue;
      }

      const closeSide: OrderSide = position.qty > 0 ? 'SELL' : 'BUY';
      const closeQty = Math.abs(position.qty);

      const realized = this.applyPositionFill(
        position.symbol,
        closeSide,
        closeQty,
        market.mark,
        position.leverage
      );

      this.walletBalance += realized;
      this.totalRealizedPnl += realized;

      this.eventLog.append('LIQUIDATION_CLOSE', {
        symbol: position.symbol,
        side: closeSide,
        qty: closeQty,
        price: market.mark,
        realized,
      });
    }

    this.liquidations += 1;

    this.recalculateAccount();

    this.eventLog.append('LIQUIDATION_COMPLETED', {
      account: this.account,
    });

    this.isLiquidating = false;
  }

  // --------------------------------------------------
  // Order helpers
  // --------------------------------------------------

  private rejectOrder(order: Order, reason: string): Order {
    order.status = 'REJECTED';
    order.rejectReason = reason;
    order.updatedAt = Date.now();

    this.eventLog.append('ORDER_REJECTED', {
      orderId: order.id,
      reason,
    });

    return order;
  }
}
```

---

# 4. Instrument configuration

For production, fetch these values from Binance.

For local development, you can start with manual config, but replace with real `exchangeInfo` values.

```ts
const instruments: Instrument[] = [
  {
    symbol: 'SOLUSDT',
    tickSize: 0.01,
    stepSize: 0.1,
    minQty: 0.1,
    minNotional: 5,
    maintenanceMarginRate: 0.005,
  },
  {
    symbol: 'ETHUSDT',
    tickSize: 0.01,
    stepSize: 0.001,
    minQty: 0.001,
    minNotional: 5,
    maintenanceMarginRate: 0.005,
  },
  {
    symbol: 'XRPUSDT',
    tickSize: 0.0001,
    stepSize: 0.1,
    minQty: 0.1,
    minNotional: 5,
    maintenanceMarginRate: 0.005,
  },
];
```

You should replace:

* `tickSize`
* `stepSize`
* `minQty`
* `minNotional`
* `maintenanceMarginRate`

with values from:

* `exchangeInfo`
* `leverageBracket`

---

# 5. Create the paper broker

```ts
import { PaperBroker } from './paper-broker';

const broker = new PaperBroker({
  dataDir: './data',

  startingUsdt: 10_000,

  instruments,

  takerFeeRate: 0.0004,
  makerFeeRate: 0.0002,

  marketSlippageBps: 2,

  risk: {
    maxLeverage: 10,
    maxOrderNotional: 5_000,
    maxPositionNotional: 20_000,
    maxDailyLoss: 1_000,
    maxOpenOrders: 20,
    allowMarketOrders: true,
    allowLimitOrders: true,
    allowStopOrders: true,
    staleMarketMaxAgeMs: 5_000,
  },
});
```

---

# 6. Wire Binance WebSocket to the paper engine

```ts
import { BinanceClient } from '@shubhamtaywade82/binance-client-ts';

const client = new BinanceClient({
  testnet: true,
});

const symbols = ['SOLUSDT', 'ETHUSDT', 'XRPUSDT'];

const streams: string[] = [];

for (const symbol of symbols) {
  streams.push(
    client.futures.ws.bookTicker(symbol),
    client.futures.ws.aggTrade(symbol),
    client.futures.ws.markPrice(symbol, '1s')
  );
}

client.futures.ws.subscribe(streams);

client.futures.ws.on('message', (streamName: string, payload: any) => {
  if (streamName.includes('@bookTicker')) {
    broker.onMarket({
      symbol: payload.s,
      bid: Number(payload.b),
      ask: Number(payload.a),
    });
  }

  if (streamName.includes('@aggTrade')) {
    broker.onMarket({
      symbol: payload.s,
      last: Number(payload.p),
    });
  }

  if (streamName.includes('@markPrice')) {
    broker.onMarket({
      symbol: payload.s,
      mark: Number(payload.p),
      index: Number(payload.i),
      fundingRate: Number(payload.r),
    });
  }
});

client.futures.ws.on('open', () => {
  console.log('Binance WebSocket connected');
});

client.futures.ws.on('error', (err) => {
  console.error('Binance WebSocket error', err);
});

client.futures.ws.on('close', () => {
  console.warn('Binance WebSocket closed');
});
```

---

# 7. Add maintenance timers

You need timers for:

* stale market detection
* funding
* daily reset
* snapshots

```ts
setInterval(() => {
  broker.markStaleMarkets();
}, 1_000);

setInterval(() => {
  broker.applyFunding();
}, 60_000);

setInterval(() => {
  const snapshot = broker.getSnapshot();

  console.log({
    equity: snapshot.account.equity,
    wallet: snapshot.account.walletBalance,
    available: snapshot.account.availableBalance,
    unrealized: snapshot.account.unrealizedPnl,
    positions: snapshot.positions,
  });
}, 10_000);
```

For real funding, apply at actual Binance funding timestamps, not every minute.

---

# 8. Submit orders

## Market order

```ts
const order = broker.submitOrder({
  symbol: 'SOLUSDT',
  side: 'BUY',
  type: 'MARKET',
  quantity: 1,
  leverage: 5,
});

console.log(order);
```

## Limit order

```ts
const order = broker.submitOrder({
  symbol: 'ETHUSDT',
  side: 'BUY',
  type: 'LIMIT',
  quantity: 0.05,
  price: 2500,
  leverage: 5,
  timeInForce: 'GTC',
});
```

## Post-only limit order

```ts
const order = broker.submitOrder({
  symbol: 'XRPUSDT',
  side: 'SELL',
  type: 'LIMIT',
  quantity: 100,
  price: 0.65,
  leverage: 3,
  postOnly: true,
});
```

## Stop market order

```ts
const order = broker.submitOrder({
  symbol: 'SOLUSDT',
  side: 'SELL',
  type: 'STOP_MARKET',
  quantity: 1,
  stopPrice: 135,
  leverage: 5,
  reduceOnly: true,
});
```

## Reduce-only close

```ts
const position = broker.getPosition('SOLUSDT');

if (position && position.qty > 0) {
  broker.submitOrder({
    symbol: 'SOLUSDT',
    side: 'SELL',
    type: 'MARKET',
    quantity: Math.abs(position.qty),
    reduceOnly: true,
  });
}
```

---

# 9. Strategy interface

Do not let strategy code touch the engine internals.

Create a clean interface:

```ts
interface StrategyContext {
  getAccount(): AccountState;
  getPosition(symbol: string): Position | undefined;
  getOpenOrders(symbol?: string): Order[];
  submitOrder(order: OrderCommand): Order;
  cancelOrder(orderId: string): void;
}
```

Example:

```ts
function exampleStrategy(ctx: StrategyContext) {
  const account = ctx.getAccount();

  if (account.availableBalance < 100) {
    return;
  }

  const position = ctx.getPosition('SOLUSDT');

  if (position && position.qty !== 0) {
    return;
  }

  ctx.submitOrder({
    symbol: 'SOLUSDT',
    side: 'BUY',
    type: 'MARKET',
    quantity: 1,
    leverage: 3,
  });
}
```

If using Ollama/AI:

```text
AI decision -> Zod schema -> OrderCommand -> Risk engine -> PaperBroker
```

Never allow:

```text
AI -> direct exchange API
```

or:

```text
AI -> direct wallet mutation
```

---

# 10. Required persistence

For production, do not rely only on memory.

Use:

* SQLite
* append-only JSONL
* periodic snapshots

## Event log

Already included:

```ts
./data/events.jsonl
```

Events:

```json
{ "type": "BROKER_INIT" }
{ "type": "MARKET_UPDATE" }
{ "type": "ORDER_NEW" }
{ "type": "ORDER_REJECTED" }
{ "type": "FILL" }
{ "type": "POSITION_UPDATE" }
{ "type": "FUNDING_PAYMENT" }
{ "type": "LIQUIDATION_STARTED" }
```

## Snapshot

Use:

```ts
broker.getSnapshot();
```

Write to:

```text
./data/snapshots/latest.json
```

Example:

```ts
import fs from 'node:fs';

setInterval(() => {
  const snapshot = broker.getSnapshot();

  fs.writeFileSync(
    './data/snapshots/latest.json',
    JSON.stringify(snapshot, null, 2)
  );
}, 30_000);
```

For production, use SQLite:

```text
events table
orders table
fills table
positions table
account_snapshots table
market_snapshots table
```

---

# 11. Production hardening checklist

To make this truly production-grade, upgrade these areas.

## 1. Use decimal math

Replace:

```ts
number
```

with:

```ts
decimal.js
```

or fixed-point `bigint`.

Financial engines must not use floating point for:

* wallet balance
* fees
* realized PnL
* funding
* margin
* order quantity
* order price

## 2. Use real order book depth

The example uses top-of-book plus slippage.

For realistic fills, use:

* REST depth snapshot
* WebSocket depth stream
* local order book maintenance
* sequence number validation
* order book walking for large orders

Streams:

```text
<symbol>@depth@100ms
<symbol>@bookTicker
<symbol>@aggTrade
<symbol>@markPrice
```

## 3. Use Binance sequence numbers

For order book sync:

* get REST snapshot
* buffer WebSocket events
* validate `u`, `pu`, event sequence
* resync if gap detected

## 4. Use deterministic replay

Your engine should support:

```text
recorded market events + recorded order commands = same final state
```

Do not rely on wall-clock time inside matching logic.

Use event timestamps.

## 5. Use idempotent order IDs

Every order should have:

```ts
clientOrderId
```

If a strategy retries an order, the engine should reject duplicates.

```ts
if (existingClientOrderId) {
  return existingOrder;
}
```

## 6. Add proper funding schedule

Binance funding happens at funding timestamps.

Use:

* `fundingInfo`
* next funding time
* funding rate stream

Apply funding only at funding settlement.

## 7. Add maintenance margin from leverage brackets

Do not hardcode:

```ts
maintenanceMarginRate = 0.005
```

Fetch from Binance:

```text
/fapi/v1/leverageBracket
```

Maintenance margin depends on notional tier.

## 8. Add isolated and cross margin

The example uses simplified cross margin.

For broker-grade simulation, support:

* cross margin
* isolated margin
* position-side mode
* hedge mode
* dual-side positions

## 9. Add partial fills

The example fills remaining quantity in one fill.

For realism:

* split market orders across book levels
* support partial fills
* emit multiple fills per order

## 10. Add liquidation fees and insurance fund

The example closes positions at mark price.

Real liquidation includes:

* maintenance margin
* liquidation penalty
* insurance fund contribution
* ADL rules

## 11. Add reconciliation

If you mirror orders to Binance Testnet, reconcile:

* local orders
* Binance orders
* local fills
* Binance fills
* local positions
* Binance positions
* local wallet
* Binance balances

Use REST:

* account balance
* position risk
* open orders
* trade history

## 12. Add observability

Track:

* equity curve
* drawdown
* win rate
* realized PnL
* unrealized PnL
* fees
* funding
* order rejection rate
* WebSocket disconnects
* stale market events
* latency
* fill slippage

Use:

* pino
* OpenTelemetry
* Prometheus-style metrics
* Grafana dashboard

---

# 12. Recommended project structure

```text
paper-engine/
├── src/
│   ├── broker/
│   │   ├── PaperBroker.ts
│   │   ├── OrderEngine.ts
│   │   ├── MatchingEngine.ts
│   │   ├── PositionEngine.ts
│   │   ├── WalletEngine.ts
│   │   ├── MarginEngine.ts
│   │   ├── FundingEngine.ts
│   │   ├── LiquidationEngine.ts
│   │   └── RiskEngine.ts
│   │
│   ├── market/
│   │   ├── MarketState.ts
│   │   ├── MarketDataNormalizer.ts
│   │   ├── OrderBook.ts
│   │   └── streams.ts
│   │
│   ├── binance/
│   │   ├── client.ts
│   │   ├── bootstrap.ts
│   │   ├── instruments.ts
│   │   └── ws.ts
│   │
│   ├── strategy/
│   │   ├── Strategy.ts
│   │   ├── StrategyContext.ts
│   │   └── strategies/
│   │
│   ├── persistence/
│   │   ├── EventLog.ts
│   │   ├── SnapshotStore.ts
│   │   └── sqlite.ts
│   │
│   ├── telemetry/
│   │   ├── logger.ts
│   │   └── metrics.ts
│   │
│   └── index.ts
│
├── data/
│   ├── events.jsonl
│   └── snapshots/
│
├── package.json
└── tsconfig.json
```

---

# 13. Broker-like ledger upgrade

If you want this to be more like a real broker, use double-entry accounting.

Instead of:

```ts
walletBalance += realizedPnl
```

Use ledger entries:

```text
DEMO_CASH
CUSTOMER_EQUITY
FEES_REVENUE
FUNDING_PAYABLE
FUNDING_RECEIVABLE
REALIZED_PNL
UNREALIZED_PNL
MARGIN_LOCKED
INSURANCE_FUND
LIQUIDATION_PENALTY
```

Example ledger event:

```json
{
  "type": "LEDGER_ENTRY",
  "entries": [
    {
      "account": "DEMO_CASH",
      "direction": "DEBIT",
      "amount": 0.4
    },
    {
      "account": "FEES_REVENUE",
      "direction": "CREDIT",
      "amount": 0.4
    }
  ]
}
```

This is how you make the simulation audit-friendly.

---

# 14. Minimum production-ready flow

Your runtime should do this:

```ts
async function main() {
  // 1. Create broker
  const broker = new PaperBroker({
    dataDir: './data',
    startingUsdt: 10_000,
    instruments,
  });

  // 2. Bootstrap instruments from Binance
  // exchangeInfo
  // leverageBracket
  // mark price
  // funding info

  // 3. Connect WebSocket
  // bookTicker
  // aggTrade
  // markPrice

  // 4. Start timers
  // stale checker
  // funding
  // snapshot

  // 5. Start strategy
  // strategy receives broker context
}
```

---

# 15. Final answer: what is required?

For a proper broker-like USDⓈ-M futures paper engine, you need:

## Core engine

* [ ] demo wallet
* [ ] order engine
* [ ] matching engine
* [ ] position engine
* [ ] margin engine
* [ ] funding engine
* [ ] risk engine
* [ ] liquidation engine
* [ ] event log
* [ ] snapshot store

## Market data

* [ ] WebSocket connection
* [ ] `bookTicker`
* [ ] `aggTrade`
* [ ] `markPrice`
* [ ] optional `depth`
* [ ] optional `kline`
* [ ] REST bootstrap
* [ ] stale-data detection
* [ ] reconnect handling

## Trading rules

* [ ] tick size
* [ ] step size
* [ ] min quantity
* [ ] min notional
* [ ] max leverage
* [ ] maintenance margin
* [ ] maker/taker fees
* [ ] slippage model
* [ ] reduce-only
* [ ] post-only
* [ ] IOC/FOK
* [ ] stop orders

## Accounting

* [ ] realized PnL
* [ ] unrealized PnL
* [ ] wallet balance
* [ ] equity
* [ ] available balance
* [ ] initial margin
* [ ] maintenance margin
* [ ] funding payments
* [ ] fees

## Safety

* [ ] max daily loss
* [ ] max position notional
* [ ] max order notional
* [ ] max open orders
* [ ] kill switch
* [ ] stale market rejection
* [ ] duplicate client order ID rejection
* [ ] deterministic replay

## Observability

* [ ] append-only event log
* [ ] fills log
* [ ] equity snapshots
* [ ] drawdown tracking
* [ ] WebSocket health
* [ ] order reject reasons

---

# 16. Most important rule

For a broker-like simulation:

> Market data comes from Binance.
> Execution happens locally.
> Every state change is logged.
> The strategy never mutates state directly.
> The risk engine is mandatory.
> The ledger is deterministic.

If you follow that, you can grow this from a local paper engine into a proper simulated broker core.

For a paper broker that you can **persist reliably** and analyze later, you need a data model that separates:

1. **Immutable events** — what happened
2. **Current state projections** — latest wallet, positions, orders
3. **Analytics facts** — fills, PnL, snapshots, market context
4. **Operational telemetry** — WebSocket health, risk rejects, stale data

The best design is:

> **Event-sourced core + relational projections + time-series analytics tables.**

For local development, SQLite is fine.
For production-style analysis, PostgreSQL + TimescaleDB or ClickHouse/DuckDB/Parquet is better.

---

# 1. High-level data architecture

```text
Event Store
  ├── order events
  ├── fill events
  ├── position events
  ├── wallet / ledger events
  ├── funding events
  ├── risk events
  ├── market events
  └── system events
        │
        ▼
Projection Builders
        │
        ├── current wallet
        ├── current positions
        ├── current orders
        ├── current account metrics
        └── current market state
        │
        ▼
Analytics Layer
        ├── fills
        ├── position lifecycle
        ├── equity snapshots
        ├── market context
        ├── funding costs
        ├── order funnel
        ├── strategy attribution
        └── drawdown / risk metrics
```

Do not only store current state. Store enough history to answer questions like:

* Why was this order rejected?
* What was the account equity at every minute?
* What was the mark price when a position was closed?
* How much funding did SOLUSDT cost?
* What strategy signal caused this fill?
* How much slippage did market orders incur?
* What was the max drawdown?
* Which symbol contributed the most realized PnL?

---

# 2. Core design rules

## A. Use event sourcing for money-critical state

Every state change should be written as an immutable event:

```text
ORDER_RECEIVED
ORDER_REJECTED
ORDER_ACCEPTED
ORDER_TRIGGERED
ORDER_PARTIALLY_FILLED
ORDER_FILLED
ORDER_CANCELED
FILL_CREATED
POSITION_OPENED
POSITION_INCREASED
POSITION_REDUCED
POSITION_CLOSED
POSITION_FLIPPED
WALLET_CREDITED
WALLET_DEBITED
FEE_CHARGED
FUNDING_APPLIED
REALIZED_PNL_BOOKED
UNREALIZED_PNL_SNAPSHOT
MARGIN_UPDATED
LIQUIDATION_STARTED
LIQUIDATION_COMPLETED
RISK_REJECTED
MARKET_STALE
WS_DISCONNECTED
SNAPSHOT_CREATED
```

## B. Use projections for fast reads

Current state tables:

```text
wallets
orders
positions
account_snapshots_current
market_states_current
```

These can be rebuilt from events.

## C. Use fact tables for analysis

Analytical tables:

```text
fills
position_events
account_snapshots
funding_payments
order_events
market_ticks
strategy_signals
risk_events
```

## D. Use UTC timestamps everywhere

Store:

```text
created_at_utc
updated_at_utc
event_time_utc
```

Do not store local time.

## E. Use strong IDs

Recommended:

```text
UUID v7
```

Why UUID v7:

* time ordered
* safe distributed generation
* good primary key for logs/events

## F. Use idempotency keys

Orders need:

```text
client_order_id
```

Signals need:

```text
signal_id
```

Events need:

```text
event_id
```

This prevents duplicate processing.

## G. Use decimal-safe storage

For production:

* PostgreSQL: `NUMERIC(36,18)`
* SQLite: store canonical decimals as `TEXT` and compute with `decimal.js`
* or store fixed-point integers with explicit scale

Avoid using JavaScript `number` as the source of truth for money.

---

# 3. Entity relationship overview

```text
accounts
  ├── wallets
  ├── ledger_entries
  ├── orders
  │     ├── order_events
  │     └── fills
  ├── positions
  │     └── position_events
  ├── account_snapshots
  ├── funding_payments
  └── risk_events

instruments
  ├── orders
  ├── fills
  ├── positions
  ├── market_ticks
  ├── order_book_snapshots
  ├── klines
  └── funding_payments

strategies
  └── signals
        └── orders
```

---

# 4. Minimal viable schema

This is the minimum you need for a proper paper broker.

## 4.1 `accounts`

One paper trading account. Later you can support multiple accounts/subaccounts.

```sql
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('PAPER', 'TESTNET_MIRROR')),
  base_currency TEXT NOT NULL DEFAULT 'USDT',
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);
```

---

## 4.2 `instruments`

Static Binance USDⓈ-M futures instrument metadata.

```sql
CREATE TABLE instruments (
  symbol TEXT PRIMARY KEY,              -- SOLUSDT, ETHUSDT, XRPUSDT
  base_asset TEXT NOT NULL,             -- SOL, ETH, XRP
  quote_asset TEXT NOT NULL,            -- USDT
  contract_type TEXT NOT NULL,          -- PERPETUAL, quarterly, etc.
  status TEXT NOT NULL,                 -- TRADING, CLOSED, DELISTING

  tick_size TEXT NOT NULL,
  step_size TEXT NOT NULL,

  min_qty TEXT NOT NULL,
  max_qty TEXT,
  min_notional TEXT NOT NULL,

  price_precision INTEGER NOT NULL,
  quantity_precision INTEGER NOT NULL,

  maintenance_margin_rate TEXT NOT NULL,

  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);
```

Example:

```text
symbol: SOLUSDT
tick_size: 0.01
step_size: 0.1
min_qty: 0.1
min_notional: 5
maintenance_margin_rate: 0.005
```

You should populate this from:

* `exchangeInfo`
* `leverageBracket`

---

## 4.3 `wallets`

Current wallet balance projection.

```sql
CREATE TABLE wallets (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  currency TEXT NOT NULL DEFAULT 'USDT',

  starting_balance TEXT NOT NULL,
  current_balance TEXT NOT NULL,

  total_fees TEXT NOT NULL DEFAULT '0',
  total_funding TEXT NOT NULL DEFAULT '0',
  total_realized_pnl TEXT NOT NULL DEFAULT '0',

  updated_at_utc TEXT NOT NULL,

  PRIMARY KEY (account_id, currency)
);
```

For USDⓈ-M futures paper trading, you usually only need USDT.

---

## 4.4 `ledger_entries`

This is the broker-grade accounting table.

Use double-entry accounting.

Every financial event creates balanced entries.

Examples:

* fee charged
* realized PnL booked
* funding paid
* funding received
* wallet deposit
* liquidation penalty

```sql
CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,

  account_id TEXT NOT NULL REFERENCES accounts(id),

  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,

  currency TEXT NOT NULL DEFAULT 'USDT',

  account_code TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),

  amount TEXT NOT NULL,

  balance_after TEXT,

  related_order_id TEXT,
  related_fill_id TEXT,
  related_position_symbol TEXT,

  description TEXT,

  created_at_utc TEXT NOT NULL
);

CREATE INDEX idx_ledger_account_time
  ON ledger_entries(account_id, created_at_utc);

CREATE INDEX idx_ledger_event
  ON ledger_entries(event_id);

CREATE INDEX idx_ledger_account_code
  ON ledger_entries(account_code);
```

Useful account codes:

```text
CASH_USDT
REALIZED_PNL
UNREALIZED_PNL
FEES_EXPENSE
FUNDING_EXPENSE
FUNDING_INCOME
MARGIN_LOCKED
LIQUIDATION_PENALTY
INSURANCE_FUND
STRATEGY_PNL
```

Example fee entry:

```text
DEBIT CASH_USDT          0.04
CREDIT FEES_EXPENSE      0.04
```

Example realized PnL:

```text
DEBIT REALIZED_PNL       12.50
CREDIT CASH_USDT         12.50
```

---

## 4.5 `orders`

Current order projection.

```sql
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  client_order_id TEXT NOT NULL,

  account_id TEXT NOT NULL REFERENCES accounts(id),
  symbol TEXT NOT NULL REFERENCES instruments(symbol),

  strategy_id TEXT,
  signal_id TEXT,

  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),

  type TEXT NOT NULL CHECK (
    type IN (
      'MARKET',
      'LIMIT',
      'STOP_MARKET',
      'TAKE_PROFIT_MARKET',
      'STOP',
      'TRAILING_STOP_MARKET'
    )
  ),

  time_in_force TEXT NOT NULL CHECK (
    time_in_force IN ('GTC', 'IOC', 'FOK', 'GTD')
  ),

  status TEXT NOT NULL CHECK (
    status IN (
      'NEW',
      'PARTIALLY_FILLED',
      'FILLED',
      'CANCELED',
      'REJECTED',
      'EXPIRED'
    )
  ),

  position_side TEXT NOT NULL DEFAULT 'BOTH'
    CHECK (position_side IN ('BOTH', 'LONG', 'SHORT')),

  quantity TEXT NOT NULL,
  filled_qty TEXT NOT NULL DEFAULT '0',

  limit_price TEXT,
  stop_price TEXT,
  activation_price TEXT,
  callback_rate TEXT,

  avg_fill_price TEXT NOT NULL DEFAULT '0',

  leverage TEXT NOT NULL,

  margin_type TEXT CHECK (margin_type IN ('CROSS', 'ISOLATED')),

  reduce_only BOOLEAN NOT NULL DEFAULT FALSE,
  post_only BOOLEAN NOT NULL DEFAULT FALSE,
  close_position BOOLEAN NOT NULL DEFAULT FALSE,

  working_type TEXT CHECK (working_type IN ('MARK_PRICE', 'CONTRACT_PRICE')),

  reject_reason TEXT,

  submitted_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,

  UNIQUE (account_id, client_order_id)
);

CREATE INDEX idx_orders_account_status
  ON orders(account_id, status);

CREATE INDEX idx_orders_symbol_time
  ON orders(symbol, submitted_at_utc);

CREATE INDEX idx_orders_strategy
  ON orders(strategy_id);

CREATE INDEX idx_orders_signal
  ON orders(signal_id);
```

---

## 4.6 `order_events`

Immutable order lifecycle history.

```sql
CREATE TABLE order_events (
  id TEXT PRIMARY KEY,

  order_id TEXT NOT NULL REFERENCES orders(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  symbol TEXT NOT NULL REFERENCES instruments(symbol),

  event_type TEXT NOT NULL,

  old_status TEXT,
  new_status TEXT,

  filled_qty TEXT,
  execution_price TEXT,

  reason TEXT,

  payload TEXT, -- JSON

  created_at_utc TEXT NOT NULL
);

CREATE INDEX idx_order_events_order
  ON order_events(order_id, created_at_utc);

CREATE INDEX idx_order_events_account_time
  ON order_events(account_id, created_at_utc);
```

Event types:

```text
ORDER_RECEIVED
ORDER_VALIDATED
ORDER_REJECTED
ORDER_ACCEPTED
ORDER_TRIGGERED
ORDER_PARTIALLY_FILLED
ORDER_FILLED
ORDER_CANCELED
ORDER_EXPIRED
```

---

## 4.7 `fills`

This is one of the most important analysis tables.

```sql
CREATE TABLE fills (
  id TEXT PRIMARY KEY,

  order_id TEXT NOT NULL REFERENCES orders(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  symbol TEXT NOT NULL REFERENCES instruments(symbol),

  strategy_id TEXT,
  signal_id TEXT,

  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),

  quantity TEXT NOT NULL,
  price TEXT NOT NULL,

  notional TEXT NOT NULL,

  fee TEXT NOT NULL,
  fee_asset TEXT NOT NULL DEFAULT 'USDT',

  liquidity TEXT NOT NULL CHECK (liquidity IN ('MAKER', 'TAKER')),

  realized_pnl TEXT NOT NULL DEFAULT '0',

  position_qty_before TEXT NOT NULL,
  position_qty_after TEXT NOT NULL,

  position_entry_before TEXT,
  position_entry_after TEXT,

  market_bid TEXT,
  market_ask TEXT,
  market_last TEXT,
  market_mark TEXT,

  expected_price TEXT,
  slippage_bps TEXT,

  fill_ts_utc TEXT NOT NULL
);

CREATE INDEX idx_fills_account_time
  ON fills(account_id, fill_ts_utc);

CREATE INDEX idx_fills_symbol_time
  ON fills(symbol, fill_ts_utc);

CREATE INDEX idx_fills_order
  ON fills(order_id);

CREATE INDEX idx_fills_strategy
  ON fills(strategy_id);

CREATE INDEX idx_fills_signal
  ON fills(signal_id);
```

Store market context at fill time:

```text
market_bid
market_ask
market_last
market_mark
expected_price
slippage_bps
```

This is critical for later analysis.

---

## 4.8 `positions`

Current position projection.

For simple net position mode:

```text
qty > 0 = long
qty < 0 = short
```

```sql
CREATE TABLE positions (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  symbol TEXT NOT NULL REFERENCES instruments(symbol),

  position_side TEXT NOT NULL DEFAULT 'BOTH'
    CHECK (position_side IN ('BOTH', 'LONG', 'SHORT')),

  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'CLOSED')),

  qty TEXT NOT NULL DEFAULT '0',
  entry_price TEXT NOT NULL DEFAULT '0',

  mark_price TEXT,
  index_price TEXT,

  unrealized_pnl TEXT NOT NULL DEFAULT '0',
  realized_pnl TEXT NOT NULL DEFAULT '0',

  leverage TEXT NOT NULL,
  margin_type TEXT CHECK (margin_type IN ('CROSS', 'ISOLATED')),

  initial_margin TEXT NOT NULL DEFAULT '0',
  maintenance_margin TEXT NOT NULL DEFAULT '0',

  maintenance_margin_rate TEXT NOT NULL,

  total_fees TEXT NOT NULL DEFAULT '0',
  total_funding TEXT NOT NULL DEFAULT '0',

  opened_at_utc TEXT,
  updated_at_utc TEXT NOT NULL,
  closed_at_utc TEXT,

  PRIMARY KEY (account_id, symbol, position_side)
);

CREATE INDEX idx_positions_symbol
  ON positions(symbol);

CREATE INDEX idx_positions_status
  ON positions(status);
```

---

## 4.9 `position_events`

Position lifecycle history.

```sql
CREATE TABLE position_events (
  id TEXT PRIMARY KEY,

  account_id TEXT NOT NULL REFERENCES accounts(id),
  symbol TEXT NOT NULL REFERENCES instruments(symbol),

  position_side TEXT NOT NULL DEFAULT 'BOTH'
    CHECK (position_side IN ('BOTH', 'LONG', 'SHORT')),

  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'OPEN',
      'INCREASE',
      'REDUCE',
      'CLOSE',
      'FLIP',
      'FUNDING',
      'MARGIN_CHANGE',
      'LIQUIDATION',
      'ADL',
      'SNAPSHOT'
    )
  ),

  fill_id TEXT REFERENCES fills(id),
  order_id TEXT REFERENCES orders(id),

  qty_before TEXT NOT NULL,
  qty_after TEXT NOT NULL,

  price TEXT,
  mark_price TEXT,

  realized_pnl TEXT,
  fee TEXT,
  funding TEXT,

  entry_price_before TEXT,
  entry_price_after TEXT,

  payload TEXT, -- JSON

  created_at_utc TEXT NOT NULL
);

CREATE INDEX idx_position_events_symbol_time
  ON position_events(symbol, created_at_utc);

CREATE INDEX idx_position_events_account_time
  ON position_events(account_id, created_at_utc);

CREATE INDEX idx_position_events_fill
  ON position_events(fill_id);
```

This table lets you reconstruct the full position history.

---

## 4.10 `account_snapshots`

This is essential for equity curve and drawdown analysis.

```sql
CREATE TABLE account_snapshots (
  id TEXT PRIMARY KEY,

  account_id TEXT NOT NULL REFERENCES accounts(id),

  ts_utc TEXT NOT NULL,

  wallet_balance TEXT NOT NULL,
  unrealized_pnl TEXT NOT NULL,
  equity TEXT NOT NULL,

  initial_margin TEXT NOT NULL,
  maintenance_margin TEXT NOT NULL,
  available_balance TEXT NOT NULL,

  margin_ratio TEXT,

  total_fees TEXT NOT NULL,
  total_funding TEXT NOT NULL,
  total_realized_pnl TEXT NOT NULL,

  open_positions_count INTEGER NOT NULL,
  open_orders_count INTEGER NOT NULL,

  daily_realized_pnl TEXT,
  daily_funding TEXT,
  daily_fees TEXT,

  peak_equity TEXT,
  drawdown TEXT,

  payload TEXT -- JSON
);

CREATE INDEX idx_account_snapshots_account_time
  ON account_snapshots(account_id, ts_utc);
```

Snapshot frequency:

* at least every minute
* every fill
* every funding event
* every liquidation event
* every strategy decision, optional

---

## 4.11 `funding_payments`

Funding analysis is very important for perpetual futures.

```sql
CREATE TABLE funding_payments (
  id TEXT PRIMARY KEY,

  account_id TEXT NOT NULL REFERENCES accounts(id),
  symbol TEXT NOT NULL REFERENCES instruments(symbol),

  position_side TEXT NOT NULL DEFAULT 'BOTH'
    CHECK (position_side IN ('BOTH', 'LONG', 'SHORT')),

  qty TEXT NOT NULL,
  mark_price TEXT NOT NULL,
  funding_rate TEXT NOT NULL,

  payment TEXT NOT NULL,

  wallet_balance_after TEXT,

  funding_time_utc TEXT NOT NULL,

  created_at_utc TEXT NOT NULL
);

CREATE INDEX idx_funding_account_time
  ON funding_payments(account_id, funding_time_utc);

CREATE INDEX idx_funding_symbol_time
  ON funding_payments(symbol, funding_time_utc);
```

Positive payment:

```text
long pays short
```

Negative payment:

```text
short pays long
```

---

## 4.12 `risk_events`

Store every risk decision.

```sql
CREATE TABLE risk_events (
  id TEXT PRIMARY KEY,

  account_id TEXT NOT NULL REFERENCES accounts(id),

  order_id TEXT REFERENCES orders(id),
  signal_id TEXT,

  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'RISK_CHECK_PASSED',
      'RISK_CHECK_FAILED',
      'ORDER_REJECTED',
      'KILL_SWITCH_TRIGGERED',
      'MAX_DAILY_LOSS_TRIGGERED',
      'MAX_POSITION_TRIGGERED',
      'STALE_MARKET_REJECT'
    )
  ),

  check_name TEXT,
  result TEXT NOT NULL,
  reason TEXT,

  payload TEXT, -- JSON

  created_at_utc TEXT NOT NULL
);

CREATE INDEX idx_risk_events_account_time
  ON risk_events(account_id, created_at_utc);

CREATE INDEX idx_risk_events_order
  ON risk_events(order_id);
```

---

## 4.13 `market_states_current`

Current market projection.

```sql
CREATE TABLE market_states_current (
  symbol TEXT PRIMARY KEY REFERENCES instruments(symbol),

  bid TEXT,
  ask TEXT,

  bid_qty TEXT,
  ask_qty TEXT,

  last TEXT,
  mark TEXT,
  index_price TEXT,

  funding_rate TEXT,
  next_funding_time_utc TEXT,

  exchange_ts_utc TEXT,
  local_ts_utc TEXT NOT NULL,

  stale BOOLEAN NOT NULL DEFAULT FALSE
);
```

This is not for deep analysis. It is for current engine state.

---

## 4.14 `market_ticks`

For analysis, be careful. Full tick data can become huge.

```sql
CREATE TABLE market_ticks (
  id TEXT PRIMARY KEY,

  symbol TEXT NOT NULL REFERENCES instruments(symbol),

  ts_utc TEXT NOT NULL,

  bid TEXT,
  ask TEXT,

  bid_qty TEXT,
  ask_qty TEXT,

  last TEXT,
  last_qty TEXT,

  mark TEXT,
  index_price TEXT,

  funding_rate TEXT,

  payload TEXT -- optional raw JSON
);

CREATE INDEX idx_market_ticks_symbol_time
  ON market_ticks(symbol, ts_utc);
```

For local paper trading, do not store every tick forever.

Recommended:

* store raw ticks only temporarily
* downsample to 100ms, 1s, or 1m
* store fills with market context separately

---

## 4.15 `order_book_snapshots`

Optional but useful for realistic fill analysis.

```sql
CREATE TABLE order_book_snapshots (
  id TEXT PRIMARY KEY,

  symbol TEXT NOT NULL REFERENCES instruments(symbol),

  ts_utc TEXT NOT NULL,

  last_update_id TEXT,
  sequence TEXT,

  payload TEXT -- JSON full book or top levels
);

CREATE INDEX idx_order_book_snapshots_symbol_time
  ON order_book_snapshots(symbol, ts_utc);
```

For deeper analysis:

```sql
CREATE TABLE order_book_levels (
  snapshot_id TEXT NOT NULL REFERENCES order_book_snapshots(id),

  side TEXT NOT NULL CHECK (side IN ('BID', 'ASK')),
  level INTEGER NOT NULL,

  price TEXT NOT NULL,
  qty TEXT NOT NULL,

  PRIMARY KEY (snapshot_id, side, level)
);
```

---

## 4.16 `klines`

Useful for strategy analysis and backtesting.

```sql
CREATE TABLE klines (
  symbol TEXT NOT NULL REFERENCES instruments(symbol),

  interval TEXT NOT NULL, -- 1m, 5m, 15m, 1h, 4h, 1d

  open_time_utc TEXT NOT NULL,

  open TEXT NOT NULL,
  high TEXT NOT NULL,
  low TEXT NOT NULL,
  close TEXT NOT NULL,

  volume TEXT NOT NULL,
  quote_volume TEXT,

  trades_count INTEGER,

  PRIMARY KEY (symbol, interval, open_time_utc)
);
```

You can fetch historical klines from Binance REST and then update live klines from WebSocket.

---

## 4.17 `strategies`

If you run multiple strategies or AI agents.

```sql
CREATE TABLE strategies (
  id TEXT PRIMARY KEY,

  name TEXT NOT NULL,
  version TEXT NOT NULL,

  description TEXT,
  config TEXT, -- JSON

  enabled BOOLEAN NOT NULL DEFAULT TRUE,

  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);
```

---

## 4.18 `signals`

Store every strategy or AI decision.

```sql
CREATE TABLE signals (
  id TEXT PRIMARY KEY,

  account_id TEXT NOT NULL REFERENCES accounts(id),
  strategy_id TEXT REFERENCES strategies(id),
  symbol TEXT NOT NULL REFERENCES instruments(symbol),

  ts_utc TEXT NOT NULL,

  action TEXT NOT NULL CHECK (
    action IN (
      'BUY',
      'SELL',
      'CLOSE_LONG',
      'CLOSE_SHORT',
      'HOLD',
      'CANCEL_ALL',
      'FLATTEN'
    )
  ),

  confidence TEXT,

  model_name TEXT,
  model_version TEXT,

  features TEXT, -- JSON
  reasoning TEXT,

  order_id TEXT REFERENCES orders(id),

  payload TEXT -- JSON
);

CREATE INDEX idx_signals_symbol_time
  ON signals(symbol, ts_utc);

CREATE INDEX idx_signals_strategy_time
  ON signals(strategy_id, ts_utc);

CREATE INDEX idx_signals_order
  ON signals(order_id);
```

This is important if you later want to answer:

> Did the AI signal produce profitable trades?

---

## 4.19 `ai_inferences`

Optional, but useful if you use Ollama.

```sql
CREATE TABLE ai_inferences (
  id TEXT PRIMARY KEY,

  signal_id TEXT REFERENCES signals(id),

  model_name TEXT NOT NULL,
  model_version TEXT,

  prompt TEXT,
  response TEXT,

  structured_output TEXT, -- JSON

  latency_ms INTEGER,

  tokens_input INTEGER,
  tokens_output INTEGER,

  created_at_utc TEXT NOT NULL
);
```

---

## 4.20 `system_events`

Operational health.

```sql
CREATE TABLE system_events (
  id TEXT PRIMARY KEY,

  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'WS_CONNECTED',
      'WS_DISCONNECTED',
      'WS_RECONNECTING',
      'WS_RESUBSCRIBED',
      'REST_REQUEST',
      'REST_ERROR',
      'STALE_MARKET',
      'SNAPSHOT_CREATED',
      'ENGINE_STARTED',
      'ENGINE_STOPPED',
      'CLOCK_DRIFT_WARNING'
    )
  ),

  payload TEXT, -- JSON

  created_at_utc TEXT NOT NULL
);

CREATE INDEX idx_system_events_time
  ON system_events(created_at_utc);
```

---

# 5. Event store table

This is the backbone.

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,

  seq INTEGER PRIMARY KEY AUTOINCREMENT, -- SQLite only; for Postgres use BIGSERIAL

  event_type TEXT NOT NULL,

  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,

  account_id TEXT,
  symbol TEXT,

  correlation_id TEXT,
  causation_id TEXT,

  schema_version INTEGER NOT NULL DEFAULT 1,

  payload TEXT NOT NULL, -- JSON

  created_at_utc TEXT NOT NULL
);

CREATE INDEX idx_events_aggregate
  ON events(aggregate_type, aggregate_id);

CREATE INDEX idx_events_account_time
  ON events(account_id, created_at_utc);

CREATE INDEX idx_events_symbol_time
  ON events(symbol, created_at_utc);

CREATE INDEX idx_events_type_time
  ON events(event_type, created_at_utc);
```

For PostgreSQL, use:

```sql
seq BIGSERIAL PRIMARY KEY
```

For SQLite, the above is okay.

---

# 6. Recommended event payload examples

## Order received

```json
{
  "event_type": "ORDER_RECEIVED",
  "order_id": "0193c6f8-...",
  "client_order_id": "strategy-1-0001",
  "account_id": "paper-main",
  "symbol": "SOLUSDT",
  "side": "BUY",
  "type": "MARKET",
  "quantity": "1.0",
  "leverage": "5",
  "reduce_only": false,
  "post_only": false
}
```

## Fill created

```json
{
  "event_type": "FILL_CREATED",
  "fill_id": "0193c6f9-...",
  "order_id": "0193c6f8-...",
  "symbol": "SOLUSDT",
  "side": "BUY",
  "quantity": "1.0",
  "price": "145.23",
  "fee": "0.058092",
  "liquidity": "TAKER",
  "realized_pnl": "0",
  "position_qty_before": "0",
  "position_qty_after": "1.0",
  "market_bid": "145.21",
  "market_ask": "145.22",
  "market_mark": "145.20"
}
```

## Position opened

```json
{
  "event_type": "POSITION_OPENED",
  "symbol": "SOLUSDT",
  "position_side": "BOTH",
  "qty_before": "0",
  "qty_after": "1.0",
  "entry_price": "145.23",
  "leverage": "5"
}
```

## Funding applied

```json
{
  "event_type": "FUNDING_APPLIED",
  "symbol": "SOLUSDT",
  "qty": "1.0",
  "mark_price": "145.20",
  "funding_rate": "0.0001",
  "payment": "0.01452"
}
```

## Account snapshot

```json
{
  "event_type": "ACCOUNT_SNAPSHOT",
  "wallet_balance": "10000",
  "unrealized_pnl": "12.4",
  "equity": "10012.4",
  "initial_margin": "290.4",
  "maintenance_margin": "7.26",
  "available_balance": "9722.0"
}
```

---

# 7. Analytical views you should create

Once the tables exist, create views or materialized tables for analysis.

---

## 7.1 Equity curve

```sql
CREATE VIEW v_equity_curve AS
SELECT
  account_id,
  ts_utc,
  wallet_balance,
  unrealized_pnl,
  equity,
  available_balance,
  drawdown
FROM account_snapshots
ORDER BY ts_utc;
```

---

## 7.2 Daily performance

```sql
CREATE VIEW v_daily_performance AS
SELECT
  account_id,
  DATE(ts_utc) AS day,
  MAX(equity) AS max_equity,
  MIN(equity) AS min_equity,
  SUM(daily_realized_pnl) AS realized_pnl,
  SUM(daily_fees) AS fees,
  SUM(daily_funding) AS funding
FROM account_snapshots
GROUP BY account_id, DATE(ts_utc);
```

---

## 7.3 PnL by symbol

```sql
CREATE VIEW v_symbol_pnl AS
SELECT
  symbol,
  SUM(realized_pnl) AS realized_pnl,
  SUM(fee) AS fees,
  COUNT(*) AS fills
FROM fills
GROUP BY symbol;
```

---

## 7.4 Strategy performance

```sql
CREATE VIEW v_strategy_pnl AS
SELECT
  strategy_id,
  COUNT(*) AS fills,
  SUM(realized_pnl) AS realized_pnl,
  SUM(fee) AS fees
FROM fills
WHERE strategy_id IS NOT NULL
GROUP BY strategy_id;
```

---

## 7.5 Slippage analysis

```sql
CREATE VIEW v_slippage AS
SELECT
  symbol,
  side,
  liquidity,
  AVG(CAST(slippage_bps AS REAL)) AS avg_slippage_bps,
  COUNT(*) AS fills
FROM fills
WHERE slippage_bps IS NOT NULL
GROUP BY symbol, side, liquidity;
```

---

## 7.6 Funding cost by symbol

```sql
CREATE VIEW v_funding_cost AS
SELECT
  symbol,
  SUM(CAST(payment AS REAL)) AS total_funding,
  COUNT(*) AS funding_events
FROM funding_payments
GROUP BY symbol;
```

---

## 7.7 Order funnel

```sql
CREATE VIEW v_order_funnel AS
SELECT
  event_type,
  COUNT(*) AS count
FROM order_events
GROUP BY event_type;
```

---

## 7.8 Reject reasons

```sql
CREATE VIEW v_order_rejects AS
SELECT
  reject_reason,
  COUNT(*) AS count
FROM orders
WHERE status = 'REJECTED'
GROUP BY reject_reason;
```

---

# 8. Time-series strategy

Market data can explode quickly.

For SOL, ETH, XRP:

* `bookTicker` can send many updates per second
* `aggTrade` can be high frequency
* `markPrice@1s` is manageable

Do not store every tick indefinitely in SQLite.

Recommended approach:

```text
Raw WebSocket events
        │
        ▼
In-memory ring buffer
        │
        ├── engine uses raw stream immediately
        │
        ├── downsample every 1 second
        │       └── store top-of-book, mark, last
        │
        ├── downsample every 1 minute
        │       └── store OHLCV
        │
        └── store fills with market context forever
```

Store long-term:

```text
fills
position_events
account_snapshots
funding_payments
order_events
signals
1m klines
1s mark/top-of-book summaries
```

Store short-term:

```text
raw ticks
full order book snapshots
debug payloads
```

---

# 9. Suggested retention policy

For local paper trading:

| Data | Retention |
| --- | ---: |
| events | forever, append-only |
| fills | forever |
| orders | forever |
| position_events | forever |
| account_snapshots | forever |
| funding_payments | forever |
| risk_events | forever |
| signals | forever |
| raw ticks | 1–7 days |
| order book snapshots | 1–7 days |
| 1s market summaries | 30–90 days |
| 1m klines | forever |

If disk usage matters, compress old data into Parquet.

---

# 10. Recommended storage stack

## Local MVP

```text
SQLite + JSONL event log
```

Use:

```text
data/paper.sqlite3
data/events.jsonl
data/snapshots/latest.json
```

Enable SQLite WAL mode:

```sql
PRAGMA journal_mode=WAL;
```

## Serious analysis

```text
PostgreSQL + TimescaleDB
```

Use TimescaleDB for:

```text
market_ticks
account_snapshots
klines
order_book_snapshots
```

## Offline analytics

Export to:

```text
Parquet + DuckDB
```

Good for:

* backtesting
* notebooks
* strategy research
* large historical queries

---

# 11. Production-grade amount modeling

You need to decide how to store prices and quantities.

## Option A: Decimal strings

Store canonical values as text:

```text
quantity: "0.001"
price: "145.23"
fee: "0.058092"
```

Pros:

* exact canonical representation
* easy to serialize
* works with decimal.js

Cons:

* SQL aggregation is harder

## Option B: Numeric columns

PostgreSQL:

```sql
NUMERIC(36,18)
```

Pros:

* database can aggregate
* good for analysis

Cons:

* still need app-level decimal care

## Option C: Fixed-point integers

Example:

```text
USDT stored in micro units: 1 USDT = 1_000_000
price stored in 1e8 units
qty stored in 1e8 units
```

Pros:

* deterministic
* fast
* no floating point

Cons:

* more complex schema and conversion

Recommended:

* PostgreSQL: `NUMERIC`
* SQLite: canonical `TEXT` + app-level decimal
* analytics warehouse: `NUMERIC` or fixed-point integers

---

# 12. Minimum viable data model

If you want the smallest useful schema, use these tables:

```text
accounts
instruments
wallets
orders
order_events
fills
positions
position_events
account_snapshots
funding_payments
risk_events
signals
system_events
events
```

That is enough for:

* persistence
* audit
* PnL analysis
* risk analysis
* strategy attribution
* replay

---

# 13. Full broker-grade data model

For a more complete broker simulation, add:

```text
ledger_entries
margin_orders
margin_balances
position_margin_history
liquidation_events
insurance_fund_events
adl_events
reconciliation_runs
reconciliation_diffs
api_request_logs
ws_connection_sessions
market_data_sessions
strategy_configs
model_registry
ai_inferences
backtest_runs
backtest_results
```

---

# 14. Reconciliation tables

If you mirror Binance Testnet, add:

```sql
CREATE TABLE reconciliation_runs (
  id TEXT PRIMARY KEY,

  started_at_utc TEXT NOT NULL,
  completed_at_utc TEXT,

  source TEXT NOT NULL, -- BINANCE_TESTNET, LOCAL
  status TEXT NOT NULL, -- RUNNING, SUCCESS, FAILED, DIFF_FOUND

  payload TEXT
);

CREATE TABLE reconciliation_diffs (
  id TEXT PRIMARY KEY,

  run_id TEXT NOT NULL REFERENCES reconciliation_runs(id),

  entity TEXT NOT NULL, -- ORDER, POSITION, BALANCE, FILL
  entity_id TEXT,

  field TEXT NOT NULL,

  local_value TEXT,
  remote_value TEXT,

  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'ERROR')),

  created_at_utc TEXT NOT NULL
);
```

---

# 15. Example analytical questions your model should answer

Your data model is good if you can answer these:

## Trading performance

* What is my equity curve?
* What is my max drawdown?
* What is my Sharpe ratio?
* What is my win rate?
* What is my expectancy?
* Which symbol has the best realized PnL?
* Which strategy produced the best PnL?

## Execution quality

* What was the average slippage for SOLUSDT market orders?
* Did limit orders perform better than market orders?
* How often did post-only orders get rejected?
* How often did orders fail due to stale market data?

## Risk

* How many risk rejects occurred?
* What was the largest margin utilization?
* Did the engine ever approach liquidation?
* What was the largest intraday drawdown?

## Costs

* Total fees paid by symbol?
* Total funding paid by symbol?
* Did funding costs destroy profitability?
* What was the net PnL after fees and funding?

## Strategy

* Which signal ID caused this fill?
* Did high-confidence signals perform better?
* What features were present before winning trades?
* Did the AI model produce better signals at certain hours?

---

# 16. Recommended final schema summary

For your SOL/ETH/XRP USD-M futures paper broker, use this data model:

## Core broker state

```text
accounts
wallets
ledger_entries
orders
order_events
fills
positions
position_events
```

## Account analytics

```text
account_snapshots
funding_payments
risk_events
```

## Market analytics

```text
instruments
market_states_current
market_ticks
order_book_snapshots
klines
```

## Strategy/AI

```text
strategies
signals
ai_inferences
```

## Operations

```text
events
system_events
reconciliation_runs
reconciliation_diffs
```

---

# 17. Most important table design choices

If you only remember a few things:

## Store fills with market context

```text
bid_at_fill
ask_at_fill
mark_at_fill
expected_price
slippage_bps
```

## Store position changes as events

```text
OPEN
INCREASE
REDUCE
CLOSE
FLIP
FUNDING
LIQUIDATION
```

## Store account snapshots over time

```text
equity
wallet_balance
unrealized_pnl
margin
available_balance
drawdown
```

## Store every order rejection

```text
reason
risk check
market state
timestamp
```

## Store signals linked to orders

```text
signal_id -> order_id -> fill_id
```

This gives you full attribution from AI/strategy decision to executed PnL.

---

# 18. Final recommendation

Use:

```text
Event-sourced JSONL/SQLite events
+
relational projection tables
+
time-series snapshots
```

Minimum production-ready database:

```text
SQLite
WAL mode
append-only events table
normalized fills/positions/orders/snapshots tables
daily Parquet export for analysis
```

Later:

```text
PostgreSQL + TimescaleDB
or
ClickHouse / DuckDB / Parquet for analytics
```

The most important principle:

> Every change to wallet, order, position, or market state should be traceable through immutable events, and every fill should preserve the market context needed for later analysis.

## Final Tech Stack

Use this exact stack.

| Layer | Final Choice |
|---|---|
| Runtime | Node.js 22 LTS |
| Language | TypeScript strict mode |
| Module system | ESM |
| Package manager | pnpm |
| App framework | Fastify |
| Binance market data SDK | `@shubhamtaywade82/binance-client-ts` |
| Local AI SDK | Ollama + `@shubhamtaywade82/ollama-client-ts` |
| Validation | Zod |
| Money math | Decimal.js |
| Primary persistence | SQLite via `better-sqlite3` |
| Event store | SQLite `events` table + append-only JSONL backup |
| Analytics database | DuckDB |
| Analytics export format | Parquet |
| Scheduler | `node-cron` |
| IDs | ULID |
| Logging | Pino |
| Testing | Vitest |
| Linting | ESLint |
| Formatting | Prettier |
| Config | `.env` + Zod validation |
| Deployment | Docker + Docker Compose |
| CI | GitHub Actions |

---

# Final Runtime Dependencies

```json
{
  "dependencies": {
    "@shubhamtaywade82/binance-client-ts": "latest",
    "@shubhamtaywade82/ollama-client-ts": "latest",
    "better-sqlite3": "^11.0.0",
    "dayjs": "^1.11.0",
    "decimal.js": "^10.4.3",
    "dotenv": "^16.4.5",
    "fastify": "^4.28.0",
    "node-cron": "^3.0.3",
    "pino": "^9.0.0",
    "ulid": "^2.3.0",
    "zod": "^3.23.0"
  }
}
```

---

# Final Dev Dependencies

```json
{
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.10",
    "@types/node": "^22.0.0",
    "@types/node-cron": "^3.0.11",
    "eslint": "^9.0.0",
    "pino-pretty": "^11.0.0",
    "prettier": "^3.2.5",
    "tsx": "^4.10.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

---

# Final Architecture Style

Use a **single-process modular monolith**.

Do not use microservices.

Do not use Redis.

Do not use Kafka.

Do not use RabbitMQ.

Do not use MongoDB.

Do not use an ORM.

Use plain TypeScript repositories over SQLite.

```text
Fastify control API
        │
        ▼
Paper Broker Core
        │
        ├── Binance WS Gateway
        ├── Market Data Normalizer
        ├── Risk Engine
        ├── Order Engine
        ├── Matching Engine
        ├── Position Engine
        ├── Wallet Engine
        ├── Ledger Engine
        ├── Funding Engine
        ├── Snapshot Scheduler
        ├── Event Store
        └── SQLite Projections
```

---

# Final Database Choice

Use **SQLite** as the main operational database.

Database file:

```text
data/paper.sqlite3
```

Enable WAL mode.

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;
```

Use SQLite for:

- events
- orders
- fills
- positions
- wallet
- ledger
- account snapshots
- funding payments
- risk events
- signals
- system events

---

# Final Timestamp Rule

Store all timestamps as:

```text
INTEGER epoch milliseconds UTC
```

Example:

```ts
Date.now()
```

Do not store local timestamps.

Use `dayjs` only for display and cron logic.

---

# Final Money Rule

Store all prices, quantities, balances, fees, funding, and PnL as canonical decimal strings.

Example:

```text
"145.23"
"0.001"
"0.058092"
```

Do all math using `decimal.js`.

Do not use JavaScript `number` for money.

Do not store money as `REAL` in SQLite.

---

# Final ID Rule

Use ULIDs for:

- event IDs
- order IDs
- fill IDs
- position event IDs
- signal IDs
- snapshot IDs

Use deterministic IDs where idempotency matters.

Example:

```ts
clientOrderId = `sig_${signalId}_sym_SOLUSDT_side_BUY_qty_1`
```

---

# Final Event Sourcing Rule

Use an append-only `events` table.

Every state-changing action writes an event first.

Then update projection tables.

Events are immutable.

Never update or delete event rows.

Core event types:

```text
ORDER_RECEIVED
ORDER_REJECTED
ORDER_ACCEPTED
ORDER_TRIGGERED
ORDER_PARTIALLY_FILLED
ORDER_FILLED
ORDER_CANCELED
ORDER_EXPIRED

FILL_CREATED

POSITION_OPENED
POSITION_INCREASED
POSITION_REDUCED
POSITION_CLOSED
POSITION_FLIPPED

WALLET_DEPOSITED
FEE_CHARGED
REALIZED_PNL_BOOKED
FUNDING_APPLIED

ACCOUNT_SNAPSHOT_CREATED

RISK_CHECK_FAILED
KILL_SWITCH_TRIGGERED

WS_CONNECTED
WS_DISCONNECTED
MARKET_STALE
```

Also write events to:

```text
data/events.jsonl
```

This is your backup/replay log.

---

# Final Persistence Tables

Use these tables:

```text
accounts
instruments
wallets
ledger_entries
events
orders
order_events
fills
positions
position_events
account_snapshots
funding_payments
risk_events
signals
ai_inferences
strategies
market_states_current
market_ticks_1s
klines_1m
system_events
```

Do not store every raw WebSocket tick forever.

Store:

```text
fills forever
position_events forever
account_snapshots forever
funding_payments forever
orders forever
order_events forever
signals forever
```

Store raw ticks only temporarily.

---

# Final Market Data Persistence

Use three levels.

## Real-time engine state

```text
market_states_current
```

## 1-second analytics table

```text
market_ticks_1s
```

Fields:

```text
symbol
ts
bid
ask
last
mark
index_price
funding_rate
```

## 1-minute candles

```text
klines_1m
```

Fields:

```text
symbol
open_time
open
high
low
close
volume
quote_volume
```

---

# Final Analytics Stack

Use **DuckDB** for analysis.

DuckDB queries SQLite directly.

Use it for:

- equity curve
- drawdown
- PnL by symbol
- strategy attribution
- slippage analysis
- funding analysis
- order funnel analysis
- signal performance

Export old data to Parquet.

Recommended Parquet exports:

```text
data/analytics/fills.parquet
data/analytics/account_snapshots.parquet
data/analytics/position_events.parquet
data/analytics/funding_payments.parquet
data/analytics/market_ticks_1s.parquet
data/analytics/signals.parquet
```

Use DuckDB for querying Parquet.

---

# Final AI Stack

Use local Ollama.

Use:

```text
@shubhamtaywade82/ollama-client-ts
```

Use Zod for all AI outputs.

AI must only emit:

```ts
OrderIntent
```

AI must never mutate:

- wallet
- position
- order
- ledger
- database

AI flow:

```text
Ollama
  → Zod schema
  → signal
  → risk engine
  → paper broker
```

---

# Final API Layer

Use Fastify for local control and inspection.

Expose:

```text
GET  /health
GET  /account
GET  /positions
GET  /orders
GET  /fills
GET  /signals
GET  /metrics

POST /orders
POST /orders/cancel
POST /orders/cancel-all
POST /engine/start
POST /engine/stop
POST /engine/kill-switch
```

Use Zod for request validation.

---

# Final Strategy Interface

Strategy receives only a read/write broker context.

```ts
interface StrategyContext {
  getAccount(): AccountState;
  getPosition(symbol: string): Position | undefined;
  getOpenOrders(symbol?: string): Order[];
  submitOrder(intent: OrderIntent): Order;
  cancelOrder(orderId: string): void;
  cancelAllOrders(symbol?: string): void;
}
```

Strategy does not access:

- database
- WebSocket raw payloads
- wallet directly
- positions directly
- ledger directly

---

# Final Risk Engine Rules

The risk engine is mandatory.

It must check:

```text
instrument enabled
market data fresh
valid quantity
valid price
tick size
step size
min quantity
min notional
max order notional
max position notional
max leverage
max open orders
max daily loss
available balance
reduce-only validity
post-only validity
kill switch
stale market
duplicate client order ID
```

Risk engine decisions must be stored in:

```text
risk_events
```

---

# Final Scheduler Jobs

Use `node-cron`.

Run:

```text
every 1 second:
  mark stale markets

every 1 second:
  write 1s market tick summary

every 1 minute:
  write 1m kline

every 1 minute:
  write account snapshot

every 8 hours:
  apply funding at Binance funding timestamps

daily at UTC midnight:
  roll daily equity baseline
```

---

# Final Testing Stack

Use Vitest.

Required tests:

```text
order lifecycle tests
market order fill tests
limit order fill tests
post-only reject tests
IOC/FOK tests
reduce-only tests
position netting tests
position flip tests
realized PnL tests
unrealized PnL tests
fee tests
funding tests
margin tests
risk reject tests
liquidation tests
event replay tests
```

Use golden files:

```text
test/fixtures/market-events.jsonl
test/fixtures/expected-state.json
```

---

# Final Deployment Stack

Use Docker.

Dockerfile:

```dockerfile
FROM node:22-alpine

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
```

Docker Compose:

```yaml
services:
  paper-engine:
    build: .
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - ./data:/app/data
    ports:
      - "8080:8080"
```

Ollama runs on the host or as a separate container.

---

# Final Config

Use `.env`.

Required variables:

```env
NODE_ENV=production
PORT=8080

BINANCE_ENV=testnet
BINANCE_API_KEY=
BINANCE_API_SECRET=

OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3.5:2b

PAPER_STARTING_USDT=10000

DB_FILE=data/paper.sqlite3
EVENT_LOG_FILE=data/events.jsonl
SNAPSHOT_DIR=data/snapshots
ANALYTICS_DIR=data/analytics

LOG_LEVEL=info
```

Validate `.env` with Zod at startup.

---

# Final Project Structure

```text
paper-broker/
├── src/
│   ├── index.ts
│   ├── config/
│   │   ├── env.ts
│   │   └── instruments.ts
│   │
│   ├── binance/
│   │   ├── client.ts
│   │   ├── streams.ts
│   │   ├── bootstrap.ts
│   │   └── normalizers.ts
│   │
│   ├── broker/
│   │   ├── PaperBroker.ts
│   │   ├── OrderEngine.ts
│   │   ├── MatchingEngine.ts
│   │   ├── PositionEngine.ts
│   │   ├── WalletEngine.ts
│   │   ├── LedgerEngine.ts
│   │   ├── MarginEngine.ts
│   │   ├── FundingEngine.ts
│   │   ├── RiskEngine.ts
│   │   └── LiquidationEngine.ts
│   │
│   ├── market/
│   │   ├── MarketState.ts
│   │   ├── MarketFeed.ts
│   │   ├── OrderBook.ts
│   │   └── Klines.ts
│   │
│   ├── persistence/
│   │   ├── db.ts
│   │   ├── EventStore.ts
│   │   ├── repositories/
│   │   └── snapshots.ts
│   │
│   ├── strategy/
│   │   ├── StrategyContext.ts
│   │   ├── StrategyRunner.ts
│   │   └── strategies/
│   │
│   ├── ai/
│   │   ├── ollama.ts
│   │   ├── schemas.ts
│   │   └── signalAdapter.ts
│   │
│   ├── api/
│   │   ├── server.ts
│   │   ├── routes/
│   │   └── schemas.ts
│   │
│   ├── telemetry/
│   │   ├── logger.ts
│   │   └── metrics.ts
│   │
│   └── scheduler/
│       └── jobs.ts
│
├── data/
│   ├── paper.sqlite3
│   ├── events.jsonl
│   ├── snapshots/
│   └── analytics/
│
├── test/
│   ├── fixtures/
│   └── unit/
│
├── .env
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── eslint.config.js
└── vitest.config.ts
```

---

# Final Operational Rules

1. WebSocket is used for market data.
2. REST is used only for bootstrap and optional reconciliation.
3. Paper fills are local.
4. No live trading unless explicitly enabled.
5. All state changes go through the broker core.
6. All money math uses Decimal.js.
7. All timestamps are UTC epoch milliseconds.
8. All events are append-only.
9. All AI output is Zod-validated.
10. All order submission requires a risk check.

---

# Final Stack Summary

```text
Node.js 22
TypeScript strict
pnpm
Fastify
@shubhamtaywade82/binance-client-ts
@shubhamtaywade82/ollama-client-ts
Ollama
Zod
Decimal.js
better-sqlite3
SQLite WAL
Event-sourced ledger
DuckDB
Parquet
node-cron
ULID
Pino
Vitest
Docker
GitHub Actions
```

This is the final stack.

You generate signals by adding a **Strategy Layer** between the market data feed and the paper broker.

The rule is:

```text
Market data → normalized state → features → strategies → signals → risk/sizing → paper broker
```

Strategies do **not** place orders directly.
Strategies emit typed signals.
The signal engine converts valid signals into broker order commands.

---

# 1. Final signal pipeline

```text
Binance WebSocket
  ├── bookTicker
  ├── aggTrade
  ├── markPrice
  └── kline streams
        │
        ▼
Market Normalizer
        │
        ├── PaperBroker.onMarket()
        │
        ▼
Strategy Engine
        │
        ├── Candle Store
        ├── Feature Builder
        ├── Indicator Calculator
        │
        ├── Strategy A
        ├── Strategy B
        ├── Strategy C
        └── AI Strategy
        │
        ▼
Zod-validated Signal
        │
        ▼
Signal Store
        │
        ▼
Risk Engine + Sizing Engine
        │
        ▼
Order Factory
        │
        ▼
PaperBroker.submitOrder()
```

The paper broker remains the only component allowed to mutate:

- wallet
- orders
- fills
- positions
- ledger

---

# 2. Strategy output model

Use one common signal schema.

```ts
import { z } from 'zod';

export const SignalActionSchema = z.enum([
  'OPEN_LONG',
  'OPEN_SHORT',
  'CLOSE_LONG',
  'CLOSE_SHORT',
  'CANCEL_ALL',
  'HOLD',
]);

export const SignalInputSchema = z.object({
  strategyId: z.string(),
  symbol: z.string(),

  action: SignalActionSchema,

  confidence: z.number().min(0).max(1),

  stopLossPrice: z.string().optional(),
  takeProfitPrice: z.string().optional(),

  ttlMs: z.number().int().positive().default(60_000),

  features: z.record(z.unknown()).default({}),
  reasoning: z.string().optional(),
});

export type SignalInput = z.infer<typeof SignalInputSchema>;

export const SignalSchema = SignalInputSchema.extend({
  id: z.string(),
  ts: z.number(),
  orderId: z.string().optional(),
  status: z.enum([
    'CREATED',
    'ACCEPTED',
    'REJECTED',
    'EXECUTED',
    'EXPIRED',
  ]),
});

export type Signal = z.infer<typeof SignalSchema>;
```

Strategies return this:

```ts
{
  strategyId: 'ema-trend-5m',
  symbol: 'SOLUSDT',
  action: 'OPEN_LONG',
  confidence: 0.82,
  stopLossPrice: '141.20',
  takeProfitPrice: '151.80',
  features: {
    emaFast: 145.2,
    emaSlow: 144.6,
    atr14: 0.85,
    fundingRate: 0.0001,
  },
  reasoning: 'EMA9 crossed above EMA21 with positive trend slope.',
}
```

---

# 3. Strategy interface

Use one interface for all strategies.

```ts
import type { Candle } from './candle';
import type { MarketState } from './market-state';

export interface StrategyContext {
  getMarket(symbol: string): MarketState | undefined;

  getCandles(
    symbol: string,
    interval: string,
    limit: number
  ): Candle[];

  getAccount(): AccountState;

  getPosition(symbol: string): Position | undefined;

  getOpenOrders(symbol?: string): Order[];

  hasOpenPosition(symbol: string): boolean;

  hasOpenOrder(symbol: string): boolean;
}

export interface Strategy {
  id: string;
  name: string;

  enabled: boolean;

  symbols: string[];

  intervals: string[];

  priority: number;

  cooldownMs: number;

  init?(ctx: StrategyContext): Promise<void>;

  onCandleClose?(
    ctx: StrategyContext,
    candle: Candle
  ): Promise<SignalInput[]>;

  onTick?(
    ctx: StrategyContext,
    market: MarketState
  ): Promise<SignalInput[]>;
}
```

---

# 4. Candle model

Use closed candles for most strategies.

```ts
export interface Candle {
  symbol: string;
  interval: string;

  openTime: number;
  closeTime: number;

  open: number;
  high: number;
  low: number;
  close: number;

  volume: number;
  quoteVolume: number;

  closed: boolean;
}
```

Use candle-close signals for:

- trend
- mean reversion
- breakout
- AI reasoning

Use tick signals only for very fast execution logic.

---

# 5. Strategy engine

The strategy engine receives market updates and candle closes.

```ts
import { ulid } from 'ulid';
import { SignalInputSchema, type SignalInput } from './signal';

export class StrategyEngine {
  private strategies: Strategy[] = [];

  private lastSignalAt = new Map<string, number>();

  constructor(
    private broker: PaperBroker,
    private signalStore: SignalStore,
    private sizingEngine: SizingEngine,
    private orderFactory: OrderFactory,
    private logger: Logger
  ) {}

  register(strategy: Strategy): void {
    this.strategies.push(strategy);
  }

  async start(): Promise<void> {
    const ctx = this.createContext();

    for (const strategy of this.strategies) {
      if (strategy.init) {
        await strategy.init(ctx);
      }
    }
  }

  async onMarket(market: MarketState): Promise<void> {
    const ctx = this.createContext();

    for (const strategy of this.strategies) {
      if (!strategy.enabled) continue;
      if (!strategy.symbols.includes(market.symbol)) continue;
      if (!strategy.onTick) continue;

      const signals = await strategy.onTick(ctx, market);

      await this.processSignals(signals);
    }
  }

  async onCandleClose(candle: Candle): Promise<void> {
    const ctx = this.createContext();

    for (const strategy of this.strategies) {
      if (!strategy.enabled) continue;
      if (!strategy.symbols.includes(candle.symbol)) continue;
      if (!strategy.intervals.includes(candle.interval)) continue;
      if (!strategy.onCandleClose) continue;

      const signals = await strategy.onCandleClose(ctx, candle);

      await this.processSignals(signals);
    }
  }

  private async processSignals(inputs: unknown[]): Promise<void> {
    for (const input of inputs) {
      const parsed = SignalInputSchema.safeParse(input);

      if (!parsed.success) {
        this.logger.warn({
          event: 'SIGNAL_REJECTED',
          reason: 'INVALID_SCHEMA',
          error: parsed.error.message,
        });

        continue;
      }

      const signalInput = parsed.data;

      if (this.isCoolingDown(signalInput)) {
        continue;
      }

      if (this.isDuplicate(signalInput)) {
        continue;
      }

      const signal = await this.acceptSignal(signalInput);

      await this.executeSignal(signal);
    }
  }

  private isCoolingDown(signal: SignalInput): boolean {
    const strategy = this.strategies.find(
      (s) => s.id === signal.strategyId
    );

    if (!strategy) return true;

    const key = `${strategy.id}:${signal.symbol}:${signal.action}`;
    const now = Date.now();

    const last = this.lastSignalAt.get(key) ?? 0;

    if (now - last < strategy.cooldownMs) {
      return true;
    }

    this.lastSignalAt.set(key, now);

    return false;
  }

  private isDuplicate(signal: SignalInput): boolean {
    const position = this.broker.getPosition(signal.symbol);

    if (!position) return false;

    if (signal.action === 'OPEN_LONG' && position.qty > 0) {
      return true;
    }

    if (signal.action === 'OPEN_SHORT' && position.qty < 0) {
      return true;
    }

    if (signal.action === 'CLOSE_LONG' && position.qty <= 0) {
      return true;
    }

    if (signal.action === 'CLOSE_SHORT' && position.qty >= 0) {
      return true;
    }

    return false;
  }

  private async acceptSignal(input: SignalInput): Promise<Signal> {
    const signal: Signal = {
      ...input,
      id: ulid(),
      ts: Date.now(),
      status: 'ACCEPTED',
    };

    this.signalStore.insert(signal);

    this.logger.info({
      event: 'SIGNAL_ACCEPTED',
      signalId: signal.id,
      strategyId: signal.strategyId,
      symbol: signal.symbol,
      action: signal.action,
      confidence: signal.confidence,
    });

    return signal;
  }

  private async executeSignal(signal: Signal): Promise<void> {
    const orders = this.orderFactory.fromSignal(signal);

    for (const order of orders) {
      const submitted = this.broker.submitOrder({
        ...order,
        clientOrderId: `sig_${signal.id}`,
        strategyId: signal.strategyId,
        signalId: signal.id,
      });

      this.signalStore.linkOrder(signal.id, submitted.id);

      this.logger.info({
        event: 'SIGNAL_ORDER_SUBMITTED',
        signalId: signal.id,
        orderId: submitted.id,
        symbol: submitted.symbol,
        side: submitted.side,
        type: submitted.type,
      });
    }

    this.signalStore.markExecuted(signal.id);
  }

  private createContext(): StrategyContext {
    return {
      getMarket: (symbol) => this.broker.getMarket(symbol),

      getCandles: (symbol, interval, limit) =>
        candleStore.getCandles(symbol, interval, limit),

      getAccount: () => this.broker.getAccount(),

      getPosition: (symbol) => this.broker.getPosition(symbol),

      getOpenOrders: (symbol) => this.broker.getOpenOrders(symbol),

      hasOpenPosition: (symbol) => {
        const position = this.broker.getPosition(symbol);

        return !!position && position.qty !== 0;
      },

      hasOpenOrder: (symbol) => {
        return this.broker.getOpenOrders(symbol).length > 0;
      },
    };
  }
}
```

---

# 6. Wire WebSocket to broker and strategy engine

Subscribe to:

```text
bookTicker
aggTrade
markPrice
kline_1m
kline_5m
kline_15m
```

Example:

```ts
import { BinanceClient } from '@shubhamtaywade82/binance-client-ts';

const client = new BinanceClient({
  testnet: true,
});

const symbols = ['SOLUSDT', 'ETHUSDT', 'XRPUSDT'];
const intervals = ['1m', '5m', '15m'];

const streams: string[] = [];

for (const symbol of symbols) {
  streams.push(
    client.futures.ws.bookTicker(symbol),
    client.futures.ws.aggTrade(symbol),
    client.futures.ws.markPrice(symbol, '1s')
  );

  for (const interval of intervals) {
    streams.push(client.futures.ws.kline(symbol, interval));
  }
}

client.futures.ws.subscribe(streams);

client.futures.ws.on('message', (streamName: string, payload: any) => {
  if (streamName.includes('@bookTicker')) {
    const market = {
      symbol: payload.s,
      bid: Number(payload.b),
      ask: Number(payload.a),
    };

    broker.onMarket(market);
    strategyEngine.onMarket(market);
  }

  if (streamName.includes('@aggTrade')) {
    const market = {
      symbol: payload.s,
      last: Number(payload.p),
    };

    broker.onMarket(market);
    strategyEngine.onMarket(market);
  }

  if (streamName.includes('@markPrice')) {
    const market = {
      symbol: payload.s,
      mark: Number(payload.p),
      index: Number(payload.i),
      fundingRate: Number(payload.r),
    };

    broker.onMarket(market);
    strategyEngine.onMarket(market);
  }

  if (streamName.includes('@kline')) {
    const k = payload.k;

    const candle: Candle = {
      symbol: k.s,
      interval: k.i,

      openTime: k.t,
      closeTime: k.T,

      open: Number(k.o),
      high: Number(k.h),
      low: Number(k.l),
      close: Number(k.c),

      volume: Number(k.v),
      quoteVolume: Number(k.q),

      closed: Boolean(k.x),
    };

    if (candle.closed) {
      strategyEngine.onCandleClose(candle);
    }
  }
});
```

---

# 7. Example strategy: EMA trend

This strategy opens long when fast EMA crosses above slow EMA.

```ts
class EmaTrendStrategy implements Strategy {
  id = 'ema-trend-5m';
  name = 'EMA Trend 5m';

  enabled = true;

  symbols = ['SOLUSDT', 'ETHUSDT', 'XRPUSDT'];

  intervals = ['5m'];

  priority = 10;

  cooldownMs = 5 * 60 * 1000;

  async onCandleClose(
    ctx: StrategyContext,
    candle: Candle
  ): Promise<SignalInput[]> {
    if (candle.interval !== '5m') {
      return [];
    }

    const candles = ctx.getCandles(candle.symbol, '5m', 100);

    if (candles.length < 50) {
      return [];
    }

    const closes = candles.map((c) => c.close);

    const emaFastPrev = ema(closes.slice(0, -1), 9);
    const emaSlowPrev = ema(closes.slice(0, -1), 21);

    const emaFastNow = ema(closes, 9);
    const emaSlowNow = ema(closes, 21);

    const crossUp =
      emaFastPrev <= emaSlowPrev && emaFastNow > emaSlowNow;

    const crossDown =
      emaFastPrev >= emaSlowPrev && emaFastNow < emaSlowNow;

    const market = ctx.getMarket(candle.symbol);

    if (!market?.mark) {
      return [];
    }

    const atr14 = atr(candles, 14);

    if (!Number.isFinite(atr14) || atr14 <= 0) {
      return [];
    }

    if (crossUp) {
      return [
        {
          strategyId: this.id,
          symbol: candle.symbol,
          action: 'OPEN_LONG',
          confidence: 0.7,

          stopLossPrice: (market.mark - atr14 * 2).toFixed(6),
          takeProfitPrice: (market.mark + atr14 * 4).toFixed(6),

          features: {
            emaFastNow,
            emaSlowNow,
            atr14,
            close: candle.close,
          },

          reasoning: 'EMA9 crossed above EMA21.',
        },
      ];
    }

    if (crossDown) {
      return [
        {
          strategyId: this.id,
          symbol: candle.symbol,
          action: 'OPEN_SHORT',
          confidence: 0.7,

          stopLossPrice: (market.mark + atr14 * 2).toFixed(6),
          takeProfitPrice: (market.mark - atr14 * 4).toFixed(6),

          features: {
            emaFastNow,
            emaSlowNow,
            atr14,
            close: candle.close,
          },

          reasoning: 'EMA9 crossed below EMA21.',
        },
      ];
    }

    return [];
  }
}
```

EMA helper:

```ts
function ema(values: number[], period: number): number {
  if (values.length === 0) return NaN;

  const k = 2 / (period + 1);

  let emaValue = values[0];

  for (let i = 1; i < values.length; i++) {
    emaValue = values[i] * k + emaValue * (1 - k);
  }

  return emaValue;
}
```

ATR helper:

```ts
function atr(candles: Candle[], period: number): number {
  if (candles.length <= period) return NaN;

  const trueRanges: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );

    trueRanges.push(tr);
  }

  const recent = trueRanges.slice(-period);

  return recent.reduce((sum, value) => sum + value, 0) / recent.length;
}
```

---

# 8. Example strategy: breakout

```ts
class BreakoutStrategy implements Strategy {
  id = 'breakout-15m';
  name = 'Range Breakout 15m';

  enabled = true;

  symbols = ['SOLUSDT', 'ETHUSDT', 'XRPUSDT'];

  intervals = ['15m'];

  priority = 20;

  cooldownMs = 15 * 60 * 1000;

  async onCandleClose(
    ctx: StrategyContext,
    candle: Candle
  ): Promise<SignalInput[]> {
    const candles = ctx.getCandles(candle.symbol, '15m', 50);

    if (candles.length < 30) {
      return [];
    }

    const lookback = candles.slice(-21, -1);

    const highestHigh = Math.max(...lookback.map((c) => c.high));
    const lowestLow = Math.min(...lookback.map((c) => c.low));

    const market = ctx.getMarket(candle.symbol);

    if (!market?.mark) {
      return [];
    }

    const atr14 = atr(candles, 14);

    if (candle.close > highestHigh) {
      return [
        {
          strategyId: this.id,
          symbol: candle.symbol,
          action: 'OPEN_LONG',
          confidence: 0.65,

          stopLossPrice: (market.mark - atr14 * 1.5).toFixed(6),
          takeProfitPrice: (market.mark + atr14 * 3).toFixed(6),

          features: {
            highestHigh,
            lowestLow,
            close: candle.close,
            atr14,
          },

          reasoning: 'Price broke above 20-candle high.',
        },
      ];
    }

    if (candle.close < lowestLow) {
      return [
        {
          strategyId: this.id,
          symbol: candle.symbol,
          action: 'OPEN_SHORT',
          confidence: 0.65,

          stopLossPrice: (market.mark + atr14 * 1.5).toFixed(6),
          takeProfitPrice: (market.mark - atr14 * 3).toFixed(6),

          features: {
            highestHigh,
            lowestLow,
            close: candle.close,
            atr14,
          },

          reasoning: 'Price broke below 20-candle low.',
        },
      ];
    }

    return [];
  }
}
```

---

# 9. Example strategy: mean reversion

```ts
class MeanReversionStrategy implements Strategy {
  id = 'rsi-mean-reversion-5m';
  name = 'RSI Mean Reversion 5m';

  enabled = true;

  symbols = ['ETHUSDT'];

  intervals = ['5m'];

  priority = 15;

  cooldownMs = 10 * 60 * 1000;

  async onCandleClose(
    ctx: StrategyContext,
    candle: Candle
  ): Promise<SignalInput[]> {
    const candles = ctx.getCandles(candle.symbol, '5m', 100);

    if (candles.length < 50) {
      return [];
    }

    const rsi14 = rsi(candles, 14);

    if (!Number.isFinite(rsi14)) {
      return [];
    }

    const market = ctx.getMarket(candle.symbol);

    if (!market?.mark) {
      return [];
    }

    const atr14 = atr(candles, 14);

    if (rsi14 < 30) {
      return [
        {
          strategyId: this.id,
          symbol: candle.symbol,
          action: 'OPEN_LONG',
          confidence: 0.6,

          stopLossPrice: (market.mark - atr14 * 1.5).toFixed(6),
          takeProfitPrice: (market.mark + atr14 * 2).toFixed(6),

          features: {
            rsi14,
            close: candle.close,
            atr14,
          },

          reasoning: 'RSI below 30, mean reversion long.',
        },
      ];
    }

    if (rsi14 > 70) {
      return [
        {
          strategyId: this.id,
          symbol: candle.symbol,
          action: 'OPEN_SHORT',
          confidence: 0.6,

          stopLossPrice: (market.mark + atr14 * 1.5).toFixed(6),
          takeProfitPrice: (market.mark - atr14 * 2).toFixed(6),

          features: {
            rsi14,
            close: candle.close,
            atr14,
          },

          reasoning: 'RSI above 70, mean reversion short.',
        },
      ];
    }

    return [];
  }
}
```

Simple RSI helper:

```ts
function rsi(candles: Candle[], period: number): number {
  if (candles.length <= period) return NaN;

  let gains = 0;
  let losses = 0;

  for (let i = candles.length - period; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    const change = current.close - previous.close;

    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  if (losses === 0) return 100;

  const rs = gains / losses;

  return 100 - 100 / (1 + rs);
}
```

---

# 10. Example strategy: Ollama AI

The AI strategy should not trade directly.

It outputs a structured signal.

```ts
import { OllamaClient } from '@shubhamtaywade82/ollama-client-ts';
import { z } from 'zod';

const AiSignalSchema = z.object({
  action: z.enum([
    'OPEN_LONG',
    'OPEN_SHORT',
    'CLOSE_LONG',
    'CLOSE_SHORT',
    'HOLD',
  ]),

  confidence: z.number().min(0).max(1),

  reasoning: z.string(),
});

class OllamaTrendStrategy implements Strategy {
  id = 'ollama-trend-5m';
  name = 'Ollama Trend Analyst';

  enabled = true;

  symbols = ['SOLUSDT', 'ETHUSDT', 'XRPUSDT'];

  intervals = ['5m'];

  priority = 30;

  cooldownMs = 5 * 60 * 1000;

  constructor(private ollama: OllamaClient) {}

  async onCandleClose(
    ctx: StrategyContext,
    candle: Candle
  ): Promise<SignalInput[]> {
    const candles = ctx.getCandles(candle.symbol, '5m', 100);

    if (candles.length < 50) {
      return [];
    }

    const market = ctx.getMarket(candle.symbol);

    if (!market) {
      return [];
    }

    const features = {
      symbol: candle.symbol,
      interval: candle.interval,

      close: candle.close,
      high: candle.high,
      low: candle.low,
      volume: candle.volume,

      ema9: ema(candles.map((c) => c.close), 9),
      ema21: ema(candles.map((c) => c.close), 21),

      rsi14: rsi(candles, 14),
      atr14: atr(candles, 14),

      bid: market.bid,
      ask: market.ask,
      mark: market.mark,
      fundingRate: market.fundingRate,
    };

    const prompt = `
You are a crypto futures analyst.

Symbol: ${features.symbol}
Interval: ${features.interval}

Current features:
${JSON.stringify(features, null, 2)}

Decide one action:
OPEN_LONG, OPEN_SHORT, CLOSE_LONG, CLOSE_SHORT, HOLD.

Return strict JSON.
    `.trim();

    const result = await this.ollama.chatWithSchema({
      model: 'qwen3.5:2b',
      messages: [
        {
          role: 'system',
          content:
            'You are a deterministic crypto futures signal generator.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      schema: AiSignalSchema,
    });

    if (result.action === 'HOLD') {
      return [];
    }

    return [
      {
        strategyId: this.id,
        symbol: candle.symbol,
        action: result.action,
        confidence: result.confidence,

        features,
        reasoning: result.reasoning,
      },
    ];
  }
}
```

---

# 11. Order factory

Signals are not orders.

The order factory converts signals into broker orders.

```ts
export class OrderFactory {
  constructor(
    private broker: PaperBroker,
    private sizingEngine: SizingEngine
  ) {}

  fromSignal(signal: Signal): OrderCommand[] {
    const market = this.broker.getMarket(signal.symbol);

    if (!market) {
      return [];
    }

    if (signal.action === 'HOLD') {
      return [];
    }

    if (signal.action === 'CANCEL_ALL') {
      this.broker.cancelAllOrders(signal.symbol);
      return [];
    }

    if (signal.action === 'CLOSE_LONG') {
      return this.closeLong(signal);
    }

    if (signal.action === 'CLOSE_SHORT') {
      return this.closeShort(signal);
    }

    if (signal.action === 'OPEN_LONG') {
      return this.openLong(signal);
    }

    if (signal.action === 'OPEN_SHORT') {
      return this.openShort(signal);
    }

    return [];
  }

  private openLong(signal: Signal): OrderCommand[] {
    const quantity = this.sizingEngine.entryQuantity(signal);

    if (!quantity || quantity === '0') {
      return [];
    }

    const orders: OrderCommand[] = [
      {
        symbol: signal.symbol,
        side: 'BUY',
        type: 'MARKET',
        quantity,
        leverage: 5,
        reduceOnly: false,
      },
    ];

    if (signal.stopLossPrice) {
      orders.push({
        symbol: signal.symbol,
        side: 'SELL',
        type: 'STOP_MARKET',
        quantity,
        stopPrice: signal.stopLossPrice,
        leverage: 5,
        reduceOnly: true,
      });
    }

    return orders;
  }

  private openShort(signal: Signal): OrderCommand[] {
    const quantity = this.sizingEngine.entryQuantity(signal);

    if (!quantity || quantity === '0') {
      return [];
    }

    const orders: OrderCommand[] = [
      {
        symbol: signal.symbol,
        side: 'SELL',
        type: 'MARKET',
        quantity,
        leverage: 5,
        reduceOnly: false,
      },
    ];

    if (signal.stopLossPrice) {
      orders.push({
        symbol: signal.symbol,
        side: 'BUY',
        type: 'STOP_MARKET',
        quantity,
        stopPrice: signal.stopLossPrice,
        leverage: 5,
        reduceOnly: true,
      });
    }

    return orders;
  }

  private closeLong(signal: Signal): OrderCommand[] {
    const position = this.broker.getPosition(signal.symbol);

    if (!position || position.qty <= 0) {
      return [];
    }

    return [
      {
        symbol: signal.symbol,
        side: 'SELL',
        type: 'MARKET',
        quantity: Math.abs(position.qty).toString(),
        leverage: position.leverage,
        reduceOnly: true,
      },
    ];
  }

  private closeShort(signal: Signal): OrderCommand[] {
    const position = this.broker.getPosition(signal.symbol);

    if (!position || position.qty >= 0) {
      return [];
    }

    return [
      {
        symbol: signal.symbol,
        side: 'BUY',
        type: 'MARKET',
        quantity: Math.abs(position.qty).toString(),
        leverage: position.leverage,
        reduceOnly: true,
      },
    ];
  }
}
```

---

# 12. Sizing engine

Strategies should not decide raw quantity.

Use a sizing engine.

```ts
import Decimal from 'decimal.js';

const D = (value: string | number | Decimal) => new Decimal(value);

export class SizingEngine {
  constructor(
    private broker: PaperBroker,
    private riskPerTrade = D('0.005')
  ) {}

  entryQuantity(signal: Signal): string {
    const market = this.broker.getMarket(signal.symbol);
    const instrument = this.broker.getInstrument(signal.symbol);
    const account = this.broker.getAccount();

    if (!market || !instrument) {
      return '0';
    }

    const price =
      signal.action === 'OPEN_LONG'
        ? market.ask
        : market.bid;

    if (!price) {
      return '0';
    }

    const equity = D(account.equity);

    const riskAmount = equity.mul(this.riskPerTrade);

    const stopDistance = this.stopDistance(signal, market);

    let quantity: Decimal;

    if (stopDistance.gt(0)) {
      quantity = riskAmount.div(stopDistance);
    } else {
      // Fallback: fixed 10% equity notional.
      quantity = equity.mul('0.1').div(D(price));
    }

    const maxNotional = D('5000');

    const notional = quantity.mul(D(price));

    if (notional.gt(maxNotional)) {
      quantity = maxNotional.div(D(price));
    }

    quantity = this.roundStep(quantity, D(instrument.stepSize));

    const finalNotional = quantity.mul(D(price));

    if (finalNotional.lt(D(instrument.minNotional))) {
      return '0';
    }

    return quantity.toFixed(instrument.quantityPrecision);
  }

  private stopDistance(signal: Signal, market: MarketState): Decimal {
    if (!market.mark) {
      return D(0);
    }

    if (!signal.stopLossPrice) {
      return D(0);
    }

    const stop = D(signal.stopLossPrice);
    const mark = D(market.mark);

    return mark.sub(stop).abs();
  }

  private roundStep(value: Decimal, stepSize: Decimal): Decimal {
    return value.div(stepSize).floor().mul(stepSize);
  }
}
```

---

# 13. Strategy conflict handling

Use one net position per symbol.

Final rule:

```text
Only one active directional position per symbol.
```

If a new strategy wants the opposite side:

1. Cancel open orders for that symbol.
2. Close the existing position.
3. Open the new position only if confidence is above threshold.

Example:

```ts
function resolveConflict(
  existingPosition: Position | undefined,
  signal: SignalInput
): boolean {
  if (!existingPosition || existingPosition.qty === 0) {
    return true;
  }

  const isLong = existingPosition.qty > 0;
  const isShort = existingPosition.qty < 0;

  if (signal.action === 'OPEN_LONG' && isShort) {
    return signal.confidence >= 0.75;
  }

  if (signal.action === 'OPEN_SHORT' && isLong) {
    return signal.confidence >= 0.75;
  }

  return false;
}
```

For cleaner attribution later, store:

```text
signals.strategy_id
orders.signal_id
orders.strategy_id
fills.strategy_id
```

---

# 14. Signal persistence

Every signal must be stored before order submission.

Required fields:

```text
id
ts
strategy_id
symbol
action
confidence
stop_loss_price
take_profit_price
features
reasoning
status
order_id
```

This allows later analysis:

```text
signal → order → fill → realized PnL
```

You should be able to answer:

- Which strategy produced the best PnL?
- Which confidence threshold worked best?
- Which signals were rejected by risk?
- Did AI signals perform better than rule-based signals?
- Which features were present before winning trades?

---

# 15. Recommended strategy triggers

Use these triggers:

| Strategy type | Trigger |
|---|---|
| Trend | candle close |
| Mean reversion | candle close |
| Breakout | candle close |
| Funding/OI | timer or funding event |
| AI reasoning | candle close |
| Execution guard | tick |
| Stop management | tick or mark price update |

Do not run heavy strategies on every `aggTrade`.

Use candle-close logic for signal generation.

Use tick logic only for:

- stop triggers
- stale data checks
- urgent flatten logic
- execution protection

---

# 16. Final signal flow example

```text
SOLUSDT 5m candle closes
        │
        ▼
StrategyEngine.onCandleClose()
        │
        ▼
EmaTrendStrategy.onCandleClose()
        │
        ▼
EMA9 crosses above EMA21
        │
        ▼
Signal:
{
  strategyId: "ema-trend-5m",
  symbol: "SOLUSDT",
  action: "OPEN_LONG",
  confidence: 0.72,
  stopLossPrice: "141.20",
  takeProfitPrice: "151.80"
}
        │
        ▼
SignalStore.insert()
        │
        ▼
RiskEngine checks:
  - market fresh
  - max daily loss okay
  - max position okay
  - available margin okay
        │
        ▼
SizingEngine calculates quantity
        │
        ▼
OrderFactory creates:
  - MARKET BUY
  - STOP_MARKET SELL reduceOnly
        │
        ▼
PaperBroker.submitOrder()
        │
        ▼
Fill simulated using ask price
        │
        ▼
Position updated
        │
        ▼
Signal linked to order and fill
```

---

# 17. Final design rule

Use this exact separation:

```text
Market data owns price truth.
Strategies own signal logic.
Risk engine owns protection.
Sizing engine owns quantity.
Order factory owns order construction.
Paper broker owns execution and state.
Database owns audit and analysis.
```

Strategies generate signals.
The broker executes.
The database records everything.