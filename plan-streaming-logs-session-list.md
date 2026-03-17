# Plan: Streaming Logs in Session List View

## Goal

Display real-time streaming work logs and thinking output for running sessions directly in the session list view. Users should be able to track what's happening across multiple concurrent sessions (parents and children) at a glance, with the ability to collapse the log panel per-session with that preference persisted.

---

## Architecture Overview

### Current State
- **SessionListView** subscribes to project-level WebSocket events only (`SESSION_CREATED`, `SESSION_UPDATED`, `SESSION_DELETED`)
- Streaming data (`SESSION_PARTIAL`, `SESSION_WORK_LOG`, `SESSION_THINKING_PARTIAL`) is only received when subscribed to an individual session via `useSessionSubscription(sessionId)`
- The sessions store already has `partialThinkingBySession` (a map of sessionId → thinking text), but `partialText` and `workLogs` are single-session state (for the detail view)
- `LiveWorkLogPanel.vue` displays work logs with scrolling — but we need a simpler, non-scrollable version

### Key Insight
The session list currently never subscribes to individual sessions. To get streaming logs, we need to subscribe to each running session's WebSocket stream from the list view.

---

## Implementation Plan

### Step 1: Extend Sessions Store — Per-Session Streaming State

**File: `packages/web/src/stores/sessions.js`**

Add new state to track streaming data per-session (not just for the "current" session):

```js
state: {
  // NEW — streaming state keyed by sessionId for list view
  sessionWorkLogs: {},           // { [sessionId]: workLogEntry[] }
  sessionPartialText: {},        // { [sessionId]: string }
  // EXISTING (already per-session)
  partialThinkingBySession: {},  // { [sessionId]: string }

  // NEW — UI preference: which sessions have logs collapsed
  collapsedSessionLogs: new Set(),  // sessionIds where user closed the log panel
}
```

Add new actions:

```js
// Work logs for list view (per-session, capped at ~15 entries)
addSessionWorkLog(sessionId, log) {
  if (!this.sessionWorkLogs[sessionId]) {
    this.sessionWorkLogs[sessionId] = []
  }
  this.sessionWorkLogs[sessionId].push(log)
  // Keep only last 15 entries
  if (this.sessionWorkLogs[sessionId].length > 15) {
    this.sessionWorkLogs[sessionId] = this.sessionWorkLogs[sessionId].slice(-15)
  }
}

setSessionPartialText(sessionId, text) {
  this.sessionPartialText[sessionId] = text
}

clearSessionStreamingState(sessionId) {
  delete this.sessionWorkLogs[sessionId]
  delete this.sessionPartialText[sessionId]
  delete this.partialThinkingBySession[sessionId]
}

// Collapsed state persistence
toggleSessionLogCollapsed(sessionId) {
  if (this.collapsedSessionLogs.has(sessionId)) {
    this.collapsedSessionLogs.delete(sessionId)
  } else {
    this.collapsedSessionLogs.add(sessionId)
  }
  this.saveCollapsedLogState()
}

saveCollapsedLogState() {
  try {
    localStorage.setItem('collapsedSessionLogs', JSON.stringify([...this.collapsedSessionLogs]))
  } catch (e) { /* ignore */ }
}

restoreCollapsedLogState() {
  try {
    const saved = localStorage.getItem('collapsedSessionLogs')
    if (saved) this.collapsedSessionLogs = new Set(JSON.parse(saved))
  } catch (e) { /* ignore */ }
}
```

### Step 2: Create Composable — Subscribe to Running Sessions

**New file: `packages/web/src/composables/useRunningSessionSubscriptions.js`**

This composable watches the session list for running sessions and subscribes to their individual WebSocket streams to receive work logs, partial text, and thinking.

