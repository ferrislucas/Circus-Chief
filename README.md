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

### Web (Vite)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `http://localhost:5000` | Backend API URL |

### E2E Tests

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:5000` | Frontend URL |
| `API_URL` | `http://localhost:5000` | Backend URL |
| `BROWSER` | `chromium` | Browser to use |
| `HEADLESS` | `true` | Run headless |

## Production Deployment

```bash
# Install dependencies
yarn install --frozen-lockfile

# Build
yarn build

# Start server (serves frontend static files)
NODE_ENV=production yarn workspace @claudetools/server start
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

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture and design
- [DATA_MODEL.md](./DATA_MODEL.md) - Database schema and data model
