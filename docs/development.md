# Development Guide

## Tech Stack

- **Frontend**: Vue.js 3 + Vite + Pinia + Vue Router
- **Backend**: Express.js + WebSocket + SQLite
- **Testing**: Vitest (unit) + Playwright (E2E)
- **Package Manager**: Yarn (workspaces monorepo)

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

### Database Utilities

These commands operate on the active SQLite database. By default that is
`~/.circuschief/circuschief.db`; set `DB_PATH=/path/to/db.sqlite` to target a
specific database.

```bash
yarn workspace @circuschief/server db:backup
yarn workspace @circuschief/server db:inspect-schema
yarn workspace @circuschief/server db:inspect-schema -- --fresh
yarn workspace @circuschief/server db:validate-baseline
```

| Command | Description |
|---------|-------------|
| `db:backup` | Copies the active database plus any SQLite `-wal`/`-shm` sidecar files into `~/.circuschief/backups` with a timestamped `.bak` suffix. |
| `db:inspect-schema` | Prints tables, indexes, foreign keys, and selected `PRAGMA` output for the active database. |
| `db:inspect-schema -- --fresh` | Prints the same schema details for a temporary database initialized from the current baseline schema and seed data. |
| `db:validate-baseline` | Compares the active database against a fresh baseline and fails if required tables, columns, indexes, or built-in provider seed rows drift. |

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
| `DB_PATH` | `~/.circuschief/circuschief.db` | SQLite database path. `./scripts/pw.sh test`/`debug` overrides this to a worktree-local `$PROJECT_ROOT/.circuschief-test.db` so E2E tests never touch the real user DB; `pw.sh test-package` lets `start-package-server.sh` pick a per-run mktemp path instead. See [E2E testing — DB isolation](./e2e-testing.md#db-isolation-and-server-info). |
| `VCR_MODE` | *(unset)* | When set (e.g. `replay`, `record`, `auto`), disables the scheduler service at server boot so E2E test servers never pick up real scheduled sessions. See [E2E testing — VCR modes](./e2e-testing.md#vcr-modes). |

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

## Agent System Prompt & REST API

The system prompt injected into every agent session includes documentation for a REST API that agents can use to create sessions, manage the canvas, and interact with project resources. For a full reference, see [Agent System Prompt & REST API Reference](./agent-system-prompt.md).

## Project Structure

```
├── packages/
│   ├── server/          # Express backend
│   │   └── src/
│   │       └── agents/  # Agent adapters (Claude Code, Codex, Gemini)
│   ├── web/             # Vue.js frontend
│   └── shared/          # Shared types and constants
├── tests/
│   └── e2e/             # Playwright E2E tests
└── scripts/
    └── pw.sh            # Playwright CLI wrapper
```

## Supported Agent Types

Circus Chief supports multiple agent backends through an adapter pattern:

| Agent Type | Adapter | Required Dependency | Provider Kind |
|------------|---------|---------------------|---------------|
| Claude Code | `ClaudeCodeAdapter` | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `anthropic` |
| OpenAI Codex | `CodexAdapter` | [Codex CLI](https://github.com/openai/codex) | `openai` |
| Google Gemini | `GeminiAdapter` | [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`npm install -g @google/gemini-cli`) | `google` |

Each agent type is registered in `packages/server/src/agents/AgentGateway.js` and implements the `BaseAgent` interface. Providers are configured per-project and can be Anthropic-compatible endpoints, OpenAI-compatible endpoints, or Google (Gemini CLI).

### Codex Agent Details

The Codex adapter (`packages/server/src/agents/adapters/CodexAdapter.js`) supports two execution paths:

1. **CLI path (default)** — spawns `codex exec --json --skip-git-repo-check`, maps Codex JSONL events into the shared agent event shape, and applies session mode via the Codex `--sandbox` flag (`plan` → `read-only`, `standard` → `workspace-write`, `yolo` → `danger-full-access`).
2. **Direct API path (fallback)** — activated via `USE_CODEX_DIRECT_API=1` or after the CLI is unavailable, streams Chat Completions through the OpenAI SDK, and requires `OPENAI_API_KEY`.

The CLI path also passes configured reasoning effort and commit attribution to Codex. When no `OPENAI_API_KEY` is present in the session environment, it forces `preferred_auth_method=chatgpt` so the CLI uses its own ChatGPT login instead of an accidental API-key path. The direct API fallback does not run the Codex CLI, so CLI-specific behavior such as sandbox enforcement and commit attribution config is not applied there.

| Capability | Supported |
|------------|-----------|
| Streaming | ✅ |
| Reasoning effort | ✅ |
| Tool use | ✅ |
| Thinking | ❌ |
| Resume | ❌ |

Supported OpenAI models: GPT-5.5 (default), GPT-5.4, GPT-5.4 mini, GPT-5.3-Codex.

### Gemini Agent Details

The Gemini adapter (`packages/server/src/agents/adapters/GeminiAdapter.js`) runs the `gemini` CLI in headless mode using `--output-format stream-json`, which emits newline-delimited JSON events that map onto the shared agent event protocol. The prompt is passed via the `-p` CLI argument (not stdin). System prompts are prepended to the user prompt using the shared `composeCliPrompt` utility (`packages/server/src/agents/adapters/cliUtils.js`).

Event mapping is handled by `geminiEventMapper.js`, which translates Gemini CLI `stream-json` events (`init`, `message`, `tool_use`, `tool_result`, `result`) into the internal SDK-shaped event format. Because the Gemini CLI does not support session continuation, `needsConversationContext()` returns `true`, meaning conversation history is injected into the prompt on follow-up turns.

Authentication is configured via `GEMINI_API_KEY`. Additional Google Cloud variables (`GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_GENAI_USE_VERTEXAI`) can be passed through `provider.additionalEnvVars`. Three-way env isolation ensures Anthropic and OpenAI credentials are stripped from Gemini sessions, and Gemini credentials are stripped from Anthropic/OpenAI sessions.

| Capability | Supported |
|------------|-----------|
| Streaming | ✅ |
| Tool use | ✅ |
| Reasoning effort | ❌ |
| Thinking | ❌ |
| Resume | ❌ |

Supported Google models: Gemini 2.5 Pro, Gemini 2.5 Flash (default), Gemini 2.5 Flash Lite.