```js
import { watch, onUnmounted, ref } from 'vue'
import { useSessionsStore } from '../stores/sessions'
import { useWebSocket } from './useWebSocket'

export function useRunningSessionSubscriptions() {
  const sessionsStore = useSessionsStore()
  const { useSessionSubscription } = useWebSocket()

  // Track active subscriptions: { [sessionId]: { subscription, cleanup } }
  const activeSubscriptions = ref({})

  function subscribeToSession(sessionId) {
    if (activeSubscriptions.value[sessionId]) return // already subscribed

    const sub = useSessionSubscription(sessionId)
    const cleanups = []

    // Listen for work logs
    cleanups.push(sub.onWorkLog((log) => {
      sessionsStore.addSessionWorkLog(sessionId, log)
    }))

    // Listen for partial text (streaming response)
    cleanups.push(sub.onPartial((data) => {
      sessionsStore.setSessionPartialText(sessionId, data.text)
    }))

    // Listen for thinking
    cleanups.push(sub.onThinkingPartial((data) => {
      sessionsStore.setPartialThinking(data.thinking, sessionId)
    }))

    // Listen for status changes (to clean up when session stops running)
    cleanups.push(sub.onStatus((data) => {
      if (!['running', 'starting'].includes(data.status)) {
        // Session stopped — clear streaming state after a brief delay
        setTimeout(() => {
          sessionsStore.clearSessionStreamingState(sessionId)
        }, 2000)
      }
    }))

    sub.subscribe()

    activeSubscriptions.value[sessionId] = {
      subscription: sub,
      cleanup: () => {
        cleanups.forEach(fn => fn && fn())
        sub.unsubscribe()
      }
    }
  }

  function unsubscribeFromSession(sessionId) {
    const entry = activeSubscriptions.value[sessionId]
    if (entry) {
      entry.cleanup()
      delete activeSubscriptions.value[sessionId]
    }
  }

  // Watch for changes in the session list and subscribe/unsubscribe accordingly
  watch(
    () => sessionsStore.sessions.filter(s => ['running', 'starting'].includes(s.status)).map(s => s.id),
    (runningIds, oldRunningIds = []) => {
      const newIds = runningIds.filter(id => !oldRunningIds.includes(id))
      const removedIds = oldRunningIds.filter(id => !runningIds.includes(id))

      newIds.forEach(id => subscribeToSession(id))
      removedIds.forEach(id => unsubscribeFromSession(id))
    },
    { immediate: true }
  )

  // Cleanup all on unmount
  onUnmounted(() => {
    Object.keys(activeSubscriptions.value).forEach(id => unsubscribeFromSession(id))
  })

  return { activeSubscriptions }
}
```

### Step 3: Create Component — SessionLogStream

**New file: `packages/web/src/components/SessionLogStream.vue`**

A compact, non-scrollable log display embedded in the session card. Shows the most recent ~10-15 lines of work log output and/or thinking, letting old content scroll off the top naturally (via CSS `overflow: hidden` with content anchored to the bottom).

```vue
<template>
  <div v-if="hasContent && !isCollapsed" class="session-log-stream">
    <!-- Collapse toggle bar -->
    <div class="flex items-center justify-between px-3 py-1.5
                bg-gray-800/50 border-t border-gray-700/50 cursor-pointer"
         @click="toggleCollapse">
      <div class="flex items-center gap-2">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span class="text-xs text-gray-400 font-medium">Live Output</span>
      </div>
      <ChevronUpIcon class="w-3.5 h-3.5 text-gray-500" />
    </div>

    <!-- Log content — no scroll, overflow hidden, content anchored to bottom -->
    <div class="log-content px-3 py-2 bg-gray-900/60 border-t border-gray-700/30
                font-mono text-xs text-gray-300 leading-relaxed overflow-hidden"
         style="max-height: 15em;">
      <!-- Use flexbox column-reverse to anchor to bottom -->
      <div class="flex flex-col-reverse">
        <div>
          <!-- Work log entries -->
          <div v-for="log in recentLogs" :key="log.id" class="log-entry">
            <span v-if="log.type === 'tool_use'" class="text-cyan-400/70">▸ {{ log.tool }}</span>
            <span v-if="log.summary" class="text-gray-400 ml-1">{{ log.summary }}</span>
          </div>

          <!-- Thinking (if streaming) -->
          <div v-if="thinking" class="text-amber-400/50 italic truncate">
            💭 {{ thinkingPreview }}
          </div>

          <!-- Partial text (if streaming) -->
          <div v-if="partialText" class="text-gray-300/70 truncate">
            {{ partialTextPreview }}
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Collapsed state — just a small expand button -->
  <div v-else-if="hasContent && isCollapsed"
       class="flex items-center px-3 py-1 border-t border-gray-700/30
              cursor-pointer hover:bg-gray-800/30 transition-colors"
       @click="toggleCollapse">
    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-2" />
    <span class="text-xs text-gray-500">Show live output</span>
    <ChevronDownIcon class="w-3.5 h-3.5 text-gray-500 ml-auto" />
  </div>
</template>
```

