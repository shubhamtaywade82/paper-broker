Yes — **but not a traditional chart-heavy dashboard**.

For an autonomous crypto-futures trading agent, the dashboard should answer:

> **What is the agent doing, why is it doing it, what risk is it taking, and do I need to intervene?**

### What I would keep

| Component                     | Chart?                  | Purpose                                |
| ----------------------------- | ----------------------- | -------------------------------------- |
| **Equity / PnL**              | Small sparkline         | Is the system making money?            |
| **BTC/ETH price**             | **Yes — primary chart** | Market context + agent decisions       |
| **Open positions**            | No                      | Exact execution state                  |
| **Risk exposure**             | Gauge / numbers         | Immediate risk                         |
| **Agent confidence**          | Gauge / bar             | Decision quality                       |
| **Agent decisions**           | No                      | Explainability / audit                 |
| **Strategy performance**      | Small chart             | Which agents/strategies work           |
| **Market regime**             | No                      | `BULL / BEAR / RANGE / HIGH VOL`       |
| **Order flow / funding / OI** | Compact visualizations  | Only when relevant to current decision |
| **Market heatmap**            | Optional                | Discovery, not core execution          |

### The key architectural change

I would **not** make the dashboard look like TradingView with 10 indicators everywhere.

Instead:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ NEMESIS AI     AUTONOMOUS ●     BTCUSDT     LONG     Risk: LOW     │
├──────────────┬──────────────────────────────────────┬───────────────┤
│              │                                      │               │
│   MARKETS    │          MARKET CONTEXT              │  AI BRAIN     │
│              │                                      │               │
│ BTC          │       BTCUSDT  67,892               │ REGIME        │
│ ETH          │                                      │ BULLISH       │
│ SOL          │       ┌──────────────────────┐       │               │
│ XRP          │       │                      │       │ Confidence    │
│              │       │   PRICE / STRUCTURE  │       │ 82%           │
│              │       │                      │       │               │
│              │       │  entries/exits       │       │ Decision      │
│              │       │  SL / TP             │       │ HOLD          │
│              │       │  agent annotations   │       │               │
│              │       └──────────────────────┘       │ Why?          │
│              │                                      │               │
├──────────────┼──────────────────────────────────────┼───────────────┤
│ POSITIONS    │        AGENT ACTIVITY                 │ RISK ENGINE   │
│              │                                      │               │
│ BTC LONG     │  09:15 Agent detected breakout       │ Exposure      │
│ ETH LONG     │  09:16 Volume confirmation          │ █████░ 42%     │
│ SOL          │  09:17 Position opened               │               │
│              │  09:18 SL moved to breakeven         │ Daily loss    │
│              │  09:20 Position monitored            │ 49% remaining │
├──────────────┴──────────────────────────────────────┴───────────────┤
│ EQUITY     PNL      WIN RATE      DRAWDOWN      ACTIVE AGENTS       │
│ +5.17%     +1248    68.4%        8.72%         4 / 4 RUNNING       │
└─────────────────────────────────────────────────────────────────────┘
```

### One important distinction

**Charts should be evidence, not decoration.**

The primary chart should show:

* Price
* Structure / market regime
* Agent entry
* Agent exit
* Stop-loss
* Take-profit
* Position size
* Liquidation distance
* Significant volume events
* Funding/OI events when relevant
* Agent decision markers

The user should be able to click:

**`Agent Entry → Why did you enter?`**

and get:

```text
LONG BTCUSDT
Confidence: 82%

Evidence:
✓ 1H bullish structure
✓ 15m breakout confirmed
✓ Volume +38% above baseline
✓ Funding neutral
✓ OI increasing
✓ Risk/reward 2.4R

Rejected:
✗ Short setup
✗ Mean-reversion setup

Action:
ENTER LONG

Risk:
SL: 1.2%
TP: 2.9%
Position risk: 0.8%
```

That is much more valuable than another RSI/MACD panel.

## My recommendation

**Dashboard = 70% operational state + 20% agent intelligence + 10% visualization.**

The **chart is necessary**, but it should be **one intelligent contextual chart**, not the center of the entire product.

For an autonomous agent, I'd actually make **"AI Brain / Decision Timeline" more prominent than the chart**. The chart explains the market; the agent panel explains **what the machine is doing about it**.

## Verdict

For **your autonomous crypto-futures trading system**, I would choose:

> **React + TypeScript + Vite + TanStack Router + TanStack Query**

—not Next.js.

The reason is architectural: this is fundamentally a **real-time trading terminal**, not a content/SEO-oriented web application.

React itself currently recommends using a framework for new applications, but it also explicitly recognizes cases where a client-heavy application is better served by building from a tool such as Vite. ([React][1])

### My recommended stack

```text
┌─────────────────────────────────────────────────────────────┐
│                 NEMESIS AI TRADING TERMINAL                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  React 19 + TypeScript                                     │
│          │                                                  │
│          ├── Vite                                           │
│          │                                                  │
│          ├── TanStack Router                                │
│          │                                                  │
│          ├── TanStack Query                                 │
│          │                                                  │
│          ├── Zustand                                        │
│          │                                                  │
│          ├── Lightweight Charts                             │
│          │                                                  │
│          ├── Tailwind CSS + shadcn/ui                       │
│          │                                                  │
│          └── WebSocket / SSE                               │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                     API / EVENT LAYER                        │
│                                                             │
│ REST ────────────────┐                                      │
│ WebSocket ───────────┼──► Trading Backend                   │
│ SSE ─────────────────┘                                      │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                  AUTONOMOUS AGENT SYSTEM                    │
│                                                             │
│ Market Data → Feature Engine → Agent → Risk → Execution    │
│                         ↓                                   │
│                  Event / Decision Stream                    │
└─────────────────────────────────────────────────────────────┘
```

---

# Why I would NOT choose Next.js as the primary frontend

[Next.js documentation](https://nextjs.org/docs?utm_source=chatgpt.com) describes Next.js as a full-stack React framework with routing, rendering, server capabilities and other application infrastructure. ([Next.js][2])

That's excellent for:

* SaaS
* dashboards with server-rendered pages
* authenticated applications
* websites
* SEO
* content
* server-side data fetching
* BFF/API routes

But your trading terminal has a very different workload.

You have:

```text
Ticks
  ↓
WebSocket
  ↓
Market state
  ↓
Order events
  ↓
Position events
  ↓
Agent events
  ↓
Risk events
  ↓
UI state
  ↓
React rendering
```

The frontend is effectively a **real-time event-driven application**.

You don't want your architecture mentally organized around:

```text
HTTP request
    ↓
server render
    ↓
page
```

You want:

```text
EVENT
 ↓
STATE UPDATE
 ↓
SELECTIVE COMPONENT UPDATE
 ↓
UI
```

That distinction matters.

---

# Why Vite + React is a better fit

Vite is specifically designed as a fast frontend build tool, with fast HMR and optimized production builds. It supports React + TypeScript directly. ([vitejs][3])

Your application can therefore be a dedicated:

```text
trading-terminal/
```

rather than mixing the trading UI with a server framework.

### This gives you

**1. Extremely fast development**

Trading UI development involves constantly changing:

* charts
* panels
* layouts
* agent cards
* tables
* event streams
* overlays

Vite's development model is very good for this. ([vitejs][3])

**2. Clean separation**

```text
Frontend
    │
    ├── REST
    ├── WebSocket
    └── SSE
         │
         ▼
Trading Platform
```

The frontend cannot accidentally become responsible for trading logic.

That's important.

---

# TanStack Router is particularly interesting for your system

This is where I'd deviate from the typical:

```text
React + React Router
```

I would seriously consider:

```text
React
+
TanStack Router
```

TanStack Router provides strongly typed routing, search parameters, nested layouts, route loaders, caching and prefetching. ([TanStack][4])

That is unusually well suited to a complex trading terminal.

For example:

```text
/dashboard
/markets
/markets/$symbol
/positions
/orders
/agent
/agent/decisions
/agent/runs/$runId
/strategies
/strategies/$strategyId
/risk
/research
/backtests
/journal
/system
```

And your URL state could become strongly typed:

```text
/markets/BTCUSDT
    ?timeframe=15m
    &exchange=binance
    &session=live
```

TanStack Router explicitly supports typed search parameters and validation. ([TanStack][4])

For a trading application with dozens of filters and layouts, that's valuable.

---

# The most important part: don't put real-time state into one giant store

This is where many trading dashboards become garbage.

Don't do:

```text
Redux
 └── EVERYTHING
      ├── ticks
      ├── candles
      ├── positions
      ├── orders
      ├── agent
      ├── strategies
      ├── risk
      └── UI
```

Instead:

```text
                 ┌──────────────┐
                 │ WebSocket    │
                 └──────┬───────┘
                        ↓
                Event Normalizer
                        ↓
        ┌───────────────┼───────────────┐
        ↓               ↓               ↓
   Market Store    Trading Store    Agent Store
        │               │               │
        ↓               ↓               ↓
      Charts         Positions        AI Brain
      Orderbook      Orders           Decisions
      Ticker         Fills            Reasoning
      Funding        PnL              Events
```

This becomes much easier to reason about.

---

# Charts: use a trading-specific library

For your main chart, I would use:

**TradingView Lightweight Charts**

rather than trying to build candlesticks using a generic charting library.

Your chart needs:

```text
Candles
Volume
EMA
VWAP
Order blocks
FVG
Liquidity
Entries
Exits
SL
TP
Agent decisions
Position
Funding events
OI events
```

The chart should become an **agent observation surface**, not merely a price chart.

---

# UI component layer

I'd use:

```text
Tailwind CSS
+
shadcn/ui
```

but with a custom NEMESIS design system.

Not:

```text
generic shadcn dashboard
```

Instead:

```text
NEMESIS Design System

<MetricCard />
<RiskGauge />
<AgentStatus />
<DecisionCard />
<DecisionTimeline />
<PositionCard />
<OrderBook />
<MarketHeatmap />
<AgentReasoning />
<ConfidenceMeter />
<StrategyStatus />
<RiskLimits />
<ExecutionTimeline />
<MarketContext />
<TradingChart />
```

This will make the application feel like a **professional trading terminal**, rather than another SaaS admin panel.

---

# What about AI/agent UX?

This is actually where your frontend architecture should be different from conventional trading platforms.

I would create an explicit **Agent Runtime UI**.

```text
              NEMESIS AGENT
                    │
        ┌───────────┴───────────┐
        │                       │
   Current State           Current Goal
        │                       │
        ↓                       ↓
  Market Context           Find Opportunity
        │                       │
        ↓                       ↓
   Observations             Tool Calls
        │                       │
        ↓                       ↓
   Reasoning                Results
        │                       │
        └───────────┬───────────┘
                    ↓
                 Decision
                    ↓
                 Risk Gate
                    ↓
               EXECUTION
                    ↓
                Position
```

And the UI should expose this as a **timeline**:

```text
09:20:12  MARKET UPDATE
          BTC volatility increased

09:20:13  AGENT OBSERVATION
          15m structure remains bullish

09:20:14  TOOL CALL
          get_orderbook(BTCUSDT)

09:20:15  TOOL RESULT
          Bid/ask imbalance: +18%

09:20:16  AGENT DECISION
          LONG candidate

09:20:17  RISK ENGINE
          Approved

09:20:18  EXECUTION
          LONG 0.025 BTC @ 67,892

09:20:19  POSITION MONITOR
          SL registered
```

**That is the killer feature of your product.**

---

# Recommended architecture

I would build it like this:

```text
                    NEMESIS TERMINAL
                           │
                 React + TypeScript
                           │
       ┌───────────────────┼──────────────────┐
       │                   │                  │
   UI STATE          SERVER STATE       REALTIME STATE
       │                   │                  │
    Zustand          TanStack Query      WebSocket
       │                   │                  │
       │                   │                  │
       └───────────────────┼──────────────────┘
                           │
                    TanStack Router
                           │
                  REST / WS / SSE
                           │
                    API Gateway
                           │
        ┌──────────────────┼──────────────────┐
        ↓                  ↓                  ↓
   Market Service     Agent Service      Trading Service
        │                  │                  │
        ↓                  ↓                  ↓
     Binance            AI/LLM             Execution
        │                  │                  │
        └──────────────────┼──────────────────┘
                           ↓
                       Event Bus
                           ↓
                  PostgreSQL / Redis
```

---

# Final technology choice

| Layer                   | Choice                    | Verdict                  |
| ----------------------- | ------------------------- | ------------------------ |
| UI                      | **React 19**              | **Yes**                  |
| Language                | **TypeScript**            | **Mandatory**            |
| Build                   | **Vite**                  | **Yes**                  |
| Routing                 | **TanStack Router**       | **Yes**                  |
| Server state            | **TanStack Query**        | **Yes**                  |
| Client state            | **Zustand**               | **Yes**                  |
| Styling                 | **Tailwind CSS**          | **Yes**                  |
| Components              | **shadcn/ui**             | **Yes, customized**      |
| Trading chart           | **Lightweight Charts**    | **Yes**                  |
| Generic analytics       | ECharts/Recharts          | Secondary                |
| Realtime                | **WebSocket**             | **Core**                 |
| Streaming notifications | SSE                       | Optional                 |
| Backend                 | Separate trading services | **Strongly recommended** |
| Next.js                 | Optional                  | **Not my first choice**  |

### The one-line decision

> **Build NEMESIS as a Vite-powered React/TypeScript desktop-class SPA, with TanStack Router/Query, Zustand, WebSockets, and a dedicated trading chart engine.**

React's current documentation confirms React is intended to be used with frameworks for many new applications, while also allowing build-tool-based applications where framework features aren't needed. ([React][1]) For **this specific workload**, the latter is the better architectural trade-off.

And importantly: **do not put the autonomous trading engine inside the frontend**. The browser should be an **operator/control/observability plane**. The agent, risk engine, market-data processing and execution system must remain authoritative on the backend.

[1]: https://react.dev/learn/creating-a-react-app?utm_source=chatgpt.com "Creating a React App – React"
[2]: https://nextjs.org/docs?utm_source=chatgpt.com "Next.js Docs | Next.js"
[3]: https://vite.dev/guide/?utm_source=chatgpt.com "Getting Started | Vite"
[4]: https://tanstack.com/router/latest/docs/overview?utm_source=chatgpt.com "Overview | TanStack Router Docs"

# Yes — this should be a dedicated core product surface

For an autonomous trading system, the user needs to see not merely **“LONG BTCUSDT executed”**, but the entire **observable lifecycle** that led to it:

```text
Market Event
   ↓
Agent Wake-up
   ↓
Context Assembly
   ↓
Observations
   ↓
Tool Calls
   ↓
Tool Results
   ↓
Decision / Rationale
   ↓
Risk Evaluation
   ↓
Execution
   ↓
Position Monitoring
   ↓
Follow-up Actions
```

However, there is one critical distinction:

> **Do not expose the model's private chain-of-thought.**

Instead, expose a structured **decision trace**: what the agent observed, which tools it invoked, the important returned facts, what hypotheses/signals were considered, why the decision passed or failed, and what action was taken.

That gives you auditability without pretending the raw internal reasoning is a reliable or appropriate UI artifact.

---

# 1. I would call the page `Agent Control Center`

The main dashboard can remain operational.

The dedicated page becomes:

```text
/agent
/agent/runs
/agent/runs/:runId
/agent/events
```

A useful information architecture:

```text
                    AGENT CONTROL CENTER
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
     LIVE RUNS          RUN HISTORY         SYSTEM TRACE
        │                   │                   │
        ↓                   ↓                   ↓
   Active agents       Past decisions       All events
   Current task        Replay               Tool calls
   Current state       Compare              Errors
   Current action      Inspect              Latency
```

---

# 2. The main screen should look like an agent debugger

Something like:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ NEMESIS AGENT CONTROL CENTER                                                 │
│                                                                              │
│ ● AUTONOMOUS     Run #A9F32     BTCUSDT     RUNNING     00:01:42             │
│ Goal: Find high-probability long/short opportunities                         │
├───────────────────┬───────────────────────────────────────┬──────────────────┤
│                   │                                       │                  │
│ RUN STATE         │        EXECUTION TIMELINE             │ LIVE STATE       │
│                   │                                       │                  │
│ ● Running         │ 09:20:12  MARKET EVENT               │ Regime            │
│                   │           BTC volatility ↑            │ BULLISH           │
│ Phase             │                                       │                  │
│ ANALYSIS          │ 09:20:12  AGENT WAKE                  │ Confidence        │
│                   │                                       │ 82%               │
│ Progress          │  ███████████████░░                    │                  │
│ 7 / 11            │                                       │ Position          │
│                   │ 09:20:13  OBSERVATION                 │ LONG              │
│ Current action    │           15m trend bullish            │                  │
│ Fetching orderbook│                                       │ Risk              │
│                   │ 09:20:13  TOOL CALL                   │ LOW               │
│                   │           get_market_structure()       │                  │
│                   │                                       │                   │
│                   │ 09:20:14  TOOL RESULT                  │                   │
│                   │           trend = bullish              │                   │
│                   │           strength = 0.84              │                   │
│                   │                                       │                   │
│                   │ 09:20:15  TOOL CALL                   │                   │
│                   │           get_orderbook()              │                   │
│                   │                                       │                   │
│                   │ 09:20:16  DECISION                    │                   │
│                   │           LONG CANDIDATE              │                   │
│                   │                                       │                   │
│                   │ 09:20:17  RISK GATE                   │                   │
│                   │           APPROVED                    │                   │
│                   │                                       │                   │
│                   │ 09:20:18  EXECUTION                   │                   │
│                   │           BUY 0.025 BTC                │                   │
│                   │                                       │                   │
│                   │ 09:20:19  POSITION MONITOR            │                   │
│                   │           SL registered               │                   │
│                   │                                       │                   │
├───────────────────┴───────────────────────────────────────┴──────────────────┤
│ OBSERVATIONS │ TOOL CALLS │ DECISION │ RISK │ ORDERS │ RAW EVENTS │ REPLAY   │
└──────────────────────────────────────────────────────────────────────────────┘
```

This would be much more useful than simply dumping logs.

---

# 3. Every agent action should be an event

The backend should produce a canonical event stream.

For example:

```json
{
  "event_id": "evt_01J...",
  "run_id": "run_A9F32",
  "sequence": 1842,
  "timestamp": "2026-08-23T09:20:13.421Z",
  "type": "TOOL_CALL_STARTED",
  "agent": "market-analysis-agent",
  "phase": "ANALYSIS",
  "tool": "get_orderbook",
  "input": {
    "symbol": "BTCUSDT",
    "depth": 20
  }
}
```

Then:

```json
{
  "event_id": "evt_01J...",
  "run_id": "run_A9F32",
  "sequence": 1843,
  "timestamp": "2026-08-23T09:20:13.487Z",
  "type": "TOOL_CALL_COMPLETED",
  "tool": "get_orderbook",
  "duration_ms": 66,
  "status": "SUCCESS",
  "output_summary": {
    "imbalance": 0.18,
    "best_bid": 67891.8,
    "best_ask": 67892.1
  }
}
```

The frontend should consume **events**, not scrape application logs.

---

# 4. Separate the UI into event types

I would visually distinguish:

### `MARKET_EVENT`

```text
MARKET EVENT
BTCUSDT volatility increased 18%
```

### `OBSERVATION`

```text
OBSERVATION
1H structure remains bullish
15m breakout confirmed
```

### `TOOL_CALL`

```text
TOOL CALL
get_orderbook()

Input
symbol: BTCUSDT
depth: 20

Status: SUCCESS
Latency: 67 ms
```

### `TOOL_RESULT`

```text
TOOL RESULT

Bid imbalance       +18%
Spread              0.3 bps
Liquidity            HIGH
```

### `DECISION`

```text
DECISION

LONG CANDIDATE

Confidence: 82%

Supporting evidence:
✓ Bullish 1H structure
✓ 15m breakout
✓ Volume confirmation
✓ Positive orderbook imbalance

Contradicting evidence:
△ Funding elevated

Risk/reward:
2.4R
```

### `RISK_GATE`

```text
RISK GATE

APPROVED

Position risk: 0.8%
Daily risk: 1.6%
Exposure after trade: 38%

Rules passed: 14
Rules blocked: 0
```

### `EXECUTION`

```text
EXECUTION

BUY BTCUSDT
Qty: 0.025 BTC
Entry: 67,892.1
Stop: 67,078
Take profit: 69,850

Status: FILLED
```

### `POSITION_UPDATE`

```text
POSITION UPDATE

PnL: +1.8%
SL: moved to breakeven
Reason: +1R achieved
```

---

# 5. Tool calls deserve their own panel

This is one of the most important parts.

Clicking:

```text
TOOL CALL
get_orderbook()
```

should open:

```text
┌────────────────────────────────────────────────────┐
│ TOOL EXECUTION                                      │
├────────────────────────────────────────────────────┤
│ Tool                                               │
│ get_orderbook                                      │
│                                                    │
│ Agent                                              │
│ Market Analysis Agent                              │
│                                                    │
│ Input                                              │
│ {                                                  │
│   "symbol": "BTCUSDT",                             │
│   "depth": 20                                      │
│ }                                                  │
│                                                    │
│ Execution                                           │
│ Started     09:20:13.421                           │
│ Completed   09:20:13.487                           │
│ Duration    66 ms                                  │
│ Status      SUCCESS                                │
│                                                    │
│ Result                                             │
│ Bid imbalance        +18%                          │
│ Best bid             67,891.8                      │
│ Best ask             67,892.1                      │
│                                                    │
│ [VIEW RAW] [COPY] [REPLAY]                         │
└────────────────────────────────────────────────────┘
```

This becomes incredibly valuable when debugging agent failures.

---

# 6. Show "what the agent knows"

Create a dedicated **Context Inspector**.

Example:

