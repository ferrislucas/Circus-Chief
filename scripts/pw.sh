#!/bin/bash

# Playwright Browser Container CLI
# Convenience wrapper for docker compose commands
#
# Usage: ./scripts/pw.sh <command> [args]
#
# Commands:
#   test [args]              Run Playwright tests
#   screenshot <url> [file]  Capture screenshot
#   codegen [url]            Interactive test generator (requires X11)
#   shell                    Interactive shell access
#   build                    Build the container image
#   help                     Show help message

set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Compose file location
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.playwright.yml"

# Wait for server to be ready
# Polls the server on the given port until it responds or timeout
# Args: $1 = port number, $2 = timeout in seconds (default: 30)
wait_for_server() {
    local port=$1
    local timeout=${2:-30}
    local elapsed=0

    print_info "Waiting for server on port $port to be ready..."

    while [ $elapsed -lt $timeout ]; do
        if curl -s "http://localhost:$port/api/projects" > /dev/null 2>&1; then
            print_success "Server is ready on port $port"
            return 0
        fi
        sleep 1
        ((elapsed++))
    done

    print_error "Server did not respond after ${timeout}s"
    return 1
}

# Detect or start server
# Checks if .server-port exists and if server is running, or starts it
# Returns the port number on success
detect_or_start_server() {
    local port_file="$PROJECT_ROOT/.server-port"
    local detected_port=""

    # Check if .server-port file exists
    if [ -f "$port_file" ]; then
        detected_port=$(cat "$port_file")
        print_info "Found .server-port file with port: $detected_port"

        # Check if server is actually running on that port
        if curl -s "http://localhost:$detected_port/api/projects" > /dev/null 2>&1; then
            print_success "Server is already running on port $detected_port"
            echo "$detected_port"
            return 0
        else
            print_warning "Server not running on port $detected_port (stale .server-port file)"
            rm -f "$port_file"
        fi
    fi

    # No valid server found, start one
    print_info "Starting server..."

    # Run start-server.sh in background
    "$SCRIPT_DIR/start-server.sh" > /tmp/server-startup.log 2>&1 &
    local server_pid=$!

    # Wait for .server-port file to be created
    local elapsed=0
    local timeout=30
    while [ $elapsed -lt $timeout ]; do
        if [ -f "$port_file" ]; then
            detected_port=$(cat "$port_file")
            print_success "Server started with port: $detected_port"

            # Wait for server to be ready
            if wait_for_server "$detected_port" 30; then
                echo "$detected_port"
                return 0
            else
                print_error "Failed to start server. Check /tmp/server-startup.log"
                return 1
            fi
        fi
        sleep 1
        ((elapsed++))
    done

    print_error "Server startup timed out. Check /tmp/server-startup.log"
    return 1
}

# Auto-detect server port (legacy, kept for backward compatibility)
detect_server_port() {
    local port_file="$PROJECT_ROOT/.server-port"
    if [ -f "$port_file" ]; then
        cat "$port_file"
    else
        echo ""  # No fallback - return empty
    fi
}

# Server port will be detected dynamically per command
# (Previously defaulted to 5000, now requires active server or auto-starts it)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored message
print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Ensure required directories exist
ensure_directories() {
    mkdir -p "$PROJECT_ROOT/screenshots"
    mkdir -p "$PROJECT_ROOT/playwright-report"
    mkdir -p "$PROJECT_ROOT/tests"
}

# Build the container
cmd_build() {
    print_info "Building Playwright container..."
    docker compose -f "$COMPOSE_FILE" build playwright
    print_success "Container built successfully"
}

# Run tests
cmd_test() {
    ensure_directories

    # Ensure server is running
    local TEST_SERVER_PORT
    TEST_SERVER_PORT=$(detect_or_start_server)
    if [ -z "$TEST_SERVER_PORT" ]; then
        print_error "Failed to start or detect server. Cannot run tests."
        exit 1
    fi

    export API_URL="http://localhost:$TEST_SERVER_PORT"
    export BASE_URL="http://localhost:$TEST_SERVER_PORT"
    print_info "Running Playwright tests on port: $TEST_SERVER_PORT"

    docker compose -f "$COMPOSE_FILE" run --rm playwright test "$@"
}

# Capture screenshot
cmd_screenshot() {
    ensure_directories

    if [ -z "$1" ]; then
        print_error "URL is required"
        echo "Usage: $0 screenshot <url> [filename]"

        # Try to detect the server for the example, but don't fail if it doesn't exist
        local example_url="http://localhost:5000"
        if [ -f "$PROJECT_ROOT/.server-port" ]; then
            local port=$(cat "$PROJECT_ROOT/.server-port")
            example_url="http://localhost:$port"
        fi

        echo "Example: $0 screenshot $example_url homepage.png"
        exit 1
    fi

    local url="$1"
    local filename="${2:-screenshot-$(date +%Y%m%d-%H%M%S).png}"

    print_info "Capturing screenshot of: $url"
    docker compose -f "$COMPOSE_FILE" run --rm playwright screenshot "$url" "$filename"
    print_success "Screenshot saved to: screenshots/$filename"
}

