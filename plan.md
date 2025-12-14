# Claude Code Integration Plan

## Overview

Replace the mock `sessionManager.js` implementation with real Claude Code CLI integration using the streaming JSON protocol.

## Architecture

```
Frontend (Vue)
    ↓ POST /api/projects/:id/sessions {prompt}
Server (Express)
    ├→ Create session in DB
    └→ Spawn: claude -p --output-format stream-json --verbose --input-format stream-json
        ├→ Write initial prompt to stdin
        ├→ Parse stdout line-by-line as JSON
        ├→ For each event:
        │   ├→ Store in DB (messages table)
        │   └→ Broadcast via WebSocket
        └→ Handle multi-turn via stdin writes

Frontend WebSocket
    ├→ Receive session:message events
    ├→ Receive session:status events
    └→ Update UI in real-time with streaming text
```

## Event Types from Claude CLI

| Type | Subtype | Description | Action |
|------|---------|-------------|--------|
| `system` | `init` | Session started | Store session_id, model info |
| `assistant` | - | Claude's response | Stream to UI, store in DB |
| `result` | `success`/`error` | Session complete | Store cost, mark completed |

**Assistant message structure:**
```json
{
  "type": "assistant",
  "message": {
    "content": [{"type": "text", "text": "..."}],
    "model": "claude-opus-4-5-20251101"
  },
  "session_id": "uuid"
}
```

## Implementation Steps

### Step 1: Create Claude Process Service

New file: `packages/server/src/services/claudeProcess.js`

- Spawn `claude` CLI with streaming JSON flags
- Handle stdin/stdout/stderr streams
- Parse JSON lines from stdout
- Emit events for each message type
- Support multi-turn via stdin writes
- Handle process lifecycle (kill on abort)

### Step 2: Update Session Manager

Modify: `packages/server/src/services/sessionManager.js`

- Remove SDK import and mock function
- Use new `claudeProcess` service
- Update `handleStreamEvent()` for CLI event format
- Add partial message support for real-time streaming

### Step 3: Add Canvas Endpoint

New endpoint: `POST /api/sessions/:id/canvas`

Claude will be instructed to POST artifacts here:
```bash
curl -X POST http://localhost:5000/api/sessions/{sessionId}/canvas \
  -H "Content-Type: application/json" \
  -d '{"type":"image","content":"base64...","title":"Screenshot"}'
```

This is passed to Claude via `--append-system-prompt`:
```
When you generate artifacts (images, markdown, code blocks) that should be
displayed on the canvas, POST them to:
POST {CLAUDETOOLS_API_URL}/api/sessions/{sessionId}/canvas
Body: {"type": "image|markdown|text|json", "content": "...", "title": "..."}
```

### Step 4: Update Frontend for Streaming

Modify: `packages/web/src/components/ConversationTab.vue`

- Show partial messages as they stream in
- Add typing indicator while Claude is responding
- Handle `--include-partial-messages` events

### Step 5: Add Cost Tracking

- Store `total_cost_usd` from result events
- Display cost in session header
- Track cumulative cost per project

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `packages/server/src/services/claudeProcess.js` | Create | Claude CLI process management |
| `packages/server/src/services/sessionManager.js` | Modify | Use claudeProcess instead of SDK |
| `packages/server/src/api/canvas.js` | Modify | Add POST endpoint for Claude |
| `packages/web/src/components/ConversationTab.vue` | Modify | Streaming text support |
| `packages/server/src/db/schema.sql` | Modify | Add cost_usd column to sessions |

## CLI Command

```bash
claude -p \
  --output-format stream-json \
  --input-format stream-json \
  --verbose \
  --include-partial-messages \
  --append-system-prompt "..." \
  --cwd {workingDirectory}
```

**Input format (stdin):**
```json
{"type":"user","message":{"role":"user","content":"Your prompt here"}}
```

**Multi-turn:** Write additional JSON lines to stdin when user sends follow-up messages.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `CLAUDETOOLS_SESSION_ID` | Passed to Claude for canvas POSTs |
| `CLAUDETOOLS_API_URL` | Server URL for canvas endpoint |

## Testing Strategy

1. Unit test `claudeProcess.js` with mocked child_process
2. Integration test full flow with real Claude CLI
3. E2E test conversation and canvas features

## Future Enhancements

- MCP server for canvas instead of HTTP endpoint
- Resume sessions using `--resume {sessionId}`
- Permission mode selection in UI
- Model selection per session
