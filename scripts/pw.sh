#!/bin/bash

# Playwright Browser Container CLI
# Convenience wrapper for Playwright commands
# Uses Docker when available, falls back to npx otherwise
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

# Detect if Docker is available and running
has_docker() {
    if command -v docker &> /dev/null && docker info &> /dev/null; then
        return 0
    else
        return 1
    fi
}

# Set USE_DOCKER based on availability
if has_docker; then
    USE_DOCKER=true
else
    USE_DOCKER=false
fi

# Default: test against dev server, not the built package
USE_PACKAGE_SERVER=false

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
            # Verify the server belongs to THIS worktree by checking its cwd.
            # Without this, a stale .server-port can cause us to reuse a server
            # from a different worktree that happens to be on the same port.
            local server_cwd
            server_cwd=$(curl -s "http://localhost:$detected_port/api/server-info" 2>/dev/null | grep -o '"cwd":"[^"]*"' | sed 's/"cwd":"//;s/"$//')

            if [ -n "$server_cwd" ] && [ "$server_cwd" != "$PROJECT_ROOT" ]; then
                print_warning "Server on port $detected_port belongs to a different worktree:"
                print_warning "  server cwd:  $server_cwd"
                print_warning "  our root:    $PROJECT_ROOT"
                print_info "Removing stale .server-port and starting a new server..."
                rm -f "$port_file" "$PROJECT_ROOT/.vcr-mode" "$PROJECT_ROOT/.db-path"
            else
                # Server belongs to us - always restart it
                if [ "$detected_port" = "5000" ]; then
                    # Never kill port 5000 - just start a new server on a different port
                    print_warning "Server on port 5000 is protected. Starting on a new port..."
                    rm -f "$port_file" "$PROJECT_ROOT/.vcr-mode" "$PROJECT_ROOT/.db-path"
                else
                    print_info "Restarting server on port $detected_port..."
                    local server_pid
                    server_pid=$(lsof -t -i:"$detected_port" 2>/dev/null)
                    if [ -n "$server_pid" ]; then
                        kill "$server_pid" 2>/dev/null
                        # Wait for port to be released (up to 5 seconds)
                        local wait_count=0
                        while lsof -i:"$detected_port" >/dev/null 2>&1 && [ $wait_count -lt 5 ]; do
                            sleep 1
                            ((wait_count++))
                        done
                    fi
                    rm -f "$port_file" "$PROJECT_ROOT/.vcr-mode" "$PROJECT_ROOT/.db-path"
                fi
            fi
        else
            print_warning "Server not running on port $detected_port (stale .server-port file)"
            rm -f "$port_file" "$PROJECT_ROOT/.vcr-mode" "$PROJECT_ROOT/.db-path"
        fi
    fi

    # No valid server found, start one
    local start_script="$SCRIPT_DIR/start-server.sh"
    if [ "$USE_PACKAGE_SERVER" = true ]; then
        start_script="$SCRIPT_DIR/start-package-server.sh"
        print_info "Starting server from built npm package..."
    else
        print_info "Starting server..."
    fi

    # Run start script in background
    "$start_script" > /tmp/server-startup.log 2>&1 &
    local server_pid=$!

    # Wait for .server-port file to be created
    # Package server needs longer timeout (build + npm install)
    local elapsed=0
    local timeout=60
    if [ "$USE_PACKAGE_SERVER" = true ]; then
        timeout=120
    fi
    while [ $elapsed -lt $timeout ]; do
        if [ -f "$port_file" ]; then
            detected_port=$(cat "$port_file")
            print_success "Server started with port: $detected_port"

            # Wait for server to be ready (increased timeout from 30 to 90 seconds for builds)
            if wait_for_server "$detected_port" 90; then
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
# All print functions output to stderr to avoid polluting function return values
print_info() {
    echo -e "${BLUE}ℹ${NC} $1" >&2
}

print_success() {
    echo -e "${GREEN}✓${NC} $1" >&2
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1" >&2
}

