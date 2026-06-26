#!/usr/bin/env bash
# cleanup-old-worktrees.sh
#
# Removes old git worktrees from disk. Does NOT touch the database.
#
# Usage:
#   ./scripts/cleanup-old-worktrees.sh                     # dry run from .worktrees-to-delete.txt
#   ./scripts/cleanup-old-worktrees.sh --execute           # delete from .worktrees-to-delete.txt
#   ./scripts/cleanup-old-worktrees.sh --test-cruft        # dry run E2E-created test worktrees
#   ./scripts/cleanup-old-worktrees.sh --test-cruft --apply # delete E2E-created test worktrees

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREES_DIR="$REPO_ROOT/.worktrees"
LIST_FILE="$REPO_ROOT/.worktrees-to-delete.txt"
AUDIT_FILE="/tmp/cc_nested_on_disk.txt"

TEST_CRUFT=false
DRY_RUN=true

for arg in "$@"; do
  case "$arg" in
    --test-cruft)
      TEST_CRUFT=true
      ;;
    --apply|--execute)
      DRY_RUN=false
      ;;
    *)
      echo "ERROR: Unknown argument: $arg"
      exit 1
      ;;
  esac
done

physical_path() {
  local path="${1:-}"

  if [[ -z "$path" ]]; then
    return 1
  fi

  if [[ -d "$path" ]]; then
    (cd "$path" && pwd -P)
    return 0
  fi

  local parent
  parent="$(dirname "$path")"
  local name
  name="$(basename "$path")"
  if [[ -d "$parent" ]]; then
    printf '%s/%s\n' "$(cd "$parent" && pwd -P)" "$name"
    return 0
  fi

  return 1
}

human_size() {
  du -sh "$1" 2>/dev/null | awk '{print $1}'
}

size_kb() {
  du -sk "$1" 2>/dev/null | awk '{print $1}'
}

count_nested_test_dirs() {
  if [[ ! -d "$WORKTREES_DIR" ]]; then
    echo 0
    return
  fi

  local count=0
  local path
  while IFS= read -r path; do
    [[ "$path" == "$WORKTREES_DIR" ]] && continue
    local relative="${path#"$WORKTREES_DIR"/}"
    case "$relative" in
      *"/.worktrees/"*) ((count+=1)) || true ;;
    esac
  done < <(find "$WORKTREES_DIR" -type d 2>/dev/null)

  echo "$count"
}

matches_test_session_name() {
  local path="$1"
  local name
  name="$(basename "$path")"

  case "$name" in
    session|session-*|new-session|new-session-*|build-new-feature|build-new-feature-*|test-git-session-creation|test-git-session-creation-*|api-test-without-git|api-test-without-git-*|pw-test-*)
      return 0
      ;;
  esac

  case "$path" in
    *"/session/"*|*"/session-"*|*"/new-session"*|*"/build-new-feature"*|*"/test-git-session-creation"*|*"/api-test-without-git"*|*"/pw-test-"*)
      return 0
      ;;
  esac

  return 1
}

