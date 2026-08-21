# ADR 0001: AI Agent Governance Structure

**Date**: 2025-01-XX  
**Status**: Accepted  
**Author**: System Architect

## Context

This project uses AI coding assistants (Claude, Codex, Cursor, etc.) to help implement a production-oriented crypto trading system. Without proper governance, AI agents may:

- Hallucinate APIs and exchange behavior
- Claim incomplete features as implemented
- Bypass safety boundaries
- Introduce architectural violations
- Commit unverified code

## Decision

Implement a hierarchical agent governance structure with:

### 1. Master Contract (AGENTS.md)

Defines the agent's role, constraints, and required behaviors. All other documents derive authority from this file.

### 2. State Documentation

- **PROJECT_STATE.md**: Current capabilities and phase
- **KNOWN_LIMITATIONS.md**: Confirmed incomplete features
- **CONTRACTS.md**: Non-negotiable architectural invariants

### 3. Domain Skills

Modular skill definitions in `skills/` directory for:
- Project context establishment
- Architecture review
- Market data handling
- Strategy implementation
- Risk management
- Execution safety
- Mode switching
- LLM agent constraints
- Notifications
- Testing & verification

### 4. IDE Rules

Cursor rules in `.cursor/rules/` for granular enforcement:
- Core repository rules (always apply)
- Architecture boundaries
- Trading safety
- Event-driven patterns
- LLM agent constraints
- Testing requirements
- Commit quality

### 5. Adapter Documents

- **CLAUDE.md**: Points to authoritative sources for Claude
- **CODEX.md**: Points to authoritative sources for Codex

## Implementation Protocol

Every task must follow:

```
TASK
 ↓
READ AGENTS.md
 ↓
READ PROJECT_STATE.md
 ↓
READ CONTRACTS.md
 ↓
LOCATE IMPLEMENTATION
 ↓
LOCATE TESTS
 ↓
CHECK SDK CAPABILITIES
 ↓
PLAN (mini-design)
 ↓
IMPLEMENT
 ↓
TEST
 ↓
TYPECHECK
 ↓
LINT
 ↓
BUILD
 ↓
GIT DIFF REVIEW
 ↓
COMMIT
```

## Consequences

### Positive

- Agents behave as evidence-first engineers
- Hallucinations prevented by explicit uncertainty requirement
- Safety boundaries enforced through multiple layers
- Architecture violations caught by rules and tests
- Incomplete features documented and not claimed as done
- Verification mandatory before claiming completion

### Negative

- Additional overhead for simple tasks
- Requires discipline to maintain documentation
- Skills and rules need updates as system evolves

### Neutralizations

- Keep skills focused and concise
- Update KNOWN_LIMITATIONS.md when features complete
- Review and refine rules based on actual agent behavior
- Add architecture tests to automate boundary enforcement

## Compliance

Compliance is enforced through:

1. **Documentation hierarchy** - Agents must read AGENTS.md first
2. **IDE rules** - Cursor enforces rules automatically
3. **Verification commands** - Must pass before commit
4. **Commit discipline** - Report verification results
5. **Architecture tests** - Future: automated boundary checks

## Related Documents

- `/AGENTS.md` - Master contract
- `/PROJECT_STATE.md` - Current state
- `/CONTRACTS.md` - Architectural invariants
- `/KNOWN_LIMITATIONS.md` - Known gaps
- `/skills/**/*.md` - Domain guidance
- `/.cursor/rules/*.mdc` - IDE enforcement
- `/CLAUDE.md` - Claude adapter
- `/CODEX.md` - Codex adapter
