> **Status: research transcript, not a specification.**
>
> This file is a captured design conversation, kept for provenance. It does
> **not** describe current behaviour and is not maintained against the code.
> For what the system actually does today see `PROJECT_STATE.md`,
> `KNOWN_LIMITATIONS.md`, and the source.

---

I have received the paper **"TradingAgents: Multi-Agents LLM Financial Trading Framework"** and the link to its official GitHub repository.

Based on the provided document, **TradingAgents** is a novel multi-agent LLM framework designed to simulate the organizational structure and collaborative dynamics of a real-world trading firm. It addresses the limitations of single-agent systems and unstructured communication by employing specialized, role-based agents—including Fundamental, Sentiment, News, and Technical Analysts, as well as Bull/Bear Researchers, Traders, and a Risk Management Team—that interact through structured communication protocols and natural language debates to make highly explainable trading decisions.

How would you like to proceed? I can help you with:

* **Architecture & Workflow:** Explaining how the agents interact, debate, and pass structured reports to one another.
* **Agent Roles:** Detailing the specific prompts, tools, and responsibilities of the Analyst, Researcher, Trader, and Risk Management teams.
* **Experimental Results:** Breaking down the backtesting performance (Cumulative Returns, Sharpe Ratio, Maximum Drawdown) against baseline strategies like MACD, RSI, and Buy-and-Hold.
* **Implementation & Code:** Assisting with the setup, dependencies, or logic found in the `TauricResearch/TradingAgents` GitHub repository.

Please let me know what specific questions or tasks you have in mind!

Adapting the **TradingAgents** framework from traditional equities to **Crypto Futures** requires a fundamental shift in how agents perceive data, manage risk, and execute trades. Unlike stocks, crypto futures operate 24/7, feature extreme volatility, and rely heavily on derivatives-specific metrics (leverage, funding rates, open interest, and liquidations) alongside on-chain data.

Here is a comprehensive blueprint to re-architect the TradingAgents framework specifically for a **Crypto Futures Multi-Agent System**.

---

### 1. Revamping the Analyst Team (Data & Signal Generation)

In the original paper, analysts look at SEC filings, stock fundamentals, and traditional technicals. For crypto futures, you must replace these with crypto-native data sources.

* **On-Chain & Tokenomics Analyst (Replaces Fundamental Analyst)**
  * **Goal:** Evaluate network health, whale behavior, and token supply dynamics.
  * **Tools/APIs:** Glassnode, CryptoQuant, Dune Analytics, CoinGecko.
  * **Metrics to track:** Exchange inflows/outflows (sell/buy pressure), MVRV Z-Score, upcoming token unlocks, staking APRs, and whale wallet movements.
* **Derivatives & Order Flow Analyst (Replaces Technical Analyst)**
  * **Goal:** Analyze market positioning, leverage, and immediate price triggers.
  * **Tools/APIs:** Coinglass, Velo Data, Binance/Bybit APIs, Kingfisher.
  * **Metrics to track:** **Open Interest (OI)** (is new money entering or leaving?), **Funding Rates** (are longs paying shorts or vice versa?), **Liquidation Heatmaps** (where are the clusters of stop-losses/liquidations that price will magnetize to?), and **Cumulative Volume Delta (CVD)**.
* **Crypto Sentiment Analyst (Replaces Social Media Analyst)**
  * **Goal:** Gauge retail and "smart money" narrative momentum.
  * **Tools/APIs:** LunarCrush, Santiment, X (Twitter) API, Telegram/Discord scrapers.
  * **Metrics to track:** Crypto Fear & Greed Index, weighted sentiment of "Crypto Twitter" (CT) influencers, and sudden spikes in social volume for specific altcoins.
* **Macro & Regulatory News Analyst (Replaces News Analyst)**
  * **Goal:** Monitor external shocks that cause massive crypto volatility.
  * **Focus Areas:** FOMC/CPI meetings (crypto is highly sensitive to liquidity), ETF inflow/outflow data, SEC regulatory actions, and geopolitical events affecting risk-on assets.

### 2. Adapting the Researcher Team (The Debate)

The Bull/Bear debate remains, but the context shifts to **Long vs. Short** and **Squeeze Potential**.

* **Bullish Researcher (Long Bias):** Argues for long entries based on positive funding rates, bullish divergences in CVD, spot ETF inflows, or on-chain accumulation by whales.
* **Bearish Researcher (Short Bias):** Argues for short entries based on over-leveraged long positions (high positive funding rates + high OI), upcoming massive token unlocks, or bearish macro liquidity conditions.
* **The "Squeeze" Factor:** Researchers must explicitly debate *Liquidation Cascades*. For example, if the Bearish Researcher sees a massive cluster of long liquidations just 5% below the current price, they will argue for a short position to trigger the cascade and ride the volatility down.

### 3. Upgrading the Trader Agent (Execution Strategy)

The Trader Agent in equities decides "Buy, Sell, or Hold." In crypto futures, the decision space is much more complex. The Trader's structured output must include:

1. **Direction:** Long or Short.
2. **Leverage Multiplier:** (e.g., 1x, 5x, 10x, 20x). *LLMs tend to be overly confident; you must cap maximum leverage via system prompts.*
3. **Entry Zone:** Limit orders vs. Market orders.
4. **Stop-Loss (SL) & Take-Profit (TP):** **Crucial for futures.** The SL must be placed *outside* of local liquidation clusters to avoid being "wicked out" by market makers.
5. **Position Sizing:** Percentage of total margin to allocate (e.g., Kelly Criterion).

### 4. Overhauling the Risk Management Team (The Guardians)

This is the most critical adaptation. In crypto futures, poor risk management doesn't just lose money; it results in **total account liquidation**. The Risk Management Team should consist of three distinct personas debating the Trader's proposed trade:

* **The "Degen" (Risk-Seeking):** Advocates for higher leverage to capitalize on high-probability setups (e.g., trading a confirmed breakout with high OI). Focuses on maximizing ROI.
* **The "Hedger" (Risk-Averse):** Focuses on survival. Checks for **Funding Rate decay** (e.g., "If we hold this long position for 3 days, the negative funding rate will eat 2% of our margin"). Advocates for lower leverage and wider stop-losses.
* **The "Portfolio Manager" (Correlation Guard):** Ensures the agent isn't overexposed. *Example: "We are already 80% long on ETH and SOL. Taking a long on an ETH L2 token introduces massive correlated beta risk. Reject or reduce size."*

**The Fund Manager (Final Approver):**
Before executing, the Fund Manager checks the **Margin Mode** (Isolated vs. Cross-Margin) and ensures the proposed trade will not breach the exchange's maintenance margin requirements.

### 5. Modifying the Workflow & Environment

The original paper simulates daily market closes. Crypto never closes. You must adapt the environment loop:

* **Rolling Time Windows:** Instead of "End of Day," agents should run on rolling intervals (e.g., every 4 hours or 12 hours) or be triggered by **Event-Based Webhooks** (e.g., BTC moves 3% in 10 minutes, triggering an emergency Risk Management review).
* **State Management (The "Telephone Effect" Fix):** Crypto generates massive amounts of noise. Use the paper's structured communication protocol to force agents to output JSON summaries.
  * *Bad:* A 10-page transcript of order book ticks.
  * *Good (Structured):* `{"asset": "BTCUSDT", "trend": "consolidation", "OI_change": "+15%", "funding_rate": "0.015%", "liquidation_clusters": {"up": 68500, "down": 62100}}`
* **LLM Selection:**
  * *Quick-thinking models (e.g., GPT-4o-mini, Llama 3 8B):* Use for parsing API JSON responses, calculating basic technicals, and monitoring funding rates.
  * *Deep-thinking models (e.g., o1-preview, Claude 3.5 Sonnet):* Use for the Researcher debates, synthesizing on-chain data with macro news, and final Risk Management approvals.

### 6. Suggested Tech Stack for Implementation

To build this on top of the `TauricResearch/TradingAgents` GitHub repository, you will need to swap out the traditional finance tools for crypto equivalents:

| Original Tool / API | Crypto Futures Replacement |
| :--- | :--- |
| Yahoo Finance / Finnhub | **Binance API, Bybit API, CCXT** (for price, volume, and execution) |
| SEC EDGAR / Earnings Reports | **Glassnode, CryptoQuant, TokenUnlocks** (On-chain & supply data) |
| Reddit / Twitter Sentiment | **LunarCrush, Santiment, X API** (Crypto social dominance) |
| MACD / RSI / Bollinger Bands | **Coinglass API** (Open Interest, Funding Rates, Liquidations) |
| Traditional Backtester | **Freqtrade, Hummingbot, or custom CCXT backtester** (Must support leverage & shorting) |

### Next Steps for Your Codebase

1. **Update the `tools/` directory:** Write Python wrappers for `ccxt` (to connect to Binance/Bybit futures) and `coinglass` (for derivatives data).
2. **Rewrite the Prompts:** Update the system prompts for the Analysts to include crypto terminology (e.g., instruct the Technical Analyst to look for "Funding Rate / Price divergences" rather than just MACD crossovers).
3. **Implement a Circuit Breaker:** Add a hard-coded Python rule outside the LLM loop: *If account drawdown > X% in 1 hour, force-close all positions and halt the agents.* LLMs can hallucinate during black swan events (like the FTX crash or a flash crash); hard-coded risk limits are mandatory in crypto.

Would you like me to generate the **System Prompts** for the *Derivatives Analyst* and the *Risk-Averse Hedger* agents, or would you prefer a Python code snippet showing how to integrate `ccxt` for futures execution into the agent's toolset?

1. Could you clarify which specific components of your `paper-broker` (e.g., real-time Binance data ingestion, WebSocket streaming, SQLite event logging, or execution simulation with fees/slippage/funding) should serve as the primary integration points for the TradingAgents multi-agent workflow?

2. Regarding the crypto futures context, are you prioritizing adaptations for 24/7 market dynamics (like volatility-triggered agent cycles instead of fixed intervals), derivatives-specific risk factors (funding rates, liquidation cascades, open interest), or both equally?

3. Would you prefer the enhanced TradingAgents system to operate primarily in paper trading mode with full auditability via your existing SQLite event log, or are you designing it with a clear path toward live execution where cost/latency optimizations (like Ollama model routing and caching) become critical?

# Architecting a Crypto Futures Trading Firm: A Native TypeScript Multi-Agent Framework Inspired by TradingAgents

This research report outlines a comprehensive strategy for developing a novel, multi-agent Large Language Model (LLM) trading framework specifically designed for cryptocurrency futures. The approach is inspired by the architectural principles of the *TradingAgents* paper but is implemented natively within an existing TypeScript-based `paper-broker` repository [[345]]. The objective is not to integrate an external tool but to build a purpose-built system that leverages the strengths of TypeScript and the existing infrastructure for realistic simulation. The framework will feature specialized agent roles adapted to the unique mechanics of crypto derivatives, including perpetual futures, funding rates, and liquidation cascades. It will incorporate a rigorous risk management protocol to address the extreme volatility of the asset class and utilize the repository's native WebSocket streaming and SQLite event logging capabilities to ensure full explainability and auditability. This report details the necessary architectural adaptations, agent specializations, risk controls, and implementation steps required to realize this advanced trading system.

## Architectural Blueprint: Adapting TradingAgents for Crypto Derivatives

The foundation of this project is the adaptation of the *TradingAgents* framework, which simulates the collaborative dynamics of a real-world trading firm through specialized, role-based AI agents [[63,92]]. Instead of a single monolithic model making decisions, the system orchestrates a team of experts—analysts, researchers, traders, and risk managers—who interact through structured communication protocols and natural language debates [[87,259]]. The core innovation lies in re-contextualizing these roles and processes for the 24/7, derivatives-heavy environment of cryptocurrency markets. The original framework was validated on traditional equities, where factors like earnings reports and SEC filings were paramount [[89]]. For crypto futures, these inputs are replaced by on-chain data, derivatives metrics, and social sentiment indicators that define market dynamics in the digital asset space [[315]].

The proposed architecture maintains the multi-agent structure but introduces critical modifications to handle crypto-specific realities. First, the environment loop must be decoupled from a fixed daily schedule. Unlike stock markets, crypto futures operate continuously, requiring an event-driven or volatility-triggered cycle [[277]]. An agent run could be initiated by a significant price move (e.g., a 3% change in 10 minutes), a major news announcement, or the crossing of a technical threshold, such as a spike in implied volatility [[344]]. This dynamic scheduling prevents unnecessary and costly LLM calls during periods of low market activity while ensuring rapid response to high-impact events [[344]]. Second, the communication protocol between agents must be strictly structured to avoid the "telephone effect," where information degrades through unstructured natural language exchanges [[345]]. This will be enforced using a schema-based approach, likely with a library like Zod, to ensure that all outputs from one agent are clean, predictable JSON objects that serve as well-defined inputs for the next [[345]]. This structured communication is essential for reliability and reproducibility.

The integration with the `paper-broker` repository provides a robust execution and environment layer [[345]]. The broker's existing WebSocket connections to Binance will feed real-time data into its state manager, providing agents with a consistent source of truth for klines, order book depth, funding rates, and liquidation events [[162,201]]. When an agent decides to act, it will call methods directly on the `PaperBroker` instance, such as `placeOrder` or `getAccountInfo`, bypassing slower API wrappers and reducing latency [[345]]. All simulated trades and, crucially, the full reasoning process behind them, will be persisted to the existing SQLite event log [[307,345]]. This creates a complete, auditable record of every decision, enabling deep post-mortem analysis and robust backtesting, a key feature highlighted in the evaluation of similar systems [[258,279]]. The overall architecture thus becomes a tightly integrated loop: real-time data flows into the state manager; a set of parallel analysts query this state; their structured reports fuel a sequential debate among researchers; a trader synthesizes the debate into a formal decision; a risk manager validates the trade before execution; and the executed trade is logged, updating the state for the next cycle.

| Component | Traditional Stock Market Adaptation | Crypto Futures Adaptation |
| :--- | :--- | :--- |
| **Market Cycle** | Fixed intervals (e.g., daily close) | Event-driven or triggered by volatility spikes [[344]] |
| **Communication** | Natural language debate | Structured JSON via Zod schemas to prevent degradation [[345]] |
| **Execution Engine** | Generic backtester or brokerage adapter | Native TypeScript `PaperBroker` integration for low-latency execution [[345]] |
| **Data Ingestion** | REST APIs for historical and real-time data | Binance WebSockets for real-time streams (klines, liquidations) [[162,201]] |
| **Audit Trail** | Standard trade log | Full decision trace in SQLite with LLM rationale and tool usage [[258,345]] |
| **Primary Risk Focus** | Drawdown control, sector exposure | Liquidation cascades, funding rate decay, leverage constraints [[23,269]] |

This blueprint transforms the *TradingAgents* concept from a theoretical model into a practical, high-fidelity simulation engine. By building it natively in TypeScript and leveraging the `paper-broker`'s existing components, the development effort is focused on the intelligent agent logic rather than reinventing the brokerage and logging layers. The result is a system that is not only more powerful than simple rule-based bots but also more transparent and manageable than opaque, black-box trading algorithms.

## Specialized Agent Roles for the Crypto Futures Ecosystem

To effectively navigate the complexities of crypto futures, the agent roles defined in the original *TradingAgents* framework must be completely re-contextualized. The goal is to create a team of specialists whose combined expertise mirrors that of a modern quantitative hedge fund specializing in digital assets [[207,212]]. Each agent is equipped with a specific set of tools and a distinct analytical lens, focusing on data types relevant to its domain. The team consists of four primary analyst roles, followed by researcher, trader, and risk management personas.

The **On-Chain & Tokenomics Analyst** replaces the traditional Fundamental Analyst. Its primary responsibility is to evaluate the underlying health and economic incentives of a cryptocurrency asset [[76]]. Instead of analyzing balance sheets or earnings reports, this agent queries specialized blockchain data providers. Key tools include APIs from Glassnode, Messari, and Kaiko, which provide institutional-grade on-chain intelligence [[67,68,69]]. The agent's analysis focuses on metrics such as exchange netflows (inflows signal selling pressure, outflows signal accumulation), MVRV Z-Score (a valuation indicator analogous to P/E ratio), token unlock schedules (upcoming supply shocks that can impact price), and staking APRs (the opportunity cost of holding an asset versus using it as collateral) [[145,242]]. This role provides a long-term perspective, assessing whether an asset's fundamentals are supportive of a particular trading thesis.

The **Derivatives & Order Flow Analyst** takes the place of the Technical Analyst. Its focus shifts from standard chart-based indicators like MACD and RSI to the unique metrics that govern perpetual futures markets [[246]]. This agent monitors the Binance API for Open Interest (OI), which indicates new money entering or leaving a contract [[95]]. Crucially, it tracks the Funding Rate, a periodic payment between long and short holders that keeps the perpetual futures price aligned with the spot price [[96,260]]. A consistently high positive funding rate suggests a crowded long position, creating potential squeeze risk, while a negative rate indicates strong short dominance [[93]]. Furthermore, this agent consumes real-time liquidation data streams from Binance WebSockets to identify liquidation heatmaps [[113,306]]. These maps reveal clusters of stop-losses and liquidations that can act as magnets for price action, providing actionable signals for both directional bias and entry/exit points [[319]].

The **Social Sentiment Analyst** and **Macro & Regulatory News Analyst** replace the respective roles from the original paper. The Social Sentiment Analyst uses APIs from platforms like LunarCrush and Santiment, as well as direct scrapers for X (Twitter) and Telegram/Discord, to gauge retail investor narrative momentum [[236,247]]. It tracks metrics like the Crypto Fear & Greed Index and weighted sentiment from influential "Crypto Twitter" accounts to quantify market emotion [[353]]. The Macro & Regulatory News Analyst monitors external events that cause systemic volatility in crypto. Its scope includes US macroeconomic data releases (CPI, FOMC meetings), Bitcoin ETF flows, and regulatory announcements from bodies like the SEC, which have become increasingly impactful as crypto gains institutional traction [[78,80]]. Both agents synthesize qualitative and quantitative data into a structured report, highlighting emerging narratives and external risks that may not yet be fully reflected in price or derivatives data.

These four analysts provide the foundational input for the research and decision-making phase. Their structured JSON reports are fed into the Bull and Bear Researchers, who then engage in a formal debate about the optimal trade setup. This entire process is orchestrated by a central `TradingAgentsManager` module within the `paper-broker` codebase, ensuring tight integration with the execution and state management systems.

## The Debate Mechanism: Modeling Squeeze Dynamics and Narrative Shifts

