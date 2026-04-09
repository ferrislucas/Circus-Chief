# claudetools.io

A local-first web platform for managing Claude Code sessions with a visual canvas for artifacts.

## Tech Stack

- **Frontend**: Vue.js 3 + Vite + Pinia + Vue Router
- **Backend**: Express.js + WebSocket + SQLite
- **Testing**: Vitest (unit) + Playwright (E2E)
- **Package Manager**: Yarn (workspaces monorepo)

## Prerequisites

- Node.js 20+
- Yarn
- Docker (for E2E testing)

## Quick Start

```bash
# Install dependencies
yarn install

# Start development servers (frontend + backend)
yarn dev
```

This starts:
- **Frontend**: http://localhost:5000
- **Backend API**: http://localhost:5000
- **WebSocket**: ws://localhost:5000/ws

## Available Commands

### Development

| Command | Description |
|---------|-------------|
| `yarn dev` | Start both frontend and backend dev servers |
| `yarn build` | Build for production |
| `yarn lint` | Run ESLint |
| `yarn test` | Run unit tests |
| `yarn test:e2e` | Run E2E tests with Playwright |

### Individual Packages

```bash
# Server only
yarn workspace @claudetools/server dev      # Development with auto-reload
yarn workspace @claudetools/server start    # Production
yarn workspace @claudetools/server test     # Unit tests

# Web only
yarn workspace @claudetools/web dev         # Vite dev server
yarn workspace @claudetools/web build       # Production build
yarn workspace @claudetools/web preview     # Preview production build
yarn workspace @claudetools/web test        # Unit tests
```

## Testing

### Unit Tests

```bash
yarn test                                    # All unit tests
yarn workspace @claudetools/server test      # Server tests only
yarn workspace @claudetools/web test         # Web tests only
```

### E2E Tests (Playwright)

```bash
./scripts/pw.sh test                         # Run all E2E tests
./scripts/pw.sh test --grep="login"          # Filter by test name
./scripts/pw.sh test --project=chromium      # Specific browser
./scripts/pw.sh debug tests/e2e/auth.spec.ts # Debug mode (headed)
./scripts/pw.sh codegen                      # Interactive test generator
./scripts/pw.sh help                         # Show all options
```

## Environment Variables

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Server port |
| `NODE_ENV` | `development` | Environment mode |
| `DB_PATH` | `claudetools.db` | SQLite database path |

### Web (Vite) — Build-Time Only

These variables are resolved during `yarn build` (specifically `vite build`). They are string-replaced into the compiled JS bundle and **cannot be changed at runtime**. End users running `npx claudetools` get whatever values were set when the package was built.

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `http://localhost:5000` | Backend API URL |
| `VITE_POSTHOG_KEY` | *(empty)* | PostHog project API key. Public client key, not a secret. Analytics disabled when empty. |
| `VITE_POSTHOG_HOST` | `https://us.i.posthog.com` | PostHog ingest host (`us.i.posthog.com` or `eu.i.posthog.com`) |

### E2E Tests

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:5000` | Frontend URL |
| `API_URL` | `http://localhost:5000` | Backend URL |
| `BROWSER` | `chromium` | Browser to use |
| `HEADLESS` | `true` | Run headless |

## Analytics

This application uses [PostHog](https://posthog.com) for anonymous usage analytics (page views, clicks). **Session recording is disabled.**

- Analytics are configured at build time via `VITE_POSTHOG_KEY` in `.env.production`
- When the key is empty (local dev, CI, contributor forks), analytics are completely disabled — no PostHog code loads, no network requests are made
- The PostHog client API key is a public key (like a Google Analytics tracking ID), not a secret
- Browser Do Not Track (`respect_dnt: true`) is honored

## Build & Distribution

### How it works

claudetools is distributed as an npm package. End users run it via `npx claudetools` — no build step required on their machine.

The build/publish/run flow:

1. **Build** (`yarn build`): Vite compiles the Vue.js frontend into static assets (`packages/web/dist/`). Server-side code requires no compilation.
2. **Publish** (`npm publish`): The package ships with the pre-built frontend included.
3. **Run** (`npx claudetools`): The Express server starts and serves the pre-built frontend as static files.

### Build-time vs runtime variables

Because the frontend is pre-compiled, there are two categories of environment variables:

| Category | When resolved | Who controls it | Examples |
|----------|---------------|-----------------|----------|
| **Build-time** (`VITE_*`) | During `yarn build` — Vite string-replaces them into the JS bundle | Publisher / CI | `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST` |
| **Runtime** (`process.env`) | When the server starts | End user | `PORT`, `DB_PATH`, `NODE_ENV` |

End users **cannot** configure `VITE_*` variables — they are baked into the JS bundle before the package is published. This is intentional for variables like analytics keys, which are the publisher's concern, not the user's.

### Building for production

```bash
# Install dependencies
yarn install --frozen-lockfile

# Build (set VITE_* vars for the frontend bundle)
yarn build

# Start server (serves frontend static files)
NODE_ENV=production yarn workspace @claudetools/server start
```

### Publishing to npm

```bash
# Build with analytics enabled
yarn build

# Verify the PostHog key is in the bundle (optional)
grep -l phc_ packages/web/dist/assets/*.js

# Publish
npm publish
```

## Project Structure

```
├── packages/
│   ├── server/          # Express backend
│   ├── web/             # Vue.js frontend
│   └── shared/          # Shared types and constants
├── tests/
│   └── e2e/             # Playwright E2E tests
├── docker/
│   └── playwright/      # Playwright container
└── scripts/
    └── pw.sh            # Playwright CLI wrapper
```

