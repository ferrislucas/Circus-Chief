# Command Button Indicator Real-Time Update - COMPLETE ✅

## Summary

Fixed command button status indicators not updating in real-time on the session list view. Found and fixed THREE bugs:

## Bug 1: `showOnList` Not Being Saved ✅ FIXED

**Root Cause:** The `projects.js` API route handler didn't pass `showOnList` to `commandButtons.create()`.

**Location:** `packages/server/src/api/projects.js`

**Fix:** Added `showOnList: result.data.showOnList` to the create call.

## Bug 2: WebSocket `broadcastToProject` Missing ✅ FIXED

**Root Cause:** The `sessions.js` route handler only called `broadcastToSession()` but NOT `broadcastToProject()`. The SessionListView subscribes to the project (not individual sessions), so it never received the command completion messages.

**Location:** `packages/server/src/api/sessions.js` - command run endpoint (lines 1048-1134)

**Fix:** Added `broadcastToProject()` calls for:
- `COMMAND_RUN_OUTPUT` - when output is received
- `COMMAND_RUN_COMPLETE` - when command finishes
- `COMMAND_RUN_ERROR` - when command fails

Also added an initial "running" status broadcast immediately when command starts (before any output), so commands like `sleep 3` that produce no output still show the running indicator.

## Bug 3: WebSocket Message Queue ✅ FIXED

**Root Cause:** The WebSocket `send()` function silently dropped messages if the socket wasn't connected yet. When the page loaded, the `subscribe:project` message was sent before the WebSocket was open, so the subscription was lost.

**Location:** `packages/web/src/composables/useWebSocket.js`

**Fix:** Added an outbound message queue that:
- Queues messages when socket is not open (readyState !== OPEN)
- Flushes all queued messages when socket connects
- Clears queue on disconnect to avoid stale messages

## Files Changed

### Server:
- `packages/server/src/api/projects.js` - Added `showOnList` parameter
- `packages/server/src/api/sessions.js` - Added `broadcastToProject()` calls for command run events

### Web:
- `packages/web/src/composables/useWebSocket.js` - Added outbound message queue

### Test Files:
- `tests/e2e/sessionListButtonIndicators.spec.ts` - E2E test for real-time updates
- `tests/e2e/helpers.ts` - Added `showOnList` support for seedCommandButton

## Verification

All E2E tests pass:
```bash
BASE_URL="http://localhost:5003" npx playwright test tests/e2e/sessionListButtonIndicators.spec.ts
```

### Test Results:
- ✅ should show button status indicator in real-time on session list
- ✅ should show running indicator while command executes
- ✅ should show error indicator when command fails
- ✅ should open modal when clicking status indicator

### Manual Test:
1. Navigate to session list view (`/projects/{id}/sessions`)
2. Have a command button with `showOnList: true`
3. Run the command via API or from another tab
4. Watch the session card - indicator appears in real-time without page refresh!
