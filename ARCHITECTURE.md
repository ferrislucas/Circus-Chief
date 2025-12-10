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

- **TypeScript interfaces** used by both server and frontend
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
| **TypeScript 5+** | Language | Type safety, better developer experience |
| **Express 4** | HTTP framework | Simple, well-documented, huge ecosystem |
| **ws** | WebSocket library | Lightweight, no dependencies, battle-tested |
| **@anthropic-ai/claude-agent-sdk** | Claude integration | Official SDK for programmatic Claude Code control |
| **tsx** | Development runner | Fast TypeScript execution without build step |

### Frontend

| Technology | Purpose | Why This Choice |
|------------|---------|-----------------|
| **Vue 3** | UI framework | User preference, excellent composition API |
| **Vite** | Build tool | Fast HMR, native ES modules, excellent DX |
| **TypeScript** | Language | Consistency with server, type safety |
| **Vue Router** | Routing | Official Vue router, simple SPA navigation |
| **Pinia** | State management | Official Vue store, TypeScript-first |

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
├── tsconfig.base.json              # Shared TypeScript configuration
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
    │   ├── tsconfig.json
    │   │
    │   ├── bin/
    │   │   └── cli.ts              # CLI entry point for `npx claudetools`
    │   │
    │   └── src/
    │       ├── index.ts            # Server entry point
    │       ├── app.ts              # Express application setup
    │       ├── websocket.ts        # WebSocket server and connection management
    │       ├── types.ts            # Server-specific types
    │       │
    │       ├── api/                # REST API route handlers
    │       │   ├── index.ts        # Route registration
    │       │   ├── sessions.ts     # Session CRUD endpoints
    │       │   ├── toolbox.ts      # Toolbox endpoints
    │       │   └── git.ts          # Git information endpoints
    │       │
    │       └── services/           # Business logic
    │           ├── sessionManager.ts    # Claude session orchestration
    │           ├── toolboxStore.ts      # Toolbox item storage
    │           └── gitService.ts        # Git operations
    │
    ├── web/                        # Frontend Vue application
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── vite.config.ts
    │   ├── index.html
    │   │
    │   └── src/
    │       ├── main.ts             # Vue app entry point
    │       ├── App.vue             # Root component
    │       ├── router.ts           # Vue Router configuration
    │       ├── types.ts            # Frontend-specific types
    │       │
    │       ├── stores/             # Pinia stores
    │       │   ├── sessions.ts     # Session state management
    │       │   └── toolbox.ts      # Toolbox state management
    │       │
    │       ├── composables/        # Vue composition functions
    │       │   ├── useWebSocket.ts # WebSocket connection management
    │       │   └── useApi.ts       # HTTP API client
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
        ├── tsconfig.json
        │
        └── src/
            ├── index.ts            # Package exports
            ├── types.ts            # Shared type definitions
            ├── protocol.ts         # WebSocket message types
            └── constants.ts        # Shared constants
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

3. **Create tsconfig.base.json** with shared compiler options
   - Target: ES2022
   - Module: NodeNext
   - Strict mode enabled

4. **Initialize packages/shared**
   - Create package.json with name `@claudetools/shared`
   - Add TypeScript configuration extending base
   - Create placeholder type files

5. **Initialize packages/server**
   - Create package.json with dependencies (express, ws, tsx)
   - Add dependency on `@claudetools/shared`
   - Configure TypeScript
   - Create minimal `src/index.ts` that starts an HTTP server

6. **Initialize packages/web**
   - Run `npm create vue@latest` with TypeScript, Vue Router, Pinia
   - Add dependency on `@claudetools/shared`
   - Configure Vite to proxy API requests to server in dev mode

7. **Verify setup**
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

