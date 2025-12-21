#!/bin/bash

# =============================================================================
# start-server.sh - Start the claudetools.io development server
# =============================================================================
#
# This script supports running multiple concurrent server instances, which is
# needed when working with git worktrees. Each worktree can have its own
# running server on a different port.
#
# PORT ASSIGNMENT LOGIC:
#   - Main repository (.git is a directory): Uses port 5000
#   - Git worktree (.git is a file):         Auto-assigns next available port (5001+)
#   - PORT env var set:                      Uses that port (overrides auto-detection)
#
# WHY THIS MATTERS:
#   When using git worktrees, each worktree is a separate working directory
#   that shares the same git history. To work on multiple features simultaneously,
#   each worktree needs its own server instance on a different port.
#
# PORT DISCOVERY:
#   The selected port is written to .server-port so other tools (like Playwright)
#   can discover which port this instance is using.
#
# USAGE:
#   ./scripts/start-server.sh           # Auto-detect port based on repo type
#   ./scripts/start-server.sh --force   # Kill existing process on target port first
#   PORT=5005 ./scripts/start-server.sh # Use explicit port
#
# =============================================================================

PORT_FILE=".server-port"

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
# Determine which port to use
#
# Priority:
#   1. PORT env var (explicit override)
#   2. Auto-detect based on worktree status:
#      - Worktree: find next available port starting at 5001
#      - Main repo: use default port 5000
# -----------------------------------------------------------------------------
if [ -n "$PORT" ]; then
    # Explicit PORT env var takes precedence
    SELECTED_PORT=$PORT
elif is_worktree; then
    # Worktree: find next available port starting at 5001
    # This ensures worktrees don't conflict with the main repo (port 5000)
    # or with each other
    SELECTED_PORT=$(find_available_port 5001)
else
    # Main repo: use default port 5000
    SELECTED_PORT=5000
fi

# -----------------------------------------------------------------------------
# Handle --force flag
#
# If --force is passed, kill any existing process on the target port.
# This is opt-in to prevent accidentally killing other instances.
# -----------------------------------------------------------------------------
if [[ "$1" == "--force" ]]; then
    PID=$(lsof -t -i:${SELECTED_PORT} 2>/dev/null)
    if [ -n "$PID" ]; then
        echo "Stopping process $PID on port ${SELECTED_PORT}..."
        kill -9 $PID 2>/dev/null
        sleep 1
    fi
fi

# -----------------------------------------------------------------------------
# Auto-kill any process on port 5000 if that's our target port
#
# Kill existing process on port 5000 to avoid conflicts when restarting.
# Only applies when running from the MAIN repo (not a worktree).
# Worktrees should never kill port 5000 as that belongs to the main repo.
# -----------------------------------------------------------------------------
if [ "$SELECTED_PORT" == "5000" ] && ! is_worktree; then
    PID_5000=$(lsof -t -i:5000 2>/dev/null)
    if [ -n "$PID_5000" ]; then
        echo "Killing existing process $PID_5000 on port 5000..."
        kill $PID_5000 2>/dev/null
        sleep 1
    fi
fi

# -----------------------------------------------------------------------------
# Check if port is available
#
# For the main repo or explicit PORT, fail if the port is already in use.
# This prevents accidentally running duplicate instances on the same port.
# -----------------------------------------------------------------------------
if lsof -i:${SELECTED_PORT} >/dev/null 2>&1; then
    echo "Error: Port ${SELECTED_PORT} is already in use"
    echo "Use --force to kill the existing process"
    exit 1
fi

# -----------------------------------------------------------------------------
# Write port to file for tool discovery
#
# Other tools (like playwright.config.ts) read this file to know which
# port the server is running on. This enables automatic port discovery
# without requiring manual configuration.
# -----------------------------------------------------------------------------
echo "$SELECTED_PORT" > "$PORT_FILE"

# -----------------------------------------------------------------------------
# Start the server
# -----------------------------------------------------------------------------
echo "Starting server on port ${SELECTED_PORT}..."
PORT=$SELECTED_PORT yarn dev
