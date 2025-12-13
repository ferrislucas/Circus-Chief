# Playwright Browser Container

A Docker container for browser automation, testing, and screenshots. Supports hitting localhost URLs from your dev environment.

## Quick Start

```bash
# Build the container
./scripts/pw.sh build

# Take a screenshot
./scripts/pw.sh screenshot http://localhost:5173 homepage.png

# Run tests
./scripts/pw.sh test
```

## Commands

| Command | Description |
|---------|-------------|
| `./scripts/pw.sh build` | Build the container image |
| `./scripts/pw.sh test [args]` | Run Playwright tests |
| `./scripts/pw.sh screenshot <url> [file]` | Capture screenshot |
| `./scripts/pw.sh codegen [url]` | Interactive test generator |
| `./scripts/pw.sh debug [args]` | Run tests with headed browser |
| `./scripts/pw.sh shell` | Interactive shell access |
| `./scripts/pw.sh help` | Show help |

## Screenshots

```bash
# Basic screenshot
./scripts/pw.sh screenshot http://localhost:5173 home.png

# Full page capture
FULL_PAGE=true ./scripts/pw.sh screenshot http://localhost:5173 full.png

# Mobile device emulation
DEVICE="iPhone 14" ./scripts/pw.sh screenshot http://localhost:5173 mobile.png

# Custom viewport
VIEWPORT_WIDTH=1920 VIEWPORT_HEIGHT=1080 ./scripts/pw.sh screenshot http://localhost:5173 wide.png

# Use Firefox
BROWSER=firefox ./scripts/pw.sh screenshot http://localhost:5173 firefox.png
```

Screenshots are saved to the `screenshots/` directory.

## Running Tests

```bash
# Run all tests
./scripts/pw.sh test

# Run specific test file
./scripts/pw.sh test tests/auth.spec.ts

# Run tests matching pattern
./scripts/pw.sh test --grep="login"

# Run with specific browser
BROWSER=firefox ./scripts/pw.sh test
```

Test reports are saved to `playwright-report/`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:5173` | Base URL for tests |
| `BROWSER` | `chromium` | Browser: `chromium`, `firefox`, `webkit` |
| `HEADLESS` | `true` | Run headless mode |
| `FULL_PAGE` | `false` | Capture full page screenshots |
| `VIEWPORT_WIDTH` | `1280` | Viewport width in pixels |
| `VIEWPORT_HEIGHT` | `720` | Viewport height in pixels |
| `DEVICE` | - | Device emulation (e.g., `"iPhone 14"`, `"Pixel 5"`) |
| `TIMEOUT` | `30000` | Default timeout in milliseconds |

## Localhost Access

The container uses `network_mode: host` to access services on your machine:

| Service | URL |
|---------|-----|
| Frontend (Vite) | `http://localhost:5173` |
| Backend (Express) | `http://localhost:5000` |

**macOS/Windows**: The entrypoint auto-detects Docker Desktop and uses `host.docker.internal`.

## Volume Mounts

| Host Path | Container Path | Purpose |
|-----------|---------------|---------|
| `./tests` | `/tests` | Test files (read-only) |
| `./screenshots` | `/screenshots` | Screenshot output |
| `./playwright-report` | `/reports` | Test reports |
| `./playwright.config.ts` | `/app/playwright.config.ts` | Config file |

## Device Emulation

Available devices include:
- `iPhone 14`, `iPhone 14 Pro Max`
- `Pixel 5`, `Pixel 7`
- `iPad Pro 11`
- `Desktop Chrome`, `Desktop Firefox`, `Desktop Safari`

See [Playwright device list](https://playwright.dev/docs/emulation#devices) for all options.

## Direct Docker Usage

If you prefer using Docker directly:

```bash
# Build
docker compose -f docker-compose.playwright.yml build

# Screenshot
docker compose -f docker-compose.playwright.yml run --rm playwright screenshot http://localhost:5173 home.png

# Tests
docker compose -f docker-compose.playwright.yml run --rm playwright test

# Shell
docker compose -f docker-compose.playwright.yml run --rm playwright shell
```

## Troubleshooting

**Permission denied on screenshots**: Ensure the `screenshots/` directory exists and is writable.

**Cannot connect to localhost**: Verify your dev server is running and the port is correct.

**Browser launch fails**: The container includes browsers. If issues persist, rebuild with `./scripts/pw.sh build`.

**Codegen not working**: Codegen requires X11 forwarding for the headed browser. On Linux, ensure `DISPLAY` is set.
