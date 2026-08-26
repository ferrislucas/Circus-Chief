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
| 8 | Circus Commands | `buildCommandButtonApiInstructions()` (in `commandButtonPrompts.js`) | Yes |
| 9 | Kanban board API | `buildKanbanApiInstructions()` | Yes |

The base URL used in all endpoint examples is derived from `CIRCUSCHIEF_API_URL` env var, falling back to `http://localhost:{PORT}`.

## REST API Endpoints Exposed to Agents

### Canvas API (always included)

Agents can post artifacts to the canvas and read them back.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/workspaces/{workspaceId}/canvas` | Add a file to the canvas. Body: `{"filePath": "/path/to/file"}`. File type auto-detected from extension. |
| GET | `/api/workspaces/{workspaceId}/canvas` | List all files on the canvas |
| GET | `/api/workspaces/{workspaceId}/canvas/file/{filename}` | Get metadata for a canvas file. Response: `{ filePath, type, mimeType, createdAt, version, totalVersions }` |
| GET | `/api/workspaces/{workspaceId}/canvas/file/{filename}/history/{version}` | Get a historical version of a canvas file. Version 1 = oldest. |
| DELETE | `/api/workspaces/{workspaceId}/canvas/file/{filename}` | Move every active version of the exact filename to recoverable canvas trash. Response: `{ filename, trashedCount }`; returns `404 { error: "File not found on canvas" }` when no active version exists. URL-encode reserved filename characters (for example, `quarterly%20report%20%231.md`). |

**Supported file formats:** Images (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.bmp`), PDFs (`.pdf`), Markdown (`.md`, `.mdx`), Code (`.js`, `.ts`, `.py`, `.go`, `.rs`, `.java`, etc.), JSON (`.json`), Text (`.txt`, `.log`, `.csv`).

### Session Management API (always included)

