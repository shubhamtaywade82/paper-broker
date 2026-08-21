#!/usr/bin/env bash

set -e

echo "========================================"
echo "Running Full Verification Suite"
echo "========================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS_COUNT=0
FAIL_COUNT=0

pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((PASS_COUNT++))
}

fail() {
    echo -e "${RED}✗${NC} $1"
    ((FAIL_COUNT++))
}

warn() {
    echo -e "${YELLOW}!${NC} $1"
}

echo "1. Type Checking..."
if pnpm typecheck > /dev/null 2>&1; then
    pass "TypeScript compilation: PASS"
else
    fail "TypeScript compilation: FAIL"
    echo "   Run 'pnpm typecheck' for details"
fi

echo ""
echo "2. Linting..."
if pnpm lint > /dev/null 2>&1; then
    pass "ESLint validation: PASS"
else
    fail "ESLint validation: FAIL"
    echo "   Run 'pnpm lint' for details"
fi

echo ""
echo "3. Unit Tests..."
if pnpm test > /dev/null 2>&1; then
    pass "Unit tests: PASS"
else
    fail "Unit tests: FAIL"
    echo "   Run 'pnpm test' for details"
fi

echo ""
echo "4. Build..."
if pnpm build > /dev/null 2>&1; then
    pass "Build: PASS"
else
    fail "Build: FAIL"
    echo "   Run 'pnpm build' for details"
fi

echo ""
echo "5. Git Status..."
if git diff --quiet && git diff --cached --quiet; then
    pass "Git working tree: clean"
else
    warn "Git working tree: has changes (review before commit)"
fi

echo ""
echo "6. Git Diff Check..."
if git diff --check > /dev/null 2>&1; then
    pass "Whitespace/conflict markers: none"
else
    fail "Whitespace/conflict markers: found"
    echo "   Run 'git diff --check' for details"
fi

echo ""
echo "7. Security Check..."
SECRETS_FOUND=$(git diff --cached | grep -iE "(api[_-]?key|secret|token|password)" | wc -l || true)
if [ "$SECRETS_FOUND" -eq 0 ]; then
    pass "Secrets check: no secrets detected"
else
    fail "Secrets check: potential secrets found!"
    echo "   Review staged changes for sensitive data"
fi

echo ""
echo "========================================"
echo "Verification Summary"
echo "========================================"
echo ""
echo -e "Passed: ${GREEN}${PASS_COUNT}${NC}"
echo -e "Failed: ${RED}${FAIL_COUNT}${NC}"
echo ""

if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "${GREEN}All checks passed! Ready to commit.${NC}"
    exit 0
else
    echo -e "${RED}Some checks failed. Fix issues before committing.${NC}"
    exit 1
fi
