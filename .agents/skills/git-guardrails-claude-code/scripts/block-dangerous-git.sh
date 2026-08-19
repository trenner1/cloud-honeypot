#!/bin/bash

INPUT=$(cat)

# This hook may run in environments where `jq` isn't installed.
# In that case, fail open (no blocking) rather than crashing the caller.
if ! command -v jq >/dev/null 2>&1; then
  echo "NOTICE: jq not found; skipping dangerous-git guardrails." >&2
  exit 0
fi

COMMAND="$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"

DANGEROUS_PATTERNS=(
  "git push"
  "git reset --hard"
  "git clean -fd"
  "git clean -f"
  "git branch -D"
  "git checkout \."
  "git restore \."
  "push --force"
  "reset --hard"
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qE "$pattern"; then
    echo "BLOCKED: '$COMMAND' matches dangerous pattern '$pattern'. The user has prevented you from doing this." >&2
    exit 2
  fi
done

exit 0