```text
CONTEXT SNAPSHOT

Market
├── Symbol       BTCUSDT
├── Mark Price   67,892
├── Regime       Bullish
├── Volatility   Medium
├── Funding      +0.010%
└── OI Change    +2.31%

Structure
├── 1D           Bullish
├── 4H           Bullish
├── 1H           Bullish
├── 15M          Bullish
└── 5M           Neutral

Position
├── Side         LONG
├── Size         0.025 BTC
├── Entry        67,892
└── Risk         0.8%

Account
├── Equity       25,430 USDT
├── Exposure     42%
└── Daily Risk   1.6%

Available Tools
├── market_data
├── orderbook
├── funding
├── open_interest
├── position
├── risk_engine
└── execution
```

This is much better than making the user infer context from logs.

---

# 7. Show agent "reasoning" as structured rationale

Instead of:

> Chain-of-thought...

show:

```text
DECISION RATIONALE

Objective
Find a high-probability BTCUSDT long opportunity.

Evidence
+ Bullish 1H market structure
+ 15M breakout confirmed
+ Volume above baseline
+ OI increasing
+ Orderbook imbalance positive

Risk considerations
- Funding slightly elevated
- Price extended from VWAP

Decision
LONG

Confidence
82%

Invalidation
15M structure breaks below 67,420

Next action
Monitor for continuation
```

This gives the user the useful explanation without exposing hidden internal reasoning.

---

# 8. Add a "Decision Graph"

This could become one of the strongest parts of the UI.

Instead of only a timeline:

```text
                    BTCUSDT
                       │
                 Market Event
                       │
                       ▼
               Trend Analysis
                       │
                  BULLISH
                       │
              ┌────────┴────────┐
              │                 │
        Volume Check        Funding Check
              │                 │
           PASS              WARNING
              │                 │
              └────────┬────────┘
                       ↓
                 Breakout Check
                       │
                     PASS
                       │
                       ↓
                 Risk Engine
                       │
                    APPROVED
                       │
                       ↓
                 LONG ORDER
                       │
                    FILLED
```

Now users can understand the **agent's workflow**, not merely its chronological logs.

---

# 9. Add Agent Run Replay

This is essential for your research system.

A completed run:

```text
RUN #A9F32
BTCUSDT
23 Aug 2026
09:20:12 → 09:21:03
```

should be replayable:

```text
◀  Previous     ▶ Play     1x     2x     5x     10x
```

As the run replays:

```text
09:20:12
Market event

09:20:13
Agent observation

09:20:14
Tool call

09:20:15
Tool result

09:20:16
Decision

09:20:17
Risk

09:20:18
Execution
```

This lets you debug:

* bad trades
* hallucinated assumptions
* incorrect tool usage
* risk-engine bugs
* latency
* execution problems
* prompt/model changes

---

# 10. Add "Why didn't you trade?"

This is arguably **more important than displaying successful trades**.

For every analysis cycle:

```text
BTCUSDT

STATUS
NO TRADE

Reason

Trend         PASS
Momentum      PASS
Volume        FAIL
Risk/Reward   FAIL
Funding       WARNING

Decision
SKIP

Confidence
63%

Blocking condition
Expected R:R = 1.2R
Minimum required = 2.0R
```

This makes **NO_TRADE a first-class agent outcome**.

That aligns perfectly with the architecture you're building.

---

# 11. Add agent lifecycle states

The UI should show exactly what the autonomous system is doing:

```text
IDLE
 ↓
OBSERVING
 ↓
ANALYZING
 ↓
COLLECTING_DATA
 ↓
EVALUATING
 ↓
WAITING_FOR_CONFIRMATION
 ↓
RISK_CHECK
 ↓
EXECUTING
 ↓
MONITORING
 ↓
EXIT_EVALUATION
 ↓
COMPLETED
```

And the top header:

```text
● AUTONOMOUS

Agent State
MONITORING BTCUSDT

Current Task
Waiting for 15m confirmation

Next evaluation
18 seconds
```

That makes the system feel genuinely autonomous rather than looking like a dashboard with an AI label attached.

---

# 12. Multi-agent architecture

Eventually you can show multiple specialized agents:

```text
AGENT FLEET

Market Analyst       ● RUNNING
Structure Agent      ● RUNNING
Order Flow Agent     ● RUNNING
Funding Agent        ● RUNNING
Strategy Agent       ● RUNNING
Risk Agent           ● IDLE
Execution Agent      ● IDLE
Position Manager     ● RUNNING
Supervisor Agent     ● RUNNING
```

Clicking an agent:

```text
STRUCTURE AGENT

Current Task
Analyse BTCUSDT 15M structure

Input
Market snapshot #9382

Tools used
3

Observations
7

Decisions
1

Confidence
84%

Last action
BREAKOUT_CONFIRMED
```

---

# 13. The backend should therefore have an explicit `AgentEvent`

I would architect this before building the UI.

```text
AgentRun
AgentEvent
AgentObservation
AgentToolCall
AgentDecision
AgentRiskCheck
AgentExecution
AgentContextSnapshot
```

Conceptually:

```text
AgentRun
│
├── ContextSnapshot
│
├── Events
│   ├── MarketEvent
│   ├── Observation
│   ├── ToolCall
│   ├── ToolResult
│   ├── Decision
│   ├── RiskCheck
│   ├── Order
│   └── PositionUpdate
│
├── FinalDecision
│
└── Outcome
```

Every event gets:

```text
event_id
run_id
sequence
timestamp
agent_id
agent_version
model
event_type
phase
correlation_id
parent_event_id
status
latency
payload
summary
```

This gives you **event sourcing / replay capability** rather than a pile of unstructured logs.

---

# 14. The frontend should consume an event stream

Something like:

```text
Backend
   │
   ├── REST
   │       historical runs
   │       context
   │       decisions
   │
   ├── WebSocket
   │       live events
   │       tool calls
   │       orders
   │       positions
   │
   └── Event Store
           complete trace
```

Frontend:

```text
AgentEventStream
       ↓
EventNormalizer
       ↓
AgentRuntimeStore
       ↓
┌──────────────┬───────────────┬──────────────┐
│ Timeline     │ Context       │ Decision     │
│              │ Inspector     │ Graph        │
└──────────────┴───────────────┴──────────────┘
```

---

# 15. I would actually make three modes

### **Live**

```text
LIVE AGENT

Current activity
↓
Tool calls
↓
Decision
↓
Execution
```

### **Inspect**

```text
RUN INSPECTOR

Complete historical trace
Context
Tools
Results
Decision
Risk
Execution
Outcome
```

### **Replay**

```text
REPLAY

Reproduce exactly what the agent saw
and which events occurred in sequence.
```

This turns the UI into both a **trading control center and agent-development debugger**.

---

# 16. Final NEMESIS UI architecture

I'd therefore evolve the application into:

```text
NEMESIS AI
│
├── Overview
│
├── Markets
│
├── Positions
│
├── Orders
│
├── Risk Engine
│
├── Agent Control Center       ← NEW / MAJOR FEATURE
│   │
│   ├── Live Runs
│   ├── Run History
│   ├── Run Inspector
│   ├── Decision Timeline
│   ├── Decision Graph
│   ├── Tool Calls
│   ├── Context Inspector
│   ├── Agent Fleet
│   └── Replay
│
├── Strategies
├── Backtesting
├── Research
├── Analytics
├── Alerts
└── System
    ├── Events
    ├── Logs
    ├── Health
    └── Integrations
```

The key idea is:

> **Overview tells the trader what is happening.
> Agent Control Center tells the trader why and how the autonomous system is operating.
> Replay tells the developer exactly what happened.**

That distinction would make the product feel substantially more like a **real autonomous trading system** and less like a conventional exchange dashboard with an LLM panel bolted onto it.

No. **The sidebar in that image is too fragmented.** It looks like an enterprise admin panel rather than an autonomous trading terminal.

For NEMESIS, I would reduce the primary navigation to **6–7 sections** and put the detailed functionality inside those sections.

## Recommended sidebar

```text
NEMESIS AI
Autonomous Trading System

MAIN
├── Dashboard
├── Markets
├── Trading
├── Agent
├── Research
└── Risk

SYSTEM
├── Activity
└── Settings
```

### 1. Dashboard

The operational command center.

```text
Dashboard
├── Portfolio
├── PnL
├── Open Positions
├── Active Orders
├── Market Overview
├── Agent Status
└── Risk Status
```

The user should spend most of their time here.

---

### 2. Markets

Everything related to market observation.

```text
Markets
├── Watchlist
├── Market Scanner
├── BTCUSDT
├── ETHUSDT
├── Order Book
├── Funding
├── Open Interest
└── Liquidations
```

Don't make `BTCUSDT`, `ETHUSDT`, etc. separate sidebar items.

---

### 3. Trading

This should consolidate:

* Positions
* Orders
* Execution
* Trade history

So:

```text
Trading
├── Positions
├── Orders
├── Fills
└── Trade Journal
```

This is much cleaner than having:

```text
Positions
Orders
Journal
```

as three separate top-level pages.

---

# 4. Agent — this is the important one

This becomes the **entire autonomous-agent ecosystem**.

```text
Agent
│
├── Control Center
│
├── Pipeline
│
├── Live Runs
│
├── Agent Fleet
│
├── Run History
│
├── Decision Replay
│
└── Event Trace
```

But I would **not necessarily show these as sidebar items**.

Instead:

```text
AGENT
────────────────
Overview
Pipeline
Runs
Fleet
```

Then inside a run:

```text
RUN #A9F32

Timeline
Decision Graph
Tool Calls
Observations
Context
Risk
Execution
Events
Replay
```

This prevents the sidebar from becoming ridiculous.

---

# 5. Research

Combine:

```text
Strategies
Backtesting
Research Lab
Analytics
```

into:

```text
Research
├── Strategies
├── Backtests
├── Experiments
├── Performance
└── Market Research
```

Eventually this becomes your **quant/research workspace**.

---

# 6. Risk

Keep this separate because it is operationally critical.

```text
Risk
├── Risk Overview
├── Exposure
├── Limits
├── Drawdown
├── Margin
├── Liquidation
└── Risk Events
```

This should be accessible immediately even when the agent is autonomous.

---

# 7. System

Combine all the technical/admin pages:

```text
System
├── Activity
├── Alerts
├── Logs
├── Integrations
├── Health
└── Settings
```

The user doesn't need `Logs`, `Integrations`, `Settings`, etc. occupying prime sidebar real estate.

---

# The resulting UI

I would make the sidebar roughly:

```text
┌──────────────────────────┐
│                          │
│  NEMESIS AI              │
│  Autonomous Trading      │
│                          │
├──────────────────────────┤
│                          │
│  ◉ Dashboard             │
│                          │
│  ◇ Markets               │
│                          │
│  ⇄ Trading               │
│                          │
│  ◎ Agent                 │
│                          │
│  ◈ Research              │
│                          │
│  ◉ Risk                  │
│                          │
├──────────────────────────┤
│  SYSTEM                  │
│                          │
│  ◌ Activity              │
│  ⚙ Settings              │
│                          │
├──────────────────────────┤
│                          │
│  ● AUTONOMOUS            │
│  System Operational      │
│                          │
│  [ PAUSE AGENT ]         │
│                          │
└──────────────────────────┘
```

## And `Agent` should expand contextually

When the user enters Agent:

```text
Agent
────────────────────────

┌─────────────┐
│ Overview    │
│ Pipeline    │
│ Runs        │
│ Fleet       │
└─────────────┘
```

Not:

```text
Agent Pipeline
Agent Control Center
Agent Fleet
Run History
Decision Replay
```

as five top-level sidebar entries.

---

# One more important change

I would **not call the page `Agent Pipeline` the primary agent page**.

Use:

> **Agent**

as the top-level concept.

Then the Agent workspace has:

```text
┌─────────────────────────────────────────────────────────┐
│ AGENT                                                    │
├────────────┬────────────┬────────────┬──────────────────┤
│ Overview   │ Pipeline   │ Runs       │ Fleet            │
└────────────┴────────────┴────────────┴──────────────────┘
```

### Agent Overview

```text
Active Agents       8
Running Runs        3
Decisions Today     147
Trades              23
No Trades           124
Avg Confidence      78%
```

### Pipeline

Shows the DAG:

```text
Market
  ↓
Supervisor
  ↓
Structure ─┐
Momentum ──┼→ Fusion → Long/Short → Validator → Risk
OrderFlow ─┘                                      ↓
                                             Execution
                                                  ↓
                                             Position
```

### Runs

Shows:

```text
RUN #A9F32   BTCUSDT   LONG      COMPLETED
RUN #A9F31   ETHUSDT   NO TRADE  COMPLETED
RUN #A9F30   BTCUSDT   LONG      ACTIVE
```

Clicking one opens the **full trace**.

### Fleet

Shows:

```text
Supervisor        ● Running
Structure         ● Running
Momentum          ● Running
Order Flow        ● Running
Funding           ● Idle
Strategy Judge    ● Running
Risk              ● Running
Execution         ● Idle
Position Manager  ● Running
```

---

# Final navigation I recommend

```text
NEMESIS AI

MAIN
  Dashboard
  Markets
  Trading
  Agent
  Research
  Risk

SYSTEM
  Activity
  Settings
```

**8 top-level items is enough.**

And even that can eventually be reduced to:

```text
Dashboard
Markets
Trading
Agent
Research
Risk
System
```

with `Settings` accessible from the bottom/profile/system menu.

### The principle

**Sidebar = major mental models.**

**Tabs = workflows.**

**Panels = details.**

**Drawer/modal = deep inspection.**

**Agent trace = drill-down, not another page explosion.**

That will make NEMESIS feel like a serious **autonomous trading operating system**, rather than a collection of 20 dashboards.

# Final NEMESIS frontend design

For the system you are describing, I would stop thinking of the frontend as a **dashboard** and design it as an **autonomous trading operating console**.

The frontend has four jobs:

1. **Observe the trading system**
2. **Understand what the agents are doing**
3. **Control the autonomous system**
4. **Audit/replay every important decision**

The browser is **not** the source of truth and must never contain exchange credentials or become the execution engine.

---

# 1. Final architecture

```text
                         ┌───────────────────────────────┐
                         │       NEMESIS FRONTEND        │
                         │ React + TypeScript + Vite     │
                         └───────────────┬───────────────┘
                                         │
                              HTTPS REST │ WebSocket
                                         │
                         ┌───────────────▼───────────────┐
                         │       NEMESIS API / WS        │
                         │       Backend Gateway         │
                         └───────────────┬───────────────┘
                                         │
                  ┌──────────────────────┼──────────────────────┐
                  │                      │                      │
                  ▼                      ▼                      ▼
           Market Service          Agent Runtime          Trading Core
                  │                      │                      │
                  ▼                      ▼                      ▼
             Binance WS              Agent Bus              Execution
             Binance REST            LLM/tools              Risk Engine
                  │                      │                      │
                  └──────────────────────┼──────────────────────┘
                                         │
                                  Event / State Bus
                                         │
                         ┌───────────────┼───────────────┐
                         ▼               ▼               ▼
                    PostgreSQL         Redis        Event Store
```

For Binance USDⓈ-M Futures, the backend can consume the exchange's dedicated Futures market streams and user-data stream; Binance documents real-time depth/book-ticker streams and account/order events separately. ([developers.binance.info][1])

**The browser should never connect directly to Binance.**

The browser connects to:

```text
wss://api.nemesis.ai/ws
```

and NEMESIS connects to Binance:

```text
NEMESIS BE
    │
    ├── Binance Market WS
    ├── Binance User WS
    ├── Binance REST
    │
    └── Agent Runtime
```

That separation is critical.

---

# 2. Final sidebar

Keep it extremely small.

```text
NEMESIS AI
Autonomous Trading System

MAIN

◉ Dashboard
◇ Markets
⇄ Trading
◎ Agent
◈ Research
◉ Risk

SYSTEM

◌ Activity
⚙ Settings

────────────────

● AUTONOMOUS
System Operational

[ PAUSE AGENT ]
```

### No separate top-level pages for

```text
Positions
Orders
Logs
Agent Pipeline
Agent Fleet
Run History
Decision Replay
Backtesting
Analytics
Funding
Open Interest
Liquidations
```

These belong **inside the major sections**.

---

# 3. Dashboard

The dashboard answers one question:

> **What is happening right now?**

### Layout

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ NEMESIS AI       ● AUTONOMOUS    SYSTEM HEALTH: EXCELLENT              │
│ Account Equity   25,430 USDT      24h PnL +1,248      Risk LOW          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ Equity        PnL          Exposure       Drawdown       Agent Status   │
│ 25,430        +1,248       42%            8.7%           8/10 ACTIVE   │
│                                                                         │
├─────────────────────────────────────┬───────────────────────────────────┤
│                                     │                                   │
│          MARKET CONTEXT              │          AGENT BRAIN              │
│                                     │                                   │
│ BTCUSDT PERPETUAL                   │ MARKET REGIME                     │
│ 67,892                             │ BULLISH TREND                     │
│                                     │                                   │
│      PRIMARY CHART                  │ Confidence 82%                    │
│                                     │                                   │
│ candles / structure                 │ LONG BIAS                         │
│ entries / exits                     │                                   │
│ SL / TP                             │ Current task                      │
│ agent markers                       │ Monitor breakout                  │
│                                     │                                   │
├─────────────────────────────────────┼───────────────────────────────────┤
│ POSITIONS                            │ RISK ENGINE                       │
│ BTC LONG                            │ Exposure 42%                      │
│ ETH LONG                            │ Risk 0.8%                         │
│ SOL LONG                            │ Daily limit 49.9% remaining       │
├─────────────────────────────────────┴───────────────────────────────────┤
│ ACTIVE AGENT PIPELINE                                                     │
│ Supervisor → Structure → Order Flow → Fusion → Risk → Execution          │
├─────────────────────────────────────────────────────────────────────────┤
│ LIVE ACTIVITY                                                             │
│ 09:20 Tool call → orderbook                                               │
│ 09:20 Decision → LONG candidate                                           │
│ 09:20 Risk → APPROVED                                                     │
│ 09:20 Execution → FILLED                                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### The dashboard chart

**One major chart.**

Do not create six indicator panels.

Chart overlays can be toggled:

```text
Price
Volume
Structure
VWAP
EMA
Liquidity
Order Blocks
FVG
Agent Marks
Position
SL / TP
Funding
OI
```

The chart exists to provide **market context for decisions**, not to reproduce TradingView.

---

# 4. Markets

This is the market-observation workspace.

```text
Markets
│
├── Overview
├── Scanner
├── Watchlist
└── Symbol Workspace
```

### Symbol workspace

```text
BTCUSDT PERPETUAL

Price
Mark Price
Index Price
Funding
Open Interest
24h Volume
Liquidations
Long / Short Ratio

[CHART]

Order Book
Recent Trades
Funding History
Open Interest
Liquidation Map
Market Structure
```

The frontend should subscribe only to the symbols the user is actually viewing or monitoring.

For example:

```text
SUBSCRIBE

market:ticker:BTCUSDT
market:book:BTCUSDT
market:trades:BTCUSDT
market:mark:BTCUSDT
market:funding:BTCUSDT
market:oi:BTCUSDT
```

---

# 5. Trading

One workspace instead of separate pages.

```text
Trading
│
├── Positions
├── Orders
├── Fills
└── Journal
```

### Positions table

```text
Symbol      Side   Size      Entry      Mark       PnL      Risk
BTCUSDT     LONG   0.025     67892      68421      +1.8R    0.8%
ETHUSDT     LONG   0.70      3412       3448       +1.4R    0.6%
```

Clicking a position opens a detail drawer:

```text
POSITION

BTCUSDT LONG

Entry
Stop
Take Profit
Liquidation
Mark Price
Unrealized PnL
Realized PnL
ROE
Exposure

Opening Decision
Risk Check
Execution
Agent Monitoring

[OPEN AGENT RUN]
```

---

# 6. Agent becomes the most sophisticated section

This is the differentiator.

```text
Agent
│
├── Overview
├── Pipeline
├── Runs
└── Fleet
```

---

# 7. Agent Overview

```text
┌────────────────────────────────────────────────────────────┐
│ AGENT                                                       │
│ Autonomous Trading Intelligence                             │
├────────────────────────────────────────────────────────────┤
│                                                             │
│ ACTIVE RUNS         DECISIONS        TRADES        NO TRADE │
│ 3                   147              23             124     │
│                                                             │
│ AVG CONFIDENCE     AVG LATENCY       WIN RATE               │
│ 78%                182 ms            68.4%                  │
│                                                             │
├────────────────────────────────────────────────────────────┤
│ CURRENT ACTIVITY                                             │
│                                                             │
│ BTCUSDT                                                     │
│ Supervisor analyzing breakout                               │
│                                                             │
│ Structure      DONE       91%                                │
│ Momentum       DONE       78%                                │
│ Order Flow     RUNNING    84%                                │
│ Fusion         WAITING                                      │
│ Risk           WAITING                                      │
│ Execution      IDLE                                         │
└────────────────────────────────────────────────────────────┘
```

---

# 8. Agent Pipeline

This should be a **DAG**, not a simple vertical list.

```text
                         SUPERVISOR
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
      STRUCTURE           MOMENTUM          ORDER FLOW
          │                  │                  │
          ▼                  ▼                  ▼
       FUNDING           VOLATILITY         LIQUIDITY
          │                  │                  │
          └──────────────────┼──────────────────┘
                             ▼
                       SIGNAL FUSION
                             │
                   ┌─────────┴─────────┐
                   ▼                   ▼
                 LONG                SHORT
                   │                   │
                   └─────────┬─────────┘
                             ▼
                        TRADE JUDGE
                             │
                             ▼
                        RISK ENGINE
                       /           \
                    REJECT         PASS
                      │              │
                   NO_TRADE          ▼
                               EXECUTION
                                    │
                                    ▼
                              POSITION MANAGER
                                    │
                           ┌────────┼────────┐
                           ▼        ▼        ▼
                           SL       TP      TRAIL
                                    │
                                    ▼
                               EXIT JUDGE
```

### Each node displays

```text
Agent
Status
Confidence
Latency
Current task
Tools
Last event
```

Example:

