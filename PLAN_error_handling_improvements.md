# Plan: Improve Error Handling UX

## Problem Statement

When a Claude session errors, the UI currently shows:
- A generic "Session error" message with no details
- A "Restart Session" button the user must click to continue

This is problematic because:
1. **No actionable information** - Users don't know what went wrong
2. **Unnecessary friction** - Users must click a button just to continue, when the session could simply be ready for input

## Current Implementation

### What exists:
- **Database**: `sessions.error` column already stores the error message
- **Server**: Error message is captured and broadcasted via WebSocket (`SESSION_ERROR` event with `error` payload)
- **Frontend (ConversationTab.vue lines 196-202)**: Shows static "Session error" text and restart button

### Current code:
```vue
<div v-else-if="sessionsStore.currentSession?.status === 'error'" class="status-message status-error">
  <span>Session error</span>
  <button type="button" class="btn btn-primary btn-restart" @click="handleRestart" :disabled="restarting">
    <span v-if="restarting" class="loading-spinner"></span>
    Restart Session
  </button>
</div>
```

---

## Proposed Solution

### 1. Display the actual error message

Show `sessionsStore.currentSession.error` to the user so they understand what went wrong.

**Changes:**
- Update the error state UI to display the actual error text
- Style it appropriately (collapsible for long errors, copyable)

### 2. Allow continuing without restart

When a session errors, it should still accept user input. The user can:
- Simply type a new message to continue (the "restart" happens automatically)
- See what went wrong to understand context

**Changes:**
- Change status check so `error` status allows sending messages (similar to `waiting` or `stopped`)
- Auto-restart when user sends a message to an errored session
- Keep the explicit "Restart" button as an option, but don't require it

### 3. Error UI improvements

- Show error in a dismissible banner/alert
- Make long errors collapsible (expand/collapse)
- Add "Copy error" button for bug reports
- Consider showing error in a different location (above input vs below messages)

---

## Implementation Tasks

### Task 1: Update `canSendMessage` computed property
**File:** `packages/web/src/components/ConversationTab.vue`

```javascript
// Current (line 286-289):
const canSendMessage = computed(() => {
  const status = sessionsStore.currentSession?.status;
  return status === 'waiting' || status === 'stopped';
});

// Updated:
const canSendMessage = computed(() => {
  const status = sessionsStore.currentSession?.status;
  return status === 'waiting' || status === 'stopped' || status === 'error';
});
```

### Task 2: Update error display UI
**File:** `packages/web/src/components/ConversationTab.vue`

Replace the current error block (lines 196-202) with:

```vue
<!-- Error banner - shown above input form when session has error -->
<div v-if="sessionsStore.currentSession?.status === 'error'" class="error-banner">
  <div class="error-header">
    <span class="error-icon">⚠️</span>
    <span class="error-title">Session Error</span>
    <button
      type="button"
      class="btn-icon btn-copy-error"
      @click="copyError"
      title="Copy error message"
    >
      📋
    </button>
  </div>
  <div class="error-content">
    <pre class="error-message">{{ sessionsStore.currentSession.error || 'Unknown error' }}</pre>
  </div>
  <p class="error-hint">You can continue the conversation below, or try a different approach.</p>
</div>
```

### Task 3: Add error banner styles
**File:** `packages/web/src/components/ConversationTab.vue`

```css
.error-banner {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: var(--border-radius);
  padding: 1rem;
  margin-bottom: 1rem;
}

.error-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.error-icon {
  font-size: 1.25rem;
}

.error-title {
  font-weight: 600;
  color: var(--color-danger, #ef4444);
  flex: 1;
}

.btn-copy-error {
  padding: 0.25rem 0.5rem;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.15s;
}

.btn-copy-error:hover {
  opacity: 1;
}

.error-content {
  background: var(--color-background);
  border-radius: 4px;
  padding: 0.75rem;
  margin-bottom: 0.75rem;
  max-height: 200px;
  overflow-y: auto;
}

.error-message {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, monospace;
}

.error-hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--color-text-soft);
}
```

### Task 4: Add copyError function
**File:** `packages/web/src/components/ConversationTab.vue`

