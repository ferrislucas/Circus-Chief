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
14. [Security Considerations](#security-considerations)
15. [Future Scaling](#future-scaling)

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
    │       │   └── git.js          # Git information endpoints
    │       │
    │       └── services/           # Business logic
    │           ├── sessionManager.js    # Claude session orchestration
    │           ├── toolboxStore.js      # Toolbox item storage
    │           └── gitService.js        # Git operations
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
    │       │   └── toolbox.js      # Toolbox state management
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
    │       │   └── ToolboxView.vue      # Toolbox item display
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
    │       │   └── GitBranchSelector.vue     # Branch dropdown
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

### Phase 10: Polish and Documentation

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

## API Specification

### Sessions API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions` | List all sessions |
| POST | `/api/sessions` | Create new session |
| GET | `/api/sessions/:id` | Get session details |
| POST | `/api/sessions/:id/message` | Send message to session |
| POST | `/api/sessions/:id/stop` | Stop a running session |
| DELETE | `/api/sessions/:id` | Delete a session |

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
