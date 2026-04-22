#!/bin/bash

# =============================================================================
# start-server.sh - Start the Circus Chief development server
# =============================================================================
#
# This script supports running multiple concurrent server instances for
# git worktree-based development. Each worktree gets its own server port.
#
# PORT ASSIGNMENT:
#   - Main repository (.git is a directory): Always uses port 5000
#   - Git worktree (.git is a file):         Auto-assigns next available port (5001+)
#
# PROTECTION:
#   Port 5000 is PROTECTED and will never be killed by worktrees.
#   This ensures the main development server remains stable.
#
# PORT DISCOVERY:
#   The selected port is written to .server-port so other tools (like Playwright)
#   can discover which port this instance is using.
#
# USAGE:
#   ./scripts/start-server.sh           # Start server (auto-detect port)
#   ./scripts/start-server.sh --force   # Kill existing process on target port first
#
# =============================================================================

# Resolve the project root deterministically from this script's own path so
# DB_PATH / port files always live in the worktree this script was launched
# from, regardless of the caller's cwd.
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PORT_FILE=".server-port"
MAIN_PORT=5000
WORKTREE_PORT_START=5001

# Parse optional --dry-run flag early so we can exit before `yarn build`
# (useful for shell-level unit tests that only want to inspect DB_PATH logic).
DRY_RUN=false
if [ "${1:-}" = "--dry-run" ]; then
    DRY_RUN=true
    shift
fi

# In --dry-run mode, do only DB_PATH resolution and exit. Doing it here (before
# any port / lsof / yarn logic) keeps the test fully stateless — no port 5000
# interaction, no side effects beyond writing the .db-path sidecar (which the
# test's throwaway root owns anyway).
if [ "$DRY_RUN" = true ]; then
    if [ -z "${DB_PATH:-}" ] && [ -n "${VCR_MODE:-}" ]; then
        DB_PATH="$PROJECT_ROOT/.circuschief-test.db"
    fi
    if [ -n "${DB_PATH:-}" ]; then
        echo "$DB_PATH" > "$PROJECT_ROOT/.db-path"
    else
        rm -f "$PROJECT_ROOT/.db-path"
    fi
    echo "DB_PATH=${DB_PATH:-}"
    exit 0
fi

# Clean up stale port file from previous runs
rm -f "$PORT_FILE"

# -----------------------------------------------------------------------------
# Detect if we're in a git worktree
#
# Git worktrees have a .git FILE (containing a path to the main repo's .git),
# while the main repository has a .git DIRECTORY.
# -----------------------------------------------------------------------------
is_worktree() {
    [ -f .git ]
}

# -----------------------------------------------------------------------------
# Find the next available port starting from a given base
#
# Iterates through ports until finding one that isn't in use.
# Uses lsof to check if a port has a listening process.
# -----------------------------------------------------------------------------
find_available_port() {
    local port=$1
    while lsof -i:${port} >/dev/null 2>&1; do
        ((port++))
    done
    echo $port
}

# -----------------------------------------------------------------------------
# Determine which port to use based on worktree status
# -----------------------------------------------------------------------------
if is_worktree; then
    # Worktree: find next available port starting at 5001
    # This ensures worktrees don't conflict with the main repo (port 5000)
    # or with each other
    SELECTED_PORT=$(find_available_port $WORKTREE_PORT_START)
else
    # Main repo: always use port 5000
    SELECTED_PORT=$MAIN_PORT
fi

# -----------------------------------------------------------------------------
# Handle --force flag
#
# Allows killing an existing process on the target port.
# IMPORTANT: Worktrees can NEVER kill port 5000 - this protects the main server.
# -----------------------------------------------------------------------------
if [[ "$1" == "--force" ]]; then
    if is_worktree && [ "$SELECTED_PORT" == "$MAIN_PORT" ]; then
        # This should never happen due to port assignment logic, but double-check
        echo "Error: Worktrees cannot kill the main server on port $MAIN_PORT"
        exit 1
    fi

    PID=$(lsof -t -i:${SELECTED_PORT} 2>/dev/null)
    if [ -n "$PID" ]; then
        if [ "$SELECTED_PORT" == "$MAIN_PORT" ]; then
            echo "Restarting main server (killing process $PID on port $MAIN_PORT)..."
        else
            echo "Stopping process $PID on port ${SELECTED_PORT}..."
        fi
        kill -9 $PID 2>/dev/null
        sleep 1
    fi
fi

# -----------------------------------------------------------------------------
# Check if port is available
# -----------------------------------------------------------------------------
if lsof -i:${SELECTED_PORT} >/dev/null 2>&1; then
    if is_worktree; then
        # Worktree port collision - find another port
        echo "Port ${SELECTED_PORT} is in use, finding another..."
        SELECTED_PORT=$(find_available_port $((SELECTED_PORT + 1)))
    else
        # Main repo - port 5000 is in use
        echo "Error: Port $MAIN_PORT is already in use"
        echo "Use --force to restart the main server"
        exit 1
    fi
fi

# -----------------------------------------------------------------------------
# Resolve DB_PATH.
#
# Priority:
#   1. Caller-provided DB_PATH wins (never clobbered).
#   2. If VCR_MODE is set (i.e. we were launched by pw.sh), isolate the DB
#      to the worktree so E2E tests can never corrupt the user's real DB.
#   3. Otherwise, leave DB_PATH unset so the server falls back to
#      getDefaultDbPath() (~/.circuschief/circuschief.db).
# -----------------------------------------------------------------------------
if [ -z "${DB_PATH:-}" ] && [ -n "${VCR_MODE:-}" ]; then
    DB_PATH="$PROJECT_ROOT/.circuschief-test.db"
fi
export DB_PATH

# Persist the effective DB_PATH (or remove the sidecar file) so pw.sh /
# seed scripts running in the same worktree can read it back. This preserves
# the existing package-server workflow.
if [ -n "${DB_PATH:-}" ]; then
    echo "$DB_PATH" > "$PROJECT_ROOT/.db-path"
else
    rm -f "$PROJECT_ROOT/.db-path"
fi

# -----------------------------------------------------------------------------
# Start the server
#
# Use VCR mode if VCR_MODE is set (for E2E tests)
# VCR_MODE can be: auto (default), record, or replay
# -----------------------------------------------------------------------------
echo "Starting server on port ${SELECTED_PORT}..."

# Build first, then write port file AFTER build completes.
# This prevents pw.sh from detecting the port and starting health checks
# while the build is still running (which can cause 30s timeout failures).
VCR_MODE="${VCR_MODE:-}" yarn build

# Write port to file for tool discovery (after build, before server start)
# Other tools (like playwright.config.ts) read this file to know which
# port the server is running on.
echo "$SELECTED_PORT" > "$PORT_FILE"

# Write VCR mode for pw.sh to detect mismatches
echo "${VCR_MODE:-}" > ".vcr-mode"

# Forward DB_PATH explicitly so inherited env can't be accidentally overridden
# by something in the user's shell.
NODE_ENV=production VCR_MODE="${VCR_MODE:-}" DB_PATH="${DB_PATH:-}" \
    node packages/server/src/index.js -p ${SELECTED_PORT}