```text
┌──────────────────────┐
│ ORDER FLOW AGENT     │
│ ● RUNNING            │
│                      │
│ Confidence    84%    │
│ Latency       41ms   │
│                      │
│ Task                  │
│ Validate breakout     │
│                      │
│ Tools                 │
│ orderbook             │
│ trades                │
│ delta                 │
└──────────────────────┘
```

---

# 9. Agent Fleet

Show **what agents exist** independent of a particular run.

```text
SUPERVISOR          ● RUNNING
STRUCTURE           ● RUNNING
MOMENTUM            ● RUNNING
ORDER FLOW          ● RUNNING
FUNDING             ● IDLE
LIQUIDITY           ● RUNNING

TREND FOLLOWING     ● RUNNING
BREAKOUT            ● RUNNING
MEAN REVERSION      ● IDLE

LONG ANALYST        ● RUNNING
SHORT ANALYST       ● RUNNING

RISK ENGINE         ● RUNNING
EXECUTION           ● IDLE
POSITION MANAGER    ● RUNNING
EXIT AGENT          ● RUNNING
```

But internally, these are not all necessarily LLMs.

---

# 10. Critical architecture: not every "agent" should be an LLM

Use three classes.

### Deterministic agents

```text
Risk Engine
Position Sizer
Liquidation Calculator
PnL Calculator
Margin Calculator
Technical Indicators
Order Validation
Exposure Checker
```

### Analytical agents

```text
Regime Classifier
Volatility Model
Order Flow Model
Anomaly Detector
Signal Scoring
```

### LLM agents

```text
Supervisor
Market Analyst
Strategy Judge
Long Analyst
Short Analyst
Trade Validator
Research Agent
Post-Trade Analyst
```

The LLM should reason over **facts produced by tools**.

---

# 11. Agent Run Inspector

Click:

```text
RUN #A9F32
```

and get:

```text
┌────────────────────────────────────────────────────────────────┐
│ RUN #A9F32     BTCUSDT      LONG      COMPLETED               │
│ 09:20:12 → 09:20:19                         7.1 sec            │
├────────────────────────────────────────────────────────────────┤
│ Timeline │ Decision Graph │ Tools │ Observations │ Context     │
│ Risk │ Execution │ Events │ Replay                              │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│ 09:20:12  MARKET EVENT                                        │
│ BTC volatility increased 18%                                  │
│                                                                │
│ 09:20:13  OBSERVATION                                         │
│ 15m structure bullish                                         │
│                                                                │
│ 09:20:13  TOOL CALL                                           │
│ get_orderbook()                                               │
│                                                                │
│ 09:20:13  TOOL RESULT                                          │
│ imbalance +18%                                                │
│                                                                │
│ 09:20:14  DECISION                                             │
│ LONG CANDIDATE                                                │
│                                                                │
│ 09:20:14  RISK CHECK                                           │
│ APPROVED                                                       │
│                                                                │
│ 09:20:14  EXECUTION                                            │
│ LONG 0.025 BTC                                                │
└────────────────────────────────────────────────────────────────┘
```

---

# 12. Do not expose raw chain-of-thought

Expose:

```text
Decision rationale
Evidence
Counter-evidence
Confidence
Risk factors
Rejected alternatives
Decision
Next action
```

Example:

```text
DECISION

LONG

Confidence: 82%

Supporting evidence

✓ 1H bullish structure
✓ 15M breakout
✓ Volume confirmation
✓ OI increasing
✓ Orderbook imbalance +18%

Risk considerations

△ Funding elevated
△ Price extended from VWAP

Invalidation

15M close below 67,420

Expected R:R

2.4R
```

That is much more useful and auditable than presenting hidden reasoning.

---

# 13. Tool calls

Tool calls should be first-class UI objects.

```text
TOOL CALL

get_orderbook()

Input
{
  symbol: "BTCUSDT",
  depth: 20
}

Status
SUCCESS

Latency
66 ms

Result

Bid/Ask imbalance +18%
Liquidity HIGH
Spread 0.3 bps

[RAW]
[REPLAY]
```

Same for:

```text
get_market_structure()
get_funding()
get_open_interest()
get_liquidations()
get_positions()
calculate_risk()
place_order()
modify_stop()
close_position()
```

---

# 14. "Why did you NOT trade?" is mandatory

Every run must terminate in:

```text
TRADE
```

or:

```text
NO_TRADE
```

Example:

```text
BTCUSDT

NO TRADE

Structure          PASS
Momentum           PASS
Volume             FAIL
Funding            PASS
Risk/Reward        FAIL

Expected R:R       1.2R
Required            2.0R

Decision
SKIP

Primary blocker
Insufficient reward relative to invalidation.
```

This is one of the most important UX features in the entire product.

---

# 15. Activity / Event Center

This is the consolidated technical observability page.

```text
Activity

All
Agents
Tools
Risk
Orders
Errors
System
```

Filters:

```text
symbol
agent
run_id
event_type
severity
time
trace_id
```

Example:

```text
09:20:12 MARKET
09:20:13 AGENT
09:20:13 TOOL
09:20:14 TOOL RESULT
09:20:14 DECISION
09:20:14 RISK
09:20:15 EXECUTION
09:20:15 POSITION
```

---

# 16. WebSocket design

This is where I would be strict.

## Browser → NEMESIS backend

One authenticated application WebSocket:

```text
wss://api.nemesis.ai/ws
```

Do **not** create a WebSocket per:

```text
market
agent
position
order
log
```

Use a multiplexed connection.

---

# 17. WebSocket protocol

Envelope:

```json
{
  "v": 1,
  "type": "event",
  "stream": "agent",
  "event": "decision.created",
  "event_id": "evt_0192",
  "seq": 18442,
  "server_ts": 1787489415123,
  "event_ts": 1787489415098,
  "trace_id": "trace_73a1",
  "run_id": "run_A9F32",
  "symbol": "BTCUSDT",
  "payload": {}
}
```

### Mandatory fields

```text
v
type
stream
event
event_id
seq
server_ts
trace_id
```

For agent events:

```text
run_id
agent_id
```

For market events:

```text
symbol
```

For trading events:

```text
order_id
position_id
```

---

# 18. WebSocket streams

I would define logical channels:

```text
system
market
trading
portfolio
agent
risk
execution
alerts
```

Example:

```text
market.ticker
market.trade
market.book
market.kline
market.funding
market.oi
market.liquidation

trading.order.created
trading.order.updated
trading.fill
trading.position.updated

agent.run.started
agent.run.updated
agent.observation
agent.tool.started
agent.tool.completed
agent.decision
agent.rationale
agent.run.completed

risk.check.started
risk.check.completed
risk.breach

execution.started
execution.filled
execution.failed

system.health
system.error
```

---

# 19. Subscription protocol

Frontend:

```json
{
  "v": 1,
  "type": "subscribe",
  "request_id": "sub_001",
  "channels": [
    "market.ticker.BTCUSDT",
    "market.book.BTCUSDT",
    "trading.account",
    "agent.live",
    "risk.live"
  ]
}
```

Backend:

```json
{
  "v": 1,
  "type": "subscribed",
  "request_id": "sub_001",
  "channels": [
    "market.ticker.BTCUSDT",
    "market.book.BTCUSDT",
    "trading.account",
    "agent.live",
    "risk.live"
  ]
}
```

This mirrors the general subscription-oriented design used by exchange WebSocket APIs. Binance's Futures streams support multiple stream types, including book depth, book ticker and market-data streams. ([developers.binance.info][1])

---

# 20. REST + WebSocket responsibilities

Do **not** make WebSocket the only transport.

Use:

```text
REST
    ↓
Initial state / historical data / snapshots

WebSocket
    ↓
Live updates / events / state changes
```

Example:

```text
GET /api/v1/positions
```

returns:

```json
[
  {
    "symbol": "BTCUSDT",
    "side": "LONG",
    "size": 0.025,
    "entry": 67892.1
  }
]
```

Then:

```text
WS
position.updated
```

updates it.

TanStack Query is appropriate for the REST/server-state side because it is specifically designed for fetching, caching, synchronization and updating server state. ([TanStack][2])

---

# 21. Initial synchronization

This is important.

When the browser connects:

```text
CONNECT
  ↓
AUTH
  ↓
GET SNAPSHOT
  ↓
SUBSCRIBE
  ↓
PROCESS LIVE EVENTS
```

Never rely on the browser starting with an empty state and waiting for events.

Example:

```text
GET /api/v1/state/snapshot
```

returns:

```json
{
  "state_version": 9182,
  "server_time": 1787489415000,
  "portfolio": {},
  "positions": [],
  "orders": [],
  "agents": {},
  "runs": {},
  "risk": {}
}
```

Then WS events continue from that state.

---

# 22. Sequence numbers are mandatory

Every stream gets monotonically increasing sequence numbers.

```text
18441
18442
18443
18444
```

If frontend sees:

```text
18441
18442
18446
```

it knows:

```text
18443-18445 missing
```

Then:

```text
CLIENT → SERVER

RESYNC
stream=agent
from_seq=18442
```

Backend returns missed events or a new snapshot.

This prevents silent state corruption.

---

# 23. Reconnection

The frontend connection manager should handle:

```text
CONNECTED
        ↓
DEGRADED
        ↓
RECONNECTING
        ↓
RESYNCING
        ↓
CONNECTED
```

Use:

```text
exponential backoff
jitter
heartbeat
sequence verification
snapshot resync
subscription restore
```

Do not simply:

```javascript
socket.onclose = () => socket = new WebSocket(...)
```

That is inadequate for a trading terminal.

Binance's exchange-side streams also have connection lifecycle constraints and documented reconnection behavior, so your backend must own exchange-stream renewal/recovery rather than pushing that responsibility into the browser. ([GitHub][3])

---

# 24. Backpressure

This is critical.

Imagine:

```text
BTC trades
1000s events/sec
```

You absolutely do **not** want:

```text
1000 React renders/sec
```

The backend should aggregate where appropriate.

For example:

```text
raw trades
    ↓
backend stream processor
    ↓
frontend ticker updates 10–20/s
```

But:

```text
order filled
risk breach
agent decision
execution failure
```

should be delivered immediately.

### Event priority

```text
P0  Risk breach
P0  Execution
P0  Order
P0  Position

P1  Agent decision
P1  Agent tool
P1  Agent state

P2  Market ticker
P2  Book
P2  Trades

P3  Analytics
P3  Metrics
```

This prevents a market-data flood from starving critical events.

---

# 25. State architecture inside React

I would use:

```text
React
TypeScript
Vite
TanStack Router
TanStack Query
Zustand
```

Vite is designed around a fast development server/HMR workflow and optimized production builds. ([vitejs][4])

### Separate state into three categories

```text
SERVER STATE
   │
   └── TanStack Query

REALTIME STATE
   │
   └── Zustand + WebSocket event reducer

UI STATE
   │
   └── Local React state / Zustand
```

Do **not** put everything into a single global store.

---

# 26. Frontend state model

```text
src/
├── app/
│   ├── router/
│   ├── providers/
│   └── layouts/
│
├── features/
│   ├── dashboard/
│   ├── markets/
│   ├── trading/
│   ├── agent/
│   ├── research/
│   ├── risk/
│   └── activity/
│
├── components/
│   ├── chart/
│   ├── tables/
│   ├── metrics/
│   ├── agent/
│   ├── risk/
│   └── trading/
│
├── realtime/
│   ├── websocket/
│   ├── subscriptions/
│   ├── events/
│   ├── reconnection/
│   └── resync/
│
├── state/
│   ├── market.store.ts
│   ├── trading.store.ts
│   ├── agent.store.ts
│   ├── risk.store.ts
│   └── ui.store.ts
│
├── api/
│   ├── client.ts
│   ├── markets.ts
│   ├── trading.ts
│   ├── agents.ts
│   └── research.ts
│
├── domain/
│   ├── market/
│   ├── trading/
│   ├── agent/
│   ├── risk/
│   └── execution/
│
└── shared/
    ├── types/
    ├── utils/
    └── constants/
```

---

# 27. Agent data model in frontend

```typescript
type Agent = {
  id: string
  type: AgentType
  name: string
  mode: "llm" | "deterministic" | "model"
  status: AgentStatus
  version: string
  model?: string
  capabilities: string[]
}

type AgentRun = {
  id: string
  agentId: string
  symbol?: string
  status: RunStatus
  startedAt: number
  completedAt?: number
  confidence?: number
  decision?: Decision
}

type AgentEvent = {
  id: string
  runId: string
  agentId: string
  type: AgentEventType
  sequence: number
  timestamp: number
  traceId: string
  correlationId?: string
  payload: unknown
}
```

---

# 28. Agent event taxonomy

```text
RUN_STARTED
RUN_COMPLETED
RUN_FAILED

MARKET_EVENT
OBSERVATION_CREATED

TOOL_CALL_STARTED
TOOL_CALL_COMPLETED
TOOL_CALL_FAILED

AGENT_MESSAGE
AGENT_HANDOFF

SIGNAL_CREATED
SIGNAL_UPDATED

DECISION_CREATED
DECISION_REJECTED

RISK_CHECK_STARTED
RISK_CHECK_COMPLETED
RISK_BREACH

ORDER_INTENT_CREATED
ORDER_SUBMITTED
ORDER_FILLED
ORDER_REJECTED

POSITION_OPENED
POSITION_UPDATED
POSITION_CLOSED

EXIT_SIGNAL
TRAILING_STOP_UPDATED

NO_TRADE

ERROR
WARNING
```

---

# 29. Agent-to-agent communication should be visible

This is where NEMESIS can become genuinely interesting.

```text
STRUCTURE AGENT
      │
      │ STRUCTURE_CONFIRMED
      ▼
SIGNAL FUSION
      │
      │ REQUEST_VOLUME_CONFIRMATION
      ▼
VOLUME AGENT
      │
      │ VOLUME_CONFIRMED
      ▼
SIGNAL FUSION
      │
      │ REQUEST_LIQUIDITY_CHECK
      ▼
LIQUIDITY AGENT
      │
      │ SWEEP_DETECTED
      ▼
SIGNAL FUSION
      │
      ▼
TRADE JUDGE
```

In the UI:

```text
Agent Handoff

STRUCTURE
      ↓
Signal Fusion

Message:
"Bullish 15m BOS confirmed above 67,420"

Signal Fusion
      ↓
Volume Agent

Request:
"Confirm breakout participation"

Volume Agent
      ↓

"Volume +34% above baseline"
```

That is much better than fake “AI thinking” animations.

---

# 30. Agent pipeline execution state

Each agent should have a state machine:

```text
IDLE
 ↓
TRIGGERED
 ↓
COLLECTING
 ↓
ANALYZING
 ↓
WAITING
 ↓
COMPLETED
 ↓
HANDOFF
```

Or:

```text
FAILED
BLOCKED
SKIPPED
CANCELLED
```

The UI should represent these distinctly.

---

# 31. Risk UI must dominate when something is wrong

Normal:

```text
RISK
LOW

Exposure       42%
Position Risk   0.8%
Daily Risk      1.6%
Margin Usage    18%
```

Risk event:

```text
⚠ RISK BREACH

BTCUSDT

Projected exposure
72%

Maximum
60%

ACTION
New positions blocked

Agent state
SAFE MODE
```

Risk should never be buried inside an agent log.

---

# 32. Autonomous controls

Top-right:

```text
● AUTONOMOUS
```

Click:

```text
AUTONOMOUS MODE

Trading
● Enabled

New Positions
● Enabled

Position Management
● Enabled

Risk Engine
● Enabled

Agent Research
● Enabled

────────────────────

[ PAUSE NEW TRADES ]

[ SAFE MODE ]

[ EMERGENCY FLATTEN ]
```

`Emergency Flatten` should have much stronger confirmation and backend authorization than ordinary UI actions.

---

# 33. Manual override

The user should be able to intervene without destroying the autonomous state.

Example:

```text
BTCUSDT LONG

[ HOLD ]
[ REDUCE ]
[ CLOSE ]
[ DISABLE AGENT FOR SYMBOL ]
```

When manual intervention occurs:

```text
MANUAL OVERRIDE

User action:
Reduced BTC position 25%

Agent notification:
Position state changed externally

Supervisor:
Re-evaluating strategy

Audit:
Recorded
```

---

# 34. Research section

```text
Research
├── Strategies
├── Backtests
├── Experiments
├── Performance
└── Market Research
```

### Strategy page

```text
Trend Following Agent

Version
v3.2

Markets
BTC / ETH / SOL

Timeframes
5m / 15m / 1H

Win Rate
68.4%

Profit Factor
1.89

Max Drawdown
8.7%

Trades
143

[BACKTEST]
[COMPARE VERSIONS]
[VIEW RUNS]
```

---

# 35. Activity becomes the audit trail

Every important action:

```text
WHO
WHAT
WHEN
WHY
INPUT
OUTPUT
RESULT
```

For example:

```text
09:20:14

AGENT
Long Analyst

Decision:
LONG

Evidence:
7 observations

Risk:
Approved

Trace:
trace_73a1

Execution:
order_9281
```

This gives the project true forensic capability.

---

# 36. Performance and charts

Use charts selectively.

### Dashboard

```text
Equity sparkline
PnL sparkline
Main market chart
```

### Research

```text
Equity curve
Drawdown
Strategy comparison
Distribution
Trade analytics
```

### Agent

Prefer:

```text
timeline
DAG
event flow
latency histogram
decision statistics
```

Do **not** turn every page into a chart page.

---

# 37. Final route structure

```text
/
├── dashboard
│
├── markets
│   ├── overview
│   ├── scanner
│   └── $symbol
│
├── trading
│   ├── positions
│   ├── orders
│   ├── fills
│   └── journal
│
├── agent
│   ├── overview
│   ├── pipeline
│   ├── runs
│   │   └── $runId
│   └── fleet
│
├── research
│   ├── strategies
│   ├── backtests
│   ├── experiments
│   └── performance
│
├── risk
│   ├── overview
│   ├── exposure
│   ├── limits
│   └── events
│
├── activity
│
└── settings
```

---

# 38. Final WebSocket topology

This is what I would actually implement.

```text
                     BROWSER
                        │
                wss://api/ws
                        │
                 ┌──────▼──────┐
                 │ WS GATEWAY  │
                 └──────┬──────┘
                        │
                  Authentication
                        │
                  Subscription
                        │
              ┌─────────┴─────────┐
              │                   │
          Event Router        Command Router
              │                   │
      ┌───────┼────────┐          │
      │       │        │          ▼
      ▼       ▼        ▼      Command Service
   Market   Agent    Trading       │
      │       │        │           ▼
      └───────┼────────┘       Trading Core
              │
              ▼
          Redis/Event Bus
              │
     ┌────────┼─────────┐
     ▼        ▼         ▼
  Market    Agents    Risk/Exec
```

The browser should receive a **normalized NEMESIS event model**, not raw Binance payloads.

For example, don't leak:

```text
Binance:
ORDER_TRADE_UPDATE
```

directly into React.

Normalize it:

```text
trading.order.updated
```

Likewise:

```text
Binance depth
        ↓
MarketDataNormalizer
        ↓
market.orderbook.updated
```

That makes your frontend exchange-independent.

This matters because Binance's Futures API structure itself can evolve; the backend adapter should absorb exchange-specific changes. Binance currently exposes USDⓈ-M Futures via dedicated `/fapi/*` APIs and WebSocket API/stream infrastructure. ([GitHub][3])

---

# 39. WebSocket state machine

Frontend:

```text
DISCONNECTED
      │
      ▼
CONNECTING
      │
      ▼
AUTHENTICATING
      │
      ▼
SUBSCRIBING
      │
      ▼
SYNCING
      │
      ▼
CONNECTED
      │
      ├───────────────┐
      │               │
      ▼               ▼
DEGRADED          DISCONNECTED
      │               │
      └───────┬───────┘
              ▼
         RECONNECTING
              │
              ▼
            RESYNC
              │
              ▼
         RESTORE SUBS
              │
              ▼
          CONNECTED
```

---

# 40. Event consistency

For every aggregate:

```text
position
order
agent run
pipeline
risk state
portfolio
```

maintain:

```text
version
last_sequence
updated_at
```

Example:

```json
{
  "position_id": "pos_123",
  "version": 18,
  "last_event_seq": 91821
}
```

A late event with:

```text
version=16
```

must not overwrite version 18.

---

# 41. Security model

### Browser has

```text
short-lived access token
session identifier
user permissions
```

### Browser does NOT have

```text
Binance API secret
LLM API key
exchange signing secret
private keys
execution credentials
```

All exchange secrets remain backend-side.

---

# 42. What the frontend should never do

```text
❌ Calculate authoritative PnL
❌ Calculate liquidation
❌ Decide position sizing
❌ Authorize trades
❌ Compute risk limits
❌ Sign exchange requests
❌ Trust client-side prices
❌ Treat browser state as truth
❌ Execute exchange orders directly
❌ Generate trading decisions independently
```

It can calculate **presentation-only values**, but authoritative values come from the backend.

---

# 43. Final component hierarchy

```text
App
│
├── AppShell
│   ├── Sidebar
│   ├── TopBar
│   └── ConnectionStatus
│
├── Dashboard
│   ├── AccountSummary
│   ├── PnlCard
│   ├── MarketContext
│   ├── AgentStatus
│   ├── PositionSummary
│   ├── RiskSummary
│   └── LiveActivity
│
├── Markets
│   ├── MarketScanner
│   ├── SymbolWorkspace
│   ├── TradingChart
│   ├── OrderBook
│   └── MarketMetrics
│
├── Trading
│   ├── Positions
│   ├── Orders
│   ├── Fills
│   └── Journal
│
├── Agent
│   ├── AgentOverview
│   ├── PipelineGraph
│   ├── AgentFleet
│   ├── RunList
│   ├── RunInspector
│   ├── EventTimeline
│   ├── ToolCallInspector
│   ├── ContextInspector
│   ├── DecisionPanel
│   └── Replay
│
├── Research
│
├── Risk
│
└── Activity
```

---

# 44. The final UX hierarchy

This is the part I would lock down before development.

