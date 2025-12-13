# ClaudeTools.io Implementation Plan

This document consolidates the implementation plan from [GitHub Issue #50](https://github.com/ferrislucas/claudetools.io/issues/50) and its comments into an actionable handoff document.

## Overview

ClaudeTools.io is a web application for managing Claude Code sessions with features including:
- Project management with git integration
- Multi-turn conversation sessions with Claude
- Real-time updates via WebSocket
- Visual canvas for images, markdown, and JSON data
- Session notes and tool templates

## Architecture Summary

- **Frontend**: Vue 3 + Pinia + Vite
- **Backend**: Express + SQLite (better-sqlite3)
- **Real-time**: WebSocket (ws)
- **Testing**: Vitest (unit) + Playwright via Docker (E2E)
- **Monorepo**: Yarn workspaces

## Key Decisions Made

| Question | Decision |
|----------|----------|
| Mock Claude Agent SDK? | **Yes** - Mock SDK for tests with simulated responses and streaming |
| Visual regression testing? | **No** - Skip for now, focus on functional E2E tests |
| Contract testing for API? | **Yes** - Use Zod schemas in `packages/shared/src/contracts/` |
| Load testing for WebSocket? | **No** - Skip for now, focus on functional correctness |

---

## Phase 1: Project Scaffolding

### Directory Structure

```
claudetools.io/
├── package.json              # Workspace root
├── yarn.lock
├── .gitignore
├── .prettierrc
├── .eslintrc.cjs
├── docker-compose.playwright.yml
├── playwright.config.docker.ts
├── scripts/
│   └── pw.sh                 # Playwright CLI wrapper
├── tests/                    # Playwright E2E tests
│   └── e2e/
│       ├── projects.spec.ts
│       ├── sessions.spec.ts
│       └── canvas.spec.ts
└── packages/
    ├── shared/               # Shared types and contracts
    │   ├── package.json
    │   └── src/
    │       ├── index.js
    │       ├── types.js      # JSDoc type definitions
    │       ├── protocol.js   # WebSocket message types
    │       ├── constants.js
    │       └── contracts/    # Zod schemas for contract testing
    │           ├── projects.js
    │           ├── sessions.js
    │           └── canvas.js
    ├── server/
    │   ├── package.json
    │   ├── vitest.config.js
    │   ├── bin/
    │   │   └── cli.js        # npx claudetools entry point
    │   ├── src/
    │   │   ├── index.js      # Server entry
    │   │   ├── app.js        # Express app factory
    │   │   ├── websocket.js  # WS server
    │   │   ├── database.js   # SQLite connection
    │   │   ├── schema.sql    # Database schema
    │   │   ├── api/
    │   │   │   ├── index.js
    │   │   │   ├── projects.js
    │   │   │   ├── sessions.js
    │   │   │   ├── canvas.js
    │   │   │   └── git.js
    │   │   └── services/
    │   │       ├── projectManager.js
    │   │       ├── sessionManager.js
    │   │       ├── canvasStore.js
    │   │       ├── gitService.js
    │   │       └── diffService.js
    │   └── test/
    │       ├── setup.js      # Test setup (in-memory DB)
    │       └── mocks/
    │           └── claudeSDK.js
    └── web/
        ├── package.json
        ├── vitest.config.js
        ├── vite.config.js
        ├── index.html
        └── src/
            ├── main.js
            ├── App.vue
            ├── router.js
            ├── stores/
            ├── composables/
            ├── views/
            ├── components/
            └── assets/
```

### Tasks

1. Initialize monorepo with Yarn workspaces
2. Create root `package.json` with workspace scripts:
   ```json
   {
     "name": "claudetools-monorepo",
     "private": true,
     "workspaces": ["packages/*"],
     "scripts": {
       "dev": "concurrently -n server,web -c blue,green \"yarn workspace @claudetools/server dev\" \"yarn workspace @claudetools/web dev\"",
       "build": "yarn workspace @claudetools/web build && yarn workspace @claudetools/server build",
       "test": "yarn workspaces foreach run test",
       "test:e2e": "./scripts/pw.sh test",
       "lint": "eslint packages/*/src"
     }
   }
   ```
3. Set up ESLint and Prettier configs
4. Create Playwright Docker configuration
5. Create `scripts/pw.sh` wrapper for Playwright CLI

### Dev Server Startup

- Server runs on port 5000 with `node --watch src/index.js`
- Web runs on port 5173 via Vite dev server
- Vite proxies `/api` and `/ws` to server

---

## Phase 2: Database Layer

### SQLite Schema

```sql
-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  working_directory TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'starting' CHECK (status IN ('starting', 'running', 'waiting', 'completed', 'error')),
  mode TEXT NOT NULL DEFAULT 'standard' CHECK (mode IN ('plan', 'standard', 'yolo')),
  git_branch TEXT,
  git_worktree TEXT,
  pr_url TEXT,
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Conversation messages
CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  tool_use TEXT, -- JSON array of tool uses
  timestamp INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Canvas items
CREATE TABLE IF NOT EXISTS canvas_items (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('image', 'markdown', 'text', 'json')),
  content TEXT,           -- For markdown/text
  data TEXT,              -- For json (stored as JSON string) or image (base64)
  mime_type TEXT,         -- For images
  filename TEXT,
  label TEXT,
  width INTEGER,
  height INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Session notes
CREATE TABLE IF NOT EXISTS session_notes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Global tool templates
CREATE TABLE IF NOT EXISTS global_tool_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_type TEXT NOT NULL DEFAULT 'command' CHECK (payload_type = 'command'),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Project tool templates
CREATE TABLE IF NOT EXISTS project_tool_templates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_type TEXT NOT NULL CHECK (payload_type IN ('command', 'prompt')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_messages_session ON conversation_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_canvas_session ON canvas_items(session_id);
CREATE INDEX IF NOT EXISTS idx_notes_session ON session_notes(session_id);
CREATE INDEX IF NOT EXISTS idx_project_tools ON project_tool_templates(project_id);
```

### Tasks

1. Create `database.js` with:
   - `initDatabase(dbPath)` - Initialize with WAL mode and foreign keys
   - `getDatabase()` - Get database instance
   - `generateId()` - Use `crypto.randomUUID()`
   - `transaction(fn)` - Transaction helper
2. Implement CRUD operations for each table (projects, sessions, etc.)
3. Create test setup with in-memory database (`':memory:'`)

---

## Phase 3: Server Core

### Express Middleware Chain

1. CORS (allow all in dev)
2. Body parsing (JSON with 50MB limit for base64 images)
3. Request logging (dev only)
4. API routes (`/api`)
5. Static files (production)
6. SPA fallback
7. Error handler

### WebSocket Server

- Path: `/ws`
- Track connected clients in a `Set`
- Track session subscriptions: `sessionId -> Set<WebSocket>`
- Handle messages:
  - `subscribe:session` - Add client to session subscribers
  - `unsubscribe:session` - Remove client from session subscribers
- Exports:
  - `broadcast(message)` - Send to all clients
  - `broadcastToSession(sessionId, message)` - Send to session subscribers

### Error Response Format

```json
{
  "error": "Human-readable error message"
}
```

HTTP status codes: 400 (validation), 404 (not found), 500 (server error)

### Tasks

1. Create `app.js` with Express app factory
2. Create `websocket.js` with WS server setup
3. Create API router structure (`api/index.js`)
4. Implement project endpoints (`api/projects.js`):
   - `GET /api/projects` - List all projects
   - `POST /api/projects` - Create project
   - `GET /api/projects/:id` - Get project
   - `PUT /api/projects/:id` - Update project
   - `DELETE /api/projects/:id` - Delete project
5. Create server entry point (`index.js`)

---

## Phase 4: Session Manager

### Session State Machine

```
[starting] --> [running] --> [waiting] --> [running] --> [completed]
                   |                                         ^
                   |                                         |
                   +-----------------------------------------+
                   |
                   v (on error)
               [error]
```

### How Sessions Work

1. **User creates session** via `POST /api/projects/:projectId/sessions`
2. **Server creates session record** with status `starting`
3. **SessionManager.runSession()** is called (non-blocking)
4. **Claude SDK query starts** with async generator for multi-turn input
5. **Stream events are processed** and broadcast via WebSocket
6. **Session waits for follow-up** messages (status: `waiting`)
7. **Session completes** or errors

### Session API

- `POST /api/projects/:projectId/sessions` - Create and start session
- `GET /api/projects/:projectId/sessions` - List project sessions
- `GET /api/sessions/:id` - Get session details
- `POST /api/sessions/:id/message` - Send follow-up message
- `POST /api/sessions/:id/stop` - Stop running session

### Tasks

1. Create `services/sessionManager.js` with:
   - `runSession(sessionId, prompt, workingDirectory)`
   - `sendMessage(sessionId, content)`
   - `stopSession(sessionId)`
2. Implement async generator for multi-turn input
3. Handle Claude SDK stream events
4. Broadcast status and message updates via WebSocket
5. Create `api/sessions.js` with endpoints

---

## Phase 5: Canvas Service

### How Claude Adds Items to Canvas

Claude has environment variables:
- `CLAUDETOOLS_SESSION_ID` - Current session ID
- `CLAUDETOOLS_API_URL` - API base URL

Claude adds items via curl:
```bash
# Add image
curl -X POST "${CLAUDETOOLS_API_URL}/api/sessions/${CLAUDETOOLS_SESSION_ID}/canvas" \
  -F "file=@/path/to/screenshot.png" \
  -F "label=Test failure screenshot"

# Add markdown
curl -X POST "${CLAUDETOOLS_API_URL}/api/sessions/${CLAUDETOOLS_SESSION_ID}/canvas" \
  -H "Content-Type: application/json" \
  -d '{"type":"markdown","content":"# Results\n\nTests passed!","label":"Test Results"}'
```

### Canvas API

- `POST /api/sessions/:sessionId/canvas` - Add item (multipart or JSON)
- `GET /api/sessions/:sessionId/canvas` - List items
- `DELETE /api/sessions/:sessionId/canvas/:itemId` - Delete item

### Request/Response Flow (Image Upload)

1. Multer parses multipart data
2. Read file buffer
3. Detect MIME type
4. Convert to base64
5. Store in database
6. Broadcast `canvas:add` via WebSocket
7. Return created item

### Tasks

1. Create `services/canvasStore.js`
2. Create `api/canvas.js` with multer for file uploads
3. Implement base64 encoding for images
4. Broadcast canvas updates via WebSocket

---

## Phase 6: Git Service

### Git Commands

| Operation | Command |
|-----------|---------|
| Check if git repo | `git rev-parse --git-dir` |
| List worktrees | `git worktree list --porcelain` |
| List branches | `git branch -a --format="%(refname:short)\|%(refname)"` |
| Current branch | `git branch --show-current` |
| Create worktree | `git worktree add <path> -b <branch>` |
| Remove worktree | `git worktree remove <path>` |

### Git API

- `GET /api/projects/:id/git/status` - Check if git repo, get branches
- `GET /api/projects/:id/git/worktrees` - List worktrees
- `POST /api/projects/:id/git/worktrees` - Create worktree
- `DELETE /api/projects/:id/git/worktrees/:path` - Remove worktree

### Tasks

1. Create `services/gitService.js` with:
   - `isGitRepo(directory)`
   - `getWorktrees(directory)`
   - `getBranches(directory)`
   - `createWorktree(directory, branch, path)`
   - `removeWorktree(directory, path)`
2. Create `api/git.js` with endpoints

---

## Phase 7: Vue Frontend Core

### WebSocket Reconnection Strategy

- Base delay: 2 seconds
- Exponential backoff: 2s, 4s, 8s, 16s, 30s (max)
- Reset on successful connection
- Don't reconnect on clean close (code 1000)

### Pinia Stores

| Store | Purpose |
|-------|---------|
| `projectsStore` | Project CRUD, current project |
| `sessionsStore` | Session list, current session, messages |
| `canvasStore` | Canvas items for current session |
| `uiStore` | Toasts, modals, loading states |

### Composables

- `useWebSocket()` - WebSocket connection with reconnection
- `useApi()` - HTTP client wrapper
- `useKeyboardShortcuts()` - Global keyboard shortcuts

### Tasks

1. Create `composables/useWebSocket.js` with reconnection logic
2. Create `composables/useApi.js` for HTTP requests
3. Create Pinia stores (projects, sessions, canvas, ui)
4. Set up Vue Router with routes
5. Create base layout and navigation components

---

## Phase 8: Frontend Views

### Views to Implement

| View | Route | Purpose |
|------|-------|---------|
| ProjectListView | `/` | List all projects |
| ProjectNewView | `/projects/new` | Create new project |
| ProjectEditView | `/projects/:id/edit` | Edit project |
| SessionListView | `/projects/:id/sessions` | List project sessions |
| NewSessionView | `/projects/:id/sessions/new` | Create new session |
| SessionDetailView | `/sessions/:id/:tab?` | Session detail with tabs |

### Session Detail Tabs

1. **Conversation** - Messages and input
2. **Changes** - Git diff viewer
3. **Canvas** - Image/markdown/JSON items
4. **Tools** - Tool templates
5. **Notes** - Session notes

### Loading States

| View | Loading UI |
|------|------------|
| ProjectListView | Skeleton cards (2-3) |
| ProjectEditView | Full-page spinner |
| SessionListView | Skeleton cards |
| NewSessionView | Spinner in git section |
| SessionDetailView | Full-page spinner |

### Tasks

1. Create view components for each route
2. Create tab components for session detail
3. Implement data fetching in `onMounted()` or router guards
4. Add loading and error states
5. Wire up WebSocket subscriptions for real-time updates

---

## Phase 9: E2E Tests

### Test Infrastructure

- Run Playwright via Docker (`docker-compose.playwright.yml`)
- Use `pw.sh` wrapper script for CLI
- Fresh database per test run

### Test Data Seeding

```typescript
export async function seedProject(name: string, workingDirectory: string);
export async function seedSession(projectId: string, data: {...});
export async function seedCanvasItem(sessionId: string, data: {...});
export async function cleanupAll();
```

### WebSocket Testing Helpers

```typescript
export async function waitForWebSocketMessage(page, messageType, timeout);
export async function waitForSessionStatus(page, sessionId, status);
```

### Test Files

- `tests/e2e/projects.spec.ts` - Project CRUD
- `tests/e2e/sessions.spec.ts` - Session lifecycle
- `tests/e2e/canvas.spec.ts` - Canvas real-time updates

### Tasks

1. Set up Playwright Docker configuration
2. Create test data seeding utilities
3. Create WebSocket testing helpers
4. Write project management tests
5. Write session lifecycle tests
6. Write canvas real-time tests

---

## Phase 10: Polish

### Toast Notification System

- Types: info, success, warning, error
- Auto-dismiss after duration (default 5s)
- Manual dismiss button
- Stack in top-right corner

### Error Boundaries

- Use Vue's `onErrorCaptured` hook
- Show error page for fatal errors (ChunkLoadError)
- Show toast for recoverable errors

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Escape` | Close modal / blur input |
| `Cmd/Ctrl + K` | Open command palette |
| `Cmd/Ctrl + N` | New project |
| `Cmd/Ctrl + 1-5` | Switch session tabs |

### Tasks

1. Create toast notification system in `uiStore`
2. Create `ToastContainer.vue` component
3. Implement error boundary in `App.vue`
4. Create `useKeyboardShortcuts()` composable
5. Add command palette (optional)
6. Add responsive design adjustments

---

## Contract Testing

### Zod Schemas Location

`packages/shared/src/contracts/`

### Example Schemas

```javascript
// sessions.js
export const CreateSessionRequest = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().min(1),
  name: z.string().optional(),
  mode: z.enum(['plan', 'standard', 'yolo']).optional(),
  gitBranch: z.string().optional(),
});