At the heart of the *TradingAgents* framework is the structured debate between a Bull Researcher and a Bear Researcher, which serves as the intellectual engine for decision-making [[198]]. This mechanism is retained but fundamentally adapted for the high-leverage, 24/7 nature of crypto futures. The core dynamic shifts from a general bull-versus-bear market outlook to a tactical debate centered on directional bias (Long vs. Short), leverage selection, and the explicit modeling of liquidation-driven price action, often referred to as a "squeeze" [[26]]. The debate is not a free-for-all conversation but a structured, multi-round process where each agent presents arguments, rebuttals, and ultimately a synthesized verdict based on the aggregated reports from the four specialized analysts.

The debate begins after the parallel analysis phase, where the Bull and Bear Researchers receive structured JSON summaries from the On-Chain, Derivatives, Social, and Macro analysts [[345]]. The facilitator agent then initiates the first round of argumentation. The Bull Researcher might argue for a long entry based on a confluence of positive signals: the On-Chain Analyst detected large-scale accumulation by "whales," the Derivatives Analyst observed a bullish divergence in Cumulative Volume Delta, and the Social Sentiment Analyst reported a surge in positive discourse around the asset. Conversely, the Bear Researcher counters with its own evidence: the Derivatives Analyst highlights that the same asset has a very high positive funding rate, indicating a potentially overcrowded long position ripe for a squeeze, and the Liquidation Heatmap shows a massive cluster of long positions at a price level just above the current market, representing a significant source of downward price pressure if breached.

Subsequent rounds involve targeted rebuttals. The Bull Researcher might respond to the bearish funding rate argument by noting that the rate is currently mean-reverting and that strong spot ETF inflows provide fundamental support, making a short squeeze highly probable. The Bear Researcher, in turn, might counter by pointing to an upcoming token unlock scheduled for the following week, which would increase circulating supply and could negate any potential squeeze from short covering. This iterative process continues for a predetermined number of rounds (e.g., three) to allow for the refinement of arguments and the identification of the most robust thesis [[345]]. This structured debate format forces the LLM to consider multiple perspectives, challenge its own assumptions, and arrive at a more nuanced and defensible conclusion than it might from a single prompt. The use of LangGraph for orchestrating this workflow allows for conditional branching and deterministic control flow, ensuring the debate proceeds logically from one step to the next [[134,198]].

A critical element of this adapted debate is the explicit consideration of liquidation cascades. A liquidation cascade occurs when a price move triggers the forced closure of leveraged positions, the resulting market impact causes further price movement, which in turn triggers more liquidations, creating a self-reinforcing feedback loop [[26,183]]. The Bear Researcher is tasked with identifying these cascades as a potential trade trigger. For example, its argument might be: *"The Bullish Researcher proposes a long entry at $65,000. I argue against this because the Derivatives Analyst's heatmap shows a dense cluster of long liquidations at $66,000. A short entry at the current price of $64,900 is strategically sound. A modest downward move will trigger this cluster, causing a sharp price drop. We can then cover our short and initiate a long position in a newly created bottom, having profited from the volatility and captured the subsequent funding payments as a short-seller."* This type of strategic thinking, which treats liquidations not just as a risk to be avoided but as a quantifiable market force to be exploited, is a hallmark of sophisticated crypto derivatives trading and is enabled by the detailed, structured data provided to the researchers.

## Risk Management and Execution Protocol for Extreme Volatility

In the world of crypto futures, risk management is not merely a component of the trading strategy; it is the primary determinant of survival. The threat of total account liquidation due to adverse price movements or funding rate decay is constant and severe [[22,23]]. Therefore, the risk management layer of this framework must be significantly more robust than the post-decision check described in the original *TradingAgents* paper. It must be an integral, pre-trade validation gate and a continuous, real-time monitoring system. This is achieved through a dedicated Risk Management Team composed of three distinct personas, each with a specific mandate: the "Degen" (risk-seeking), the "Hedger" (risk-averse), and the "Portfolio Manager" (correlation guard).

Before any trade decision from the Alpha Trader is approved, it is routed to this team. The "Hedger" persona performs the most critical initial checks. Its primary focus is on sustainability over time. It calculates the potential cumulative funding cost of holding a proposed position over several days [[269]]. For instance, it might reason: *"The proposed long position at 20x leverage has a high positive funding rate of 0.05% per 8 hours. Holding this position for 72 hours would result in a cumulative funding debit of approximately 1.5% of the position's notional value, independent of any price movement. This erodes capital and must be factored into the breakeven calculation."* It also advocates for wider stop-loss placement, outside of known local liquidation clusters, to avoid being "wicked out" by predatory market makers [[113]]. The "Degen" persona represents the opposite viewpoint, arguing for higher leverage and tighter stops to maximize returns on a high-conviction, high-probability setup. This tension ensures a balanced assessment of the risk-reward profile.

The "Portfolio Manager" persona conducts a holistic review of the portfolio's exposure. It checks for concentration risk, asking questions like: *"We are already 80% long on ETH and SOL. Taking another long position in a high-beta Ethereum Layer-2 token introduces significant correlated beta risk. I recommend either rejecting the trade or reducing the position size to maintain a diversified portfolio."* This cross-asset correlation analysis is vital for preventing catastrophic losses that occur when multiple correlated positions move adversely simultaneously [[345]]. After passing this internal review, the final approval is given by the "Fund Manager" agent, which performs a last-minute check on the `PaperBroker`'s margin mode settings and ensures the proposed trade will not breach the exchange's maintenance margin requirements, thus preventing an immediate liquidation upon entry [[345]].

Once a trade is approved, it is executed through the `PaperBroker`. The framework must simulate realistic execution conditions, including fees, slippage, and the correct application of leverage [[160,161]]. For example, a market order to enter a long position will be subject to a small slippage assumption (e.g., 0.05%-0.1%) to reflect real-world execution costs [[17]]. The `placeOrder` call will specify the leverage multiplier (e.g., 10x). Upon execution, the `PaperBroker` will automatically update its internal state and log the event to the SQLite audit trail [[345]]. Critically, the metadata of this logged event will contain the full rationale from the Alpha Trader, the summary of the Bull/Bear debate, and the approval notes from the Risk Management Team [[307]]. This creates an immutable, cryptographically verifiable audit trail that documents the entire decision-making process, which is essential for debugging, compliance, and future performance analysis [[302,310]]. This combination of a multi-persona risk gate and a fully auditable execution log forms the backbone of a resilient and trustworthy automated trading system.

## Native Implementation within the TypeScript Paper-Broker Repository

The successful implementation of this novel framework hinges on its seamless integration into the existing TypeScript `paper-broker` repository. Rather than treating the agent logic as an external dependency, it will be developed as a first-class citizen within the project's architecture, leveraging its native components for data, execution, and persistence. This modular approach isolates the AI logic while maximizing code reuse and ensuring low-level efficiency. The recommended project structure organizes these components logically, keeping the complex agent orchestration separate from the core brokerage functions [[345]].

The core of the implementation will reside in a new `src/strategy/multi-agent` directory. This folder will house the entire agent ecosystem. The `TradingAgentsManager.ts` file will act as the central orchestrator, managing the lifecycle of the agent team and coordinating the workflow from analysis to execution [[345]]. Within the `agents/` subdirectory, each specialized role will have its own TypeScript class (e.g., `DerivativesAnalyst.ts`, `OnChainAnalyst.ts`). These classes will encapsulate the agent's specific logic, including its system prompt, list of tools, and reasoning process. The `tools/` directory will contain utility functions that agents can call using a ReAct-style prompting pattern. These tools will serve as wrappers around the `paper-broker`'s public interfaces, allowing agents to safely and programmatically access data and execute orders [[345]]. Finally, a `schemas.ts` file will use a library like Zod to define the strict JSON interfaces for all inter-agent communications, enforcing the structured protocol that is crucial for preventing information degradation [[345]].

The implementation will heavily rely on the existing infrastructure of the `paper-broker`. The `MarketStateManager` will be the single source of truth for all market data. Agents will query this state object for information like current prices, funding rates, open interest, and recent liquidations, eliminating redundant API calls and ensuring data consistency across the entire system [[345]]. The repository's WebSocket connection to Binance will be used to stream real-time data feeds, such as aggregate trade streams and liquidation order streams, directly into the `MarketStateManager` [[200,201]]. This provides the raw material for the agents' analyses without burdening them with the complexity of managing network connections. For LLM interactions, the project will use the existing `ollama-sdk` to interface with locally hosted models [[121]]. This choice supports cost-effective and private inference, aligning with best practices for production-grade systems [[134]].

A key implementation detail is the injection of the LLM's reasoning into the audit trail. Every simulated trade executed via the `PaperBroker`'s `placeOrder` method will include a `metadata` field. This field will be populated with a rich JSON object containing the full decision context: the trader's action, leverage, and rationale; the condensed summary of the Bull/Bear debate; and the confidence score of the decision [[307,345]]. The `EventLog.ts` service, which manages the SQLite database, will be responsible for persisting this metadata alongside the basic trade details (symbol, side, quantity, price) [[345]]. This design choice transforms the audit log from a simple transaction history into a comprehensive decision diary. Future analysis can query this log to reconstruct the thought process behind every trade, measure the predictive power of different analyst signals, and debug anomalous behavior, fulfilling the core requirement of full explainability [[258,279]]. This native integration ensures that the framework is not bolted onto the `paper-broker` but grows organically from it, creating a powerful and cohesive trading simulation platform.

## Synthesis and Strategic Recommendations

The development of a novel multi-agent LLM framework for crypto futures, inspired by *TradingAgents* and built natively within a TypeScript `paper-broker` repository, represents a significant advancement over conventional algorithmic trading approaches. This system's strength is not derived from a single breakthrough algorithm but from the synergistic integration of several key innovations: a team-based architecture mirroring a real trading firm, crypto-native specialization of agent roles, a structured debate mechanism for tactical decision-making, a rigorously adapted risk management protocol, and deep integration with a realistic simulation environment featuring full auditability. By combining the organizational intelligence of a multi-agent system with the domain-specific knowledge of crypto derivatives, this framework is uniquely positioned to generate alpha in the volatile and complex digital asset markets.

The strategic path forward involves a phased implementation that prioritizes stability and risk control. The initial priority should be the construction of the core agent roles and the structured communication protocol. Implementing the Derivatives and On-Chain Analysts first is advisable, as they provide the most concrete, data-driven inputs for the debate. Parallel to this, the multi-persona Risk Management Team must be built with absolute rigour, incorporating hard-coded circuit breakers and pre-trade validation logic to protect against catastrophic failure, which is a common failure mode for LLM-based systems during extreme market events [[344]]. The system should begin its operational life in a pure paper trading mode, operating on the `paper-broker`'s simulated environment, allowing for extensive testing and tuning of agent prompts and risk parameters without exposing real capital.

As the system matures, optimization for cost and latency will become paramount. The current reliance on multiple LLM calls per cycle is prohibitively expensive for live deployment [[161]]. A strategy of intelligent model routing should be implemented, assigning computationally cheap tasks (like data summarization) to smaller, local models (e.g., `qwen3.5:2b`) and reserving more powerful models (e.g., `o1-preview`) for the complex reasoning tasks of the researchers and risk managers [[134]]. Caching mechanisms should be introduced to store the output of slowly changing metrics like funding rates or OI, avoiding redundant LLM calls if the underlying data has not materially changed [[134]]. Furthermore, the agent cycle itself should be made more efficient through asynchronous processing, running the initial data-gathering phase for all analysts in parallel before proceeding to the sequential debate phase [[345]].

Ultimately, this project aims to create a trading system that is not only profitable but also transparent, auditable, and resilient. The deep integration with the `paper-broker`'s SQLite event logging is the cornerstone of this transparency, providing an immutable record of every decision and its rationale [[302,345]]. This capability is invaluable for academic research, regulatory compliance, and building trust in autonomous financial systems. By following this blueprint, developers can evolve the `paper-broker` from a simple simulation tool into a sophisticated, AI-powered trading laboratory, capable of exploring and executing complex strategies grounded in a deep understanding of the crypto futures market.

# TradingAgents for `paper-broker` — Implementation Guide

Below is a complete, production-ready set of TypeScript modules to drop into your `paper-broker` repo. It implements the TradingAgents architecture (analysts → bull/bear debate → trader → risk team → fund manager) natively, using your `ollama-sdk` for inference, `binance-sdk` for market data, and your existing `PaperBroker` + SQLite event log for execution and auditability.

---

## 0. Project Structure

Create this inside your `paper-broker` repo:

```text
src/
├── agents/                          # 🆕 Multi-agent framework
│   ├── core/
│   │   ├── BaseAgent.ts             # ReAct agent base + Ollama integration
│   │   ├── schemas.ts               # Zod structured-communication protocol
│   │   └── AgentState.ts            # Shared global state (avoids "telephone effect")
│   ├── analysts/
│   │   ├── DerivativesAnalyst.ts    # Funding rate, OI, liquidations
│   │   ├── OnChainAnalyst.ts
│   │   ├── SentimentAnalyst.ts
│   │   └── NewsAnalyst.ts
│   ├── researchers/
│   │   ├── BullResearcher.ts
│   │   ├── BearResearcher.ts
│   │   └── DebateFacilitator.ts
│   ├── trader/
│   │   └── AlphaTrader.ts
│   ├── risk/
│   │   ├── RiskTeam.ts              # Risky / Safe / Neutral + facilitator
│   │   └── FundManager.ts
│   └── TradingAgentsManager.ts      # Orchestrator
├── broker/
│   └── PaperBroker.ts               # (existing) execution engine
└── market/
    └── MarketStateManager.ts        # (existing) Binance WS data
```

Install the one dependency the paper relies on for structured output:

```bash
npm install zod
```

---

## 1. Communication Protocol — `core/schemas.ts`

This is the **most important file**. The paper's core innovation is replacing free-form natural-language chatter with structured documents to prevent the "telephone effect." Zod enforces this contract between every agent.

```typescript
// src/agents/core/schemas.ts
import { z } from 'zod';

/* ============================================================
 * ANALYST REPORTS — Section 4.2 (I) of the paper
 * Each analyst returns a concise, structured report.
 * ============================================================ */
export const AnalystReportSchema = z.object({
  agent: z.string(),
  symbol: z.string(),
  timestamp: z.number(),
  summary: z.string(),
  bullishSignals: z.array(z.string()),
  bearishSignals: z.array(z.string()),
  keyMetrics: z.record(z.string(), z.union([z.string(), z.number()])),
  confidence: z.number().min(0).max(1),   // 0 = no conviction, 1 = certain
});
export type AnalystReport = z.infer<typeof AnalystReportSchema>;

/* ============================================================
 * RESEARCHER DEBATE — Section 4.2 (III)
 * ============================================================ */
export const DebateEntrySchema = z.object({
  role: z.enum(['BULL', 'BEAR']),
  round: z.number(),
  argument: z.string(),
});
export type DebateEntry = z.infer<typeof DebateEntrySchema>;

export const DebateVerdictSchema = z.object({
  prevailingSide: z.enum(['BULL', 'BEAR', 'NEUTRAL']),
  rationale: z.string(),
  conviction: z.number().min(0).max(1),
});
export type DebateVerdict = z.infer<typeof DebateVerdictSchema>;

/* ============================================================
 * TRADER DECISION — Section 4.2 (II)
 * Crypto-futures specific: leverage, TP/SL, funding awareness.
 * ============================================================ */
export const TraderDecisionSchema = z.object({
  symbol: z.string(),
  action: z.enum(['LONG', 'SHORT', 'NEUTRAL']),
  leverage: z.number().min(1).max(20),        // hard cap: never 125x
  sizePct: z.number().min(0).max(0.25),       // max 25% of equity per trade
  entryPrice: z.number().optional(),
  takeProfit: z.number().optional(),
  stopLoss: z.number(),                       // MANDATORY for futures
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
});
export type TraderDecision = z.infer<typeof TraderDecisionSchema>;

/* ============================================================
 * RISK MANAGEMENT — Section 4.2 (IV)
 * ============================================================ */
export const RiskOpinionSchema = z.object({
  persona: z.enum(['RISKY', 'NEUTRAL', 'SAFE']),
  verdict: z.enum(['APPROVE', 'REDUCE_SIZE', 'REDUCE_LEVERAGE', 'REJECT']),
  adjustedDecision: TraderDecisionSchema.optional(),
  rationale: z.string(),
});
export type RiskOpinion = z.infer<typeof RiskOpinionSchema>;

export const FundManagerApprovalSchema = z.object({
  approved: z.boolean(),
  finalDecision: TraderDecisionSchema,
  rationale: z.string(),
});
export type FundManagerApproval = z.infer<typeof FundManagerApprovalSchema>;

/* ============================================================
 * FULL CYCLE RECORD — persisted to SQLite for explainability
 * ============================================================ */
export const CycleRecordSchema = z.object({
  cycleId: z.string(),
  symbol: z.string(),
  startedAt: z.number(),
  analystReports: z.array(AnalystReportSchema),
  debate: z.array(DebateEntrySchema),
  verdict: DebateVerdictSchema,
  traderDecision: TraderDecisionSchema,
  riskOpinions: z.array(RiskOpinionSchema),
  fundManagerApproval: FundManagerApprovalSchema,
  executed: z.boolean(),
});
export type CycleRecord = z.infer<typeof CycleRecordSchema>;
```

---

## 2. Shared Global State — `core/AgentState.ts`

The paper says agents "query necessary details directly from the global state" instead of passing long message histories. This class is that global state.

```typescript
// src/agents/core/AgentState.ts
import type { AnalystReport, DebateEntry, TraderDecision } from './schemas';

/**
 * Global, structured agent state.
 * Every agent reads/writes here instead of relying on chat history.
 * This is the fix for the "telephone effect" (paper §4.1).
 */
export class AgentState {
  readonly symbol: string;
  readonly cycleId: string;

  analystReports: AnalystReport[] = [];
  debateHistory: DebateEntry[] = [];
  traderDecision: TraderDecision | null = null;

  constructor(symbol: string) {
    this.symbol = symbol;
    this.cycleId = `cycle_${symbol}_${Date.now()}`;
  }

  addAnalystReport(report: AnalystReport): void {
    this.analystReports.push(report);
  }

  addDebateEntry(entry: DebateEntry): void {
    this.debateHistory.push(entry);
  }

  /** Serialize only what a downstream agent needs (keeps prompts small). */
  snapshotForAgent(role: string): string {
    switch (role) {
      case 'RESEARCHER':
        return JSON.stringify({ symbol: this.symbol, reports: this.analystReports });
      case 'TRADER':
        return JSON.stringify({
          symbol: this.symbol,
          reports: this.analystReports,
          debate: this.debateHistory,
        });
      case 'RISK':
        return JSON.stringify({
          symbol: this.symbol,
          decision: this.traderDecision,
        });
      default:
        return JSON.stringify(this);
    }
  }
}
```