```text
LEVEL 1
OPERATE
────────────────────────────
Dashboard
Markets
Trading
Risk


LEVEL 2
UNDERSTAND
────────────────────────────
Agent
Research
Activity


LEVEL 3
INSPECT
────────────────────────────
Agent Pipeline
Agent Run
Decision
Tool Call
Context
Risk Check
Execution


LEVEL 4
AUDIT
────────────────────────────
Event
Trace
Replay
Raw Data
```

That prevents the product from becoming an enormous collection of pages.

---

# 45. The final NEMESIS experience

The user opens NEMESIS:

```text
                NEMESIS AI

AUTONOMOUS ●
BTCUSDT

Market:
BULLISH

Agent:
ANALYZING

Risk:
LOW

Current Position:
LONG

Current PnL:
+1.8R
```

They click **Agent**:

```text
Supervisor
    ↓
6 market agents
    ↓
Signal Fusion
    ↓
Long / Short
    ↓
Trade Judge
    ↓
Risk
    ↓
Execution
    ↓
Position Manager
```

They click **Order Flow Agent**:

```text
What is it doing?
↓
What tools did it call?
↓
What data came back?
↓
What conclusion did it produce?
↓
What did it tell the fusion agent?
```

They click **Run #A9F32**:

```text
Complete event timeline
+
Decision graph
+
Tool calls
+
Observations
+
Context snapshot
+
Risk decision
+
Execution
+
Outcome
+
Replay
```

They click **Risk**:

```text
Why was the trade allowed?
What limits were checked?
What would have blocked it?
```

They click **Activity**:

```text
Every important system event
in chronological order.
```

That is the product.

---

# Final technology stack

| Layer               | Final choice                                        |
| ------------------- | --------------------------------------------------- |
| Frontend            | **React + TypeScript**                              |
| Build               | **Vite**                                            |
| Routing             | **TanStack Router**                                 |
| Server state        | **TanStack Query**                                  |
| Realtime state      | **Zustand + event reducers**                        |
| UI                  | **Tailwind + shadcn/ui, custom design system**      |
| Main chart          | **Trading-specific chart library**                  |
| Transport           | **Native WebSocket / WebSocket-compatible gateway** |
| Historical/query    | **REST**                                            |
| Realtime            | **WebSocket**                                       |
| Backend event model | **Canonical NEMESIS events**                        |
| Agent trace         | **Event-sourced / append-only trace**               |
| Agent visualization | **DAG + timeline**                                  |
| State sync          | **Snapshot + sequence-based deltas**                |
| Recovery            | **Reconnect + gap detection + resync**              |
| Exchange            | **Backend-only Binance adapter**                    |
| Exchange user data  | **Backend user-data stream**                        |
| Execution authority | **Backend**                                         |
| Risk authority      | **Backend deterministic engine**                    |
| LLM authority       | **Reasoning/planning only**                         |

React's current guidance supports both framework-based applications and client-side/static deployments; for this trading-terminal architecture, a client-heavy application is a reasonable fit because the actual trading/backend services remain outside the UI. ([React][5])

## The one architectural rule I would make non-negotiable

```text
                   ┌─────────────────────┐
                   │       FRONTEND      │
                   │                     │
                   │ Observe             │
                   │ Visualize           │
                   │ Explain             │
                   │ Control             │
                   │ Replay              │
                   └──────────┬──────────┘
                              │
                         WS / REST
                              │
                   ┌──────────▼──────────┐
                   │       BACKEND       │
                   │                     │
                   │ SOURCE OF TRUTH     │
                   │                     │
                   │ Market Data         │
                   │ Agent Runtime       │
                   │ Tool Execution      │
                   │ Risk Engine         │
                   │ Execution Engine     │
                   │ Position Manager     │
                   │ Event Store         │
                   └─────────────────────┘
```

**The browser is the cockpit. The backend is the aircraft.**

That separation gives you the right foundation for a system that can eventually evolve from a paper-trading environment into autonomous perpetual-futures execution without redesigning the frontend architecture.

[5]: https://react.dev/learn/creating-a-react-app?utm_source=chatgpt.com "Creating a React App – React"

Yes. **That is exactly how I would architect NEMESIS.**

The backend should be a **complete autonomous trading system that has zero dependency on the frontend**. The frontend is an optional client/cockpit that can connect, observe, inspect, and issue authorized control commands.

## Core principle

```text
                ┌──────────────────────────────┐
                │       NEMESIS BACKEND        │
                │                              │
                │   COMPLETE AUTONOMOUS OS     │
                │                              │
                │ Market Data                  │
                │ Agent Runtime                │
                │ Strategy Engine              │
                │ Risk Engine                  │
                │ Execution Engine             │
                │ Position Manager             │
                │ Scheduler                   │
                │ Event Bus                    │
                │ Event Store                  │
                │ Recovery / Reconciliation    │
                └──────────────┬───────────────┘
                               │
                     optional interfaces
                               │
             ┌─────────────────┼─────────────────┐
             │                 │                 │
             ▼                 ▼                 ▼
       Web Dashboard       CLI / TUI          API Clients
       React + WS          Operator CLI       Automation
```

The backend should **never ask**:

> "Is the frontend connected?"

before doing anything important.

---

# 1. Backend is the product

Think of the frontend as a **client**, not part of the trading system.

```text
NEMESIS
│
├── Core Runtime
│   ├── Market Data
│   ├── Agent Orchestrator
│   ├── Agent Workers
│   ├── Strategy Engine
│   ├── Risk Engine
│   ├── Execution Engine
│   ├── Position Manager
│   └── Reconciliation
│
├── Persistence
│   ├── PostgreSQL
│   ├── Redis
│   └── Event Store
│
├── Interfaces
│   ├── REST API
│   ├── WebSocket API
│   ├── CLI
│   └── Admin API
│
└── Optional Clients
    └── React UI
```

The React application can be completely shut down:

```text
Frontend = OFF
          ↓
Backend = RUNNING
          ↓
Market data continues
          ↓
Agents continue
          ↓
Risk continues
          ↓
Orders continue
          ↓
Positions continue
          ↓
Events continue to be persisted
```

Then six hours later:

```text
Frontend starts
      ↓
Authenticate
      ↓
GET current snapshot
      ↓
Connect WebSocket
      ↓
Resume live event stream
```

The UI simply catches up.

---

# 2. This should be a headless trading system

The term I would use internally is:

> **Headless Autonomous Trading Engine**

The backend should be capable of running:

```bash
nemesis start
```

with no browser.

You should be able to see:

```text
NEMESIS ENGINE
──────────────────────────────

Status       RUNNING
Mode         AUTONOMOUS
Exchange     Binance Futures
Environment  PAPER

Market Feed  CONNECTED
Agent Bus    HEALTHY
Risk Engine  HEALTHY
Execution    HEALTHY

Active Agents       8
Active Positions    3
Pending Orders      2

Last Decision       14 sec ago
Last Event          2 sec ago
```

That is the real system.

---

# 3. Frontend becomes a control plane

The React frontend should basically be:

> **Observability + Operations + Control**

It doesn't run the machine.

```text
                    NEMESIS ENGINE
                          │
           ┌──────────────┼──────────────┐
           │              │              │
        REST API       WebSocket       Commands
           │              │              │
           └──────────────┼──────────────┘
                          │
                    React Frontend
```

### Read operations

```text
GET state
GET positions
GET orders
GET agents
GET runs
GET decisions
GET risk
GET historical events
```

### Live operations

```text
WebSocket
  ↓
agent events
market state
orders
positions
risk
system health
```

### Control operations

```text
POST /commands/pause
POST /commands/resume
POST /commands/safe-mode
POST /commands/close-position
POST /commands/disable-agent
```

---

# 4. Never make the frontend the scheduler

This is particularly important.

Bad:

```text
React
 ↓
setInterval()
 ↓
Ask backend to analyze BTC
 ↓
Agent runs
```

The browser closing kills the workflow.

Correct:

```text
Backend Scheduler
       ↓
Agent Orchestrator
       ↓
Analysis Run
       ↓
Risk
       ↓
Execution
```

The browser only observes it.

---

# 5. Backend autonomous loop

Your backend could continuously operate:

```text
                  MARKET EVENT
                       │
                       ▼
                EVENT INGESTION
                       │
                       ▼
                MARKET STATE
                       │
                       ▼
                 SUPERVISOR
                       │
             ┌─────────┼─────────┐
             ▼         ▼         ▼
         Structure  Momentum  OrderFlow
             │         │         │
             └─────────┼─────────┘
                       ▼
                  SIGNAL FUSION
                       │
                ┌──────┴──────┐
                ▼             ▼
              LONG          SHORT
                │             │
                └──────┬──────┘
                       ▼
                  TRADE JUDGE
                       │
                       ▼
                   RISK ENGINE
                  /          \
              REJECT          PASS
                │               │
              NO_TRADE          ▼
                          EXECUTION ENGINE
                                │
                                ▼
                         POSITION MANAGER
                                │
                       ┌────────┼────────┐
                       ▼        ▼        ▼
                      SL        TP      TRAIL
```

No UI appears anywhere in that diagram.

That's exactly what you want.

---

# 6. Event sourcing becomes very important

The backend should record what happened independently of whether anyone was watching.

For example:

```text
Event #91820
MARKET_UPDATE

Event #91821
AGENT_RUN_STARTED

Event #91822
OBSERVATION_CREATED

Event #91823
TOOL_CALL_STARTED

Event #91824
TOOL_CALL_COMPLETED

Event #91825
DECISION_CREATED

Event #91826
RISK_APPROVED

Event #91827
ORDER_SUBMITTED

Event #91828
ORDER_FILLED

Event #91829
POSITION_OPENED
```

The frontend can connect three hours later and retrieve the history.

---

# 7. Separate current state from event history

This is crucial.

### Event store

Answers:

> **What happened?**

```text
AgentRunStarted
ToolCalled
DecisionCreated
RiskApproved
OrderFilled
```

### State store

Answers:

> **What is true right now?**

```text
Current BTC position
Current balance
Current agent state
Current risk
Current orders
```

Architecture:

```text
                     EVENT BUS
                         │
             ┌───────────┼────────────┐
             ▼           ▼            ▼
         Event Store  State Projector  Live WS
             │           │            │
             ▼           ▼            ▼
         History       Redis/DB      Frontend
```

This makes reconnecting the frontend easy.

---

# 8. Frontend connection process

Suppose the backend has been running for 8 hours.

The user opens the frontend.

### Step 1

```text
GET /api/v1/system/snapshot
```

Backend:

```json
{
  "state_version": 182921,
  "account": {},
  "positions": [],
  "orders": [],
  "risk": {},
  "agents": {},
  "active_runs": []
}
```

### Step 2

Frontend connects:

```text
WSS /ws
```

### Step 3

Frontend says:

```json
{
  "type": "subscribe",
  "streams": [
    "portfolio",
    "trading",
    "agent",
    "risk"
  ]
}
```

### Step 4

Backend starts sending:

```text
position.updated
agent.decision
risk.updated
order.updated
```

The browser has now attached itself to an already-running system.

---

# 9. Frontend disappears

Suppose:

```text
16:00 frontend connected
16:15 laptop closed
```

Backend:

```text
16:15 market continues
16:16 agent runs
16:17 BTC position monitored
16:18 trailing stop updated
16:20 agent exits position
16:21 new opportunity detected
16:22 new trade opened
```

Nothing stops.

Frontend isn't required.

---

# 10. Frontend reconnects

```text
16:40 frontend opened
```

It sees:

```text
CURRENT SYSTEM STATE

Agent              RUNNING
BTC Position       CLOSED
ETH Position       LONG
Risk               LOW
Last Decision      16:39:44
```

Then:

```text
Agent History

16:20 EXIT BTC
16:21 Analysis
16:22 LONG ETH
...
```

The user never lost context.

---

# 11. Control commands must also be backend-authoritative

The frontend should not directly modify internal state.

Instead:

```text
User
 ↓
React
 ↓
POST /commands/pause-agent
 ↓
Backend Command Handler
 ↓
Authorization
 ↓
Validation
 ↓
Agent Supervisor
 ↓
Agent paused
 ↓
Event emitted
```

Then:

```text
agent.status.changed
```

goes to every connected UI.

This means **CLI, UI, API automation and future mobile clients can all control the same engine**.

---

# 12. One command layer for every interface

I strongly recommend this.

```text
                       COMMAND BUS
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
           REST UI        CLI       Automation
              │            │            │
              └────────────┼────────────┘
                           ▼
                    Command Handler
                           │
                           ▼
                     Authorization
                           │
                           ▼
                     Validation
                           │
                           ▼
                     Core Runtime
```

Therefore:

```text
UI:
Pause Agent

CLI:
nemesis agent pause

API:
POST /agents/{id}/pause
```

all invoke the **same backend command**.

---

# 13. This gives you something even more powerful

You can run the backend on a server:

```text
AWS / dedicated server / Kubernetes
        │
        ▼
NEMESIS ENGINE
        │
        ├── Binance
        ├── PostgreSQL
        ├── Redis
        ├── Agent Runtime
        └── Event Store
```

And have:

```text
Laptop
   │
React UI
   │
   ▼
NEMESIS API
```

Then:

```text
Phone
   │
Future mobile UI
   │
   ▼
NEMESIS API
```

And:

```text
Terminal
   │
CLI
   │
   ▼
NEMESIS API
```

All control the same autonomous engine.

---

# 14. Even better: make the frontend replaceable

Your contract should be:

```text
NEMESIS API CONTRACT
```

rather than:

```text
React-specific backend
```

Then you can eventually have:

```text
                 NEMESIS ENGINE
                       │
        ┌──────────────┼────────────────┐
        │              │                │
      React           CLI             Mobile
        │              │                │
        ▼              ▼                ▼
      REST            REST             REST
        │              │                │
        └──────────────┼────────────────┘
                       │
                    Commands
```

The engine does not care who is connected.

---

# 15. Backend services

I would ultimately structure the backend approximately as:

```text
nemesis/
│
├── core/
│   ├── market/
│   ├── agents/
│   ├── strategies/
│   ├── risk/
│   ├── execution/
│   ├── positions/
│   └── portfolio/
│
├── runtime/
│   ├── supervisor/
│   ├── scheduler/
│   ├── workers/
│   └── lifecycle/
│
├── exchange/
│   └── binance/
│
├── events/
│   ├── bus/
│   ├── store/
│   ├── schemas/
│   └── projections/
│
├── api/
│   ├── rest/
│   ├── websocket/
│   └── commands/
│
├── persistence/
│   ├── postgres/
│   └── redis/
│
└── observability/
    ├── metrics/
    ├── tracing/
    └── logs/
```

---

# 16. Worker processes should survive frontend failure

For example:

```text
Process                 Role
────────────────────────────────────
market-worker           Exchange data
agent-supervisor        Orchestration
agent-worker            AI agents
risk-worker             Risk evaluation
execution-worker        Orders
position-worker         Position management
event-worker            Event persistence
reconciliation-worker   Exchange reconciliation
scheduler               Agent scheduling
api-server              REST
ws-server               WebSocket
```

The important architectural separation is:

```text
API/WS crashes
      ↓
Trading engine continues
```

And ideally even:

```text
Frontend crashes
      ↓
Everything continues
```

A production system can go further:

```text
WS server crashes
      ↓
Trading engine continues
      ↓
WS restarts
      ↓
Frontend reconnects
      ↓
Snapshot + event replay
```

---

# 17. The frontend should never control the heartbeat of the agent

This is a subtle but important design rule.

Bad architecture:

```text
Frontend
   ↓
"Still alive?"
   ↓
Backend agent continues
```

Correct:

```text
Agent Supervisor
       │
       ├── internal heartbeat
       ├── worker health
       ├── exchange health
       ├── risk health
       └── execution health
```

The UI only observes:

```text
Agent Supervisor
  ● HEALTHY
  heartbeat: 2s
```

---

# 18. Autonomous system health

The backend itself should have a health model:

```text
NEMESIS HEALTH

Market Data       HEALTHY
Binance            HEALTHY
Agent Runtime      HEALTHY
Risk Engine        HEALTHY
Execution          HEALTHY
PostgreSQL         HEALTHY
Redis              HEALTHY
Event Store        HEALTHY

Autonomous Trading
ENABLED
```

If something critical fails:

```text
Binance connection
        ↓
FAILED
        ↓
Market data stale
        ↓
Supervisor
        ↓
BLOCK NEW TRADES
        ↓
Position manager remains active
        ↓
Alert
```

Notice that this decision happens **without the frontend**.

---

# 19. Fail-safe behavior

This is where your architecture becomes production-grade.

Example:

```text
Frontend offline
        ↓
NO EFFECT
```

```text
WebSocket offline
        ↓
NO EFFECT
```

```text
API offline
        ↓
NO EFFECT ON CORE ENGINE
```

```text
Market data unavailable
        ↓
NEW TRADES BLOCKED
POSITION MONITORING CONTINUES
```

```text
Risk engine unavailable
        ↓
NEW TRADES BLOCKED
```

```text
Execution service unavailable
        ↓
NEW ORDERS BLOCKED
```

The system needs explicit **failure domains**.

---

# 20. The final architecture

This is what I recommend you lock in:

```text
                              NEMESIS
                                │
                  ┌─────────────▼─────────────┐
                  │    AUTONOMOUS ENGINE      │
                  │                           │
                  │  Always Running           │
                  │                           │
                  │  Market Intelligence      │
                  │  Agent Supervisor         │
                  │  Agent Fleet              │
                  │  Strategy Engine          │
                  │  Risk Engine              │
                  │  Execution Engine         │
                  │  Position Manager         │
                  │  Reconciliation           │
                  │  Scheduler                │
                  └─────────────┬─────────────┘
                                │
                         Event / State Bus
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
              ▼                 ▼                 ▼
          PostgreSQL          Redis          Event Store
              │                 │                 │
              └─────────────────┼─────────────────┘
                                │
                         API / Interface Layer
                                │
             ┌──────────────────┼──────────────────┐
             │                  │                  │
             ▼                  ▼                  ▼
         REST API          WebSocket API         CLI
             │                  │                  │
             └──────────────────┼──────────────────┘
                                │
                         OPTIONAL CLIENTS
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
                 React UI     Mobile       TUI
```

## The key boundary

```text
                 CONTROL PLANE
        ┌───────────────────────────┐
        │ React / CLI / Mobile      │
        │                           │
        │ Observe                   │
        │ Inspect                   │
        │ Configure                 │
        │ Command                   │
        └─────────────┬─────────────┘
                      │
                 REST / WS
                      │
        ┌─────────────▼─────────────┐
        │       NEMESIS CORE        │
        │                           │
        │        DATA PLANE         │
        │                           │
        │ Market                    │
        │ Agents                    │
        │ Strategy                  │
        │ Risk                      │
        │ Execution                 │
        │ Positions                 │
        │ Events                    │
        └───────────────────────────┘
```

**This is the architecture I would use.**

The frontend can disappear for days and the autonomous system continues operating. When the frontend returns, it **doesn't restart the trading system**; it **attaches to the already-running system, obtains the current state, synchronizes the event stream, and becomes an observation/control console**.

That also gives you the right foundation for paper trading, live trading, backtesting/replay, multiple agent fleets, multiple exchanges, CLI automation, mobile clients, and eventually multiple independent frontend applications without coupling any of them to the trading engine.

Yes. **The existing `algo_scalper_api` is a very good base for this architecture.** I would extend it rather than start another backend.

The important caveat is that the repository is currently an **Indian-index options system**, not yet the final crypto-perpetuals autonomous-agent platform. But the *runtime architecture* already contains most of the primitives we need.

## What I verified in the existing repo

The current `algo_scalper_api` is already structured as a Rails API-only backend with a **separate long-running trading process**. Its documented process model has `web`, `trading`, `jobs`, and `dashboard` as independent processes, and the trading daemon is explicitly independent of the dashboard.

More importantly, `Procfile.dev` actually runs the trading daemon independently:

```text
web       → Rails API
trading   → ENABLE_TRADING_SERVICES=true bundle exec rake trading:daemon
jobs      → Solid Queue
dashboard → separate frontend
```

So the first architectural requirement we discussed is **already present**: shutting down the dashboard does not inherently stop the trading daemon.

The current bootstrap also explicitly wires a long-running supervisor with market feed, AI/SMC analysis, risk, order routing, exits, reconciliation, strategy manager, PnL, candle polling and related services.

The repo also already has:

* PostgreSQL
* Redis
* Solid Queue
* Solid Cable / ActionCable
* `concurrent-ruby`
* DhanHQ WebSocket integration
* Ollama client
* `ruby_llm`
* `ruby_llm-agents`
* separate paper/live order gateways

And its execution architecture already centralizes paper/live selection in `Orders::GatewayFactory`, with `GatewayPaper` versus `GatewayLive`.

So this is **not a greenfield architecture problem**.

---

# The important conclusion

## We should evolve `algo_scalper_api` into this

```text
                         NEMESIS ENGINE
                              │
                    ┌─────────▼─────────┐
                    │ AUTONOMOUS RUNTIME│
                    └─────────┬─────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
  Market Runtime        Agent Runtime        Trading Runtime
        │                     │                     │
        │               ┌─────▼─────┐             │
        │               │ Supervisor│             │
        │               └─────┬─────┘             │
        │                     │                    │
        │        ┌────────────┼────────────┐       │
        │        ▼            ▼            ▼       │
        │   Structure      Flow         Strategy    │
        │     Agent        Agent          Agents    │
        │        └────────────┼────────────┘       │
        │                     ▼                    │
        │                Trade Judge               │
        │                     │                    │
        │                     ▼                    │
        │                 Risk Engine              │
        │                     │                    │
        │                     ▼                    │
        │               Execution Engine           │
        │                     │                    │
        │                     ▼                    │
        │               Position Manager           │
        │                                          │
        └──────────────────────┬───────────────────┘
                               │
                         Event / State Bus
                               │
                  ┌────────────┼────────────┐
                  ▼            ▼            ▼
               Postgres      Redis       Event Store
                               │
                         API / WebSocket
                               │
                         OPTIONAL UI
```