print_error() {
    echo -e "${RED}✗${NC} $1" >&2
}

# Ensure dependencies are installed
ensure_dependencies() {
    if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
        print_info "Installing dependencies..."
        cd "$PROJECT_ROOT" && yarn install
    fi
}

# Ensure required directories exist
ensure_directories() {
    mkdir -p "$PROJECT_ROOT/screenshots"
    mkdir -p "$PROJECT_ROOT/playwright-report"
    mkdir -p "$PROJECT_ROOT/tests"
}

# Clear provider environment variables to prevent leakage into tests
# This ensures test isolation and prevents accidental use of production credentials
clear_provider_env_vars() {
    unset ANTHROPIC_BASE_URL
    unset ANTHROPIC_API_KEY
    unset ANTHROPIC_AUTH_TOKEN
    unset ANTHROPIC_DEFAULT_OPUS_MODEL
    unset ANTHROPIC_DEFAULT_SONNET_MODEL
    unset ANTHROPIC_DEFAULT_HAIKU_MODEL
    unset API_TIMEOUT_MS
}

# Build the container
cmd_build() {
    if [ "$USE_DOCKER" = true ]; then
        print_info "Building Playwright container..."
        docker compose -f "$COMPOSE_FILE" build playwright
        print_success "Container built successfully"
    else
        print_warning "Docker is not available. Installing Playwright browsers via npx..."
        cd "$PROJECT_ROOT" && npx playwright install --with-deps chromium
        print_success "Playwright browsers installed successfully"
    fi
}

# Run tests
cmd_test() {
    ensure_dependencies
    ensure_directories

    # Clear provider environment variables before running tests
    clear_provider_env_vars

    # Enable VCR mode for E2E tests (replay committed cassettes; use VCR_MODE=record to re-record)
    export VCR_MODE=${VCR_MODE:-replay}

    # Ensure server is running
    local TEST_SERVER_PORT
    TEST_SERVER_PORT=$(detect_or_start_server)
    if [ -z "$TEST_SERVER_PORT" ]; then
        print_error "Failed to start or detect server. Cannot run tests."
        exit 1
    fi

    export API_URL="http://localhost:$TEST_SERVER_PORT"
    export BASE_URL="http://localhost:$TEST_SERVER_PORT"

    # When testing the built package, export DB_PATH so seed scripts access
    # the same database the package server uses (not the default cwd-relative one).
    if [ "$USE_PACKAGE_SERVER" = true ]; then
        local db_path_file="$PROJECT_ROOT/.db-path"
        if [ -f "$db_path_file" ]; then
            export DB_PATH="$(cat "$db_path_file")"
            print_info "DB_PATH set to: $DB_PATH"
        else
            print_warning "No .db-path file found — seed scripts may use wrong database"
        fi
    fi

    print_info "Running Playwright tests on port: $TEST_SERVER_PORT"

    local exit_code
    if [ "$USE_DOCKER" = true ]; then
        # Use -T to disable pseudo-TTY allocation in docker
        # This prevents conflicts with the PTY wrapper used by command buttons
        # and ensures output is properly line-buffered for real-time streaming
        docker compose -f "$COMPOSE_FILE" run --rm -T playwright test "$@"
        exit_code=$?
    else
        print_info "Using npx playwright (Docker not available)"
        cd "$PROJECT_ROOT" && npx playwright test "$@"
        exit_code=$?
    fi

    # Explicitly return the exit code
    return $exit_code
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
    if [ "$USE_DOCKER" = true ]; then
        docker compose -f "$COMPOSE_FILE" run --rm playwright screenshot "$url" "$filename"
    else
        print_info "Using npx playwright (Docker not available)"
        cd "$PROJECT_ROOT" && npx playwright screenshot "$url" "screenshots/$filename"
    fi
    print_success "Screenshot saved to: screenshots/$filename"
}

