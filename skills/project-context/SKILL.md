---
name: project-context
description: Establish authoritative context before any implementation.
---

# Project Context Skill

Use this skill before modifying architecture, infrastructure, execution,
risk, market data, agent, or persistence code.

## Step 1: Identify the Component

Determine whether the task belongs to:

- **market-data** - Binance streams, normalization, market state
- **strategy** - Signal generation, setup detection
- **execution** - PaperBroker, order submission, fills
- **risk** - Sizing, validation, limits (current and future)
- **persistence** - SQLite, EventLog, BrokerPersister
- **api** - REST endpoints, metrics
- **agent** - Ollama integration, LLM signals
- **scheduler** - Periodic jobs, funding, snapshots

## Step 2: Read the Current Implementation

Inspect:
- Source files in the relevant `src/` subdirectory
- Tests in `test/`
- Type definitions and interfaces
- Composition root (`src/index.ts`, `src/engine.ts`)
- Configuration (`src/config/`)
- Relevant docs (`docs/`)

## Step 3: Check Integration Boundaries

Identify:
- **Callers** - Who invokes this code?
- **Consumers** - Who depends on its output?
- **Provider interfaces** - What external systems does it use?
- **Adapters** - How are external schemas normalized?
- **Persistence** - What gets persisted and how?
- **Events** - What events does it emit or consume?

## Step 4: Check Existing SDK Capabilities

Verify the actual methods/types in:
- `@nemesis-oss/binance-sdk` - inspect source or types
- `@nemesis-ollama-sdk` - inspect source or types

Do not assume feature parity between SDKs.
Do not assume a method exists because its name sounds plausible.

## Step 5: Produce a Mini Design

Before editing, write:

```markdown
Current behavior:
[What the code does now]

Requested behavior:
[What the task requires]

Impacted components:
[List of files/modules that will change]

Invariants:
[What must NOT change]

Tests required:
[Unit/integration tests needed]
```

Only then implement.

## Step 6: Verify Against Contracts

Check CONTRACTS.md for relevant architectural contracts:
- Execution Contract
- Broker Ownership Contract
- Market Data Truth Contract
- Event Log Contract
- LLM Authority Contract
- Mode Selection Contract

Ensure your design does not violate these contracts.

## Step 7: Check Known Limitations

Review KNOWN_LIMITATIONS.md to:
- Avoid claiming incomplete features as done
- Understand what work is still required
- Identify if your task depends on incomplete capabilities

## Output Format

After completing this skill, produce:

```markdown
## Context Summary

Component: [identified component]
Files inspected: [list]
Tests found: [yes/no + location]
SDK capabilities verified: [what was checked]

## Design

Current behavior: ...
Requested behavior: ...
Impacted components: [...]
Invariants: [...]
Tests required: [...]

## Contract Compliance

Relevant contracts: [...]
Violations identified: [none / list]

## Known Dependencies

Limitations affecting this work: [...]
```

Then proceed to implementation.
