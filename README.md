<p align="center">
  <img src="packages/web/public/logo.png" alt="Circus Chief" width="200" />
</p>

<h1 align="center">Circus Chief</h1>

<p align="center">
  An open-source, touch-optimized control plane for managing Claude Code agents.<br/><br/>
  Supports Anthropic API, AWS Bedrock, Google Vertex AI, z.ai, or any Anthropic-compatible endpoint.
</p>

---

## Features

### Stay on top of your agents

- **AI-generated session summaries** — scan what every session accomplished without reading the full conversation, with PRs automatically linked (requires GitHub CLI)
- **Kanban board** — organize sessions into workflow stages with drag-and-drop and lane automation
- **Command buttons with live status** — kick off builds, tests, or CI tasks and see pass/fail indicators right on the session list
- **Star, archive, and filter** to keep your session list manageable

### Work from anywhere

- **Touch-first UI** — built for small screens with minimal typing
- **Quick responses** — configure reusable replies and send them with a single tap
- **Command buttons** — run shell commands without touching a keyboard, with live output streaming
- **Slash command wizards** — tap through complex operations step by step with argument forms

### Orchestration

- **Session scheduling** — queue sessions to run at specific times
- **Auto-retry on token exhaustion or provider downtime** — configurable delay, max retries, and proactive rescheduling before hitting limits
- **Kanban lane automation** — trigger templates automatically as sessions move between lanes
- **Ask the agent to orchestrate** — agents can create sessions and place them in kanban lanes via the API, so you can ask one agent to fan out work across files or folders and track it all on the board

### Git-native workflow

- **Worktree isolation** — each session gets its own branch and working directory so agents never step on each other
- **Auto-links sessions to GitHub PRs** with live CI status, merge state, and conflict warnings

### Share context across sessions

- **Visual canvas** — a shared surface for plans, images, code, JSON, and documents that persists across sessions
- **Inline markdown editing** — refine an agent's plan directly on the canvas without leaving the UI
- **Version history** — track how artifacts evolve; nothing gets lost as you iterate

---

## How to Run

```bash
npx circuschief
```

### Options

| Flag | Description |
|------|-------------|
| `-p, --port <number>` | Port to listen on (default: `5000`) |
| `-h, --help` | Show help message |
| `-v, --version` | Show version number |

**Example — run on a custom port:**

```bash
npx circuschief -p 8080
```

---

## Tech Stack

- **Frontend**: Vue.js 3 + Vite + Pinia + Vue Router
- **Backend**: Express.js + WebSocket + SQLite
- **Testing**: Vitest (unit) + Playwright (E2E)
- **Package Manager**: Yarn (workspaces monorepo)

## Prerequisites

- macOS or Linux
- Node.js 20+
- Yarn
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [GitHub CLI](https://cli.github.com/) (optional — enables automatic PR linking)

## Documentation

- [Development Guide](docs/development.md) — Quick start, commands, testing, environment variables
- [Build & Distribution](docs/build-and-distribution.md) — How the npm package is built, published, and run
