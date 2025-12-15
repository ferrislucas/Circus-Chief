# Plan: Fix Session Conversations

## Problem

After sending an initial message to start a session, users cannot send follow-up messages. The conversation is "stuck" with no way to continue the interaction.

## Root Cause

The `sessionManager.js` implementation passes a **simple string prompt** to the Claude SDK's `query()` function:

```javascript
// Current (broken):
for await (const event of query({
  prompt,  // ← Just a string, NOT an async generator
  options: { ... }
})) { ... }
```

This means:
1. The SDK runs once with the initial prompt and then completes
2. The `inputResolve` is never set (it stays `null`)
3. The session status never becomes `'waiting'`
4. The UI never shows the input form (since `canSendMessage` checks for status === 'waiting')

## Solution

According to the SDK documentation in `plan.md`, multi-turn conversations require an **`AsyncIterable<SDKUserMessage>`** as the prompt:

```javascript
// Correct approach:
for await (const event of query({
  prompt: inputGenerator,  // ← Async generator that yields user messages
  options: { ... }
})) { ... }
```

## Implementation Steps

### Step 1: Add `createInputGenerator` function

Add a new async generator function to `sessionManager.js` that:
1. Yields the initial user prompt
2. Updates session status to `'waiting'` after Claude responds
3. Waits for user input via a Promise that `sendMessage()` can resolve
4. Yields subsequent user messages

```javascript
async function* createInputGenerator(sessionId, initialPrompt) {
  // Yield initial prompt
  yield { role: 'user', content: initialPrompt };

  while (true) {
    const sessionData = activeSessions.get(sessionId);
    if (!sessionData || sessionData.controller.signal.aborted) {
      return;
    }

    // Signal waiting for input
    sessions.update(sessionId, { status: 'waiting' });
    broadcastSessionStatus(sessionId, 'waiting');

    // Wait for user input (sendMessage will resolve this)
    const input = await new Promise(resolve => {
      const session = activeSessions.get(sessionId);
      if (session) session.inputResolve = resolve;
    });

    yield { role: 'user', content: input };
  }
}
```

### Step 2: Update `runSession` to use the generator

Change `runSession()` to pass the generator instead of the raw prompt:

```javascript
export async function runSession(sessionId, prompt, workingDirectory) {
  const controller = new AbortController();
  activeSessions.set(sessionId, { controller, inputResolve: null });

  try {
    sessions.update(sessionId, { status: 'running' });
    broadcastSessionStatus(sessionId, 'running');

    // Use async generator for multi-turn support
    const inputGenerator = createInputGenerator(sessionId, prompt);

    for await (const event of query({
      prompt: inputGenerator,  // ← Changed from just 'prompt'
      options: { ... }
    })) {
      // ... rest remains same
    }
  }
}
```

### Step 3: Handle the timing of "waiting" status

The generator currently yields the initial message and immediately sets status to 'waiting'. However, Claude needs time to process. We need to detect when Claude has finished responding before setting 'waiting'.

**Option A**: Set 'waiting' after receiving an `assistant` message (simple but might fire too early if Claude is using tools)

**Option B**: Set 'waiting' after receiving a `result` message with success subtype (more accurate)

**Option C**: The generator naturally pauses at `await new Promise(...)` - when this line is reached, it means the previous yield was consumed and Claude is done processing. This is actually the correct behavior since the generator pauses AFTER yielding, not before.

I recommend verifying the current behavior - the generator approach should naturally work because:
1. `yield { role: 'user', content: initialPrompt }` - SDK receives initial message
2. Generator pauses at `await new Promise(...)` - but only AFTER the SDK has processed the message
3. We set status to 'waiting' and wait for user input

### Step 4: Verify WebSocket event handling

Ensure the frontend properly:
1. Receives `SESSION_STATUS` events with `'waiting'` status
2. Updates `sessionsStore.currentSession.status`
3. Shows the input form when status is `'waiting'`

## Files to Modify

| File | Changes |
|------|---------|
| `packages/server/src/services/sessionManager.js` | Add `createInputGenerator`, update `runSession` to use it |

## Testing

1. Start the development server: `yarn dev`
2. Create a new session with a prompt
3. Wait for Claude to respond
4. Verify the input form appears (status should be 'waiting')
5. Send a follow-up message
6. Verify the conversation continues

## Notes

- The initial user message is already created in `SessionRepository.create()` (see line 38 comment)
- The generator should NOT create a duplicate initial message
- The `sendMessage()` function already handles broadcasting the user message (line 91-92)