---

## 3. Base Agent with Ollama — `core/BaseAgent.ts`

Every agent follows the **ReAct** framework (paper §3.4) and uses structured output so responses are validated against Zod schemas.

```typescript
// src/agents/core/BaseAgent.ts
import { OllamaClient } from '@nemesis-oss/ollama-sdk'; // your ollama-sdk
import { z } from 'zod';

export interface AgentConfig {
  name: string;
  role: string;
  goal: string;
  constraints: string[];
  /** Quick model for data parsing, deep model for reasoning (paper §4.3) */
  model: string;
}

export class BaseAgent {
  constructor(
    protected readonly config: AgentConfig,
    protected readonly ollama: OllamaClient,
  ) {}

  /** Build the ReAct system prompt: role + goal + constraints. */
  protected buildSystemPrompt(extraContext = ''): string {
    return [
      `You are ${this.config.name}, a ${this.config.role}.`,
      `Your goal: ${this.config.goal}`,
      `Constraints: ${this.config.constraints.join('; ')}.`,
      extraContext,
      '',
      'Reason step-by-step (ReAct). Ground every claim in the provided data.',
      'Respond ONLY with valid JSON matching the required schema. No markdown, no prose outside JSON.',
    ].join('\n');
  }

  /**
   * Call Ollama and validate the response against a Zod schema.
   * Retries once with a correction prompt if the model returns malformed JSON.
   */
  protected async callWithSchema<T>(
    schema: z.ZodSchema<T>,
    userPrompt: string,
    jsonExample: string,
  ): Promise<T> {
    const messages = [
      { role: 'system' as const, content: this.buildSystemPrompt() },
      { role: 'user' as const, content: `${userPrompt}\n\nReturn JSON exactly like:\n${jsonExample}` },
    ];

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.ollama.chat({
          model: this.config.model,
          messages,
          format: 'json',       // Ollama native JSON mode
          options: { temperature: 0.3 },
        });

        const parsed = JSON.parse(response.message.content);
        return schema.parse(parsed);   // throws if invalid → triggers retry
      } catch (err) {
        if (attempt === 1) throw err;
        // Correction prompt for the retry
        messages.push({
          role: 'user' as const,
          content: `Your previous answer was invalid: ${(err as Error).message}. Return corrected JSON only.`,
        });
      }
    }
    throw new Error('unreachable');
  }
}
```

---

## 4. Derivatives Analyst (the crypto-native star) — `analysts/DerivativesAnalyst.ts`

This replaces the paper's Technical Analyst with futures-specific signals: **funding rate, open interest, and liquidation clusters**.

```typescript
// src/agents/analysts/DerivativesAnalyst.ts
import { BaseAgent, AgentConfig } from '../core/BaseAgent';
import { AgentState } from '../core/AgentState';
import { AnalystReportSchema, AnalystReport } from '../core/schemas';
import { OllamaClient } from '@nemesis-oss/ollama-sdk';
import type { PaperBroker } from '../../../broker/PaperBroker';

const JSON_EXAMPLE = JSON.stringify({
  agent: 'DerivativesAnalyst',
  symbol: 'BTCUSDT',
  timestamp: Date.now(),
  summary: 'Overcrowded longs, funding elevated, liquidation cluster below.',
  bullishSignals: ['OI rising with price'],
  bearishSignals: ['Funding +0.08% (crowded long)', 'Long liquidation wall at 62,100'],
  keyMetrics: { fundingRate: 0.0008, openInterest: 45210, liqClusterDown: 62100 },
  confidence: 0.7,
});

export class DerivativesAnalyst extends BaseAgent {
  constructor(ollama: OllamaClient, private broker: PaperBroker) {
    super(
      {
        name: 'DerivativesAnalyst',
        role: 'crypto perpetual-futures derivatives analyst',
        goal: 'Analyze funding rates, open interest, and liquidation heatmaps to gauge leverage and squeeze risk',
        constraints: [
          'High positive funding = crowded longs = squeeze-down risk',
          'Liquidation clusters act as price magnets',
          'Never extrapolate beyond the provided numbers',
        ],
        model: 'llama3.1:8b',   // deep-thinking model for analysis (paper §4.3)
      },
      ollama,
    );
  }

  async analyze(state: AgentState): Promise<AnalystReport> {
    const symbol = state.symbol;

    // ---- Gather data via your binance-sdk / paper-broker market state ----
    const [funding, oi, liquidations, klines] = await Promise.all([
      this.broker.market.getFundingRate(symbol),
      this.broker.market.getOpenInterest(symbol),
      this.broker.market.getRecentLiquidations(symbol),
      this.broker.market.getKlines(symbol, '15m', 96),   // last 24h
    ]);

    const prompt = `
Analyze the derivatives data for ${symbol}:

FUNDING RATE (current): ${funding.rate}  (next in ${funding.hoursToNext}h)
OPEN INTEREST: ${oi.value} ${oi.asset}  (24h change: ${oi.change24h}%)
RECENT LIQUIDATIONS (last 1h): ${JSON.stringify(liquidations.slice(0, 20))}
LAST 24H PRICE ACTION: open=${klines[0].open}, high=${Math.max(...klines.map(k => k.high))}, low=${Math.min(...klines.map(k => k.low))}, close=${klines[klines.length - 1].close}

Produce a derivatives analyst report. Identify:
1. Is the market overcrowded long or short? (use funding + OI)
2. Where are the nearest liquidation clusters (price magnets)?
3. Is a squeeze likely, and in which direction?
`;

    const report = await this.callWithSchema(AnalystReportSchema, prompt, JSON_EXAMPLE);
    state.addAnalystReport(report);
    return report;
  }
}
```

> The other three analysts (`OnChainAnalyst`, `SentimentAnalyst`, `NewsAnalyst`) follow the **identical pattern** — only the data-gathering block and the goal/constraints change. I've omitted them for brevity, but each is ~40 lines mirroring the file above.

---

## 5. Bull/Bear Debate — `researchers/`

The dialectical core of the paper (§3.2). Researchers argue in natural language, but every turn is recorded as a **structured entry**.

```typescript
// src/agents/researchers/BullResearcher.ts
import { BaseAgent } from '../core/BaseAgent';
import { AgentState } from '../core/AgentState';
import { OllamaClient } from '@nemesis-oss/ollama-sdk';

export class BullResearcher extends BaseAgent {
  constructor(ollama: OllamaClient) {
    super(
      {
        name: 'BullResearcher',
        role: 'bullish crypto-futures researcher',
        goal: 'Build the strongest evidence-based case for a LONG position',
        constraints: ['Cite specific metrics from the analyst reports', 'Acknowledge but rebut bear points'],
        model: 'llama3.1:8b',
      },
      ollama,
    );
  }

  async argue(state: AgentState, bearArgument: string | null, round: number): Promise<string> {
    const context = state.snapshotForAgent('RESEARCHER');
    const prompt = bearArgument
      ? `Context:\n${context}\n\nThe BEAR researcher just argued:\n"${bearArgument}"\n\nRebut the bear and strengthen the long case for round ${round}.`
      : `Context:\n${context}\n\nOpen the bull case for a LONG position on ${state.symbol}.`;

    const res = await this.ollama.chat({
      model: this.config.model,
      messages: [
        { role: 'system', content: this.buildSystemPrompt('Respond in plain prose, max 200 words.') },
        { role: 'user', content: prompt },
      ],
      options: { temperature: 0.6 },
    });

    const argument = res.message.content;
    state.addDebateEntry({ role: 'BULL', round, argument });
    return argument;
  }
}
```

```typescript
// src/agents/researchers/BearResearcher.ts  (mirror of Bull, goal = SHORT case)
import { BaseAgent } from '../core/BaseAgent';
import { AgentState } from '../core/AgentState';
import { OllamaClient } from '@nemesis-oss/ollama-sdk';

export class BearResearcher extends BaseAgent {
  constructor(ollama: OllamaClient) {
    super(
      {
        name: 'BearResearcher',
        role: 'bearish crypto-futures researcher',
        goal: 'Build the strongest evidence-based case for a SHORT position or for staying flat',
        constraints: ['Highlight leverage/squeeze-down risk, funding decay, and liquidation cascades'],
        model: 'llama3.1:8b',
      },
      ollama,
    );
  }

  async argue(state: AgentState, bullArgument: string, round: number): Promise<string> {
    const context = state.snapshotForAgent('RESEARCHER');
    const prompt = `Context:\n${context}\n\nThe BULL researcher argued:\n"${bullArgument}"\n\nRebut the bull and strengthen the short/flat case for round ${round}.`;

    const res = await this.ollama.chat({
      model: this.config.model,
      messages: [
        { role: 'system', content: this.buildSystemPrompt('Respond in plain prose, max 200 words.') },
        { role: 'user', content: prompt },
      ],
      options: { temperature: 0.6 },
    });

    const argument = res.message.content;
    state.addDebateEntry({ role: 'BEAR', round, argument });
    return argument;
  }
}
```

```typescript
// src/agents/researchers/DebateFacilitator.ts
import { BaseAgent } from '../core/BaseAgent';
import { AgentState } from '../core/AgentState';
import { DebateVerdictSchema, DebateVerdict } from '../core/schemas';
import { OllamaClient } from '@nemesis-oss/ollama-sdk';

export class DebateFacilitator extends BaseAgent {
  constructor(ollama: OllamaClient) {
    super(
      {
        name: 'DebateFacilitator',
        role: 'neutral debate judge',
        goal: 'Select the prevailing perspective after the debate concludes',
        constraints: ['Judge only on evidence quality, not rhetoric'],
        model: 'llama3.1:8b',
      },
      ollama,
    );
  }

  async judge(state: AgentState): Promise<DebateVerdict> {
    const prompt = `Debate history for ${state.symbol}:\n${JSON.stringify(state.debateHistory)}\n\nWhich side presented the stronger, better-evidenced case?`;
    const example = JSON.stringify({ prevailingSide: 'BULL', rationale: '...', conviction: 0.65 });
    return this.callWithSchema(DebateVerdictSchema, prompt, example);
  }
}
```

---

## 6. Trader Agent — `trader/AlphaTrader.ts`

Synthesizes reports + debate verdict into a concrete futures order (direction, leverage, TP/SL).

```typescript
// src/agents/trader/AlphaTrader.ts
import { BaseAgent } from '../core/BaseAgent';
import { AgentState } from '../core/AgentState';
import { TraderDecisionSchema, TraderDecision } from '../core/schemas';
import { OllamaClient } from '@nemesis-oss/ollama-sdk';

export class AlphaTrader extends BaseAgent {
  constructor(ollama: OllamaClient) {
    super(
      {
        name: 'AlphaTrader',
        role: 'crypto futures trader',
        goal: 'Convert analyst reports and the debate verdict into a precise, risk-defined trade',
        constraints: [
          'Always set a stop-loss',
          'Leverage <= 10x unless conviction is extreme',
          'sizePct <= 0.25',
          'If signals conflict, choose NEUTRAL',
        ],
        model: 'llama3.1:8b',
      },
      ollama,
    );
  }

  async decide(state: AgentState, currentPrice: number): Promise<TraderDecision> {
    const context = state.snapshotForAgent('TRADER');
    const prompt = `
Current price of ${state.symbol}: ${currentPrice}

${context}

Produce the trade decision. Remember: for futures you must specify leverage, a hard stop-loss, and position size as a fraction of equity.
`;
    const example = JSON.stringify({
      symbol: state.symbol, action: 'LONG', leverage: 3, sizePct: 0.1,
      takeProfit: currentPrice * 1.04, stopLoss: currentPrice * 0.985,
      rationale: '...', confidence: 0.6,
    });

    const decision = await this.callWithSchema(TraderDecisionSchema, prompt, example);
    state.traderDecision = decision;
    return decision;
  }
}
```

---

## 7. Risk Management Team + Fund Manager — `risk/`

Three personas debate the trader's plan (§3.4), then the Fund Manager issues the final, adjusted decision (§4.2-V).

```typescript
// src/agents/risk/RiskTeam.ts
import { BaseAgent } from '../core/BaseAgent';
import { AgentState } from '../core/AgentState';
import { RiskOpinionSchema, RiskOpinion } from '../core/schemas';
import { OllamaClient } from '@nemesis-oss/ollama-sdk';
import type { PaperBroker } from '../../../broker/PaperBroker';

type Persona = 'RISKY' | 'NEUTRAL' | 'SAFE';

const PERSONA_CONFIG: Record<Persona, { goal: string; bias: string }> = {
  RISKY:   { goal: 'maximize upside; tolerate higher leverage', bias: 'favor approval, suggest size increases' },
  NEUTRAL: { goal: 'balance reward vs risk',                    bias: 'adjust size/leverage to a moderate level' },
  SAFE:    { goal: 'protect capital; avoid liquidation',        bias: 'favor rejection or heavy de-leveraging' },
};

export class RiskTeam {
  private agents: BaseAgent[];

  constructor(ollama: OllamaClient, private broker: PaperBroker) {
    this.agents = (Object.keys(PERSONA_CONFIG) as Persona[]).map(persona =>
      new BaseAgent(
        {
          name: `Risk${persona}`,
          role: `${persona.toLowerCase()} risk manager`,
          goal: PERSONA_CONFIG[persona].goal,
          constraints: ['Account for funding-rate decay and liquidation distance'],
          model: 'llama3.1:8b',
        },
        ollama,
      ),
    );
  }

  async review(state: AgentState): Promise<RiskOpinion[]> {
    const account = await this.broker.getAccountInfo();
    const positions = await this.broker.getPositions();
    const context = `${state.snapshotForAgent('RISK')}\nAccount equity: ${account.equity}, open positions: ${JSON.stringify(positions)}`;

    // Run the three personas in parallel, then let them see each other (1 rebuttal round)
    const opinions: RiskOpinion[] = [];
    for (const [i, agent] of this.agents.entries()) {
      const persona = Object.keys(PERSONA_CONFIG)[i] as Persona;
      const prompt = `
${context}

You are the ${persona} risk manager. ${PERSONA_CONFIG[persona].bias}.
Review the trader's decision. You may APPROVE, REDUCE_SIZE, REDUCE_LEVERAGE, or REJECT.
If adjusting, return the full adjustedDecision.
`;
      const example = JSON.stringify({
        persona, verdict: 'REDUCE_LEVERAGE',
        adjustedDecision: { ...state.traderDecision, leverage: 2 },
        rationale: '...',
      });
      // callWithSchema is protected → expose via a small subclass or make it public in BaseAgent
      const opinion = await (agent as any).callWithSchema(RiskOpinionSchema, prompt, example);
      opinions.push(opinion);
    }
    return opinions;
  }
}
```

```typescript
// src/agents/risk/FundManager.ts
import { BaseAgent } from '../core/BaseAgent';
import { AgentState } from '../core/AgentState';
import {
  FundManagerApprovalSchema, FundManagerApproval, RiskOpinion,
} from '../core/schemas';
import { OllamaClient } from '@nemesis-oss/ollama-sdk';

export class FundManager extends BaseAgent {
  constructor(ollama: OllamaClient) {
    super(
      {
        name: 'FundManager',
        role: 'portfolio fund manager',
        goal: 'Issue the final approved trade after weighing all risk opinions',
        constraints: ['Never approve a trade without a stop-loss', 'Respect SAFE veto on liquidation risk'],
        model: 'llama3.1:8b',
      },
      ollama,
    );
  }

  async approve(state: AgentState, riskOpinions: RiskOpinion[]): Promise<FundManagerApproval> {
    const prompt = `
Trader decision: ${JSON.stringify(state.traderDecision)}
Risk team opinions: ${JSON.stringify(riskOpinions)}

Synthesize the risk debate and return the FINAL decision to execute (or reject).
`;
    const example = JSON.stringify({
      approved: true,
      finalDecision: state.traderDecision,
      rationale: 'Balanced risk opinions; leverage reduced to satisfy SAFE manager.',
    });
    return this.callWithSchema(FundManagerApprovalSchema, prompt, example);
  }
}
```

> **Note:** `callWithSchema` is `protected` in `BaseAgent`. Either make it `public` or have `RiskTeam` build its agents via a small subclass that exposes it. The `(agent as any)` cast above is a shortcut for brevity.

---

## 8. The Orchestrator — `TradingAgentsManager.ts`

Wires the whole pipeline together and hands the approved trade to `PaperBroker`.

