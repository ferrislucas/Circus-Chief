# claudetools.io - Architecture Specification

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Solution Overview](#solution-overview)
4. [Architecture](#architecture)
5. [Technology Stack](#technology-stack)
6. [Project Structure](#project-structure)
7. [Implementation Phases](#implementation-phases)
8. [API Specification](#api-specification)
9. [WebSocket Protocol](#websocket-protocol)
10. [Data Models](#data-models)
11. [Frontend Specification](#frontend-specification)
12. [Claude Agent SDK Integration](#claude-agent-sdk-integration)
13. [Git Integration](#git-integration)
14. [Slash Commands](#slash-commands)
15. [Security Considerations](#security-considerations)
16. [Future Scaling](#future-scaling)

---

## Executive Summary

claudetools.io is a local-first web application that provides a visual interface for managing Claude Code sessions. It allows users to:

1. **View and manage Claude Code sessions** - Start, monitor, and interact with multiple Claude Code sessions from a web browser
2. **Share a visual "toolbox" canvas** - Claude Code can place images, documents, and other artifacts in a shared space that users can view in real-time
3. **Interact with active sessions** - Send messages to Claude Code sessions that are waiting for user input

The application runs entirely on the user's local machine, with no external infrastructure required. The web browser connects to a local server that manages Claude Code sessions via the Claude Agent SDK.

---

## Problem Statement

### Current Limitations

When using Claude Code in a terminal:

1. **No visual artifact sharing** - If Claude Code generates screenshots (e.g., from Playwright tests), runs data visualizations, or creates diagrams, users cannot easily view them without manually navigating to file paths
2. **Single session visibility** - Users can only interact with one Claude Code session at a time in a terminal
3. **No persistent conversation view** - Terminal scrollback is limited and conversations are hard to review
4. **Text-only interface** - The terminal cannot render images, formatted markdown, or rich content

### Use Cases This Solves

**Use Case 1: Playwright Test Debugging**
> Claude Code runs Playwright tests. Several tests fail. Claude Code captures screenshots of the failures and puts them in the toolbox. The user immediately sees the screenshots in their browser without leaving their workflow.

**Use Case 2: Collaborative Document Editing**
> Claude Code is iterating on a project plan with the user. As Claude refines the document, it places updated versions in the toolbox. The user watches the document evolve in real-time with proper markdown rendering.

**Use Case 3: Multi-Session Management**
> A developer has Claude Code working on three different features across three git worktrees. They can see all sessions in a sidebar, click between them to view progress, and send follow-up instructions to any session that's waiting.

---

## Solution Overview

### Core Concept

The solution consists of a single local server that:

1. **Serves a Vue.js web application** to the browser
2. **Manages Claude Code sessions** via the Claude Agent SDK
3. **Provides a REST API** for session and toolbox operations
4. **Maintains WebSocket connections** to push real-time updates to browsers

### Why Local-First?

We chose a local-first architecture because:

1. **No cross-origin issues** - The browser connects to `localhost`, avoiding HTTPS/mixed-content restrictions
2. **No infrastructure cost** - Users don't need to pay for or manage servers
3. **Privacy** - All data stays on the user's machine
4. **Simplicity** - One command (`npx claudetools`) starts everything
5. **Low latency** - No network round-trips to external services

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        User's Machine                               │
│                                                                     │
│  ┌──────────────┐     ┌─────────────────────────────────────────┐   │
│  │   Browser    │     │            Local Server                 │   │
│  │              │     │                                         │   │
│  │  Vue.js App  │◀───▶│  ┌─────────┐  ┌────────────────────┐    │   │
│  │              │ WS  │  │ Express │  │  Session Manager   │    │   │
│  │  - Sessions  │     │  │  REST   │  │                    │    │   │
│  │  - Toolbox   │◀───▶│  │  API    │  │  ┌──────────────┐  │    │   │
│  │  - Chat      │HTTP │  │         │  │  │ Claude SDK   │  │    │   │
│  │              │     │  └─────────┘  │  │   query()    │  │    │   │
│  └──────────────┘     │               │  └──────┬───────┘  │    │   │
│                       │               │         │          │    │   │
│                       │               │         ▼          │    │   │
│                       │               │  ┌──────────────┐  │    │   │
│                       │               │  │   Session    │  │    │   │
│                       │               │  │   Session    │  │    │   │
│                       │               │  │   Session    │  │    │   │
│                       │               │  └──────────────┘  │    │   │
│                       │               └────────────────────┘    │   │
│                       │                                         │   │
│                       │  ┌─────────────────────────────────┐    │   │
│                       │  │         Toolbox Store           │    │   │
│                       │  │  (in-memory + optional disk)    │    │   │
│                       │  └─────────────────────────────────┘    │   │
│                       └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Architecture

### Component Overview

#### 1. Local Server (`packages/server`)

The server is a Node.js application that:

- **Serves the Vue.js frontend** as static files
- **Provides REST API endpoints** for CRUD operations on sessions and toolbox items
- **Manages WebSocket connections** for real-time updates
- **Orchestrates Claude Code sessions** using the Claude Agent SDK
- **Interfaces with Git** to list worktrees and branches

#### 2. Web Frontend (`packages/web`)

The frontend is a Vue.js 3 single-page application that:

- **Displays a list of sessions** with status indicators
- **Shows conversation history** for selected sessions
- **Renders toolbox items** (images, markdown, text)
- **Provides forms** to start new sessions with git context
- **Allows sending messages** to sessions waiting for input

#### 3. Shared Types (`packages/shared`)

A shared package containing:

- **JSDoc-annotated type definitions** used by both server and frontend
- **WebSocket message type definitions**
- **Constants and enums**

### Communication Patterns

#### HTTP REST API

Used for:
- CRUD operations (create session, delete session, etc.)
- Fetching initial state (list of sessions, toolbox items)
- One-off actions (send message to session)

#### WebSocket

Used for:
- Real-time conversation streaming (as Claude responds)
- Session status updates (started, waiting, completed)
- New toolbox items (pushed immediately when added)
- Session list changes (new session started, session ended)

### Why Both HTTP and WebSocket?

- **HTTP** is simpler for request/response patterns and works well with REST semantics
- **WebSocket** is necessary for server-initiated push (streaming responses, real-time updates)
- Using both keeps the API clean and follows established patterns

---

## Technology Stack

### Server

| Technology | Purpose | Why This Choice |
|------------|---------|-----------------|
| **Node.js 20+** | Runtime | Required by Claude Agent SDK, excellent async I/O |
| **Express 4** | HTTP framework | Simple, well-documented, huge ecosystem |
| **ws** | WebSocket library | Lightweight, no dependencies, battle-tested |
| **@anthropic-ai/claude-agent-sdk** | Claude integration | Official SDK for programmatic Claude Code control |

### Frontend

| Technology | Purpose | Why This Choice |
|------------|---------|-----------------|
| **Vue 3** | UI framework | User preference, excellent composition API |
| **Vite** | Build tool | Fast HMR, native ES modules, excellent DX |
| **Vue Router** | Routing | Official Vue router, simple SPA navigation |
| **Pinia** | State management | Official Vue store, excellent DX |

### Development

| Technology | Purpose |
|------------|---------|
| **pnpm** | Package manager with workspace support |
| **ESLint** | Linting |
| **Prettier** | Code formatting |
| **concurrently** | Run server and frontend in parallel |

---

## Project Structure

```
claudetools.io/
│
├── package.json                    # Root package.json for workspaces
├── pnpm-workspace.yaml             # pnpm workspace configuration
├── .gitignore                      # Git ignore rules
├── .prettierrc                     # Prettier configuration
├── .eslintrc.cjs                   # ESLint configuration
├── README.md                       # User-facing documentation
├── ARCHITECTURE.md                 # This document
│
└── packages/
    │
    ├── server/                     # Backend server package
    │   ├── package.json
    │   │
    │   ├── bin/
    │   │   └── cli.js              # CLI entry point for `npx claudetools`
    │   │
    │   └── src/
    │       ├── index.js            # Server entry point
    │       ├── app.js              # Express application setup
    │       ├── websocket.js        # WebSocket server and connection management
    │       ├── types.js            # Server-specific types (JSDoc)
    │       │
    │       ├── api/                # REST API route handlers
    │       │   ├── index.js        # Route registration
    │       │   ├── sessions.js     # Session CRUD endpoints
    │       │   ├── toolbox.js      # Toolbox endpoints
    │       │   ├── git.js          # Git information endpoints
    │       │   └── commands.js     # Slash command endpoints
    │       │
    │       └── services/           # Business logic
    │           ├── sessionManager.js    # Claude session orchestration
    │           ├── toolboxStore.js      # Toolbox item storage
    │           ├── gitService.js        # Git operations
    │           ├── diffService.js       # Real-time git diff tracking
    │           └── slashCommandService.js # Slash command discovery and parsing
    │
    ├── web/                        # Frontend Vue application
    │   ├── package.json
    │   ├── vite.config.js
    │   ├── index.html
    │   │
    │   └── src/
    │       ├── main.js             # Vue app entry point
    │       ├── App.vue             # Root component
    │       ├── router.js           # Vue Router configuration
    │       ├── types.js            # Frontend-specific types (JSDoc)
    │       │
    │       ├── stores/             # Pinia stores
    │       │   ├── sessions.js     # Session state management
    │       │   ├── toolbox.js      # Toolbox state management
    │       │   ├── diff.js         # Diff state management
    │       │   ├── commands.js     # Slash commands state management
    │       │   └── notes.js        # Session notes state management
    │       │
    │       ├── composables/        # Vue composition functions
    │       │   ├── useWebSocket.js # WebSocket connection management
    │       │   └── useApi.js       # HTTP API client
    │       │
    │       ├── views/              # Page-level components
    │       │   ├── HomeView.vue         # Main layout with sidebar
    │       │   ├── SessionListView.vue  # Session list (sidebar content)
    │       │   ├── SessionDetailView.vue # Single session conversation
    │       │   ├── NewSessionView.vue   # Create new session form
    │       │   ├── ToolboxView.vue      # Toolbox item display
    │       │   └── CommandsView.vue     # Slash commands browser/manager
    │       │
    │       ├── components/         # Reusable components
    │       │   ├── SessionCard.vue           # Session list item
    │       │   ├── SessionStatusBadge.vue    # Status indicator
    │       │   ├── ConversationMessage.vue   # Single message display
    │       │   ├── MessageInput.vue          # User input field
    │       │   ├── ToolboxItem.vue           # Single toolbox item
    │       │   ├── ToolboxImageItem.vue      # Image toolbox item
    │       │   ├── ToolboxMarkdownItem.vue   # Markdown toolbox item
    │       │   ├── GitWorktreeSelector.vue   # Worktree dropdown
    │       │   ├── GitBranchSelector.vue     # Branch dropdown
    │       │   ├── DiffViewer.vue            # Unified diff display
    │       │   ├── FileChangesTree.vue       # Changed files list
    │       │   ├── CommandPalette.vue        # Slash command autocomplete palette
    │       │   ├── CommandCard.vue           # Single command display card
    │       │   ├── CommandEditor.vue         # Create/edit custom commands
    │       │   └── SessionNotes.vue          # Session notes display and editor
    │       │
    │       └── assets/             # Static assets
    │           └── styles/
    │               └── main.css    # Global styles
    │
    └── shared/                     # Shared types package
        ├── package.json
        │
        └── src/
            ├── index.js            # Package exports
            ├── types.js            # Shared type definitions (JSDoc)
            ├── protocol.js         # WebSocket message types
            └── constants.js        # Shared constants
```

---

## Implementation Phases

### Phase 1: Project Scaffolding

**Goal**: Set up the monorepo structure with all packages configured and building.

**Steps**:

1. **Initialize root package.json**
   ```json
   {
     "name": "claudetools",
     "private": true,
     "scripts": {
       "dev": "concurrently \"pnpm --filter server dev\" \"pnpm --filter web dev\"",
       "build": "pnpm -r build",
       "start": "pnpm --filter server start"
     }
   }
   ```

2. **Create pnpm-workspace.yaml**
   ```yaml
   packages:
     - 'packages/*'
   ```

3. **Initialize packages/shared**
   - Create package.json with name `@claudetools/shared`
   - Create placeholder type files with JSDoc annotations

4. **Initialize packages/server**
   - Create package.json with dependencies (express, ws)
   - Add dependency on `@claudetools/shared`
   - Create minimal `src/index.js` that starts an HTTP server

5. **Initialize packages/web**
   - Run `npm create vue@latest` with Vue Router, Pinia (no TypeScript)
   - Add dependency on `@claudetools/shared`
   - Configure Vite to proxy API requests to server in dev mode

6. **Verify setup**
   - Run `pnpm install` from root
   - Run `pnpm dev` and verify both server and frontend start
   - Verify frontend can reach server API

**Deliverables**:
- All three packages exist and build without errors
- `pnpm dev` starts both server (port 3000) and frontend (port 5173)
- Frontend dev server proxies `/api/*` and `/ws` to server

---

### Phase 2: Core Server Infrastructure

**Goal**: Implement the Express server with WebSocket support and basic API structure.

**Steps**:

1. **Create Express application (`src/app.js`)**
   ```javascript
   import express from 'express';
   import cors from 'cors';
   import { apiRouter } from './api/index.js';

   export function createApp() {
     const app = express();

     app.use(cors());
     app.use(express.json());
     app.use(express.urlencoded({ extended: true }));

     // Serve static files from web build in production
     app.use(express.static('public'));

     // API routes
     app.use('/api', apiRouter);

     // Health check
     app.get('/api/health', (req, res) => {
       res.json({ status: 'ok', timestamp: Date.now() });
     });

     return app;
   }
   ```

2. **Create WebSocket server (`src/websocket.js`)**
   ```javascript
   import { WebSocketServer, WebSocket } from 'ws';

   const clients = new Set();

   /**
    * @param {import('http').Server} server
    */
   export function setupWebSocket(server) {
     const wss = new WebSocketServer({ server, path: '/ws' });

     wss.on('connection', (ws) => {
       clients.add(ws);

       // Send current state on connect
       ws.send(JSON.stringify({ type: 'connected' }));

       ws.on('close', () => {
         clients.delete(ws);
       });

       ws.on('error', (err) => {
         console.error('WebSocket error:', err);
         clients.delete(ws);
       });
     });

     return wss;
   }

   /**
    * @param {object} message
    */
   export function broadcast(message) {
     const data = JSON.stringify(message);
     for (const client of clients) {
       if (client.readyState === WebSocket.OPEN) {
         client.send(data);
       }
     }
   }
   ```

3. **Create server entry point (`src/index.js`)**
   ```javascript
   import { createServer } from 'http';
   import { createApp } from './app.js';
   import { setupWebSocket } from './websocket.js';

   const PORT = process.env.PORT || 3000;

   const app = createApp();
   const server = createServer(app);

   setupWebSocket(server);

   server.listen(PORT, () => {
     console.log(`Server running at http://localhost:${PORT}`);
   });
   ```

4. **Create API route structure (`src/api/index.js`)**
   ```javascript
   import { Router } from 'express';
   import sessionsRouter from './sessions.js';
   import toolboxRouter from './toolbox.js';
   import gitRouter from './git.js';

   export const apiRouter = Router();

   apiRouter.use('/sessions', sessionsRouter);
   apiRouter.use('/toolbox', toolboxRouter);
   apiRouter.use('/git', gitRouter);
   ```

5. **Create placeholder route files** with TODO implementations

6. **Add file upload support**
   - Install `multer` for multipart form handling
   - Configure for toolbox file uploads

**Deliverables**:
- Server starts and responds to `/api/health`
- WebSocket connections are accepted at `/ws`
- API routes are structured and return placeholder responses
- File uploads are handled by multer

---

### Phase 3: Shared Types and Protocol

**Goal**: Define all shared types, WebSocket message formats, and constants.

**Steps**:

1. **Define session types (`packages/shared/src/types.js`)**
   ```javascript
   /**
    * Session status
    * @typedef {'starting' | 'running' | 'waiting' | 'completed' | 'error'} SessionStatus
    */

   /**
    * A single message in a conversation
    * @typedef {Object} ConversationMessage
    * @property {string} id
    * @property {'user' | 'assistant' | 'system'} role
    * @property {string} content
    * @property {number} timestamp
    * @property {Array<{name: string, input: Object}>} [toolUse] - For assistant messages
    */

   /**
    * A Claude Code session
    * @typedef {Object} Session
    * @property {string} id
    * @property {string} name - User-provided or auto-generated
    * @property {SessionStatus} status
    * @property {string} workingDirectory - Absolute path
    * @property {string} [gitBranch] - Current branch if in git repo
    * @property {string} [gitWorktree] - Worktree name if applicable
    * @property {number} createdAt - Unix timestamp
    * @property {number} updatedAt - Last activity timestamp
    * @property {ConversationMessage[]} messages - Full conversation history
    * @property {string} [error] - Error message if status is 'error'
    */

   /**
    * Summary for list views (without full message history)
    * @typedef {Object} SessionSummary
    * @property {string} id
    * @property {string} name
    * @property {SessionStatus} status
    * @property {string} workingDirectory
    * @property {string} [gitBranch]
    * @property {number} createdAt
    * @property {number} updatedAt
    * @property {number} messageCount
    * @property {string} [lastMessage] - Preview of last message
    */

   export const SESSION_STATUSES = ['starting', 'running', 'waiting', 'completed', 'error'];
   ```

2. **Define toolbox types**
   ```javascript
   /**
    * Types of items that can be in the toolbox
    * @typedef {'image' | 'markdown' | 'text' | 'json'} ToolboxItemType
    */

   /**
    * Image item (screenshot, diagram, etc.)
    * @typedef {Object} ToolboxImageItem
    * @property {string} id
    * @property {'image'} type
    * @property {string} mimeType - image/png, image/jpeg, etc.
    * @property {string} data - Base64-encoded image data
    * @property {string} [filename]
    * @property {string} [label]
    * @property {string} [sessionId]
    * @property {number} createdAt
    * @property {number} [width]
    * @property {number} [height]
    */

   /**
    * Markdown document
    * @typedef {Object} ToolboxMarkdownItem
    * @property {string} id
    * @property {'markdown'} type
    * @property {string} content - Raw markdown text
    * @property {string} [filename]
    * @property {string} [label]
    * @property {string} [sessionId]
    * @property {number} createdAt
    */

   /**
    * Plain text
    * @typedef {Object} ToolboxTextItem
    * @property {string} id
    * @property {'text'} type
    * @property {string} content
    * @property {string} [label]
    * @property {string} [sessionId]
    * @property {number} createdAt
    */

   /**
    * JSON data
    * @typedef {Object} ToolboxJsonItem
    * @property {string} id
    * @property {'json'} type
    * @property {*} data - Parsed JSON
    * @property {string} [filename]
    * @property {string} [label]
    * @property {string} [sessionId]
    * @property {number} createdAt
    */

   /**
    * Union type for all toolbox items
    * @typedef {ToolboxImageItem | ToolboxMarkdownItem | ToolboxTextItem | ToolboxJsonItem} ToolboxItem
    */

   export const TOOLBOX_ITEM_TYPES = ['image', 'markdown', 'text', 'json'];
   ```

3. **Define git types**
   ```javascript
   /**
    * Git worktree information
    * @typedef {Object} GitWorktree
    * @property {string} path - Absolute path to worktree
    * @property {string} branch - Branch checked out in this worktree
    * @property {boolean} isMain - Is this the main worktree?
    * @property {boolean} isBare - Is this a bare worktree?
    */

   /**
    * Git branch information
    * @typedef {Object} GitBranch
    * @property {string} name - Branch name
    * @property {boolean} isRemote - Is this a remote branch?
    * @property {boolean} isCurrent - Is this the current branch?
    * @property {string} [remoteName] - Remote name if remote branch
    */
   ```

4. **Define WebSocket protocol (`packages/shared/src/protocol.js`)**
   ```javascript
   // ============================================
   // Server -> Client Messages
   // ============================================

   /**
    * Connection established
    * @typedef {Object} WsConnectedMessage
    * @property {'connected'} type
    * @property {number} timestamp
    */

   /**
    * Session list updated
    * @typedef {Object} WsSessionListMessage
    * @property {'session:list'} type
    * @property {SessionSummary[]} sessions
    */

   /**
    * Session status changed
    * @typedef {Object} WsSessionStatusMessage
    * @property {'session:status'} type
    * @property {string} sessionId
    * @property {SessionStatus} status
    * @property {string} [error]
    */

   /**
    * New message in session conversation
    * @typedef {Object} WsSessionMessageMessage
    * @property {'session:message'} type
    * @property {string} sessionId
    * @property {ConversationMessage} message
    */

   /**
    * Streaming content (partial message)
    * @typedef {Object} WsSessionStreamMessage
    * @property {'session:stream'} type
    * @property {string} sessionId
    * @property {string} messageId
    * @property {string} delta - New text to append
    */

   /**
    * Toolbox item added
    * @typedef {Object} WsToolboxAddMessage
    * @property {'toolbox:add'} type
    * @property {ToolboxItem} item
    */

   /**
    * Toolbox cleared
    * @typedef {Object} WsToolboxClearMessage
    * @property {'toolbox:clear'} type
    */

   /**
    * Toolbox item removed
    * @typedef {Object} WsToolboxRemoveMessage
    * @property {'toolbox:remove'} type
    * @property {string} itemId
    */

   /**
    * Union of all server -> client messages
    * @typedef {WsConnectedMessage | WsSessionListMessage | WsSessionStatusMessage | WsSessionMessageMessage | WsSessionStreamMessage | WsToolboxAddMessage | WsToolboxClearMessage | WsToolboxRemoveMessage} WsServerMessage
    */

   // ============================================
   // Client -> Server Messages
   // ============================================

   /**
    * Subscribe to a specific session's updates
    * @typedef {Object} WsSubscribeSessionMessage
    * @property {'subscribe:session'} type
    * @property {string} sessionId
    */

   /**
    * Unsubscribe from session updates
    * @typedef {Object} WsUnsubscribeSessionMessage
    * @property {'unsubscribe:session'} type
    * @property {string} sessionId
    */

   /**
    * Union of all client -> server messages
    * @typedef {WsSubscribeSessionMessage | WsUnsubscribeSessionMessage} WsClientMessage
    */
   ```

5. **Define API request/response types**
   ```javascript
   /**
    * POST /api/sessions - Create new session
    * @typedef {Object} CreateSessionRequest
    * @property {string} prompt - Initial prompt for Claude
    * @property {string} [name] - Optional session name
    * @property {string} workingDirectory - Where to run Claude
    * @property {string} [gitBranch] - Optional branch to checkout
    */

   /**
    * @typedef {Object} CreateSessionResponse
    * @property {Session} session
    */

   /**
    * POST /api/sessions/:id/message - Send message to session
    * @typedef {Object} SendMessageRequest
    * @property {string} content
    */

   /**
    * POST /api/toolbox - Add item to toolbox (JSON)
    * @typedef {Object} AddToolboxItemRequest
    * @property {ToolboxItemType} type
    * @property {string} [content] - For text/markdown
    * @property {*} [data] - For json
    * @property {string} [label]
    * @property {string} [sessionId]
    */
   // Note: Images are uploaded via multipart/form-data, not JSON
   ```

**Deliverables**:
- All types defined and exported from `@claudetools/shared`
- Both server and web packages can import and use these types
- Clear documentation via JSDoc comments for each type

---

### Phase 4: Session Manager Service

**Goal**: Implement the core session management using Claude Agent SDK.

**Steps**:

1. **Install Claude Agent SDK**
   ```bash
   cd packages/server
   pnpm add @anthropic-ai/claude-agent-sdk
   ```

2. **Create SessionManager class (`src/services/sessionManager.js`)**

   This is the most complex service. It must:
   - Start new sessions using `query()`
   - Track all active sessions
   - Store conversation history as messages stream
   - Determine session state from message flow
   - Support sending follow-up messages
   - Clean up completed/errored sessions

   ```javascript
   import { query } from '@anthropic-ai/claude-agent-sdk';
   import { randomUUID } from 'crypto';
   import { broadcast } from '../websocket.js';

   /**
    * @typedef {Object} ActiveSession
    * @property {import('@claudetools/shared').Session} session
    * @property {AbortController} abortController
    * @property {Array<{resolve: (value: string) => void}>} inputQueue
    */

   class SessionManager {
     /** @type {Map<string, ActiveSession>} */
     #sessions = new Map();

     /**
      * Get all sessions as summaries
      * @returns {import('@claudetools/shared').SessionSummary[]}
      */
     getAllSessions() {
       return Array.from(this.#sessions.values()).map(({ session }) => ({
         id: session.id,
         name: session.name,
         status: session.status,
         workingDirectory: session.workingDirectory,
         gitBranch: session.gitBranch,
         createdAt: session.createdAt,
         updatedAt: session.updatedAt,
         messageCount: session.messages.length,
         lastMessage: session.messages[session.messages.length - 1]?.content.slice(0, 100),
       }));
     }

     /**
      * Get full session by ID
      * @param {string} id
      * @returns {import('@claudetools/shared').Session | undefined}
      */
     getSession(id) {
       return this.#sessions.get(id)?.session;
     }

     /**
      * Start a new session
      * @param {Object} options
      * @param {string} options.prompt
      * @param {string} [options.name]
      * @param {string} options.workingDirectory
      * @param {string} [options.gitBranch]
      * @returns {Promise<import('@claudetools/shared').Session>}
      */
     async startSession(options) {
       const id = randomUUID();
       const now = Date.now();

       const session = {
         id,
         name: options.name || `Session ${id.slice(0, 8)}`,
         status: 'starting',
         workingDirectory: options.workingDirectory,
         gitBranch: options.gitBranch,
         createdAt: now,
         updatedAt: now,
         messages: [],
       };

       const abortController = new AbortController();

       this.#sessions.set(id, {
         session,
         abortController,
         inputQueue: [],
       });

       // Broadcast new session
       broadcast({ type: 'session:list', sessions: this.getAllSessions() });

       // Start the Claude session in background
       this.#runSession(id, options.prompt);

       return session;
     }

     /**
      * Internal: Run the Claude session
      * @param {string} sessionId
      * @param {string} initialPrompt
      */
     async #runSession(sessionId, initialPrompt) {
       const activeSession = this.#sessions.get(sessionId);
       if (!activeSession) return;

       const { session, abortController } = activeSession;

       try {
         // Update status to running
         this.#updateSessionStatus(sessionId, 'running');

         // Add user message
         this.#addMessage(sessionId, {
           id: randomUUID(),
           role: 'user',
           content: initialPrompt,
           timestamp: Date.now(),
         });

         // Create async generator for streaming input
         const inputGenerator = this.#createInputGenerator(sessionId);

         // Start Claude query
         const stream = query({
           prompt: inputGenerator,
           options: {
             model: 'claude-sonnet-4-5',
             cwd: session.workingDirectory,
             abortController,
           },
         });

         let currentMessageId = null;
         let currentContent = '';

         for await (const message of stream) {
           if (message.type === 'assistant') {
             // New assistant message
             currentMessageId = randomUUID();
             currentContent = '';

             for (const block of message.message.content) {
               if (block.type === 'text') {
                 currentContent += block.text;
               }
             }

             this.#addMessage(sessionId, {
               id: currentMessageId,
               role: 'assistant',
               content: currentContent,
               timestamp: Date.now(),
             });
           } else if (message.type === 'stream_event' && currentMessageId) {
             // Streaming update
             // TODO: Handle partial updates
           } else if (message.type === 'result') {
             // Session complete
             this.#updateSessionStatus(sessionId, 'waiting');
           }
         }
       } catch (error) {
         const errorMessage = error instanceof Error ? error.message : 'Unknown error';
         this.#updateSessionStatus(sessionId, 'error', errorMessage);
       }
     }

     /**
      * Create async generator for multi-turn input
      * @param {string} sessionId
      */
     async *#createInputGenerator(sessionId) {
       const activeSession = this.#sessions.get(sessionId);
       if (!activeSession) return;

       // Yield initial prompt placeholder (already handled)
       // Then wait for subsequent inputs
       while (true) {
         const input = await new Promise((resolve) => {
           activeSession.inputQueue.push({ resolve });
         });

         yield { type: 'user', content: input };
       }
     }

     /**
      * Send a message to a waiting session
      * @param {string} sessionId
      * @param {string} content
      * @returns {boolean}
      */
     sendMessage(sessionId, content) {
       const activeSession = this.#sessions.get(sessionId);
       if (!activeSession || activeSession.session.status !== 'waiting') {
         return false;
       }

       // Add user message to history
       this.#addMessage(sessionId, {
         id: randomUUID(),
         role: 'user',
         content,
         timestamp: Date.now(),
       });

       // Resolve the pending input promise
       const pending = activeSession.inputQueue.shift();
       if (pending) {
         this.#updateSessionStatus(sessionId, 'running');
         pending.resolve(content);
       }

       return true;
     }

     /**
      * Stop a session
      * @param {string} sessionId
      * @returns {boolean}
      */
     stopSession(sessionId) {
       const activeSession = this.#sessions.get(sessionId);
       if (!activeSession) return false;

       activeSession.abortController.abort();
       this.#updateSessionStatus(sessionId, 'completed');
       return true;
     }

     /**
      * Delete a session
      * @param {string} sessionId
      * @returns {boolean}
      */
     deleteSession(sessionId) {
       const activeSession = this.#sessions.get(sessionId);
       if (!activeSession) return false;

       // Stop if running
       if (['running', 'waiting', 'starting'].includes(activeSession.session.status)) {
         activeSession.abortController.abort();
       }

       this.#sessions.delete(sessionId);
       broadcast({ type: 'session:list', sessions: this.getAllSessions() });
       return true;
     }

     /**
      * Helper: Update session status
      * @param {string} sessionId
      * @param {import('@claudetools/shared').SessionStatus} status
      * @param {string} [error]
      */
     #updateSessionStatus(sessionId, status, error) {
       const activeSession = this.#sessions.get(sessionId);
       if (!activeSession) return;

       activeSession.session.status = status;
       activeSession.session.updatedAt = Date.now();
       if (error) activeSession.session.error = error;

       broadcast({
         type: 'session:status',
         sessionId,
         status,
         error,
       });
     }

     /**
      * Helper: Add message to session
      * @param {string} sessionId
      * @param {import('@claudetools/shared').ConversationMessage} message
      */
     #addMessage(sessionId, message) {
       const activeSession = this.#sessions.get(sessionId);
       if (!activeSession) return;

       activeSession.session.messages.push(message);
       activeSession.session.updatedAt = Date.now();

       broadcast({
         type: 'session:message',
         sessionId,
         message,
       });
     }

     // =========================================
     // Built-in Command Handlers
     // These methods handle 'app' execution type commands
     // =========================================

     /**
      * Clear conversation history for a session (/clear command)
      * @param {string} sessionId
      * @returns {{success: boolean, message?: string, error?: string}}
      */
     clearHistory(sessionId) {
       const activeSession = this.#sessions.get(sessionId);
       if (!activeSession) {
         return { success: false, error: 'Session not found' };
       }

       // Clear messages but keep the session
       activeSession.session.messages = [];
       activeSession.session.updatedAt = Date.now();

       broadcast({
         type: 'session:cleared',
         sessionId,
       });

       return { success: true, message: 'Conversation history cleared' };
     }

     /**
      * Change the model for a session (/model command)
      * Note: This requires restarting the Claude query with the new model
      * @param {string} sessionId
      * @param {string} modelName - e.g., 'sonnet', 'opus', 'haiku'
      * @returns {{success: boolean, message?: string, error?: string}}
      */
     setModel(sessionId, modelName) {
       const activeSession = this.#sessions.get(sessionId);
       if (!activeSession) {
         return { success: false, error: 'Session not found' };
       }

       // Map short names to full model IDs
       const modelMap = {
         'sonnet': 'claude-sonnet-4-5',
         'opus': 'claude-opus-4',
         'haiku': 'claude-haiku',
       };

       const fullModelId = modelMap[modelName] || modelName;
       activeSession.session.model = fullModelId;
       activeSession.session.updatedAt = Date.now();

       broadcast({
         type: 'session:model-changed',
         sessionId,
         model: fullModelId,
       });

       return { success: true, message: `Model changed to ${fullModelId}` };
     }

     /**
      * Get session status and statistics (/status command)
      * @param {string} sessionId
      * @returns {{success: boolean, data?: Object, error?: string}}
      */
     getStatus(sessionId) {
       const activeSession = this.#sessions.get(sessionId);
       if (!activeSession) {
         return { success: false, error: 'Session not found' };
       }

       const { session } = activeSession;
       return {
         success: true,
         data: {
           id: session.id,
           name: session.name,
           status: session.status,
           model: session.model || 'claude-sonnet-4-5',
           workingDirectory: session.workingDirectory,
           gitBranch: session.gitBranch,
           messageCount: session.messages.length,
           createdAt: session.createdAt,
           updatedAt: session.updatedAt,
           runningTime: Date.now() - session.createdAt,
         },
       };
     }

     /**
      * Get token usage and cost estimates (/cost command)
      * @param {string} sessionId
      * @returns {{success: boolean, data?: Object, error?: string}}
      */
     getCost(sessionId) {
       const activeSession = this.#sessions.get(sessionId);
       if (!activeSession) {
         return { success: false, error: 'Session not found' };
       }

       // Note: Actual token counting would require tracking from SDK responses
       // This is a placeholder structure
       const { session } = activeSession;
       return {
         success: true,
         data: {
           sessionId: session.id,
           inputTokens: session.inputTokens || 0,
           outputTokens: session.outputTokens || 0,
           totalTokens: (session.inputTokens || 0) + (session.outputTokens || 0),
           estimatedCost: session.estimatedCost || 0,
           currency: 'USD',
         },
       };
     }

     /**
      * Compact/summarize conversation history (/compact command)
      * Note: The Claude Agent SDK handles this automatically, but we can
      * trigger it manually or track when it happens
      * @param {string} sessionId
      * @returns {{success: boolean, message?: string, error?: string}}
      */
     compactHistory(sessionId) {
       const activeSession = this.#sessions.get(sessionId);
       if (!activeSession) {
         return { success: false, error: 'Session not found' };
       }

       // The SDK handles compaction automatically when context limits approach
       // This is mostly informational - we note that compaction was requested
       activeSession.session.updatedAt = Date.now();

       return {
         success: true,
         message: 'Compaction noted. The SDK will automatically compact when needed.',
       };
     }
   }

   // Export singleton
   export const sessionManager = new SessionManager();
   ```

3. **Implement session API routes (`src/api/sessions.js`)**
   ```javascript
   import { Router } from 'express';
   import { sessionManager } from '../services/sessionManager.js';

   const router = Router();

   // GET /api/sessions - List all sessions
   router.get('/', (req, res) => {
     const sessions = sessionManager.getAllSessions();
     res.json({ sessions });
   });

   // POST /api/sessions - Create new session
   router.post('/', async (req, res) => {
     const body = req.body;

     if (!body.prompt || !body.workingDirectory) {
       return res.status(400).json({
         error: 'prompt and workingDirectory are required'
       });
     }

     try {
       const session = await sessionManager.startSession({
         prompt: body.prompt,
         name: body.name,
         workingDirectory: body.workingDirectory,
         gitBranch: body.gitBranch,
       });
       res.status(201).json({ session });
     } catch (error) {
       res.status(500).json({ error: 'Failed to start session' });
     }
   });

   // GET /api/sessions/:id - Get session details
   router.get('/:id', (req, res) => {
     const session = sessionManager.getSession(req.params.id);
     if (!session) {
       return res.status(404).json({ error: 'Session not found' });
     }
     res.json({ session });
   });

   // POST /api/sessions/:id/message - Send message to session
   router.post('/:id/message', (req, res) => {
     const body = req.body;

     if (!body.content) {
       return res.status(400).json({ error: 'content is required' });
     }

     const success = sessionManager.sendMessage(req.params.id, body.content);
     if (!success) {
       return res.status(400).json({
         error: 'Cannot send message - session not waiting for input'
       });
     }

     res.json({ success: true });
   });

   // POST /api/sessions/:id/stop - Stop a session
   router.post('/:id/stop', (req, res) => {
     const success = sessionManager.stopSession(req.params.id);
     if (!success) {
       return res.status(404).json({ error: 'Session not found' });
     }
     res.json({ success: true });
   });

   // DELETE /api/sessions/:id - Delete a session
   router.delete('/:id', (req, res) => {
     const success = sessionManager.deleteSession(req.params.id);
     if (!success) {
       return res.status(404).json({ error: 'Session not found' });
     }
     res.json({ success: true });
   });

   export default router;
   ```

**Deliverables**:
- SessionManager class manages Claude Code sessions
- Sessions can be started, stopped, and deleted
- Messages stream in real-time via WebSocket
- Follow-up messages can be sent to waiting sessions

---

### Phase 5: Toolbox Service

**Goal**: Implement the toolbox storage and API for Claude Code to add items.

**Steps**:

1. **Create ToolboxStore class (`src/services/toolboxStore.js`)**
   ```javascript
   import { randomUUID } from 'crypto';
   import { broadcast } from '../websocket.js';

   class ToolboxStore {
     /** @type {Map<string, import('@claudetools/shared').ToolboxItem>} */
     #items = new Map();

     /**
      * Get all items
      * @returns {import('@claudetools/shared').ToolboxItem[]}
      */
     getAllItems() {
       return Array.from(this.#items.values())
         .sort((a, b) => b.createdAt - a.createdAt); // Newest first
     }

     /**
      * Get item by ID
      * @param {string} id
      * @returns {import('@claudetools/shared').ToolboxItem | undefined}
      */
     getItem(id) {
       return this.#items.get(id);
     }

     /**
      * Add an image item
      * @param {Object} options
      * @param {Buffer} options.data
      * @param {string} options.mimeType
      * @param {string} [options.filename]
      * @param {string} [options.label]
      * @param {string} [options.sessionId]
      * @returns {import('@claudetools/shared').ToolboxItem}
      */
     addImage(options) {
       const item = {
         id: randomUUID(),
         type: 'image',
         mimeType: options.mimeType,
         data: options.data.toString('base64'),
         filename: options.filename,
         label: options.label,
         sessionId: options.sessionId,
         createdAt: Date.now(),
       };

       this.#items.set(item.id, item);
       broadcast({ type: 'toolbox:add', item });
       return item;
     }

     /**
      * Add a markdown item
      * @param {Object} options
      * @param {string} options.content
      * @param {string} [options.filename]
      * @param {string} [options.label]
      * @param {string} [options.sessionId]
      * @returns {import('@claudetools/shared').ToolboxItem}
      */
     addMarkdown(options) {
       const item = {
         id: randomUUID(),
         type: 'markdown',
         content: options.content,
         filename: options.filename,
         label: options.label,
         sessionId: options.sessionId,
         createdAt: Date.now(),
       };

       this.#items.set(item.id, item);
       broadcast({ type: 'toolbox:add', item });
       return item;
     }

     /**
      * Add a text item
      * @param {Object} options
      * @param {string} options.content
      * @param {string} [options.label]
      * @param {string} [options.sessionId]
      * @returns {import('@claudetools/shared').ToolboxItem}
      */
     addText(options) {
       const item = {
         id: randomUUID(),
         type: 'text',
         content: options.content,
         label: options.label,
         sessionId: options.sessionId,
         createdAt: Date.now(),
       };

       this.#items.set(item.id, item);
       broadcast({ type: 'toolbox:add', item });
       return item;
     }

     /**
      * Add a JSON item
      * @param {Object} options
      * @param {*} options.data
      * @param {string} [options.filename]
      * @param {string} [options.label]
      * @param {string} [options.sessionId]
      * @returns {import('@claudetools/shared').ToolboxItem}
      */
     addJson(options) {
       const item = {
         id: randomUUID(),
         type: 'json',
         data: options.data,
         filename: options.filename,
         label: options.label,
         sessionId: options.sessionId,
         createdAt: Date.now(),
       };

       this.#items.set(item.id, item);
       broadcast({ type: 'toolbox:add', item });
       return item;
     }

     /**
      * Remove an item
      * @param {string} id
      * @returns {boolean}
      */
     removeItem(id) {
       const existed = this.#items.delete(id);
       if (existed) {
         broadcast({ type: 'toolbox:remove', itemId: id });
       }
       return existed;
     }

     /**
      * Clear all items
      */
     clear() {
       this.#items.clear();
       broadcast({ type: 'toolbox:clear' });
     }
   }

   export const toolboxStore = new ToolboxStore();
   ```

2. **Create toolbox API routes (`src/api/toolbox.js`)**
   ```javascript
   import { Router } from 'express';
   import multer from 'multer';
   import { toolboxStore } from '../services/toolboxStore.js';

   const router = Router();

   // Configure multer for file uploads
   const upload = multer({
     storage: multer.memoryStorage(),
     limits: {
       fileSize: 10 * 1024 * 1024, // 10MB max
     },
   });

   // GET /api/toolbox - List all items
   router.get('/', (req, res) => {
     const items = toolboxStore.getAllItems();
     res.json({ items });
   });

   // POST /api/toolbox - Add item (supports both JSON and multipart)
   router.post('/', upload.single('file'), (req, res) => {
     try {
       // Handle file upload
       if (req.file) {
         const mimeType = req.file.mimetype;

         // Image upload
         if (mimeType.startsWith('image/')) {
           const item = toolboxStore.addImage({
             data: req.file.buffer,
             mimeType,
             filename: req.file.originalname,
             label: req.body.label,
             sessionId: req.body.sessionId,
           });
           return res.status(201).json({ item });
         }

         // Markdown file
         if (mimeType === 'text/markdown' || req.file.originalname.endsWith('.md')) {
           const item = toolboxStore.addMarkdown({
             content: req.file.buffer.toString('utf-8'),
             filename: req.file.originalname,
             label: req.body.label,
             sessionId: req.body.sessionId,
           });
           return res.status(201).json({ item });
         }

         // JSON file
         if (mimeType === 'application/json' || req.file.originalname.endsWith('.json')) {
           const data = JSON.parse(req.file.buffer.toString('utf-8'));
           const item = toolboxStore.addJson({
             data,
             filename: req.file.originalname,
             label: req.body.label,
             sessionId: req.body.sessionId,
           });
           return res.status(201).json({ item });
         }

         // Plain text fallback
         const item = toolboxStore.addText({
           content: req.file.buffer.toString('utf-8'),
           label: req.body.label || req.file.originalname,
           sessionId: req.body.sessionId,
         });
         return res.status(201).json({ item });
       }

       // Handle JSON body
       const body = req.body;

       if (!body.type) {
         return res.status(400).json({ error: 'type is required' });
       }

       let item;
       switch (body.type) {
         case 'markdown':
           if (!body.content) {
             return res.status(400).json({ error: 'content is required for markdown' });
           }
           item = toolboxStore.addMarkdown({
             content: body.content,
             label: body.label,
             sessionId: body.sessionId,
           });
           break;

         case 'text':
           if (!body.content) {
             return res.status(400).json({ error: 'content is required for text' });
           }
           item = toolboxStore.addText({
             content: body.content,
             label: body.label,
             sessionId: body.sessionId,
           });
           break;

         case 'json':
           if (body.data === undefined) {
             return res.status(400).json({ error: 'data is required for json' });
           }
           item = toolboxStore.addJson({
             data: body.data,
             label: body.label,
             sessionId: body.sessionId,
           });
           break;

         default:
           return res.status(400).json({ error: `Unsupported type: ${body.type}` });
       }

       res.status(201).json({ item });
     } catch (error) {
       console.error('Toolbox add error:', error);
       res.status(500).json({ error: 'Failed to add item' });
     }
   });

   // GET /api/toolbox/:id - Get single item
   router.get('/:id', (req, res) => {
     const item = toolboxStore.getItem(req.params.id);
     if (!item) {
       return res.status(404).json({ error: 'Item not found' });
     }
     res.json({ item });
   });

   // DELETE /api/toolbox/:id - Remove item
   router.delete('/:id', (req, res) => {
     const success = toolboxStore.removeItem(req.params.id);
     if (!success) {
       return res.status(404).json({ error: 'Item not found' });
     }
     res.json({ success: true });
   });

   // DELETE /api/toolbox - Clear all items
   router.delete('/', (req, res) => {
     toolboxStore.clear();
     res.json({ success: true });
   });

   export default router;
   ```

3. **Usage examples for Claude Code**

   Claude Code can add items to the toolbox using curl:

   ```bash
   # Add an image (screenshot)
   curl -X POST http://localhost:3000/api/toolbox \
     -F "file=@screenshot.png" \
     -F "label=Test failure screenshot"

   # Add markdown document
   curl -X POST http://localhost:3000/api/toolbox \
     -F "file=@plan.md" \
     -F "label=Project Plan v2"

   # Add markdown via JSON
   curl -X POST http://localhost:3000/api/toolbox \
     -H "Content-Type: application/json" \
     -d '{
       "type": "markdown",
       "content": "# My Plan\n\n1. Step one\n2. Step two",
       "label": "Implementation Plan"
     }'

   # Add JSON data
   curl -X POST http://localhost:3000/api/toolbox \
     -H "Content-Type: application/json" \
     -d '{
       "type": "json",
       "data": {"tests": 10, "passed": 8, "failed": 2},
       "label": "Test Results"
     }'

   # Clear toolbox
   curl -X DELETE http://localhost:3000/api/toolbox
   ```

**Deliverables**:
- ToolboxStore manages items in memory
- API accepts both file uploads and JSON
- Items broadcast to browsers in real-time
- Claude Code can add items via simple curl commands

---

### Phase 6: Git Integration Service

**Goal**: Implement git worktree and branch listing for session creation.

**Steps**:

1. **Create GitService class (`src/services/gitService.js`)**
   ```javascript
   import { exec } from 'child_process';
   import { promisify } from 'util';

   const execAsync = promisify(exec);

   class GitService {
     /**
      * Check if a directory is a git repository
      * @param {string} directory
      * @returns {Promise<boolean>}
      */
     async isGitRepo(directory) {
       try {
         await execAsync('git rev-parse --git-dir', { cwd: directory });
         return true;
       } catch {
         return false;
       }
     }

     /**
      * Get list of worktrees
      * @param {string} directory
      * @returns {Promise<import('@claudetools/shared').GitWorktree[]>}
      */
     async getWorktrees(directory) {
       try {
         const { stdout } = await execAsync('git worktree list --porcelain', {
           cwd: directory,
         });

         const worktrees = [];
         let current = {};

         for (const line of stdout.split('\n')) {
           if (line.startsWith('worktree ')) {
             if (current.path) {
               worktrees.push(current);
             }
             current = {
               path: line.slice(9),
               isMain: false,
               isBare: false,
             };
           } else if (line.startsWith('branch ')) {
             // refs/heads/branch-name -> branch-name
             current.branch = line.slice(7).replace('refs/heads/', '');
           } else if (line === 'bare') {
             current.isBare = true;
           }
         }

         // Don't forget last one
         if (current.path) {
           worktrees.push(current);
         }

         // Mark main worktree (first non-bare)
         const mainIdx = worktrees.findIndex(w => !w.isBare);
         if (mainIdx >= 0) {
           worktrees[mainIdx].isMain = true;
         }

         return worktrees;
       } catch (error) {
         console.error('Failed to get worktrees:', error);
         return [];
       }
     }

     /**
      * Get list of branches
      * @param {string} directory
      * @returns {Promise<import('@claudetools/shared').GitBranch[]>}
      */
     async getBranches(directory) {
       try {
         // Get current branch
         const { stdout: currentBranch } = await execAsync(
           'git branch --show-current',
           { cwd: directory }
         );
         const current = currentBranch.trim();

         // Get all branches
         const { stdout } = await execAsync(
           'git branch -a --format="%(refname:short)|%(refname)|%(upstream)"',
           { cwd: directory }
         );

         const branches = [];
         const seen = new Set();

         for (const line of stdout.split('\n')) {
           if (!line.trim()) continue;

           const [shortName, fullRef] = line.split('|');
           const isRemote = fullRef.startsWith('refs/remotes/');

           // Skip duplicate remote tracking branches
           if (seen.has(shortName)) continue;
           seen.add(shortName);

           // Parse remote name from remote branches
           let remoteName;
           let branchName = shortName;

           if (isRemote) {
             const parts = shortName.split('/');
             remoteName = parts[0];
             branchName = parts.slice(1).join('/');

             // Skip HEAD pointers
             if (branchName === 'HEAD') continue;
           }

           branches.push({
             name: branchName,
             isRemote,
             isCurrent: shortName === current,
             remoteName,
           });
         }

         // Sort: current first, then local, then remote
         return branches.sort((a, b) => {
           if (a.isCurrent) return -1;
           if (b.isCurrent) return 1;
           if (a.isRemote !== b.isRemote) return a.isRemote ? 1 : -1;
           return a.name.localeCompare(b.name);
         });
       } catch (error) {
         console.error('Failed to get branches:', error);
         return [];
       }
     }

     /**
      * Get current branch name
      * @param {string} directory
      * @returns {Promise<string | null>}
      */
     async getCurrentBranch(directory) {
       try {
         const { stdout } = await execAsync('git branch --show-current', {
           cwd: directory,
         });
         return stdout.trim() || null;
       } catch {
         return null;
       }
     }

     /**
      * Create a new worktree
      * @param {string} directory
      * @param {string} path
      * @param {string} branch
      * @param {boolean} [createBranch=false]
      * @returns {Promise<{success: boolean, error?: string}>}
      */
     async createWorktree(directory, path, branch, createBranch = false) {
       try {
         const branchFlag = createBranch ? '-b' : '';
         await execAsync(
           `git worktree add ${branchFlag} "${path}" "${branch}"`,
           { cwd: directory }
         );
         return { success: true };
       } catch (error) {
         return {
           success: false,
           error: error instanceof Error ? error.message : 'Unknown error'
         };
       }
     }
   }

   export const gitService = new GitService();
   ```

2. **Create git API routes (`src/api/git.js`)**
   ```javascript
   import { Router } from 'express';
   import { gitService } from '../services/gitService.js';

   const router = Router();

   // GET /api/git/worktrees?directory=/path/to/repo
   router.get('/worktrees', async (req, res) => {
     const directory = req.query.directory;

     if (!directory) {
       return res.status(400).json({ error: 'directory query param is required' });
     }

     const isRepo = await gitService.isGitRepo(directory);
     if (!isRepo) {
       return res.status(400).json({ error: 'Not a git repository' });
     }

     const worktrees = await gitService.getWorktrees(directory);
     res.json({ worktrees });
   });

   // GET /api/git/branches?directory=/path/to/repo
   router.get('/branches', async (req, res) => {
     const directory = req.query.directory;

     if (!directory) {
       return res.status(400).json({ error: 'directory query param is required' });
     }

     const isRepo = await gitService.isGitRepo(directory);
     if (!isRepo) {
       return res.status(400).json({ error: 'Not a git repository' });
     }

     const branches = await gitService.getBranches(directory);
     res.json({ branches });
   });

   // GET /api/git/current-branch?directory=/path/to/repo
   router.get('/current-branch', async (req, res) => {
     const directory = req.query.directory;

     if (!directory) {
       return res.status(400).json({ error: 'directory query param is required' });
     }

     const branch = await gitService.getCurrentBranch(directory);
     res.json({ branch });
   });

   // POST /api/git/worktrees - Create new worktree
   router.post('/worktrees', async (req, res) => {
     const { directory, path, branch, createBranch } = req.body;

     if (!directory || !path || !branch) {
       return res.status(400).json({
         error: 'directory, path, and branch are required'
       });
     }

     const result = await gitService.createWorktree(
       directory,
       path,
       branch,
       createBranch
     );

     if (!result.success) {
       return res.status(400).json({ error: result.error });
     }

     res.status(201).json({ success: true });
   });

   export default router;
   ```

**Deliverables**:
- GitService provides worktree and branch information
- API endpoints for listing worktrees, branches
- Can create new worktrees from the API
- Properly handles non-git directories

---

### Phase 7: Vue Frontend - Core Setup

**Goal**: Set up the Vue application with routing, state management, and WebSocket.

**Steps**:

1. **Configure Vue Router (`src/router.js`)**
   ```javascript
   import { createRouter, createWebHistory } from 'vue-router';

   const routes = [
     {
       path: '/',
       name: 'home',
       component: () => import('./views/HomeView.vue'),
       children: [
         {
           path: '',
           name: 'session-list',
           component: () => import('./views/SessionListView.vue'),
         },
         {
           path: 'sessions/new',
           name: 'new-session',
           component: () => import('./views/NewSessionView.vue'),
         },
         {
           path: 'sessions/:id',
           name: 'session-detail',
           component: () => import('./views/SessionDetailView.vue'),
         },
         {
           path: 'toolbox',
           name: 'toolbox',
           component: () => import('./views/ToolboxView.vue'),
         },
         {
           path: 'commands',
           name: 'commands',
           component: () => import('./views/CommandsView.vue'),
         },
       ],
     },
   ];

   export const router = createRouter({
     history: createWebHistory(),
     routes,
   });
   ```

2. **Create WebSocket composable (`src/composables/useWebSocket.js`)**
   ```javascript
   import { ref } from 'vue';

   const socket = ref(null);
   const isConnected = ref(false);
   const messageHandlers = new Set();

   export function useWebSocket() {
     const connect = () => {
       if (socket.value?.readyState === WebSocket.OPEN) return;

       const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
       const wsUrl = `${protocol}//${window.location.host}/ws`;

       socket.value = new WebSocket(wsUrl);

       socket.value.onopen = () => {
         isConnected.value = true;
         console.log('WebSocket connected');
       };

       socket.value.onclose = () => {
         isConnected.value = false;
         console.log('WebSocket disconnected');
         // Reconnect after 2 seconds
         setTimeout(connect, 2000);
       };

       socket.value.onerror = (error) => {
         console.error('WebSocket error:', error);
       };

       socket.value.onmessage = (event) => {
         try {
           const message = JSON.parse(event.data);
           for (const handler of messageHandlers) {
             handler(message);
           }
         } catch (error) {
           console.error('Failed to parse WebSocket message:', error);
         }
       };
     };

     const disconnect = () => {
       socket.value?.close();
       socket.value = null;
     };

     /**
      * @param {(msg: object) => void} handler
      */
     const onMessage = (handler) => {
       messageHandlers.add(handler);
       return () => messageHandlers.delete(handler);
     };

     const send = (message) => {
       if (socket.value?.readyState === WebSocket.OPEN) {
         socket.value.send(JSON.stringify(message));
       }
     };

     return {
       isConnected,
       connect,
       disconnect,
       onMessage,
       send,
     };
   }
   ```

3. **Create API composable (`src/composables/useApi.js`)**
   ```javascript
   const BASE_URL = '/api';

   /**
    * @param {string} path
    * @param {RequestInit} [options]
    * @returns {Promise<any>}
    */
   async function fetchApi(path, options) {
     const response = await fetch(`${BASE_URL}${path}`, {
       ...options,
       headers: {
         'Content-Type': 'application/json',
         ...options?.headers,
       },
     });

     if (!response.ok) {
       const error = await response.json().catch(() => ({}));
       throw new Error(error.error || `HTTP ${response.status}`);
     }

     return response.json();
   }

   export function useApi() {
     return {
       // Sessions
       getSessions: () => fetchApi('/sessions'),

       getSession: (id) => fetchApi(`/sessions/${id}`),

       createSession: (data) =>
         fetchApi('/sessions', {
           method: 'POST',
           body: JSON.stringify(data),
         }),

       sendMessage: (sessionId, content) =>
         fetchApi(`/sessions/${sessionId}/message`, {
           method: 'POST',
           body: JSON.stringify({ content }),
         }),

       stopSession: (id) =>
         fetchApi(`/sessions/${id}/stop`, {
           method: 'POST',
         }),

       deleteSession: (id) =>
         fetchApi(`/sessions/${id}`, {
           method: 'DELETE',
         }),

       // Toolbox
       getToolboxItems: () => fetchApi('/toolbox'),

       deleteToolboxItem: (id) =>
         fetchApi(`/toolbox/${id}`, {
           method: 'DELETE',
         }),

       clearToolbox: () =>
         fetchApi('/toolbox', {
           method: 'DELETE',
         }),

       // Git
       getWorktrees: (directory) =>
         fetchApi(`/git/worktrees?directory=${encodeURIComponent(directory)}`),

       getBranches: (directory) =>
         fetchApi(`/git/branches?directory=${encodeURIComponent(directory)}`),
     };
   }
   ```

4. **Create Sessions store (`src/stores/sessions.js`)**
   ```javascript
   import { defineStore } from 'pinia';
   import { ref, computed } from 'vue';
   import { useApi } from '../composables/useApi.js';
   import { useWebSocket } from '../composables/useWebSocket.js';

   export const useSessionsStore = defineStore('sessions', () => {
     const api = useApi();
     const { onMessage } = useWebSocket();

     const sessions = ref([]);
     const currentSession = ref(null);
     const loading = ref(false);
     const error = ref(null);

     // Computed
     const activeSessions = computed(() =>
       sessions.value.filter(s => ['running', 'waiting'].includes(s.status))
     );

     // Actions
     async function fetchSessions() {
       loading.value = true;
       try {
         const result = await api.getSessions();
         sessions.value = result.sessions;
       } catch (e) {
         error.value = e instanceof Error ? e.message : 'Failed to fetch sessions';
       } finally {
         loading.value = false;
       }
     }

     async function fetchSession(id) {
       loading.value = true;
       try {
         const result = await api.getSession(id);
         currentSession.value = result.session;
       } catch (e) {
         error.value = e instanceof Error ? e.message : 'Failed to fetch session';
       } finally {
         loading.value = false;
       }
     }

     async function createSession(data) {
       loading.value = true;
       try {
         const result = await api.createSession(data);
         return result.session;
       } catch (e) {
         error.value = e instanceof Error ? e.message : 'Failed to create session';
         throw e;
       } finally {
         loading.value = false;
       }
     }

     async function sendMessage(sessionId, content) {
       try {
         await api.sendMessage(sessionId, content);
       } catch (e) {
         error.value = e instanceof Error ? e.message : 'Failed to send message';
         throw e;
       }
     }

     // WebSocket message handler
     onMessage((msg) => {
       switch (msg.type) {
         case 'session:list':
           sessions.value = msg.sessions;
           break;

         case 'session:status':
           // Update in list
           const idx = sessions.value.findIndex(s => s.id === msg.sessionId);
           if (idx >= 0) {
             sessions.value[idx].status = msg.status;
           }
           // Update current if viewing
           if (currentSession.value?.id === msg.sessionId) {
             currentSession.value.status = msg.status;
             if (msg.error) currentSession.value.error = msg.error;
           }
           break;

         case 'session:message':
           if (currentSession.value?.id === msg.sessionId) {
             currentSession.value.messages.push(msg.message);
           }
           break;
       }
     });

     return {
       sessions,
       currentSession,
       loading,
       error,
       activeSessions,
       fetchSessions,
       fetchSession,
       createSession,
       sendMessage,
     };
   });
   ```

5. **Create Toolbox store (`src/stores/toolbox.js`)**
   ```javascript
   import { defineStore } from 'pinia';
   import { ref } from 'vue';
   import { useApi } from '../composables/useApi.js';
   import { useWebSocket } from '../composables/useWebSocket.js';

   export const useToolboxStore = defineStore('toolbox', () => {
     const api = useApi();
     const { onMessage } = useWebSocket();

     const items = ref([]);
     const loading = ref(false);

     async function fetchItems() {
       loading.value = true;
       try {
         const result = await api.getToolboxItems();
         items.value = result.items;
       } finally {
         loading.value = false;
       }
     }

     async function removeItem(id) {
       await api.deleteToolboxItem(id);
     }

     async function clearAll() {
       await api.clearToolbox();
     }

     // WebSocket handler
     onMessage((msg) => {
       switch (msg.type) {
         case 'toolbox:add':
           items.value.unshift(msg.item);
           break;

         case 'toolbox:remove':
           items.value = items.value.filter(i => i.id !== msg.itemId);
           break;

         case 'toolbox:clear':
           items.value = [];
           break;
       }
     });

     return {
       items,
       loading,
       fetchItems,
       removeItem,
       clearAll,
     };
   });
   ```

**Deliverables**:
- Vue Router configured with all routes
- WebSocket composable for real-time updates
- API composable for HTTP requests
- Pinia stores for sessions and toolbox
- Real-time state updates via WebSocket

---

### Phase 8: Vue Frontend - Components and Views

**Goal**: Implement all UI components and views.

**Steps**:

1. **HomeView.vue** - Main layout with sidebar
   - Left sidebar: Session list, navigation
   - Main area: Router view for detail content
   - Header: App title, connection status

2. **SessionListView.vue** - List of sessions
   - Fetch sessions on mount
   - Display SessionCard for each
   - "New Session" button
   - Filter/sort options (optional)

3. **SessionCard.vue** - Session list item
   - Session name
   - Status badge (color-coded)
   - Last message preview
   - Timestamp
   - Click to navigate to detail

4. **SessionDetailView.vue** - Conversation view
   - Fetch full session on mount
   - List of ConversationMessage components
   - Auto-scroll to bottom on new messages
   - MessageInput at bottom (enabled when status is 'waiting')

5. **ConversationMessage.vue** - Single message
   - Different styling for user/assistant
   - Markdown rendering for assistant messages
   - Timestamp
   - Tool usage indicators

6. **MessageInput.vue** - User input field
   - Textarea with send button
   - Submit on Enter (Shift+Enter for newline)
   - Disabled when session not waiting

7. **NewSessionView.vue** - Create session form
   - Prompt textarea
   - Working directory input (with file picker if possible)
   - GitWorktreeSelector dropdown
   - GitBranchSelector dropdown
   - Submit button

8. **ToolboxView.vue** - Toolbox display
   - Grid/list of ToolboxItem components
   - Clear all button
   - Empty state when no items

9. **ToolboxItem.vue** - Single toolbox item
   - Routes to specific renderer based on type
   - Delete button
   - Label display
   - Timestamp

10. **ToolboxImageItem.vue** - Image display
    - Render base64 image
    - Click to expand/zoom
    - Filename if available

11. **ToolboxMarkdownItem.vue** - Markdown display
    - Render markdown with syntax highlighting
    - Scrollable if long

**Deliverables**:
- All views implemented and functional
- Components properly styled
- Real-time updates working
- Full user flow from session creation to conversation

---

### Phase 9: CLI Entry Point

**Goal**: Create the `npx claudetools` command that starts everything.

**Steps**:

1. **Create CLI script (`packages/server/bin/cli.js`)**
   ```javascript
   #!/usr/bin/env node

   import { createServer } from 'http';
   import { createApp } from '../src/app.js';
   import { setupWebSocket } from '../src/websocket.js';
   import open from 'open';

   const PORT = parseInt(process.env.PORT || '3000', 10);

   async function main() {
     const app = createApp();
     const server = createServer(app);

     setupWebSocket(server);

     server.listen(PORT, () => {
       const url = `http://localhost:${PORT}`;
       console.log(`
   ╔═══════════════════════════════════════════════╗
   ║                                               ║
   ║   claudetools is running!                     ║
   ║                                               ║
   ║   Open: ${url.padEnd(33)}║
   ║                                               ║
   ║   Press Ctrl+C to stop                        ║
   ║                                               ║
   ╚═══════════════════════════════════════════════╝
       `);

       // Auto-open browser
       if (process.env.NO_OPEN !== 'true') {
         open(url);
       }
     });

     // Graceful shutdown
     process.on('SIGINT', () => {
       console.log('\nShutting down...');
       server.close(() => {
         process.exit(0);
       });
     });
   }

   main().catch((error) => {
     console.error('Failed to start:', error);
     process.exit(1);
   });
   ```

2. **Update package.json for CLI**
   ```json
   {
     "name": "claudetools",
     "version": "0.1.0",
     "type": "module",
     "bin": {
       "claudetools": "./bin/cli.js"
     },
     "scripts": {
       "build": "cp -r ../web/dist ./public",
       "start": "node bin/cli.js",
       "dev": "node --watch src/index.js"
     }
   }
   ```

3. **Build script for production**
   - Build web package first (runs Vite build)
   - Copy web dist to server public folder
   - Result is a single package that serves both API and frontend

**Deliverables**:
- `npx claudetools` starts the server
- Browser opens automatically
- Clean shutdown on Ctrl+C
- Production build creates single deployable package

---

### Phase 10: Real-Time Diff View

**Goal**: Show real-time git diff of all file changes during a session.

**Steps**:

1. **Install chokidar for file watching**
   ```bash
   cd packages/server
   pnpm add chokidar
   ```

2. **Create DiffService class (`src/services/diffService.js`)**
   ```javascript
   import { exec } from 'child_process';
   import { promisify } from 'util';
   import chokidar from 'chokidar';
   import { broadcast } from '../websocket.js';

   const execAsync = promisify(exec);

   class DiffService {
     /** @type {Map<string, {baselineCommit: string, watcher: chokidar.FSWatcher, debounceTimer: NodeJS.Timeout | null}>} */
     #sessions = new Map();

     /**
      * Start tracking diffs for a session
      * @param {string} sessionId
      * @param {string} workingDirectory
      * @returns {Promise<string | null>} baseline commit SHA or null if not a git repo
      */
     async startTracking(sessionId, workingDirectory) {
       try {
         // Get current HEAD as baseline
         const { stdout } = await execAsync('git rev-parse HEAD', {
           cwd: workingDirectory,
         });
         const baselineCommit = stdout.trim();

         // Set up file watcher
         const watcher = chokidar.watch(workingDirectory, {
           ignored: [
             /(^|[\/\\])\../,  // dotfiles
             /node_modules/,
             /\.git/,
           ],
           persistent: true,
           ignoreInitial: true,
         });

         const sessionData = {
           baselineCommit,
           workingDirectory,
           watcher,
           debounceTimer: null,
         };

         // Debounced diff broadcast
         const broadcastDiff = async () => {
           const diff = await this.getDiff(sessionId);
           if (diff) {
             broadcast({
               type: 'session:diff',
               sessionId,
               ...diff,
             });
           }
         };

         // Watch for changes
         watcher.on('all', () => {
           // Debounce to avoid spamming during rapid changes
           if (sessionData.debounceTimer) {
             clearTimeout(sessionData.debounceTimer);
           }
           sessionData.debounceTimer = setTimeout(broadcastDiff, 500);
         });

         this.#sessions.set(sessionId, sessionData);
         return baselineCommit;
       } catch (error) {
         console.error('Failed to start diff tracking:', error);
         return null;
       }
     }

     /**
      * Stop tracking diffs for a session
      * @param {string} sessionId
      */
     stopTracking(sessionId) {
       const sessionData = this.#sessions.get(sessionId);
       if (sessionData) {
         sessionData.watcher.close();
         if (sessionData.debounceTimer) {
           clearTimeout(sessionData.debounceTimer);
         }
         this.#sessions.delete(sessionId);
       }
     }

     /**
      * Get current diff for a session
      * @param {string} sessionId
      * @returns {Promise<{files: Array<{path: string, status: string}>, diff: string} | null>}
      */
     async getDiff(sessionId) {
       const sessionData = this.#sessions.get(sessionId);
       if (!sessionData) return null;

       const { baselineCommit, workingDirectory } = sessionData;

       try {
         // Get list of changed files
         const { stdout: filesOutput } = await execAsync(
           `git diff --name-status ${baselineCommit}`,
           { cwd: workingDirectory }
         );

         const files = filesOutput
           .trim()
           .split('\n')
           .filter(line => line.trim())
           .map(line => {
             const [status, ...pathParts] = line.split('\t');
             return {
               status: status.trim(),  // M, A, D, R, etc.
               path: pathParts.join('\t').trim(),
             };
           });

         // Get unified diff
         const { stdout: diff } = await execAsync(
           `git diff ${baselineCommit}`,
           { cwd: workingDirectory, maxBuffer: 10 * 1024 * 1024 }  // 10MB max
         );

         return { files, diff };
       } catch (error) {
         console.error('Failed to get diff:', error);
         return null;
       }
     }

     /**
      * Get baseline commit for a session
      * @param {string} sessionId
      * @returns {string | null}
      */
     getBaseline(sessionId) {
       return this.#sessions.get(sessionId)?.baselineCommit || null;
     }
   }

   export const diffService = new DiffService();
   ```

3. **Update SessionManager to integrate with DiffService**
   - In `startSession()`: call `diffService.startTracking()`
   - Store `baselineCommit` on the session object
   - In `deleteSession()`: call `diffService.stopTracking()`

4. **Add diff API endpoint (`src/api/sessions.js`)**
   ```javascript
   // GET /api/sessions/:id/diff - Get current diff
   router.get('/:id/diff', async (req, res) => {
     const diff = await diffService.getDiff(req.params.id);
     if (!diff) {
       return res.status(404).json({ error: 'Session not found or not tracking' });
     }
     res.json(diff);
   });
   ```

5. **Add diff types to shared package**
   ```javascript
   /**
    * A changed file in a diff
    * @typedef {Object} DiffFile
    * @property {string} path - File path relative to working directory
    * @property {'M' | 'A' | 'D' | 'R' | 'C' | 'U'} status - M=modified, A=added, D=deleted, R=renamed, C=copied, U=unmerged
    */

   /**
    * Session diff update WebSocket message
    * @typedef {Object} WsSessionDiffMessage
    * @property {'session:diff'} type
    * @property {string} sessionId
    * @property {DiffFile[]} files - List of changed files
    * @property {string} diff - Unified diff output
    */
   ```

6. **Create Diff store (`src/stores/diff.js`)**
   ```javascript
   import { defineStore } from 'pinia';
   import { ref } from 'vue';
   import { useApi } from '../composables/useApi.js';
   import { useWebSocket } from '../composables/useWebSocket.js';

   export const useDiffStore = defineStore('diff', () => {
     const api = useApi();
     const { onMessage } = useWebSocket();

     // Map of sessionId -> { files, diff }
     const diffs = ref(new Map());
     const loading = ref(false);

     async function fetchDiff(sessionId) {
       loading.value = true;
       try {
         const result = await api.getSessionDiff(sessionId);
         diffs.value.set(sessionId, result);
       } finally {
         loading.value = false;
       }
     }

     function getDiff(sessionId) {
       return diffs.value.get(sessionId);
     }

     // WebSocket handler for real-time updates
     onMessage((msg) => {
       if (msg.type === 'session:diff') {
         diffs.value.set(msg.sessionId, {
           files: msg.files,
           diff: msg.diff,
         });
       }
     });

     return {
       diffs,
       loading,
       fetchDiff,
       getDiff,
     };
   });
   ```

7. **Create FileChangesTree component**
   - List changed files with status icons (green +, red -, yellow ~)
   - Click to scroll to that file in the diff viewer
   - Show file count summary

8. **Create DiffViewer component**

   **Library Selection: diff2html**

   For rendering git diffs in the browser, we will use the [diff2html](https://diff2html.xyz/) library. This choice was made after evaluating several options:

   | Library | Pros | Cons | Verdict |
   |---------|------|------|---------|
   | **diff2html** | Framework-agnostic, excellent default styling, supports unified & side-by-side views, active maintenance, syntax highlighting via highlight.js | Larger bundle (~50KB gzipped with highlight.js) | **Recommended** |
   | **react-diff-view** | Excellent React integration, customizable themes | React-specific (we use Vue) | Not suitable |
   | **monaco-editor** | Full VS Code experience, inline editing | Very heavy (~2MB), overkill for read-only display | Too heavy |
   | **Custom implementation** | Full control, minimal bundle | Significant development time, edge cases | Not worth the effort |

   **Installation:**
   ```bash
   cd packages/web
   pnpm add diff2html
   ```

   **Component Implementation (`src/components/DiffViewer.vue`):**
   ```vue
   <script setup>
   import { computed } from 'vue';
   import { html } from 'diff2html';
   import 'diff2html/bundles/css/diff2html.min.css';

   const props = defineProps({
     diff: { type: String, required: true },
     outputFormat: { type: String, default: 'line-by-line' }, // or 'side-by-side'
   });

   const diffHtml = computed(() => {
     if (!props.diff) return '';
     return html(props.diff, {
       drawFileList: false,
       matching: 'lines',
       outputFormat: props.outputFormat,
       renderNothingWhenEmpty: true,
     });
   });
   </script>

   <template>
     <div class="diff-viewer" v-html="diffHtml" />
   </template>

   <style>
   .diff-viewer {
     font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
     font-size: 13px;
     line-height: 1.4;
   }
   </style>
   ```

   **Key Features to Implement:**
   - Toggle between unified (line-by-line) and split (side-by-side) views
   - Syntax highlighting for code based on file extension
   - Collapsible file sections for multi-file diffs
   - Line numbers with clickable anchors
   - Color-coded additions (green background) and deletions (red background)
   - "No changes" empty state

   **diff2html Configuration Options:**
   ```javascript
   const diffOptions = {
     outputFormat: 'line-by-line',  // or 'side-by-side'
     drawFileList: true,            // show file list header
     matching: 'lines',             // match similar lines
     matchWordsThreshold: 0.25,     // word match sensitivity
     maxLineLengthHighlight: 10000, // max line length for highlighting
     renderNothingWhenEmpty: true,  // hide component if no diff
   };
   ```

9. **Update SessionDetailView**
   - Add "Changes" tab alongside conversation
   - Tab shows FileChangesTree + DiffViewer
   - Badge on tab showing number of changed files
   - Fetch diff on tab activation, then receive real-time updates

10. **Add to useApi composable**
    ```javascript
    getSessionDiff: (sessionId) =>
      fetchApi(`/sessions/${sessionId}/diff`),

    // Slash Commands
    getCommands: (directory) =>
      fetchApi(`/commands?directory=${encodeURIComponent(directory)}`),

    getCommand: (directory, name) =>
      fetchApi(`/commands/${name}?directory=${encodeURIComponent(directory)}`),

    createCommand: (data) =>
      fetchApi('/commands', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    deleteCommand: (directory, name) =>
      fetchApi(`/commands/${name}?directory=${encodeURIComponent(directory)}`, {
        method: 'DELETE',
      }),

    executeCommand: (name, sessionId, args) =>
      fetchApi(`/commands/${name}/execute`, {
        method: 'POST',
        body: JSON.stringify({ sessionId, arguments: args }),
      }),
    ```

**Deliverables**:
- Real-time diff tracking starts when session starts
- Diffs update automatically as files change (debounced 500ms)
- "Changes" tab shows all file changes since session start
- Clean unified diff display with syntax highlighting

---

### Phase 11: Slash Commands Support

**Goal**: Implement full slash command support including discovery, autocomplete, execution, and custom command management.

**Steps**:

1. **Install gray-matter for frontmatter parsing**
   ```bash
   cd packages/server
   pnpm add gray-matter
   ```

2. **Create SlashCommandService class (`src/services/slashCommandService.js`)**
   ```javascript
   import { readdir, readFile } from 'fs/promises';
   import { join, basename } from 'path';
   import matter from 'gray-matter';
   import { broadcast } from '../websocket.js';

   /**
    * Execution type determines how a command is processed
    * @typedef {'app' | 'prompt' | 'ui'} CommandExecutionType
    * - 'app': Handled by our application (built-in commands like /clear, /model)
    * - 'prompt': Expanded and sent to Claude as a prompt (custom commands)
    * - 'ui': Handled entirely in the UI, no server action (like /help)
    */

   /**
    * @typedef {Object} SlashCommand
    * @property {string} name
    * @property {'builtin' | 'project' | 'user' | 'mcp'} source
    * @property {CommandExecutionType} executionType - How this command should be executed
    * @property {string} [description]
    * @property {string} [argumentHint]
    * @property {string} [content]
    * @property {string} [filePath]
    * @property {string[]} [allowedTools]
    * @property {string} [model]
    * @property {string} [namespace]
    */

   /**
    * Result of executing a command
    * @typedef {Object} CommandExecutionResult
    * @property {boolean} success
    * @property {'app' | 'prompt' | 'ui'} executionType
    * @property {string} [message] - For UI display
    * @property {string} [expandedPrompt] - For prompt-type commands
    * @property {Object} [data] - Additional data (e.g., help content, status info)
    * @property {string} [error]
    */

   // Built-in commands with their execution types
   // 'app' = handled by our backend, 'ui' = handled by frontend only
   const BUILTIN_COMMANDS = [
     { name: 'help', source: 'builtin', executionType: 'ui', description: 'Display help information' },
     { name: 'clear', source: 'builtin', executionType: 'app', description: 'Clear conversation history', argumentHint: '' },
     { name: 'compact', source: 'builtin', executionType: 'app', description: 'Compress conversation to save context', argumentHint: '' },
     { name: 'model', source: 'builtin', executionType: 'app', description: 'Switch AI model', argumentHint: 'model-name (e.g., sonnet, opus)' },
     { name: 'config', source: 'builtin', executionType: 'ui', description: 'Open configuration panel' },
     { name: 'status', source: 'builtin', executionType: 'app', description: 'Show session status and statistics' },
     { name: 'cost', source: 'builtin', executionType: 'app', description: 'Display token usage and costs' },
     { name: 'stop', source: 'builtin', executionType: 'app', description: 'Stop the current session' },
   ];

   class SlashCommandService {
     /** @type {Map<string, SlashCommand[]>} workingDirectory -> commands */
     #commandCache = new Map();

     /**
      * Get all available commands for a working directory
      * @param {string} workingDirectory
      * @returns {Promise<SlashCommand[]>}
      */
     async getCommands(workingDirectory) {
       const commands = [...BUILTIN_COMMANDS];

       // Load project commands (these are always 'prompt' execution type)
       const projectCommands = await this.#loadCommandsFromDir(
         join(workingDirectory, '.claude', 'commands'),
         'project'
       );
       commands.push(...projectCommands);

       // Load user commands
       const homeDir = process.env.HOME || process.env.USERPROFILE;
       if (homeDir) {
         const userCommands = await this.#loadCommandsFromDir(
           join(homeDir, '.claude', 'commands'),
           'user'
         );
         commands.push(...userCommands);
       }

       // Cache for quick lookup
       this.#commandCache.set(workingDirectory, commands);

       return commands;
     }

     /**
      * Get a specific command by name
      * @param {string} workingDirectory
      * @param {string} name
      * @returns {Promise<SlashCommand | undefined>}
      */
     async getCommand(workingDirectory, name) {
       const commands = await this.getCommands(workingDirectory);
       return commands.find(cmd => cmd.name === name);
     }

     /**
      * Load commands from a directory
      * @param {string} dir
      * @param {'project' | 'user'} source
      * @param {string} [namespace]
      * @returns {Promise<SlashCommand[]>}
      */
     async #loadCommandsFromDir(dir, source, namespace = '') {
       const commands = [];

       try {
         const entries = await readdir(dir, { withFileTypes: true });

         for (const entry of entries) {
           const fullPath = join(dir, entry.name);

           if (entry.isDirectory()) {
             // Recurse into subdirectories for namespacing
             const subCommands = await this.#loadCommandsFromDir(
               fullPath,
               source,
               entry.name
             );
             commands.push(...subCommands);
           } else if (entry.name.endsWith('.md')) {
             const command = await this.#parseCommandFile(fullPath, source, namespace);
             if (command) {
               commands.push(command);
             }
           }
         }
       } catch (error) {
         // Directory doesn't exist - that's fine
         if (error.code !== 'ENOENT') {
           console.error(`Error loading commands from ${dir}:`, error);
         }
       }

       return commands;
     }

     /**
      * Parse a command file
      * @param {string} filePath
      * @param {'project' | 'user'} source
      * @param {string} namespace
      * @returns {Promise<SlashCommand | null>}
      */
     async #parseCommandFile(filePath, source, namespace) {
       try {
         const content = await readFile(filePath, 'utf-8');
         const { data: frontmatter, content: body } = matter(content);

         const name = basename(filePath, '.md');

         return {
           name,
           source,
           executionType: 'prompt', // Custom commands are always prompt-type
           description: frontmatter.description,
           argumentHint: frontmatter['argument-hint'],
           content: body.trim(),
           filePath,
           allowedTools: frontmatter['allowed-tools']
             ? [frontmatter['allowed-tools']]
             : undefined,
           model: frontmatter.model,
           namespace: namespace || undefined,
         };
       } catch (error) {
         console.error(`Error parsing command file ${filePath}:`, error);
         return null;
       }
     }

     /**
      * Expand a custom command with arguments
      * @param {SlashCommand} command
      * @param {string} args - Raw arguments string
      * @returns {string} - Expanded prompt
      */
     expandCommand(command, args) {
       if (!command.content) return args;

       let expanded = command.content;

       // Replace $ARGUMENTS with full args string
       expanded = expanded.replace(/\$ARGUMENTS/g, args);

       // Replace positional parameters $1, $2, etc.
       const argParts = args.split(/\s+/).filter(Boolean);
       for (let i = 0; i < argParts.length; i++) {
         expanded = expanded.replace(new RegExp(`\\$${i + 1}`, 'g'), argParts[i]);
       }

       return expanded;
     }

     /**
      * Create a new custom command
      * @param {string} workingDirectory
      * @param {Object} options
      * @param {string} options.name
      * @param {string} options.content
      * @param {string} [options.description]
      * @param {string} [options.argumentHint]
      * @param {boolean} [options.isUserCommand] - Save to ~/.claude/commands instead
      * @returns {Promise<SlashCommand>}
      */
     async createCommand(workingDirectory, options) {
       const { writeFile, mkdir } = await import('fs/promises');

       const baseDir = options.isUserCommand
         ? join(process.env.HOME || process.env.USERPROFILE, '.claude', 'commands')
         : join(workingDirectory, '.claude', 'commands');

       await mkdir(baseDir, { recursive: true });

       // Build frontmatter
       const frontmatter = {};
       if (options.description) frontmatter.description = options.description;
       if (options.argumentHint) frontmatter['argument-hint'] = options.argumentHint;

       // Build file content
       let fileContent = '';
       if (Object.keys(frontmatter).length > 0) {
         fileContent = `---\n`;
         for (const [key, value] of Object.entries(frontmatter)) {
           fileContent += `${key}: ${JSON.stringify(value)}\n`;
         }
         fileContent += `---\n\n`;
       }
       fileContent += options.content;

       const filePath = join(baseDir, `${options.name}.md`);
       await writeFile(filePath, fileContent, 'utf-8');

       // Clear cache and broadcast update
       this.#commandCache.delete(workingDirectory);
       const commands = await this.getCommands(workingDirectory);
       broadcast({ type: 'command:list', commands });

       return commands.find(cmd => cmd.name === options.name);
     }

     /**
      * Delete a custom command
      * @param {string} workingDirectory
      * @param {string} name
      * @returns {Promise<boolean>}
      */
     async deleteCommand(workingDirectory, name) {
       const { unlink } = await import('fs/promises');
       const command = await this.getCommand(workingDirectory, name);

       if (!command || !command.filePath || command.source === 'builtin') {
         return false;
       }

       await unlink(command.filePath);

       // Clear cache and broadcast update
       this.#commandCache.delete(workingDirectory);
       const commands = await this.getCommands(workingDirectory);
       broadcast({ type: 'command:list', commands });

       return true;
     }
   }

   export const slashCommandService = new SlashCommandService();
   ```

3. **Create commands API routes (`src/api/commands.js`)**
   ```javascript
   import { Router } from 'express';
   import { slashCommandService } from '../services/slashCommandService.js';
   import { sessionManager } from '../services/sessionManager.js';
   import { broadcast } from '../websocket.js';

   const router = Router();

   // GET /api/commands?directory=/path/to/project
   router.get('/', async (req, res) => {
     const directory = req.query.directory;
     if (!directory) {
       return res.status(400).json({ error: 'directory query param required' });
     }

     const commands = await slashCommandService.getCommands(directory);
     res.json({ commands });
   });

   // GET /api/commands/:name?directory=/path/to/project
   router.get('/:name', async (req, res) => {
     const directory = req.query.directory;
     if (!directory) {
       return res.status(400).json({ error: 'directory query param required' });
     }

     const command = await slashCommandService.getCommand(directory, req.params.name);
     if (!command) {
       return res.status(404).json({ error: 'Command not found' });
     }

     res.json({ command });
   });

   // POST /api/commands - Create new command
   router.post('/', async (req, res) => {
     const { directory, name, content, description, argumentHint, isUserCommand } = req.body;

     if (!directory || !name || !content) {
       return res.status(400).json({ error: 'directory, name, and content required' });
     }

     try {
       const command = await slashCommandService.createCommand(directory, {
         name,
         content,
         description,
         argumentHint,
         isUserCommand,
       });
       res.status(201).json({ command });
     } catch (error) {
       res.status(500).json({ error: 'Failed to create command' });
     }
   });

   // DELETE /api/commands/:name?directory=/path/to/project
   router.delete('/:name', async (req, res) => {
     const directory = req.query.directory;
     if (!directory) {
       return res.status(400).json({ error: 'directory query param required' });
     }

     const success = await slashCommandService.deleteCommand(directory, req.params.name);
     if (!success) {
       return res.status(404).json({ error: 'Command not found or cannot be deleted' });
     }

     res.json({ success: true });
   });

   // POST /api/commands/:name/execute - Execute command in session
   // Handles different execution types: 'app', 'prompt', 'ui'
   router.post('/:name/execute', async (req, res) => {
     const { sessionId, arguments: args } = req.body;
     const session = sessionManager.getSession(sessionId);

     if (!session) {
       return res.status(404).json({ error: 'Session not found' });
     }

     const command = await slashCommandService.getCommand(
       session.workingDirectory,
       req.params.name
     );

     if (!command) {
       return res.status(404).json({ error: 'Command not found' });
     }

     // Handle based on execution type
     switch (command.executionType) {
       case 'ui':
         // UI commands are handled client-side, just acknowledge
         return res.json({
           success: true,
           executionType: 'ui',
           message: `Command /${command.name} should be handled by the UI`,
         });

       case 'app':
         // Built-in commands handled by our application
         let result;
         switch (command.name) {
           case 'clear':
             result = sessionManager.clearHistory(sessionId);
             break;
           case 'model':
             result = sessionManager.setModel(sessionId, args || '');
             break;
           case 'status':
             result = sessionManager.getStatus(sessionId);
             break;
           case 'cost':
             result = sessionManager.getCost(sessionId);
             break;
           case 'compact':
             result = sessionManager.compactHistory(sessionId);
             break;
           case 'stop':
             result = { success: sessionManager.stopSession(sessionId) };
             break;
           default:
             result = { success: false, error: `Unknown app command: ${command.name}` };
         }
         return res.json({ ...result, executionType: 'app' });

       case 'prompt':
         // Custom commands - expand and send to Claude
         const expandedPrompt = slashCommandService.expandCommand(command, args || '');
         const success = sessionManager.sendMessage(sessionId, expandedPrompt);

         if (!success) {
           return res.status(400).json({
             success: false,
             error: 'Session not waiting for input',
           });
         }

         // Broadcast that a command was executed
         broadcast({
           type: 'command:executed',
           sessionId,
           commandName: command.name,
           arguments: args,
         });

         return res.json({
           success: true,
           executionType: 'prompt',
           expandedPrompt,
         });

       default:
         return res.status(400).json({
           success: false,
           error: `Unknown execution type: ${command.executionType}`,
         });
     }
   });

   export default router;
   ```

4. **Create Commands store (`src/stores/commands.js`)**
   ```javascript
   import { defineStore } from 'pinia';
   import { ref, computed } from 'vue';
   import { useApi } from '../composables/useApi.js';
   import { useWebSocket } from '../composables/useWebSocket.js';

   export const useCommandsStore = defineStore('commands', () => {
     const api = useApi();
     const { onMessage } = useWebSocket();

     const commands = ref([]);
     const loading = ref(false);

     // Computed getters
     const builtinCommands = computed(() =>
       commands.value.filter(cmd => cmd.source === 'builtin')
     );

     const projectCommands = computed(() =>
       commands.value.filter(cmd => cmd.source === 'project')
     );

     const userCommands = computed(() =>
       commands.value.filter(cmd => cmd.source === 'user')
     );

     // Actions
     async function fetchCommands(directory) {
       loading.value = true;
       try {
         const result = await api.getCommands(directory);
         commands.value = result.commands;
       } finally {
         loading.value = false;
       }
     }

     function filterCommands(query) {
       if (!query) return commands.value;
       const lowerQuery = query.toLowerCase();
       return commands.value.filter(cmd =>
         cmd.name.toLowerCase().includes(lowerQuery) ||
         cmd.description?.toLowerCase().includes(lowerQuery)
       );
     }

     // WebSocket handler
     onMessage((msg) => {
       if (msg.type === 'command:list') {
         commands.value = msg.commands;
       }
     });

     return {
       commands,
       loading,
       builtinCommands,
       projectCommands,
       userCommands,
       fetchCommands,
       filterCommands,
     };
   });
   ```

5. **Create CommandPalette component**
   - Trigger on `/` keystroke in MessageInput
   - Show filtered list of commands as user types
   - Display command name, description, source badge
   - Keyboard navigation (arrow keys, Enter to select)
   - Insert selected command into input

6. **Create CommandsView**
   - List all available commands grouped by source
   - Show command details on click
   - "New Command" button opens CommandEditor
   - Delete button for custom commands

7. **Create CommandEditor component**
   - Form fields: name, description, argument-hint, content
   - Toggle for project vs user command
   - Markdown preview for content
   - Save/cancel buttons

8. **Update MessageInput component**
   - Detect `/` at start of input
   - Show CommandPalette overlay
   - Handle command selection and argument input
   - Execute command on submit

**Deliverables**:
- Full slash command discovery from file system
- Command palette with autocomplete
- Custom command creation/editing UI
- Command execution with argument substitution
- Real-time command list updates via WebSocket

---

### Phase 12: Polish and Documentation

**Goal**: Final polish, error handling, and user documentation.

**Steps**:

1. **Error handling**
   - Add error boundaries in Vue
   - Graceful handling of WebSocket disconnects
   - User-friendly error messages
   - Retry logic for failed requests

2. **Loading states**
   - Skeleton loaders for session list
   - Spinner for session detail loading
   - Progress indicator for message sending

3. **Empty states**
   - No sessions yet - prompt to create one
   - No messages in session - show waiting indicator
   - Empty toolbox - explain how to use

4. **README.md**
   - Quick start guide
   - Feature overview
   - API documentation for Claude Code usage
   - Screenshots

5. **Example usage documentation**
   - How to add items to toolbox from Claude Code
   - How to integrate with Playwright tests
   - How to share documents

**Deliverables**:
- Polished, production-ready application
- Comprehensive documentation
- Good error handling and UX

---

### Phase 13: Session Notes

**Goal**: Allow users to add, edit, and view notes on sessions. Notes provide a way to capture context, decisions, or reminders about a session that aren't part of the conversation.

**Steps**:

1. **Update Session type to include notes (`packages/shared/src/types.js`)**
   ```javascript
   /**
    * A note attached to a session
    * @typedef {Object} SessionNote
    * @property {string} id
    * @property {string} content - Markdown content
    * @property {number} createdAt - Unix timestamp
    * @property {number} updatedAt - Unix timestamp
    */

   /**
    * A Claude Code session
    * @typedef {Object} Session
    * @property {string} id
    * @property {string} name - User-provided or auto-generated
    * @property {SessionStatus} status
    * @property {string} workingDirectory - Absolute path
    * @property {string} [gitBranch] - Current branch if in git repo
    * @property {string} [gitWorktree] - Worktree name if applicable
    * @property {number} createdAt - Unix timestamp
    * @property {number} updatedAt - Last activity timestamp
    * @property {ConversationMessage[]} messages - Full conversation history
    * @property {SessionNote[]} notes - Notes attached to this session
    * @property {string} [prUrl] - URL of linked pull request
    * @property {string} [error] - Error message if status is 'error'
    */
   ```

2. **Add notes WebSocket messages (`packages/shared/src/protocol.js`)**
   ```javascript
   /**
    * Note added to session
    * @typedef {Object} WsSessionNoteAddedMessage
    * @property {'session:note:added'} type
    * @property {string} sessionId
    * @property {SessionNote} note
    */

   /**
    * Note updated in session
    * @typedef {Object} WsSessionNoteUpdatedMessage
    * @property {'session:note:updated'} type
    * @property {string} sessionId
    * @property {SessionNote} note
    */

   /**
    * Note deleted from session
    * @typedef {Object} WsSessionNoteDeletedMessage
    * @property {'session:note:deleted'} type
    * @property {string} sessionId
    * @property {string} noteId
    */

   /**
    * PR URL updated for session
    * @typedef {Object} WsSessionPrUrlUpdatedMessage
    * @property {'session:pr-url:updated'} type
    * @property {string} sessionId
    * @property {string | null} prUrl - The PR URL or null if removed
    */
   ```

3. **Add notes methods to SessionManager (`src/services/sessionManager.js`)**
   ```javascript
   /**
    * Add a note to a session
    * @param {string} sessionId
    * @param {string} content - Markdown content
    * @returns {SessionNote | null}
    */
   addNote(sessionId, content) {
     const activeSession = this.#sessions.get(sessionId);
     if (!activeSession) return null;

     const note = {
       id: randomUUID(),
       content,
       createdAt: Date.now(),
       updatedAt: Date.now(),
     };

     if (!activeSession.session.notes) {
       activeSession.session.notes = [];
     }
     activeSession.session.notes.push(note);
     activeSession.session.updatedAt = Date.now();

     broadcast({
       type: 'session:note:added',
       sessionId,
       note,
     });

     return note;
   }

   /**
    * Update an existing note
    * @param {string} sessionId
    * @param {string} noteId
    * @param {string} content - New markdown content
    * @returns {SessionNote | null}
    */
   updateNote(sessionId, noteId, content) {
     const activeSession = this.#sessions.get(sessionId);
     if (!activeSession || !activeSession.session.notes) return null;

     const note = activeSession.session.notes.find(n => n.id === noteId);
     if (!note) return null;

     note.content = content;
     note.updatedAt = Date.now();
     activeSession.session.updatedAt = Date.now();

     broadcast({
       type: 'session:note:updated',
       sessionId,
       note,
     });

     return note;
   }

   /**
    * Delete a note from a session
    * @param {string} sessionId
    * @param {string} noteId
    * @returns {boolean}
    */
   deleteNote(sessionId, noteId) {
     const activeSession = this.#sessions.get(sessionId);
     if (!activeSession || !activeSession.session.notes) return false;

     const index = activeSession.session.notes.findIndex(n => n.id === noteId);
     if (index === -1) return false;

     activeSession.session.notes.splice(index, 1);
     activeSession.session.updatedAt = Date.now();

     broadcast({
       type: 'session:note:deleted',
       sessionId,
       noteId,
     });

     return true;
   }

   /**
    * Get all notes for a session
    * @param {string} sessionId
    * @returns {SessionNote[] | null}
    */
   getNotes(sessionId) {
     const activeSession = this.#sessions.get(sessionId);
     if (!activeSession) return null;
     return activeSession.session.notes || [];
   }

   /**
    * Set or clear the PR URL for a session
    * @param {string} sessionId
    * @param {string | null} prUrl - The PR URL or null to clear
    * @returns {boolean} - true if successful
    */
   setPrUrl(sessionId, prUrl) {
     const activeSession = this.#sessions.get(sessionId);
     if (!activeSession) return false;

     activeSession.session.prUrl = prUrl || null;
     activeSession.session.updatedAt = Date.now();

     broadcast({
       type: 'session:pr-url:updated',
       sessionId,
       prUrl: activeSession.session.prUrl,
     });

     return true;
   }

   /**
    * Get the PR URL for a session
    * @param {string} sessionId
    * @returns {string | null}
    */
   getPrUrl(sessionId) {
     const activeSession = this.#sessions.get(sessionId);
     if (!activeSession) return null;
     return activeSession.session.prUrl || null;
   }
   ```

4. **Add notes API routes (`src/api/sessions.js`)**
   ```javascript
   // GET /api/sessions/:id/notes - List all notes for a session
   router.get('/:id/notes', (req, res) => {
     const notes = sessionManager.getNotes(req.params.id);
     if (notes === null) {
       return res.status(404).json({ error: 'Session not found' });
     }
     res.json({ notes });
   });

   // POST /api/sessions/:id/notes - Add a note to a session
   router.post('/:id/notes', (req, res) => {
     const { content } = req.body;

     if (!content) {
       return res.status(400).json({ error: 'content is required' });
     }

     const note = sessionManager.addNote(req.params.id, content);
     if (!note) {
       return res.status(404).json({ error: 'Session not found' });
     }
     res.status(201).json({ note });
   });

   // PUT /api/sessions/:id/notes/:noteId - Update a note
   router.put('/:id/notes/:noteId', (req, res) => {
     const { content } = req.body;

     if (!content) {
       return res.status(400).json({ error: 'content is required' });
     }

     const note = sessionManager.updateNote(req.params.id, req.params.noteId, content);
     if (!note) {
       return res.status(404).json({ error: 'Session or note not found' });
     }
     res.json({ note });
   });

   // DELETE /api/sessions/:id/notes/:noteId - Delete a note
   router.delete('/:id/notes/:noteId', (req, res) => {
     const success = sessionManager.deleteNote(req.params.id, req.params.noteId);
     if (!success) {
       return res.status(404).json({ error: 'Session or note not found' });
     }
     res.json({ success: true });
   });

   // GET /api/sessions/:id/pr-url - Get the PR URL for a session
   router.get('/:id/pr-url', (req, res) => {
     const session = sessionManager.getSession(req.params.id);
     if (!session) {
       return res.status(404).json({ error: 'Session not found' });
     }
     res.json({ prUrl: session.prUrl || null });
   });

   // PUT /api/sessions/:id/pr-url - Set or update the PR URL for a session
   router.put('/:id/pr-url', (req, res) => {
     const { prUrl } = req.body;

     const success = sessionManager.setPrUrl(req.params.id, prUrl);
     if (!success) {
       return res.status(404).json({ error: 'Session not found' });
     }
     res.json({ prUrl: prUrl || null });
   });

   // DELETE /api/sessions/:id/pr-url - Remove the PR URL from a session
   router.delete('/:id/pr-url', (req, res) => {
     const success = sessionManager.setPrUrl(req.params.id, null);
     if (!success) {
       return res.status(404).json({ error: 'Session not found' });
     }
     res.json({ success: true });
   });
   ```

5. **Create notes store (`src/stores/notes.js`)**
   ```javascript
   import { defineStore } from 'pinia';
   import { ref, computed } from 'vue';
   import { useApi } from '../composables/useApi.js';
   import { useWebSocket } from '../composables/useWebSocket.js';

   export const useNotesStore = defineStore('notes', () => {
     const api = useApi();
     const { onMessage } = useWebSocket();

     // Map of sessionId -> notes array
     const notesBySession = ref(new Map());
     const loading = ref(false);
     const error = ref(null);

     async function fetchNotes(sessionId) {
       loading.value = true;
       error.value = null;
       try {
         const result = await api.getSessionNotes(sessionId);
         notesBySession.value.set(sessionId, result.notes);
       } catch (e) {
         error.value = e.message;
       } finally {
         loading.value = false;
       }
     }

     async function addNote(sessionId, content) {
       try {
         const result = await api.addSessionNote(sessionId, content);
         const notes = notesBySession.value.get(sessionId) || [];
         notes.push(result.note);
         notesBySession.value.set(sessionId, notes);
         return result.note;
       } catch (e) {
         error.value = e.message;
         throw e;
       }
     }

     async function updateNote(sessionId, noteId, content) {
       try {
         const result = await api.updateSessionNote(sessionId, noteId, content);
         const notes = notesBySession.value.get(sessionId) || [];
         const index = notes.findIndex(n => n.id === noteId);
         if (index !== -1) {
           notes[index] = result.note;
         }
         return result.note;
       } catch (e) {
         error.value = e.message;
         throw e;
       }
     }

     async function deleteNote(sessionId, noteId) {
       try {
         await api.deleteSessionNote(sessionId, noteId);
         const notes = notesBySession.value.get(sessionId) || [];
         const index = notes.findIndex(n => n.id === noteId);
         if (index !== -1) {
           notes.splice(index, 1);
         }
       } catch (e) {
         error.value = e.message;
         throw e;
       }
     }

     function getNotes(sessionId) {
       return notesBySession.value.get(sessionId) || [];
     }

     // WebSocket handlers for real-time updates
     onMessage((msg) => {
       if (msg.type === 'session:note:added') {
         const notes = notesBySession.value.get(msg.sessionId) || [];
         notes.push(msg.note);
         notesBySession.value.set(msg.sessionId, notes);
       } else if (msg.type === 'session:note:updated') {
         const notes = notesBySession.value.get(msg.sessionId) || [];
         const index = notes.findIndex(n => n.id === msg.note.id);
         if (index !== -1) {
           notes[index] = msg.note;
         }
       } else if (msg.type === 'session:note:deleted') {
         const notes = notesBySession.value.get(msg.sessionId) || [];
         const index = notes.findIndex(n => n.id === msg.noteId);
         if (index !== -1) {
           notes.splice(index, 1);
         }
       }
     });

     return {
       notesBySession,
       loading,
       error,
       fetchNotes,
       addNote,
       updateNote,
       deleteNote,
       getNotes,
     };
   });
   ```

6. **Create SessionNotes component (`src/components/SessionNotes.vue`)**
   ```vue
   <script setup>
   import { ref, onMounted, computed } from 'vue';
   import { useNotesStore } from '../stores/notes.js';

   const props = defineProps({
     sessionId: { type: String, required: true },
   });

   const notesStore = useNotesStore();
   const newNoteContent = ref('');
   const editingNoteId = ref(null);
   const editContent = ref('');

   const notes = computed(() => notesStore.getNotes(props.sessionId));

   onMounted(() => {
     notesStore.fetchNotes(props.sessionId);
   });

   async function handleAddNote() {
     if (!newNoteContent.value.trim()) return;
     await notesStore.addNote(props.sessionId, newNoteContent.value);
     newNoteContent.value = '';
   }

   function startEditing(note) {
     editingNoteId.value = note.id;
     editContent.value = note.content;
   }

   async function saveEdit(noteId) {
     if (!editContent.value.trim()) return;
     await notesStore.updateNote(props.sessionId, noteId, editContent.value);
     editingNoteId.value = null;
     editContent.value = '';
   }

   function cancelEdit() {
     editingNoteId.value = null;
     editContent.value = '';
   }

   async function handleDeleteNote(noteId) {
     if (confirm('Are you sure you want to delete this note?')) {
       await notesStore.deleteNote(props.sessionId, noteId);
     }
   }

   function formatDate(timestamp) {
     return new Date(timestamp).toLocaleString();
   }
   </script>

   <template>
     <div class="session-notes">
       <h3>Notes</h3>

       <!-- Add note form -->
       <div class="add-note">
         <textarea
           v-model="newNoteContent"
           placeholder="Add a note..."
           rows="3"
         />
         <button @click="handleAddNote" :disabled="!newNoteContent.trim()">
           Add Note
         </button>
       </div>

       <!-- Notes list -->
       <div class="notes-list">
         <div v-if="notes.length === 0" class="empty-state">
           No notes yet. Add a note to capture context or reminders about this session.
         </div>

         <div v-for="note in notes" :key="note.id" class="note-card">
           <template v-if="editingNoteId === note.id">
             <textarea v-model="editContent" rows="3" />
             <div class="note-actions">
               <button @click="saveEdit(note.id)">Save</button>
               <button @click="cancelEdit">Cancel</button>
             </div>
           </template>
           <template v-else>
             <div class="note-content" v-html="note.content" />
             <div class="note-meta">
               <span class="note-date">{{ formatDate(note.updatedAt) }}</span>
               <div class="note-actions">
                 <button @click="startEditing(note)">Edit</button>
                 <button @click="handleDeleteNote(note.id)" class="delete">Delete</button>
               </div>
             </div>
           </template>
         </div>
       </div>
     </div>
   </template>

   <style scoped>
   .session-notes {
     padding: 1rem;
   }

   .add-note {
     margin-bottom: 1rem;
   }

   .add-note textarea {
     width: 100%;
     padding: 0.5rem;
     border: 1px solid #ddd;
     border-radius: 4px;
     margin-bottom: 0.5rem;
     font-family: inherit;
   }

   .notes-list {
     display: flex;
     flex-direction: column;
     gap: 0.75rem;
   }

   .note-card {
     padding: 0.75rem;
     border: 1px solid #e0e0e0;
     border-radius: 4px;
     background: #fafafa;
   }

   .note-content {
     margin-bottom: 0.5rem;
     white-space: pre-wrap;
   }

   .note-meta {
     display: flex;
     justify-content: space-between;
     align-items: center;
     font-size: 0.85rem;
     color: #666;
   }

   .note-actions {
     display: flex;
     gap: 0.5rem;
   }

   .note-actions button {
     padding: 0.25rem 0.5rem;
     font-size: 0.85rem;
     cursor: pointer;
   }

   .note-actions button.delete {
     color: #d32f2f;
   }

   .empty-state {
     color: #666;
     font-style: italic;
     padding: 1rem;
     text-align: center;
   }
   </style>
   ```

7. **Update SessionDetailView to include notes section**
   - Import and add `<SessionNotes :session-id="session.id" />` component
   - Display notes section below or alongside the conversation view

8. **Update useApi composable with notes methods**
   ```javascript
   // Add to useApi.js
   async function getSessionNotes(sessionId) {
     const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/notes`);
     return response.json();
   }

   async function addSessionNote(sessionId, content) {
     const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/notes`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ content }),
     });
     return response.json();
   }

   async function updateSessionNote(sessionId, noteId, content) {
     const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/notes/${noteId}`, {
       method: 'PUT',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ content }),
     });
     return response.json();
   }

   async function deleteSessionNote(sessionId, noteId) {
     const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/notes/${noteId}`, {
       method: 'DELETE',
     });
     return response.json();
   }

   async function getSessionPrUrl(sessionId) {
     const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/pr-url`);
     return response.json();
   }

   async function setSessionPrUrl(sessionId, prUrl) {
     const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/pr-url`, {
       method: 'PUT',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ prUrl }),
     });
     return response.json();
   }

   async function deleteSessionPrUrl(sessionId) {
     const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/pr-url`, {
       method: 'DELETE',
     });
     return response.json();
   }
   ```

9. **Display PR link in SessionDetailView**
   - Show the PR URL as a clickable link when present
   - Provide an "Add PR Link" button when no PR is linked
   - Allow editing/removing the PR link
   - The PR link should be prominently displayed in the session header/metadata area

**Deliverables**:
- Users can add notes to any session
- Notes are displayed on the session detail/show view
- Notes support markdown content
- Notes can be edited and deleted
- Real-time sync via WebSocket when notes are modified
- Notes persist with the session
- Users can link a PR URL to any session
- PR URL is displayed as a clickable link on the session detail view
- PR link can be added, updated, or removed
- Real-time sync via WebSocket when PR URL is modified

---

## API Specification

### Sessions API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions` | List all sessions |
| POST | `/api/sessions` | Create new session |
| GET | `/api/sessions/:id` | Get session details |
| POST | `/api/sessions/:id/message` | Send message to session |
| POST | `/api/sessions/:id/stop` | Stop a running session |
| GET | `/api/sessions/:id/diff` | Get current git diff for session |
| DELETE | `/api/sessions/:id` | Delete a session |
| GET | `/api/sessions/:id/notes` | List all notes for a session |
| POST | `/api/sessions/:id/notes` | Add a note to a session |
| PUT | `/api/sessions/:id/notes/:noteId` | Update a note |
| DELETE | `/api/sessions/:id/notes/:noteId` | Delete a note |
| GET | `/api/sessions/:id/pr-url` | Get the PR URL for a session |
| PUT | `/api/sessions/:id/pr-url` | Set or update the PR URL |
| DELETE | `/api/sessions/:id/pr-url` | Remove the PR URL |

### Toolbox API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/toolbox` | List all toolbox items |
| POST | `/api/toolbox` | Add item (JSON or multipart) |
| GET | `/api/toolbox/:id` | Get single item |
| DELETE | `/api/toolbox/:id` | Remove item |
| DELETE | `/api/toolbox` | Clear all items |

### Git API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/git/worktrees` | List git worktrees |
| GET | `/api/git/branches` | List git branches |
| GET | `/api/git/current-branch` | Get current branch |
| POST | `/api/git/worktrees` | Create new worktree |

### Slash Commands API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/commands` | List all available slash commands |
| GET | `/api/commands/:name` | Get single command details |
| POST | `/api/commands` | Create new custom command |
| PUT | `/api/commands/:name` | Update existing command |
| DELETE | `/api/commands/:name` | Delete custom command |
| POST | `/api/commands/:name/execute` | Execute a slash command in a session |

---

## WebSocket Protocol

### Connection

Connect to `ws://localhost:3000/ws`

### Server → Client Messages

```javascript
// Session list updated
{ type: 'session:list', sessions: [SessionSummary] }

// Session status changed
{ type: 'session:status', sessionId: 'string', status: 'SessionStatus', error: 'string?' }

// New message in conversation
{ type: 'session:message', sessionId: 'string', message: ConversationMessage }

// Streaming content
{ type: 'session:stream', sessionId: 'string', messageId: 'string', delta: 'string' }

// Session diff updated (real-time file changes)
{ type: 'session:diff', sessionId: 'string', files: [{ path: 'string', status: 'M|A|D|R|C|U' }], diff: 'string' }

// Session conversation cleared (via /clear command)
{ type: 'session:cleared', sessionId: 'string' }

// Session model changed (via /model command)
{ type: 'session:model-changed', sessionId: 'string', model: 'string' }

// Slash command executed
{ type: 'command:executed', sessionId: 'string', commandName: 'string', arguments: 'string?' }

// Slash commands list updated (when commands are created/deleted)
{ type: 'command:list', commands: [SlashCommand] }

// Note added to session
{ type: 'session:note:added', sessionId: 'string', note: SessionNote }

// Note updated in session
{ type: 'session:note:updated', sessionId: 'string', note: SessionNote }

// Note deleted from session
{ type: 'session:note:deleted', sessionId: 'string', noteId: 'string' }

// PR URL updated for session
{ type: 'session:pr-url:updated', sessionId: 'string', prUrl: 'string | null' }

// Toolbox item added
{ type: 'toolbox:add', item: ToolboxItem }

// Toolbox item removed
{ type: 'toolbox:remove', itemId: 'string' }

// Toolbox cleared
{ type: 'toolbox:clear' }
```

### Client → Server Messages

```javascript
// Subscribe to session updates (future use)
{ type: 'subscribe:session', sessionId: 'string' }

// Unsubscribe from session
{ type: 'unsubscribe:session', sessionId: 'string' }
```

---

## Data Models

See the [Shared Types and Protocol](#phase-3-shared-types-and-protocol) section for complete JSDoc type definitions.

---

## Slash Commands

Slash commands are a core feature of Claude Code that allow users to trigger specific workflows and behaviors with a simple `/command-name` syntax. claudetools.io must support both built-in and custom slash commands to provide a complete Claude Code experience.

### What are Slash Commands?

Slash commands are directives that control Claude's behavior during a session. They range from built-in system commands to custom user-defined prompts stored as Markdown files.

**Types of Commands:**

1. **Built-in Commands** - System commands provided by Claude Code (e.g., `/help`, `/clear`, `/model`)
2. **Project Commands** - Custom commands in `.claude/commands/` directory, shared with the team
3. **Personal Commands** - Custom commands in `~/.claude/commands/`, private to the user
4. **MCP Commands** - Commands exposed by MCP (Model Context Protocol) servers

### Command File Structure

Custom slash commands are Markdown files with optional YAML frontmatter:

```markdown
---
description: Brief description of what the command does
argument-hint: "issue-number (required), priority (optional)"
allowed-tools: Bash(enabled)
model: claude-sonnet-4-5
---

Your prompt content here. This instruction executes when the command is invoked.

Fix issue #$ARGUMENTS by:
1. Understanding the ticket
2. Locating relevant code
3. Implementing the solution
4. Adding tests
```

### Frontmatter Fields

| Field | Required | Purpose | Example |
|-------|----------|---------|---------|
| `description` | For programmatic use | Brief command overview | `"Review a pull request"` |
| `argument-hint` | No | Guidance for expected arguments | `"issue-number (required)"` |
| `allowed-tools` | No | Permitted tools (inherits by default) | `Bash(enabled)` |
| `model` | No | Override model for this command | `claude-sonnet-4-5` |

### Command Storage Locations

```
# Project commands (shared with team via git)
.claude/commands/
├── fix-issue.md          → /fix-issue
├── optimize.md           → /optimize
└── frontend/
    └── component.md      → /component (labeled "project:frontend")

# Personal commands (user's home directory)
~/.claude/commands/
├── security-review.md    → /security-review (labeled "user")
└── my-workflow.md        → /my-workflow (labeled "user")
```

### Argument Handling

Commands support multiple argument approaches:

**1. Capture All Arguments (`$ARGUMENTS`)**
```markdown
Fix issue #$ARGUMENTS
```
Usage: `/fix-issue 123` → `Fix issue #123`

**2. Positional Parameters (`$1`, `$2`, etc.)**
```markdown
Create a $1 component using $2
```
Usage: `/create Button react` → `Create a Button component using react`

### Built-in Commands Reference

| Category | Commands |
|----------|----------|
| **Conversation** | `/clear`, `/compact`, `/resume`, `/rewind` |
| **Configuration** | `/config`, `/model`, `/settings`, `/status` |
| **Development** | `/review`, `/security-review`, `/bug`, `/sandbox` |
| **Information** | `/help`, `/context`, `/cost`, `/stats`, `/usage` |
| **Account** | `/login`, `/logout`, `/permissions` |

### SlashCommand Data Model

```javascript
/**
 * A slash command definition
 * @typedef {Object} SlashCommand
 * @property {string} name - Command name without leading slash
 * @property {'builtin' | 'project' | 'user' | 'mcp'} source - Where command originates
 * @property {string} [description] - Brief description
 * @property {string} [argumentHint] - Expected arguments hint
 * @property {string} [content] - Full prompt content (for custom commands)
 * @property {string} [filePath] - Path to command file (for custom commands)
 * @property {string[]} [allowedTools] - Tool permissions
 * @property {string} [model] - Model override
 * @property {string} [namespace] - Subdirectory namespace (e.g., "frontend")
 */
```

### Command Execution Types

Commands have different execution types that determine how they are processed:

| Type | Description | Examples | Handled By |
|------|-------------|----------|------------|
| `prompt` | Expanded and sent to Claude as a prompt | Custom commands (`/fix-issue`, `/review`) | Claude via SDK |
| `app` | Handled by our application backend | `/clear`, `/model`, `/status`, `/cost` | SessionManager |
| `ui` | Handled entirely in the frontend UI | `/help`, `/config` | Vue components |

### SDK Integration for Slash Commands

**Important**: Built-in slash commands are CLI features, not SDK features. When using the Claude Agent SDK:

1. **Custom Commands (prompt type)** - Work normally. The command content is expanded with arguments and sent as a prompt to Claude via `sessionManager.sendMessage()`.

2. **Built-in Commands (app type)** - Must be handled by our application:
   - `/clear` → `sessionManager.clearHistory()` - Clears conversation messages
   - `/model` → `sessionManager.setModel()` - Changes the model for future queries
   - `/status` → `sessionManager.getStatus()` - Returns session statistics
   - `/cost` → `sessionManager.getCost()` - Returns token usage info
   - `/compact` → SDK handles automatically when context limits approach
   - `/stop` → `sessionManager.stopSession()` - Aborts the current query

3. **UI Commands** - Never sent to the server, handled by frontend components.

```
┌─────────────────────────────────────────────────────────────┐
│                  Command Execution Flow                      │
└─────────────────────────────────────────────────────────────┘

User types: /command args
        │
        ▼
┌───────────────────┐
│ CommandPalette    │ ◄── Autocomplete suggestions
│ (Frontend)        │
└───────┬───────────┘
        │
        ▼
┌───────────────────┐     ┌─────────────────────────────────┐
│ Check execution   │────▶│ UI type? Handle in frontend     │
│ type              │     │ (show help panel, open config)  │
└───────┬───────────┘     └─────────────────────────────────┘
        │
        ▼
┌───────────────────┐
│ POST /api/commands│
│ /:name/execute    │
└───────┬───────────┘
        │
        ▼
┌───────────────────┐     ┌─────────────────────────────────┐
│ App type?         │────▶│ Call SessionManager method      │
│                   │     │ (clearHistory, setModel, etc.)  │
└───────┬───────────┘     └─────────────────────────────────┘
        │
        ▼
┌───────────────────┐     ┌─────────────────────────────────┐
│ Prompt type?      │────▶│ Expand with args, send to       │
│                   │     │ Claude via sendMessage()        │
└───────────────────┘     └─────────────────────────────────┘
```

### Implementation in claudetools.io

The web interface should:

1. **Discover Commands** - Scan `.claude/commands/` in the session's working directory and `~/.claude/commands/` for user commands
2. **Parse Frontmatter** - Extract metadata from YAML frontmatter in command files
3. **Command Palette** - Provide autocomplete when user types `/` in the message input
4. **Route by Execution Type** - Check `executionType` and handle appropriately:
   - `ui`: Handle in frontend (show help, open settings)
   - `app`: Call backend API which invokes SessionManager methods
   - `prompt`: Expand and send to Claude
5. **Create/Edit Commands** - Allow users to create and modify custom commands through the UI
6. **Display Source** - Show whether command is built-in, project, or user-defined

---

## Security Considerations

### Local-Only by Default

- Server binds to `localhost` only
- No authentication required for local use
- All data stays on user's machine

### Future Remote Access

When scaling to remote access, consider:

1. **Authentication** - Add API key or OAuth
2. **HTTPS** - Use TLS for all connections
3. **Rate limiting** - Prevent abuse
4. **Input validation** - Sanitize all inputs
5. **File size limits** - Prevent DoS via large uploads

### Toolbox Security

- Validate file types on upload
- Limit file sizes (default 10MB)
- Sanitize filenames
- Don't execute uploaded content

---

## Future Scaling

### Remote Claude Code

For Claude Code running on a different machine:

1. **Tunneling** - Use Cloudflare Tunnel or ngrok to expose local server
2. **Hosted relay** - Central WebSocket relay service
3. **Direct connection** - User runs claudetools on same machine as Claude

### Multi-User Support

For shared instances:

1. **Session isolation** - Each user sees only their sessions
2. **Authentication** - User accounts or API keys
3. **Namespacing** - Separate toolbox per user/session

### Persistence

Current design is in-memory. For persistence:

1. **SQLite** - Local database for sessions and toolbox
2. **File system** - Store toolbox items as files
3. **Cloud storage** - S3/GCS for remote deployment

---

## Appendix: Example Curl Commands

### Toolbox Operations

```bash
# Add screenshot
curl -X POST http://localhost:3000/api/toolbox \
  -F "file=@screenshot.png" \
  -F "label=Login page failure"

# Add markdown plan
curl -X POST http://localhost:3000/api/toolbox \
  -H "Content-Type: application/json" \
  -d '{
    "type": "markdown",
    "content": "# Plan\n\n1. Fix auth\n2. Add tests",
    "label": "Implementation Plan"
  }'

# Add test results JSON
curl -X POST http://localhost:3000/api/toolbox \
  -H "Content-Type: application/json" \
  -d '{
    "type": "json",
    "data": {"total": 50, "passed": 48, "failed": 2},
    "label": "Test Results"
  }'

# Clear toolbox
curl -X DELETE http://localhost:3000/api/toolbox
```

### Session Operations

```bash
# List sessions
curl http://localhost:3000/api/sessions

# Get session details
curl http://localhost:3000/api/sessions/{id}

# Send message (if session is waiting)
curl -X POST http://localhost:3000/api/sessions/{id}/message \
  -H "Content-Type: application/json" \
  -d '{"content": "Yes, proceed with the refactoring"}'
```
