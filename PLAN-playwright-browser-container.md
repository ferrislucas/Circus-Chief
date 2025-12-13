# Playwright Browser Container Plan

## Overview

A Docker container providing browser automation capabilities for development and testing workflows. The container can:
- Run Playwright tests against localhost URLs (via host network access)
- Capture screenshots of web pages
- Execute browser-based tasks programmatically
- Integrate with the claudetools.io canvas for visual feedback

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Host Machine                              │
│  ┌─────────────────┐     ┌─────────────────────────────┐   │
│  │ Dev Server      │     │ Playwright Container        │   │
│  │ (localhost:5173)│◄────│                             │   │
│  │ (localhost:3000)│     │  • Chromium/Firefox/WebKit  │   │
│  └─────────────────┘     │  • Playwright Test Runner   │   │
│                          │  • Screenshot Tool          │   │
│  ┌─────────────────┐     │  • Node.js Runtime          │   │
│  │ Mounted Volumes │◄────│                             │   │
│  │ • /tests        │     └─────────────────────────────┘   │
│  │ • /screenshots  │                                        │
│  │ • /reports      │                                        │
│  └─────────────────┘                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Deliverables

### 1. Dockerfile (`docker/playwright/Dockerfile`)

Base image using Microsoft's official Playwright image with:
- All browser binaries (Chromium, Firefox, WebKit)
- Node.js 20 runtime
- pnpm package manager
- Custom entrypoint for flexible command execution

### 2. Docker Compose Configuration (`docker-compose.playwright.yml`)

Service definition with:
- Host network mode for localhost URL access
- Volume mounts for tests, screenshots, and reports
- Environment variable configuration
- Multiple service profiles (test, screenshot, interactive)

### 3. CLI Wrapper Script (`scripts/pw.sh`)

Convenience script providing:
- `./scripts/pw.sh test` - Run Playwright tests
- `./scripts/pw.sh screenshot <url> [filename]` - Capture screenshot
- `./scripts/pw.sh codegen <url>` - Generate test code interactively
- `./scripts/pw.sh shell` - Interactive shell in container

### 4. Screenshot Utility (`docker/playwright/tools/screenshot.js`)

Node.js script for capturing screenshots with options:
- Full page or viewport capture
- Multiple device emulations
- Custom viewport sizes
- Output format (PNG, JPEG, WebP)

### 5. Example Playwright Configuration (`playwright.config.docker.ts`)

Configuration optimized for containerized execution:
- Base URL pointing to host machine
- Screenshot and video settings
- Reporter configuration for CI/local use
- Project definitions for multiple browsers

---

## Implementation Steps

### Step 1: Create Docker Directory Structure

```
docker/
└── playwright/
    ├── Dockerfile
    ├── entrypoint.sh
    └── tools/
        ├── screenshot.js
        └── health-check.js
```

### Step 2: Build the Dockerfile

```dockerfile
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

# Install pnpm
RUN npm install -g pnpm

# Create working directories
WORKDIR /app
RUN mkdir -p /screenshots /reports /tests

# Copy tools
COPY tools/ /tools/

# Set entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["test"]
```

### Step 3: Create Entrypoint Script

The entrypoint handles multiple modes:
- `test` - Run Playwright tests from mounted directory
- `screenshot` - Capture screenshots using the screenshot tool
- `codegen` - Launch Playwright codegen (requires X11 forwarding)
- `shell` - Interactive bash shell
- Custom commands passed through

### Step 4: Create Docker Compose File

```yaml
services:
  playwright:
    build:
      context: ./docker/playwright
    network_mode: host
    volumes:
      - ./tests:/tests:ro
      - ./screenshots:/screenshots
      - ./playwright-report:/reports
      - ./playwright.config.ts:/app/playwright.config.ts:ro
    environment:
      - BASE_URL=http://localhost:5173
      - CI=true
```

### Step 5: Create CLI Wrapper Script

```bash
#!/bin/bash
# scripts/pw.sh - Playwright container CLI

case "$1" in
  test)
    docker compose -f docker-compose.playwright.yml run --rm playwright test
    ;;
  screenshot)
    docker compose -f docker-compose.playwright.yml run --rm playwright screenshot "$2" "$3"
    ;;
  # ... more commands
esac
```

