# Codex Instructions

## Authoritative Sources

**AGENTS.md is the primary repository contract.**

Before changing code, read in this order:

1. AGENTS.md - Your role and constraints
2. PROJECT_STATE.md - What's actually implemented
3. CONTRACTS.md - Architectural invariants
4. KNOWN_LIMITATIONS.md - Incomplete features
5. Relevant skills/ from `skills/` directory
6. Actual source code
7. Existing tests

## Core Rules

- **Never invent APIs or behavior** - Verify from source code
- **Never assume SDK methods exist** - Check actual types
- **Never claim tests pass without running them** - Execute verification
- **Never bypass safety boundaries** - Risk/validation must run
- **Never describe KNOWN_LIMITATIONS as complete** - They're not done

## Task Completion

Complete tasks end-to-end:

```
Implementation → Tests → Verification → Diff Review → Commit-Ready
```

Required verification commands:

```bash
pnpm typecheck   # TypeScript
pnpm lint        # ESLint
pnpm test        # Vitest
pnpm build       # Build
git status       # Review changes
git diff         # Inspect changes
```

A task is NOT complete until all verification passes.

## Trading Safety

Trading safety rules in AGENTS.md are MANDATORY:

- LLM produces signals only, never direct orders
- All orders require validation before execution
- Market data must be fresh (not stale)
- Broker owns all state mutation
- Events emitted for all state changes
- Persistence verified

If your work touches orders, positions, risk, or execution:
- Test success AND failure paths
- Use explicit rejection codes
- Verify event emission
- Confirm persistence working

## Architecture Boundaries

Respect these boundaries:

| Package | Cannot Import |
|---------|---------------|
| `src/strategy/**` | `src/broker/**`, exchange SDKs |
| `src/ai/**` | `src/broker/**`, execution |
| `src/api/**` | Exchange SDKs directly |
| `src/market/**` | `src/strategy/**`, `src/broker/**` |

See `.cursor/rules/10-architecture.mdc` for details.

## Known Limitations

Do NOT claim these are implemented (they're not):

- Shadow mode
- Live trading
- Provider failover
- Telegram notifications
- Dashboard frontend
- Full risk engine
- MCP tool orchestration
- Backtest engine

Check KNOWN_LIMITATIONS.md before describing any feature.

## Commit Discipline

Before committing:
- One commit = one coherent change
- No failing tests
- No unrelated refactors
- Accurate commit message
- Security check (no secrets)

Report after commit:
- Commit SHA
- Summary of changes
- Files modified
- Verification results
- Known limitations

---

**Start every task by reading AGENTS.md**
