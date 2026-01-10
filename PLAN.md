# Claude Code Integration Plan

## Overview

Replace the mock `sessionManager.js` implementation with the official **`@anthropic-ai/claude-agent-sdk`** which provides proper JS bindings.

## SDK API

The SDK exports a `query()` function:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

function query(params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}): Query;  // extends AsyncGenerator<SDKMessage, void>
```

### Key Options

| Option | Type | Description |
|--------|------|-------------|
| `cwd` | `string` | Working directory for the session |
| `abortController` | `AbortController` | Cancel the query |
| `permissionMode` | `'default' \| 'acceptEdits' \| 'bypassPermissions'` | Permission handling |
| `model` | `string` | Model to use (e.g., `'claude-sonnet-4-5-20250929'`) |
| `includePartialMessages` | `boolean` | Stream partial responses for real-time UI |
| `systemPrompt` | `string` | Custom system prompt |
| `env` | `Record<string, string>` | Environment variables |

### Event Types (SDKMessage)

| Type | Description |
|------|-------------|
| `SDKSystemMessage` | Session init with `session_id`, `model`, `tools` |
| `SDKAssistantMessage` | Claude's response with `message.content` |
| `SDKUserMessage` | User input (for replay) |
| `SDKPartialAssistantMessage` | Streaming chunks (when `includePartialMessages: true`) |
| `SDKResultMessage` | Final result with `total_cost_usd`, `usage` |

### Multi-Turn Conversations

Pass an `AsyncIterable<SDKUserMessage>` as the prompt for multi-turn:

```javascript
async function* userMessages(initialPrompt) {
  yield { role: 'user', content: initialPrompt };

  while (true) {
    const input = await waitForUserInput();  // your logic
    yield { role: 'user', content: input };
  }
}

for await (const event of query({
  prompt: userMessages("Hello"),
  options: { cwd: '/path/to/project' }
})) {
  // handle events
}
```

## Implementation Steps

### Step 1: Install SDK

```bash
cd packages/server
npm install @anthropic-ai/claude-agent-sdk zod
```

Note: `zod` is a peer dependency.

### Step 2: Update Session Manager

**File:** `packages/server/src/services/sessionManager.js`

```javascript
import { query } from '@anthropic-ai/claude-agent-sdk';

