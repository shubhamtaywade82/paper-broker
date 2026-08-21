# ADR 0003: Dashboard Control Plane, API Gateway, and Target Monorepo Layout

**Date**: 2026-08-21  
**Status**: Accepted  
**Author**: System Architect  

## Context

As the trading platform expands beyond paper simulation into live CoinDCX execution and Ollama agentic reasoning, operators require full visual observability and controlled operational access. 

The Dashboard must NOT be an afterthought UI or hold exchange API credentials. It must act as a first-class **Control and Observability Plane** that communicates strictly through a dedicated API/BFF gateway and respects all engine invariants, risk boundaries, and safety gates.

## Decision

We establish the 4-plane architecture and target modular monorepo layout:

### 1. The Four System Planes

```text
                    ┌──────────────────────┐
                    │    CONTROL PLANE     │
                    │                      │
                    │ React Dashboard      │
                    │ Telegram Bot         │
                    │ Operational CLI      │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │     TRADING API      │
                    │   Fastify REST + WS  │
                    └──────────┬───────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│ OBSERVABILITY│       │ TRADING CORE │       │ AGENT PLANE  │
│              │       │              │       │              │
│ EventLog     │       │ Strategy     │       │ Ollama SDK   │
│ Metrics      │       │ Risk Engine  │       │ MCP Tools    │
│ Incidents    │       │ Exec Router  │       │ Reasoning    │
└──────────────┘       └───────┬──────┘       └──────────────┘
                               │
                     ┌─────────┼─────────┐
                     ▼         ▼         ▼
                  Binance   CoinDCX   Paper
```

### 2. Dashboard Modules & Responsibilities
- **System Overview & Arming Gate**: Live display of active profile (`PAPER`, `SHADOW`, `LIVE`), account equity, realized/unrealized PnL, risk status, and a two-step confirmation modal for live trading arming.
- **Market & Multi-Timeframe Charting**: Lightweight Charts plotting OHLCV candles, market structure (BOS, CHoCH, HH/HL), liquidity sweep levels, FVGs, order blocks, and trade markers.
- **Live Positions & Order Lifecycle**: Real-time position tracking, breakeven status, and order state pipeline.
- **AI Agent Observability**: Inspection of Ollama reasoning traces, tool call latency, decision confidence, and `NO_TRADE` rationale.
- **System Health & Incident Tracker**: Latency grid for providers (Binance, CoinDCX, Ollama, DB, Telegram) and incident log with deduplicated incident IDs (`INC-...`).

### 3. API & WebSocket Gateway Contracts
- **Zero Frontend Secrets**: The frontend never receives Binance or CoinDCX API keys.
- **Uniform Command Bus**: Manual orders, cancellations, and kill-switch activations pass through `API -> CommandBus -> RiskEngine -> LiveTradingGuard -> ExecutionRouter`.
- **WebSocket Streaming**: Real-time broadcast of market ticks, order state changes, position updates, and incident alerts over `ws://localhost:8080/ws`.

### 4. Target Monorepo Structure

```text
trading-system/
├── apps/
│   ├── engine/              # Trading runtime composition root
│   ├── api/                 # Fastify REST + WebSocket gateway
│   └── dashboard/           # React + TypeScript frontend
│
├── packages/
│   ├── binance-adapter/     # Binance WS/REST normalization
│   ├── coindcx-adapter/     # CoinDCX WS/REST & execution
│   ├── paper-broker/        # Deterministic paper broker
│   ├── execution/           # Unified ExecutionRouter & broker interface
│   ├── risk/                # RiskEngine & LiveTradingGuard
│   ├── strategy/            # SMC market structure & setup engines
│   ├── agent/               # Ollama agent & MCP tool integration
│   ├── event-bus/           # Typed canonical domain events
│   ├── observability/       # Metrics, Incident pipeline & telemetry
│   ├── notifications/       # Telegram & webhook alerts
│   └── shared/              # Common domain types & utilities
│
├── config/
│   └── modes/
│       ├── paper.yaml
│       ├── shadow.yaml
│       └── live.yaml
│
└── infrastructure/
    ├── docker/              # Docker Compose (Postgres, Redis, Ollama, App)
    └── monitoring/          # Prometheus & Grafana configs
```

## Consequences
- Clean separation between frontend observability and backend execution authority.
- Operators can monitor and control the system via Web, Telegram, and CLI with identical safety guarantees.
- Provides a clear migration path to the modular monorepo structure without breaking current single-process paper-broker capabilities.
