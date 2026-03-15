# Plan: Queue Prompt & Template While Model is Working

## Problem

Currently, when a session is in the `running` state, the prompt input and orchestration panel (including the template selector) are hidden. They're replaced by the "Claude is working..." UI. This means users cannot:

1. Type their next prompt while the model works
2. Select/change a next template while the model works

The user must wait for the model turn to finish before entering a prompt or selecting a template.

## Goal

Allow users to **queue a prompt** and **select a next template** while the session is in `running` state. When the model turn finishes:
- If a prompt was queued, it **auto-sends immediately** (no extra click)
- If a template was selected/changed, it's already persisted and triggers as normal

## Current Architecture

### UI Flow (ConversationTab.vue, lines 119-238)

The template is structured as a `v-if` / `v-else-if`:

```
<form v-if="canSendMessage || isScheduledForFuture">
  <!-- textarea, send button, orchestration panel (template selector) -->
</form>

<div v-else-if="status === 'running'" class="running-state">
  <!-- "Claude is working..." spinner, work logs, template indicator -->
</div>
```

- `canSendMessage` returns `true` only for `waiting`, `scheduled`, `stopped`, `error`
- When `running`, the form is **hidden entirely** and the running-state div is shown instead

### Template Selector (OrchestrationPanel.vue, line 44)

The template selector has `:disabled="sessionStatus === 'running'"`, but it's moot because the entire OrchestrationPanel is only rendered when `canSendMessage` is true.

### Pending Prompt (already exists)

The system already has a `pendingPrompt` field on sessions:
- Auto-saved via debounced `savePendingPrompt()` (500ms) to `PATCH /sessions/:id/pending-prompt`
- Loaded on mount from `session.pendingPrompt`
- Used by the scheduler service to send messages on schedule

### Status Watcher (ConversationTab.vue, lines 596-609)

Already watches for `running → waiting/completed` transitions to refetch messages:

```js
watch(
  () => sessionsStore.currentSession?.status,
  async (newStatus, oldStatus) => {
    if (oldStatus === 'running' && (newStatus === 'waiting' || newStatus === 'completed')) {
      sessionsStore.clearPartialText();
      await sessionsStore.fetchMessages(props.sessionId, false, sessionsStore.activeConversationId);
      await sessionsStore.fetchWorkLogs(props.sessionId);
    }
  }
);
```

### Server-side Constraints

- `POST /sessions/:id/message` rejects messages if status is not `waiting`, `stopped`, or `error` (line 329)
- `PATCH /sessions/:id` (which updates `nextTemplateId`) has **no status restriction** — templates can already be updated while running via the API
- `PATCH /sessions/:id/pending-prompt` has **no status restriction** — auto-save works during running

## Implementation Plan

### Step 1: Restructure ConversationTab.vue Template

**Goal:** Show the prompt input and orchestration panel alongside the running state, not exclusively.

Change from exclusive `v-if` / `v-else-if` to showing both simultaneously:

```html
<!-- Running state indicator (work logs, stop button) -->
<div v-if="status === 'running'" class="running-state">
  <!-- spinner, work logs, stop button - same as today -->
</div>

<!-- Input form - now shown during running too -->
<form v-if="showInputForm" @submit.prevent="handleFormSubmit">
  <!-- textarea, queue/send button, orchestration panel -->
</form>
```

**Key changes:**
- The running-state div and the input form are **no longer mutually exclusive** (`v-if` / `v-else-if` becomes two independent `v-if` blocks)
- The running state shows above the form during `running`
- The form appears during `running` state too

### Step 2: Add `showInputForm` Computed Property

Add a new computed that's broader than `canSendMessage` — it controls form visibility:

```js
const showInputForm = computed(() => {
  const status = sessionsStore.currentSession?.status;
  return status === 'waiting' || status === 'scheduled'
    || status === 'stopped' || status === 'error'
    || status === 'running';
});
```

Keep `canSendMessage` unchanged (still excludes `running`). It will be used to determine the button label/behavior.

### Step 3: Add Queue State and Auto-Send Logic

Add a `promptQueued` ref to track whether the user has explicitly queued a prompt:

```js
const promptQueued = ref(false);
```

**Queue action:** When the user clicks the button during `running`, set `promptQueued = true`. The button label changes to "Queued" to confirm.

**Auto-send on turn completion:** Extend the existing status watcher (lines 596-609) to auto-send when transitioning from `running` to `waiting`:

```js
watch(
  () => sessionsStore.currentSession?.status,
  async (newStatus, oldStatus) => {
    if (oldStatus === 'running' && (newStatus === 'waiting' || newStatus === 'completed')) {
      sessionsStore.clearPartialText();
      await sessionsStore.fetchMessages(props.sessionId, false, sessionsStore.activeConversationId);
      await sessionsStore.fetchWorkLogs(props.sessionId);

      // Auto-send queued prompt
      if (promptQueued.value && newStatus === 'waiting') {
        promptQueued.value = false;
        await nextTick(); // Let UI update first
        await handleSend();
      }
    }
  }
);
```

### Step 4: Update Send Button to Show Queue/Send States

The button changes behavior based on session status:

| Status | Button Label | Button Action | Enabled When |
|--------|-------------|---------------|-------------|
| `waiting` / `stopped` / `error` | **Send** | Calls `handleSend()` immediately | Input has content |
| `running` (not yet queued) | **Queue** | Sets `promptQueued = true` | Input has content |
| `running` (already queued) | **Queued ✓** | Unqueues (`promptQueued = false`) | Always (acts as toggle) |

```js
const isRunning = computed(() => sessionsStore.currentSession?.status === 'running');

const sendButtonLabel = computed(() => {
  if (isRunning.value) {
    return promptQueued.value ? 'Queued ✓' : 'Queue';
  }
  return sending.value ? 'Sending...' : 'Send';
});
```

Update `isSendDisabled`:
```js
const isSendDisabled = computed(() => {
  if (isRunning.value) {
    // During running: disable Queue button only if no input content
    // (unless already queued, then button acts as unqueue toggle)
    return !promptQueued.value && !inputHasContent.value;
  }
  // Existing logic for non-running states
  return !inputHasContent.value || sending.value;
});
```

**Form submit handler** — route to queue or send:
```js
function handleFormSubmit() {
  if (isDraft.value || isScheduledDraft.value) {
    handleStart();
  } else if (isRunning.value) {
    handleQueueToggle();
  } else {
    handleSend();
  }
}

function handleQueueToggle() {
  promptQueued.value = !promptQueued.value;
}
```

### Step 5: Remove Template Selector Disabled State

In **OrchestrationPanel.vue**, remove the disabled-during-running restriction since we now want users to change templates while running:

```diff
- :disabled="sessionStatus === 'running'"
```

### Step 6: Keep the "Next: template-name" Indicator in Running State

The existing template indicator inside the running-state div (lines 227-237) should remain as a quick-glance status since the orchestration panel may be collapsed.

### Step 7: Clear Queue State on Relevant Transitions

Reset `promptQueued` when appropriate:
- On successful send: already handled (handleSend clears input)
- If user stops the session: reset `promptQueued = false`
- If session errors: reset `promptQueued = false`

```js
watch(
  () => sessionsStore.currentSession?.status,
  (newStatus, oldStatus) => {
    // Reset queue state if session stops or errors
    if (newStatus === 'stopped' || newStatus === 'error') {
      promptQueued.value = false;
    }
  }
);
```

(This can be merged into the existing status watcher.)

### Step 8: Style Adjustments

- The input form during `running` should look normal (not dimmed) — the user is actively interacting with it
- The button should clearly communicate queue state:
  - "Queue" — standard secondary/primary style
  - "Queued ✓" — success-style (green/emerald accent) to confirm the prompt is queued
- A subtle separator or spacing between the running indicator and the input form

## Files to Modify

| File | Changes |
|------|---------|
| `packages/web/src/components/ConversationTab.vue` | Restructure template (`v-if`/`v-else-if` → two `v-if` blocks); add `showInputForm`, `promptQueued`, `isRunning` computeds; add `handleQueueToggle()`; extend status watcher for auto-send; update button labels |
| `packages/web/src/components/OrchestrationPanel.vue` | Remove `:disabled="sessionStatus === 'running'"` from template selector |

## Files That Need NO Changes

| File | Why |
|------|-----|
| Server API (`sessions.js`) | `PATCH /sessions/:id` already allows template updates during running; `pending-prompt` has no status check; `POST /message` correctly requires `waiting` (the auto-send fires after status transitions to `waiting`) |
| `sessionManager.js` | Template triggering reads `nextTemplateId` at turn completion — already works |
| `templateTriggerService.js` | No changes needed |
| `streamEventHandler.js` | Turn completion already transitions to `waiting` before template trigger |
| `stores/sessions.js` | `updateNextTemplate()` and `sendMessage()` already work correctly |

## Edge Cases

1. **User queues prompt, then stops the session:** `promptQueued` resets to false on stop/error transitions. Typed text remains in the textarea.
2. **User queues prompt, session completes (no more waiting):** The watcher only auto-sends when `newStatus === 'waiting'`, not `completed`. If the session completes, the prompt stays in the textarea but doesn't auto-send.
3. **Template trigger + queued prompt:** Template trigger happens first (in `handleTurnCompletion` on the server before status transitions). The queued prompt auto-send happens after the status reaches `waiting` on the frontend. Since the template trigger creates a *new child session*, these don't conflict — the prompt is sent to the current session, the template spawns a separate session.
4. **User edits queued prompt:** The user can continue editing after clicking Queue. The auto-send reads the current textarea value at send time via `handleSend()`.
5. **Pending prompt auto-save during running:** Already works — the debounced save has no status check. The queued prompt is auto-saved to the server as a side effect of normal typing.

## Testing

1. **Queue and auto-send:** Start a session → while running, type a prompt and click "Queue" → verify button shows "Queued ✓" → when turn completes, prompt auto-sends without user interaction
2. **Unqueue:** Click "Queue" then click "Queued ✓" → verify it unqueues (button returns to "Queue") → turn completes, prompt does NOT auto-send
3. **Template change while running:** Change template during running → verify it takes effect on turn completion
4. **Edit after queueing:** Queue a prompt, then edit the text → verify the edited version is what gets sent
5. **Stop while queued:** Queue a prompt, then stop the session → verify queue state resets, prompt stays in textarea
6. **Session completes while queued:** Queue a prompt on a session that completes (rather than waiting) → verify prompt does NOT auto-send
