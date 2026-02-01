# Fix: Streaming Message State Not Cleared on Conversation Switch

## Problem Summary

When switching between conversations within the same session:
1. A streaming message (dotted border) from Conversation A persists in Conversation B
2. The rogue message remains even after new messages arrive in Conversation B
3. Only a page refresh clears it

## Root Cause Analysis

### Bug #1: `partialText` Not Cleared on Conversation Switch

**Location:** `packages/web/src/components/ConversationTab.vue` (lines 789-805)

The watcher on `activeConversationId` does NOT clear `partialText` when switching conversations:

```javascript
watch(
  () => sessionsStore.activeConversationId,
  async (newConvId, oldConvId) => {
    if (newConvId && newConvId !== oldConvId) {
      // Reset scroll state when switching conversations
      hasNewMessages.value = false;
      isNearBottom.value = true;

      await nextTick();
      await sessionsStore.fetchMessages(props.sessionId, false);
      // ❌ BUG: partialText is NOT cleared here!
    }
  }
);
```

**Why this causes the bug:**
- `partialText` is a component-level ref holding streaming text
- The `.message-streaming` class applies the dotted border when `partialText` has content
- When switching conversations, old `partialText` value persists
- The `onMessage` handler that normally clears it (`partialText.value = ''`) may never fire for the old conversation

### Bug #2: Store's `switchConversation()` Action Not Used

The store has a proper `switchConversation()` action that clears streaming state:

```javascript
// packages/web/src/stores/sessions.js (lines 1476-1507)
async switchConversation(sessionId, conversationId) {
  this.runningUsage = null;           // ✅ Clears token usage
  this.clearPartialThinking();        // ✅ Clears thinking state
  // ... rest of logic
}
```

But the component watcher doesn't use this action - it just fetches messages directly, bypassing proper cleanup.

---

## Implementation Plan

### Step 1: Clear `partialText` When Switching Conversations

**File:** `packages/web/src/components/ConversationTab.vue`

Add `partialText.value = ''` to the `activeConversationId` watcher:

```javascript
watch(
  () => sessionsStore.activeConversationId,
  async (newConvId, oldConvId) => {
    if (newConvId && newConvId !== oldConvId) {
      // Clear streaming message state from previous conversation
      partialText.value = '';  // ← ADD THIS

      // Reset scroll state when switching conversations
      hasNewMessages.value = false;
      isNearBottom.value = true;

      await nextTick();
      await sessionsStore.fetchMessages(props.sessionId, false);
    }
  }
);
```

### Step 2: Also Clear Streaming State When Agent's Turn Ends

**File:** `packages/web/src/components/ConversationTab.vue`

The existing status watcher (lines 746-762) should also ensure streaming state is cleared when the session transitions from `running` to `waiting`/`completed`:

```javascript
watch(
  () => sessionsStore.currentSession?.status,
  async (newStatus, oldStatus) => {
    if (oldStatus === 'running' && (newStatus === 'waiting' || newStatus === 'completed')) {
      // Clear any lingering streaming state
      partialText.value = '';  // ← ADD THIS as a safety net

      await sessionsStore.fetchMessages(props.sessionId, false);
      await sessionsStore.fetchWorkLogs(props.sessionId);
    }
  }
);
```

This ensures even if the WebSocket `onMessage` event is missed, the streaming UI gets cleaned up.

### Step 3: Clear Throttle Timer on Conversation Switch

**File:** `packages/web/src/components/ConversationTab.vue`

The throttle timer for partial updates should also be cleared to prevent stale updates:

```javascript
watch(
  () => sessionsStore.activeConversationId,
  async (newConvId, oldConvId) => {
    if (newConvId && newConvId !== oldConvId) {
      // Clear streaming message state from previous conversation
      partialText.value = '';

      // Clear throttle timer to prevent stale partial updates
      if (partialThrottleTimer) {
        clearTimeout(partialThrottleTimer);
        partialThrottleTimer = null;
      }
      pendingPartialText = null;

      // Reset scroll state
      hasNewMessages.value = false;
      isNearBottom.value = true;

      await nextTick();
      await sessionsStore.fetchMessages(props.sessionId, false);
    }
  }
);
```

---

## Test Cases

Each test case maps directly to an implementation step. These should be E2E tests in `tests/e2e/`.

### Test Case 1: Streaming message cleared on conversation switch (Step 1)

**Maps to:** Step 1 - Clear `partialText` When Switching Conversations