# Run codegen
cmd_codegen() {
    # Ensure server is running to provide a default URL
    local SERVER_PORT
    SERVER_PORT=$(detect_or_start_server)
    if [ -z "$SERVER_PORT" ]; then
        print_error "Failed to start or detect server. Cannot run codegen."
        exit 1
    fi

    local url="${1:-http://localhost:$SERVER_PORT}"

    # Check if X11 is available
    if [ -z "$DISPLAY" ]; then
        print_warning "DISPLAY not set. Codegen requires X11 for headed mode."
        print_info "On Linux, try: export DISPLAY=:0"
        print_info "On macOS, install XQuartz and run: xhost +localhost"
    fi

    print_info "Starting Playwright codegen for: $url"
    docker compose -f "$COMPOSE_FILE" --profile headed run --rm playwright-headed codegen "$url"
}

# Interactive shell
cmd_shell() {
    ensure_directories
    print_info "Starting interactive shell..."
    docker compose -f "$COMPOSE_FILE" run --rm playwright shell
}

# Debug mode (headed browser)
cmd_debug() {
    ensure_directories

    if [ -z "$DISPLAY" ]; then
        print_warning "DISPLAY not set. Debug mode requires X11 for headed mode."
    fi

    # Ensure server is running
    local TEST_SERVER_PORT
    TEST_SERVER_PORT=$(detect_or_start_server)
    if [ -z "$TEST_SERVER_PORT" ]; then
        print_error "Failed to start or detect server. Cannot run debug tests."
        exit 1
    fi

    export API_URL="http://localhost:$TEST_SERVER_PORT"
    export BASE_URL="http://localhost:$TEST_SERVER_PORT"
    print_info "Running tests in debug mode (headed browser) on port: $TEST_SERVER_PORT"

    docker compose -f "$COMPOSE_FILE" --profile headed run --rm playwright-headed test "$@"
}

# Show help
cmd_help() {
    cat << EOF
Playwright Browser Container CLI

Usage: $(basename "$0") <command> [args]

Commands:
  test [args]              Run Playwright tests
                           Example: $(basename "$0") test
                           Example: $(basename "$0") test --grep="login"
                           Example: $(basename "$0") test tests/home.spec.ts

  screenshot <url> [file]  Capture screenshot of URL
                           Example: $(basename "$0") screenshot $SERVER_URL
                           Example: $(basename "$0") screenshot $SERVER_URL home.png

  codegen [url]            Launch Playwright test generator (requires X11)
                           Example: $(basename "$0") codegen

  debug [args]             Run tests with headed browser (requires X11)
                           Example: $(basename "$0") debug tests/login.spec.ts

  shell                    Start interactive shell in container

  build                    Build the container image

  help                     Show this help message

Auto-Detection & Auto-Start:
  • If .server-port exists and server is running → use that port
  • If .server-port is stale or missing → automatically start server via ./scripts/start-server.sh
  • Each worktree gets its own port (main repo = 5000, worktrees = 5001+)
  • Tests will NEVER use the wrong server

Environment Variables:
  BASE_URL          Base URL for tests (auto-detected, can be overridden)
  BROWSER           Browser: chromium, firefox, webkit (default: chromium)
  HEADLESS          Run headless: true/false (default: true)
  FULL_PAGE         Full page screenshots: true/false (default: false)
  VIEWPORT_WIDTH    Viewport width (default: 1280)
  VIEWPORT_HEIGHT   Viewport height (default: 720)
  DEVICE            Device emulation, e.g., "iPhone 14"
  TIMEOUT           Timeout in ms (default: 30000)

Examples:
  # Run all tests (auto-starts server if needed)
  $(basename "$0") test

  # Run specific test
  $(basename "$0") test tests/auth.spec.ts

  # Debug mode (headed browser, auto-starts server)
  $(basename "$0") debug tests/login.spec.ts

  # Screenshot (server URL auto-detected from .server-port)
  $(basename "$0") screenshot http://localhost:5001 homepage.png

  # Codegen (auto-starts server and opens it by default)
  $(basename "$0") codegen

  # Use Firefox
  BROWSER=firefox $(basename "$0") test

  # Override auto-detected URL
  BASE_URL=http://localhost:3000 $(basename "$0") test
EOF
}

# Main command router
case "${1:-help}" in
    test)
        shift
        cmd_test "$@"
        ;;
    screenshot)
        shift
        cmd_screenshot "$@"
        ;;
    codegen)
        shift
        cmd_codegen "$@"
        ;;
    debug)
        shift
        cmd_debug "$@"
        ;;
    shell|bash|sh)
        cmd_shell
        ;;
    build)
        cmd_build
        ;;
    help|--help|-h)
        cmd_help
        ;;
    *)
        print_error "Unknown command: $1"
        echo ""
        cmd_help
        exit 1
        ;;
esac