**Key design decisions:**
- **No scrollable area**: Uses `overflow: hidden` with `flex-direction: column-reverse` to always show the newest content at the bottom, with old content disappearing off the top
- **max-height: 15em**: Approximately 10-15 lines of monospace text
- **Compact**: Minimal chrome — just a small header bar and the log text
- **Anchored to bottom**: `flex-col-reverse` ensures new content is always visible

### Step 4: Integrate into SessionCard

**File: `packages/web/src/components/SessionCard.vue`**

Add `SessionLogStream` to each session card for running sessions:

```vue
<template>
  <div class="session-card ...">
    <!-- Existing card content (header, summary, etc.) -->
    ...

    <!-- NEW: Streaming log output for running sessions -->
    <SessionLogStream
      v-if="isRunning"
      :session-id="session.id"
    />

    <!-- Existing: Workflow expansion panel -->
    ...

    <!-- NEW: Also show logs for running child sessions in expanded view -->
    <template v-if="isExpanded">
      <div v-for="child in allDescendants" :key="child.id">
        <!-- Existing child row -->
        ...
        <SessionLogStream
          v-if="isChildRunning(child)"
          :session-id="child.id"
        />
      </div>
    </template>
  </div>
</template>
```

The `isRunning` check: `['running', 'starting'].includes(session.status)`

### Step 5: Wire Up in SessionListView

**File: `packages/web/src/views/SessionListView.vue`**

```js
import { useRunningSessionSubscriptions } from '../composables/useRunningSessionSubscriptions'

// In setup:
useRunningSessionSubscriptions()  // Auto-subscribes to all running sessions
sessionsStore.restoreCollapsedLogState()  // Restore collapsed preferences
```

### Step 6: Handle Child Sessions

The composable from Step 2 watches `sessionsStore.sessions` which includes all sessions for the project (both parents and children). Any session with status `running` or `starting` gets subscribed automatically, regardless of whether it's a parent or child.

For the UI, child sessions that are running will show their log stream:
- **If the parent card is expanded**: The child row gets a `SessionLogStream` component
- **If the parent card is collapsed**: The parent card itself could optionally show a summary indicator that children are running (already handled by workflow status badges)

---

## File Changes Summary

| File | Change Type | Description |
|------|------------|-------------|
| `packages/web/src/stores/sessions.js` | **Modify** | Add per-session work logs, partial text state, collapsed log preferences with localStorage persistence |
| `packages/web/src/composables/useRunningSessionSubscriptions.js` | **New** | Composable that auto-subscribes to running sessions' WebSocket streams |
| `packages/web/src/components/SessionLogStream.vue` | **New** | Compact, non-scrollable log display component |
| `packages/web/src/components/SessionCard.vue` | **Modify** | Add `SessionLogStream` for running sessions (parent and children) |
| `packages/web/src/views/SessionListView.vue` | **Modify** | Wire up `useRunningSessionSubscriptions` composable and restore collapsed state |

---

## Edge Cases & Considerations

1. **Multiple running sessions**: Each running session gets its own independent WebSocket subscription and log buffer. The composable handles dynamic subscribe/unsubscribe as sessions start and stop.

2. **Session transitions**: When a session completes, its streaming state is cleared after a 2-second delay (so the user can see the final state briefly).

3. **Performance**: Work logs are capped at 15 entries per session. Partial text is stored as a single string (overwritten, not appended). This keeps memory bounded even with many running sessions.

4. **Reference counting**: `useSessionSubscription` already has built-in reference counting. If a user navigates to a session detail view while the list view is also subscribed, both can coexist without duplicate WebSocket messages.

5. **Collapsed state persistence**: Uses `localStorage` (same pattern as `expandedSessions`) so the preference survives page refreshes and tab closes.

6. **Small screens**: The collapsed state is just a single-line "Show live output" bar. Even when expanded, the max-height of ~15em is reasonable for mobile. The toggle makes it easy to hide if screen space is at a premium.

7. **WebSocket reconnection**: The existing WebSocket reconnection logic re-subscribes to all tracked sessions. The composable uses `useSessionSubscription` which integrates with this system automatically.
