#!/usr/bin/env bash
# cleanup-old-worktrees.sh
#
# Removes Jan–May 2026 git worktrees from disk. Does NOT touch the database.
# Reads the list of UUIDs from .worktrees-to-delete.txt (repo root).
#
# Usage:
#   ./scripts/cleanup-old-worktrees.sh           # dry run — shows what would be deleted
#   ./scripts/cleanup-old-worktrees.sh --execute  # actually delete

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREES_DIR="$REPO_ROOT/.worktrees"
LIST_FILE="$REPO_ROOT/.worktrees-to-delete.txt"
DRY_RUN=true

if [[ "${1:-}" == "--execute" ]]; then
  DRY_RUN=false
fi

if [[ ! -f "$LIST_FILE" ]]; then
  echo "ERROR: List file not found: $LIST_FILE"
  exit 1
fi

if $DRY_RUN; then
  echo "=== DRY RUN — pass --execute to actually delete ==="
  echo ""
fi

# Detect the UUID of the current worktree so we never delete ourselves
CURRENT_WT_PATH="$(git -C "$REPO_ROOT" worktree list --porcelain | grep "^worktree " | awk 'NR==1{print $2}')"
# If we're IN a worktree, our path differs from REPO_ROOT
THIS_WORKTREE_UUID="$(basename "$(git rev-parse --show-toplevel 2>/dev/null || echo "")")"

WORKTREE_IDS=()
while IFS= read -r line || [[ -n "$line" ]]; do
  WORKTREE_IDS+=("$line")
done < "$LIST_FILE"

deleted=0
skipped=0
not_found=0
failed=0
total_bytes=0

for uuid in "${WORKTREE_IDS[@]}"; do
  # Skip blank lines
  [[ -z "$uuid" ]] && continue

  path="$WORKTREES_DIR/$uuid"

  # Never delete the currently active worktree
  if [[ "$uuid" == "$THIS_WORKTREE_UUID" ]]; then
    echo "SKIP (active): $uuid"
    ((skipped++)) || true
    continue
  fi

  if [[ ! -d "$path" ]]; then
    ((not_found++)) || true
    continue
  fi

  size=$(du -sh "$path" 2>/dev/null | cut -f1)
  size_bytes=$(du -s "$path" 2>/dev/null | cut -f1)

  if $DRY_RUN; then
    echo "WOULD DELETE [$size]: $uuid"
    ((deleted++)) || true
    total_bytes=$((total_bytes + size_bytes))
  else
    # Prefer git worktree remove (cleans git metadata); fall back to rm -rf
    if git -C "$REPO_ROOT" worktree remove --force "$path" 2>/dev/null; then
      echo "REMOVED (git): $uuid  [$size]"
    elif rm -rf "$path"; then
      echo "REMOVED (rm):  $uuid  [$size]"
    else
      echo "FAILED:        $uuid"
      ((failed++)) || true
      continue
    fi
    ((deleted++)) || true
    total_bytes=$((total_bytes + size_bytes))
  fi
done

total_gb=$(awk "BEGIN {printf \"%.1f\", $total_bytes / 1024 / 1024}")

echo ""
echo "================================"
if $DRY_RUN; then
  echo "DRY RUN complete"
  echo "  Would delete : $deleted worktrees (~${total_gb} GB)"
else
  echo "Cleanup complete"
  echo "  Deleted      : $deleted worktrees (~${total_gb} GB freed)"
  echo "  Failed       : $failed"
fi
echo "  Skipped      : $skipped (active worktree)"
echo "  Not on disk  : $not_found (already gone)"
echo "================================"

if $DRY_RUN; then
  echo ""
  echo "Run with --execute to actually delete:"
  echo "  ./scripts/cleanup-old-worktrees.sh --execute"
fi
