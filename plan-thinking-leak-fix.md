# Plan: Fix Thinking Tokens Leaking Between Sessions

## Problem Description

When multiple sessions are running in parallel and a user starts a new session, they see thinking tokens streaming in from another session until the new session begins streaming.

### Root Cause Analysis

The issue is in how `partialThinking` is stored in the sessions store:

1. **Global state**: `partialThinking` is stored as a global value in `sessions.js` (line 17: `partialThinking: null`)
2. **No per-session isolation**: When switching sessions, the old `partialThinking` value persists
3. **WebSocket handlers filter correctly**: The `onThinkingPartial` handler in `useWebSocket.js` correctly filters by `sessionId` (lines 302-310)
4. **UI displays stale data**: The `LiveWorkLogPanel` displays `sessionsStore.partialThinking` which is global, not session-specific

### Current Flow (Bug Reproduction)

```
Session A (running) → streams thinking → sets sessionsStore.partialThinking = "thinking from A"
User navigates to Session B (waiting)
Session B's UI shows: "thinking from A" ← BUG!
Session B starts → streams thinking → sets sessionsStore.partialThinking = "thinking from B"
Session B's UI now shows: "thinking from B" ← correct, but A's thinking was leaked
```

### Comparison: Work Logs (Correct Implementation)

The work logs store already implements per-session isolation correctly:

```javascript
// In sessions.js
workLogs: {}, // Keyed by messageId: { [messageId]: WorkLog[] }
```

Each session's work logs are stored separately, and unassociated logs use a special `'_unassociated'` key. This prevents cross-session contamination.

## Solution: Per-Session Partial Thinking Storage

### Option 1: Store Partial Thinking Per-Session (Recommended)

Change `partialThinking` from a global value to a per-session object, similar to `workLogs`.

#### Changes Required

**1. Update `packages/web/src/stores/sessions.js`:**

```javascript
// OLD (line 17):
partialThinking: null, // Current streaming thinking content

// NEW:
partialThinkingBySession: {}, // Keyed by sessionId: { [sessionId]: string | null }
```

**2. Update getters in `sessions.js`:**

```javascript
// Add a new getter that returns partial thinking for the current session
partialThinking: (state) => {
  if (!state.currentSession?.id) return null;
  return state.partialThinkingBySession[state.currentSession.id] || null;
},
```

**3. Update actions in `sessions.js`:**

```javascript
// OLD setPartialThinking (line 1051):
setPartialThinking(thinking) {
  this.partialThinking = thinking;
},

// NEW:
setPartialThinking(thinking, sessionId = null) {
  const id = sessionId || this.currentSession?.id;
  if (!id) return;
  this.partialThinkingBySession = {
    ...this.partialThinkingBySession,
    [id]: thinking,
  };
},

// OLD clearPartialThinking (line 1056):
clearPartialThinking() {
  this.partialThinking = null;
},

// NEW:
clearPartialThinking(sessionId = null) {
  const id = sessionId || this.currentSession?.id;
  if (!id) return;
  this.partialThinkingBySession = {
    ...this.partialThinkingBySession,
    [id]: null,
  };
},

// Add new action to clear all partial thinking (for cleanup)
clearAllPartialThinking() {
  this.partialThinkingBySession = {};
},
```

**4. Update WebSocket handler call in `ConversationTab.vue` (line 570-576):**

```javascript
// OLD:
unsubThinkingPartial = onThinkingPartial((thinking) => {
  if (thinking === null) {
    sessionsStore.clearPartialThinking();
  } else {
    sessionsStore.setPartialThinking(thinking);
  }
});

// NEW:
unsubThinkingPartial = onThinkingPartial((thinking) => {
  if (thinking === null) {
    sessionsStore.clearPartialThinking(props.sessionId);
  } else {
    sessionsStore.setPartialThinking(thinking, props.sessionId);
  }
});
```

**5. Update clearWorkLogs in `sessions.js` (line 1031-1034):**

```javascript
// OLD:
clearWorkLogs() {
  this.workLogs = {};
  this.partialThinking = null;
},

// NEW:
clearWorkLogs() {
  this.workLogs = {};
  this.clearAllPartialThinking(); // Clear all sessions' partial thinking
},
```

**6. Update clearRunningUsage in `sessions.js` (line 1137-1139):**

```javascript
// OLD:
clearRunningUsage() {
  this.runningUsage = null;
},

// NEW:
clearRunningUsage() {
  this.runningUsage = null;
  // Also clear partial thinking for current session
  this.clearPartialThinking();
},
```

**7. Update switchConversation in `sessions.js` (line 1450):**

```javascript
// Already clears runningUsage, add:
clearPartialThinking();
```

### Option 2: Clear Partial Thinking on Session Change (Simpler, Less Robust)

An alternative simpler fix is to explicitly clear `partialThinking` when switching sessions.

**Changes Required:**

Add to `SessionDetailView.vue` in the watcher that tracks session ID changes:

```javascript
watch(
  () => route.params.id,
  async (newSessionId, oldSessionId) => {
    if (newSessionId && newSessionId !== oldSessionId) {
      // Clear partial thinking from previous session
      sessionsStore.clearPartialThinking();

      // ... existing code for loading new session
    }
  }
);
```

**Pros:**
- Simpler change
- Fixes the immediate issue

**Cons:**
- Less robust - if a session is still running in background, its thinking state is lost
- Doesn't support having multiple sessions with thinking state preserved

### Option 3: Filter at Display Layer (Least Invasive)

Filter `partialThinking` in `LiveWorkLogPanel` to only show if it belongs to the current session.

**Changes Required:**

This would require passing the current session ID to `LiveWorkLogPanel` and having the WebSocket handler store session ID with the thinking, then filtering at display time.

**Pros:**
- Minimal state changes

**Cons:**
- Requires tracking which session the thinking belongs to
- Doesn't address the root cause (global state)
- More complex to implement correctly

## Recommended Approach

**Option 1** is recommended because:

1. **Consistency**: Matches the existing pattern used for `workLogs`
2. **Isolation**: Properly isolates thinking data per session
3. **Preservation**: Allows thinking state to be preserved when switching between running sessions
4. **Clarity**: Makes the data model explicit (thinking is per-session, not global)

## Testing Plan

1. **Manual Test Case:**
   - Start Session A with thinking enabled
   - While Session A is streaming thinking, navigate to Session B
   - Verify Session B does NOT show Session A's thinking tokens
   - Start Session B with thinking enabled
   - Verify Session B shows its own thinking tokens correctly
   - Navigate back to Session A
   - Verify Session A shows its own thinking (if still running)

2. **Unit Tests:**
   - Add tests for `setPartialThinking` and `clearPartialThinking` with sessionId parameter
   - Add tests for `partialThinking` getter returning session-specific data
   - Add test for `clearAllPartialThinking`

3. **E2E Test:**
   - Create test that starts two sessions in parallel
   - Navigate between sessions while both are running
   - Verify no thinking token leakage between sessions

## Files to Modify

1. `packages/web/src/stores/sessions.js` - Core state management changes
2. `packages/web/src/components/ConversationTab.vue` - Update WebSocket handler call
3. `packages/web/src/components/LiveWorkLogPanel.vue` - No changes needed (already uses `sessionsStore.partialThinking`)

## Estimated Effort

- Implementation: 1-2 hours
- Testing: 1 hour
- Total: 2-3 hours

## Backward Compatibility

- The getter `partialThinking` remains unchanged from the component's perspective
- Internal state changes are encapsulated in the store
- No API changes required
- WebSocket protocol unchanged