```javascript
async function copyError() {
  const error = sessionsStore.currentSession?.error || 'Unknown error';
  try {
    await navigator.clipboard.writeText(error);
    uiStore.success('Error copied to clipboard');
  } catch (err) {
    uiStore.error('Failed to copy error');
  }
}
```

### Task 5: Remove separate error state block
**File:** `packages/web/src/components/ConversationTab.vue`

Delete lines 196-202 (the `v-else-if="sessionsStore.currentSession?.status === 'error'"` block) since errors will now show as a banner above the input form.

### Task 6: Auto-restart on message send (optional enhancement)
**File:** `packages/web/src/components/ConversationTab.vue`

The current `handleSend` function calls `sessionsStore.sendMessage()` which already handles the server-side logic. The server's `continueSession` should work even for errored sessions.

**Server-side check needed:**
- Verify `packages/server/src/api/sessions.js` POST `/message` endpoint doesn't reject errored sessions

---

## Test Cases

All tests go in `packages/web/src/components/ConversationTab.test.js`

### Test Suite: Error state display

#### Test 1: Error banner displays when session status is error
**Asserts:** Task 2 (Update error display UI)

```javascript
it('displays error banner when session has error status', async () => {
  mockSessionsStore.currentSession = {
    id: 'sess-123',
    status: 'error',
    error: 'API rate limit exceeded',
    mode: 'standard'
  };

  const wrapper = mountComponent();
  await flushAll(wrapper);

  expect(wrapper.find('.error-banner').exists()).toBe(true);
});
```

#### Test 2: Error banner shows actual error message from session
**Asserts:** Task 2 (Error message is displayed, not generic text)

```javascript
it('displays the actual error message from session.error', async () => {
  mockSessionsStore.currentSession = {
    id: 'sess-123',
    status: 'error',
    error: 'Connection timeout after 30 seconds',
    mode: 'standard'
  };

  const wrapper = mountComponent();
  await flushAll(wrapper);

  expect(wrapper.find('.error-message').text()).toBe('Connection timeout after 30 seconds');
});
```

#### Test 3: Error banner shows fallback for missing error message
**Asserts:** Task 2 (Handles null/undefined error gracefully)

```javascript
it('displays "Unknown error" when session.error is null', async () => {
  mockSessionsStore.currentSession = {
    id: 'sess-123',
    status: 'error',
    error: null,
    mode: 'standard'
  };

  const wrapper = mountComponent();
  await flushAll(wrapper);

  expect(wrapper.find('.error-message').text()).toBe('Unknown error');
});
```

#### Test 4: Error banner has copy button
**Asserts:** Task 2, Task 4 (Copy functionality exists)

```javascript
it('displays copy error button in error banner', async () => {
  mockSessionsStore.currentSession = {
    id: 'sess-123',
    status: 'error',
    error: 'Test error',
    mode: 'standard'
  };

  const wrapper = mountComponent();
  await flushAll(wrapper);

  expect(wrapper.find('.btn-copy-error').exists()).toBe(true);
});
```

#### Test 5: Copy button copies error to clipboard
**Asserts:** Task 4 (copyError function works)

```javascript
it('copies error message to clipboard when copy button clicked', async () => {
  const clipboardWriteMock = vi.fn().mockResolvedValue();
  vi.stubGlobal('navigator', { clipboard: { writeText: clipboardWriteMock } });

  mockSessionsStore.currentSession = {
    id: 'sess-123',
    status: 'error',
    error: 'Error to copy',
    mode: 'standard'
  };

  const wrapper = mountComponent();
  await flushAll(wrapper);

  await wrapper.find('.btn-copy-error').trigger('click');
  await flushAll(wrapper);

  expect(clipboardWriteMock).toHaveBeenCalledWith('Error to copy');
  expect(mockUiStore.success).toHaveBeenCalledWith('Error copied to clipboard');
});
```

#### Test 6: Error banner shows helpful hint text
**Asserts:** Task 2 (Hint about continuing is displayed)

```javascript
it('displays hint about continuing conversation in error banner', async () => {
  mockSessionsStore.currentSession = {
    id: 'sess-123',
    status: 'error',
    error: 'Some error',
    mode: 'standard'
  };

  const wrapper = mountComponent();
  await flushAll(wrapper);

  expect(wrapper.find('.error-hint').text()).toContain('continue');
});
```

