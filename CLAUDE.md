# Claude Project Instructions

The authoritative engineering rules for this repository are in:

- **AGENTS.md** - Primary repository contract (READ FIRST)
- **PROJECT_STATE.md** - Current capabilities and limitations
- **CONTRACTS.md** - Non-negotiable architectural invariants
- **KNOWN_LIMITATIONS.md** - Incomplete features (do not claim they're done)
- **skills/** - Implementation guidance for specific domains
- **.cursor/rules/** - Granular enforcement rules

## Before Modifying Code

1. Read AGENTS.md to understand your role and constraints
2. Read PROJECT_STATE.md to understand what's actually implemented
3. Read CONTRACTS.md to understand boundaries you cannot cross
4. Check KNOWN_LIMITATIONS.md to avoid claiming incomplete features as done
5. Use relevant skill(s) from `skills/` for domain-specific guidance
6. Inspect actual source code - do not rely on documentation alone
7. Find and read existing tests
8. Verify actual SDK capabilities (do not assume)

## You MUST

- Treat AGENTS.md as the primary repository contract
- Behave as an evidence-first software engineer
- Preserve architectural boundaries defined in CONTRACTS.md
- Never invent functionality, APIs, files, or behavior
- Inspect existing implementation before modifying it
- Implement requested work completely
- Verify every change with tests and type checking
- Never claim success without evidence
- Protect paper/live execution boundaries
- Produce small, coherent, working commits

## You MUST NOT

- Hallucinate APIs, exchange behavior, or configuration
- Assume a method exists because its name sounds plausible
- Claim a test passes without running it
- Claim deployment works without verifying runtime
- Bypass risk or live-trading safety boundaries
- Describe features listed in KNOWN_LIMITATIONS.md as complete
- Change architecture without documenting impact (ADR required)

## Verification Required

Before declaring any task complete:

```bash
pnpm typecheck   # Must pass
pnpm lint        # Must pass  
pnpm test        # Must pass
pnpm build       # Must pass
git status       # Review changes
git diff         # Inspect actual changes
```

A task is NOT complete until verification passes.

## Trading Safety

If your work touches orders, positions, risk, or execution:

- Test BOTH success and failure paths
- Use explicit rejection codes
- Never invent prices or balances
- Ensure events are emitted for all state changes
- Verify persistence is working

Remember: The LLM produces signals only, never direct order execution.

## Commit Reporting

After completing a commit, report:

```markdown
## Commit Complete

Commit: `<sha>`
Summary: [...]
Files changed: [...]
Verification: [all commands must show PASS]
Known limitations: [...]
```

---

**Start every task by reading AGENTS.md**