is_under_worktrees_dir() {
  local path="$1"
  case "$path" in
    "$WORKTREES_DIR"/*) return 0 ;;
    *) return 1 ;;
  esac
}

is_current_checkout() {
  local path="$1"
  local current_root
  current_root="$(git -C "$REPO_ROOT" rev-parse --show-toplevel 2>/dev/null || true)"

  [[ -n "$current_root" ]] || return 1
  [[ "$(physical_path "$path")" == "$(physical_path "$current_root")" ]]
}

is_test_cruft_candidate() {
  local path="$1"
  local relative="${path#"$WORKTREES_DIR"/}"

  is_under_worktrees_dir "$path" || return 1
  [[ "$path" != "$WORKTREES_DIR" ]] || return 1
  is_current_checkout "$path" && return 1
  matches_test_session_name "$path" || return 1

  case "$relative" in
    *"/.worktrees/"*|*"/.worktrees"|session|session-*|new-session|new-session-*|build-new-feature|build-new-feature-*|test-git-session-creation|test-git-session-creation-*|api-test-without-git|api-test-without-git-*|pw-test-*)
      return 0
      ;;
  esac

  return 1
}

collect_test_cruft_candidates() {
  if [[ ! -d "$WORKTREES_DIR" ]]; then
    return 0
  fi

  while IFS= read -r path; do
    if is_test_cruft_candidate "$path"; then
      printf '%s\n' "$path"
    fi
  done < <(find "$WORKTREES_DIR" -type d 2>/dev/null)
}

sort_deepest_first() {
  awk '{ depth=gsub(/\//, "/"); printf "%08d\t%s\n", depth, $0 }' | sort -rn | cut -f2-
}

print_audit_report() {
  local selected_file="$1"

  if [[ ! -f "$AUDIT_FILE" ]]; then
    return 0
  fi

  local selected_in_audit=0
  local listed_missing=0
  local audit_path

  while IFS= read -r audit_path || [[ -n "$audit_path" ]]; do
    [[ -z "$audit_path" ]] && continue

    if grep -Fxq "$audit_path" "$selected_file"; then
      ((selected_in_audit+=1)) || true
    fi

    if [[ ! -e "$audit_path" ]]; then
      ((listed_missing+=1)) || true
    fi
  done < "$AUDIT_FILE"

  echo ""
  echo "Audit file: $AUDIT_FILE"
  echo "  Selected paths present in audit file : $selected_in_audit"
  echo "  Audit paths no longer on disk        : $listed_missing"
}

run_test_cruft_cleanup() {
  local selected_file
  selected_file="$(mktemp)"
  trap "rm -f '$selected_file'" EXIT

  collect_test_cruft_candidates | sort_deepest_first > "$selected_file"

  local selected_count=0
  local total_kb=0
  local path

  while IFS= read -r path || [[ -n "$path" ]]; do
    [[ -z "$path" ]] && continue
    ((selected_count+=1)) || true
    total_kb=$((total_kb + $(size_kb "$path")))
  done < "$selected_file"

  local before_count
  before_count="$(count_nested_test_dirs)"

  if $DRY_RUN; then
    echo "=== DRY RUN -- pass --apply to delete selected E2E worktree cruft ==="
  else
    echo "=== Removing selected E2E worktree cruft ==="
  fi
  echo "Worktree root scanned : $WORKTREES_DIR"
  echo "Nested dir count before: $before_count"
  echo ""

  while IFS= read -r path || [[ -n "$path" ]]; do
    [[ -z "$path" ]] && continue

    local size
    size="$(human_size "$path")"
    if $DRY_RUN; then
      echo "WOULD DELETE [$size]: $path"
    else
      echo "REMOVING [$size]: $path"
      rm -rf -- "$path"
    fi
  done < "$selected_file"

  if ! $DRY_RUN; then
    git -C "$REPO_ROOT" worktree prune
  fi

  local after_count="$before_count"
  if ! $DRY_RUN; then
    after_count="$(count_nested_test_dirs)"
  fi

  local total_gb
  total_gb=$(awk "BEGIN {printf \"%.2f\", $total_kb / 1024 / 1024}")

  echo ""
  echo "================================"
  if $DRY_RUN; then
    echo "DRY RUN complete"
    echo "  Would delete : $selected_count directories (~${total_gb} GB)"
  else
    echo "Cleanup complete"
    echo "  Deleted      : $selected_count directories (~${total_gb} GB freed)"
  fi
  echo "  Nested before: $before_count"
  echo "  Nested after : $after_count"
  echo "================================"

  print_audit_report "$selected_file"

  if $DRY_RUN; then
    echo ""
    echo "Run with --test-cruft --apply to actually delete:"
    echo "  ./scripts/cleanup-old-worktrees.sh --test-cruft --apply"
  fi
}

run_static_list_cleanup() {
  if [[ ! -f "$LIST_FILE" ]]; then
    echo "ERROR: List file not found: $LIST_FILE"
    exit 1
  fi

  if $DRY_RUN; then
    echo "=== DRY RUN -- pass --execute to actually delete ==="
    echo ""
  fi

  local this_worktree_uuid
  this_worktree_uuid="$(basename "$(git rev-parse --show-toplevel 2>/dev/null || echo "")")"

  local deleted=0
  local skipped=0
  local not_found=0
  local failed=0
  local total_kb=0
  local uuid

  while IFS= read -r uuid || [[ -n "$uuid" ]]; do
    [[ -z "$uuid" ]] && continue

    local path="$WORKTREES_DIR/$uuid"

    if [[ "$uuid" == "$this_worktree_uuid" ]]; then
      echo "SKIP (active): $uuid"
      ((skipped+=1)) || true
      continue
    fi

    if [[ ! -d "$path" ]]; then
      ((not_found+=1)) || true
      continue
    fi

    local size
    size="$(human_size "$path")"
    local path_kb
    path_kb="$(size_kb "$path")"

    if $DRY_RUN; then
      echo "WOULD DELETE [$size]: $uuid"
      ((deleted+=1)) || true
      total_kb=$((total_kb + path_kb))
    else
      if git -C "$REPO_ROOT" worktree remove --force "$path" 2>/dev/null; then
        echo "REMOVED (git): $uuid  [$size]"
      elif rm -rf -- "$path"; then
        echo "REMOVED (rm):  $uuid  [$size]"
      else
        echo "FAILED:        $uuid"
        ((failed+=1)) || true
        continue
      fi
      ((deleted+=1)) || true
      total_kb=$((total_kb + path_kb))
    fi
  done < "$LIST_FILE"

  local total_gb
  total_gb=$(awk "BEGIN {printf \"%.1f\", $total_kb / 1024 / 1024}")

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
}

if $TEST_CRUFT; then
  run_test_cruft_cleanup
else
  run_static_list_cleanup
fi
