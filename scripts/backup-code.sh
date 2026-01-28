#!/usr/bin/env bash
set -euo pipefail

# Simple helper to back up this repo's code to GitHub.
# Expects:
#   - an existing git repo with a configured remote (default: origin)
#   - write access to the remote (token-based URLs work)
# Optional env vars:
#   CODE_REMOTE   remote name to push to (default: origin)
#   CODE_BRANCH   branch to push (default: main)
#   CODE_MESSAGE  commit message (default includes timestamp)

REMOTE="${CODE_REMOTE:-origin}"
BRANCH="${CODE_BRANCH:-main}"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
MESSAGE="${CODE_MESSAGE:-chore: backup $STAMP}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repository. Run 'git init' and add a remote before using this script." >&2
  exit 1
fi

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  echo "Remote '$REMOTE' not found. Add it with 'git remote add $REMOTE <url>'." >&2
  exit 1
fi

git add -A
git commit -m "$MESSAGE" || echo "No changes to commit."
git push "$REMOTE" "$BRANCH"

echo "Backup complete to $REMOTE/$BRANCH at $STAMP."