1. **Create Express application (`src/app.ts`)**
   ```typescript
   import express from 'express';
   import cors from 'cors';
   import { apiRouter } from './api';

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

2. **Create WebSocket server (`src/websocket.ts`)**
   ```typescript
   import { WebSocketServer, WebSocket } from 'ws';
   import type { Server } from 'http';
   import type { WebSocketMessage } from '@claudetools/shared';

   const clients = new Set<WebSocket>();

   export function setupWebSocket(server: Server) {
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

   export function broadcast(message: WebSocketMessage) {
     const data = JSON.stringify(message);
     for (const client of clients) {
       if (client.readyState === WebSocket.OPEN) {
         client.send(data);
       }
     }
   }
   ```

3. **Create server entry point (`src/index.ts`)**
   ```typescript
   import { createServer } from 'http';
   import { createApp } from './app';
   import { setupWebSocket } from './websocket';

   const PORT = process.env.PORT || 3000;

   const app = createApp();
   const server = createServer(app);

   setupWebSocket(server);

   server.listen(PORT, () => {
     console.log(`Server running at http://localhost:${PORT}`);
   });
   ```

4. **Create API route structure (`src/api/index.ts`)**
   ```typescript
   import { Router } from 'express';
   import sessionsRouter from './sessions';
   import toolboxRouter from './toolbox';
   import gitRouter from './git';

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

1. **Define session types (`packages/shared/src/types.ts`)**
   ```typescript
   // Session status enum
   export type SessionStatus =
     | 'starting'      // Session is being initialized
     | 'running'       // Claude is actively working
     | 'waiting'       // Waiting for user input
     | 'completed'     // Session finished successfully
     | 'error';        // Session encountered an error

   // A single message in a conversation
   export interface ConversationMessage {
     id: string;
     role: 'user' | 'assistant' | 'system';
     content: string;
     timestamp: number;
     // For assistant messages, track tool usage
     toolUse?: {
       name: string;
       input: Record<string, unknown>;
     }[];
   }

   // A Claude Code session
   export interface Session {
     id: string;
     name: string;                    // User-provided or auto-generated
     status: SessionStatus;
     workingDirectory: string;        // Absolute path
     gitBranch?: string;              // Current branch if in git repo
     gitWorktree?: string;            // Worktree name if applicable
     createdAt: number;               // Unix timestamp
     updatedAt: number;               // Last activity timestamp
     messages: ConversationMessage[]; // Full conversation history
     error?: string;                  // Error message if status is 'error'
   }

   // Summary for list views (without full message history)
   export interface SessionSummary {
     id: string;
     name: string;
     status: SessionStatus;
     workingDirectory: string;
     gitBranch?: string;
     createdAt: number;
     updatedAt: number;
     messageCount: number;
     lastMessage?: string;            // Preview of last message
   }
   ```

2. **Define toolbox types**
   ```typescript
   // Types of items that can be in the toolbox
   export type ToolboxItemType = 'image' | 'markdown' | 'text' | 'json';

   // Base toolbox item
   export interface ToolboxItemBase {
     id: string;
     type: ToolboxItemType;
     label?: string;                  // Optional user-friendly label
     sessionId?: string;              // Which session added this (optional)
     createdAt: number;
   }

   // Image item (screenshot, diagram, etc.)
   export interface ToolboxImageItem extends ToolboxItemBase {
     type: 'image';
     mimeType: string;                // image/png, image/jpeg, etc.
     data: string;                    // Base64-encoded image data
     filename?: string;
     width?: number;
     height?: number;
   }

   // Markdown document
   export interface ToolboxMarkdownItem extends ToolboxItemBase {
     type: 'markdown';
     content: string;                 // Raw markdown text
     filename?: string;
   }

   // Plain text
   export interface ToolboxTextItem extends ToolboxItemBase {
     type: 'text';
     content: string;
   }

   // JSON data
   export interface ToolboxJsonItem extends ToolboxItemBase {
     type: 'json';
     data: unknown;                   // Parsed JSON
     filename?: string;
   }

   // Union type for all toolbox items
   export type ToolboxItem =
     | ToolboxImageItem
     | ToolboxMarkdownItem
     | ToolboxTextItem
     | ToolboxJsonItem;
   ```

3. **Define git types**
   ```typescript
   // Git worktree information
   export interface GitWorktree {
     path: string;                    // Absolute path to worktree
     branch: string;                  // Branch checked out in this worktree
     isMain: boolean;                 // Is this the main worktree?
     isBare: boolean;                 // Is this a bare worktree?
   }

   // Git branch information
   export interface GitBranch {
     name: string;                    // Branch name
     isRemote: boolean;               // Is this a remote branch?
     isCurrent: boolean;              // Is this the current branch?
     remoteName?: string;             // Remote name if remote branch
   }
   ```

4. **Define WebSocket protocol (`packages/shared/src/protocol.ts`)**
   ```typescript
   // ============================================
   // Server -> Client Messages
   // ============================================

   // Connection established
   export interface WsConnectedMessage {
     type: 'connected';
     timestamp: number;
   }

   // Session list updated
   export interface WsSessionListMessage {
     type: 'session:list';
     sessions: SessionSummary[];
   }

   // Session status changed
   export interface WsSessionStatusMessage {
     type: 'session:status';
     sessionId: string;
     status: SessionStatus;
     error?: string;
   }

   // New message in session conversation
   export interface WsSessionMessageMessage {
     type: 'session:message';
     sessionId: string;
     message: ConversationMessage;
   }

   // Streaming content (partial message)
   export interface WsSessionStreamMessage {
     type: 'session:stream';
     sessionId: string;
     messageId: string;
     delta: string;                   // New text to append
   }

   // Toolbox item added
   export interface WsToolboxAddMessage {
     type: 'toolbox:add';
     item: ToolboxItem;
   }

   // Toolbox cleared
   export interface WsToolboxClearMessage {
     type: 'toolbox:clear';
   }

   // Toolbox item removed
   export interface WsToolboxRemoveMessage {
     type: 'toolbox:remove';
     itemId: string;
   }

   // Union of all server -> client messages
   export type WsServerMessage =
     | WsConnectedMessage
     | WsSessionListMessage
     | WsSessionStatusMessage
     | WsSessionMessageMessage
     | WsSessionStreamMessage
     | WsToolboxAddMessage
     | WsToolboxClearMessage
     | WsToolboxRemoveMessage;

   // ============================================
   // Client -> Server Messages
   // ============================================

   // Subscribe to a specific session's updates
   export interface WsSubscribeSessionMessage {
     type: 'subscribe:session';
     sessionId: string;
   }

   // Unsubscribe from session updates
   export interface WsUnsubscribeSessionMessage {
     type: 'unsubscribe:session';
     sessionId: string;
   }

   // Union of all client -> server messages
   export type WsClientMessage =
     | WsSubscribeSessionMessage
     | WsUnsubscribeSessionMessage;
   ```

5. **Define API request/response types**
   ```typescript
   // POST /api/sessions - Create new session
   export interface CreateSessionRequest {
     prompt: string;                  // Initial prompt for Claude
     name?: string;                   // Optional session name
     workingDirectory: string;        // Where to run Claude
     gitBranch?: string;              // Optional branch to checkout
   }

   export interface CreateSessionResponse {
     session: Session;
   }

   // POST /api/sessions/:id/message - Send message to session
   export interface SendMessageRequest {
     content: string;
   }

   // POST /api/toolbox - Add item to toolbox (JSON)
   export interface AddToolboxItemRequest {
     type: ToolboxItemType;
     content?: string;                // For text/markdown
     data?: unknown;                  // For json
     label?: string;
     sessionId?: string;
   }
   // Note: Images are uploaded via multipart/form-data, not JSON
   ```

**Deliverables**:
- All types defined and exported from `@claudetools/shared`
- Both server and web packages can import and use these types
- Clear documentation in comments for each type

---

### Phase 4: Session Manager Service

**Goal**: Implement the core session management using Claude Agent SDK.

**Steps**:

1. **Install Claude Agent SDK**
   ```bash
   cd packages/server
   pnpm add @anthropic-ai/claude-agent-sdk
   ```

2. **Create SessionManager class (`src/services/sessionManager.ts`)**

   This is the most complex service. It must:
   - Start new sessions using `query()`
   - Track all active sessions
   - Store conversation history as messages stream
   - Determine session state from message flow
   - Support sending follow-up messages
   - Clean up completed/errored sessions

   ```typescript
   import { query } from '@anthropic-ai/claude-agent-sdk';
   import { randomUUID } from 'crypto';
   import { broadcast } from '../websocket';
   import type {
     Session,
     SessionStatus,
     ConversationMessage,
     SessionSummary
   } from '@claudetools/shared';

   interface ActiveSession {
     session: Session;
     abortController: AbortController;
     inputQueue: Array<{ resolve: (value: string) => void }>;
   }

   class SessionManager {
     private sessions = new Map<string, ActiveSession>();

     // Get all sessions as summaries
     getAllSessions(): SessionSummary[] {
       return Array.from(this.sessions.values()).map(({ session }) => ({
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

     // Get full session by ID
     getSession(id: string): Session | undefined {
       return this.sessions.get(id)?.session;
     }

     // Start a new session
     async startSession(options: {
       prompt: string;
       name?: string;
       workingDirectory: string;
       gitBranch?: string;
     }): Promise<Session> {
       const id = randomUUID();
       const now = Date.now();

       const session: Session = {
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

       this.sessions.set(id, {
         session,
         abortController,
         inputQueue: [],
       });

       // Broadcast new session
       broadcast({ type: 'session:list', sessions: this.getAllSessions() });

       // Start the Claude session in background
       this.runSession(id, options.prompt);

       return session;
     }

     // Internal: Run the Claude session
     private async runSession(sessionId: string, initialPrompt: string) {
       const activeSession = this.sessions.get(sessionId);
       if (!activeSession) return;

       const { session, abortController } = activeSession;

       try {
         // Update status to running
         this.updateSessionStatus(sessionId, 'running');

         // Add user message
         this.addMessage(sessionId, {
           id: randomUUID(),
           role: 'user',
           content: initialPrompt,
           timestamp: Date.now(),
         });

         // Create async generator for streaming input
         const inputGenerator = this.createInputGenerator(sessionId);

         // Start Claude query
         const stream = query({
           prompt: inputGenerator,
           options: {
             model: 'claude-sonnet-4-5',
             cwd: session.workingDirectory,
             abortController,
           },
         });

         let currentMessageId: string | null = null;
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

             this.addMessage(sessionId, {
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
             this.updateSessionStatus(sessionId, 'waiting');
           }
         }
       } catch (error) {
         const errorMessage = error instanceof Error ? error.message : 'Unknown error';
         this.updateSessionStatus(sessionId, 'error', errorMessage);
       }
     }

     // Create async generator for multi-turn input
     private async *createInputGenerator(sessionId: string) {
       const activeSession = this.sessions.get(sessionId);
       if (!activeSession) return;

       // Yield initial prompt placeholder (already handled)
       // Then wait for subsequent inputs
       while (true) {
         const input = await new Promise<string>((resolve) => {
           activeSession.inputQueue.push({ resolve });
         });

         yield { type: 'user' as const, content: input };
       }
     }

     // Send a message to a waiting session
     sendMessage(sessionId: string, content: string): boolean {
       const activeSession = this.sessions.get(sessionId);
       if (!activeSession || activeSession.session.status !== 'waiting') {
         return false;
       }

       // Add user message to history
       this.addMessage(sessionId, {
         id: randomUUID(),
         role: 'user',
         content,
         timestamp: Date.now(),
       });

       // Resolve the pending input promise
       const pending = activeSession.inputQueue.shift();
       if (pending) {
         this.updateSessionStatus(sessionId, 'running');
         pending.resolve(content);
       }

       return true;
     }

     // Stop a session
     stopSession(sessionId: string): boolean {
       const activeSession = this.sessions.get(sessionId);
       if (!activeSession) return false;

       activeSession.abortController.abort();
       this.updateSessionStatus(sessionId, 'completed');
       return true;
     }

     // Delete a session
     deleteSession(sessionId: string): boolean {
       const activeSession = this.sessions.get(sessionId);
       if (!activeSession) return false;

       // Stop if running
       if (['running', 'waiting', 'starting'].includes(activeSession.session.status)) {
         activeSession.abortController.abort();
       }

       this.sessions.delete(sessionId);
       broadcast({ type: 'session:list', sessions: this.getAllSessions() });
       return true;
     }

     // Helper: Update session status
     private updateSessionStatus(sessionId: string, status: SessionStatus, error?: string) {
       const activeSession = this.sessions.get(sessionId);
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

     // Helper: Add message to session
     private addMessage(sessionId: string, message: ConversationMessage) {
       const activeSession = this.sessions.get(sessionId);
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

3. **Implement session API routes (`src/api/sessions.ts`)**
   ```typescript
   import { Router } from 'express';
   import { sessionManager } from '../services/sessionManager';
   import type { CreateSessionRequest, SendMessageRequest } from '@claudetools/shared';

   const router = Router();

   // GET /api/sessions - List all sessions
   router.get('/', (req, res) => {
     const sessions = sessionManager.getAllSessions();
     res.json({ sessions });
   });

   // POST /api/sessions - Create new session
   router.post('/', async (req, res) => {
     const body = req.body as CreateSessionRequest;

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
     const body = req.body as SendMessageRequest;

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

1. **Create ToolboxStore class (`src/services/toolboxStore.ts`)**
   ```typescript
   import { randomUUID } from 'crypto';
   import { broadcast } from '../websocket';
   import type { ToolboxItem, ToolboxItemType } from '@claudetools/shared';

   class ToolboxStore {
     private items = new Map<string, ToolboxItem>();

     // Get all items
     getAllItems(): ToolboxItem[] {
       return Array.from(this.items.values())
         .sort((a, b) => b.createdAt - a.createdAt); // Newest first
     }

     // Get item by ID
     getItem(id: string): ToolboxItem | undefined {
       return this.items.get(id);
     }

     // Add an image item
     addImage(options: {
       data: Buffer;
       mimeType: string;
       filename?: string;
       label?: string;
       sessionId?: string;
     }): ToolboxItem {
       const item: ToolboxItem = {
         id: randomUUID(),
         type: 'image',
         mimeType: options.mimeType,
         data: options.data.toString('base64'),
         filename: options.filename,
         label: options.label,
         sessionId: options.sessionId,
         createdAt: Date.now(),
       };

       this.items.set(item.id, item);
       broadcast({ type: 'toolbox:add', item });
       return item;
     }

     // Add a markdown item
     addMarkdown(options: {
       content: string;
       filename?: string;
       label?: string;
       sessionId?: string;
     }): ToolboxItem {
       const item: ToolboxItem = {
         id: randomUUID(),
         type: 'markdown',
         content: options.content,
         filename: options.filename,
         label: options.label,
         sessionId: options.sessionId,
         createdAt: Date.now(),
       };

       this.items.set(item.id, item);
       broadcast({ type: 'toolbox:add', item });
       return item;
     }

     // Add a text item
     addText(options: {
       content: string;
       label?: string;
       sessionId?: string;
     }): ToolboxItem {
       const item: ToolboxItem = {
         id: randomUUID(),
         type: 'text',
         content: options.content,
         label: options.label,
         sessionId: options.sessionId,
         createdAt: Date.now(),
       };

       this.items.set(item.id, item);
       broadcast({ type: 'toolbox:add', item });
       return item;
     }

     // Add a JSON item
     addJson(options: {
       data: unknown;
       filename?: string;
       label?: string;
       sessionId?: string;
     }): ToolboxItem {
       const item: ToolboxItem = {
         id: randomUUID(),
         type: 'json',
         data: options.data,
         filename: options.filename,
         label: options.label,
         sessionId: options.sessionId,
         createdAt: Date.now(),
       };

       this.items.set(item.id, item);
       broadcast({ type: 'toolbox:add', item });
       return item;
     }

     // Remove an item
     removeItem(id: string): boolean {
       const existed = this.items.delete(id);
       if (existed) {
         broadcast({ type: 'toolbox:remove', itemId: id });
       }
       return existed;
     }

     // Clear all items
     clear(): void {
       this.items.clear();
       broadcast({ type: 'toolbox:clear' });
     }
   }

   export const toolboxStore = new ToolboxStore();
   ```

2. **Create toolbox API routes (`src/api/toolbox.ts`)**
   ```typescript
   import { Router } from 'express';
   import multer from 'multer';
   import { toolboxStore } from '../services/toolboxStore';
   import type { AddToolboxItemRequest } from '@claudetools/shared';

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
       const body = req.body as AddToolboxItemRequest;

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

1. **Create GitService class (`src/services/gitService.ts`)**
   ```typescript
   import { exec } from 'child_process';
   import { promisify } from 'util';
   import type { GitWorktree, GitBranch } from '@claudetools/shared';

   const execAsync = promisify(exec);

   class GitService {
     // Check if a directory is a git repository
     async isGitRepo(directory: string): Promise<boolean> {
       try {
         await execAsync('git rev-parse --git-dir', { cwd: directory });
         return true;
       } catch {
         return false;
       }
     }

     // Get list of worktrees
     async getWorktrees(directory: string): Promise<GitWorktree[]> {
       try {
         const { stdout } = await execAsync('git worktree list --porcelain', {
           cwd: directory,
         });

         const worktrees: GitWorktree[] = [];
         let current: Partial<GitWorktree> = {};

         for (const line of stdout.split('\n')) {
           if (line.startsWith('worktree ')) {
             if (current.path) {
               worktrees.push(current as GitWorktree);
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
           worktrees.push(current as GitWorktree);
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

     // Get list of branches
     async getBranches(directory: string): Promise<GitBranch[]> {
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

         const branches: GitBranch[] = [];
         const seen = new Set<string>();

         for (const line of stdout.split('\n')) {
           if (!line.trim()) continue;

           const [shortName, fullRef] = line.split('|');
           const isRemote = fullRef.startsWith('refs/remotes/');

           // Skip duplicate remote tracking branches
           if (seen.has(shortName)) continue;
           seen.add(shortName);

           // Parse remote name from remote branches
           let remoteName: string | undefined;
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

     // Get current branch name
     async getCurrentBranch(directory: string): Promise<string | null> {
       try {
         const { stdout } = await execAsync('git branch --show-current', {
           cwd: directory,
         });
         return stdout.trim() || null;
       } catch {
         return null;
       }
     }

     // Create a new worktree
     async createWorktree(
       directory: string,
       path: string,
       branch: string,
       createBranch: boolean = false
     ): Promise<{ success: boolean; error?: string }> {
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

2. **Create git API routes (`src/api/git.ts`)**
   ```typescript
   import { Router } from 'express';
   import { gitService } from '../services/gitService';

   const router = Router();

   // GET /api/git/worktrees?directory=/path/to/repo
   router.get('/worktrees', async (req, res) => {
     const directory = req.query.directory as string;

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
     const directory = req.query.directory as string;

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
     const directory = req.query.directory as string;

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

1. **Configure Vue Router (`src/router.ts`)**
   ```typescript
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

2. **Create WebSocket composable (`src/composables/useWebSocket.ts`)**
   ```typescript
   import { ref, onMounted, onUnmounted } from 'vue';
   import type { WsServerMessage } from '@claudetools/shared';

   const socket = ref<WebSocket | null>(null);
   const isConnected = ref(false);
   const messageHandlers = new Set<(msg: WsServerMessage) => void>();

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
           const message = JSON.parse(event.data) as WsServerMessage;
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

     const onMessage = (handler: (msg: WsServerMessage) => void) => {
       messageHandlers.add(handler);
       return () => messageHandlers.delete(handler);
     };

     const send = (message: unknown) => {
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

3. **Create API composable (`src/composables/useApi.ts`)**
   ```typescript
   const BASE_URL = '/api';

   async function fetchApi<T>(
     path: string,
     options?: RequestInit
   ): Promise<T> {
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
       getSessions: () =>
         fetchApi<{ sessions: SessionSummary[] }>('/sessions'),

       getSession: (id: string) =>
         fetchApi<{ session: Session }>(`/sessions/${id}`),

       createSession: (data: CreateSessionRequest) =>
         fetchApi<{ session: Session }>('/sessions', {
           method: 'POST',
           body: JSON.stringify(data),
         }),

       sendMessage: (sessionId: string, content: string) =>
         fetchApi<{ success: boolean }>(`/sessions/${sessionId}/message`, {
           method: 'POST',
           body: JSON.stringify({ content }),
         }),

       stopSession: (id: string) =>
         fetchApi<{ success: boolean }>(`/sessions/${id}/stop`, {
           method: 'POST',
         }),

       deleteSession: (id: string) =>
         fetchApi<{ success: boolean }>(`/sessions/${id}`, {
           method: 'DELETE',
         }),

       // Toolbox
       getToolboxItems: () =>
         fetchApi<{ items: ToolboxItem[] }>('/toolbox'),

       deleteToolboxItem: (id: string) =>
         fetchApi<{ success: boolean }>(`/toolbox/${id}`, {
           method: 'DELETE',
         }),

       clearToolbox: () =>
         fetchApi<{ success: boolean }>('/toolbox', {
           method: 'DELETE',
         }),

       // Git
       getWorktrees: (directory: string) =>
         fetchApi<{ worktrees: GitWorktree[] }>(
           `/git/worktrees?directory=${encodeURIComponent(directory)}`
         ),

       getBranches: (directory: string) =>
         fetchApi<{ branches: GitBranch[] }>(
           `/git/branches?directory=${encodeURIComponent(directory)}`
         ),
     };
   }
   ```

4. **Create Sessions store (`src/stores/sessions.ts`)**
   ```typescript
   import { defineStore } from 'pinia';
   import { ref, computed } from 'vue';
   import { useApi } from '../composables/useApi';
   import { useWebSocket } from '../composables/useWebSocket';
   import type { Session, SessionSummary, WsServerMessage } from '@claudetools/shared';

   export const useSessionsStore = defineStore('sessions', () => {
     const api = useApi();
     const { onMessage } = useWebSocket();

     const sessions = ref<SessionSummary[]>([]);
     const currentSession = ref<Session | null>(null);
     const loading = ref(false);
     const error = ref<string | null>(null);

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

     async function fetchSession(id: string) {
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

     async function createSession(data: CreateSessionRequest) {
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

     async function sendMessage(sessionId: string, content: string) {
       try {
         await api.sendMessage(sessionId, content);
       } catch (e) {
         error.value = e instanceof Error ? e.message : 'Failed to send message';
         throw e;
       }
     }

     // WebSocket message handler
     onMessage((msg: WsServerMessage) => {
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

5. **Create Toolbox store (`src/stores/toolbox.ts`)**
   ```typescript
   import { defineStore } from 'pinia';
   import { ref } from 'vue';
   import { useApi } from '../composables/useApi';
   import { useWebSocket } from '../composables/useWebSocket';
   import type { ToolboxItem, WsServerMessage } from '@claudetools/shared';

   export const useToolboxStore = defineStore('toolbox', () => {
     const api = useApi();
     const { onMessage } = useWebSocket();

     const items = ref<ToolboxItem[]>([]);
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

     async function removeItem(id: string) {
       await api.deleteToolboxItem(id);
     }

     async function clearAll() {
       await api.clearToolbox();
     }

     // WebSocket handler
     onMessage((msg: WsServerMessage) => {
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

1. **Create CLI script (`packages/server/bin/cli.ts`)**
   ```typescript
   #!/usr/bin/env node

   import { createServer } from 'http';
   import { createApp } from '../src/app';
   import { setupWebSocket } from '../src/websocket';
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
     "bin": {
       "claudetools": "./dist/bin/cli.js"
     },
     "scripts": {
       "build": "tsc && cp -r ../web/dist ./public",
       "start": "node dist/bin/cli.js",
       "dev": "tsx watch src/index.ts"
     }
   }
   ```

3. **Build script for production**
   - Build web package first
   - Build server package
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

```typescript
// Session list updated
{ type: 'session:list', sessions: SessionSummary[] }

// Session status changed
{ type: 'session:status', sessionId: string, status: SessionStatus, error?: string }

// New message in conversation
{ type: 'session:message', sessionId: string, message: ConversationMessage }

// Streaming content
{ type: 'session:stream', sessionId: string, messageId: string, delta: string }

// Toolbox item added
{ type: 'toolbox:add', item: ToolboxItem }

// Toolbox item removed
{ type: 'toolbox:remove', itemId: string }

// Toolbox cleared
{ type: 'toolbox:clear' }
```

### Client → Server Messages

```typescript
// Subscribe to session updates (future use)
{ type: 'subscribe:session', sessionId: string }

// Unsubscribe from session
{ type: 'unsubscribe:session', sessionId: string }
```

---

## Data Models

See the [Shared Types and Protocol](#phase-3-shared-types-and-protocol) section for complete TypeScript definitions.

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
