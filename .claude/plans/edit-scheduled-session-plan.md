# Plan: Add Edit Schedule Icon to Scheduled Sessions List

## Overview
1. Add the ability to edit the schedule of a session directly from the scheduled session list view by adding an edit icon to the `ScheduledSessionCard` component
2. Fix the modal closing issue in `SchedulingEditModal.vue` - currently the modal doesn't close after a successful update

## Current State Analysis

### Components Involved:
1. **`ScheduledSessionCard.vue`** - Displays scheduled sessions in the list
   - Currently has "Start Now" and "Cancel" buttons
   - Does NOT have an edit schedule option

2. **`SchedulingEditModal.vue`** - Modal for editing schedule settings
   - **BUG:** Modal doesn't close on successful update
   - Looking at the code (lines 166-199), `close()` IS called after success, but user reports it doesn't work
   - Need to investigate and fix the close behavior

3. **`SchedulingInfo.vue`** - Uses `SchedulingEditModal` successfully
   - Has an edit button (pencil icon) in the header
   - Can be used as a reference for integration

## Implementation Tasks

### Task 1: Fix Modal Close Issue in SchedulingEditModal.vue

**File:** `packages/web/src/components/SchedulingEditModal.vue`

**Issue:** The modal doesn't close after clicking the Save/Update button on success.

**Investigation needed:**
- The code shows `close()` being called on line 193 after successful save
- The `close()` function emits 'close' event (line 151-153)
- Parent components handle `@close="showEditModal = false"`

**Potential fixes to try:**
1. Ensure `close()` is called unconditionally after success (not dependent on any state)
2. Add `await` to ensure the store update completes before closing
3. Force close by setting a local flag or using `nextTick`

**Proposed fix:** Add error state tracking and ensure modal closes properly:
```javascript
const error = ref(null);

async function handleSave() {
  loading.value = true;
  error.value = null;

  try {
    const updateData = { ... };
    await sessionsStore.updateSessionFields(props.session.id, updateData);
    uiStore.showToast('Settings saved', 'success');
    emit('saved');
    close(); // Close modal on success
  } catch (err) {
    error.value = err.message || 'Failed to save settings';
    uiStore.showToast('Failed to save settings: ' + error.value, 'error');
    // Modal stays open on error
  } finally {
    loading.value = false;
  }
}
```

Also update button text from "Save" to "Update" for clarity.

### Task 2: Add Edit Icon to ScheduledSessionCard

**File:** `packages/web/src/components/ScheduledSessionCard.vue`

**Changes:**
1. Import `SchedulingEditModal` component
2. Add `showEditModal` ref to track modal visibility
3. Add an edit icon button in the card header (next to the status badge)
4. Add the `SchedulingEditModal` component to the template
5. Handle the `@saved` and `@close` events

**Template changes - Add edit button in header:**
```html
<div class="status-badge-container">
  <button @click="showEditModal = true" class="edit-btn" title="Edit schedule">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
    </svg>
  </button>
  <span class="status-badge status-scheduled">scheduled</span>
</div>
```

**Add modal at end of template:**
```html
<SchedulingEditModal
  :is-open="showEditModal"
  :session="session"
  @close="showEditModal = false"
  @saved="handleSaved"
/>
```

**Script changes:**
```javascript
import SchedulingEditModal from './SchedulingEditModal.vue';

const showEditModal = ref(false);

function handleSaved() {
  // Modal handles closing itself
  // Session updates come via WebSocket
}
```

**Style changes:**
```css
.edit-btn {
  background: none;
  border: none;
  color: var(--color-text-soft);
  cursor: pointer;
  padding: 0.25rem;
  border-radius: var(--border-radius, 4px);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s, background 0.2s;
}

.edit-btn:hover {
  color: var(--color-text);
  background: rgba(255, 255, 255, 0.1);
}

.status-badge-container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}
```

## Detailed Implementation Order

1. **First:** Fix `SchedulingEditModal.vue` modal close issue
   - Verify the `close()` function is being called
   - Add error state display in the modal (inline error message)
   - Test that modal closes on success, stays open on error

2. **Second:** Add edit icon to `ScheduledSessionCard.vue`
   - Import modal component
   - Add edit button with pencil/edit icon
   - Wire up modal open/close logic
   - Style the button to match dark theme

## Testing Checklist
- [ ] SchedulingEditModal closes on successful update
- [ ] SchedulingEditModal shows error message on failure
- [ ] SchedulingEditModal stays open on failure
- [ ] Edit icon appears on scheduled session cards in the list
- [ ] Clicking edit icon opens the SchedulingEditModal
- [ ] Modal shows current scheduled time
- [ ] Session list updates after successful edit

## Files Modified
1. `packages/web/src/components/SchedulingEditModal.vue` - Fix close behavior
2. `packages/web/src/components/ScheduledSessionCard.vue` - Add edit icon and modal

## Risk Assessment
- **Low risk** - Using existing, tested modal component
- **Modal fix** - Minimal change, focused on ensuring close() is called properly
- **No breaking changes** - Adding new functionality to existing components