# Run codegen
cmd_codegen() {
    ensure_dependencies

    # Clear provider environment variables before running codegen
    clear_provider_env_vars

    # Ensure server is running to provide a default URL
    local SERVER_PORT
    SERVER_PORT=$(detect_or_start_server)
    if [ -z "$SERVER_PORT" ]; then
        print_error "Failed to start or detect server. Cannot run codegen."
        exit 1
    fi

    local url="${1:-http://localhost:$SERVER_PORT}"

    # Check if X11 is available (only needed for Docker on Linux)
    if [ "$USE_DOCKER" = true ] && [ -z "$DISPLAY" ]; then
        print_warning "DISPLAY not set. Codegen requires X11 for headed mode."
        print_info "On Linux, try: export DISPLAY=:0"
        print_info "On macOS, install XQuartz and run: xhost +localhost"
    fi

    print_info "Starting Playwright codegen for: $url"
    if [ "$USE_DOCKER" = true ]; then
        docker compose -f "$COMPOSE_FILE" --profile headed run --rm playwright-headed codegen "$url"
    else
        print_info "Using npx playwright (Docker not available)"
        cd "$PROJECT_ROOT" && npx playwright codegen "$url"
    fi
}

# Interactive shell
cmd_shell() {
    ensure_dependencies
    ensure_directories
    print_info "Starting interactive shell..."
    if [ "$USE_DOCKER" = true ]; then
        docker compose -f "$COMPOSE_FILE" run --rm playwright shell
    else
        print_info "Using local shell (Docker not available)"
        print_info "You can run Playwright commands with: npx playwright <command>"
        cd "$PROJECT_ROOT" && exec bash
    fi
}

# Debug mode (headed browser)
cmd_debug() {
    ensure_dependencies
    ensure_directories

    # Clear provider environment variables before running tests
    clear_provider_env_vars

    # Enable VCR mode for E2E tests (replay committed cassettes; use VCR_MODE=record to re-record)
    export VCR_MODE=${VCR_MODE:-replay}

    # Check if X11 is available (only needed for Docker on Linux)
    if [ "$USE_DOCKER" = true ] && [ -z "$DISPLAY" ]; then
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

    local exit_code
    if [ "$USE_DOCKER" = true ]; then
        # Use -T for output streaming (headed mode still works with X11 forwarding)
        docker compose -f "$COMPOSE_FILE" --profile headed run --rm -T playwright-headed test "$@"
        exit_code=$?
    else
        print_info "Using npx playwright (Docker not available)"
        cd "$PROJECT_ROOT" && npx playwright test --headed "$@"
        exit_code=$?
    fi

    return $exit_code
}

# Show help
cmd_help() {
    local mode_info
    if [ "$USE_DOCKER" = true ]; then
        mode_info="Docker (available)"
    else
        mode_info="npx (Docker not available)"
    fi

    cat << EOF
Playwright CLI - Uses Docker when available, falls back to npx

Current mode: $mode_info

Usage: $(basename "$0") <command> [args]

Commands:
  test [args]              Run Playwright tests
                           Example: $(basename "$0") test
                           Example: $(basename "$0") test --grep="login"
                           Example: $(basename "$0") test tests/home.spec.ts

  screenshot <url> [file]  Capture screenshot of URL
                           Example: $(basename "$0") screenshot \$SERVER_URL
                           Example: $(basename "$0") screenshot \$SERVER_URL home.png

  codegen [url]            Launch Playwright test generator (requires X11 with Docker)
                           Example: $(basename "$0") codegen

  debug [args]             Run tests with headed browser (requires X11 with Docker)
                           Example: $(basename "$0") debug tests/login.spec.ts

  shell                    Start interactive shell in container (or local shell if no Docker)

  build                    Build the container image (or install browsers if no Docker)

  help                     Show this help message

Mode Detection:
  • Docker available and running → uses Docker containers
  • Docker not available → uses npx playwright directly

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
    test-package)
        shift
        USE_PACKAGE_SERVER=true
        cmd_test "$@"
        ;;
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
