---
name: testing-verification
description: Prove implementation correctness before declaring completion.
---

# Testing & Verification Skill

## Required Verification Loop

Every task must complete this loop before claiming "done":

```
Inspect → Design → Implement → Unit Test → Typecheck → Lint → Build → Git Diff Review → Commit
```

For integration-sensitive changes, also run:

```
Integration/Smoke Test → Runtime Verification
```

## Verification Commands

Use these commands to verify work:

| Command | Purpose | Required For |
|---------|---------|--------------|
| `pnpm typecheck` | TypeScript compilation check | All changes |
| `pnpm lint` | ESLint validation | All changes |
| `pnpm test` | Vitest unit tests | Logic changes |
| `pnpm build` | Full build to dist/ | All changes |
| `git diff --check` | Whitespace/conflict check | Before commit |
| `git status` | Verify no unexpected changes | Before commit |

## Trading-Critical Verification

For changes involving:

- Orders
- Positions
- Risk/validation
- Execution
- Mode switching
- Provider failover (future)
- Reconciliation (future)

Test BOTH:

1. **Success path** - Valid input → expected output
2. **Failure path** - Invalid input → proper rejection with correct error code

### Example Test Matrix for Execution Change

| Scenario | Input | Expected Result |
|----------|-------|-----------------|
| Valid MARKET | Fresh market, valid signal | Fill at mark + slippage |
| Stale market | Stale MarketState | Reject with `STALE_MARKET_DATA` |
| Insufficient balance | Size > balance allows | Reject with reason |
| Reduce-only violation | Would increase position | Reject with `REDUCE_ONLY_WOULD_INCREASE` |
| Min notional | Size below minimum | Reject with `BELOW_MIN_NOTIONAL` |

## Future: verify:complete Script

When implemented, run:

```bash
pnpm verify:complete
```

This should execute:

1. Typecheck
2. Lint
3. Unit tests
4. Integration tests
5. Build
6. Architecture boundary checks
7. Environment validation

A task is NOT complete until `pnpm verify:complete` passes (or the equivalent manual verification if not yet implemented).

## Final Report Format

After completing verification, report:

```markdown
## Verification Report

Implementation: PASS/FAIL
- Files changed: [...]
- Lines added/removed: [...]/[...]

Tests: PASS/FAIL
- Unit tests run: N
- Integration tests run: N
- Coverage: X%

Typecheck: PASS/FAIL
- Errors: 0
- Warnings: 0

Lint: PASS/FAIL
- Errors: 0
- Warnings: 0

Build: PASS/FAIL
- Output: dist/

Known Issues:
- [List any remaining issues or limitations]

Next Steps:
- [If anything remains incomplete]
```

## Never Claim Success When

- ❌ Tests are failing
- ❌ Typecheck has errors
- ❌ Lint has errors
- ❌ Build fails
- ❌ Git diff includes unrelated changes
- ❌ Secrets might be staged
- ❌ You haven't inspected the actual diff

## Test Categories

### Unit Tests

Test individual functions/classes in isolation.

Location: `test/unit/`

Example:
```typescript
describe('PaperBroker', () => {
  it('rejects order when market is stale', async () => {
    // ...
  });
});
```

### Integration Tests

Test component interactions.

Location: `test/integration/`

Example:
```typescript
describe('Signal → Order flow', () => {
  it('executes valid signal end-to-end', async () => {
    // Signal generated → Executor processes → Broker submits → Events emitted
  });
});
```

### Smoke Tests

Quick runtime verification that the system starts and basic functionality works.

Location: `test/smoke/`

Example:
```typescript
describe('Engine startup', () => {
  it('starts without crashing', async () => {
    const engine = createEngine({ mode: 'paper' });
    await engine.start();
    expect(engine.isRunning()).toBe(true);
    await engine.stop();
  });
});
```

## Output Format

When running verification:

```markdown
## Verification Results

Commands run:
- pnpm typecheck: PASS
- pnpm lint: PASS  
- pnpm test: PASS (N tests)
- pnpm build: PASS

Git status:
- Changed files: [...]
- Untracked files: [...]

Security check:
- No secrets detected: YES

Ready to commit: YES/NO
```