### Step 6: Create Screenshot Tool

Node.js script using Playwright API:
- Accept URL and output path as arguments
- Support viewport/device configuration via env vars
- Output to mounted /screenshots directory
- Return path to captured screenshot

### Step 7: Create Example Playwright Config

Optimized configuration for Docker execution with sensible defaults for CI and local development.

---

## Usage Examples

### Run All Tests
```bash
./scripts/pw.sh test
```

### Run Specific Test File
```bash
./scripts/pw.sh test tests/home.spec.ts
```

### Capture Screenshot
```bash
./scripts/pw.sh screenshot http://localhost:5173 homepage.png
```

### Capture Full Page Screenshot
```bash
FULL_PAGE=true ./scripts/pw.sh screenshot http://localhost:5173/about about-full.png
```

### Interactive Test Generation
```bash
./scripts/pw.sh codegen http://localhost:5173
```

### Debug Mode (headed browser)
```bash
./scripts/pw.sh debug tests/checkout.spec.ts
```

### Get Shell Access
```bash
./scripts/pw.sh shell
```

---

## Network Access to Localhost

The container uses `network_mode: host` to access services running on the host machine:

| Host Service | Container Access |
|-------------|------------------|
| Frontend (Vite) | `http://localhost:5173` |
| Backend (Express) | `http://localhost:5000` |
| Any other service | `http://localhost:<port>` |

**Note for macOS/Windows**: Docker Desktop requires using `host.docker.internal` instead of `localhost`. The entrypoint script will auto-detect and configure this.

---

## Volume Mounts

| Host Path | Container Path | Purpose |
|-----------|---------------|---------|
| `./tests` | `/tests` | Test files (read-only) |
| `./screenshots` | `/screenshots` | Screenshot output |
| `./playwright-report` | `/reports` | Test reports & traces |
| `./playwright.config.ts` | `/app/playwright.config.ts` | Configuration |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:5173` | Base URL for tests |
| `BROWSER` | `chromium` | Browser to use |
| `HEADLESS` | `true` | Run headless |
| `FULL_PAGE` | `false` | Full page screenshots |
| `VIEWPORT_WIDTH` | `1280` | Viewport width |
| `VIEWPORT_HEIGHT` | `720` | Viewport height |
| `DEVICE` | - | Emulate device (e.g., "iPhone 14") |
| `TIMEOUT` | `30000` | Default timeout (ms) |

---

## Integration with claudetools.io

The container can upload screenshots directly to the canvas:

```bash
# Capture and upload to active session
./scripts/pw.sh screenshot http://localhost:5173 --upload

# This calls the canvas API:
# POST /api/sessions/:sessionId/canvas
# Content-Type: multipart/form-data
# Body: { type: "image", file: <screenshot.png> }
```

---

## CI/CD Integration

### GitHub Actions Example

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Start application
        run: pnpm dev &

      - name: Wait for app
        run: npx wait-on http://localhost:5173

      - name: Run Playwright tests
        run: ./scripts/pw.sh test

      - name: Upload report
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
```

---

## File Manifest

| File | Description |
|------|-------------|
| `docker/playwright/Dockerfile` | Container image definition |
| `docker/playwright/entrypoint.sh` | Multi-mode entrypoint script |
| `docker/playwright/tools/screenshot.js` | Screenshot capture utility |
| `docker/playwright/tools/health-check.js` | Container health check |
| `docker-compose.playwright.yml` | Docker Compose service config |
| `scripts/pw.sh` | CLI wrapper script |
| `playwright.config.docker.ts` | Docker-optimized Playwright config |

---

## Security Considerations

- Container runs as non-root user (playwright default)
- Test files mounted read-only
- No secrets stored in image
- Host network mode limited to development use
- Production deployments should use bridge networking with explicit port mapping

---

## Next Steps After Approval

1. Create the docker/playwright directory structure
2. Write the Dockerfile
3. Create entrypoint.sh with mode handling
4. Build screenshot.js tool
5. Create docker-compose.playwright.yml
6. Write the pw.sh CLI wrapper
7. Add example playwright.config.docker.ts
8. Test all functionality
9. Document in project README

