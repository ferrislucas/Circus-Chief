#!/bin/bash

PORT_FILE=".server-port"

# Detect if we're in a worktree (worktrees have .git as a file, not directory)
is_worktree() {
    [ -f .git ]
}

# Find next available port starting from given base
find_available_port() {
    local port=$1
    while lsof -i:${port} >/dev/null 2>&1; do
        ((port++))
    done
    echo $port
}

# Determine port
if [ -n "$PORT" ]; then
    # Explicit PORT env var takes precedence
    SELECTED_PORT=$PORT
elif is_worktree; then
    # Worktree: find next available port starting at 5001
    SELECTED_PORT=$(find_available_port 5001)
else
    # Main repo: use default port 5000
    SELECTED_PORT=5000
fi

# Handle --force flag
if [[ "$1" == "--force" ]]; then
    PID=$(lsof -t -i:${SELECTED_PORT} 2>/dev/null)
    if [ -n "$PID" ]; then
        echo "Stopping process $PID on port ${SELECTED_PORT}..."
        kill -9 $PID 2>/dev/null
        sleep 1
    fi
fi

# Check if port is already in use (for main repo or explicit PORT)
if lsof -i:${SELECTED_PORT} >/dev/null 2>&1; then
    echo "Error: Port ${SELECTED_PORT} is already in use"
    echo "Use --force to kill the existing process"
    exit 1
fi

# Write port to file for other tools to discover
echo "$SELECTED_PORT" > "$PORT_FILE"

echo "Starting server on port ${SELECTED_PORT}..."
PORT=$SELECTED_PORT yarn dev
