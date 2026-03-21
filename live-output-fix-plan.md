# Fix: Live Output Panel Goes Blank

## Problem

The `SessionLogStream` panel on the session list view frequently goes blank. Content flashes briefly then disappears. This makes it unreliable for monitoring what running sessions are doing.

## Root Causes Identified

There are **4 distinct issues** that combine to cause blanking:

### 1. Thinking is cleared before its work log replacement arrives (CRITICAL)

When a thinking block finishes, `handleContentBlockStop` in `streamEventHandler.js` (line 453) does this:

1. Creates a work log with the completed thinking content (`createWorkLog`)
2. Clears the thinking accumulator
3. Broadcasts `SESSION_THINKING_PARTIAL` with `thinking: null`

The problem: `createWorkLog` broadcasts the `SESSION_WORK_LOG` event, but on the client the thinking-clear (`thinking: null`) can be processed in the same microtask batch as the work log. If Vue renders after the clear but before the work log is added to the store, the panel briefly has no content.

More importantly, the order is already correct (work log first, then clear), but the two events arrive over WebSocket as separate messages. The client processes them sequentially, and the `setPartialThinking(null, sessionId)` removes the thinking display. If the work log happens to be the only content keeping `hasContent` truthy, the panel disappears entirely for one render frame.

**Location:** `streamEventHandler.js` lines 453-470

### 2. Partial text is explicitly cleared to empty string (HIGH)

When an assistant message completes, `handleAssistantTextContent` (line 232-236) broadcasts `SESSION_PARTIAL` with `text: ''`. This clears the streaming text in **all** consumers — both the session detail view (`ConversationTab`) and the session list view (`SessionLogStream`).

The session detail view legitimately needs this clear (to stop showing streaming text after the message is saved). But the session list view doesn't — it shows an activity stream where abrupt blanking is disruptive. The fix must preserve the clear for the detail view while preventing it from blanking the list view.

**Location:** `streamEventHandler.js` lines 232-236

### 3. Session status change triggers premature state wipe (HIGH)

When a session transitions from `running` to `waiting` (turn complete), `useRunningSessionSubscriptions.js` (line 108) schedules `clearSessionStreamingState()` after a 2-second delay. This wipes **all** state: work logs, partial text, thinking, and file counts. If the timeout fires while the user is still reading logs, everything disappears instantly.

**Location:** `useRunningSessionSubscriptions.js` lines 104-118

### 4. Hydration merges are guarded and can silently skip (MEDIUM)

The `hydrateSessionState()` method (line 184-200 in `sessionStreaming.js`) uses guards like `if (!this.sessionWorkLogs[sessionId]?.length)` to avoid overwriting WebSocket data. But if WebSocket events arrive and then get cleared (e.g., by the thinking-clear or status-change wipe), hydration has already run and won't repopulate. The merge should always deduplicate by ID rather than skip entirely.

**Location:** `sessionStreaming.js` lines 184-200

---

## Fix Plan

### Fix 1: Reorder events in `handleContentBlockStop` so work log precedes thinking clear (server-side)

**File:** `packages/server/src/services/streamEventHandler.js`

The current `handleContentBlockStop` already calls `createWorkLog()` before broadcasting the thinking-clear, which is correct. However, the client-side `onThinkingPartial` handler immediately sets thinking to `null`, which can cause a single-frame blank before the `onWorkLog` handler adds the log entry.

**Concrete changes:**

In `useRunningSessionSubscriptions.js`, change the `onThinkingPartial` handler to **ignore** `null`/falsy values. The thinking display should only be cleared when a new work log arrives (which naturally replaces it), or when the session stops. This ensures the thinking text stays visible until something else takes its place.

```js
// Current (line 93-95):
cleanups.push(sub.onThinkingPartial((thinking) => {
  streamingStore.setPartialThinking(thinking, sessionId);
}));

// Fixed:
cleanups.push(sub.onThinkingPartial((thinking) => {
  // Only update when there is actual thinking content.
  // Ignore null/empty clears — thinking is replaced by work logs naturally,
  // or cleared on status change. This prevents blank flashes.
  if (thinking) {
    streamingStore.setPartialThinking(thinking, sessionId);
  }
}));
```

### Fix 2: Don't forward empty partial-text clears to the list-view store (client-side)

**File:** `packages/web/src/composables/useRunningSessionSubscriptions.js`

The server must keep broadcasting `SESSION_PARTIAL` with `text: ''` because the session detail view (`ConversationTab`) depends on it. But the list-view subscription handler should ignore empty-string clears, letting partial text stay visible until a work log or new content replaces it.

**Concrete change:**

```js
// Current (line 87-89):
cleanups.push(sub.onPartial((text) => {
  streamingStore.setSessionPartialText(sessionId, text);
}));

// Fixed:
cleanups.push(sub.onPartial((text) => {
  // Only update when there is actual content. Ignore empty-string clears
  // to prevent blank flashes in the list view. Partial text is naturally
  // replaced by work logs, or cleared on status change.
  if (text) {
    streamingStore.setSessionPartialText(sessionId, text);
  }
}));
```