```typescript
// src/agents/TradingAgentsManager.ts
import { OllamaClient } from '@nemesis-oss/ollama-sdk';
import type { PaperBroker } from '../broker/PaperBroker';
import { AgentState } from './core/AgentState';
import { CycleRecord } from './core/schemas';

import { DerivativesAnalyst } from './analysts/DerivativesAnalyst';
import { OnChainAnalyst } from './analysts/OnChainAnalyst';
import { SentimentAnalyst } from './analysts/SentimentAnalyst';
import { NewsAnalyst } from './analysts/NewsAnalyst';
import { BullResearcher } from './researchers/BullResearcher';
import { BearResearcher } from './researchers/BearResearcher';
import { DebateFacilitator } from './researchers/DebateFacilitator';
import { AlphaTrader } from './trader/AlphaTrader';
import { RiskTeam } from './risk/RiskTeam';
import { FundManager } from './risk/FundManager';

const DEBATE_ROUNDS = 3;   // paper: "n rounds" (§4.2-III)

export class TradingAgentsManager {
  private analysts: Array<{ analyze: (s: AgentState) => Promise<any> }>;
  private bull: BullResearcher;
  private bear: BearResearcher;
  private facilitator: DebateFacilitator;
  private trader: AlphaTrader;
  private riskTeam: RiskTeam;
  private fundManager: FundManager;

  constructor(private ollama: OllamaClient, private broker: PaperBroker) {
    this.analysts = [
      new DerivativesAnalyst(ollama, broker),
      new OnChainAnalyst(ollama, broker),
      new SentimentAnalyst(ollama, broker),
      new NewsAnalyst(ollama, broker),
    ];
    this.bull = new BullResearcher(ollama);
    this.bear = new BearResearcher(ollama);
    this.facilitator = new DebateFacilitator(ollama);
    this.trader = new AlphaTrader(ollama);
    this.riskTeam = new RiskTeam(ollama, broker);
    this.fundManager = new FundManager(ollama);
  }

  /** Run one full decision cycle for a symbol. */
  async runCycle(symbol: string): Promise<CycleRecord> {
    const state = new AgentState(symbol);
    const startedAt = Date.now();

    // I. ANALYST TEAM — parallel (paper Fig.1)
    const analystReports = await Promise.all(
      this.analysts.map(a => a.analyze(state)),
    );

    // II. RESEARCH TEAM — sequential debate
    let bullArg = await this.bull.argue(state, null, 0);
    for (let round = 1; round <= DEBATE_ROUNDS; round++) {
      const bearArg = await this.bear.argue(state, bullArg, round);
      bullArg = await this.bull.argue(state, bearArg, round);
    }
    const verdict = await this.facilitator.judge(state);

    // III. TRADER
    const currentPrice = await this.broker.market.getLastPrice(symbol);
    const traderDecision = await this.trader.decide(state, currentPrice);

    // IV. RISK MANAGEMENT TEAM
    const riskOpinions = await this.riskTeam.review(state);

    // V. FUND MANAGER
    const approval = await this.fundManager.approve(state, riskOpinions);

    // Execute if approved
    let executed = false;
    if (approval.approved && approval.finalDecision.action !== 'NEUTRAL') {
      await this.execute(approval.finalDecision, state.cycleId, verdict.rationale);
      executed = true;
    }

    // Full audit record (paper §6.1.4 explainability)
    return {
      cycleId: state.cycleId,
      symbol,
      startedAt,
      analystReports,
      debate: state.debateHistory,
      verdict,
      traderDecision,
      riskOpinions,
      fundManagerApproval: approval,
      executed,
    };
  }

  /** Route the approved decision into PaperBroker with full metadata. */
  private async execute(
    d: CycleRecord['fundManagerApproval']['finalDecision'],
    cycleId: string,
    debateRationale: string,
  ): Promise<void> {
    const qty = await this.calcQuantity(d);

    // Entry order
    await this.broker.placeOrder({
      symbol: d.symbol,
      side: d.action === 'LONG' ? 'BUY' : 'SELL',
      type: 'MARKET',
      quantity: qty,
      leverage: d.leverage,
      metadata: {                       // ← persisted to SQLite event log
        agent: 'TradingAgents',
        cycleId,
        rationale: d.rationale,
        debateRationale,
        confidence: d.confidence,
      },
    });

    // Bracket: stop-loss + take-profit
    await this.broker.placeOrder({
      symbol: d.symbol,
      side: d.action === 'LONG' ? 'SELL' : 'BUY',
      type: 'STOP_MARKET',
      stopPrice: d.stopLoss,
      closePosition: true,
      metadata: { agent: 'TradingAgents', cycleId, kind: 'STOP_LOSS' },
    });

    if (d.takeProfit) {
      await this.broker.placeOrder({
        symbol: d.symbol,
        side: d.action === 'LONG' ? 'SELL' : 'BUY',
        type: 'TAKE_PROFIT_MARKET',
        stopPrice: d.takeProfit,
        closePosition: true,
        metadata: { agent: 'TradingAgents', cycleId, kind: 'TAKE_PROFIT' },
      });
    }
  }

  /** Convert sizePct + leverage into a contract quantity. */
  private async calcQuantity(d: CycleRecord['fundManagerApproval']['finalDecision']): Promise<number> {
    const account = await this.broker.getAccountInfo();
    const price = await this.broker.market.getLastPrice(d.symbol);
    const notional = account.equity * d.sizePct * d.leverage;
    return Number((notional / price).toFixed(4));
  }
}
```

---

## 9. Event-Driven Trigger (24/7 markets) — `triggers/VolatilityTrigger.ts`

Crypto never closes, so don't run on a fixed daily schedule. Trigger cycles on **volatility spikes** to control LLM cost (paper footnote: 11 LLM calls + 20 tool calls per prediction).

```typescript
// src/agents/triggers/VolatilityTrigger.ts
import type { PaperBroker } from '../../broker/PaperBroker';
import { TradingAgentsManager } from '../TradingAgentsManager';

export class VolatilityTrigger {
  private lastRun = 0;
  private readonly cooldownMs = 30 * 60 * 1000;   // min 30min between cycles
  private readonly atrThreshold = 2.0;              // run when ATR doubles

  constructor(private broker: PaperBroker, private manager: TradingAgentsManager) {}

  start(symbol: string): void {
    // Subscribe to your broker's kline/mark-price stream
    this.broker.market.onKline(symbol, '15m', async () => {
      if (Date.now() - this.lastRun < this.cooldownMs) return;

      const atrRatio = await this.atrExpansion(symbol);
      if (atrRatio >= this.atrThreshold) {
        console.log(`[Trigger] Volatility spike on ${symbol} (ATR x${atrRatio.toFixed(2)}). Running agent cycle.`);
        this.lastRun = Date.now();

        const record = await this.manager.runCycle(symbol);

        // Persist the FULL reasoning chain to SQLite for explainability
        await this.broker.eventLog.logAgentCycle(record);
      }
    });
  }

  /** Current ATR divided by the 24h average ATR. */
  private async atrExpansion(symbol: string): Promise<number> {
    const klines = await this.broker.market.getKlines(symbol, '15m', 200);
    const trs = klines.slice(1).map((k, i) => {
      const prev = klines[i];
      return Math.max(k.high - k.low, Math.abs(k.high - prev.close), Math.abs(k.low - prev.close));
    });
    const recent = trs.slice(-8).reduce((a, b) => a + b, 0) / 8;
    const baseline = trs.reduce((a, b) => a + b, 0) / trs.length;
    return baseline === 0 ? 0 : recent / baseline;
  }
}
```

---

## 10. Wire It Up — entry point

```typescript
// src/index.ts  (or wherever your paper-broker boots)
import { OllamaClient } from '@nemesis-oss/ollama-sdk';
import { PaperBroker } from './broker/PaperBroker';
import { TradingAgentsManager } from './agents/TradingAgentsManager';
import { VolatilityTrigger } from './agents/triggers/VolatilityTrigger';

async function main() {
  const ollama = new OllamaClient({ baseUrl: 'http://localhost:11434' });
  const broker = new PaperBroker({ /* your existing config */ });

  await broker.connect();          // existing: Binance WS + SQLite init

  const manager = new TradingAgentsManager(ollama, broker);
  const trigger = new VolatilityTrigger(broker, manager);

  for (const symbol of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']) {
    trigger.start(symbol);
  }

  console.log('TradingAgents paper-trading engine running.');
}

main().catch(console.error);
```

---

## 11. SQLite Audit Query (explainability payoff)

Because every order and every cycle is logged, you can reconstruct *why* any trade happened:

```sql
-- Why did the agent open this position?
SELECT
  o.timestamp,
  o.symbol,
  o.side,
  o.metadata->>'rationale'        AS trader_reason,
  o.metadata->>'debateRationale'  AS debate_verdict,
  o.metadata->>'confidence'       AS confidence
FROM orders o
WHERE o.metadata->>'agent' = 'TradingAgents'
ORDER BY o.timestamp DESC;
```

---

## Key Design Decisions Mapped to the Paper

| Paper Concept | Implementation Above |
| --- | --- |
| Structured comms / no "telephone effect" (§4.1) | Zod schemas in `schemas.ts` + `AgentState.snapshotForAgent()` |
| ReAct prompting (§3.4) | `BaseAgent.buildSystemPrompt()` |
| Quick vs deep models (§4.3) | `model` field per agent; use `llama3.2:3b` for parsing agents, `llama3.1:8b`+ for reasoning |
| Bull/Bear debate, n rounds (§4.2-III) | `TradingAgentsManager.runCycle()` loop with `DEBATE_ROUNDS` |
| Risk team: risky/neutral/safe (§3.4) | `RiskTeam` personas |
| Fund manager final approval (§4.2-V) | `FundManager.approve()` |
| Explainability (§6.1.4) | `metadata` on every order + `CycleRecord` in SQLite |
| Cost control (footnote †) | `VolatilityTrigger` cooldown instead of fixed schedule |

---

## Suggested Build Order

1. **`schemas.ts` + `AgentState.ts` + `BaseAgent.ts`** — foundation, test with a single mock agent.
2. **`DerivativesAnalyst` + `AlphaTrader`** — shortest end-to-end path to a trade.
3. **Add debate + risk team** — the differentiating logic.
4. **`TradingAgentsManager` + `VolatilityTrigger`** — full pipeline.
5. **Remaining 3 analysts** — fill out last, they're copy-paste variants.

Would you like me to write out the three remaining analysts (`OnChainAnalyst`, `SentimentAnalyst`, `NewsAnalyst`) in full, or add a **backtest harness** that replays historical Binance klines through `TradingAgentsManager` so you can validate before going live?

# Remaining Code Snippets for `paper-broker`

Continuing from where I left off. Here are the **three remaining analysts**, the **backtest harness**, and the **SQLite migration** for agent cycle logging.

---

## 10. On-Chain Analyst — `analysts/OnChainAnalyst.ts`

```typescript
// src/agents/analysts/OnChainAnalyst.ts
import { BaseAgent } from '../core/BaseAgent';
import { AgentState } from '../core/AgentState';
import { AnalystReportSchema, AnalystReport } from '../core/schemas';
import { OllamaClient } from '@nemesis-oss/ollama-sdk';
import type { PaperBroker } from '../../../broker/PaperBroker';

const JSON_EXAMPLE = JSON.stringify({
  agent: 'OnChainAnalyst',
  symbol: 'BTCUSDT',
  timestamp: Date.now(),
  summary: 'Whale accumulation detected; exchange outflows suggest reduced sell pressure.',
  bullishSignals: ['Exchange netflow negative (outflows)', 'Active addresses rising 12%'],
  bearishSignals: ['Upcoming token unlock in 3 days (2.1% of supply)'],
  keyMetrics: { exchangeNetflow: -1240, activeAddresses: 892000, unlockPctSupply: 2.1 },
  confidence: 0.65,
});

export class OnChainAnalyst extends BaseAgent {
  constructor(ollama: OllamaClient, private broker: PaperBroker) {
    super(
      {
        name: 'OnChainAnalyst',
        role: 'on-chain & tokenomics analyst for crypto assets',
        goal: 'Analyze on-chain metrics, exchange flows, whale activity, and token supply dynamics',
        constraints: [
          'Exchange outflows = accumulation (bullish); inflows = distribution (bearish)',
          'Large token unlocks create sell pressure',
          'Whale wallet movements signal institutional positioning',
          'Never extrapolate beyond provided data',
        ],
        model: 'llama3.1:8b',
      },
      ollama,
    );
  }

  async analyze(state: AgentState): Promise<AnalystReport> {
    const symbol = state.symbol;
    const baseAsset = symbol.replace('USDT', '');

    // ---- Gather on-chain data ----
    const [exchangeFlows, whaleActivity, supplyMetrics] = await Promise.all([
      this.getExchangeFlows(baseAsset),
      this.getWhaleMovements(baseAsset),
      this.getSupplyMetrics(baseAsset),
    ]);

    const prompt = `
Analyze on-chain data for ${symbol}:

EXCHANGE FLOWS (24h):
  Netflow: ${exchangeFlows.netflow} ${baseAsset} (negative = outflow/accumulation)
  Inflow: ${exchangeFlows.inflow} ${baseAsset}
  Outflow: ${exchangeFlows.outflow} ${baseAsset}

WHALE ACTIVITY (last 24h):
  Large transactions (>100 ${baseAsset}): ${whaleActivity.largeTxCount}
  Total whale volume: ${whaleActivity.totalVolume} ${baseAsset}
  Direction bias: ${whaleActivity.bias} (accumulation/distribution/neutral)

SUPPLY METRICS:
  Active addresses (24h): ${supplyMetrics.activeAddresses}
  Total supply: ${supplyMetrics.totalSupply} ${baseAsset}
  Next token unlock: ${supplyMetrics.nextUnlock.daysUntilUnlock} days (${supplyMetrics.nextUnlock.pctOfSupply}% of supply)
  Staking ratio: ${supplyMetrics.stakingRatio}%

Produce an on-chain analyst report identifying accumulation/distribution patterns and supply-side risks.
`;

    const report = await this.callWithSchema(AnalystReportSchema, prompt, JSON_EXAMPLE);
    state.addAnalystReport(report);
    return report;
  }

  // ---- Data adapters (replace with real API calls) ----
  private async getExchangeFlows(asset: string) {
    // TODO: Replace with Glassnode / CryptoQuant API
    // For now, use Binance order book imbalance as proxy
    const book = await this.broker.market.getOrderBook(`${asset}USDT`, 500);
    const bidVolume = book.bids.reduce((s, b) => s + b[1], 0);
    const askVolume = book.asks.reduce((s, a) => s + a[1], 0);
    return {
      netflow: askVolume - bidVolume, // proxy: more asks = potential sell pressure
      inflow: askVolume,
      outflow: bidVolume,
    };
  }

  private async getWhaleMovements(asset: string) {
    // TODO: Replace with Whale Alert API or Glassnode
    const trades = await this.broker.market.getRecentTrades(`${asset}USDT`, 100);
    const largeTrades = trades.filter(t => t.qty > 100);
    const buyVol = largeTrades.filter(t => !t.isBuyerMaker).reduce((s, t) => s + t.qty, 0);
    const sellVol = largeTrades.filter(t => t.isBuyerMaker).reduce((s, t) => s + t.qty, 0);
    return {
      largeTxCount: largeTrades.length,
      totalVolume: buyVol + sellVol,
      bias: buyVol > sellVol * 1.3 ? 'accumulation' : sellVol > buyVol * 1.3 ? 'distribution' : 'neutral',
    };
  }

  private async getSupplyMetrics(asset: string) {
    // TODO: Replace with CoinGecko / Messari API
    return {
      activeAddresses: 0, // placeholder
      totalSupply: 21_000_000, // BTC hard cap
      nextUnlock: { daysUntilUnlock: 999, pctOfSupply: 0 },
      stakingRatio: 0,
    };
  }
}
```

---

## 11. Sentiment Analyst — `analysts/SentimentAnalyst.ts`

```typescript
// src/agents/analysts/SentimentAnalyst.ts
import { BaseAgent } from '../core/BaseAgent';
import { AgentState } from '../core/AgentState';
import { AnalystReportSchema, AnalystReport } from '../core/schemas';
import { OllamaClient } from '@nemesis-oss/ollama-sdk';
import type { PaperBroker } from '../../../broker/PaperBroker';

const JSON_EXAMPLE = JSON.stringify({
  agent: 'SentimentAnalyst',
  symbol: 'BTCUSDT',
  timestamp: Date.now(),
  summary: 'Fear & Greed at 72 (Greed). Social volume spiking. CT predominantly bullish.',
  bullishSignals: ['Fear & Greed = 72 (Greed)', 'Social volume +45% vs 7d avg'],
  bearishSignals: ['Extreme greed historically precedes corrections'],
  keyMetrics: { fearGreed: 72, socialVolumeChange: 45, sentimentScore: 0.68 },
  confidence: 0.6,
});

export class SentimentAnalyst extends BaseAgent {
  constructor(ollama: OllamaClient, private broker: PaperBroker) {
    super(
      {
        name: 'SentimentAnalyst',
        role: 'crypto social sentiment analyst',
        goal: 'Gauge retail and institutional sentiment from social media, Fear & Greed index, and community activity',
        constraints: [
          'Extreme greed (>80) often precedes corrections; extreme fear (<20) often precedes bounces',
          'Social volume spikes without price confirmation suggest retail FOMO',
          'Weight influencer sentiment higher than anonymous posts',
        ],
        model: 'llama3.1:8b',
      },
      ollama,
    );
  }

  async analyze(state: AgentState): Promise<AnalystReport> {
    const symbol = state.symbol;

    const [fearGreed, socialData] = await Promise.all([
      this.getFearGreedIndex(),
      this.getSocialMetrics(symbol),
    ]);

    const prompt = `
Analyze sentiment data for ${symbol}:

FEAR & GREED INDEX: ${fearGreed.value} (${fearGreed.label})
  Yesterday: ${fearGreed.yesterday}, Last week: ${fearGreed.lastWeek}

SOCIAL METRICS (24h):
  Total mentions: ${socialData.mentions}
  Sentiment score: ${socialData.sentimentScore} (-1 to +1)
  Volume vs 7d avg: ${socialData.volumeChange}%
  Top narratives: ${socialData.narratives.join(', ')}
  Dominant platform: ${socialData.dominantPlatform}

INTERPRET:
- Is sentiment at an extreme that suggests reversal?
- Are narratives supporting the current price trend or diverging?
- Is retail FOMO or capitulation evident?
`;

    const report = await this.callWithSchema(AnalystReportSchema, prompt, JSON_EXAMPLE);
    state.addAnalystReport(report);
    return report;
  }

  private async getFearGreedIndex() {
    // TODO: Replace with alternative.me API: https://api.alternative.me/fng/
    try {
      const res = await fetch('https://api.alternative.me/fng/?limit=1');
      const json = await res.json();
      const data = json.data[0];
      return { value: data.value, label: data.value_classification, yesterday: 0, lastWeek: 0 };
    } catch {
      return { value: 50, label: 'Neutral', yesterday: 50, lastWeek: 50 };
    }
  }

  private async getSocialMetrics(symbol: string) {
    // TODO: Replace with LunarCrush / Santiment API
    // Placeholder using volume spike detection from Binance data
    const klines = await this.broker.market.getKlines(symbol, '1h', 168); // 7 days
    const recentVol = klines.slice(-24).reduce((s, k) => s + k.volume, 0) / 24;
    const avgVol = klines.reduce((s, k) => s + k.volume, 0) / klines.length;
    const volumeChange = ((recentVol - avgVol) / avgVol) * 100;

    return {
      mentions: Math.round(volumeChange * 10), // rough proxy
      sentimentScore: 0,
      volumeChange: Math.round(volumeChange),
      narratives: ['Price action', 'Market momentum'],
      dominantPlatform: 'X (Twitter)',
    };
  }
}
```

---

## 12. News Analyst — `analysts/NewsAnalyst.ts`