**Setup:**
1. Create a session with two conversations (Conversation A, Conversation B)
2. Send a message in Conversation A that triggers a streaming response
3. Wait until the streaming indicator (dotted border) is visible

**Action:**
- Click to switch to Conversation B while streaming is in progress

**Assertions:**
- [ ] No element with `.message-streaming` class exists in Conversation B
- [ ] No element with `border-style: dashed` exists in the message list
- [ ] The streaming message content from Conversation A is NOT visible in Conversation B

---

### Test Case 2: Streaming state cleared when agent turn completes (Step 2)

**Maps to:** Step 2 - Clear Streaming State When Agent's Turn Ends

**Setup:**
1. Create a session with one conversation
2. Send a message that triggers a streaming response
3. Wait until the streaming indicator (dotted border) is visible

**Action:**
- Wait for the agent's turn to complete (session status changes from `running` to `waiting`)

**Assertions:**
- [ ] No element with `.message-streaming` class exists after status change
- [ ] The final message has a solid border (not dashed)
- [ ] The message content is fully rendered (matches the complete response)

---

### Test Case 3: Throttled partial updates don't leak to new conversation (Step 3)

**Maps to:** Step 3 - Clear Throttle Timer on Conversation Switch

**Setup:**
1. Create a session with two conversations (Conversation A, Conversation B)
2. Send a message in Conversation A that triggers a streaming response
3. Wait until streaming is actively updating (within 150ms throttle window)

**Action:**
- Rapidly switch to Conversation B during active streaming

**Assertions:**
- [ ] No streaming content appears in Conversation B after a 200ms delay (exceeds throttle window)
- [ ] `partialText` ref value is empty string after switch
- [ ] No stale partial content flashes briefly in Conversation B

---

### Test Case 4: Returning to original conversation shows correct state

**Maps to:** All steps - Verify no data corruption

**Setup:**
1. Create a session with two conversations (Conversation A, Conversation B)
2. Send a message in Conversation A that triggers a streaming response
3. Wait until streaming indicator is visible

**Action:**
1. Switch to Conversation B (streaming should clear)
2. Wait for original stream to complete in background
3. Switch back to Conversation A

**Assertions:**
- [ ] Conversation A shows the completed message (solid border)
- [ ] Message content in Conversation A is complete (not truncated)
- [ ] No duplicate messages appear

---

### Test Case 5: Session switch clears all streaming state

**Maps to:** Regression test - Ensure session-level cleanup still works

**Setup:**
1. Create two sessions (Session 1, Session 2)
2. Send a message in Session 1 that triggers a streaming response
3. Wait until streaming indicator is visible

**Action:**
- Navigate to Session 2 (different session entirely)

**Assertions:**
- [ ] No streaming indicator visible in Session 2
- [ ] No content from Session 1 appears in Session 2
- [ ] Session 2 loads its own messages correctly

---

### Test Case 6: Rapid conversation switching doesn't cause race conditions

**Maps to:** Edge case for Steps 1 + 3

**Setup:**
1. Create a session with three conversations (A, B, C)
2. Send a message in Conversation A that triggers streaming

**Action:**
- While streaming: Click A → B → C → B → A rapidly (within 500ms total)

**Assertions:**
- [ ] Final view shows Conversation A's content only
- [ ] No mixed content from multiple conversations
- [ ] No JavaScript errors in console
- [ ] Streaming indicator is correct (present if still streaming, absent if complete)

---

## Test Implementation Notes

**Test file location:** `tests/e2e/streaming-message-cleanup.spec.ts`

**Key selectors to use:**
```typescript
// Streaming message indicator
const streamingMessage = page.locator('.message-streaming');

// Dashed border check
const dashedBorder = page.locator('[style*="border-style: dashed"]');

// Conversation switcher
const conversationTab = page.locator('[data-testid="conversation-tab"]');

// Message content area
const messageList = page.locator('.message-list');
```

**Mock/stub considerations:**
- May need to artificially slow down streaming responses to reliably test mid-stream behavior
- Consider using Playwright's `page.route()` to intercept and delay WebSocket messages
- Use `page.waitForSelector('.message-streaming')` to confirm streaming state before actions

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/web/src/components/ConversationTab.vue` | Add streaming state cleanup in `activeConversationId` watcher and status watcher |

---

## Estimated Effort

- **Code Changes:** ~10 lines
- **Testing:** 30 minutes
- **Risk:** Low - isolated change to cleanup logic