That can be achieved incrementally.

---

# 1. Your current process separation is already correct

This is the strongest part of the current system.

Right now:

```text
dashboard
    ↓
Rails API
    ↓
trading daemon
```

is **not** the actual architecture.

It is closer to:

```text
                 ┌─────────────┐
                 │ Rails API   │
                 └─────────────┘

                 ┌─────────────┐
                 │ Trading     │
                 │ Daemon      │
                 └─────────────┘

                 ┌─────────────┐
                 │ Jobs        │
                 └─────────────┘

                 ┌─────────────┐
                 │ Dashboard   │
                 └─────────────┘

        All sharing PostgreSQL + Redis
```

The repo explicitly documents this multi-process model and says the trading brain runs as its own process with many services/threads.

That means:

### Desired behavior

```text
Frontend OFF
      ↓
Trading daemon continues
      ↓
Agents continue
      ↓
Risk continues
      ↓
Execution continues
```

is already structurally possible.

---

# 2. The current paper/live architecture is also reusable

The existing system has:

```text
Orders::GatewayFactory
        │
        ├── GatewayPaper
        │
        └── GatewayLive
```

with the choice centralized instead of being scattered throughout trading code.

That is exactly the abstraction we want.

But I would change the concept from:

```text
paper = boolean
```

to:

```text
execution_mode:
  paper
  shadow
  live
```

Because **shadow is not just paper**.

---

# 3. Your final execution-mode architecture

I would make this explicit:

```text
Trading Mode
│
├── PAPER
│   ├── Real market data
│   ├── Real agent decisions
│   ├── Simulated orders
│   ├── Simulated fills
│   └── Simulated PnL
│
├── SHADOW
│   ├── Real market data
│   ├── Real agent decisions
│   ├── Real risk checks
│   ├── Real intended orders
│   ├── NO exchange submission
│   └── Compare intended vs market execution
│
└── LIVE
    ├── Real market data
    ├── Real agents
    ├── Real risk
    ├── Real orders
    └── Real positions
```

This is much cleaner than allowing different components to make independent paper/live decisions.

---

# 4. The mode should live above the execution gateway

Instead of:

```ruby
paper_mode = true
```

everywhere, introduce:

```ruby
TradingMode
```

```ruby
TradingMode::PAPER
TradingMode::SHADOW
TradingMode::LIVE
```

Then:

```ruby
ExecutionGateway.for(mode)
```

becomes:

```text
                 Execution Intent
                        │
                        ▼
                 Execution Router
                        │
             ┌──────────┼──────────┐
             ▼          ▼          ▼
           PAPER      SHADOW      LIVE
             │          │          │
        Simulator    Recorder   Exchange
```

This preserves your existing `GatewayPaper/GatewayLive` design while adding the missing shadow mode.

---

# 5. Ollama integration is already in the backend

This is another major advantage.

The existing repository already includes:

```text
ollama-client
ruby_llm
ruby_llm-agents
```

and its own AI/agent services.

There is also a separate `ai_trading_agent` repository whose architecture already demonstrates:

```text
Ollama Client
      ↓
Agent Loop
      ↓
Planner Router
      ↓
Tool Guard
      ↓
Tool Executor
      ↓
Trading Tools
```

and explicitly describes strict tool-call sequencing.

So we don't need to invent an LLM/tool architecture from scratch.

---

# 6. But I would change one thing fundamentally

Your current agent architecture is too close to:

```text
Agent
  ↓
Planner
  ↓
Tool
  ↓
Result
  ↓
Next tool
```

for a single analysis flow.

For the final autonomous system, use:

```text
Supervisor
    │
    ├── Structure Agent
    ├── Momentum Agent
    ├── Order Flow Agent
    ├── Funding Agent
    ├── Volatility Agent
    ├── Liquidity Agent
    │
    └── Strategy Agents
             │
             ▼
        Trade Judge
             │
             ▼
        Risk Engine
             │
             ▼
        Execution
```

The **planner/tool-guard architecture remains useful inside each agent**.

That's the key distinction.

---

# 7. The current `Strategies::Manager` is actually a good starting point

The current repo already has a strategy manager that dynamically manages strategy records, runner threads, context builders, signals and entry qualification. The documented runtime says strategy runners build context, invoke strategy plugins, persist signals, and can feed qualifying signals into option-chain/entry guard execution.

That is conceptually very close to:

```text
Agent Registry
       ↓
Agent Manager
       ↓
Agent Workers
```

So I would evolve:

```text
Strategies::Manager
```

toward:

```text
AgentRuntime::Supervisor
```

without throwing the strategy plugin architecture away.

---

# 8. The big architectural change: distinguish Strategy from Agent

This needs to be clean.

### Strategy

Answers:

> What trading methodology are we applying?

Examples:

```text
TrendFollowing
Breakout
MeanReversion
FundingArbitrage
```

### Agent

Answers:

> What role is performing reasoning/analysis?

Examples:

```text
StructureAgent
OrderFlowAgent
MarketRegimeAgent
TradeJudgeAgent
SupervisorAgent
ResearchAgent
```

### Execution engine

Answers:

> Can and should this trade actually be executed?

### Risk engine

Answers:

> Is this financially allowed?

These should never collapse into one giant class.

---

# 9. New target architecture inside your existing Rails repo

I would move toward:

```text
app/services/
│
├── runtime/
│   ├── supervisor.rb
│   ├── lifecycle.rb
│   ├── scheduler.rb
│   └── health.rb
│
├── agents/
│   ├── base.rb
│   ├── registry.rb
│   ├── supervisor.rb
│   ├── structure_agent.rb
│   ├── momentum_agent.rb
│   ├── order_flow_agent.rb
│   ├── funding_agent.rb
│   ├── volatility_agent.rb
│   ├── liquidity_agent.rb
│   ├── long_agent.rb
│   ├── short_agent.rb
│   ├── trade_judge.rb
│   └── post_trade_agent.rb
│
├── agent_runtime/
│   ├── run.rb
│   ├── context.rb
│   ├── tool_executor.rb
│   ├── tool_guard.rb
│   ├── planner.rb
│   ├── event_emitter.rb
│   └── trace_store.rb
│
├── execution/
│   ├── intent.rb
│   ├── router.rb
│   ├── paper.rb
│   ├── shadow.rb
│   └── live.rb
│
├── risk/
├── positions/
├── market/
├── strategies/
├── events/
│   ├── bus.rb
│   ├── publisher.rb
│   └── projector.rb
│
└── observability/
```

This is an evolution, not a rewrite.

---

# 10. The current supervisor becomes the central runtime

You already have:

```ruby
TradingSystem::Supervisor
```

and `TradingSystem::Bootstrap` registers the long-running services into it.

That's exactly where the new architecture belongs.

I'd make:

```text
TradingSystem::Supervisor
        │
        ├── Market Runtime
        ├── Agent Runtime
        ├── Strategy Runtime
        ├── Risk Runtime
        ├── Execution Runtime
        ├── Position Runtime
        ├── Reconciliation Runtime
        └── Event Runtime
```

---

# 11. Add an event spine

This is the **single biggest missing architectural piece** for the UI/agent observability vision.

You already have Redis and ActionCable/Solid Cable.

Use:

```text
Core::EventBus
       ↓
Domain Event
       ↓
Event Publisher
       ├── Postgres / Event Store
       ├── Redis
       ├── ActionCable
       └── Logs / Metrics
```

Every meaningful action generates an event:

```text
AgentRunStarted
AgentObservation
ToolCallStarted
ToolCallCompleted
AgentHandoff
DecisionCreated
RiskCheckCompleted
OrderIntentCreated
OrderSubmitted
OrderFilled
PositionUpdated
NoTrade
```

This becomes the foundation of the future frontend.

---

# 12. Your existing ActionCable is useful

You already have Solid Cable / ActionCable in the stack.

So I wouldn't initially introduce another WebSocket framework.

Use:

```text
Rails ActionCable
        ↓
NEMESIS event channels
```

For example:

```text
agent:live
agent:run:<run_id>
agent:pipeline
trading:orders
trading:positions
risk:live
system:health
market:<symbol>
```

The existing repo already broadcasts strategy status over ActionCable according to its architecture reference.

So again: **we are extending existing capability, not replacing it.**

---

# 13. The frontend can become completely optional

The target should be:

```text
docker compose up
```

starts:

```text
postgres
redis
ollama
nemesis-trading
nemesis-jobs
nemesis-api
```

and **does not require the dashboard**.

Then:

```text
docker compose --profile ui up
```

adds:

```text
nemesis-dashboard
```

Or on Kubernetes:

```text
Deployment: nemesis-core
Deployment: nemesis-api
Deployment: nemesis-ui
```

The UI can disappear without affecting the core engine.

---

# 14. I would change your process model slightly

Current:

```text
web
trading
jobs
dashboard
sidecar
```

Future:

```text
core
api
jobs
frontend
```

where:

### `core`

```text
Market
Agents
Strategies
Risk
Execution
Positions
Reconciliation
```

### `api`

```text
REST
ActionCable
Commands
Auth
Snapshots
```

### `jobs`

```text
research
maintenance
daily reconciliation
reports
```

### `frontend`

```text
optional
```

You can initially keep `web + trading` in the same Rails repository/process arrangement. There is no need to split into microservices immediately.

---

# 15. Paper/shadow/live should be part of the event model

Every event should carry:

```json
{
  "environment": "paper",
  "execution_mode": "shadow",
  "exchange": "binance",
  "symbol": "BTCUSDT"
}
```

So the UI can show:

```text
PAPER
```

or:

```text
SHADOW
```

or:

```text
LIVE
```

and **never mix them**.

This becomes extremely important when the same autonomous agent is running in multiple environments simultaneously.

---

# 16. Run model

Introduce:

```text
AgentRun
```

Conceptually:

```text
AgentRun
├── id
├── environment
├── execution_mode
├── agent_id
├── strategy_id
├── symbol
├── started_at
├── completed_at
├── status
├── decision
├── confidence
└── trace_id
```

Then:

```text
AgentRun
   │
   ├── Observation
   ├── ToolCall
   ├── ToolResult
   ├── Handoff
   ├── Decision
   ├── RiskCheck
   ├── OrderIntent
   └── Outcome
```

This is what enables the **Agent Control Center UI** we designed.

---

# 17. Tool execution is already conceptually present

Your `ai_trading_agent` repo explicitly separates:

```text
ToolGuard
ToolExecutor
PlannerRouter
```

and your `algo_scalper_api` already has multiple deterministic guards before an entry can reach execution.

We should combine the ideas:

```text
LLM Agent
   ↓
Tool Guard
   ↓
Tool Executor
   ↓
Domain Service
   ↓
Result
   ↓
Agent Event
```

This is exactly what the UI will visualize.

---

# 18. The biggest thing I would NOT do

Do **not** turn the current Rails system into:

```text
React
  ↓
API
  ↓
LLM
  ↓
Trading
```

The current repository is actually better than that.

Keep:

```text
                  BACKEND
                     │
      ┌──────────────┼──────────────┐
      ▼              ▼              ▼
    MARKET         AGENTS         TRADING
      │              │              │
      └──────────────┼──────────────┘
                     ▼
                 EVENT BUS
                     │
              ┌──────┴──────┐
              ▼             ▼
           Database       UI/WS
```

---

# 19. There is one serious current-repo issue

The repository documentation itself states there are **multiple competing/complementary signal-generation paths**, including the older `Signal::Engine` path and the newer `Strategies::Manager` plugin platform. It also explicitly warns that some documentation is stale relative to the current bootstrap wiring.

That means:

> **Before adding the autonomous multi-agent system, we should establish one canonical signal/decision pipeline.**

Otherwise you'll end up with:

```text
Signal Engine
      +
Options Buying
      +
Strategies Manager
      +
AI Trading Bot
      +
New Agent Supervisor
```

all potentially making decisions.

That is unacceptable for live trading.

---

# 20. I would make this the canonical path

```text
MARKET DATA
    ↓
MARKET STATE
    ↓
SUPERVISOR
    ↓
SPECIALIST AGENTS
    ↓
SIGNAL FUSION
    ↓
STRATEGY / TRADE JUDGE
    ↓
RISK ENGINE
    ↓
ORDER INTENT
    ↓
EXECUTION MODE ROUTER
    ├── PAPER
    ├── SHADOW
    └── LIVE
    ↓
POSITION MANAGER
    ↓
EVENT STORE
```

Existing strategy implementations can plug into the middle.

Existing entry guards remain useful as **deterministic risk/precondition gates**.

Existing execution gateways remain useful.

Existing reconciliation remains useful.

Existing Ollama integration remains useful.

---

# 21. What happens to the current `EntryGuard`?

**Keep it.**

Do not replace 33 deterministic guards with an LLM.

The current system already has extensive guards for drawdown, cooldown, exposure, sizing, regime, liquidity/volume-related conditions, trading-time restrictions and other controls.

That becomes:

```text
AI Trade Proposal
        ↓
Deterministic Entry Guards
        ↓
Risk Engine
        ↓
Execution
```

The LLM proposes.

**The system validates.**

---

# 22. What happens to the current exit engine?

Also keep it.

The repository already treats `Live::ExitEngine` as the centralized exit placement mechanism, with risk/trailing components detecting conditions and delegating actual exit placement.

That is exactly the correct pattern.

You can later add:

```text
Exit Agent
```

but:

```text
Exit Agent
    ↓
suggest exit
    ↓
Exit Rules
    ↓
Risk
    ↓
ExitEngine
```

not:

```text
LLM → exchange
```

---

# 23. What happens when the frontend is down?

With this architecture:

```text
React OFF
    │
    X
    │
NEMESIS CORE
    │
    ├── Market data ✓
    ├── Agent supervisor ✓
    ├── Ollama ✓
    ├── Risk ✓
    ├── Execution ✓
    ├── Positions ✓
    └── Event store ✓
```

Then frontend starts:

```text
GET /api/v1/runtime/snapshot
        ↓
Current state

WSS /cable
        ↓
Live events
```

This is completely compatible with the current separation of `web` and `trading` processes.

---

# 24. Final target for this repository

I would **not create another backend repo**.

Use:

> `shubhamtaywade82/algo_scalper_api`

as the foundation and evolve it into:

```text
NEMESIS Autonomous Trading Engine
```

while treating the current options-specific logic as one domain/strategy implementation rather than the permanent system architecture.

Conceptually:

```text
algo_scalper_api
        │
        ▼
NEMESIS CORE
        │
        ├── Crypto Perpetuals
        │   ├── Binance
        │   ├── BTC
        │   ├── ETH
        │   └── ...
        │
        ├── Agents
        │
        ├── Strategies
        │
        ├── Risk
        │
        ├── Execution
        │
        ├── Paper
        ├── Shadow
        └── Live
```

---

# My assessment

| Capability                   | Current repo                      | Target             | Gap                        |
| ---------------------------- | --------------------------------- | ------------------ | -------------------------- |
| Headless backend             | **Yes**                           | Yes                | Small                      |
| Separate trading process     | **Yes**                           | Yes                | None                       |
| Paper execution              | **Yes**                           | Yes                | Extend                     |
| Live execution               | **Yes**                           | Yes                | Extend                     |
| Shadow mode                  | Partial/config concepts           | First-class        | **Needs work**             |
| Ollama                       | **Yes**                           | Yes                | Extend                     |
| Tool calling                 | **Yes**                           | Yes                | Extend                     |
| Planner/guard                | **Yes**                           | Yes                | Refactor                   |
| Multiple agents              | Partial                           | Full agent runtime | **Major**                  |
| Supervisor                   | **Yes**                           | Agent supervisor   | Refactor                   |
| Strategy registry            | **Yes**                           | Yes                | Reuse                      |
| Risk engine                  | **Strong**                        | Yes                | Reuse                      |
| Exit engine                  | **Strong**                        | Yes                | Reuse                      |
| Reconciliation               | **Yes**                           | Yes                | Reuse                      |
| Redis                        | **Yes**                           | Yes                | Reuse                      |
| PostgreSQL                   | **Yes**                           | Yes                | Reuse                      |
| ActionCable                  | **Yes**                           | Yes                | Expand                     |
| Event trace                  | Partial                           | Full               | **Major**                  |
| Agent run persistence        | Partial                           | Required           | **Major**                  |
| Agent DAG visualization data | No                                | Required           | Add                        |
| WebSocket state resync       | Partial                           | Required           | Add                        |
| Optional frontend            | **Already structurally possible** | Yes                | Formalize                  |
| Crypto futures               | Not primary                       | Required           | **Major domain expansion** |

## Bottom line

**Yes, we can achieve the architecture we designed inside the existing system.**

And I would **strongly recommend doing so rather than starting from scratch**.

The current repo already has the correct backbone: **independent trading daemon + supervisor + Redis/Postgres + paper/live gateway abstraction + reconciliation + deterministic risk/entry/exit controls + Ollama/agent integration + ActionCable**.

The major work is to turn those pieces into one canonical **headless autonomous runtime**, introduce **first-class paper/shadow/live execution modes**, build a persistent **agent-run/event model**, and expose that runtime through a **REST + ActionCable control plane**.

One warning: the current repository is demonstrably built around **NIFTY/BANKNIFTY/SENSEX options and DhanHQ**, so the clean approach is to extract the existing runtime architecture from those India-specific domain components and make **crypto perpetuals an exchange/domain adapter**, rather than simply bolting Binance onto the existing options pipeline.

Yes. **After checking `paper-broker`, this is the better foundation for the architecture we designed.** In fact, I would now prefer `paper-broker` over `algo_scalper_api` for the **crypto perpetual autonomous-agent system**.

## Why `paper-broker` is the stronger base

It already matches the target domain:

* Crypto futures/perpetual market data
* Binance integration
* Paper execution
* Shadow mode
* Live mode
* Ollama SDK
* Multiple AI-agent concepts
* Event-sourced persistence
* WebSocket gateway
* REST API
* Built-in dashboard
* Background Docker deployment
* Risk/execution routing
* Strategy engine

The README explicitly describes **paper, shadow and live modes**, event-sourced persistence, a WebSocket gateway, and an Ollama-driven LLM strategy.

More importantly, the source already has an `AgentRuntime` built around `@nemesis-oss/ollama-sdk`, skills, tool namespaces, event-triggered execution, evidence collection, mode enforcement, and structured decisions.

And it already has a multi-agent pipeline:

```text
Analyst
   ↓
Debate
   ↓
Trader
   ↓
Risk Team
   ↓
Fund Manager
```

implemented through `TradingAgentsPipeline`.

That is remarkably close to what we just designed.

---

# 1. The most important discovery

The repo already has this:

```text
Market Events
     ↓
AgentRuntime
     ↓
Skills
     ↓
Tools
     ↓
Structured Decision
```

and separately:

```text
Analyst Team
     ↓
Debate
     ↓
Trader
     ↓
Risk Team
     ↓
Fund Manager
     ↓
Signal
     ↓
Strategy Engine
```

This means you do **not** need to invent an autonomous-agent architecture.

You need to **unify the existing two AI architectures**.

---

# 2. Current architecture

From `engine.ts`, the actual runtime is roughly:

```text
Binance
  │
  ▼
BinanceStreamHandler
  │
  ▼
MarketStateManager
  │
  ├── KlineStore
  ├── MTF State
  ├── Market Structure
  ├── SMC
  ├── Setup Engine
  └── Execution Plan
           │
           ▼
     StrategyEngine
           │
           ▼
    SMC Agent Strategy
           │
           ▼
 TradingAgentsPipeline
           │
           ▼
 SignalExecutor
           │
           ▼
      PaperBroker
```

The engine also starts the API/WebSocket gateway and scheduler independently of the UI.

That is already a **headless backend-capable architecture**.

---

# 3. So yes: frontend can be optional

Current architecture:

```text
                    PAPER-BROKER ENGINE
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
     Binance             Agents            Broker
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
                      Event Store
                           │
                    REST + WebSocket
                           │
                     Dashboard
```

If dashboard dies:

```text
Dashboard OFF
     X
     │
     ▼
Engine continues
```

The README explicitly supports running the compiled engine and Docker background deployment independently of the browser.

This is exactly what we wanted.

---

# 4. But there is one major problem

The current `engine.ts` tightly constructs nearly everything inside one large `startEngine()` function.

For example:

```text
BinanceClient
PaperBroker
MarketStateManager
KlineStore
StrategyEngine
AI pipeline
API
streams
scheduler
Telegram
```

are all wired directly there.

That works now.

But for our final architecture:

> **The composition root should remain, but the runtime itself needs explicit module boundaries.**

Otherwise the system becomes difficult to:

* run without UI
* run multiple agent pipelines
* test independently
* replay agent runs
* support multiple execution modes
* expose agent state cleanly
* run multiple symbols independently
* recover individual subsystems

---

# 5. The biggest thing to fix: paper/live/shadow semantics

The repo already has:

```text
TRADING_MODE=paper|shadow|live
```

and a `LiveTradingGuard` plus `ExecutionRouter`.

That is good.

But I would formalize it as a **first-class execution environment**:

```typescript
type TradingMode =
  | 'paper'
  | 'shadow'
  | 'live'
```

and make **every important event carry it**:

```json
{
  "mode": "shadow",
  "venue": "binance",
  "symbol": "BTCUSDT",
  "environment": "production"
}
```

This matters enormously once you have multiple autonomous runs.

---

# 6. Paper vs shadow vs live

The final semantics should be:

```text
PAPER
────────────────────────
Real Binance market data
Real agents
Real decisions
Real risk
Simulated execution
Simulated fills
Simulated account
```

```text
SHADOW
────────────────────────
Real Binance market data
Real agents
Real decisions
Real risk
Real order intent
NO exchange submission
Record hypothetical execution
Compare against actual market
```

```text
LIVE
────────────────────────
Real Binance market data
Real agents
Real risk
Real order intent
Real exchange execution
Real position
Real reconciliation
```

This is where `paper-broker` becomes especially strong.

---

# 7. The existing AI runtime is already close to our desired design

`AgentRuntime` has:

```text
AgentMode:
  OBSERVER
  ANALYST
  SUPERVISOR
```

