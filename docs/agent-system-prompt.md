# Agent System Prompt & REST API Reference

This document describes the system prompt injected into every agent session and the REST API endpoints exposed to agents. The system prompt is assembled at runtime by `packages/server/src/services/sessionPrompts.js` and teaches the agent how to interact with Circus Chief's canvas, session management, and project APIs.

## Prompt Assembly

`buildSystemPromptConfig(sessionId, projectId, customSystemPrompt, mode)` assembles the full system prompt from these parts, joined with double newlines (empty parts are filtered out):

| # | Section | Builder Function | Always Included? |
|---|---------|-----------------|-----------------|
| 1 | Plan mode instructions | `PLAN_MODE_PROMPT` | Only when mode = `plan` |
| 2 | Base prompt | `customSystemPrompt` or `DEFAULT_SYSTEM_PROMPT` | Yes |
| 3 | Git worktree context | `buildWorktreeContext()` | Only when session uses a git worktree |
| 4 | Session attached files | `getSessionAttachmentsContext()` | Only when files are attached to the session |
| 5 | Canvas write instructions | `buildCanvasWriteSystemPrompt()` | Yes |
| 6 | Canvas read instructions | `buildCanvasReadSystemPrompt()` | Yes |
| 7 | Session management API | `buildSessionApiInstructions()` | Yes |
| 8 | Circus Commands | `buildCommandButtonApiInstructions()` (in `commandButtonPrompts.js`) | Only when project has commands |
| 9 | Kanban board API | `buildKanbanApiInstructions()` | Yes |

The base URL used in all endpoint examples is derived from `CIRCUSCHIEF_API_URL` env var, falling back to `http://localhost:{PORT}`.

## REST API Endpoints Exposed to Agents

### Canvas API (always included)

Agents can post artifacts to the canvas and read them back.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sessions/{sessionId}/canvas` | Add a file to the canvas. Body: `{"filePath": "/path/to/file"}`. File type auto-detected from extension. |
| GET | `/api/sessions/{sessionId}/canvas` | List all files on the canvas |
| GET | `/api/sessions/{sessionId}/canvas/file/{filename}` | Get metadata for a canvas file. Response: `{ filePath, type, mimeType, createdAt, version, totalVersions }` |
| GET | `/api/sessions/{sessionId}/canvas/file/{filename}/history/{version}` | Get a historical version of a canvas file. Version 1 = oldest. |

**Supported file formats:** Images (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.bmp`), PDFs (`.pdf`), Markdown (`.md`, `.mdx`), Code (`.js`, `.ts`, `.py`, `.go`, `.rs`, `.java`, etc.), JSON (`.json`), Text (`.txt`, `.log`, `.csv`).

### Session Management API (always included)

The prompt provides the agent with its own session ID and project ID. All endpoints use `curl` examples.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/projects/{projectId}/sessions` | Create a new session. Required body field: `prompt`. See optional fields below. |
| POST | `/api/sessions/{session_id}/message` | Send a follow-up message. Body: `{"content": "..."}` |
| GET | `/api/sessions` | List all active sessions |
| GET | `/api/sessions/{session_id}` | Get session details |
| GET | `/api/sessions/{session_id}/messages` | Get session messages |
| POST | `/api/sessions/{session_id}/stop` | Stop a session |
| POST | `/api/sessions/{session_id}/restart` | Restart a session |
| DELETE | `/api/sessions/{session_id}` | Delete a session |
| PATCH | `/api/sessions/{session_id}` | Update session settings. Example body: `{"thinkingEnabled": true, "effortLevel": "high"}` |

**Optional fields for session creation:** `name`, `mode`, `thinkingEnabled` (boolean), `effortLevel` (low/medium/high/max/auto), `model`, `providerId`, `gitBranch`, `gitMode`, `templateId`, `nextTemplateId`, `parentSessionId` (to create a related follow-up session from the current session), `startImmediately`, `scheduledAt` (ISO 8601 date-time string with timezone, e.g. `"2026-06-12T14:00:00Z"`), `autoRescheduleEnabled`, `rescheduleDelayMinutes`, `rescheduleOnTokenLimit`, `rescheduleOnServiceError`, `maxRescheduleCount`, `maxTotalTokens`, `rescheduleAtTokenCount`.

**Auto-retry defaults:** API-created sessions automatically retry on token-limit exhaustion and provider outages. `autoRescheduleEnabled` defaults to `true` (pass `false` to opt out), `rescheduleOnTokenLimit` and `rescheduleOnServiceError` both default to `true`, and `maxRescheduleCount` defaults to `24` (≈ one day of hourly retries). Pass an explicit `maxRescheduleCount` to adjust the cap.

### Project Operations (always included)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List all projects |
| GET | `/api/projects/{project_id}` | Get project details |
| GET | `/api/projects/{project_id}/sessions` | List project sessions |
| POST | `/api/projects` | Create a project. Required body: `{"name": "...", "workingDirectory": "..."}`. Optional: `systemPrompt` |

### Workflow Summary (always included)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions/{sessionId}/summary?generate=true` | Get (and generate) a session summary |
| POST | `/api/sessions/{sessionId}/summary` | Regenerate the session summary |

### Circus Commands (conditional)

Included only when the project has commands configured. Built in `packages/server/src/services/commandButtonPrompts.js`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions/{sessionId}/circus-commands` | List available commands |
| POST | `/api/sessions/{sessionId}/circus-commands/{button_id}/run` | Run a command. Response: `{ runId, buttonId, status: "running", output: "" }` |
| GET | `/api/sessions/{sessionId}/circus-commands/runs/{run_id}` | Check run status & output. Response: `{ runId, buttonId, status, exitCode, output, startedAt, completedAt }` |
| GET | `/api/sessions/{sessionId}/circus-commands/runs` | List all command runs |
| POST | `/api/sessions/{sessionId}/circus-commands/runs/{run_id}/kill` | Kill a running command |

### Kanban Board API (always included)

Included for every project. Also includes a dynamically populated list of available lanes with names and IDs.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/{projectId}/kanban` | Get board with all lanes and cards |
| POST | `/api/projects/{projectId}/kanban/cards` | Add session to board. Body: `{"sessionId": "...", "laneId": "..."}` |
| PATCH | `/api/projects/{projectId}/kanban/cards/{card_id}/move` | Move card to a different lane. Body: `{"targetLaneId": "..."}` |
| DELETE | `/api/projects/{projectId}/kanban/cards/{card_id}` | Remove a card |
| POST | `/api/projects/{projectId}/kanban/lanes` | Create a new lane. Body: `{"name": "..."}` |
| PATCH | `/api/projects/{projectId}/kanban/lanes/{lane_id}` | Update a lane. Body: `{"name": "..."}` |
| DELETE | `/api/projects/{projectId}/kanban/lanes/{lane_id}` | Delete a lane |

## Source Files

| File | Purpose |
|------|---------|
| `packages/server/src/services/sessionPrompts.js` | Main prompt assembly and canvas/session/kanban endpoint documentation |
| `packages/server/src/services/commandButtonPrompts.js` | Command endpoint documentation |
| `packages/shared/src/constants.js` | `DEFAULT_SYSTEM_PROMPT` fallback |