### Fix 3: Replace full state wipe with ephemeral-only clear on status change (client-side)

**Files:**
- `packages/web/src/composables/useRunningSessionSubscriptions.js`
- `packages/web/src/stores/sessionStreaming.js`

When a session transitions away from `running`/`starting`, only clear ephemeral data (partial text, thinking). Preserve work logs so the panel continues showing the last activity until the component unmounts.

**Concrete changes:**

Add a new action to `sessionStreaming.js`:

```js
/**
 * Clear only ephemeral streaming state (partial text, thinking) for a session.
 * Preserves work logs so the live output panel retains its last content.
 * @param {string} sessionId
 */
clearSessionEphemeralState(sessionId) {
  const { [sessionId]: _pt, ...restPartialText } = this.sessionPartialText;
  this.sessionPartialText = restPartialText;

  const { [sessionId]: _th, ...restThinking } = this.partialThinkingBySession;
  this.partialThinkingBySession = restThinking;
},
```

In `useRunningSessionSubscriptions.js`, change the `onStatus` timeout (line 110) from:
```js
streamingStore.clearSessionStreamingState(sessionId);
```
to:
```js
streamingStore.clearSessionEphemeralState(sessionId);
```

### Fix 4: Make hydration merge work logs by ID instead of skipping (client-side)

**File:** `packages/web/src/stores/sessionStreaming.js`

Change `hydrateSessionState` to always merge work logs (deduplicate by ID) and always set thinking/partial text if the server has content and the client store is empty.

**Concrete change:**

```js
hydrateSessionState(sessionId, { workLogs, partialText, thinking } = {}) {
  // Always merge work logs (deduplicate by id)
  if (workLogs?.length) {
    const existing = this.sessionWorkLogs[sessionId] || [];
    const existingIds = new Set(existing.map(l => l.id));
    const newLogs = workLogs.filter(l => !existingIds.has(l.id));
    if (newLogs.length) {
      this.sessionWorkLogs = {
        ...this.sessionWorkLogs,
        [sessionId]: [...existing, ...newLogs].slice(-15),
      };
    }
  }
  // Set thinking/partial only if server has content and client doesn't.
  // Unlike work logs, these are ephemeral — if the client already has a value,
  // the WebSocket stream is actively providing fresher data.
  if (thinking && !this.partialThinkingBySession[sessionId]) {
    this.partialThinkingBySession = { ...this.partialThinkingBySession, [sessionId]: thinking };
  }
  if (partialText && !this.sessionPartialText[sessionId]) {
    this.sessionPartialText = { ...this.sessionPartialText, [sessionId]: partialText };
  }
},
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/web/src/composables/useRunningSessionSubscriptions.js` | Ignore null/empty in `onThinkingPartial` and `onPartial` handlers; use `clearSessionEphemeralState` instead of `clearSessionStreamingState` on status change |
| `packages/web/src/stores/sessionStreaming.js` | Add `clearSessionEphemeralState` action; rewrite `hydrateSessionState` to merge work logs by ID |

---

## Testing Strategy

### `packages/web/src/stores/sessionStreaming.test.js`

**New tests for `clearSessionEphemeralState`:**

1. `clearSessionEphemeralState clears partialText and thinking but preserves work logs`
   - Setup: add work logs, set partial text, set thinking for session-1
   - Call `clearSessionEphemeralState('session-1')`
   - Assert: work logs still present, partial text empty, thinking null

2. `clearSessionEphemeralState preserves file count`
   - Setup: set file count and ephemeral state
   - Call `clearSessionEphemeralState('session-1')`
   - Assert: file count unchanged

3. `clearSessionEphemeralState does not affect other sessions`
   - Setup: populate state for session-1 and session-2
   - Call `clearSessionEphemeralState('session-1')`
   - Assert: session-2 state completely unchanged

**Updated tests for `hydrateSessionState`:**

4. `hydrateSessionState merges work logs by ID when store already has data`
   - Setup: add work log with id='ws-1' via `addSessionWorkLog`
   - Call `hydrateSessionState('session-1', { workLogs: [{ id: 'rest-1', ... }, { id: 'ws-1', ... }] })`
   - Assert: store has exactly 2 logs (ws-1 and rest-1), no duplicates

5. `hydrateSessionState does not duplicate existing work logs`
   - Setup: add work log with id='log-1' via `addSessionWorkLog`
   - Call `hydrateSessionState('session-1', { workLogs: [{ id: 'log-1', ... }] })`
   - Assert: store still has exactly 1 log

6. `hydrateSessionState respects 15-entry cap when merging`
   - Setup: add 10 work logs via `addSessionWorkLog`
   - Call `hydrateSessionState` with 10 more logs (different IDs)
   - Assert: store has exactly 15 logs (the latest 15)

### `packages/web/src/components/SessionLogStream.test.js`

No changes needed — this file tests the Vue component rendering based on store getters, which remain unchanged.

### `packages/server/src/services/streamEventHandler.test.js`

No server-side code changes are being made, so no server tests need updating. The `handleContentBlockStop` event ordering is already correct (work log broadcast before thinking clear). The fix is entirely on the client side.
