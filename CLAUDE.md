# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

claudetools.io is a local-first web application for managing Claude Code sessions with a visual canvas for artifacts. It allows users to view/manage sessions, share a visual canvas (images, documents, data), and interact with active Claude Code sessions from a web browser.

## Common Commands

```bash
# Development - start both frontend and backend
yarn dev

# Run all unit tests
yarn test

# Run tests for a specific package
yarn workspace @claudetools/server test
yarn workspace @claudetools/web test

# Run a single test file (vitest)
yarn workspace @claudetools/server test src/db/SessionRepository.test.js
yarn workspace @claudetools/web test src/stores/ui.test.js

# E2E tests with Playwright
./scripts/pw.sh test                           # Run all E2E tests
./scripts/pw.sh test --grep="login"            # Filter by test name
./scripts/pw.sh debug tests/e2e/auth.spec.ts   # Debug mode (headed)

# Linting
yarn lint

# Build for production
yarn build
```

## Architecture

### Monorepo Structure (Yarn Workspaces)

- **packages/server** - Express backend with WebSocket support
- **packages/web** - Vue.js 3 frontend (Vite, Pinia, Vue Router)
- **packages/shared** - Shared types, constants, and Zod contracts

### Server Package (`@claudetools/server`)

- `src/index.js` - Entry point, starts HTTP server
- `src/app.js` - Express app configuration
- `src/websocket.js` - WebSocket server setup
- `src/api/` - REST API routes (projects, sessions, canvas, git)
- `src/db/` - SQLite repositories using better-sqlite3
  - `BaseRepository.js` - Abstract base with CRUD operations
  - Repository pattern: `ProjectRepository`, `SessionRepository`, `MessageRepository`, `CanvasItemRepository`, `SessionNoteRepository`
- `src/services/` - Business logic (sessionManager, canvasStore, gitService, diffService)
- `src/ws/` - WebSocket manager for real-time updates

### Web Package (`@claudetools/web`)

- `src/router.js` - Vue Router configuration
- `src/views/` - Page components (ProjectListView, SessionListView, SessionDetailView, etc.)
- `src/components/` - Reusable components (CanvasTab, ConversationTab, NotesTab, ChangesTab, ToastContainer)
- `src/stores/` - Pinia stores (projects, sessions, canvas, ui)

### Shared Package (`@claudetools/shared`)

- `src/types.js` - JSDoc type definitions
- `src/protocol.js` - WebSocket message type definitions
- `src/constants.js` - Shared constants and enums
- `src/contracts/` - Zod validation schemas for API contracts

### Communication Pattern

- **HTTP REST API** - CRUD operations, initial state fetching
- **WebSocket** - Real-time streaming (conversation updates, session status changes, new canvas items)

### Database

SQLite database with these main tables:
- `projects` - Project definitions with working directories
- `sessions` - Claude Code sessions (status: starting/running/waiting/completed/error)
- `conversation_messages` - Chat history per session
- `canvas_items` - Images, markdown, text, JSON artifacts
- `session_notes` - User notes per session
- `global_tool_templates` / `project_tool_templates` - Reusable tool configurations

## Styling

Dark mode only using Tailwind CSS. Key colors:
- Background: `bg-gray-900` (primary), `bg-gray-800` (cards)
- Text: `text-gray-100` (primary), `text-gray-400` (secondary)
- Accent: `text-cyan-400` (links), `text-emerald-400` (success), `text-amber-400` (warning), `text-red-400` (error)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Server port |
| `DB_PATH` | `claudetools.db` | SQLite database path |
| `VITE_API_URL` | `http://localhost:5000` | Backend API URL (frontend) |

## Working Directory Guidelines

**CRITICAL: Never use `cd` to change to a hardcoded project path before running commands.**

When running in a claudetools.io session, your working directory is already set correctly. This may be:
- The main project directory
- A git worktree for branch isolation

### Do NOT do this:
```bash
# BAD - bypasses worktree isolation
cd /home/ubuntu/workspace/claudetools.io && git status
cd /home/ubuntu/workspace/claudetools.io && yarn test
```

### Do this instead:
```bash
# GOOD - respects the session's working directory
git status
yarn test
```

### Why this matters:
- Sessions may run in git worktrees for branch isolation
- Using `cd` to hardcoded paths escapes the worktree context
- This causes git operations to affect the wrong repository
- Commands should use relative paths or run without `cd`

### If you need to reference files:
- Use relative paths: `packages/server/src/...`
- Use `pwd` to check your current directory if unsure
- Never assume the working directory is the main repo
