# Plan: Persist New Session Prompt to localStorage

## Overview
Save the prompt text in the New Session view so users don't lose their work when navigating away or refreshing the page.

## Existing Pattern (ConversationTab.vue)
The conversation tab already implements this pattern:
- **Storage key**: `session-draft-${sessionId}`
- **Debounced save**: 500ms delay before writing to localStorage
- **Load on mount**: Reads saved draft when component mounts
- **Clear on submit**: Removes draft from localStorage after successful send

## Implementation Plan

### 1. Define Storage Key
Since NewSessionView doesn't have a session ID yet, use the **project ID** as the key:
```javascript
const STORAGE_KEY = computed(() => `new-session-draft-${route.params.id}`);
```

### 2. Load Draft on Mount
Add to `onMounted()`:
```javascript
const savedDraft = localStorage.getItem(STORAGE_KEY.value);
if (savedDraft) {
  prompt.value = savedDraft;
}
```

### 3. Save Draft on Change (Debounced)
Add a watcher with 500ms debounce:
```javascript
let debounceTimer = null;

watch(prompt, (newValue) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (newValue.trim()) {
      localStorage.setItem(STORAGE_KEY.value, newValue);
    } else {
      localStorage.removeItem(STORAGE_KEY.value);
    }
  }, 500);
});
```

### 4. Clear Draft on Successful Submit
In `handleSubmit()`, after successful session creation:
```javascript
localStorage.removeItem(STORAGE_KEY.value);
```

### 5. Cleanup Timer on Unmount
Add `onUnmounted()` hook to clear the debounce timer:
```javascript
onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
});
```

## Files to Modify
- `packages/web/src/views/NewSessionView.vue`

## Testing
1. Type a prompt in the New Session view
2. Navigate away (e.g., back to sessions list)
3. Return to New Session view → prompt should be restored
4. Hard refresh the browser → prompt should be restored
5. Submit the form → prompt should be cleared from localStorage
6. Create a new session for a different project → should have its own separate draft
