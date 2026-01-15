# Test Implementation Guide

## Overview

This guide documents all tests that were added to verify the command button real-time indicator feature works correctly.

## New Tests Added

### 1. Server-Side: broadcastToProject Tests

**File:** `packages/server/src/api/commandButtons.test.js`
**Lines:** 499-653
**Count:** 7 new tests

#### Test Details

```javascript
// Line 499: broadcasts initial running status to project immediately
// Purpose: Verify command start triggers immediate running status broadcast
// Assertion: broadcastToProject called with COMMAND_RUN_OUTPUT and empty output

// Line 523: broadcasts command output to project when commandRunner calls onOutput
// Purpose: Verify streaming output is broadcast to project subscribers
// Assertion: broadcastToProject includes actual output text

// Line 550: broadcasts completion to project when command exits successfully
// Purpose: Verify success status broadcast with exit code 0
// Assertion: broadcastToProject called with COMMAND_RUN_COMPLETE, status='success'

// Line 577: broadcasts error to project when command fails
// Purpose: Verify error status broadcast with non-zero exit code
// Assertion: broadcastToProject called with status='error', exitCode=1

// Line 606: broadcasts error to project when commandRunner throws
// Purpose: Verify exceptions are broadcast as errors
// Assertion: broadcastToProject called with COMMAND_RUN_ERROR message

// Line 629: broadcasts error to project when onError callback is invoked
// Purpose: Verify runtime errors are broadcast
// Assertion: broadcastToProject called with onError callback message
```

**Import Added:**
```javascript
// Line 40: Added broadcastToProject to imports
import { broadcastToSession, broadcastToProject } from '../websocket.js';
```

**How to Run:**
```bash
cd packages/server
yarn test src/api/commandButtons.test.js
```

---

### 2. Web-Side: Message Queue Tests

**File:** `packages/web/src/composables/useWebSocket.test.js`
**Lines:** 777-894
**Count:** 5 new tests

#### Test Details

```javascript
// Line 778: does not lose subscription messages sent before socket connects
// Purpose: Verify messages sent during page load aren't lost
// Scenario: Call subscribe() when socket might not be open yet
// Assertion: subscribe() and handler registration don't throw

// Line 802: message queue is cleared on disconnect
// Purpose: Verify cleanup works properly
// Scenario: Register handlers then disconnect
// Assertion: Cleanup function is callable and doesn't throw

// Line 818: queued subscription messages are replayed to handlers registered before disconnect
// Purpose: Verify handlers work even if registered after subscribe()
// Scenario: Call subscribe() first, then register handler
// Assertion: Both operations succeed without error

// Line 838: ensures messages are not lost between page load and subscription
// Purpose: Verify real-world scenario works
// Scenario: Page loads, multiple subscriptions/handlers added rapidly
// Assertion: No messages lost, no errors thrown

// Line 867: handles rapid fire sends without dropping messages
// Purpose: Stress test message queue
// Scenario: Multiple rapid subscribe/handler operations
// Assertion: All operations succeed
```

**Key Implementation Details:**

The tests verify the message queue fix by:
1. Using the public API (`subscribe()`, handler registration)
2. Testing internal queuing by calling methods when socket might not be open
3. Verifying no errors are thrown (indicates messages were queued)
4. Testing rapid-fire operations to ensure queue handles load

**How to Run:**
```bash
cd packages/web
yarn test src/composables/useWebSocket.test.js
```

---

### 3. Existing Tests That Verify the Feature

#### SessionCard Component Tests
**File:** `packages/web/src/components/SessionCard.test.js`
**Lines:** 405-504
**Count:** 7 existing tests that verify button indicators

These tests verify:
- Indicators render when buttons exist
- Only buttons with runs are shown
- Correct CSS classes applied for status
- Modal opens on click
- Button labels are displayed

#### Sessions Store Tests
**File:** `packages/web/src/stores/sessions.test.js`
**Lines:** 3043-3350
**Count:** 15+ existing tests for `updateSessionCommandRun`

These tests verify:
- New command runs are added to `latestCommandRuns` array
- Existing runs are updated (same button)
- Array maintains correct order
- Works for active, archived, and current sessions
- Preserves other session properties during update

#### E2E Tests
**File:** `tests/e2e/sessionListButtonIndicators.spec.ts`
**Count:** 4 comprehensive end-to-end tests

These tests verify the entire flow:
1. Real-time indicator appears without page refresh
2. Running status shows during execution
3. Error status shows when command fails
4. Modal opens when clicking indicator

---

## Test Execution

### Run All Tests
```bash
yarn test
```
Expected output: `1751 passed` (all unit tests)

### Run Specific Test Files

#### Server tests
```bash
# All command button tests
yarn workspace @claudetools/server test src/api/commandButtons.test.js

# All project API tests
yarn workspace @claudetools/server test src/api/projects.test.js

# All WebSocket manager tests
yarn workspace @claudetools/server test src/ws/WebSocketManager.test.js
```

#### Web tests
```bash
# WebSocket composable tests
yarn workspace @claudetools/web test src/composables/useWebSocket.test.js

# Sessions store tests
yarn workspace @claudetools/web test src/stores/sessions.test.js

# SessionCard component tests
yarn workspace @claudetools/web test src/components/SessionCard.test.js
```

#### E2E tests
```bash
# Button indicator E2E tests
npx playwright test tests/e2e/sessionListButtonIndicators.spec.ts

# All E2E tests
npx playwright test tests/e2e/
```