and:

```text
AgentSkill
AgentTool
AgentMemorySnapshot
AgentRuntimeRunInput
AgentRuntimeTrace
```

It also explicitly restricts LLM execution tools and enforces mode-specific actions.

That's a very good foundation.

I'd extend it rather than rewrite it.

---

# 8. The current `AgentRuntime` should become the universal agent execution kernel

Today:

```text
AgentRuntime
```

is one runtime abstraction.

Make it:

```text
AgentRuntime
│
├── Agent Registry
├── Agent Lifecycle
├── Skill Registry
├── Tool Registry
├── Context Builder
├── Memory
├── Decision Policy
├── Trace Recorder
├── Event Publisher
└── Run Manager
```

Then specialized agents become:

```text
StructureAgent
MomentumAgent
OrderFlowAgent
FundingAgent
LiquidityAgent
VolatilityAgent
LongAgent
ShortAgent
TradeJudge
Supervisor
```

All execute through the same runtime.

---

# 9. Your current `TradingAgentsPipeline` should become one pipeline implementation

Today it is:

```text
runCycle()
  ↓
runAnalystTeam()
  ↓
runDebate()
  ↓
runTrader()
  ↓
runRiskTeam()
  ↓
runFundManager()
```

That's already useful.

But don't hard-code that as the **entire autonomous architecture**.

Turn it into:

```text
AgentPipeline
```

with configurable nodes:

```yaml
pipeline:
  - supervisor
  - structure
  - order_flow
  - funding
  - volatility
  - liquidity
  - signal_fusion
  - long_analyst
  - short_analyst
  - trade_judge
  - risk
  - execution
  - position_manager
```

Different strategies can define different graphs.

---

# 10. This is what I'd build on top of it

```text
                      NEMESIS RUNTIME
                            │
                     Agent Supervisor
                            │
             ┌──────────────┼──────────────┐
             │              │              │
             ▼              ▼              ▼
        Structure       Order Flow       Funding
          Agent            Agent           Agent
             │              │              │
             └──────────────┼──────────────┘
                            ▼
                     Signal Fusion
                            │
                   ┌────────┴────────┐
                   ▼                 ▼
                 LONG              SHORT
                 Agent              Agent
                   │                 │
                   └────────┬────────┘
                            ▼
                         Judge
                            │
                            ▼
                       Risk Engine
                            │
                     ┌──────┴──────┐
                     ▼             ▼
                  REJECT          PASS
                     │             │
                  NO_TRADE         ▼
                              Execution Router
                               /      |      \
                            PAPER   SHADOW   LIVE
                               \      |      /
                                Position
                                Manager
```

---

# 11. Your current `PaperBroker` is exactly where it should remain

The paper broker should **not know about AI**.

Current architecture already separates broker functionality from strategy/AI concerns. `engine.ts` creates `PaperBroker`, then feeds strategy signals into `SignalExecutor`.

Keep that boundary.

```text
AI
 ↓
Trade Intent
 ↓
Risk
 ↓
Execution Router
 ↓
PaperBroker / LiveBroker
```

Not:

```text
AI → PaperBroker
```

---

# 12. The execution abstraction should become

```typescript
interface ExecutionVenue {
  submit(intent: OrderIntent): Promise<ExecutionResult>
  cancel(orderId: string): Promise<void>
  cancelAll(symbol?: string): Promise<void>
  getPosition(symbol: string): Promise<Position>
}
```

Implementations:

```text
PaperExecutionVenue
ShadowExecutionVenue
BinanceExecutionVenue
CoinDCXExecutionVenue
```

Then:

```text
ExecutionRouter
      │
      ├── paper
      ├── shadow
      └── live
```

The current `ExecutionRouter → CoinDCXBroker` and `PaperBroker` design already points in this direction.

---

# 13. The current event log is a huge advantage

The README says the engine persists every order, fill, position, funding and system event into a SQLite WAL event log and JSONL stream, while keeping relational projections for queries.

That is extremely useful.

We can extend this to:

```text
AgentRunStarted
AgentActivated
AgentObservation
ToolCallStarted
ToolCallCompleted
AgentHandoff
AgentDecision
RiskEvaluation
OrderIntent
OrderSubmitted
OrderFilled
PositionUpdated
AgentRunCompleted
NoTrade
AgentError
```

Then the **entire Agent Control Center** is simply a visualization of that event stream.

---

# 14. The UI does NOT need to know about internal agent objects

Instead it consumes canonical events:

```json
{
  "type": "agent.tool.completed",
  "runId": "run_123",
  "agentId": "order-flow",
  "tool": "market.takerFlow",
  "durationMs": 43,
  "resultSummary": {
    "delta": 18342
  }
}
```

This is the correct FE/BE contract.

---

# 15. Your existing WebSocket is already the right foundation

The README exposes:

```text
ws://localhost:8080/ws
```

and already broadcasts:

```text
market.tick
order.updated
position.updated
...
```

And `engine.ts` directly uses `api.wsGateway.broadcast(...)`.

I'd evolve it into:

```text
system.*
market.*
agent.*
strategy.*
risk.*
execution.*
order.*
position.*
portfolio.*
incident.*
```

---

# 16. Frontend can therefore be a true optional control plane

```text
                NEMESIS ENGINE
                      │
          ┌───────────┴───────────┐
          │                       │
       REST API                 WebSocket
          │                       │
          └──────────┬────────────┘
                     │
                 OPTIONAL
                     │
             React Dashboard
```

No frontend:

```text
ENGINE → RUNNING
```

Frontend connects:

```text
ENGINE → RUNNING
         ↑
         │
      React
```

Frontend disconnects:

```text
ENGINE → RUNNING
```

Exactly the behavior you wanted.

---

# 17. There is one UI architectural decision I would change from the current repo

The existing repo bundles a **built-in dashboard into the API server**.

That is convenient during development.

But for NEMESIS, I would make the dashboard an independent application:

```text
paper-broker/
├── src/
│   └── headless engine
│
├── dashboard/
│   └── React application
│
└── packages/
    └── contracts/
```

The API server should still work when:

```text
dashboard/
```

doesn't exist.

---

# 18. Best final monorepo

I would move toward:

```text
paper-broker/
│
├── apps/
│   ├── engine/
│   ├── api/
│   └── dashboard/
│
├── packages/
│   ├── domain/
│   ├── contracts/
│   ├── events/
│   ├── agent-runtime/
│   ├── trading/
│   └── ui/
│
├── src/
│   ...
│
└── docs/
```

But **do not immediately perform this restructuring**.

First establish the domain boundaries inside the existing `src/`.

---

# 19. The ideal backend runtime

Instead of the current giant composition function conceptually becoming:

```text
startEngine()
```

I'd eventually reach:

```typescript
const runtime = await NemesisRuntime.bootstrap(config)

await runtime.start()
```

Internally:

```text
NemesisRuntime
│
├── MarketRuntime
├── AgentRuntime
├── StrategyRuntime
├── RiskRuntime
├── ExecutionRuntime
├── PositionRuntime
├── EventRuntime
├── PersistenceRuntime
└── ApiRuntime
```

The UI is **not part of `NemesisRuntime`**.

---

# 20. The final process model

```text
Docker / Kubernetes
│
├── nemesis-engine
│   ├── Binance streams
│   ├── market state
│   ├── agents
│   ├── strategies
│   ├── risk
│   ├── execution
│   ├── positions
│   └── reconciliation
│
├── nemesis-api
│   ├── REST
│   └── WebSocket
│
├── ollama
│
├── persistence
│
└── dashboard     ← OPTIONAL
```

For a single-machine deployment, `engine + api` can initially remain in one Node process. The **logical separation matters before physical microservice separation**.

---

# 21. I would also use the existing `skills/` and architecture documentation

The repo already contains:

```text
AGENTS.md
TRADING_AGENTS.md
skills/
docs/architecture.md
docs/REPOSITORY_MAP.md
```

according to the repository search.

This is useful because we can make the architectural rules explicit:

```text
Agent rules
Execution rules
Mode rules
Risk rules
Event rules
Frontend contract
```

---

# 22. What I'd keep exactly

These existing pieces are valuable:

```text
✓ Binance SDK integration
✓ MarketDataSupervisor
✓ Provider health
✓ Divergence guard
✓ PaperBroker
✓ LiveTradingGuard
✓ ExecutionRouter
✓ EventLog
✓ SnapshotStore
✓ REST API
✓ WebSocketGateway
✓ StrategyEngine
✓ MarketStateManager
✓ MTF State Engine
✓ Market Structure Engine
✓ SMC Engine
✓ Trade Intent Engine
✓ Ollama SDK
✓ AgentRuntime
✓ TradingAgentsPipeline
✓ Risk concepts
✓ Kill switch
✓ Prometheus metrics
✓ Telegram incidents
```

The README confirms most of these components directly.

---

# 23. What I'd change

```text
1. Make AgentRuntime the canonical AI execution kernel.
2. Make TradingAgentsPipeline a configurable pipeline/graph.
3. Introduce AgentRun + AgentEvent persistence.
4. Make shadow execution first-class.
5. Separate TradeIntent from Execution.
6. Make Risk Engine completely deterministic and authoritative.
7. Add canonical domain event schemas.
8. Make WebSocket event-driven rather than dashboard-specific.
9. Add snapshot + sequence-based resync.
10. Extract dashboard into an optional React application.
11. Make backend runnable without dashboard.
12. Make frontend control commands go through a command bus.
```

---

# 24. One thing I would NOT do

Do not replace this:

```text
PaperBroker
ExecutionRouter
LiveTradingGuard
Risk
EventLog
```

with a generic agentic framework.

That would be a regression.

Instead:

```text
             LLM / AGENT LAYER
                     │
             proposes intent
                     ↓
              DETERMINISTIC CORE
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
       Risk       Execution    Position
         │           │           │
         └───────────┼───────────┘
                     ▼
                Event Store
                     ▼
              REST + WebSocket
                     ▼
               React UI
```

That's the correct division of responsibility.

---

# 25. Final verdict

### `algo_scalper_api`

Excellent **trading-engine architecture**, but its current domain is Indian options and DhanHQ. It has strong risk, reconciliation and process separation, but would require significant domain extraction for crypto perpetuals.

### `paper-broker`

**Much better starting point for NEMESIS.**

It already has:

```text
Crypto Futures             ✓
Binance                    ✓
Paper                      ✓
Shadow                     ✓
Live                       ✓
Ollama SDK                 ✓
Agent Runtime              ✓
Multi-agent pipeline       ✓
Event sourcing             ✓
WebSocket                  ✓
REST                       ✓
Risk/execution abstraction ✓
Dashboard                  ✓
Headless execution         ✓
```

The evidence from the repository is unusually aligned with our target architecture.

## My recommendation

**Make `paper-broker` the canonical NEMESIS crypto-futures engine.**

Do **not** create a separate crypto backend.

Evolve it into:

```text
                    NEMESIS
                       │
             ┌─────────▼─────────┐
             │ Autonomous Engine  │
             └─────────┬─────────┘
                       │
      ┌────────────────┼─────────────────┐
      │                │                 │
   Market           Agents            Trading
      │                │                 │
      │          ┌─────┴─────┐           │
      │          │ Supervisor│           │
      │          └─────┬─────┘           │
      │                │                 │
      │        Specialist Agents         │
      │                │                 │
      └────────────────┼─────────────────┘
                       ▼
                  Signal/Intent
                       ▼
                  Risk Engine
                       ▼
                Execution Router
               /       |       \
            PAPER    SHADOW     LIVE
               \       |       /
                    Position
                    Manager
                       │
                   Event Store
                       │
                ┌──────┴──────┐
                ▼             ▼
             REST          WebSocket
                              │
                         OPTIONAL
                         React UI
```

**This repository can achieve the architecture we designed with far less surgery than `algo_scalper_api`.** The next step should be an exact **`paper-broker → NEMESIS` gap analysis at file/class level**, identifying what stays, what gets refactored, what gets added, and what should be removed so we don't duplicate agent runtimes.

# NEMESIS — Final Architecture Direction for `paper-broker`

After inspecting the existing `paper-broker` repository, the conclusion is straightforward:

> **`paper-broker` is already a strong foundation for the autonomous crypto-perpetual trading system we designed.**

It already combines live Binance futures data, paper/shadow/live execution modes, an Ollama-powered agent runtime, multiple AI-agent concepts, event persistence, REST, WebSocket streaming, a strategy engine, risk/execution controls, and a built-in dashboard.

The objective should therefore be to **evolve `paper-broker` into a headless NEMESIS autonomous trading engine**, not build a second backend around it.

---

# 1. What `paper-broker` already provides

The existing system already contains the majority of the required primitives:

```text id="9q6l8u"
Binance Futures
      │
      ▼
Market Data
      │
      ├── order book
      ├── trades
      ├── klines
      ├── funding
      └── market state
             │
             ▼
        Strategy Engine
             │
             ▼
       AI / Agent Layer
             │
             ▼
       Signal / Intent
             │
             ▼
       Risk / Execution
             │
             ▼
        Paper Broker
```

The repository also has:

```text
Paper
Shadow
Live

Ollama
Agent Runtime
Trading Agents
Event Log
Snapshot Store
REST API
WebSocket
Dashboard
CLI
Docker
Metrics
Alerts
```

These capabilities are already reflected in the repository documentation and implementation.

---

# 2. The target architecture

The final architecture should be:

```text id="7kt3es"
                         NEMESIS
                            │
                 ┌──────────▼──────────┐
                 │  AUTONOMOUS ENGINE  │
                 └──────────┬──────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
     MARKET              AGENTS              TRADING
     RUNTIME             RUNTIME              RUNTIME
        │                   │                   │
        │             ┌─────▼─────┐            │
        │             │ SUPERVISOR│            │
        │             └─────┬─────┘            │
        │                   │                   │
        │        ┌──────────┼──────────┐        │
        │        ▼          ▼          ▼        │
        │    Structure   Order Flow   Funding   │
        │       Agent       Agent       Agent    │
        │        └──────────┼──────────┘        │
        │                   ▼                   │
        │             Signal Fusion             │
        │                   │                   │
        │            ┌──────┴──────┐             │
        │            ▼             ▼             │
        │          LONG          SHORT           │
        │            Agent         Agent          │
        │             └─────┬─────┘              │
        │                   ▼                    │
        │                TRADE JUDGE             │
        │                   │                    │
        │                   ▼                    │
        │               RISK ENGINE              │
        │                   │                    │
        │             ┌─────┴─────┐              │
        │             ▼           ▼              │
        │          REJECT        PASS             │
        │             │           │              │
        │          NO_TRADE       ▼              │
        │                EXECUTION ROUTER        │
        │                 /    |    \             │
        │              PAPER SHADOW LIVE          │
        │                 \    |    /             │
        │                 POSITION                │
        │                 MANAGER                 │
        └────────────────────┬──────────────────┘
                             ▼
                         EVENT STORE
                             │
                    ┌────────┴────────┐
                    ▼                 ▼
                 REST API        WebSocket API
                    │                 │
                    └────────┬────────┘
                             ▼
                       OPTIONAL UI
```

The crucial point is that **the UI is outside the autonomous engine**.

---

# 3. Headless operation becomes a first-class property

The backend must be able to operate indefinitely without the dashboard.

```text id="q6o7xk"
Dashboard
    OFF
     │
     X
     │
     ▼
NEMESIS ENGINE
     │
     ├── Binance streams
     ├── Market state
     ├── Agents
     ├── Strategies
     ├── Risk
     ├── Execution
     ├── Positions
     ├── Reconciliation
     └── Event persistence
```

The existing repository already supports running the engine independently and includes background Docker execution.

The final behavior should therefore be:

```text id="2r7f87"
Frontend OFF
    ↓
Engine continues

Frontend starts later
    ↓
Get current snapshot
    ↓
Connect WebSocket
    ↓
Resume live stream
```

No restart of the trading engine.

---

# 4. The existing `engine.ts` is the composition root

The current `engine.ts` constructs:

```text id="p4lnir"
BinanceClient
PaperBroker
MarketStateManager
KlineStore
StrategyEngine
AI pipeline
API
WebSocket
Scheduler
Telegram
```

and starts them from one runtime entry point.

That is acceptable as a **composition root**.

The problem is not `startEngine()` itself.

The problem is that the internal modules should become cleaner:

```text id="gof5is"
NemesisRuntime
│
├── MarketRuntime
├── AgentRuntime
├── StrategyRuntime
├── RiskRuntime
├── ExecutionRuntime
├── PositionRuntime
├── EventRuntime
├── PersistenceRuntime
└── ApiRuntime
```

Then:

```typescript id="pyfdwp"
const runtime = await NemesisRuntime.bootstrap(config)

await runtime.start()
```

becomes the clean public lifecycle.

---

# 5. Paper, Shadow and Live need explicit semantics

The repository already has:

```text
TRADING_MODE=paper|shadow|live
```

and `LiveTradingGuard` plus `ExecutionRouter`.

Keep that, but make the mode a first-class domain concept:

```typescript id="k8a4wp"
type TradingMode =
  | "paper"
  | "shadow"
  | "live";
```

### PAPER

```text id="cz5m6s"
Real market data
Real agents
Real decisions
Real risk
Simulated orders
Simulated fills
Simulated PnL
```

### SHADOW

```text id="0q4a8c"
Real market data
Real agents
Real decisions
Real risk
Real order intent
No exchange order
Record hypothetical execution
Compare expected vs actual market behavior
```

### LIVE

```text id="m19x6a"
Real market data
Real agents
Real decisions
Real risk
Real orders
Real positions
Exchange reconciliation
```

This should be enforced **below the agent layer**, not by the frontend.

---

# 6. Execution architecture

The existing PaperBroker should stay independent from the AI layer.

The correct flow is:

```text id="k0x1dc"
AI Agent
   ↓
Trade Intent
   ↓
Deterministic Risk
   ↓
Execution Router
   ↓
Execution Venue
```

With:

```text id="j6u3s9"
ExecutionVenue
│
├── PaperExecutionVenue
├── ShadowExecutionVenue
└── BinanceExecutionVenue
```

The current system already separates `PaperBroker`, strategy signals and execution infrastructure, which is the correct direction.

---

# 7. The AI layer should be unified

The repo already contains two valuable AI abstractions.

### `AgentRuntime`

It already provides:

```text id="k8v5m2"
AgentMode
AgentSkill
AgentTool
AgentMemorySnapshot
AgentRuntimeRunInput
AgentRuntimeTrace
```

and integrates directly with:

```text
@nemesis-oss/ollama-sdk
```

It also restricts execution tools and validates decisions by agent mode.

### `TradingAgentsPipeline`

It already implements:

```text id="h1dn2s"
Analyst
   ↓
Debate
   ↓
Trader
   ↓
Risk Team
   ↓
Fund Manager
```

through `TradingAgentsPipeline`.

---

# 8. The right move is to unify them

Do not maintain two unrelated AI architectures.

Make:

```text id="9e1i3z"
AgentRuntime
       │
       ├── Agent Registry
       ├── Skill Registry
       ├── Tool Registry
       ├── Context Builder
       ├── Memory
       ├── Decision Policy
       ├── Trace Recorder
       ├── Event Publisher
       └── Run Manager
```

Then every specialized agent runs through the same runtime.

---

# 9. Specialized agents

The agent registry can contain:

```text id="o3h6iv"
SupervisorAgent

Market Intelligence
├── StructureAgent
├── MomentumAgent
├── VolatilityAgent
├── OrderFlowAgent
├── FundingAgent
├── OpenInterestAgent
└── LiquidityAgent

Strategy
├── BreakoutAgent
├── TrendAgent
├── MeanReversionAgent
└── RegimeAgent

Decision
├── LongAgent
├── ShortAgent
└── TradeJudgeAgent

Operations
├── PositionManagerAgent
├── ExitAgent
└── PostTradeAgent
```

Not all of these need to be LLMs.

---

# 10. Critical rule: not everything should be an AI agent

Use three classes.

### Deterministic

```text id="5maeqk"
Risk
Position sizing
Margin
Liquidation
PnL
Order validation
Exposure
Execution constraints
```

### Analytical models

```text id="4gws86"
Regime
Volatility
Order flow
Anomaly detection
Signal scoring
```

### LLM agents

```text id="wxz8do"
Supervisor
Market analyst
Trade judge
Research
Post-trade analyst
```

The LLM reasons over facts.

It does not become the authority for arithmetic or hard risk constraints.

---

# 11. The pipeline should become a graph

The current pipeline is sequential:

```text id="zrip2p"
Analyst
 ↓
Debate
 ↓
Trader
 ↓
Risk
 ↓
Fund Manager
```

Keep it as one **pipeline implementation**, but make the orchestration layer capable of DAGs.

Example:

```text id="7s6z5i"
                        SUPERVISOR
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
          STRUCTURE       ORDER FLOW      FUNDING
              │              │              │
              ▼              ▼              ▼
          VOLATILITY       LIQUIDITY       OI
              └──────────────┼──────────────┘
                             ▼
                       SIGNAL FUSION
                             │
                    ┌────────┴────────┐
                    ▼                 ▼
                  LONG              SHORT
                    └────────┬────────┘
                             ▼
                         TRADE JUDGE
                             ▼
                         RISK ENGINE
                             ▼
                       EXECUTION ROUTER
```

Different strategies can use different graphs.

---

# 12. Agent Run is a first-class entity

Introduce a persistent run model:

```text id="y5z0vj"
AgentRun
├── id
├── pipeline_id
├── agent_id
├── mode
├── symbol
├── strategy_id
├── started_at
├── completed_at
├── status
├── decision
├── confidence
└── trace_id
```

Then:

```text id="bpm93c"
AgentRun
│
├── Observation
├── ToolCall
├── ToolResult
├── AgentHandoff
├── Decision
├── RiskEvaluation
├── OrderIntent
└── Outcome
```

This is the foundation of the Agent Control Center.

---

# 13. Your event log becomes the agent observability backbone

The repository already persists order, fill, position, funding and system events through an event log / JSONL stream and relational projections.