---

### Test Suite: Input form availability in error state

#### Test 7: Input form is shown when session status is error
**Asserts:** Task 1 (canSendMessage includes 'error')

```javascript
it('renders input form when session status is error', async () => {
  mockSessionsStore.currentSession = {
    id: 'sess-123',
    status: 'error',
    error: 'Some error',
    mode: 'standard'
  };

  const wrapper = mountComponent();
  await flushAll(wrapper);

  expect(wrapper.find('.input-form').exists()).toBe(true);
});
```

#### Test 8: Send button is visible in error state
**Asserts:** Task 1 (User can send messages)

```javascript
it('displays send button when session status is error', async () => {
  mockSessionsStore.currentSession = {
    id: 'sess-123',
    status: 'error',
    error: 'Some error',
    mode: 'standard'
  };

  const wrapper = mountComponent();
  await flushAll(wrapper);

  expect(wrapper.find('.btn-send').exists()).toBe(true);
});
```

#### Test 9: User can type message when session is in error state
**Asserts:** Task 1 (Input is functional)

```javascript
it('allows typing in textarea when session status is error', async () => {
  mockSessionsStore.currentSession = {
    id: 'sess-123',
    status: 'error',
    error: 'Some error',
    mode: 'standard'
  };

  const wrapper = mountComponent();
  await flushAll(wrapper);

  const textarea = wrapper.find('textarea');
  await textarea.setValue('Retry message');

  expect(textarea.element.value).toBe('Retry message');
});
```

#### Test 10: User can send message when session is in error state
**Asserts:** Task 1 (Messages can be sent from error state)

```javascript
it('calls sendMessage when form submitted in error state', async () => {
  mockSessionsStore.currentSession = {
    id: 'sess-123',
    status: 'error',
    error: 'Some error',
    mode: 'standard'
  };

  const wrapper = mountComponent();
  await flushAll(wrapper);

  await wrapper.find('textarea').setValue('Retry message');
  await wrapper.find('form').trigger('submit.prevent');
  await flushAll(wrapper);

  expect(mockSessionsStore.sendMessage).toHaveBeenCalledWith('sess-123', 'Retry message', []);
});
```

---

### Test Suite: Old error UI removed

#### Test 11: Old blocking error state UI is removed
**Asserts:** Task 5 (status-error class no longer blocks input)

```javascript
it('does not show old blocking status-error message', async () => {
  mockSessionsStore.currentSession = {
    id: 'sess-123',
    status: 'error',
    error: 'Some error',
    mode: 'standard'
  };

  const wrapper = mountComponent();
  await flushAll(wrapper);

  // Old UI had .status-message.status-error as a blocking element
  // Now error is shown as a banner above the input form
  expect(wrapper.find('.status-message.status-error').exists()).toBe(false);
});
```

#### Test 12: Old restart button in blocking UI is removed
**Asserts:** Task 5 (btn-restart in old location is gone)

```javascript
it('does not show old restart button that blocked input form', async () => {
  mockSessionsStore.currentSession = {
    id: 'sess-123',
    status: 'error',
    error: 'Some error',
    mode: 'standard'
  };

  const wrapper = mountComponent();
  await flushAll(wrapper);

  // The old .btn-restart was inside .status-error which blocked the input form
  // It should no longer exist in that location
  const statusError = wrapper.find('.status-message.status-error');
  expect(statusError.exists()).toBe(false);
});
```

---

### Test Suite: Error banner styling

#### Test 13: Error banner has proper styling classes
**Asserts:** Task 3 (CSS classes are applied)

```javascript
it('error banner has expected child elements', async () => {
  mockSessionsStore.currentSession = {
    id: 'sess-123',
    status: 'error',
    error: 'Styled error',
    mode: 'standard'
  };

  const wrapper = mountComponent();
  await flushAll(wrapper);

  expect(wrapper.find('.error-banner').exists()).toBe(true);
  expect(wrapper.find('.error-header').exists()).toBe(true);
  expect(wrapper.find('.error-icon').exists()).toBe(true);
  expect(wrapper.find('.error-title').exists()).toBe(true);
  expect(wrapper.find('.error-content').exists()).toBe(true);
  expect(wrapper.find('.error-message').exists()).toBe(true);
  expect(wrapper.find('.error-hint').exists()).toBe(true);
});
```

