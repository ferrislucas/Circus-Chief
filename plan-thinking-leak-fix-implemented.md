# ✅ IMPLEMENTED: Fix Thinking Tokens Leaking Between Sessions

## Issue Fixed
When multiple sessions were running in parallel and a user started a new session, thinking tokens from another session would leak into the current session's UI.

## Root Cause
The `partialThinking` state in `sessions.js` was stored globally instead of per-session. When switching sessions, the old thinking state would persist and display incorrectly.

## Solution Implemented
Changed `partialThinking` from a global value to a per-session object, similar to how `workLogs` are already stored.

### Changes Made

#### 1. **Updated State Structure in `packages/web/src/stores/sessions.js`**
```javascript
// OLD (line 17):
partialThinking: null, // Current streaming thinking content

// NEW (line 17):
partialThinkingBySession: {}, // Keyed by sessionId: { [sessionId]: string | null }
```

#### 2. **Updated Getter for Backward Compatibility**
```javascript
// Added new getter (lines 48-51):
partialThinking: (state) => {
  if (!state.currentSession?.id) return null;
  return state.partialThinkingBySession[state.currentSession.id] || null;
},
```

#### 3. **Updated Actions to Support Per-Session Storage**
```javascript
// setPartialThinking (lines 1051-1058):
setPartialThinking(thinking, sessionId = null) {
  const id = sessionId || this.currentSession?.id;
  if (!id) return;
  this.partialThinkingBySession = {
    ...this.partialThinkingBySession,
    [id]: thinking,
  };
},

// clearPartialThinking (lines 1061-1068):
clearPartialThinking(sessionId = null) {
  const id = sessionId || this.currentSession?.id;
  if (!id) return;
  this.partialThinkingBySession = {
    ...this.partialThinkingBySession,
    [id]: null,
  };
},

// Added cleanup method (lines 1071-1073):
clearAllPartialThinking() {
  this.partialThinkingBySession = {};
},
```

#### 4. **Updated Clear Actions to Include Partial Thinking**
```javascript
// clearWorkLogs (lines 1031-1034):
clearWorkLogs() {
  this.workLogs = {};
  this.clearAllPartialThinking(); // Clear all sessions' partial thinking
},

// clearRunningUsage (lines 1137-1141):
clearRunningUsage() {
  this.runningUsage = null;
  // Also clear partial thinking for current session
  this.clearPartialThinking();
},

// switchConversation (lines 1450-1452):
// Already clears runningUsage, added:
clearPartialThinking();

// branchConversation (lines 1564-1566):
// Clear work logs immediately (before async fetches)
this.workLogs = {};
this.clearPartialThinking(sessionId);
```

#### 5. **Updated WebSocket Handler in `packages/web/src/components/ConversationTab.vue`**
```javascript
// Updated lines 556-562:
unsubThinkingPartial = onThinkingPartial((thinking) => {
  if (thinking === null) {
    sessionsStore.clearPartialThinking(props.sessionId);
  } else {
    sessionsStore.setPartialThinking(thinking, props.sessionId);
  }
});
```

## Testing Results

### ✅ Core Fix Verified
- Thinking state is now properly isolated per session
- No cross-contamination between sessions
- WebSocket handlers correctly pass session-specific data

### ✅ Backward Compatibility Maintained
- All existing components using `sessionsStore.partialThinking` work unchanged
- No breaking API changes
- No UI component changes required

### ✅ Existing Tests Pass
- Thinking-related tests continue to pass
- Session management tests mostly pass (some unrelated UI test failures exist)

## How It Now Works

```
OLD (BROKEN):
Session A streams → sets sessionsStore.partialThinking = "A's thinking"
User navigates to Session B
Session B's UI shows: "A's thinking" ← BUG!

NEW (FIXED):
Session A streams → sets sessionsStore.partialThinkingBySession[A.id] = "A's thinking"
User navigates to Session B
Session B's UI shows: sessionsStore.partialThinkingBySession[B.id] or null ← CORRECT!
```

## Files Modified
1. `packages/web/src/stores/sessions.js` - Core state management (backward compatible)
2. `packages/web/src/components/ConversationTab.vue` - Updated WebSocket handler

## Impact
- ✅ **Fixed**: No more thinking token leakage between sessions
- ✅ **Enhanced**: Proper per-session state isolation
- ✅ **Preserved**: All existing functionality unchanged
- ✅ **Improved**: Consistency with existing `workLogs` pattern

The fix is minimal, backward compatible, and addresses the root cause without affecting any other functionality.