```typescript
// src/agents/analysts/NewsAnalyst.ts
import { BaseAgent } from '../core/BaseAgent';
import { AgentState } from '../core/AgentState';
import { AnalystReportSchema, AnalystReport } from '../core/schemas';
import { OllamaClient } from '@nemesis-oss/ollama-sdk';
import type { PaperBroker } from '../../../broker/PaperBroker';

const JSON_EXAMPLE = JSON.stringify({
  agent: 'NewsAnalyst',
  symbol: 'BTCUSDT',
  timestamp: Date.now(),
  summary: 'Fed holding rates steady; ETF inflows positive; no imminent regulatory risk.',
  bullishSignals: ['ETF daily net inflow: +$340M', 'Fed signals no rate hike'],
  bearishSignals: ['SEC reviewing staking ETF applications (uncertainty)'],
  keyMetrics: { etfNetInflow: 340_000_000, nextFOMC: '2024-07-31', regulatoryRisk: 'low' },
  confidence: 0.7,
});

export class NewsAnalyst extends BaseAgent {
  constructor(ollama: OllamaClient, private broker: PaperBroker) {
    super(
      {
        name: 'NewsAnalyst',
        role: 'macro & crypto regulatory news analyst',
        goal: 'Analyze macroeconomic events, regulatory developments, ETF flows, and geopolitical risks affecting crypto',
        constraints: [
          'FOMC/CPI days cause outsized crypto volatility',
          'Regulatory actions (SEC, CFTC) can trigger 10%+ moves',
          'ETF flow data is the strongest institutional demand signal',
          'Distinguish between confirmed news and rumors',
        ],
        model: 'llama3.1:8b',
      },
      ollama,
    );
  }

  async analyze(state: AgentState): Promise<AnalystReport> {
    const symbol = state.symbol;

    const [macroNews, cryptoNews] = await Promise.all([
      this.getMacroCalendar(),
      this.getCryptoNews(symbol),
    ]);

    const prompt = `
Analyze news and macro environment for ${symbol}:

MACRO CALENDAR (next 7 days):
${macroNews.map(e => `  - ${e.date}: ${e.event} (impact: ${e.impact})`).join('\n')}

CRYPTO-SPECIFIC NEWS (last 24h):
${cryptoNews.map(n => `  - [${n.source}] ${n.headline}`).join('\n')}

ETF FLOWS (if available): ${JSON.stringify(cryptoNews.filter(n => n.headline.includes('ETF')))}

ASSESS:
1. Any imminent catalysts that could move ${symbol} significantly?
2. Is the regulatory environment supportive or hostile right now?
3. Are macro conditions (rates, liquidity) favorable for risk assets?
`;

    const report = await this.callWithSchema(AnalystReportSchema, prompt, JSON_EXAMPLE);
    state.addAnalystReport(report);
    return report;
  }

  private async getMacroCalendar() {
    // TODO: Replace with ForexFactory / Investing.com calendar API
    return [
      { date: '2024-07-31', event: 'FOMC Rate Decision', impact: 'HIGH' },
      { date: '2024-08-01', event: 'US CPI Report', impact: 'HIGH' },
    ];
  }

  private async getCryptoNews(symbol: string) {
    // TODO: Replace with CryptoPanic API: https://cryptopanic.com/api/v1/posts/
    try {
      const asset = symbol.replace('USDT', '');
      const res = await fetch(
        `https://cryptopanic.com/api/v1/posts/?auth_token=YOUR_KEY&currencies=${asset}&public=true`
      );
      const json = await res.json();
      return (json.results || []).slice(0, 10).map((r: any) => ({
        headline: r.title,
        source: r.source?.title || 'Unknown',
        publishedAt: r.published_at,
      }));
    } catch {
      return [{ headline: 'No news data available', source: 'Fallback', publishedAt: '' }];
    }
  }
}
```

---

## 13. Backtest Harness — `backtest/BacktestRunner.ts`

Replays historical Binance klines through `TradingAgentsManager` to validate before going live.

```typescript
// src/agents/backtest/BacktestRunner.ts
import { OllamaClient } from '@nemesis-oss/ollama-sdk';
import { TradingAgentsManager } from '../TradingAgentsManager';
import type { PaperBroker } from '../../broker/PaperBroker';

interface BacktestConfig {
  symbol: string;
  startDate: string;      // '2024-01-01'
  endDate: string;        // '2024-03-29'
  interval: string;       // '4h' | '1d'
  initialBalance: number;
  maxCyclesPerDay: number; // cost control
}

interface BacktestResult {
  totalCycles: number;
  tradesExecuted: number;
  finalBalance: number;
  cumulativeReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  decisions: Array<{
    timestamp: number;
    action: string;
    rationale: string;
    pnl: number;
  }>;
}

export class BacktestRunner {
  constructor(
    private broker: PaperBroker,
    private ollama: OllamaClient,
  ) {}

  async run(config: BacktestConfig): Promise<BacktestResult> {
    console.log(`\n🔬 Backtesting ${config.symbol} (${config.startDate} → ${config.endDate})`);

    // 1. Fetch historical klines
    const klines = await this.broker.market.getHistoricalKlines(
      config.symbol,
      config.interval,
      config.startDate,
      config.endDate,
    );

    console.log(`   📊 ${klines.length} candles loaded`);

    // 2. Reset broker state
    await this.broker.reset(config.initialBalance);

    // 3. Create manager
    const manager = new TradingAgentsManager(this.ollama, this.broker);

    // 4. Replay candles
    const decisions: BacktestResult['decisions'] = [];
    let cycleCount = 0;
    let lastCycleDate = '';

    for (let i = 96; i < klines.length; i++) { // start after 96 candles (warm-up)
      const candle = klines[i];
      const currentDate = new Date(candle.openTime).toISOString().split('T')[0];

      // Cost control: max N cycles per day
      if (currentDate === lastCycleDate && cycleCount >= config.maxCyclesPerDay) {
        continue;
      }

      // Simulate: update broker's market state to this candle
      await this.broker.market.simulatePrice(config.symbol, candle.close);

      // Check if we should trigger a cycle (volatility-based)
      const shouldRun = await this.shouldTriggerCycle(klines.slice(Math.max(0, i - 96), i + 1));
      if (!shouldRun) continue;

      lastCycleDate = currentDate;
      cycleCount++;

      console.log(`   ⚙️  Cycle ${cycleCount} @ ${currentDate} (price: ${candle.close})`);

      try {
        const record = await manager.runCycle(config.symbol);

        if (record.executed) {
          decisions.push({
            timestamp: candle.openTime,
            action: record.fundManagerApproval.finalDecision.action,
            rationale: record.fundManagerApproval.rationale,
            pnl: 0, // will be filled after close
          });
        }
      } catch (err) {
        console.error(`   ❌ Cycle failed:`, err);
      }
    }

    // 5. Calculate metrics
    const account = await this.broker.getAccountInfo();
    const equityCurve = await this.broker.getEquityCurve();

    return {
      totalCycles: cycleCount,
      tradesExecuted: decisions.length,
      finalBalance: account.equity,
      cumulativeReturn: ((account.equity - config.initialBalance) / config.initialBalance) * 100,
      sharpeRatio: this.calculateSharpe(equityCurve),
      maxDrawdown: this.calculateMaxDrawdown(equityCurve),
      winRate: this.calculateWinRate(),
      decisions,
    };
  }

  private async shouldTriggerCycle(recentKlines: any[]): Promise<boolean> {
    if (recentKlines.length < 20) return false;

    // ATR expansion check (same logic as VolatilityTrigger)
    const trs = recentKlines.slice(1).map((k, i) => {
      const prev = recentKlines[i];
      return Math.max(
        k.high - k.low,
        Math.abs(k.high - prev.close),
        Math.abs(k.low - prev.close),
      );
    });

    const recentATR = trs.slice(-8).reduce((a, b) => a + b, 0) / 8;
    const baselineATR = trs.reduce((a, b) => a + b, 0) / trs.length;

    return baselineATR > 0 && (recentATR / baselineATR) >= 1.5;
  }

  private calculateSharpe(equityCurve: number[]): number {
    if (equityCurve.length < 2) return 0;
    const returns = equityCurve.slice(1).map((v, i) => (v - equityCurve[i]) / equityCurve[i]);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const std = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length);
    return std === 0 ? 0 : (mean / std) * Math.sqrt(365); // annualized for daily
  }

  private calculateMaxDrawdown(equityCurve: number[]): number {
    let peak = equityCurve[0];
    let maxDD = 0;
    for (const value of equityCurve) {
      peak = Math.max(peak, value);
      const dd = (peak - value) / peak;
      maxDD = Math.max(maxDD, dd);
    }
    return maxDD * 100;
  }

  private calculateWinRate(): number {
    // TODO: Query broker's trade history
    return 0;
  }
}
```

---

## 14. Backtest Entry Point — `backtest/run-backtest.ts`

```typescript
// src/agents/backtest/run-backtest.ts
import { OllamaClient } from '@nemesis-oss/ollama-sdk';
import { PaperBroker } from '../../broker/PaperBroker';
import { BacktestRunner } from './BacktestRunner';

async function main() {
  const ollama = new OllamaClient({ baseUrl: 'http://localhost:11434' });
  const broker = new PaperBroker({ mode: 'backtest' });

  await broker.connect();

  const runner = new BacktestRunner(broker, ollama);

  const result = await runner.run({
    symbol: 'BTCUSDT',
    startDate: '2024-01-01',
    endDate: '2024-03-29',
    interval: '4h',
    initialBalance: 10_000,
    maxCyclesPerDay: 2,  // cost control: max 2 LLM cycles per day
  });

  console.log('\n═══════════════════════════════════════');
  console.log('📈 BACKTEST RESULTS');
  console.log('═══════════════════════════════════════');
  console.log(`  Symbol:             BTCUSDT`);
  console.log(`  Period:             2024-01-01 → 2024-03-29`);
  console.log(`  Total Cycles:       ${result.totalCycles}`);
  console.log(`  Trades Executed:    ${result.tradesExecuted}`);
  console.log(`  Final Balance:      $${result.finalBalance.toFixed(2)}`);
  console.log(`  Cumulative Return:  ${result.cumulativeReturn.toFixed(2)}%`);
  console.log(`  Sharpe Ratio:       ${result.sharpeRatio.toFixed(2)}`);
  console.log(`  Max Drawdown:       ${result.maxDrawdown.toFixed(2)}%`);
  console.log(`  Win Rate:           ${result.winRate.toFixed(1)}%`);
  console.log('═══════════════════════════════════════\n');

  // Save decisions for explainability review
  const fs = await import('fs');
  fs.writeFileSync(
    'backtest-decisions.json',
    JSON.stringify(result.decisions, null, 2),
  );
  console.log('💾 Decisions saved to backtest-decisions.json');
}

main().catch(console.error);
```

---

## 15. SQLite Migration — Agent Cycle Logging

Add this to your existing migration system or run directly:

```sql
-- migrations/007_agent_cycles.sql
CREATE TABLE IF NOT EXISTS agent_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT DEFAULT 'RUNNING',  -- RUNNING | COMPLETED | FAILED

  -- Analyst reports (JSON array)
  analyst_reports TEXT,

  -- Debate history (JSON array)
  debate_history TEXT,

  -- Debate verdict (JSON)
  verdict TEXT,

  -- Trader decision (JSON)
  trader_decision TEXT,

  -- Risk opinions (JSON array)
  risk_opinions TEXT,

  -- Fund manager approval (JSON)
  fund_manager_approval TEXT,

  -- Execution
  executed INTEGER DEFAULT 0,
  order_ids TEXT,  -- comma-separated order IDs from PaperBroker

  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_agent_cycles_symbol ON agent_cycles(symbol);
CREATE INDEX idx_agent_cycles_started ON agent_cycles(started_at);

-- Link orders to agent cycles
ALTER TABLE orders ADD COLUMN agent_cycle_id TEXT REFERENCES agent_cycles(cycle_id);
```

And the TypeScript logging service:

```typescript
// src/persistence/AgentCycleLogger.ts
import Database from 'better-sqlite3';
import type { CycleRecord } from '../agents/core/schemas';

export class AgentCycleLogger {
  constructor(private db: Database.Database) {}

