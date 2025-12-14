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
    print_info "Running Playwright tests..."
    docker compose -f "$COMPOSE_FILE" run --rm playwright test "$@"
}

# Capture screenshot
cmd_screenshot() {
    ensure_directories

    if [ -z "$1" ]; then
        print_error "URL is required"
        echo "Usage: $0 screenshot <url> [filename]"
        echo "Example: $0 screenshot http://localhost:5000 homepage.png"
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
    local url="${1:-http://localhost:5000}"

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

    print_info "Running tests in debug mode (headed browser)..."
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
                           Example: $(basename "$0") screenshot http://localhost:5000
                           Example: $(basename "$0") screenshot http://localhost:5000 home.png

  codegen [url]            Launch Playwright test generator (requires X11)
                           Example: $(basename "$0") codegen http://localhost:5000

  debug [args]             Run tests with headed browser (requires X11)
                           Example: $(basename "$0") debug tests/login.spec.ts

  shell                    Start interactive shell in container

  build                    Build the container image

  help                     Show this help message

Environment Variables:
  BASE_URL          Base URL for tests (default: http://localhost:5000)
  BROWSER           Browser: chromium, firefox, webkit (default: chromium)
  HEADLESS          Run headless: true/false (default: true)
  FULL_PAGE         Full page screenshots: true/false (default: false)
  VIEWPORT_WIDTH    Viewport width (default: 1280)
  VIEWPORT_HEIGHT   Viewport height (default: 720)
  DEVICE            Device emulation, e.g., "iPhone 14"
  TIMEOUT           Timeout in ms (default: 30000)

Examples:
  # Run all tests
  $(basename "$0") test

  # Run specific test
  $(basename "$0") test tests/auth.spec.ts

  # Screenshot with custom viewport
  VIEWPORT_WIDTH=1920 VIEWPORT_HEIGHT=1080 $(basename "$0") screenshot http://localhost:5000 wide.png

  # Mobile screenshot
  DEVICE="iPhone 14" $(basename "$0") screenshot http://localhost:5000 mobile.png

  # Full page screenshot
  FULL_PAGE=true $(basename "$0") screenshot http://localhost:5000 full.png

  # Use Firefox
  BROWSER=firefox $(basename "$0") test
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