Extend the event taxonomy:

```text id="q5e0uh"
system.started
system.stopped
system.health

agent.run.started
agent.activated
agent.observation
agent.tool.started
agent.tool.completed
agent.tool.failed
agent.handoff
agent.decision
agent.completed
agent.failed

strategy.signal.created
strategy.signal.rejected

risk.check.started
risk.check.completed
risk.breach

execution.intent.created
execution.submitted
execution.filled
execution.rejected

position.opened
position.updated
position.closed

trade.no_trade
incident.created
```

Now the UI is simply a **projection of the event stream**.

---

# 14. WebSocket architecture

The existing system already exposes:

```text
ws://localhost:8080/ws
```

and streams market/order/position events.

Keep the WebSocket.

But normalize it into a canonical protocol.

```json id="u9l4g9"
{
  "v": 1,
  "type": "event",
  "event": "agent.tool.completed",
  "eventId": "evt_123",
  "sequence": 9182,
  "timestamp": 1787489000123,
  "traceId": "trace_abc",
  "runId": "run_123",
  "agentId": "order-flow",
  "mode": "shadow",
  "symbol": "BTCUSDT",
  "payload": {}
}
```

---

# 15. Channels

```text id="35tjqz"
system.*
market.*
strategy.*
agent.*
risk.*
execution.*
order.*
position.*
portfolio.*
incident.*
```

For example:

```text id="5ezj8x"
agent.run.started
agent.observation
agent.tool.started
agent.tool.completed
agent.handoff
agent.decision
agent.run.completed
```

This is what the React dashboard subscribes to.

---

# 16. REST and WebSocket have different jobs

### REST

```text id="ba68bp"
Initial state
Historical runs
Historical events
Positions
Orders
Strategies
Agent definitions
Research
Configuration
```

### WebSocket

```text id="0qkwcf"
Live market updates
Live agent events
Risk events
Orders
Positions
Execution events
System health
```

The frontend should never need to reconstruct state solely from WebSocket messages.

---

# 17. Add snapshot + sequence synchronization

On connection:

```text id="s9jcx7"
Frontend
   ↓
GET /api/v1/runtime/snapshot
   ↓
Current state
   ↓
Connect WebSocket
   ↓
Subscribe
```

Every event gets:

```text id="qg8k4u"
sequence
```

If:

```text id="2q7p0a"
100
101
104
```

appears, the frontend knows:

```text
102–103 missing
```

and asks for a resync.

This matters for a serious trading system.

---

# 18. The frontend becomes a control plane

```text id="9pc4i3"
                  NEMESIS ENGINE
                        │
             ┌──────────┴──────────┐
             │                     │
          REST API             WebSocket
             │                     │
             └──────────┬──────────┘
                        │
                   React UI
```

The React application can:

```text id="r0fgtb"
OBSERVE
INSPECT
REPLAY
CONFIGURE
PAUSE
RESUME
SAFE MODE
CLOSE POSITION
DISABLE AGENT
```

But the backend remains authoritative.

---

# 19. Commands should go through one command layer

Example:

```text id="0wk4jp"
React
 ↓
POST /commands/agent/pause
 ↓
Command Handler
 ↓
Authorization
 ↓
Validation
 ↓
Agent Supervisor
 ↓
State change
 ↓
Event emitted
 ↓
All connected clients update
```

The same command can later be called from:

```text id="c8k8p2"
CLI
Automation
Mobile
Admin API
React
```

without duplicating business logic.

---

# 20. The dashboard should become an optional separate application

The current repository already contains a real-time dashboard.

For NEMESIS, make the architecture:

```text id="ckj07x"
paper-broker/
├── src/
│   └── autonomous engine
│
├── dashboard/
│   └── React application
│
└── packages/
    └── contracts
```

The backend must remain fully functional when:

```text
dashboard/
```

is not running.

---

# 21. Final frontend structure

```text id="z0t4wa"
NEMESIS AI

MAIN
├── Dashboard
├── Markets
├── Trading
├── Agent
├── Research
└── Risk

SYSTEM
├── Activity
└── Settings
```

Inside `Agent`:

```text id="j4c9c0"
Agent
├── Overview
├── Pipeline
├── Runs
└── Fleet
```

Inside a run:

```text id="q2yavm"
Run
├── Timeline
├── Decision Graph
├── Observations
├── Tool Calls
├── Context
├── Risk
├── Execution
├── Events
└── Replay
```

No giant sidebar with 20 pages.

---

# 22. Agent Pipeline UI

The most important visualization:

```text id="b2gk8m"
                     SUPERVISOR
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
     STRUCTURE         ORDER FLOW        FUNDING
       91%               84%              72%
         │                │                │
         └────────────────┼────────────────┘
                          ▼
                    SIGNAL FUSION
                          │
                 ┌────────┴────────┐
                 ▼                 ▼
               LONG              SHORT
                82%                27%
                 └────────┬────────┘
                          ▼
                      TRADE JUDGE
                          │
                          ▼
                      RISK ENGINE
                          │
                       APPROVED
                          │
                          ▼
                    EXECUTION
                          │
                          ▼
                  POSITION MANAGER
```

Every node can be clicked.

---

# 23. Agent Run Timeline

Example:

```text id="6qspv5"
09:20:12  MARKET EVENT
BTCUSDT breakout detected

09:20:12  SUPERVISOR
Started analysis run

09:20:13  STRUCTURE AGENT
Confirmed bullish BOS

09:20:13  ORDER FLOW AGENT
Requested taker-flow evidence

09:20:13  TOOL
market.takerFlow()

09:20:13  TOOL RESULT
delta +18,342

09:20:14  FUNDING AGENT
Neutral funding

09:20:14  SIGNAL FUSION
Long score 82%

09:20:15  TRADE JUDGE
LONG

09:20:15  RISK
APPROVED

09:20:16  EXECUTION
Intent created

09:20:16  PAPER
Order filled

09:20:16  POSITION
LONG BTCUSDT
```

This gives the user the exact autonomous workflow.

---

# 24. Don't display private chain-of-thought

Display:

```text id="rj08zw"
Decision
Confidence
Evidence
Counter-evidence
Risk factors
Rejected alternatives
Invalidation
Next action
```

Example:

```text id="j8q9qk"
LONG BTCUSDT

Confidence
82%

Supporting evidence
✓ Bullish 15m structure
✓ Breakout confirmed
✓ Positive taker flow
✓ OI expansion

Counter-evidence
△ Funding slightly elevated

Invalidation
15m close below 67,420

Expected R:R
2.4R
```

This is the correct agent UX.

---

# 25. The system should treat `NO_TRADE` as a successful outcome

Every analysis cycle ends as:

```text
TRADE
```

or:

```text
NO_TRADE
```

Example:

```text id="9it0jy"
BTCUSDT

NO TRADE

Structure         PASS
Momentum          PASS
Volume            FAIL
Risk / Reward     FAIL

R:R
1.2

Minimum
2.0

Decision
WAIT
```

This is critical for evaluating whether the agent actually behaves intelligently.

---

# 26. Agent-to-agent handoffs should be visible

Example:

```text id="9t9u7o"
STRUCTURE AGENT
      │
      │ STRUCTURE_CONFIRMED
      ▼
SIGNAL FUSION
      │
      │ REQUEST_VOLUME_CONFIRMATION
      ▼
VOLUME AGENT
      │
      │ VOLUME_CONFIRMED
      ▼
SIGNAL FUSION
      │
      │ REQUEST_LIQUIDITY_CHECK
      ▼
LIQUIDITY AGENT
      │
      │ SWEEP_DETECTED
      ▼
TRADE JUDGE
```

This is what makes the system look and behave like an actual multi-agent system rather than one LLM generating a paragraph.

---

# 27. The deterministic core stays untouched

This architecture preserves the safest boundary:

```text id="xbr7mj"
                 LLM / AGENTS
                      │
                 Trade Intent
                      │
                      ▼
              DETERMINISTIC CORE
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
       Risk       Execution      Position
        │             │             │
        └─────────────┼─────────────┘
                      ▼
                 Event Store
                      ▼
                REST / WebSocket
                      ▼
                   React UI
```

The LLM cannot:

```text
❌ bypass risk
❌ submit arbitrary exchange orders
❌ calculate authoritative account state
❌ override liquidation protection
❌ fabricate market facts
```

The existing `AgentRuntime` already has several of these restrictions; we should preserve and strengthen them.

---

# 28. Recommended final repository direction

I would evolve the existing repository toward:

```text id="zslx2x"
paper-broker/
│
├── src/
│   ├── runtime/
│   │   ├── NemesisRuntime.ts
│   │   ├── Supervisor.ts
│   │   └── lifecycle/
│   │
│   ├── market/
│   │
│   ├── agents/
│   │   ├── AgentRuntime.ts
│   │   ├── AgentRegistry.ts
│   │   ├── SupervisorAgent.ts
│   │   ├── StructureAgent.ts
│   │   ├── OrderFlowAgent.ts
│   │   ├── FundingAgent.ts
│   │   ├── LongAgent.ts
│   │   ├── ShortAgent.ts
│   │   └── TradeJudgeAgent.ts
│   │
│   ├── pipelines/
│   │   ├── AgentPipeline.ts
│   │   └── PipelineRegistry.ts
│   │
│   ├── trading/
│   │   ├── TradeIntent.ts
│   │   ├── PositionManager.ts
│   │   └── ExitManager.ts
│   │
│   ├── risk/
│   │
│   ├── execution/
│   │   ├── ExecutionRouter.ts
│   │   ├── PaperExecution.ts
│   │   ├── ShadowExecution.ts
│   │   └── BinanceExecution.ts
│   │
│   ├── events/
│   │   ├── EventBus.ts
│   │   ├── EventTypes.ts
│   │   ├── EventStore.ts
│   │   └── projections/
│   │
│   ├── persistence/
│   │
│   └── api/
│       ├── rest/
│       └── websocket/
│
├── dashboard/
│
├── packages/
│   └── contracts/
│
└── docs/
```

This is a target structure, not a recommendation to mechanically move everything immediately.

---

# 29. What should remain unchanged

These are already valuable and should be preserved:

```text id="y5r4u9"
✓ Binance SDK
✓ Binance market streams
✓ MarketStateManager
✓ KlineStore
✓ MTF state
✓ Market Structure Engine
✓ SMC Engine
✓ Setup Engine
✓ Execution Plan Engine
✓ Trade Intent Engine
✓ StrategyEngine
✓ PaperBroker
✓ ExecutionRouter
✓ LiveTradingGuard
✓ EventLog
✓ SnapshotStore
✓ Scheduler
✓ REST API
✓ WebSocket Gateway
✓ Ollama SDK
✓ AgentRuntime
✓ TradingAgentsPipeline
✓ Kill switch
✓ Prometheus metrics
✓ Telegram incident pipeline
```

The current repository already wires these capabilities together.

---

# 30. What should be changed

The major architectural work is:

```text id="m74s92"
1. Unify AgentRuntime + TradingAgentsPipeline.

2. Introduce first-class AgentRun.

3. Introduce canonical AgentEvent schemas.

4. Turn the pipeline into a configurable DAG.

5. Make execution mode a first-class domain concept.

6. Implement ShadowExecution explicitly.

7. Separate TradeIntent from actual execution.

8. Make Risk the final deterministic gate.

9. Make event publishing independent of UI.

10. Add WebSocket snapshot + sequence resync.

11. Extract the dashboard into an optional React application.

12. Introduce a backend command bus for UI/CLI control.

13. Make the engine fully headless.

14. Add replayable agent traces.

15. Add agent-to-agent handoff events.
```

---

# 31. Final architecture

```text id="f4y1p8"
                         ┌──────────────────────┐
                         │     NEMESIS ENGINE   │
                         │                      │
                         │  Always Running      │
                         └──────────┬───────────┘
                                    │
           ┌────────────────────────┼────────────────────────┐
           │                        │                        │
           ▼                        ▼                        ▼
      Market Runtime          Agent Runtime            Trading Runtime
           │                        │                        │
           │                 ┌──────▼──────┐                 │
           │                 │  SUPERVISOR │                 │
           │                 └──────┬──────┘                 │
           │                        │                        │
           │            ┌───────────┼───────────┐            │
           │            ▼           ▼           ▼            │
           │       Structure    OrderFlow     Funding         │
           │          Agent        Agent        Agent          │
           │            └───────────┼───────────┘            │
           │                        ▼                        │
           │                   Fusion Agent                  │
           │                        │                        │
           │                ┌───────┴───────┐                │
           │                ▼               ▼                │
           │             Long Agent      Short Agent         │
           │                └───────┬───────┘                │
           │                        ▼                        │
           │                    Trade Judge                   │
           │                        │                        │
           │                        ▼                        │
           │                   RISK ENGINE                   │
           │                        │                        │
           │                 ┌──────┴──────┐                 │
           │                 ▼             ▼                 │
           │              NO_TRADE       APPROVED             │
           │                                │                 │
           │                                ▼                 │
           │                        EXECUTION ROUTER          │
           │                         /    |    \              │
           │                      PAPER SHADOW LIVE           │
           │                         \    |    /              │
           │                           ▼                      │
           │                      POSITION MANAGER            │
           │                                                   │
           └──────────────────────┬────────────────────────────┘
                                  ▼
                              EVENT STORE
                                  │
                         ┌────────┴─────────┐
                         ▼                  ▼
                     REST API          WebSocket API
                         │                  │
                         └────────┬─────────┘
                                  ▼
                            OPTIONAL CLIENTS
                         ┌────────┼────────┐
                         ▼        ▼        ▼
                       React     CLI      Mobile
```

## The final principle

**`paper-broker` becomes the autonomous system.**

The dashboard is **not the system**.

Ollama is **not the system**.

The LLM agents are **not the system**.

The exchange is **not the system**.

The core system is:

```text
Market State
+
Agent Runtime
+
Strategy Runtime
+
Risk
+
Execution
+
Position Management
+
Event Store
+
Recovery
```

Everything else attaches to it.

That gives you the architecture you were aiming for:

> **A continuously running, headless, event-driven autonomous crypto-perpetual trading engine that can operate in paper, shadow, or live mode, use multiple cooperating AI agents powered by the existing Ollama SDK, persist every decision and execution event, and expose an optional React control/observability console over REST + WebSocket.**

Yes. For this architecture, the clean rule is:

> **REST = commands, snapshots, history, configuration and queries. WebSocket = live state, events, agent activity and streaming updates.**

Do **not** make the frontend poll REST for live trading/agent state.

# 1. Overall FE ↔ Backend architecture

```text
                         NEMESIS BACKEND
                              │
              ┌───────────────┴────────────────┐
              │                                │
          REST API                         WebSocket
        request/response                    streams
              │                                │
              │                                │
     ┌────────▼────────┐             ┌─────────▼─────────┐
     │   FRONTEND      │             │   EVENT STREAM    │
     │                 │             │                   │
     │ Initial state   │             │ Market events     │
     │ Historical data │             │ Agent events      │
     │ Commands        │             │ Pipeline events   │
     │ Configuration   │             │ Risk events       │
     │ Queries         │             │ Execution events  │
     └─────────────────┘             │ Position events   │
                                     │ System events     │
                                     └───────────────────┘
```

The frontend should use **both**, but for fundamentally different purposes.

---

# 2. REST API — what belongs here

REST should be **request → response**.

Use it when the frontend asks:

> "Give me something."

or:

> "Perform this command."

## A. Runtime snapshot

```http
GET /api/v1/runtime
```

Returns:

```json
{
  "status": "running",
  "mode": "shadow",
  "uptime": 86423,
  "startedAt": "...",
  "agents": {
    "active": 8,
    "healthy": 8,
    "failed": 0
  },
  "positions": 2,
  "openOrders": 3,
  "pnl": {
    "realized": 1240,
    "unrealized": 382
  }
}
```

This is the **initial dashboard snapshot**.

---

# 3. Health

```http
GET /api/v1/health
```

```json
{
  "status": "healthy",
  "engine": "healthy",
  "binance": "healthy",
  "ollama": "healthy",
  "database": "healthy",
  "eventStore": "healthy",
  "websocket": "healthy"
}
```

Also useful for deployment/Kubernetes.

---

# 4. System configuration

```http
GET /api/v1/config
```

Returns **safe/read-only configuration**.

For example:

```json
{
  "mode": "shadow",
  "risk": {
    "maxDailyLoss": 0.04,
    "maxPositionRisk": 0.01
  },
  "agents": {
    "maxConcurrentRuns": 8
  }
}
```

Sensitive credentials should obviously never be exposed.

---

# 5. Trading mode

```http
GET /api/v1/trading/mode
```

Response:

```json
{
  "mode": "shadow",
  "exchange": "binance",
  "account": "primary"
}
```

Changing mode is a **command**, therefore:

```http
POST /api/v1/trading/mode
```

```json
{
  "mode": "paper"
}
```

The backend validates whether the transition is allowed.

---

# 6. Positions

```http
GET /api/v1/positions
```

```http
GET /api/v1/positions/:id
```

```http
GET /api/v1/positions/:id/events
```

REST is appropriate because these are queries.

The **live updates** then come through WebSocket.

---

# 7. Orders

```http
GET /api/v1/orders
GET /api/v1/orders/:id
GET /api/v1/orders/:id/events
```

Filters:

```text
symbol
status
mode
side
date
strategy
agentRunId
```

Again:

```text
REST → historical/current snapshot
WS   → order.updated
```

---

# 8. Markets

Don't stream the entire Binance market through your REST API.

REST should provide:

```http
GET /api/v1/markets
GET /api/v1/markets/:symbol
GET /api/v1/markets/:symbol/candles
GET /api/v1/markets/:symbol/orderbook
GET /api/v1/markets/:symbol/funding
```

For example:

```http
GET /api/v1/markets/BTCUSDT
```

returns the current snapshot.

Then WebSocket handles subsequent changes.

---

# 9. Agent API

This is where REST becomes particularly useful.

## Agent registry

```http
GET /api/v1/agents
```

```json
{
  "agents": [
    {
      "id": "structure",
      "status": "running",
      "mode": "analyst"
    },
    {
      "id": "order-flow",
      "status": "running",
      "mode": "analyst"
    },
    {
      "id": "trade-judge",
      "status": "idle",
      "mode": "supervisor"
    }
  ]
}
```

---

# 10. Individual agent

```http
GET /api/v1/agents/:agentId
```

Example:

```http
GET /api/v1/agents/order-flow
```

Returns:

```json
{
  "id": "order-flow",
  "status": "running",
  "model": "qwen3.5",
  "skills": [
    "orderflow.analysis",
    "market.takerFlow"
  ],
  "activeRuns": 1,
  "totalRuns": 1423,
  "successRate": 0.91
}
```

---

# 11. Agent runs

This is critical.

```http
GET /api/v1/agent-runs
```

Filters:

```text
agent
symbol
strategy
mode
status
from
to
```

Individual run:

```http
GET /api/v1/agent-runs/:runId
```

This returns the **complete persisted result**.

---

# 12. Agent run events

```http
GET /api/v1/agent-runs/:runId/events
```

Useful for:

* opening an old run
* replay
* debugging
* audit
* research

Example:

```json
{
  "runId": "run_123",
  "events": [
    {
      "type": "agent.started",
      "timestamp": 123
    },
    {
      "type": "tool.completed",
      "timestamp": 124
    },
    {
      "type": "agent.decision",
      "timestamp": 125
    }
  ]
}
```

---

# 13. Agent commands

Commands should use REST initially.

```http
POST /api/v1/agents/:id/pause
POST /api/v1/agents/:id/resume
POST /api/v1/agents/:id/stop
POST /api/v1/agents/:id/restart
```

Example:

```http
POST /api/v1/agents/order-flow/pause
```

Backend:

```text
REST
 ↓
Command Handler
 ↓
Authorization
 ↓
Validation
 ↓
Agent Supervisor
 ↓
State change
 ↓
Event emitted
 ↓
WebSocket
```

The frontend should **not directly manipulate agent state through WebSocket messages**.

---

# 14. Pipelines

```http
GET /api/v1/pipelines
GET /api/v1/pipelines/:id
GET /api/v1/pipelines/:id/runs
```

For example:

```json
{
  "id": "crypto-futures-autonomous",
  "status": "running",
  "nodes": [
    "supervisor",
    "structure",
    "order-flow",
    "funding",
    "signal-fusion",
    "long",
    "short",
    "trade-judge",
    "risk",
    "execution"
  ]
}
```

---

# 15. Pipeline commands

```http
POST /api/v1/pipelines/:id/start
POST /api/v1/pipelines/:id/pause
POST /api/v1/pipelines/:id/resume
POST /api/v1/pipelines/:id/stop
```

Again:

```text
REST command
      ↓
Backend
      ↓
WebSocket event
```

---

# 16. Risk API

```http
GET /api/v1/risk
GET /api/v1/risk/exposure
GET /api/v1/risk/limits
GET /api/v1/risk/events
```

Emergency commands:

```http
POST /api/v1/risk/pause-trading
POST /api/v1/risk/resume-trading
POST /api/v1/risk/kill-switch
```

The kill switch must be backend-authoritative.

The UI is merely a control surface.

---

# 17. Strategies

```http
GET /api/v1/strategies
GET /api/v1/strategies/:id
GET /api/v1/strategies/:id/runs
GET /api/v1/strategies/:id/performance
```

Commands:

```http
POST /api/v1/strategies/:id/enable
POST /api/v1/strategies/:id/disable
```

---

# 18. Performance / analytics

REST is ideal for:

```http
GET /api/v1/performance
GET /api/v1/performance/pnl
GET /api/v1/performance/trades
GET /api/v1/performance/agents
GET /api/v1/performance/strategies
```

Because these are historical queries rather than streams.

---

# 19. Event history

```http
GET /api/v1/events
```

Filters:

```text
type
symbol
agent
runId
strategy
mode
from
to
```

This becomes your audit/debug interface.

---

# 20. Now the WebSocket side

This is where the architecture becomes interesting.

The WebSocket should carry **events**, not arbitrary API responses.

I'd use:

```text
ws://host/ws
```

with logical subscriptions.

---

# 21. WebSocket connection lifecycle

Frontend starts:

```text
1. GET /api/v1/runtime
2. GET /api/v1/positions
3. GET /api/v1/agents
4. GET /api/v1/pipelines
5. Connect WebSocket
6. Subscribe
```

Then:

```text
REST = baseline
WS   = continuous updates
```

---

# 22. Subscription model

Frontend sends:

```json
{
  "type": "subscribe",
  "channels": [
    "system",
    "agent",
    "risk",
    "execution",
    "orders",
    "positions"
  ]
}
```

For market data:

```json
{
  "type": "subscribe",
  "channels": [
    "market:BTCUSDT",
    "market:ETHUSDT"
  ]
}
```

---

# 23. System WebSocket events

```text
system.started
system.stopped
system.health.changed
system.mode.changed
system.degraded
system.recovered
system.incident
```

Example:

```json
{
  "type": "event",
  "event": "system.health.changed",
  "sequence": 18291,
  "payload": {
    "ollama": "degraded"
  }
}
```

---

# 24. Market WebSocket events

```text
market.tick
market.trade
market.orderbook
market.kline
market.funding
market.open_interest
market.liquidation
market.regime.changed
```

Example:

```json
{
  "event": "market.tick",
  "symbol": "BTCUSDT",
  "payload": {
    "price": 67842.5,
    "volume": 123.4
  }
}
```

### Important

Do **not** send every possible market tick to every browser.

Use subscriptions:

```text
market:BTCUSDT
market:ETHUSDT
```

and configurable aggregation/throttling.

---

# 25. Agent WebSocket events

This is the most important part of your UI.

```text
agent.run.started
agent.activated
agent.observation
agent.tool.started
agent.tool.completed
agent.tool.failed
agent.handoff
agent.decision
agent.completed
agent.failed
```

Example:

```json
{
  "event": "agent.tool.started",
  "runId": "run_123",
  "agentId": "order-flow",
  "tool": "market.takerFlow",
  "timestamp": 1787489000123
}
```

Then:

```json
{
  "event": "agent.tool.completed",
  "runId": "run_123",
  "agentId": "order-flow",
  "tool": "market.takerFlow",
  "durationMs": 43,
  "payload": {
    "delta": 18342
  }
}
```

---

# 26. Agent pipeline events

These drive the graphical agent pipeline.

```text
pipeline.started
pipeline.node.started
pipeline.node.completed
pipeline.edge.created
pipeline.handoff
pipeline.paused
pipeline.resumed
pipeline.completed
pipeline.failed
```

Frontend can therefore animate:

```text
SUPERVISOR
    │
    ├──────→ STRUCTURE
    │
    ├──────→ ORDER FLOW
    │
    └──────→ FUNDING
                │
                ▼
           SIGNAL FUSION
```

without knowing anything about the internal agent classes.

---

# 27. Decision events

```text
decision.created
decision.updated
decision.confirmed
decision.rejected
decision.invalidated
```

Example:

```json
{
  "event": "decision.created",
  "runId": "run_123",
  "symbol": "BTCUSDT",
  "decision": "LONG",
  "confidence": 0.82,
  "evidence": [
    "bullish_structure",
    "positive_taker_delta",
    "oi_expansion"
  ],
  "invalidation": {
    "price": 67420
  }
}
```

---

# 28. Risk WebSocket events

```text
risk.check.started
risk.check.completed
risk.warning
risk.breach
risk.trading.paused
risk.trading.resumed
risk.kill_switch
```

Example:

```json
{
  "event": "risk.check.completed",
  "runId": "run_123",
  "status": "approved",
  "risk": {
    "accountRisk": 0.008,
    "maxAllowed": 0.01
  }
}
```

---

# 29. Execution WebSocket events

```text
execution.intent.created
execution.validated
execution.rejected
execution.submitted
execution.accepted
execution.partially_filled
execution.filled
execution.cancelled
execution.failed
```

This lets the UI show:

```text
AI Decision
     ↓
Risk
     ↓
Order Intent
     ↓
Execution
     ↓
Fill
```

in real time.

---

# 30. Position WebSocket events

```text
position.opened
position.updated
position.reduced
position.increased
position.closed
position.liquidation.warning
position.liquidated
```

These update the live trading panel.

---

# 31. Portfolio WebSocket events

```text
portfolio.balance.changed
portfolio.equity.changed
portfolio.margin.changed
portfolio.pnl.changed
portfolio.drawdown.changed
portfolio.exposure.changed
```

The dashboard can therefore update:

```text
Equity
P&L
Margin
Exposure
Drawdown
```

without polling.

---

# 32. Incident events

```text
incident.created
incident.updated
incident.resolved
```

Examples:

```text
Ollama unavailable
Binance WebSocket disconnected
Risk breach
Agent failure
Order rejection
Data divergence
Database degraded
```

These should appear immediately in the UI.

---

# 33. What should NEVER be WebSocket-only

Do not make the frontend dependent on receiving every event since startup.

The frontend should always be able to recover using REST.

For example:

```text
WS disconnected
      ↓
Frontend reconnects
      ↓
GET /runtime
GET /positions
GET /agents
      ↓
Resume WebSocket
```

This is critical.

---

# 34. The complete split

| Requirement          | REST |    WebSocket   |
| -------------------- | :--: | :------------: |
| Runtime snapshot     |   ✓  |                |
| System health        |   ✓  | ✓ live changes |
| Current positions    |   ✓  |    ✓ updates   |
| Historical positions |   ✓  |                |
| Orders               |   ✓  |    ✓ updates   |
| Historical trades    |   ✓  |                |
| Market snapshot      |   ✓  |                |
| Live market          |      |        ✓       |
| Candles/history      |   ✓  |                |
| Agent registry       |   ✓  |                |
| Agent status         |   ✓  |        ✓       |
| Agent runs           |   ✓  |     ✓ live     |
| Agent history        |   ✓  |                |
| Tool-call history    |   ✓  |     ✓ live     |
| Agent handoffs       |      |        ✓       |
| Pipeline definition  |   ✓  |                |
| Pipeline execution   |   ✓  |        ✓       |
| Risk state           |   ✓  |        ✓       |
| Risk history         |   ✓  |                |
| Strategy config      |   ✓  |                |
| Strategy events      |      |        ✓       |
| Execution history    |   ✓  |                |
| Execution updates    |      |        ✓       |
| Portfolio history    |   ✓  |                |
| Portfolio updates    |      |        ✓       |
| Configuration        |   ✓  |                |
| Commands             |   ✓  |                |
| Notifications        |      |        ✓       |
| Incidents            |   ✓  |        ✓       |
| Replay               |   ✓  |                |
| Audit logs           |   ✓  |                |
| Dashboard control    |   ✓  |                |

---

# 35. One important distinction: commands vs events

I strongly recommend:

```text
REST
────
COMMANDS

GET
POST
PATCH
DELETE
```

while:

```text
WebSocket
──────────
EVENTS

something.happened
```

For example:

```text
POST /agents/order-flow/pause
```

causes:

```text
agent.paused
```

over WebSocket.

Not:

```text
WebSocket → pause agent
```

This keeps the architecture much easier to secure, audit and test.

---

# 36. Final FE architecture

```text
                       React Dashboard
                              │
              ┌───────────────┴───────────────┐
              │                               │
          REST Client                    WS Client
              │                               │
      ┌───────┴────────┐              ┌───────┴────────┐
      │                │              │                │
   Queries          Commands        Events         Streams
      │                │              │                │
      ▼                ▼              ▼                ▼
 Snapshots        Controls        Agent events     Market
 History          Pause/resume    Risk events      Positions
 Config           Kill switch     Order events     P&L
 Analytics        Mode changes    Pipeline events  Health
```

---

# 37. Backend architecture

```text
                    NEMESIS ENGINE
                          │
                    DOMAIN EVENTS
                          │
                    ┌─────▼─────┐
                    │ Event Bus  │
                    └─────┬─────┘
                          │
             ┌────────────┼────────────┐
             ▼            ▼            ▼
          EventStore   Projectors   WS Gateway
             │            │            │
             ▼            ▼            ▼
          History      Read Models   Frontend
             │            │
             └──────┬─────┘
                    ▼
                 REST API
                    │
                    ▼
                 Frontend
```

This is the architecture I'd implement.

## The single most important rule

```text
                 NEMESIS CORE
                     │
       ┌─────────────┴─────────────┐
       │                           │
    STATE/EVENTS                COMMANDS
       │                           │
       ▼                           ▼
  WebSocket                     REST
       │                           │
       ▼                           ▼
    Frontend                   Frontend
```

**REST tells the backend what the frontend wants and retrieves durable state.**

**WebSocket tells the frontend what the backend is doing right now.**

That separation gives you a genuinely **headless autonomous trading engine** where the React dashboard can disappear, reconnect later, recover state through REST, and continue receiving live agent/trading events through WebSocket.

Correct. **When the NEMESIS backend starts, the frontend is not required at all.**

The backend should be able to start and operate independently.

### Startup

```text
                    START NEMESIS
                         │
                         ▼
                 NEMESIS ENGINE
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   Binance WS        Agent Runtime     Event Store
        │                │                │
        ▼                ▼                ▼
   Market State       Ollama          Persistence
        │                │                │
        └────────────────┼────────────────┘
                         ▼
                 Strategy / Risk
                         │
                         ▼
                    Execution
```

At this point:

```text
React Dashboard     ❌ NOT REQUIRED
REST Client         ❌ NOT REQUIRED
WebSocket Client    ❌ NOT REQUIRED
Browser             ❌ NOT REQUIRED
```

The engine should simply run.

---

## What the backend itself starts

On startup, the backend initializes:

```text
1. Configuration
2. Persistence/Event Store
3. Binance connectivity
4. Market-data streams
5. Market-state engine
6. Strategy engine
7. Agent runtime
8. Ollama connection
9. Risk engine
10. Execution router
11. Position manager
12. Scheduler
13. REST API
14. WebSocket gateway
15. Health/metrics
```

The last two are **servers waiting for clients**.

They do not require a frontend client.

```text
NEMESIS
│
├── Trading Engine        ← REQUIRED
├── Agent Runtime         ← REQUIRED
├── Risk                  ← REQUIRED
├── Execution             ← REQUIRED
├── Persistence            ← REQUIRED
├── REST Server            ← available
└── WebSocket Server       ← available
          │
          └── waiting...
```

---

# Then you open the frontend

Later:

```text
                NEMESIS
                   │
          ┌────────┴────────┐
          │                 │
       REST API         WebSocket
          │                 │
          └────────┬────────┘
                   ▼
              React UI
```

The frontend first asks REST:

```text
GET /api/v1/runtime
GET /api/v1/positions
GET /api/v1/agents
GET /api/v1/pipelines
GET /api/v1/risk
```

This establishes the **current state**.

Then it connects WebSocket:

```text
WS /ws
```

and subscribes to:

```text
system.*
market.*
agent.*
pipeline.*
risk.*
execution.*
order.*
position.*
portfolio.*
incident.*
```

From that point:

```text
REST = "Where are we now?"
WS   = "What is happening now?"
```

---

# If the frontend crashes

Nothing important should happen to the trading engine.

```text
React
  X
  │
  │ disconnected
  ▼

NEMESIS
│
├── Binance ✓
├── Agents ✓
├── Risk ✓
├── Execution ✓
├── Positions ✓
├── Event Store ✓
└── Trading ✓
```

The backend continues.

---

# If the frontend reconnects 30 minutes later

It should **not** need to reconstruct 30 minutes of state from WebSocket events.

Instead:

```text
Frontend
   │
   ├── GET /runtime
   ├── GET /positions
   ├── GET /orders
   ├── GET /agents
   └── GET /risk
          │
          ▼
     Current snapshot
          │
          ▼
       WebSocket
          │
          ▼
     Live updates
```

If you implement sequence numbers, you can additionally detect missed events and request a replay/resync.

---

# Even better: three independent layers

I would make the conceptual architecture:

```text
┌─────────────────────────────────────────┐
│           NEMESIS AUTONOMOUS CORE       │
│                                         │
│ Market → Agents → Strategy → Risk       │
│                         → Execution     │
│                         → Positions     │
│                                         │
│             ALWAYS RUNNING              │
└────────────────────┬────────────────────┘
                     │
              ┌──────┴──────┐
              ▼             ▼
          REST API       WS Gateway
              │             │
              └──────┬──────┘
                     │
                OPTIONAL
                     │
              ┌──────▼──────┐
              │   React UI  │
              └─────────────┘
```

**REST and WebSocket servers themselves can start with the backend, but they don't depend on any connected frontend.**

That is the architecture you want for an autonomous trading system: **the UI is an observer/control plane, not a dependency of the trading engine.**

Exactly. When you start the frontend, **it attaches to the already-running NEMESIS backend**. It does not start, stop, or own the trading engine.

The sequence should be:

```text
┌─────────────────────────────────────────────┐
│              NEMESIS BACKEND                │
│                 already running             │
│                                             │
│ Binance → Market → Agents → Risk → Execution│
│                    │                        │
│              Event Store                    │
│                    │                        │
│        ┌───────────┴───────────┐            │
│        │                       │            │
│    REST API              WebSocket           │
└────────┼───────────────────────┼────────────┘
         │                       │
         │       FRONTEND STARTS │
         │                       │
         ▼                       ▼
      REST Client            WS Client
         │                       │
         └───────────┬───────────┘
                     ▼
                React UI
```

## 1. Frontend boots

React starts normally.

It first loads its own static application:

```text
Browser
  ↓
React
  ↓
Initialize API client
Initialize WebSocket client
Initialize application state
```

**Nothing happens to the trading engine.**

---

## 2. Frontend discovers backend

The frontend calls:

```http
GET /api/v1/health
```

Then:

```http
GET /api/v1/runtime
```

It can verify:

```text
Engine:       RUNNING
Mode:         SHADOW
Binance:      CONNECTED
Ollama:       CONNECTED
Agents:       8 active
Risk:         NORMAL
Positions:    2
```

---

## 3. Frontend obtains the current snapshot

The frontend then hydrates its state:

```text
GET /api/v1/runtime
GET /api/v1/markets
GET /api/v1/positions
GET /api/v1/orders
GET /api/v1/agents
GET /api/v1/pipelines
GET /api/v1/risk
GET /api/v1/portfolio
```

You don't necessarily need seven separate HTTP requests. A better implementation can provide:

```http
GET /api/v1/dashboard/snapshot
```

returning the initial dashboard state in one response.

For example:

```json
{
  "runtime": {},
  "portfolio": {},
  "positions": [],
  "orders": [],
  "agents": [],
  "pipelines": [],
  "risk": {},
  "markets": []
}
```

That gives the frontend a **point-in-time snapshot**.

---

# 4. Then WebSocket connects

After the initial snapshot:

```text
React
  │
  │ WS /ws
  ▼
WebSocket Gateway
```

Frontend sends:

```json
{
  "type": "subscribe",
  "channels": [
    "system",
    "agent",
    "pipeline",
    "risk",
    "execution",
    "orders",
    "positions",
    "portfolio"
  ]
}
```

If the user opens BTCUSDT:

```json
{
  "type": "subscribe",
  "channels": [
    "market:BTCUSDT"
  ]
}
```

---

# 5. Now the dashboard becomes live

Suppose the backend is currently running this:

```text
SUPERVISOR
    ↓
STRUCTURE AGENT
    ↓
ORDER FLOW AGENT
    ↓
FUNDING AGENT
    ↓
SIGNAL FUSION
    ↓
TRADE JUDGE
    ↓
RISK
```

The frontend receives those events in real time.

For example:

```text
18:42:01  Agent Run Started
18:42:01  Structure Agent Started
18:42:02  Structure Agent Completed
18:42:02  Order Flow Agent Started
18:42:02  Tool Call: takerFlow()
18:42:03  Tool Completed
18:42:03  Funding Agent Completed
18:42:03  Signal Fusion
18:42:04  Trade Judge → LONG
18:42:04  Risk → APPROVED
18:42:04  Execution Intent Created
18:42:05  Order Filled
18:42:05  Position Updated
```

The UI simply renders these events.

---

# 6. The pipeline visualization changes automatically

The frontend initially sees:

```text
SUPERVISOR       IDLE
STRUCTURE        IDLE
ORDER FLOW       IDLE
FUNDING          IDLE
SIGNAL FUSION    IDLE
TRADE JUDGE      IDLE
RISK             IDLE
EXECUTION        IDLE
```

Then WebSocket events arrive:

```text
SUPERVISOR       RUNNING
STRUCTURE        RUNNING
```

UI:

```text
        SUPERVISOR
            │
            ▼
       STRUCTURE
       ● RUNNING
```

Then:

```text
structure.completed
```

Frontend changes it to:

```text
       STRUCTURE
       ✓ COMPLETED
```

Then:

```text
order-flow.started
```

and the UI moves execution focus:

```text
        SUPERVISOR
            │
            ▼
       STRUCTURE ✓
            │
            ▼
       ORDER FLOW
       ● RUNNING
```

The backend doesn't know anything about this animation.

It only publishes events.

---

# 7. The user opens an Agent Run

Suppose the UI receives:

```text
agent.run.started
```

with:

```json
{
  "runId": "run_8472"
}
```

The UI can immediately show:

```text
RUN #8472
BTCUSDT
SHADOW

Supervisor
  ↓
Structure
  ↓
Order Flow
  ↓
Funding
  ↓
Trade Judge
  ↓
Risk
```

And request detailed persisted information:

```http
GET /api/v1/agent-runs/run_8472
```

The WebSocket provides **live activity**.

REST provides **durable details**.

---

# 8. What happens if the frontend is opened after trading has already been happening?

This is where the architecture becomes important.

Imagine:

```text
10:00 Backend starts

10:15 Trade #1

10:30 Trade #2

10:45 Trade #3

11:00 Frontend starts
```

The frontend does **not** expect to receive the 10:15–11:00 events from WebSocket.

Instead:

```text
Frontend
   │
   ▼
GET /dashboard/snapshot
   │
   ▼
Current state at 11:00
```

Then:

```text
GET /agent-runs?from=10:00&to=11:00
```

if the user wants historical activity.

Then:

```text
WS connection
   │
   ▼
Live events from 11:00 onward
```

---

# 9. If the frontend disconnects

Suppose:

```text
11:00 frontend connected

11:15 Wi-Fi dies

11:30 Wi-Fi returns
```

Backend continues:

```text
11:15 → 11:30

Agents ✓
Risk ✓
Trading ✓
Execution ✓
Persistence ✓
```

Frontend reconnects:

```text
WS reconnect
   ↓
GET /dashboard/snapshot
   ↓
Current state
   ↓
Resume WS
```

If you implement event sequences:

```text
Frontend last received:
sequence = 18420

Backend:
current = 18467
```

Frontend can request:

```http
GET /api/v1/events?after=18420
```

Then resume WebSocket at:

```text
18468+
```

This makes the UI resilient to network interruptions.

---

# 10. If the frontend sends a command

This is the opposite direction.

Suppose the user clicks:

**Pause Autonomous Trading**

Frontend:

```http
POST /api/v1/runtime/pause
```

Backend:

```text
Command
   ↓
Authorization
   ↓
Validation
   ↓
Runtime
   ↓
Pause
   ↓
Event Store
   ↓
WebSocket
```

All connected clients receive:

```json
{
  "event": "system.trading.paused"
}
```

The UI changes to:

```text
┌──────────────────────────┐
│ TRADING PAUSED           │
│                          │
│ Autonomous execution OFF │
└──────────────────────────┘
```

The important part:

**The frontend does not directly change backend state.**

It requests a command.

---

# 11. Multiple frontends become possible

This architecture also means you can have:

```text
                 NEMESIS
                    │
          ┌─────────┼─────────┐
          │         │         │
        REST       WS        WS
          │         │         │
          ▼         ▼         ▼
       Desktop    Browser   Mobile
```

All clients see the same backend state.

If Desktop pauses trading:

```text
Desktop
   ↓
REST command
   ↓
NEMESIS
   ↓
system.trading.paused
   ↓
┌──────────┬──────────┐
▼          ▼          ▼
Desktop   Browser   Mobile
```

All UIs update.

---

# 12. The frontend should therefore have a very simple mental model

```text
                 BACKEND
                    │
          ┌─────────┴─────────┐
          │                   │
       REST API           WebSocket
          │                   │
          ▼                   ▼
     "Give me state"     "Tell me changes"
          │                   │
          └─────────┬─────────┘
                    ▼
                  UI
```

### REST

Use for:

* Initial state
* Historical data
* Queries
* Analytics
* Configuration
* Agent details
* Run details
* Replay
* Commands

### WebSocket

Use for:

* Live market
* Agent activity
* Tool calls
* Pipeline execution
* Decisions
* Risk changes
* Orders
* Fills
* Positions
* P&L
* Incidents
* System status

---

# 13. Final lifecycle

This is the complete lifecycle I would implement:

```text
                    SYSTEM START
                         │
                         ▼
                  NEMESIS ENGINE
                         │
             ┌───────────┴───────────┐
             │                       │
        Trading Core             API Layer
             │                       │
             │                ┌──────┴──────┐
             │                │             │
             │              REST           WS
             │                │             │
             ▼                │             │
       AUTONOMOUS              │             │
        TRADING                │             │
             │                 │             │
             ▼                 │             │
       EVENT STORE             │             │
                               │             │
                         FRONTEND STARTS     │
                               │             │
                               ▼             │
                       Health / Snapshot     │
                               │             │
                               ▼             │
                         Connect WS ─────────┘
                               │
                               ▼
                         Subscribe
                               │
                               ▼
                       LIVE DASHBOARD
                               │
                  ┌────────────┼────────────┐
                  ▼            ▼            ▼
               Observe      Analyze       Control
                  │            │            │
                  └────────────┼────────────┘
                               ▼
                         NEMESIS CORE
```

**So starting the frontend is simply attaching an observability/control client to an already autonomous system. It should never be a prerequisite for the system to trade.**
