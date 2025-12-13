#!/bin/bash
set -e

# Playwright Browser Container Entrypoint
# Handles multiple modes: test, screenshot, codegen, shell, and custom commands

# Detect host.docker.internal for macOS/Windows Docker Desktop
if ! ping -c 1 -W 1 host.docker.internal &>/dev/null; then
    # Running on Linux with host network mode - localhost works directly
    export HOST_ADDR="localhost"
else
    # Running on macOS/Windows - use host.docker.internal
    export HOST_ADDR="host.docker.internal"
fi

# Update BASE_URL if it contains localhost
if [[ "$BASE_URL" == *"localhost"* ]]; then
    export BASE_URL="${BASE_URL//localhost/$HOST_ADDR}"
fi

# Function to run playwright tests
run_tests() {
    cd /tools

    # Make @playwright/test available to test files in /tests
    export NODE_PATH="/tools/node_modules:${NODE_PATH:-}"

    # Check if playwright.config exists in tests or use mounted one
    if [ -f "/app/playwright.config.ts" ]; then
        CONFIG_ARG="--config=/app/playwright.config.ts"
    elif [ -f "/tests/playwright.config.ts" ]; then
        CONFIG_ARG="--config=/tests/playwright.config.ts"
    else
        CONFIG_ARG=""
    fi

    # Build test command
    local test_args=("$@")

    # Run tests from /tools where @playwright/test is installed
    npx playwright test $CONFIG_ARG "${test_args[@]}"
}

# Function to capture screenshot
run_screenshot() {
    local url="${1:-$BASE_URL}"
    local output="${2:-screenshot.png}"

    # Ensure output goes to screenshots directory if not absolute path
    if [[ "$output" != /* ]]; then
        output="/screenshots/$output"
    fi

    node /tools/screenshot.js "$url" "$output"
    echo "Screenshot saved to: $output"
}

# Function to run codegen (requires X11 forwarding for headed mode)
run_codegen() {
    local url="${1:-$BASE_URL}"
    npx playwright codegen "$url"
}

# Function to show help
show_help() {
    cat << EOF
Playwright Browser Container

Usage: docker run [options] playwright-browser <command> [args]

Commands:
  test [args]              Run Playwright tests
                           Example: test --grep="login"
                           Example: test tests/home.spec.ts

  screenshot <url> [file]  Capture screenshot of URL
                           Example: screenshot http://localhost:5173 home.png
                           Example: screenshot http://localhost:5000/api/health api.png

  codegen [url]            Launch Playwright codegen (requires X11)
                           Example: codegen http://localhost:5173

  shell                    Start interactive bash shell

  help                     Show this help message

Environment Variables:
  BASE_URL          Base URL for tests (default: http://localhost:5173)
  BROWSER           Browser to use: chromium, firefox, webkit (default: chromium)
  HEADLESS          Run headless: true/false (default: true)
  FULL_PAGE         Capture full page screenshots: true/false (default: false)
  VIEWPORT_WIDTH    Viewport width in pixels (default: 1280)
  VIEWPORT_HEIGHT   Viewport height in pixels (default: 720)
  DEVICE            Emulate device, e.g., "iPhone 14", "Pixel 5"
  TIMEOUT           Default timeout in ms (default: 30000)

Examples:
  # Run all tests
  docker compose run --rm playwright test

  # Run specific test file
  docker compose run --rm playwright test tests/auth.spec.ts

  # Capture screenshot
  docker compose run --rm playwright screenshot http://localhost:5173 homepage.png

  # Capture full-page screenshot
  docker compose run --rm -e FULL_PAGE=true playwright screenshot http://localhost:5173 full.png

  # Use mobile viewport
  docker compose run --rm -e DEVICE="iPhone 14" playwright screenshot http://localhost:5173 mobile.png
EOF
}

# Main command router
case "${1:-test}" in
    test)
        shift || true
        run_tests "$@"
        ;;
    screenshot)
        shift || true
        run_screenshot "$@"
        ;;
    codegen)
        shift || true
        run_codegen "$@"
        ;;
    shell|bash|sh)
        exec /bin/bash
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        # Pass through any other command
        exec "$@"
        ;;
esac
