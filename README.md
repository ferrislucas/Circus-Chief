<p align="center">
  <img src="packages/web/public/logo.png" alt="Circus Chief" width="200" />
</p>

<h1 align="center">Circus Chief</h1>

<p align="center">
  An open-source, touch-optimized control plane for managing Claude Code agents.<br/>
  It runs on your machine with one goal: empower phones and tablets to build software with Claude Code.
</p>

---

## Why Circus Chief?

### Stay on top of your agents

- **AI-generated session summaries** — scan what every session accomplished without reading the full conversation
- **Kanban board** — organize sessions into workflow stages with drag-and-drop and lane automation
- **Command buttons with live status** — kick off builds, tests, or CI tasks and see pass/fail indicators right on the session list
- **Star, archive, and filter** to keep your session list manageable

### Work from anywhere

- **Touch-first UI** — built for small screens with minimal typing
- **Quick responses** — configure reusable replies and send them with a single tap
- **Command buttons** — run shell commands without touching a keyboard, with live output streaming
- **Slash command wizards** — tap through complex operations step by step with argument forms

### Spend less on tokens

- **Bring your own provider** — Anthropic API, AWS Bedrock, Google Vertex AI, or any Anthropic-compatible endpoint
- **Session scheduling** — queue sessions to run at specific times
- **Auto-retry on token exhaustion or provider downtime** — configurable delay, max retries, and proactive rescheduling before hitting limits

### Git-native workflow

- **Worktree isolation** — each session gets its own branch and working directory so agents never step on each other
- **Auto-links sessions to GitHub PRs** with live CI status, merge state, and conflict warnings

### Share context across sessions

- **Visual canvas** — a shared surface for plans, images, code, JSON, and documents that persists across sessions
- **Inline markdown editing** — refine an agent's plan directly on the canvas without leaving the UI
- **Version history** — track how artifacts evolve; nothing gets lost as you iterate

---

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
yarn workspace @circuschief/server dev      # Development with auto-reload
yarn workspace @circuschief/server start    # Production
yarn workspace @circuschief/server test     # Unit tests

# Web only
yarn workspace @circuschief/web dev         # Vite dev server
yarn workspace @circuschief/web build       # Production build
yarn workspace @circuschief/web preview     # Preview production build
yarn workspace @circuschief/web test        # Unit tests
```

## Testing

### Unit Tests

```bash
yarn test                                    # All unit tests
yarn workspace @circuschief/server test      # Server tests only
yarn workspace @circuschief/web test         # Web tests only
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
| `DB_PATH` | `circuschief.db` | SQLite database path |

### Web (Vite) — Build-Time Only

These variables are resolved during `yarn build` (specifically `vite build`). They are string-replaced into the compiled JS bundle and **cannot be changed at runtime**. End users running `npx circuschief` get whatever values were set when the package was built.

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

Circus Chief is distributed as an npm package. End users run it via `npx circuschief` — no build step required on their machine.

The build/publish/run flow:

1. **Build** (`yarn build`): Vite compiles the Vue.js frontend into static assets (`packages/web/dist/`). Server-side code requires no compilation.
2. **Publish** (`npm publish`): The package ships with the pre-built frontend included.
3. **Run** (`npx circuschief`): The Express server starts and serves the pre-built frontend as static files.

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
NODE_ENV=production yarn workspace @circuschief/server start
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