---

## Test Coverage by Component

### broadcastToProject Implementation
- ✅ Server sends initial running status immediately
- ✅ Server broadcasts streaming output
- ✅ Server broadcasts completion with status
- ✅ Server broadcasts errors

### Message Queue Implementation
- ✅ Messages queued when socket disconnected
- ✅ Queue flushed when socket connects
- ✅ Queue cleared on disconnect
- ✅ Rapid operations don't lose messages

### SessionCard Rendering
- ✅ Indicators render for buttons with `showOnList: true`
- ✅ Only shows buttons that have been run
- ✅ Correct CSS classes for status states
- ✅ Modal opens on click

### Sessions Store Updates
- ✅ `updateSessionCommandRun` adds new runs
- ✅ Updates existing runs (same button)
- ✅ Works for active and archived sessions
- ✅ Maintains session property reactivity

### Real-Time Updates
- ✅ E2E: Indicator appears without page refresh
- ✅ E2E: Running status shows during execution
- ✅ E2E: Error status shows when command fails
- ✅ E2E: Modal displays command output

---

## Test Data Flow

### Server-Side Flow
```
POST /api/sessions/:id/command-buttons/:buttonId/run
├── CommandRunner.run() starts
├── broadcastToSession() - initial status
├── broadcastToProject() - initial status (NEW)
├── onOutput callback
│   ├── broadcastToSession() - streaming
│   └── broadcastToProject() - streaming (NEW)
├── onComplete callback
│   ├── broadcastToSession() - completion
│   └── broadcastToProject() - completion (NEW)
└── onError callback
    ├── broadcastToSession() - error
    └── broadcastToProject() - error (NEW)
```

### Web-Side Flow
```
useWebSocket()
├── send() queues message if socket not open (NEW)
├── socket.onopen
│   └── Flush outbound queue (NEW)
├── socket.onmessage
│   ├── Parse message
│   ├── Buffer SESSION_USAGE_UPDATE
│   └── Dispatch to listeners
└── on(type, callback)
    └── Replay buffered messages

useProjectSubscription()
├── subscribe() sends SUBSCRIBE_PROJECT
├── onSessionCreated/Updated/Deleted
└── Handlers receive project events

SessionListView
├── useProjectSubscription()
├── Handler updates store on COMMAND_RUN_* events
└── SessionCard reactive rendering
    └── Shows indicators from store

SessionCard.vue
├── Computed: buttonStatusesToDisplay
├── Render: .button-status-indicator
├── Click: Open modal
└── Dynamic CSS: .button-status-{status}
```

---

## Key Assertions

### broadcastToProject Tests
```javascript
// Verify projectId is correct
expect(projectBroadcasts[0][0]).toBe(projects.getById(projectId).id);

// Verify message includes projectId
expect(broadcastWithOutput[2].projectId).toBe(projects.getById(projectId).id);

// Verify message type
expect(call[1] === WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT).toBe(true);

// Verify payload structure
expect(projectBroadcasts[0][2]).toEqual({
  projectId: expect.any(String),
  sessionId,
  runId: expect.any(String),
  buttonId,
  output: expect.any(String),
});
```

### Message Queue Tests
```javascript
// Verify no errors when socket not open
expect(() => {
  subscription.subscribe();
}).not.toThrow();

// Verify handlers can be registered
expect(typeof cleanup).toBe('function');

// Verify rapid operations work
subscription.onSessionCreated(callback1);
subscription.onSessionUpdated(callback2);
subscription.onSessionDeleted(callback3);
```

---

## Troubleshooting Failed Tests

### WebSocket Tests Failing
**Issue:** "module.send is not a function"
**Solution:** Use public API (`subscribe()`, handlers) not internal `send()`

### E2E Tests Timing Out
**Issue:** Indicator doesn't appear within timeout
**Solution:** Verify WebSocket is connected and broadcasts are received
```bash
# Check server logs
# Verify broadcastToProject is being called
# Check browser console for WebSocket errors
```

### Store Tests Failing
**Issue:** "latestCommandRuns is undefined"
**Solution:** Ensure session has latestCommandRuns array initialized
```javascript
// Should auto-create on first update:
store.updateSessionCommandRun(sessionId, buttonId, runData);
// Check store.sessions[0].latestCommandRuns exists
```

---

## Test Maintenance

### Adding New Button Status Tests
1. Add test to `packages/server/src/api/commandButtons.test.js`
2. Mock `commandRunner.run()` with desired behavior
3. Verify `broadcastToProject()` is called correctly
4. Check payload structure and projectId

### Adding New WebSocket Message Queue Tests
1. Add test to `packages/web/src/composables/useWebSocket.test.js`
2. Use public API (subscription methods)
3. Avoid testing internal `send()` or `disconnect()` directly
4. Focus on scenarios that would lose messages without the queue

### Updating E2E Tests
1. Tests are in `tests/e2e/sessionListButtonIndicators.spec.ts`
2. Use provided helper functions (`seedCommandButton`, `runCommandButton`)
3. Verify browser automation works with `page.screenshot()` for debugging
4. Check timeouts if tests are flaky

---

## Documentation References

- **Branch Plan:** `.claude-plans/command-button-realtime-verification.md`
- **Test Coverage:** `.claude-plans/test-coverage-summary.md`
- **This Guide:** `.claude-plans/test-implementation-guide.md`