export const SessionResponse = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  status: z.enum(['starting', 'running', 'waiting', 'completed', 'error']),
  // ...
});
```

### Usage

- Server tests validate responses match schemas
- Frontend tests validate requests match schemas

---

## Claude SDK Mocking

```javascript
// packages/server/test/mocks/claudeSDK.js
export const mockQuery = vi.fn().mockImplementation(async function* (options) {
  // Simulate assistant response
  yield {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: 'I will help you with that.' }]
    }
  };

  // Simulate completion
  yield { type: 'result', subtype: 'success' };
});

// Usage in tests
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery
}));
```

---

## Implementation Order

1. **Phase 1**: Project scaffolding and monorepo setup
2. **Phase 2**: Database layer with SQLite
3. **Phase 3**: Server core (Express + WebSocket)
4. **Phase 4**: Session manager with Claude SDK integration
5. **Phase 5**: Canvas service
6. **Phase 6**: Git service
7. **Phase 7**: Vue frontend core (stores, WebSocket, router)
8. **Phase 8**: Frontend views and components
9. **Phase 9**: E2E tests with Playwright
10. **Phase 10**: Polish (toasts, errors, keyboard shortcuts)

---

## Notes for Implementer

- Use `crypto.randomUUID()` for all ID generation
- All timestamps are stored as Unix milliseconds (INTEGER)
- WebSocket messages are JSON with a `type` field
- Session environment variables allow Claude to interact with canvas
- Test with in-memory SQLite (`:memory:`) for fast test isolation
- Vite proxy handles API/WS routing in development