---

### Test Suite: Edge cases

#### Test 14: Long error messages are contained
**Asserts:** Task 3 (error-content has overflow styles)

```javascript
it('error content container exists for long messages', async () => {
  const longError = 'Error: '.repeat(100) + 'This is a very long error message';
  mockSessionsStore.currentSession = {
    id: 'sess-123',
    status: 'error',
    error: longError,
    mode: 'standard'
  };

  const wrapper = mountComponent();
  await flushAll(wrapper);

  // The .error-content wrapper should contain the long message
  const errorContent = wrapper.find('.error-content');
  expect(errorContent.exists()).toBe(true);
  expect(wrapper.find('.error-message').text()).toBe(longError);
});
```

#### Test 15: Error banner not shown for non-error states
**Asserts:** Regression test - banner only shows for error status

```javascript
it('does not display error banner when session status is waiting', async () => {
  mockSessionsStore.currentSession = {
    id: 'sess-123',
    status: 'waiting',
    mode: 'standard'
  };

  const wrapper = mountComponent();
  await flushAll(wrapper);

  expect(wrapper.find('.error-banner').exists()).toBe(false);
});

it('does not display error banner when session status is running', async () => {
  mockSessionsStore.currentSession = {
    id: 'sess-123',
    status: 'running',
    mode: 'standard'
  };

  const wrapper = mountComponent();
  await flushAll(wrapper);

  expect(wrapper.find('.error-banner').exists()).toBe(false);
});

it('does not display error banner when session status is stopped', async () => {
  mockSessionsStore.currentSession = {
    id: 'sess-123',
    status: 'stopped',
    mode: 'standard'
  };

  const wrapper = mountComponent();
  await flushAll(wrapper);

  expect(wrapper.find('.error-banner').exists()).toBe(false);
});
```

#### Test 16: Copy error handles clipboard failure gracefully
**Asserts:** Task 4 (Error handling in copyError)

```javascript
it('shows error toast when clipboard write fails', async () => {
  const clipboardWriteMock = vi.fn().mockRejectedValue(new Error('Clipboard blocked'));
  vi.stubGlobal('navigator', { clipboard: { writeText: clipboardWriteMock } });

  mockSessionsStore.currentSession = {
    id: 'sess-123',
    status: 'error',
    error: 'Error to copy',
    mode: 'standard'
  };

  const wrapper = mountComponent();
  await flushAll(wrapper);

  await wrapper.find('.btn-copy-error').trigger('click');
  await flushAll(wrapper);

  expect(mockUiStore.error).toHaveBeenCalledWith('Failed to copy error');
});
```

---

## Test Summary

| # | Test Name | Asserts Task |
|---|-----------|--------------|
| 1 | displays error banner when session has error status | Task 2 |
| 2 | displays the actual error message from session.error | Task 2 |
| 3 | displays "Unknown error" when session.error is null | Task 2 |
| 4 | displays copy error button in error banner | Task 2, 4 |
| 5 | copies error message to clipboard when copy button clicked | Task 4 |
| 6 | displays hint about continuing conversation in error banner | Task 2 |
| 7 | renders input form when session status is error | Task 1 |
| 8 | displays send button when session status is error | Task 1 |
| 9 | allows typing in textarea when session status is error | Task 1 |
| 10 | calls sendMessage when form submitted in error state | Task 1 |
| 11 | does not show old blocking status-error message | Task 5 |
| 12 | does not show old restart button that blocked input form | Task 5 |
| 13 | error banner has expected child elements | Task 3 |
| 14 | error content container exists for long messages | Task 3 |
| 15 | does not display error banner for non-error states (3 tests) | Regression |
| 16 | shows error toast when clipboard write fails | Task 4 |

**Total: 18 test cases covering all 5 implementation tasks**

---

## Files to Modify

1. `packages/web/src/components/ConversationTab.vue` - Main changes
2. `packages/server/src/api/sessions.js` - May need to verify error state handling

## Estimated Effort

- **Small-medium**: Most changes are frontend-only
- **Low risk**: No database schema changes needed
- **Backward compatible**: Error field already exists and is populated