The prompt provides the agent with its own session ID, project ID, and current workspace ID. All endpoints use `curl` examples.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/projects/{projectId}/workspaces` | Create a new workspace. Required body field: `prompt`. See optional fields below. |
| POST | `/api/workspaces/{workspaceId}/sessions` | Add a session to the current workspace. Required body fields: `prompt`, `parentSessionId`. `parentSessionId` must reference a session in this workspace (the root or a descendant); pass the current session ID to chain, or the workspace ID to attach directly to the root. Unknown or cross-workspace values are rejected — there is no fallback. |
| POST | `/api/sessions/{session_id}/message` | Send a follow-up message. Body: `{"content": "..."}` |
| GET | `/api/sessions` | List all active sessions |
| GET | `/api/sessions/{session_id}` | Get session details |
| GET | `/api/sessions/{session_id}/messages` | Get session messages |
| GET | `/api/projects/{projectId}/workspaces` | List workspaces for the current project |
| GET | `/api/workspaces/{workspaceId}` | Get workspace details |
| POST | `/api/sessions/{session_id}/stop` | Stop a session |
| POST | `/api/sessions/{session_id}/restart` | Restart a session |
| DELETE | `/api/sessions/{session_id}` | Delete a session |
| PATCH | `/api/sessions/{session_id}` | Update session settings. Example body: `{"thinkingEnabled": true, "effortLevel": "high"}` |

**Optional fields for workspace/session creation:** `name`, `mode`, `thinkingEnabled` (boolean), `effortLevel` (low/medium/high/max/auto), `model`, `providerId`, `gitBranch`, `gitMode`, `templateId`, `nextTemplateId`, `startImmediately`, `scheduledAt` (ISO 8601 date-time string with timezone, e.g. `"2026-06-12T14:00:00Z"`), `autoRescheduleEnabled`, `rescheduleDelayMinutes`, `rescheduleOnTokenLimit`, `rescheduleOnServiceError`, `maxRescheduleCount`, `maxTotalTokens`, and `rescheduleAtTokenCount`. `parentSessionId` is **required** (not optional) when adding a session to an existing workspace via `POST /api/workspaces/{workspaceId}/sessions`; it is not accepted at all when creating a new workspace (`parentSessionId` is always forced to `null` there).

**Session update behavior:** `PATCH /api/sessions/{sessionId}` accepts `scheduledAt` as either an ISO 8601 string or a numeric epoch-milliseconds value. The API normalizes valid values to epoch milliseconds and rejects invalid inputs with `400`.

**Auto-retry defaults:** API-created sessions automatically retry on token-limit exhaustion and provider outages. `autoRescheduleEnabled` defaults to `true` (pass `false` to opt out), `rescheduleOnTokenLimit` and `rescheduleOnServiceError` both default to `true`, and `maxRescheduleCount` defaults to `24` (≈ one day of hourly retries). Pass an explicit `maxRescheduleCount` to adjust the cap.

**SDK `ScheduleWakeup` bridge:** `ScheduleWakeup` is a Claude Agent SDK built-in, not a Circus Chief endpoint. When an agent calls it, the SDK registers a cron *inside the Claude Code CLI subprocess* — which exits at the end of the turn, taking the cron with it. Since Circus Chief runs one-shot `query()` per turn, nothing would ever wake the session, even though the tool reports success and the agent says something like "I'll wait for the scheduled wakeup."

`packages/server/src/services/scheduleWakeupBridge.js` translates the call into the same `scheduledAt` / `pendingPrompt` fields that `POST /api/sessions/:id/schedule` writes, so `SchedulerService`'s poller resumes the session normally. Details:

- The call is **captured** from the assistant message's `tool_use` block (deduplicated by `tool_use.id`, since the stream can redeliver the same partial content) and only **applied at turn completion** — a superseding call later in the turn wins, and an aborted or hard-errored turn leaves no schedule behind. It reads the tool *input* rather than `ScheduleWakeupOutput.scheduledFor` because tool results arrive as `user` messages, which the Claude Code stream path does not handle.
- `delaySeconds` is clamped to the SDK-documented `[60, 3600]` range and is measured **from turn completion**, not from when the tool was called — a long turn (agent asks for a 60s poll, then works for 10 more minutes) would otherwise collapse the requested delay to nothing.
- The documented `<<autonomous-loop-dynamic>>` sentinel is supported without persisting the sentinel itself. The bridge accepts it only for a resumable Claude conversation whose last user message is `/loop`, records that conversation as `pendingConversationId`, and lets the scheduler resume the exact `/loop` message through its persisted Claude session ID. This preserves the loop context instead of fabricating a new `Continue` prompt. The CronCreate-only `<<autonomous-loop>>` sentinel remains unsupported for `ScheduleWakeup` and is rejected with a transcript work log.
- **Whichever of an explicit `POST /:id/schedule` call and a `ScheduleWakeup` call happened later in the same turn wins** — the same last-call-wins rule applied to repeated `ScheduleWakeup` calls. (A schedule left over from outside the current turn doesn't count as a competing claim, so it can't block a legitimate wakeup.)
- For lane-run sessions the write is fenced by `withActiveLaneRunOwnership`, exactly as the REST endpoint does.
- Every path that drops a captured wakeup (unusable `delaySeconds`, a refused sentinel, precedence loss, lost lane-run ownership) writes a `tool_output` work log in addition to a server-side log line, so the drop is visible in the session transcript — the entire point of this bridge is that the tool used to lie about success, so a new silent failure mode here would be its own regression.

**Structured lane-run workers:** A plain successful turn end means the worker's own work is complete. If the worker needs another turn — including one awaiting human input — it must schedule itself before the turn ends; the schedule keeps the lane run open. Descendants created with `parentSessionId` also remain blocking until they complete.

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

### Circus Commands (always included)

Always included so agents can discover available commands via the list endpoint. Built in `packages/server/src/services/commandButtonPrompts.js`. Agents should call the list endpoint to discover whether any commands are configured for the project.

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
| POST | `/api/projects/{projectId}/kanban/cards` | Add current workspace to the board. Body: `{"workspaceId": "...", "laneId": "..."}` |
| PATCH | `/api/projects/{projectId}/kanban/cards/by-workspace/{workspaceId}/move` | Move a workspace card to a different lane. Body: `{"targetLaneId": "..."}` |
| DELETE | `/api/projects/{projectId}/kanban/cards/by-workspace/{workspaceId}` | Remove a workspace card |
| POST | `/api/projects/{projectId}/kanban/lanes` | Create a new lane. Body: `{"name": "..."}` |
| PATCH | `/api/projects/{projectId}/kanban/lanes/{lane_id}` | Update a lane. Body: `{"name": "..."}` |
| DELETE | `/api/projects/{projectId}/kanban/lanes/{lane_id}` | Delete a lane |

## Source Files

| File | Purpose |
|------|---------|
| `packages/server/src/services/sessionPrompts.js` | Main prompt assembly and canvas/session/kanban endpoint documentation |
| `packages/server/src/services/commandButtonPrompts.js` | Command endpoint documentation |
| `packages/server/src/services/scheduleWakeupBridge.js` | Translates the SDK's built-in `ScheduleWakeup` tool into a Circus Chief schedule |
| `packages/shared/src/constants.js` | `DEFAULT_SYSTEM_PROMPT` fallback |
