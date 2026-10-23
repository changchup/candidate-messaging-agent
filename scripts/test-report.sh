#!/usr/bin/env bash
# Regenerates reports/test-summary.md from a full local test run (no API key needed).
set -euo pipefail
strip() { sed -E 's/\x1b\[[0-9;]*m//g'; }
out=reports/test-summary.md
unit=$(npx vitest run --reporter=verbose --coverage --coverage.reporter=text-summary 2>&1 | strip | grep -vE 'ExperimentalWarning|trace-warnings')
e2e=$(npx playwright test --reporter=list 2>&1 | strip)
{
  echo "# Test summary"
  echo
  echo "Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) on $(node -v). All suites run offline with the fake LLM."
  echo
  echo "## Unit, integration, API and data-validation tests (Vitest)"
  echo
  echo '```'
  echo "$unit" | grep -E '^ +(✓|×|↓)|Test Files|Tests |Statements|Branches|Functions|Lines'
  echo '```'
  echo
  echo "## Browser test (Playwright)"
  echo
  echo '```'
  echo "$e2e" | grep -E '✓|✘|passed|failed'
  echo '```'
} > "$out"
echo "wrote $out"