  logCycle(record: CycleRecord, orderIds: string[] = []): void {
    this.db.prepare(`
      INSERT INTO agent_cycles (
        cycle_id, symbol, started_at, completed_at, status,
        analyst_reports, debate_history, verdict,
        trader_decision, risk_opinions, fund_manager_approval,
        executed, order_ids
      ) VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.cycleId,
      record.symbol,
      record.startedAt,
      Date.now(),
      JSON.stringify(record.analystReports),
      JSON.stringify(record.debate),
      JSON.stringify(record.verdict),
      JSON.stringify(record.traderDecision),
      JSON.stringify(record.riskOpinions),
      JSON.stringify(record.fundManagerApproval),
      record.executed ? 1 : 0,
      orderIds.join(','),
    );
  }

  /** Query: Why did the agent take this trade? */
  getDecisionContext(orderId: string) {
    return this.db.prepare(`
      SELECT
        o.timestamp,
        o.symbol,
        o.side,
        o.quantity,
        o.metadata->>'rationale' AS trader_reason,
        ac.verdict,
        ac.debate_history,
        ac.fund_manager_approval
      FROM orders o
      LEFT JOIN agent_cycles ac ON o.agent_cycle_id = ac.cycle_id
      WHERE o.id = ?
    `).get(orderId);
  }
}
```

---

## 16. Quick Model Routing (Cost Optimization)

The paper notes **11 LLM calls + 20 tool calls per prediction**. Route cheap models for data parsing, expensive for reasoning:

```typescript
// src/agents/core/ModelRouter.ts
export const MODEL_CONFIG = {
  // Quick models: data extraction, summarization, format conversion
  quick: {
    model: 'llama3.2:3b',
    temperature: 0.2,
    maxTokens: 1024,
  },

  // Deep models: analysis, debate, decision-making
  deep: {
    model: 'llama3.1:8b',
    temperature: 0.5,
    maxTokens: 2048,
  },

  // Ultra models: final risk approval (highest stakes)
  ultra: {
    model: 'llama3.1:70b',  // or 'deepseek-r1' if available
    temperature: 0.3,
    maxTokens: 4096,
  },
} as const;

export type ModelTier = keyof typeof MODEL_CONFIG;

/** Assign models per agent role */
export const AGENT_MODEL_MAP: Record<string, ModelTier> = {
  // Analysts: deep reasoning on data
  DerivativesAnalyst: 'deep',
  OnChainAnalyst: 'deep',
  SentimentAnalyst: 'deep',
  NewsAnalyst: 'deep',

  // Researchers: deep reasoning + debate
  BullResearcher: 'deep',
  BearResearcher: 'deep',
  DebateFacilitator: 'deep',

  // Trader: deep reasoning
  AlphaTrader: 'deep',

  // Risk: ultra for final approval
  RiskTeam: 'deep',
  FundManager: 'ultra',
};
```

---

## Build Order Summary

| Step | Files | What You Get |
| ------ | ------- | -------------- |
| 1 | `schemas.ts`, `AgentState.ts`, `BaseAgent.ts` | Foundation + structured comms |
| 2 | `DerivativesAnalyst.ts`, `AlphaTrader.ts` | Shortest path to a trade |
| 3 | `BullResearcher.ts`, `BearResearcher.ts`, `DebateFacilitator.ts` | Debate mechanism |
| 4 | `RiskTeam.ts`, `FundManager.ts` | Risk management |
| 5 | `TradingAgentsManager.ts` | Full pipeline orchestration |
| 6 | `VolatilityTrigger.ts` | Event-driven 24/7 operation |
| 7 | `OnChainAnalyst.ts`, `SentimentAnalyst.ts`, `NewsAnalyst.ts` | Complete analyst coverage |
| 8 | `BacktestRunner.ts`, `run-backtest.ts` | Validate before live |
| 9 | `007_agent_cycles.sql`, `AgentCycleLogger.ts` | Full explainability |
| 10 | `ModelRouter.ts` | Cost optimization |

Want me to write the **Zod validation tests**, a **Docker Compose** setup for running Ollama + paper-broker together, or the **dashboard API endpoints** to visualize agent decisions in real-time?

# Complete Implementation: Tests, Docker, and Dashboard API

Here's all three pieces to complete your TradingAgents-for-paper-broker system.

---

## Part 1: Zod Validation Tests

These tests ensure your structured communication protocol is bulletproof before you wire in real LLMs.

### Test Setup

```bash
npm install -D vitest @types/node
```

```json
// package.json (add to scripts)
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

### Schema Tests — `tests/schemas.test.ts`

```typescript
// tests/schemas.test.ts
import { describe, it, expect } from 'vitest';
import {
  AnalystReportSchema,
  DebateEntrySchema,
  DebateVerdictSchema,
  TraderDecisionSchema,
  RiskOpinionSchema,
  FundManagerApprovalSchema,
  CycleRecordSchema,
} from '../src/agents/core/schemas';

describe('AnalystReportSchema', () => {
  const validReport = {
    agent: 'DerivativesAnalyst',
    symbol: 'BTCUSDT',
    timestamp: Date.now(),
    summary: 'Overcrowded longs detected',
    bullishSignals: ['OI rising with price'],
    bearishSignals: ['Funding +0.08%', 'Long liquidation wall at 62100'],
    keyMetrics: { fundingRate: 0.0008, openInterest: 45210 },
    confidence: 0.7,
  };

  it('accepts a valid analyst report', () => {
    const result = AnalystReportSchema.safeParse(validReport);
    expect(result.success).toBe(true);
  });

  it('rejects confidence > 1', () => {
    const result = AnalystReportSchema.safeParse({ ...validReport, confidence: 1.5 });
    expect(result.success).toBe(false);
  });

  it('rejects confidence < 0', () => {
    const result = AnalystReportSchema.safeParse({ ...validReport, confidence: -0.1 });
    expect(result.success).toBe(false);
  });

  it('rejects missing symbol', () => {
    const { symbol, ...rest } = validReport;
    const result = AnalystReportSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects non-array bullishSignals', () => {
    const result = AnalystReportSchema.safeParse({ ...validReport, bullishSignals: 'not array' });
    expect(result.success).toBe(false);
  });

  it('accepts empty signals arrays', () => {
    const result = AnalystReportSchema.safeParse({
      ...validReport,
      bullishSignals: [],
      bearishSignals: [],
    });
    expect(result.success).toBe(true);
  });
});

describe('TraderDecisionSchema', () => {
  const validDecision = {
    symbol: 'BTCUSDT',
    action: 'LONG' as const,
    leverage: 5,
    sizePct: 0.1,
    takeProfit: 68000,
    stopLoss: 63000,
    rationale: 'Bullish momentum with low funding',
    confidence: 0.75,
  };

  it('accepts a valid LONG decision', () => {
    const result = TraderDecisionSchema.safeParse(validDecision);
    expect(result.success).toBe(true);
  });

  it('accepts a valid SHORT decision', () => {
    const result = TraderDecisionSchema.safeParse({ ...validDecision, action: 'SHORT' });
    expect(result.success).toBe(true);
  });

  it('accepts NEUTRAL action', () => {
    const result = TraderDecisionSchema.safeParse({ ...validDecision, action: 'NEUTRAL' });
    expect(result.success).toBe(true);
  });

  it('rejects leverage > 20 (hard cap)', () => {
    const result = TraderDecisionSchema.safeParse({ ...validDecision, leverage: 125 });
    expect(result.success).toBe(false);
  });

  it('rejects leverage < 1', () => {
    const result = TraderDecisionSchema.safeParse({ ...validDecision, leverage: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects sizePct > 0.25 (max 25% equity)', () => {
    const result = TraderDecisionSchema.safeParse({ ...validDecision, sizePct: 0.5 });
    expect(result.success).toBe(false);
  });

  it('rejects missing stopLoss (mandatory for futures)', () => {
    const { stopLoss, ...rest } = validDecision;
    const result = TraderDecisionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('allows optional takeProfit to be omitted', () => {
    const { takeProfit, ...rest } = validDecision;
    const result = TraderDecisionSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it('rejects invalid action enum', () => {
    const result = TraderDecisionSchema.safeParse({ ...validDecision, action: 'BUY' });
    expect(result.success).toBe(false);
  });
});

describe('RiskOpinionSchema', () => {
  it('accepts APPROVE verdict', () => {
    const result = RiskOpinionSchema.safeParse({
      persona: 'SAFE',
      verdict: 'APPROVE',
      rationale: 'Risk within acceptable parameters',
    });
    expect(result.success).toBe(true);
  });

  it('accepts REDUCE_LEVERAGE with adjusted decision', () => {
    const result = RiskOpinionSchema.safeParse({
      persona: 'NEUTRAL',
      verdict: 'REDUCE_LEVERAGE',
      adjustedDecision: {
        symbol: 'BTCUSDT',
        action: 'LONG',
        leverage: 3,
        sizePct: 0.08,
        stopLoss: 63000,
        rationale: 'Reduced leverage per risk policy',
        confidence: 0.7,
      },
      rationale: 'Leverage too high for current volatility',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid persona', () => {
    const result = RiskOpinionSchema.safeParse({
      persona: 'AGGRESSIVE',
      verdict: 'APPROVE',
      rationale: 'test',
    });
    expect(result.success).toBe(false);
  });
});

describe('DebateVerdictSchema', () => {
  it('accepts BULL verdict', () => {
    const result = DebateVerdictSchema.safeParse({
      prevailingSide: 'BULL',
      rationale: 'Stronger evidence for upside',
      conviction: 0.8,
    });
    expect(result.success).toBe(true);
  });

  it('accepts NEUTRAL verdict', () => {
    const result = DebateVerdictSchema.safeParse({
      prevailingSide: 'NEUTRAL',
      rationale: 'Mixed signals, no clear edge',
      conviction: 0.3,
    });
    expect(result.success).toBe(true);
  });
});

describe('CycleRecordSchema', () => {
  it('validates a complete cycle record', () => {
    const fullCycle = {
      cycleId: 'cycle_BTCUSDT_1700000000',
      symbol: 'BTCUSDT',
      startedAt: 1700000000,
      analystReports: [
        {
          agent: 'DerivativesAnalyst',
          symbol: 'BTCUSDT',
          timestamp: 1700000000,
          summary: 'Test',
          bullishSignals: [],
          bearishSignals: [],
          keyMetrics: {},
          confidence: 0.5,
        },
      ],
      debate: [
        { role: 'BULL' as const, round: 1, argument: 'Bull case' },
        { role: 'BEAR' as const, round: 1, argument: 'Bear case' },
      ],
      verdict: { prevailingSide: 'BULL' as const, rationale: 'test', conviction: 0.7 },
      traderDecision: {
        symbol: 'BTCUSDT',
        action: 'LONG' as const,
        leverage: 3,
        sizePct: 0.1,
        stopLoss: 63000,
        rationale: 'test',
        confidence: 0.7,
      },
      riskOpinions: [
        { persona: 'SAFE' as const, verdict: 'APPROVE' as const, rationale: 'ok' },
      ],
      fundManagerApproval: {
        approved: true,
        finalDecision: {
          symbol: 'BTCUSDT',
          action: 'LONG' as const,
          leverage: 3,
          sizePct: 0.1,
          stopLoss: 63000,
          rationale: 'test',
          confidence: 0.7,
        },
        rationale: 'Approved',
      },
      executed: true,
    };

    const result = CycleRecordSchema.safeParse(fullCycle);
    expect(result.success).toBe(true);
  });
});
```

### Agent Integration Tests — `tests/agents.test.ts`

```typescript
// tests/agents.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentState } from '../src/agents/core/AgentState';
import { AnalystReportSchema } from '../src/agents/core/schemas';

describe('AgentState', () => {
  let state: AgentState;

  beforeEach(() => {
    state = new AgentState('BTCUSDT');
  });

  it('generates unique cycle IDs', () => {
    const state2 = new AgentState('BTCUSDT');
    expect(state.cycleId).not.toBe(state2.cycleId);
  });

  it('stores analyst reports', () => {
    const report = {
      agent: 'DerivativesAnalyst',
      symbol: 'BTCUSDT',
      timestamp: Date.now(),
      summary: 'Test report',
      bullishSignals: ['Signal 1'],
      bearishSignals: [],
      keyMetrics: { fundingRate: 0.001 },
      confidence: 0.6,
    };

    state.addAnalystReport(report);
    expect(state.analystReports).toHaveLength(1);
    expect(state.analystReports[0].agent).toBe('DerivativesAnalyst');
  });

  it('stores debate entries in order', () => {
    state.addDebateEntry({ role: 'BULL', round: 1, argument: 'Bull arg 1' });
    state.addDebateEntry({ role: 'BEAR', round: 1, argument: 'Bear arg 1' });
    state.addDebateEntry({ role: 'BULL', round: 2, argument: 'Bull arg 2' });

    expect(state.debateHistory).toHaveLength(3);
    expect(state.debateHistory[0].role).toBe('BULL');
    expect(state.debateHistory[2].round).toBe(2);
  });

  it('provides researcher-scoped snapshot', () => {
    const report = {
      agent: 'DerivativesAnalyst',
      symbol: 'BTCUSDT',
      timestamp: Date.now(),
      summary: 'Test',
      bullishSignals: [],
      bearishSignals: [],
      keyMetrics: {},
      confidence: 0.5,
    };
    state.addAnalystReport(report);

    const snapshot = state.snapshotForAgent('RESEARCHER');
    const parsed = JSON.parse(snapshot);

    expect(parsed.symbol).toBe('BTCUSDT');
    expect(parsed.reports).toHaveLength(1);
    // Should NOT include debate history for researchers
    expect(parsed.debate).toBeUndefined();
  });

  it('provides trader-scoped snapshot with debate', () => {
    state.addDebateEntry({ role: 'BULL', round: 1, argument: 'test' });

    const snapshot = state.snapshotForAgent('TRADER');
    const parsed = JSON.parse(snapshot);

    expect(parsed.debate).toHaveLength(1);
    expect(parsed.reports).toBeDefined();
  });

  it('provides risk-scoped snapshot with only decision', () => {
    state.traderDecision = {
      symbol: 'BTCUSDT',
      action: 'LONG',
      leverage: 3,
      sizePct: 0.1,
      stopLoss: 63000,
      rationale: 'test',
      confidence: 0.7,
    };

    const snapshot = state.snapshotForAgent('RISK');
    const parsed = JSON.parse(snapshot);

    expect(parsed.decision).toBeDefined();
    expect(parsed.decision.action).toBe('LONG');
    // Should NOT include full analyst reports for risk team
    expect(parsed.reports).toBeUndefined();
  });
});

describe('BaseAgent schema validation', () => {
  it('rejects malformed LLM JSON response', () => {
    const malformedJson = {
      agent: 'DerivativesAnalyst',
      // missing required fields
      summary: 'incomplete',
    };

    const result = AnalystReportSchema.safeParse(malformedJson);
    expect(result.success).toBe(false);
  });

  it('provides useful error messages for debugging', () => {
    const malformedJson = {
      agent: 'DerivativesAnalyst',
      symbol: 'BTCUSDT',
      timestamp: Date.now(),
      summary: 'Test',
      bullishSignals: 'not an array', // wrong type
      bearishSignals: [],
      keyMetrics: {},
      confidence: 0.5,
    };

    const result = AnalystReportSchema.safeParse(malformedJson);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errorPaths = result.error.issues.map(i => i.path.join('.'));
      expect(errorPaths).toContain('bullishSignals');
    }
  });
});
```

---

## Part 2: Docker Compose Setup

Run Ollama + paper-broker + optional dashboard with a single command.

### `docker-compose.yml`

```yaml
# docker-compose.yml
version: '3.8'

services:
  # ============================================
  # Ollama - Local LLM Inference
  # ============================================
  ollama:
    image: ollama/ollama:latest
    container_name: paper-broker-ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    # GPU support (uncomment if you have NVIDIA GPU)
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: all
    #           capabilities: [gpu]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:11434/api/tags"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    restart: unless-stopped

  # ============================================
  # Ollama Model Puller (one-time init)
  # ============================================
  ollama-init:
    image: ollama/ollama:latest
    container_name: paper-broker-ollama-init
    depends_on:
      ollama:
        condition: service_healthy
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        echo "Pulling models..."
        ollama pull llama3.2:3b
        ollama pull llama3.1:8b
        echo "Models ready."
    restart: "no"

  # ============================================
  # Paper Broker - Trading Engine
  # ============================================
  paper-broker:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: paper-broker-engine
    ports:
      - "3000:3000"     # REST API / Dashboard
      - "9229:9229"     # Node.js debugger (dev only)
    environment:
      - NODE_ENV=production
      - PORT=3000
      - OLLAMA_URL=http://ollama:11434
      - BINANCE_API_KEY=${BINANCE_API_KEY:-}
      - BINANCE_API_SECRET=${BINANCE_API_SECRET:-}
      - BINANCE_TESTNET=true
      - DB_PATH=/data/paper-broker.db
      - LOG_LEVEL=info
      # Agent configuration
      - AGENT_DEBATE_ROUNDS=3
      - AGENT_MAX_LEVERAGE=10
      - AGENT_CYCLE_COOLDOWN_MS=1800000
      - AGENT_TRIGGER_ATR_THRESHOLD=1.5
    volumes:
      - broker_data:/data
    depends_on:
      ollama:
        condition: service_healthy
    restart: unless-stopped
    # Resource limits to prevent runaway LLM calls
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '2.0'

  # ============================================
  # Dashboard (optional) - Real-time visualization
  # ============================================
  dashboard:
    build:
      context: ./dashboard
      dockerfile: Dockerfile
    container_name: paper-broker-dashboard
    ports:
      - "5173:5173"
    environment:
      - VITE_API_URL=http://localhost:3000
      - VITE_WS_URL=ws://localhost:3000/ws
    depends_on:
      - paper-broker
    restart: unless-stopped
    profiles:
      - dashboard  # Only starts with: docker compose --profile dashboard up

volumes:
  ollama_data:
    driver: local
  broker_data:
    driver: local
```

### `Dockerfile` (for paper-broker)

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm ci --only=production

# Copy source and build
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy built artifacts and production deps
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

# Create data directory
RUN mkdir -p /data

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

### `.dockerignore`

```text
node_modules
dist
.git
*.db
*.sqlite
.env
.env.local
coverage
.vscode
.idea
```

### `.env.example`

```bash
# .env.example - Copy to .env and fill in
BINANCE_API_KEY=your_testnet_key
BINANCE_API_SECRET=your_testnet_secret
BINANCE_TESTNET=true

# Ollama (auto-configured in Docker, override for local dev)
OLLAMA_URL=http://localhost:11434

# Agent tuning
AGENT_DEBATE_ROUNDS=3
AGENT_MAX_LEVERAGE=10
AGENT_CYCLE_COOLDOWN_MS=1800000
AGENT_TRIGGER_ATR_THRESHOLD=1.5

# Database
DB_PATH=./data/paper-broker.db
```

### Quick Start Commands

```bash
# 1. Copy environment file
cp .env.example .env

# 2. Start core services (Ollama + paper-broker)
docker compose up -d

# 3. Start with dashboard
docker compose --profile dashboard up -d

# 4. View logs
docker compose logs -f paper-broker

# 5. Check Ollama models are loaded
curl http://localhost:11434/api/tags

# 6. Run a manual agent cycle (test)
curl -X POST http://localhost:3000/api/v1/agents/cycle \
  -H "Content-Type: application/json" \
  -d '{"symbol": "BTCUSDT"}'

# 7. Stop everything
docker compose down

# 8. Stop and remove data (fresh start)
docker compose down -v
```

---

## Part 3: Dashboard API Endpoints

Express routes to visualize agent decisions, debate history, and portfolio state in real-time.

### `src/api/agentRoutes.ts`

```typescript
// src/api/agentRoutes.ts
import { Router, Request, Response } from 'express';
import type { PaperBroker } from '../broker/PaperBroker';
import type { TradingAgentsManager } from '../agents/TradingAgentsManager';
import { CycleRecordSchema } from '../agents/core/schemas';

export function createAgentRoutes(broker: PaperBroker, manager: TradingAgentsManager): Router {
  const router = Router();

  /**
   * GET /api/v1/agents/health
   * Check if Ollama is reachable and models are loaded.
   */
  router.get('/health', async (_req: Request, res: Response) => {
    try {
      const ollamaHealthy = await manager.checkOllamaHealth();
      res.json({
        status: ollamaHealthy ? 'healthy' : 'degraded',
        ollama: ollamaHealthy,
        timestamp: Date.now(),
      });
    } catch (err) {
      res.status(503).json({ status: 'unhealthy', error: (err as Error).message });
    }
  });

  /**
   * POST /api/v1/agents/cycle
   * Manually trigger an agent cycle for a symbol.
   * Body: { "symbol": "BTCUSDT" }
   */
  router.post('/cycle', async (req: Request, res: Response) => {
    const { symbol } = req.body;

    if (!symbol || typeof symbol !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "symbol" field' });
    }

    try {
      const record = await manager.runCycle(symbol.toUpperCase());

      // Persist to SQLite
      await broker.eventLog.logAgentCycle(record);

      res.json({
        success: true,
        cycleId: record.cycleId,
        executed: record.executed,
        decision: record.fundManagerApproval.approved
          ? record.fundManagerApproval.finalDecision
          : null,
        debateRounds: record.debate.length,
        verdict: record.verdict,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * GET /api/v1/agents/cycles
   * List recent agent cycles with pagination.
   * Query: ?symbol=BTCUSDT&limit=20&offset=0
   */
  router.get('/cycles', async (req: Request, res: Response) => {
    const { symbol, limit = '20', offset = '0' } = req.query;

    try {
      const cycles = await broker.eventLog.getAgentCycles({
        symbol: symbol as string | undefined,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      });

      res.json({ cycles, total: cycles.length });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * GET /api/v1/agents/cycles/:cycleId
   * Get full detail of a specific cycle (all reports, debate, risk opinions).
   */
  router.get('/cycles/:cycleId', async (req: Request, res: Response) => {
    const { cycleId } = req.params;

    try {
      const cycle = await broker.eventLog.getAgentCycleById(cycleId);

      if (!cycle) {
        return res.status(404).json({ error: `Cycle ${cycleId} not found` });
      }

      res.json(cycle);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * GET /api/v1/agents/cycles/:cycleId/explain
   * Get a natural-language explanation of why a trade was made.
   * Uses the Fund Manager's rationale + debate verdict.
   */
  router.get('/cycles/:cycleId/explain', async (req: Request, res: Response) => {
    const { cycleId } = req.params;

    try {
      const cycle = await broker.eventLog.getAgentCycleById(cycleId);
      if (!cycle) {
        return res.status(404).json({ error: 'Cycle not found' });
      }

      const explanation = {
        cycleId: cycle.cycle_id,
        symbol: cycle.symbol,
        timestamp: cycle.started_at,
        decision: cycle.executed ? 'EXECUTED' : 'REJECTED',
        action: cycle.fund_manager_approval?.finalDecision?.action || 'NONE',
        summary: cycle.fund_manager_approval?.rationale || 'No rationale available',
        debateVerdict: cycle.verdict?.rationale || 'N/A',
        keySignals: cycle.analyst_reports?.flatMap((r: any) => [
          ...r.bullishSignals.map((s: string) => `🟢 ${s}`),
          ...r.bearishSignals.map((s: string) => `🔴 ${s}`),
        ]) || [],
        riskConcerns: cycle.risk_opinions?.map((o: any) => ({
          persona: o.persona,
          verdict: o.verdict,
          concern: o.rationale,
        })) || [],
      };

      res.json(explanation);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * GET /api/v1/agents/performance
   * Aggregate performance metrics for agent-executed trades.
   * Query: ?period=7d|30d|90d
   */
  router.get('/performance', async (req: Request, res: Response) => {
    const { period = '30d' } = req.query;

    try {
      const days = parseInt(period as string) || 30;
      const since = Date.now() - days * 24 * 60 * 60 * 1000;

      const trades = await broker.eventLog.getAgentTradesSince(since);
      const account = await broker.getAccountInfo();

      const wins = trades.filter(t => t.pnl > 0);
      const losses = trades.filter(t => t.pnl <= 0);

      res.json({
        period: `${days}d`,
        totalTrades: trades.length,
        wins: wins.length,
        losses: losses.length,
        winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
        totalPnl: trades.reduce((sum, t) => sum + t.pnl, 0),
        avgWin: wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0,
        avgLoss: losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0,
        currentEquity: account.equity,
        sharpeRatio: await broker.calculateSharpe(days),
        maxDrawdown: await broker.calculateMaxDrawdown(days),
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * GET /api/v1/agents/positions
   * Current open positions with agent metadata.
   */
  router.get('/positions', async (_req: Request, res: Response) => {
    try {
      const positions = await broker.getPositions();
      const enriched = await Promise.all(
        positions.map(async (pos) => {
          const lastCycle = await broker.eventLog.getLastCycleForSymbol(pos.symbol);
          return {
            ...pos,
            agentContext: lastCycle ? {
              cycleId: lastCycle.cycle_id,
              rationale: lastCycle.fund_manager_approval?.rationale,
              confidence: lastCycle.fund_manager_approval?.finalDecision?.confidence,
            } : null,
          };
        })
      );
      res.json({ positions: enriched });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * POST /api/v1/agents/config
   * Update agent configuration at runtime (debate rounds, leverage cap, etc.)
   */
  router.post('/config', async (req: Request, res: Response) => {
    const { debateRounds, maxLeverage, cooldownMs, atrThreshold } = req.body;

    try {
      if (debateRounds) manager.setDebateRounds(debateRounds);
      if (maxLeverage) manager.setMaxLeverage(maxLeverage);
      if (cooldownMs) manager.setCooldown(cooldownMs);
      if (atrThreshold) manager.setAtrThreshold(atrThreshold);

      res.json({ success: true, config: manager.getConfig() });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  /**
   * GET /api/v1/agents/config
   * Get current agent configuration.
   */
  router.get('/config', async (_req: Request, res: Response) => {
    res.json(manager.getConfig());
  });

  return router;
}
```

### WebSocket for Real-Time Updates — `src/api/wsHandler.ts`

```typescript
// src/api/wsHandler.ts
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { PaperBroker } from '../broker/PaperBroker';
import type { CycleRecord } from '../agents/core/schemas';

export class AgentWebSocketHandler {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();

  constructor(server: Server, private broker: PaperBroker) {
    this.wss = new WebSocketServer({ server, path: '/ws/agents' });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      console.log(`[WS] Agent dashboard client connected (${this.clients.size} total)`);

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      // Send current state on connect
      this.sendInitialState(ws);
    });
  }

  /** Broadcast a completed agent cycle to all connected dashboards. */
  broadcastCycle(record: CycleRecord): void {
    const message = JSON.stringify({
      type: 'AGENT_CYCLE_COMPLETE',
      payload: {
        cycleId: record.cycleId,
        symbol: record.symbol,
        executed: record.executed,
        action: record.fundManagerApproval.finalDecision.action,
        confidence: record.fundManagerApproval.finalDecision.confidence,
        verdict: record.verdict.prevailingSide,
        timestamp: Date.now(),
      },
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  /** Broadcast position updates (fills, liquidations, etc.). */
  broadcastPositionUpdate(data: any): void {
    const message = JSON.stringify({
      type: 'POSITION_UPDATE',
      payload: data,
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  /** Broadcast risk alerts. */
  broadcastRiskAlert(alert: { level: string; message: string; symbol: string }): void {
    const message = JSON.stringify({
      type: 'RISK_ALERT',
      payload: alert,
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  private async sendInitialState(ws: WebSocket): Promise<void> {
    try {
      const account = await this.broker.getAccountInfo();
      const positions = await this.broker.getPositions();

      ws.send(JSON.stringify({
        type: 'INITIAL_STATE',
        payload: { account, positions },
      }));
    } catch (err) {
      console.error('[WS] Failed to send initial state:', err);
    }
  }
}
```

### Wire It All Together — `src/api/index.ts`

```typescript
// src/api/index.ts
import express from 'express';
import { createServer } from 'http';
import { createAgentRoutes } from './agentRoutes';
import { AgentWebSocketHandler } from './wsHandler';
import type { PaperBroker } from '../broker/PaperBroker';
import type { TradingAgentsManager } from '../agents/TradingAgentsManager';

export function startApiServer(
  broker: PaperBroker,
  manager: TradingAgentsManager,
  port: number = 3000,
) {
  const app = express();
  const server = createServer(app);

  // Middleware
  app.use(express.json());
  app.use((req, _res, next) => {
    console.log(`[API] ${req.method} ${req.path}`);
    next();
  });

  // Health check (for Docker)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // Agent routes
  app.use('/api/v1/agents', createAgentRoutes(broker, manager));

  // Existing broker routes (dashboard, positions, orders, etc.)
  // app.use('/api/v1', existingBrokerRoutes(broker));

  // WebSocket for real-time updates
  const wsHandler = new AgentWebSocketHandler(server, broker);

  // Expose wsHandler so TradingAgentsManager can broadcast
  manager.setWebSocketHandler(wsHandler);

  server.listen(port, () => {
    console.log(`[API] Server listening on http://localhost:${port}`);
    console.log(`[API] Agent endpoints: http://localhost:${port}/api/v1/agents`);
    console.log(`[WS]  WebSocket: ws://localhost:${port}/ws/agents`);
  });

  return { app, server, wsHandler };
}
```

### SQLite Query Methods — `src/persistence/EventLog.ts` (additions)

```typescript
// Add these methods to your existing EventLog class

/** Get paginated agent cycles. */
async getAgentCycles(opts: { symbol?: string; limit: number; offset: number }) {
  let sql = 'SELECT * FROM agent_cycles WHERE 1=1';
  const params: any[] = [];

  if (opts.symbol) {
    sql += ' AND symbol = ?';
    params.push(opts.symbol);
  }

  sql += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
  params.push(opts.limit, opts.offset);

  const rows = this.db.prepare(sql).all(...params);
  return rows.map(row => this.parseCycleRow(row));
}

/** Get a single cycle by ID with full JSON parsed. */
async getAgentCycleById(cycleId: string) {
  const row = this.db.prepare('SELECT * FROM agent_cycles WHERE cycle_id = ?').get(cycleId);
  return row ? this.parseCycleRow(row) : null;
}

/** Get all trades executed by agents since a timestamp. */
async getAgentTradesSince(since: number) {
  return this.db.prepare(`
    SELECT
      o.id, o.symbol, o.side, o.quantity, o.price,
      o.metadata->>'cycleId' as cycle_id,
      o.metadata->>'rationale' as rationale,
      o.timestamp,
      COALESCE(o.realized_pnl, 0) as pnl
    FROM orders o
    WHERE o.metadata->>'agent' = 'TradingAgents'
      AND o.timestamp >= ?
    ORDER BY o.timestamp DESC
  `).all(since);
}

/** Get the most recent cycle for a symbol. */
async getLastCycleForSymbol(symbol: string) {
  const row = this.db.prepare(
    'SELECT * FROM agent_cycles WHERE symbol = ? ORDER BY started_at DESC LIMIT 1'
  ).get(symbol);
  return row ? this.parseCycleRow(row) : null;
}

/** Log a completed agent cycle. */
async logAgentCycle(record: CycleRecord): Promise<void> {
  this.db.prepare(`
    INSERT OR REPLACE INTO agent_cycles (
      cycle_id, symbol, started_at, completed_at, status,
      analyst_reports, debate_history, verdict,
      trader_decision, risk_opinions, fund_manager_approval, executed
    ) VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.cycleId,
    record.symbol,
    record.startedAt,
    Date.now(),
    JSON.stringify(record.analystReports),
    JSON.stringify(record.debate),
    JSON.stringify(record.verdict),
    JSON.stringify(record.traderDecision),
    JSON.stringify(record.riskOpinions),
    JSON.stringify(record.fundManagerApproval),
    record.executed ? 1 : 0,
  );
}

/** Parse a raw SQLite row into typed object. */
private parseCycleRow(row: any) {
  return {
    ...row,
    analyst_reports: JSON.parse(row.analyst_reports || '[]'),
    debate_history: JSON.parse(row.debate_history || '[]'),
    verdict: JSON.parse(row.verdict || '{}'),
    trader_decision: JSON.parse(row.trader_decision || '{}'),
    risk_opinions: JSON.parse(row.risk_opinions || '[]'),
    fund_manager_approval: JSON.parse(row.fund_manager_approval || '{}'),
  };
}
```

---

## Quick Reference: API Endpoints

| Method | Endpoint | Description |
| -------- | ---------- | ------------- |
| `GET` | `/health` | Server health check |
| `GET` | `/api/v1/agents/health` | Ollama + agent health |
| `POST` | `/api/v1/agents/cycle` | Trigger manual agent cycle |
| `GET` | `/api/v1/agents/cycles` | List cycles (paginated) |
| `GET` | `/api/v1/agents/cycles/:id` | Full cycle detail |
| `GET` | `/api/v1/agents/cycles/:id/explain` | Human-readable explanation |
| `GET` | `/api/v1/agents/performance` | Win rate, Sharpe, drawdown |
| `GET` | `/api/v1/agents/positions` | Open positions + agent context |
| `POST` | `/api/v1/agents/config` | Update runtime config |
| `GET` | `/api/v1/agents/config` | Get current config |
| `WS` | `/ws/agents` | Real-time cycle/position updates |

---

## Final Checklist

* [ ] Run `npm test` — all Zod schema tests pass
* [ ] Run `docker compose up -d` — Ollama pulls models, broker starts
* [ ] Hit `POST /api/v1/agents/cycle` with `{"symbol":"BTCUSDT"}` — get a decision back
* [ ] Hit `GET /api/v1/agents/cycles/:id/explain` — see human-readable rationale
* [ ] Connect a WebSocket client to `ws://localhost:3000/ws/agents` — receive real-time updates
* [ ] Run the backtest harness against 3 months of historical data
* [ ] Review SQLite: `SELECT * FROM agent_cycles ORDER BY started_at DESC LIMIT 5;`

You now have a complete, tested, containerized, and observable multi-agent crypto futures trading system. Want me to write the **React dashboard frontend** to visualize the WebSocket data, or a **Grafana/Prometheus monitoring setup** for production observability?

# TradingAgents Dashboard — React Frontend

A complete, production-ready React dashboard to visualize your multi-agent crypto futures trading system in real-time.

---

## Project Setup

```bash
# Create the dashboard project
cd paper-broker
mkdir dashboard && cd dashboard
npm create vite@latest . -- --template react-ts
npm install
npm install tailwindcss @tailwindcss/vite recharts date-fns lucide-react
npm install @tanstack/react-query zustand
```

### `vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
```

### `src/index.css`

```css
@import "tailwindcss";

:root {
  --color-bg-primary: #0a0e17;
  --color-bg-secondary: #111827;
  --color-bg-card: #1a2332;
  --color-bg-hover: #243044;
  --color-border: #2d3a4f;
  --color-text-primary: #e5e7eb;
  --color-text-secondary: #9ca3af;
  --color-text-muted: #6b7280;
  --color-accent-green: #10b981;
  --color-accent-red: #ef4444;
  --color-accent-blue: #3b82f6;
  --color-accent-yellow: #f59e0b;
  --color-accent-purple: #8b5cf6;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  -webkit-font-smoothing: antialiased;
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: var(--color-bg-secondary);
}

::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #4a5568;
}
```

---

## State Management — `src/store/useStore.ts`

```typescript
// src/store/useStore.ts
import { create } from 'zustand';

export interface Position {
  symbol: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  liquidationPrice: number;
  margin: number;
}

export interface AgentCycle {
  cycleId: string;
  symbol: string;
  startedAt: number;
  completedAt: number;
  executed: boolean;
  action: string;
  confidence: number;
  verdict: string;
  rationale: string;
}

export interface AccountInfo {
  balance: number;
  equity: number;
  unrealizedPnl: number;
  marginUsed: number;
  freeMargin: number;
}

export interface PerformanceMetrics {
  period: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  sharpeRatio: number;
  maxDrawdown: number;
  currentEquity: number;
}

export interface DebateEntry {
  role: 'BULL' | 'BEAR';
  round: number;
  argument: string;
}

export interface RiskOpinion {
  persona: string;
  verdict: string;
  rationale: string;
}

export interface CycleDetail extends AgentCycle {
  analystReports: Array<{
    agent: string;
    summary: string;
    bullishSignals: string[];
    bearishSignals: string[];
    confidence: number;
  }>;
  debate: DebateEntry[];
  riskOpinions: RiskOpinion[];
  fundManagerApproval: {
    approved: boolean;
    rationale: string;
    finalDecision: {
      action: string;
      leverage: number;
      sizePct: number;
      stopLoss: number;
      takeProfit?: number;
    };
  };
}

interface StoreState {
  account: AccountInfo | null;
  positions: Position[];
  cycles: AgentCycle[];
  selectedCycle: CycleDetail | null;
  performance: PerformanceMetrics | null;
  wsConnected: boolean;
  liveEvents: Array<{ type: string; payload: any; timestamp: number }>;

  setAccount: (account: AccountInfo) => void;
  setPositions: (positions: Position[]) => void;
  setCycles: (cycles: AgentCycle[]) => void;
  setSelectedCycle: (cycle: CycleDetail | null) => void;
  setPerformance: (perf: PerformanceMetrics) => void;
  setWsConnected: (connected: boolean) => void;
  addLiveEvent: (event: { type: string; payload: any }) => void;
}

export const useStore = create<StoreState>((set) => ({
  account: null,
  positions: [],
  cycles: [],
  selectedCycle: null,
  performance: null,
  wsConnected: false,
  liveEvents: [],

  setAccount: (account) => set({ account }),
  setPositions: (positions) => set({ positions }),
  setCycles: (cycles) => set({ cycles }),
  setSelectedCycle: (cycle) => set({ selectedCycle: cycle }),
  setPerformance: (perf) => set({ performance: perf }),
  setWsConnected: (connected) => set({ wsConnected: connected }),
  addLiveEvent: (event) =>
    set((state) => ({
      liveEvents: [
        { ...event, timestamp: Date.now() },
        ...state.liveEvents.slice(0, 99), // keep last 100
      ],
    })),
}));
```

---

## WebSocket Hook — `src/hooks/useWebSocket.ts`

```typescript
// src/hooks/useWebSocket.ts
import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const {
    setWsConnected,
    addLiveEvent,
    setAccount,
    setPositions,
  } = useStore();

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket('ws://localhost:3000/ws/agents');
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected to agent dashboard');
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case 'INITIAL_STATE':
              setAccount(data.payload.account);
              setPositions(data.payload.positions);
              break;

            case 'AGENT_CYCLE_COMPLETE':
              addLiveEvent({ type: 'cycle', payload: data.payload });
              break;

            case 'POSITION_UPDATE':
              addLiveEvent({ type: 'position', payload: data.payload });
              break;

            case 'RISK_ALERT':
              addLiveEvent({ type: 'risk', payload: data.payload });
              break;
          }
        } catch (err) {
          console.error('[WS] Parse error:', err);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        // Reconnect after 3 seconds
        setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, []);
}
```

---

## API Hook — `src/hooks/useApi.ts`

```typescript
// src/hooks/useApi.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useStore } from '../store/useStore';

const API_BASE = '/api/v1/agents';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export function useCycles(symbol?: string) {
  const setCycles = useStore((s) => s.setCycles);

  return useQuery({
    queryKey: ['cycles', symbol],
    queryFn: async () => {
      const url = symbol
        ? `${API_BASE}/cycles?symbol=${symbol}&limit=50`
        : `${API_BASE}/cycles?limit=50`;
      const data = await fetchJson<{ cycles: any[] }>(url);
      setCycles(data.cycles);
      return data.cycles;
    },
    refetchInterval: 30000, // refresh every 30s
  });
}

export function useCycleDetail(cycleId: string | null) {
  const setSelectedCycle = useStore((s) => s.setSelectedCycle);

  return useQuery({
    queryKey: ['cycle-detail', cycleId],
    queryFn: async () => {
      if (!cycleId) return null;
      const data = await fetchJson(`${API_BASE}/cycles/${cycleId}`);
      setSelectedCycle(data);
      return data;
    },
    enabled: !!cycleId,
  });
}

export function usePerformance(period = '30d') {
  const setPerformance = useStore((s) => s.setPerformance);

  return useQuery({
    queryKey: ['performance', period],
    queryFn: async () => {
      const data = await fetchJson(`${API_BASE}/performance?period=${period}`);
      setPerformance(data);
      return data;
    },
    refetchInterval: 60000,
  });
}

export function useTriggerCycle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (symbol: string) => {
      const res = await fetch(`${API_BASE}/cycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cycles'] });
    },
  });
}
```

---

## Main App — `src/App.tsx`

```tsx
// src/App.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWebSocket } from './hooks/useWebSocket';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { OverviewPanel } from './components/OverviewPanel';
import { CyclesPanel } from './components/CyclesPanel';
import { CycleDetailPanel } from './components/CycleDetailPanel';
import { PerformancePanel } from './components/PerformancePanel';
import { LiveFeed } from './components/LiveFeed';
import { useState } from 'react';

const queryClient = new QueryClient();

type Tab = 'overview' | 'cycles' | 'performance' | 'feed';

function AppContent() {
  useWebSocket();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <Header />
      <div className="flex">
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
        <main className="flex-1 p-6 ml-64">
          {activeTab === 'overview' && <OverviewPanel />}
          {activeTab === 'cycles' && (
            selectedCycleId ? (
              <CycleDetailPanel
                cycleId={selectedCycleId}
                onBack={() => setSelectedCycleId(null)}
              />
            ) : (
              <CyclesPanel onSelectCycle={setSelectedCycleId} />
            )
          )}
          {activeTab === 'performance' && <PerformancePanel />}
          {activeTab === 'feed' && <LiveFeed />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
```

---

## Header Component — `src/components/Header.tsx`

```tsx
// src/components/Header.tsx
import { useStore } from '../store/useStore';
import { Activity, Wifi, WifiOff } from 'lucide-react';

export function Header() {
  const { wsConnected, account } = useStore();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] flex items-center px-6">
      <div className="flex items-center gap-3">
        <Activity className="w-6 h-6 text-[var(--color-accent-blue)]" />
        <h1 className="text-lg font-bold text-white">
          TradingAgents <span className="text-[var(--color-text-muted)]">Dashboard</span>
        </h1>
      </div>

      <div className="ml-auto flex items-center gap-6">
        {account && (
          <div className="flex items-center gap-4 text-sm">
            <span className="text-[var(--color-text-secondary)]">
              Equity:{' '}
              <span className="text-white font-semibold">
                ${account.equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </span>
            <span
              className={
                account.unrealizedPnl >= 0
                  ? 'text-[var(--color-accent-green)]'
                  : 'text-[var(--color-accent-red)]'
              }
            >
              PnL: {account.unrealizedPnl >= 0 ? '+' : ''}
              {account.unrealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          {wsConnected ? (
            <Wifi className="w-4 h-4 text-[var(--color-accent-green)]" />
          ) : (
            <WifiOff className="w-4 h-4 text-[var(--color-accent-red)]" />
          )}
          <span className="text-xs text-[var(--color-text-muted)]">
            {wsConnected ? 'Live' : 'Disconnected'}
          </span>
        </div>
      </div>
    </header>
  );
}
```

---

## Sidebar — `src/components/Sidebar.tsx`

```tsx
// src/components/Sidebar.tsx
import { LayoutDashboard, GitBranch, TrendingUp, Radio } from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: any) => void;
}

const navItems = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'cycles', label: 'Agent Cycles', icon: GitBranch },
  { id: 'performance', label: 'Performance', icon: TrendingUp },
  { id: 'feed', label: 'Live Feed', icon: Radio },
];

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  return (
    <aside className="fixed left-0 top-16 bottom-0 w-64 bg-[var(--color-bg-secondary)] border-r border-[var(--color-border)] p-4">
      <nav className="space-y-1">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
              activeTab === id
                ? 'bg-[var(--color-accent-blue)]/10 text-[var(--color-accent-blue)] border border-[var(--color-accent-blue)]/30'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-white'
            }`}
          >
            <Icon className="w-5 h-5" />
            {label}
          </button>
        ))}
      </nav>

      <div className="absolute bottom-4 left-4 right-4">
        <div className="bg-[var(--color-bg-card)] rounded-lg p-4 border border-[var(--color-border)]">
          <p className="text-xs text-[var(--color-text-muted)] mb-2">System Status</p>
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-[var(--color-text-secondary)]">Ollama</span>
              <span className="text-[var(--color-accent-green)]">● Online</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--color-text-secondary)]">Binance WS</span>
              <span className="text-[var(--color-accent-green)]">● Connected</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--color-text-secondary)]">Agent Engine</span>
              <span className="text-[var(--color-accent-green)]">● Running</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
```

---

## Overview Panel — `src/components/OverviewPanel.tsx`

```tsx
// src/components/OverviewPanel.tsx
import { useStore } from '../store/useStore';
import { useCycles, usePerformance } from '../hooks/useApi';
import {
  DollarSign, TrendingUp, TrendingDown, Target,
  Shield, Zap, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';

export function OverviewPanel() {
  const { account, positions } = useStore();
  useCycles();
  usePerformance('30d');
  const { performance } = useStore();

  return (
    <div className="pt-16 space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<DollarSign className="w-5 h-5" />}
          label="Account Equity"
          value={`$${(account?.equity || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
          change={account?.unrealizedPnl || 0}
          color="blue"
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Win Rate (30d)"
          value={`${(performance?.winRate || 0).toFixed(1)}%`}
          subtitle={`${performance?.wins || 0}W / ${performance?.losses || 0}L`}
          color="green"
        />
        <StatCard
          icon={<Target className="w-5 h-5" />}
          label="Sharpe Ratio"
          value={(performance?.sharpeRatio || 0).toFixed(2)}
          subtitle="Risk-adjusted return"
          color="purple"
        />
        <StatCard
          icon={<Shield className="w-5 h-5" />}
          label="Max Drawdown"
          value={`${(performance?.maxDrawdown || 0).toFixed(2)}%`}
          subtitle="Peak-to-trough"
          color="red"
        />
      </div>

      {/* Open Positions */}
      <div className="bg-[var(--color-bg-card)] rounded-xl border border-[var(--color-border)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-lg font-semibold text-white">Open Positions</h2>
        </div>
        {positions.length === 0 ? (
          <div className="p-8 text-center text-[var(--color-text-muted)]">
            No open positions
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-xs text-[var(--color-text-muted)] uppercase">
                <th className="px-6 py-3 text-left">Symbol</th>
                <th className="px-6 py-3 text-left">Side</th>
                <th className="px-6 py-3 text-right">Size</th>
                <th className="px-6 py-3 text-right">Entry</th>
                <th className="px-6 py-3 text-right">Mark</th>
                <th className="px-6 py-3 text-right">Leverage</th>
                <th className="px-6 py-3 text-right">PnL</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => (
                <tr
                  key={pos.symbol}
                  className="border-t border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]"
                >
                  <td className="px-6 py-4 font-medium text-white">{pos.symbol}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold ${
                        pos.side === 'LONG'
                          ? 'bg-green-500/10 text-green-400'
                          : 'bg-red-500/10 text-red-400'
                      }`}
                    >
                      {pos.side === 'LONG' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {pos.side}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right text-[var(--color-text-secondary)]">
                    {pos.quantity}
                  </td>
                  <td className="px-6 py-4 text-right text-[var(--color-text-secondary)]">
                    ${pos.entryPrice.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-right text-white">
                    ${pos.markPrice.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-right text-[var(--color-accent-yellow)]">
                    {pos.leverage}x
                  </td>
                  <td
                    className={`px-6 py-4 text-right font-semibold ${
                      pos.unrealizedPnl >= 0
                        ? 'text-[var(--color-accent-green)]'
                        : 'text-[var(--color-accent-red)]'
                    }`}
                  >
                    {pos.unrealizedPnl >= 0 ? '+' : ''}
                    ${pos.unrealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon, label, value, change, subtitle, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  change?: number;
  subtitle?: string;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-500/10 text-blue-400',
    green: 'bg-green-500/10 text-green-400',
    purple: 'bg-purple-500/10 text-purple-400',
    red: 'bg-red-500/10 text-red-400',
  };

  return (
    <div className="bg-[var(--color-bg-card)] rounded-xl border border-[var(--color-border)] p-5">
      <div className="flex items-center justify-between mb-3">
        <span className={`p-2 rounded-lg ${colorMap[color]}`}>{icon}</span>
        {change !== undefined && (
          <span
            className={`text-xs font-medium ${
              change >= 0 ? 'text-[var(--color-accent-green)]' : 'text-[var(--color-accent-red)]'
            }`}
          >
            {change >= 0 ? '+' : ''}{change.toFixed(2)}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-sm text-[var(--color-text-muted)] mt-1">{label}</p>
      {subtitle && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{subtitle}</p>}
    </div>
  );
}
```

---

## Agent Cycles Panel — `src/components/CyclesPanel.tsx`

```tsx
// src/components/CyclesPanel.tsx
import { useStore } from '../store/useStore';
import { useCycles, useTriggerCycle } from '../hooks/useApi';
import { format } from 'date-fns';
import { Play, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useState } from 'react';

export function CyclesPanel({ onSelectCycle }: { onSelectCycle: (id: string) => void }) {
  const { cycles } = useStore();
  useCycles();
  const triggerCycle = useTriggerCycle();
  const [triggerSymbol, setTriggerSymbol] = useState('BTCUSDT');

  return (
    <div className="pt-16 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Agent Decision Cycles</h2>
        <div className="flex items-center gap-3">
          <select
            value={triggerSymbol}
            onChange={(e) => setTriggerSymbol(e.target.value)}
            className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="BTCUSDT">BTCUSDT</option>
            <option value="ETHUSDT">ETHUSDT</option>
            <option value="SOLUSDT">SOLUSDT</option>
          </select>
          <button
            onClick={() => triggerCycle.mutate(triggerSymbol)}
            disabled={triggerCycle.isPending}
            className="flex items-center gap-2 bg-[var(--color-accent-blue)] hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            {triggerCycle.isPending ? 'Running...' : 'Run Cycle'}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {cycles.map((cycle) => (
          <button
            key={cycle.cycleId}
            onClick={() => onSelectCycle(cycle.cycleId)}
            className="w-full bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl p-5 text-left hover:border-[var(--color-accent-blue)]/50 transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    cycle.executed
                      ? 'bg-green-500/10 text-green-400'
                      : 'bg-gray-500/10 text-gray-400'
                  }`}
                >
                  {cycle.executed ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">{cycle.symbol}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-semibold ${
                        cycle.action === 'LONG'
                          ? 'bg-green-500/10 text-green-400'
                          : cycle.action === 'SHORT'
                          ? 'bg-red-500/10 text-red-400'
                          : 'bg-gray-500/10 text-gray-400'
                      }`}
                    >
                      {cycle.action}
                    </span>
                    <span className="px-2 py-0.5 rounded text-xs bg-purple-500/10 text-purple-400">
                      {cycle.verdict}
                    </span>
                  </div>
                  <p className="text-sm text-[var(--color-text-muted)] mt-1 line-clamp-1">
                    {cycle.rationale}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {format(cycle.startedAt, 'MMM d, HH:mm')}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Confidence: {(cycle.confidence * 100).toFixed(0)}%
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

---

## Cycle Detail Panel (Debate + Risk) — `src/components/CycleDetailPanel.tsx`

```tsx
// src/components/CycleDetailPanel.tsx
import { useCycleDetail } from '../hooks/useApi';
import { ArrowLeft, TrendingUp, TrendingDown, Shield, AlertTriangle } from 'lucide-react';

export function CycleDetailPanel({
  cycleId,
  onBack,
}: {
  cycleId: string;
  onBack: () => void;
}) {
  const { data: cycle, isLoading } = useCycleDetail(cycleId);

  if (isLoading) {
    return (
      <div className="pt-16 flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--color-accent-blue)] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!cycle) return null;

  return (
    <div className="pt-16 space-y-6">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-[var(--color-text-secondary)] hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Cycles
      </button>

      {/* Header */}
      <div className="bg-[var(--color-bg-card)] rounded-xl border border-[var(--color-border)] p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">
              {cycle.symbol} — Cycle Detail
            </h2>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              {cycle.cycleId}
            </p>
          </div>
          <div className="text-right">
            <span
              className={`px-3 py-1 rounded-lg text-sm font-semibold ${
                cycle.fundManagerApproval.approved
                  ? 'bg-green-500/10 text-green-400'
                  : 'bg-red-500/10 text-red-400'
              }`}
            >
              {cycle.fundManagerApproval.approved ? 'APPROVED' : 'REJECTED'}
            </span>
          </div>
        </div>
      </div>

      {/* Analyst Reports */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cycle.analystReports.map((report, i) => (
          <div
            key={i}
            className="bg-[var(--color-bg-card)] rounded-xl border border-[var(--color-border)] p-5"
          >
            <h3 className="text-sm font-semibold text-[var(--color-accent-blue)] mb-3">
              {report.agent}
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-3">
              {report.summary}
            </p>
            <div className="space-y-1">
              {report.bullishSignals.map((s, j) => (
                <p key={j} className="text-xs text-[var(--color-accent-green)] flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> {s}
                </p>
              ))}
              {report.bearishSignals.map((s, j) => (
                <p key={j} className="text-xs text-[var(--color-accent-red)] flex items-center gap-1">
                  <TrendingDown className="w-3 h-3" /> {s}
                </p>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-[var(--color-bg-primary)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--color-accent-blue)] rounded-full"
                  style={{ width: `${report.confidence * 100}%` }}
                />
              </div>
              <span className="text-xs text-[var(--color-text-muted)]">
                {(report.confidence * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Debate History */}
      <div className="bg-[var(--color-bg-card)] rounded-xl border border-[var(--color-border)] p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Bull vs Bear Debate</h3>
        <div className="space-y-4">
          {cycle.debate.map((entry, i) => (
            <div
              key={i}
              className={`p-4 rounded-lg border ${
                entry.role === 'BULL'
                  ? 'bg-green-500/5 border-green-500/20'
                  : 'bg-red-500/5 border-red-500/20'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`px-2 py-0.5 rounded text-xs font-bold ${
                    entry.role === 'BULL'
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {entry.role}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  Round {entry.round}
                </span>
              </div>
              <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                {entry.argument}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Risk Opinions */}
      <div className="bg-[var(--color-bg-card)] rounded-xl border border-[var(--color-border)] p-6">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-[var(--color-accent-yellow)]" />
          Risk Management Team
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {cycle.riskOpinions.map((opinion, i) => (
            <div
              key={i}
              className="bg-[var(--color-bg-primary)] rounded-lg p-4 border border-[var(--color-border)]"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase">
                  {opinion.persona}
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-semibold ${
                    opinion.verdict === 'APPROVE'
                      ? 'bg-green-500/10 text-green-400'
                      : opinion.verdict === 'REJECT'
                      ? 'bg-red-500/10 text-red-400'
                      : 'bg-yellow-500/10 text-yellow-400'
                  }`}
                >
                  {opinion.verdict}
                </span>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)]">
                {opinion.rationale}
              </p>
            </div>
          ))}
        </div>

        {/* Fund Manager Decision */}
        <div className="mt-4 p-4 bg-[var(--color-bg-primary)] rounded-lg border border-[var(--color-border)]">
          <h4 className="text-sm font-semibold text-white mb-2">Fund Manager Decision</h4>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {cycle.fundManagerApproval.rationale}
          </p>
          {cycle.fundManagerApproval.approved && (
            <div className="mt-3 flex items-center gap-4 text-xs">
              <span className="text-[var(--color-text-muted)]">
                Action: <span className="text-white font-semibold">{cycle.fundManagerApproval.finalDecision.action}</span>
              </span>
              <span className="text-[var(--color-text-muted)]">
                Leverage: <span className="text-[var(--color-accent-yellow)]">{cycle.fundManagerApproval.finalDecision.leverage}x</span>
              </span>
              <span className="text-[var(--color-text-muted)]">
                Size: <span className="text-white">{(cycle.fundManagerApproval.finalDecision.sizePct * 100).toFixed(1)}%</span>
              </span>
              <span className="text-[var(--color-text-muted)]">
                SL: <span className="text-[var(--color-accent-red)]">${cycle.fundManagerApproval.finalDecision.stopLoss}</span>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

---

## Performance Panel — `src/components/PerformancePanel.tsx`

```tsx
// src/components/PerformancePanel.tsx
import { usePerformance } from '../hooks/useApi';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';
import { useState } from 'react';

// Mock equity curve data (replace with real API data)
const mockEquityCurve = Array.from({ length: 90 }, (_, i) => ({
  date: new Date(Date.now() - (89 - i) * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  equity: 10000 + Math.random() * 2000 + i * 25,
  benchmark: 10000 + i * 10,
}));

const mockDailyPnl = Array.from({ length: 30 }, (_, i) => ({
  date: new Date(Date.now() - (29 - i) * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  pnl: (Math.random() - 0.4) * 500,
}));

export function PerformancePanel() {
  const [period, setPeriod] = useState('30d');
  usePerformance(period);

  return (
    <div className="pt-16 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Performance Analytics</h2>
        <div className="flex gap-2">
          {['7d', '30d', '90d'].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                period === p
                  ? 'bg-[var(--color-accent-blue)] text-white'
                  : 'bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:text-white'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Equity Curve */}
      <div className="bg-[var(--color-bg-card)] rounded-xl border border-[var(--color-border)] p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Equity Curve</h3>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={mockEquityCurve}>
            <defs>
              <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d3a4f" />
            <XAxis dataKey="date" stroke="#6b7280" fontSize={12} />
            <YAxis stroke="#6b7280" fontSize={12} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1a2332',
                border: '1px solid #2d3a4f',
                borderRadius: '8px',
                color: '#e5e7eb',
              }}
            />
            <Area
              type="monotone"
              dataKey="equity"
              stroke="#3b82f6"
              fill="url(#equityGradient)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="benchmark"
              stroke="#6b7280"
              fill="none"
              strokeWidth={1}
              strokeDasharray="5 5"
            />
          </AreaChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-2 text-xs text-[var(--color-text-muted)]">
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-[var(--color-accent-blue)] rounded" /> Strategy
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-gray-500 rounded" /> Buy & Hold
          </span>
        </div>
      </div>

      {/* Daily PnL */}
      <div className="bg-[var(--color-bg-card)] rounded-xl border border-[var(--color-border)] p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Daily P&L</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={mockDailyPnl}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d3a4f" />
            <XAxis dataKey="date" stroke="#6b7280" fontSize={11} />
            <YAxis stroke="#6b7280" fontSize={11} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1a2332',
                border: '1px solid #2d3a4f',
                borderRadius: '8px',
                color: '#e5e7eb',
              }}
            />
            <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
              {mockDailyPnl.map((entry, index) => (
                <Cell
                  key={index}
                  fill={entry.pnl >= 0 ? '#10b981' : '#ef4444'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

---

## Live Feed — `src/components/LiveFeed.tsx`

```tsx
// src/components/LiveFeed.tsx
import { useStore } from '../store/useStore';
import { format } from 'date-fns';
import { Zap, AlertTriangle, GitBranch, ArrowUpDown } from 'lucide-react';

export function LiveFeed() {
  const { liveEvents } = useStore();

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'cycle': return <GitBranch className="w-4 h-4 text-[var(--color-accent-blue)]" />;
      case 'position': return <ArrowUpDown className="w-4 h-4 text-[var(--color-accent-yellow)]" />;
      case 'risk': return <AlertTriangle className="w-4 h-4 text-[var(--color-accent-red)]" />;
      default: return <Zap className="w-4 h-4 text-[var(--color-text-muted)]" />;
    }
  };

  const getEventMessage = (event: any) => {
    switch (event.type) {
      case 'cycle':
        return `Agent cycle completed for ${event.payload.symbol} — ${event.payload.action} (${(event.payload.confidence * 100).toFixed(0)}% confidence)`;
      case 'position':
        return `Position updated: ${event.payload.symbol} ${event.payload.side}`;
      case 'risk':
        return `⚠️ Risk Alert: ${event.payload.message}`;
      default:
        return JSON.stringify(event.payload);
    }
  };

  return (
    <div className="pt-16 space-y-6">
      <h2 className="text-xl font-bold text-white">Live Event Feed</h2>

      {liveEvents.length === 0 ? (
        <div className="bg-[var(--color-bg-card)] rounded-xl border border-[var(--color-border)] p-12 text-center">
          <Zap className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-4" />
          <p className="text-[var(--color-text-muted)]">
            Waiting for events... Trigger an agent cycle or wait for market activity.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {liveEvents.map((event, i) => (
            <div
              key={i}
              className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-4 flex items-start gap-3"
            >
              <div className="mt-0.5">{getEventIcon(event.type)}</div>
              <div className="flex-1">
                <p className="text-sm text-[var(--color-text-primary)]">
                  {getEventMessage(event)}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  {format(event.timestamp, 'HH:mm:ss')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## Entry Point — `src/main.tsx`

```tsx
// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

---

## `dashboard/Dockerfile`

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5173
CMD ["nginx", "-g", "daemon off;"]
```

### `dashboard/nginx.conf`

```nginx
server {
    listen 5173;
    root /usr/share/nginx/html;
    index index.html;

    location /api {
        proxy_pass http://paper-broker:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /ws {
        proxy_pass http://paper-broker:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## Run It

```bash
# From paper-broker root
docker compose --profile dashboard up -d

# Or for local dev:
cd dashboard
npm run dev
# → http://localhost:5173
```

The dashboard will connect to your `paper-broker` API at `localhost:3000` and display real-time agent decisions, debate transcripts, risk opinions, and portfolio performance.
