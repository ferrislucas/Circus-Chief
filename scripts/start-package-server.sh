#!/bin/bash

# =============================================================================
# start-package-server.sh - Start the server from the built npm package
# =============================================================================
#
# Tests the actual published artifact by:
#   1. Building dist-package/ with build-package.js
#   2. Packing it into a tarball
#   3. Installing the tarball in an isolated temp directory
#   4. Starting the server from there
#
# This validates that `npx circuschief` will work for real users.
#
# PORT ASSIGNMENT:
#   Uses the same worktree-aware logic as start-server.sh.
#
# USAGE:
#   ./scripts/start-package-server.sh
#   VCR_MODE=replay ./scripts/start-package-server.sh
#
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PORT_FILE="$PROJECT_ROOT/.server-port"
WORKTREE_PORT_START=5001
MAIN_PORT=5000
INSTALL_DIR="$PROJECT_ROOT/.package-test"

# Clean up on exit — remove marker files so pw.sh doesn't find stale state
cleanup() {
    if [ -n "$SERVER_PID" ]; then
        kill "$SERVER_PID" 2>/dev/null || true
    fi
    rm -f "$PORT_FILE" "$PROJECT_ROOT/.db-path" "$PROJECT_ROOT/.vcr-mode"
}
trap cleanup EXIT

# Clean up stale port and db-path files
rm -f "$PORT_FILE"
rm -f "$PROJECT_ROOT/.db-path"

# --- Detect worktree ---
is_worktree() {
    [ -f "$PROJECT_ROOT/.git" ]
}

# --- Find available port ---
find_available_port() {
    local port=$1
    while lsof -i:${port} >/dev/null 2>&1; do
        ((port++))
    done
    echo $port
}

if is_worktree; then
    SELECTED_PORT=$(find_available_port $WORKTREE_PORT_START)
else
    if lsof -i:${MAIN_PORT} >/dev/null 2>&1; then
        echo "Port $MAIN_PORT is in use, finding another..."
        SELECTED_PORT=$(find_available_port $WORKTREE_PORT_START)
    else
        SELECTED_PORT=$MAIN_PORT
    fi
fi

echo "=== Building package ==="
node "$SCRIPT_DIR/build-package.js"

echo ""
echo "=== Packing tarball ==="
cd "$PROJECT_ROOT/dist-package"
TARBALL=$(npm pack 2>&1 | tail -1)
TARBALL_PATH="$PROJECT_ROOT/dist-package/$TARBALL"
echo "Tarball: $TARBALL_PATH"

echo ""
echo "=== Installing in isolated directory ==="
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Initialize package.json for the test installation
echo '{"name":"circuschief-test","version":"1.0.0"}' > package.json

npm install "$TARBALL_PATH" --save 2>&1 | tail -3

# Symlink the tests directory so VCR cassettes are reachable.
# The server resolves cassette paths relative to cwd (e.g. 'tests/e2e/cassettes'),
# so they must be accessible from $INSTALL_DIR.
ln -sf "$PROJECT_ROOT/tests" "$INSTALL_DIR/tests"

echo ""
echo "=== Starting server on port $SELECTED_PORT ==="
echo "$SELECTED_PORT" > "$PORT_FILE"
echo "${VCR_MODE:-}" > "$PROJECT_ROOT/.vcr-mode"

# Use an absolute DB_PATH so the test process (seed scripts) can access the same database.
# Without this, the server creates its DB at $INSTALL_DIR/circuschief.db but the seed scripts
# default to $PROJECT_ROOT/circuschief.db — a completely different (empty) file.
export DB_PATH="$INSTALL_DIR/circuschief.db"
echo "$DB_PATH" > "$PROJECT_ROOT/.db-path"

# Start the server from the installed package
cd "$INSTALL_DIR"
VCR_MODE="${VCR_MODE:-}" DB_PATH="$DB_PATH" node node_modules/.bin/circuschief -p "$SELECTED_PORT"