export async function runSession(sessionId, prompt, workingDirectory) {
  const controller = new AbortController();
  activeSessions.set(sessionId, { controller, inputResolve: null });

  try {
    sessions.update(sessionId, { status: 'running' });
    broadcastSessionStatus(sessionId, 'running');

    const inputGenerator = createInputGenerator(sessionId, prompt);

    for await (const event of query({
      prompt: inputGenerator,
      options: {
        cwd: workingDirectory,
        abortController: controller,
        includePartialMessages: true,  // For real-time streaming
        permissionMode: 'bypassPermissions',  // Or make configurable
        systemPrompt: `When you generate artifacts that should be displayed on
the canvas (images, markdown documents, code snippets, data visualizations),
POST them to: ${process.env.CLAUDETOOLS_API_URL}/api/sessions/${sessionId}/canvas
Body: {"type": "image|markdown|text|json", "content": "...", "title": "..."}`,
      },
    })) {
      if (controller.signal.aborted) break;
      await handleStreamEvent(sessionId, event);
    }

    // Session completed
    sessions.update(sessionId, { status: 'completed' });
    broadcastSessionStatus(sessionId, 'completed');
  } catch (error) {
    // ... error handling
  }
}
```

### Step 3: Update Event Handler

```javascript
async function handleStreamEvent(sessionId, event) {
  switch (event.type) {
    case 'system': {
      // Store Claude's session_id, model info
      sessions.update(sessionId, {
        claudeSessionId: event.session_id,
        model: event.model
      });
      break;
    }

    case 'assistant': {
      const textContent = event.message?.content
        ?.filter(c => c.type === 'text')
        ?.map(c => c.text)
        ?.join('\n');

      if (textContent) {
        const toolUse = event.message?.content?.filter(c => c.type === 'tool_use');
        const message = messages.create(sessionId, 'assistant', textContent, toolUse);
        broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_MESSAGE, { message });
      }
      break;
    }

    case 'partial': {
      // Real-time streaming - broadcast partial text
      const partialText = event.message?.content
        ?.filter(c => c.type === 'text')
        ?.map(c => c.text)
        ?.join('');

      if (partialText) {
        broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_PARTIAL, {
          sessionId,
          text: partialText
        });
      }
      break;
    }

    case 'result': {
      if (event.subtype === 'error') {
        sessions.update(sessionId, { status: 'error', error: event.error });
        broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_ERROR, { error: event.error });
      } else {
        // Store cost info
        sessions.update(sessionId, { costUsd: event.total_cost_usd });
      }
      break;
    }
  }
}
```

### Step 4: Update Input Generator

```javascript
async function* createInputGenerator(sessionId, initialPrompt) {
  // Yield initial prompt
  yield { role: 'user', content: initialPrompt };

  // Store initial message
  const userMsg = messages.create(sessionId, 'user', initialPrompt);
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_MESSAGE, { message: userMsg });

  while (true) {
    const sessionData = activeSessions.get(sessionId);
    if (!sessionData || sessionData.controller.signal.aborted) {
      return;
    }

    // Signal waiting for input
    sessions.update(sessionId, { status: 'waiting' });
    broadcastSessionStatus(sessionId, 'waiting');

    // Wait for user input
    const input = await new Promise(resolve => {
      const session = activeSessions.get(sessionId);
      if (session) session.inputResolve = resolve;
    });

    yield { role: 'user', content: input };
  }
}
```

### Step 5: Add Canvas POST Endpoint

**File:** `packages/server/src/api/canvas.js`

```javascript
// POST /api/sessions/:id/canvas - For Claude to POST artifacts
router.post('/sessions/:id/canvas', async (req, res) => {
  const { id } = req.params;
  const { type, content, title } = req.body;

  const item = canvasItems.create({
    sessionId: id,
    type,
    content,
    title: title || `Canvas item ${Date.now()}`,
  });

  broadcastToSession(id, WS_MESSAGE_TYPES.CANVAS_ADD, { item });
  res.json({ success: true, item });
});
```

### Step 6: Add Partial Message WebSocket Type

**File:** `packages/shared/src/protocol.js`

```javascript
export const WS_MESSAGE_TYPES = {
  // ... existing
  SESSION_PARTIAL: 'session:partial',  // NEW - for streaming
};
```

### Step 7: Update Frontend for Streaming

**File:** `packages/web/src/components/ConversationTab.vue`

- Add `partialText` ref for current streaming content
- Listen for `session:partial` WebSocket events
- Show typing indicator + partial text while streaming
- Clear partial text when full `assistant` message arrives

### Step 8: Add Cost Column to Sessions

**File:** `packages/server/src/schema.sql`

```sql
ALTER TABLE sessions ADD COLUMN cost_usd REAL DEFAULT 0;
```

## Files to Modify

| File | Changes |
|------|---------|
| `packages/server/package.json` | Add `@anthropic-ai/claude-agent-sdk`, `zod` |
| `packages/server/src/services/sessionManager.js` | Use SDK `query()` function |
| `packages/server/src/api/canvas.js` | Add POST endpoint |
| `packages/shared/src/protocol.js` | Add `SESSION_PARTIAL` message type |
| `packages/web/src/components/ConversationTab.vue` | Handle streaming |
| `packages/web/src/composables/useWebSocket.js` | Handle `session:partial` |
| `packages/server/src/schema.sql` | Add `cost_usd` column |

## Environment Setup

The SDK uses the same auth as Claude CLI. Ensure:
- User is logged in via `claude` CLI, OR
- `ANTHROPIC_API_KEY` environment variable is set

## Testing

1. Start server with `yarn dev`
2. Create a new session with a simple prompt
3. Verify real-time streaming in UI
4. Test multi-turn conversation (send follow-up)
5. Test canvas artifact posting
6. Verify cost tracking

## Future Enhancements

- MCP server for canvas (replace HTTP endpoint)
- Session resume via `--resume` / SDK options
- Model selection in UI
- Permission mode selection in UI
