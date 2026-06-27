#!/usr/bin/env bash
# scripts/lib/test-worktree-cleanup.sh
#
# Shared helpers for E2E test branch cleanup.
# Source this file; do not execute it directly.
#
# Consumers must set REPO_ROOT before sourcing.
#
# Public functions:
#   cleanup_e2e_branches <dry_run:true|false>
#     Selects merged, allowlisted, non-active local branches and deletes them
#     (or prints what would be deleted in dry-run mode).
#     Returns 0. Any git errors are treated as best-effort and logged.

# ---------------------------------------------------------------------------
# Branch name allowlist
# Glob patterns matched against local branch names via `git branch --list`.
# Only branches whose names satisfy at least one pattern are candidates.
# ---------------------------------------------------------------------------
_E2E_BRANCH_PATTERNS=(
    'circus-chief/????-session'
    'circus-chief/????-session-*'
    'circus-chief/????-new-session'
    'circus-chief/????-new-session-*'
    'circus-chief/????-build-new-feature'
    'circus-chief/????-api-test-without-git'
    'circus-chief/????-test-git-session-creation'
)

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

# Emit the set of branch names currently checked out in any active worktree,
# one per line.  Parses `git worktree list --porcelain`.
_active_worktree_branches() {
    local repo_root="${1:-${REPO_ROOT:-}}"
    git -C "$repo_root" worktree list --porcelain 2>/dev/null \
        | awk '/^branch / { sub(/^branch refs\/heads\//, ""); print }'
}

# Emit all local branch names that match any pattern in _E2E_BRANCH_PATTERNS,
# one per line.
_e2e_branch_candidates() {
    local repo_root="${1:-${REPO_ROOT:-}}"
    local pattern
    for pattern in "${_E2E_BRANCH_PATTERNS[@]}"; do
        git -C "$repo_root" branch --list "$pattern" 2>/dev/null \
            | sed 's/^[[:space:]]*//' \
            | sed 's/^\* //'
    done | sort -u
}

# Check whether origin/main is reachable. Prints a warning and returns 1 if not.
_check_origin_main() {
    local repo_root="${1:-${REPO_ROOT:-}}"
    if ! git -C "$repo_root" rev-parse --verify origin/main >/dev/null 2>&1; then
        echo "WARNING: origin/main is not available; skipping E2E branch deletion" >&2
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# Public function
# ---------------------------------------------------------------------------

# cleanup_e2e_branches <dry_run> [repo_root]
#
# Selects local branches that are:
#   - matched by the allowlist patterns
#   - not the current branch
#   - not attached to any active worktree
#   - merged into origin/main
#
# In dry-run mode (dry_run=true) prints what would be deleted.
# In apply mode (dry_run=false) deletes with `git branch -d`.
# Always returns 0 (best-effort; errors are logged to stderr).
#
# Prints a summary: "E2E branch cleanup: X selected, Y deleted" (or "Y would delete").
cleanup_e2e_branches() {
    local dry_run="${1:-true}"
    local repo_root="${2:-${REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || echo "")}}"

    if [ -z "$repo_root" ]; then
        echo "WARNING: cleanup_e2e_branches: REPO_ROOT not set; skipping" >&2
        return 0
    fi

    # Require origin/main
    if ! _check_origin_main "$repo_root"; then
        return 0
    fi

    # Current branch name
    local current_branch
    current_branch="$(git -C "$repo_root" symbolic-ref --short HEAD 2>/dev/null || true)"

    # Branches attached to active worktrees
    local active_branches
    active_branches="$(_active_worktree_branches "$repo_root")"

    # Candidate branches from allowlist
    local candidates
    candidates="$(_e2e_branch_candidates "$repo_root")"

    if [ -z "$candidates" ]; then
        echo "E2E branch cleanup: 0 selected, 0 deleted" >&2
        return 0
    fi

    local selected=0
    local deleted=0
    local branch

    while IFS= read -r branch; do
        [ -z "$branch" ] && continue

        # Skip current branch
        if [ "$branch" = "$current_branch" ]; then
            continue
        fi

        # Skip branches attached to active worktrees
        if echo "$active_branches" | grep -qxF "$branch" 2>/dev/null; then
            continue
        fi

        # Skip if not merged into origin/main
        if ! git -C "$repo_root" merge-base --is-ancestor "$branch" origin/main 2>/dev/null; then
            continue
        fi

        selected=$((selected + 1))

        if [ "$dry_run" = "true" ]; then
            echo "WOULD DELETE branch: $branch" >&2
        else
            if git -C "$repo_root" branch -d "$branch" 2>/dev/null; then
                echo "Deleted branch: $branch" >&2
                deleted=$((deleted + 1))
            else
                echo "WARNING: could not delete branch: $branch" >&2
            fi
        fi
    done <<< "$candidates"

    if [ "$dry_run" = "true" ]; then
        echo "E2E branch cleanup: $selected selected (dry run)" >&2
    else
        echo "E2E branch cleanup: $selected selected, $deleted deleted" >&2
    fi

    # Echo counts to stdout so callers can capture them
    echo "$selected $deleted"
    return 0
}
