# Repository Map

Quick reference for navigating this codebase.

## Root Documents

| File | Purpose |
|------|---------|
| `AGENTS.md` | **Master contract** - AI agent role and constraints (READ FIRST) |
| `PROJECT_STATE.md` | Current capabilities, phase, and limitations |
| `CONTRACTS.md` | Non-negotiable architectural invariants |
| `KNOWN_LIMITATIONS.md` | Confirmed incomplete features |
| `CLAUDE.md` | Claude-specific adapter pointing to authoritative sources |
| `CODEX.md` | Codex-specific adapter pointing to authoritative sources |
| `README.md` | Project overview and quick start |
| `docs/` | Architecture, API, configuration, strategies references |

## Research Transcripts (not specifications)

These are captured design conversations and research notes, kept for
provenance. They are **not** maintained descriptions of current behaviour —
check `PROJECT_STATE.md` and the source before trusting anything in them.

| File | Subject |
|------|---------|
| `SYSTEM_DASHBOARD.md` | Dashboard design exploration |
| `TRADING_AGENTS.md` | TradingAgents paper walkthrough |
| `paper-exchange.md` | Binance SDK endpoint coverage notes |
| `ADAPTIVE_SUPERTREND.md` | Adaptive Supertrend design exploration |

## Skills (`skills/`)

Domain-specific implementation guidance:

| Skill | Purpose |
|-------|---------|
| `project-context/SKILL.md` | Establish context before any implementation |
| `architecture/SKILL.md` | Architecture review and boundary enforcement |
| `market-data/SKILL.md` | Work with Binance market data safely |
| `strategy/SKILL.md` | Implement event-driven trading strategies |
| `risk-management/SKILL.md` | Risk controls and validation |
| `execution/SKILL.md` | Paper/live execution safety |
| `paper-shadow-live/SKILL.md` | Operating modes and runtime profiles |
| `agentic-llm/SKILL.md` | Constrained LLM reasoning |
| `notifications/SKILL.md` | Telegram and operational alerting |
| `testing-verification/SKILL.md` | Prove correctness before completion |

## Cursor Rules (`.cursor/rules/`)

IDE-level enforcement:

| Rule | Scope | Purpose |
|------|-------|---------|
| `00-core.mdc` | Always | Core repository rules, evidence-first, no hallucination |
| `10-architecture.mdc` | `src/**/*.ts` | Architecture boundaries and import restrictions |
| `20-trading-safety.mdc` | `src/**/*.ts` | Trading safety for orders, positions, risk |
| `30-event-driven.mdc` | `src/**/*.ts` | Event-driven patterns and canonical events |
| `40-llm-agent.mdc` | `src/ai/**/*.ts` | LLM constraints and hallucination prevention |
| `50-testing.mdc` | Always | Testing requirements and quality rules |
| `60-commit-quality.mdc` | Always | Commit discipline and verification |

## Source Code (`src/`)

| Directory | Purpose | Key Files |
|-----------|---------|-----------|
| `ai/` | Multi-agent LLM pipeline | `tradingAgents.ts`, `schemas.ts` |
| `api/` | REST API server | `server.ts` |
| `binance/` | Market data ingestion | `streams.ts`, `client.ts`, `normalizers.ts` |
| `broker/` | Paper execution | `PaperBroker.ts` |
| `config/` | Configuration | Mode and environment config |
| `market/` | Market state management | `state.ts`, `candles.ts`, `kline.ts` |
| `persistence/` | SQLite persistence | `db.ts`, `EventLog.ts`, `BrokerPersister.ts` |
| `scheduler/` | Periodic jobs | Funding, snapshots, staleness checks |
| `strategy/` | Strategy engine | `StrategyEngine.ts`, `SignalExecutor.ts`, `StrategyPerformanceTracker.ts`, `strategies/` |
| `execution/` | Order routing & live safety | `ExecutionRouter.ts`, `LiveTradingGuard.ts` |
| `coindcx/` | Live venue adapter | `CoinDCXBroker.ts` |
| `trading/` | Intent, risk, goals | `TradeIntentEngine.ts`, `risk/RiskEngine.ts`, `risk/TrailingStopController.ts`, `goals/ProfitGoalManager.ts` |
| `research/` | Backtest & replay | `replay/ReplayEngine.ts`, `dataset/HistoricalDatasetPaginator.ts` |
| `telemetry/` | Metrics & logging | `metrics.ts`, `logger.ts` |
| `telemetry/` | Observability | Logging and metrics |

### Entry Points

| File | Purpose |
|------|---------|
| `src/index.ts` | Main application entry |
| `src/engine.ts` | Engine composition root |
| `src/cli.ts` | CLI commands |

## Documentation (`docs/`)

| Subdirectory | Purpose |
|--------------|---------|
| `decisions/` | Architecture Decision Records (ADRs) |
| `architecture/` | Detailed architecture documentation |
| `contracts/` | Interface contracts |
| `runbooks/` | Operational procedures (future) |

### Existing Docs

| File | Purpose |
|------|---------|
| `docs/architecture.md` | System architecture overview |
| `docs/configuration.md` | Configuration reference |
| `docs/strategies.md` | Strategy documentation |
| `docs/api.md` | API reference |

## Configuration (`config/`)

| Subdirectory | Purpose |
|--------------|---------|
| `modes/` | Mode profiles (paper.yaml, shadow.yaml, live.yaml) - future |

## Scripts (`scripts/`)

| Script | Purpose |
|--------|---------|
| `verify-complete.sh` | Full verification suite (typecheck, lint, test, build, security) |
| `init-db.ts` | Database initialization |

## Tests (`test/`)

| Subdirectory | Purpose |
|--------------|---------|
| `unit/` | Unit tests |
| `integration/` | Integration tests (future) |
| `smoke/` | Smoke tests (future) |

## Data Files (Gitignored)

| File | Purpose |
|------|---------|
| `paper.sqlite3` | SQLite database |
| `events.jsonl` | Append-only event stream |
| `.env` | Environment variables |

---

## Quick Navigation

### Starting a new task:

1. Read `AGENTS.md`
2. Check `PROJECT_STATE.md` for current capabilities
3. Review `CONTRACTS.md` for boundaries
4. Check `KNOWN_LIMITATIONS.md` for incomplete features
5. Use relevant skill from `skills/`
6. Locate implementation in `src/`
7. Find tests in `test/`

### Before committing:

```bash
pnpm verify:complete
```

### Adding a new feature:

1. Follow implementation protocol in AGENTS.md
2. Create/update skill if domain-specific
3. Add tests
4. Update PROJECT_STATE.md if capability changes
5. Update KNOWN_LIMITATIONS.md if addressing a limitation

### Making architectural changes:

1. Create ADR in `docs/decisions/`
2. Update CONTRACTS.md if invariants change
3. Update skills and rules as needed
4. Test migration path
