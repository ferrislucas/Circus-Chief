# Fix: Scheduled Session Prompt Not Visible in Conversation

## Bug Summary
When a user schedules a session, the prompt they enter is sent to Claude but **is not visible in the conversation**. The conversation appears to start with Claude's response, with no user message showing what was asked.

## Root Cause Analysis

### The Problem Flow
1. **Session Creation** (`SessionRepository.create()` lines 72-76):
   ```javascript
   // Only create initial user message for sessions that start immediately
   // For waiting/scheduled sessions, the message will be created when they start
   if (status !== 'waiting' && status !== 'scheduled') {
     messages.create(id, 'user', prompt, null, conversation.id);
   }
   ```
   - Scheduled sessions skip creating the user message
   - The prompt is stored in `pendingPrompt` field instead

2. **Scheduler Starts Session** (`schedulerService.startScheduledSession()`):
   - Reads `pendingPrompt` from session
   - Clears `pendingPrompt` and sets status to 'starting'
   - Calls `sessionManager.runSession(prompt, ...)`
   - **BUG: Never creates a user message!**

3. **Session Manager** (`sessionManager.runSession()`):
   - Line 696: `// Note: Initial user message is already created in SessionRepository.create()`
   - Assumes message exists, but for scheduled sessions it doesn't!

### Why the `/start` Endpoint Works
The POST `/api/sessions/:id/start` endpoint (lines 449-473 in `sessions.js`) **does** handle this correctly:
```javascript
if (userMessages.length === 0) {
  // Create the initial message from pendingPrompt
  initialMessage = messages.create(session.id, 'user', promptToUse, null, activeConv.id);
  sessions.update(session.id, { pendingPrompt: null });
  broadcastToSession(session.id, WS_MESSAGE_TYPES.MESSAGE_CREATED, {...});
}
```

## Fix Location

### Primary Fix: `schedulerService.js` → `startScheduledSession()`

**File:** `packages/server/src/services/schedulerService.js`

**Current Code (approximate):**
```javascript
async startScheduledSession(sessionId) {
  const session = sessions.getById(sessionId);
  const pendingPrompt = session.pendingPrompt;

  // Clear pending prompt and set status
  sessions.update(sessionId, {
    pendingPrompt: null,
    scheduledAt: null,
    status: 'starting'
  });

  // Start the session
  await this.sessionManager.runSession(sessionId, pendingPrompt, ...);
}
```

**Fixed Code:**
```javascript
async startScheduledSession(sessionId) {
  const session = sessions.getById(sessionId);
  const pendingPrompt = session.pendingPrompt;

  if (!pendingPrompt) {
    throw new Error('No pending prompt found for scheduled session');
  }

  // Get or create active conversation
  const activeConv = conversations.ensureActiveConversation(sessionId);

  // CREATE THE USER MESSAGE (this is the fix!)
  const userMessage = messages.create(sessionId, 'user', pendingPrompt, null, activeConv.id);

  // Broadcast the message so UI updates
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_MESSAGE, {
    message: userMessage,
    conversationId: activeConv.id,
  });

  // Clear pending prompt and set status
  sessions.update(sessionId, {
    pendingPrompt: null,
    scheduledAt: null,
    status: 'starting'
  });

  // Start the session
  await this.sessionManager.runSession(sessionId, pendingPrompt, ...);
}
```

## Implementation Steps

### Step 1: Update `schedulerService.js`
- [ ] Add import for `messages` and `conversations` from database
- [ ] Add import for `broadcastToSession` from websocket
- [ ] Add import for `WS_MESSAGE_TYPES` from shared
- [ ] In `startScheduledSession()`, create user message before calling `runSession()`
- [ ] Broadcast the message creation event

### Step 2: Update E2E Tests
- [ ] Change `expect(userMessagesAfter.length).toBe(0)` to `expect(userMessagesAfter.length).toBeGreaterThan(0)` in test 2
- [ ] Remove `.fail()` from the regression test (test 4)
- [ ] Add assertion that message content matches the prompt

### Step 3: Manual Testing
- [ ] Create a scheduled session via UI
- [ ] Wait for scheduler to start it (or use "Start Now" button)
- [ ] Verify prompt appears as first message in conversation
- [ ] Verify Claude's response follows the user message

## Files to Modify

| File | Change |
|------|--------|
| `packages/server/src/services/schedulerService.js` | Create user message in `startScheduledSession()` |
| `tests/e2e/scheduled-session-prompt-visible.spec.ts` | Update assertions for fixed behavior |

## Testing

Run the E2E tests:
```bash
./scripts/pw.sh test tests/e2e/scheduled-session-prompt-visible.spec.ts
```

After fix:
- Test 1: Should still pass (documents initial state)
- Test 2: Change assertion from `toBe(0)` to `toBeGreaterThan(0)`
- Test 3: Should still pass (workaround still works)
- Test 4: Remove `.fail()` - should now pass

## Risk Assessment

**Low Risk:**
- Change is isolated to scheduler service
- Follows existing pattern from `/start` endpoint
- Has comprehensive E2E test coverage
- No changes to database schema required
