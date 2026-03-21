# Plan: Add Rename Pencil Icon to Conversation Overlay

## Overview
Add a pencil icon to the SessionTreeOverlay header that allows users to rename the session, matching the existing functionality in SessionHeaderPanel.

## Files to Modify

### 1. `/packages/web/src/components/SessionTreeOverlay.vue`

**Location:** Lines 11-43 (overlay-header section)

**Changes:**

#### a) Add edit state refs (in `<script setup>` section, after existing refs ~line 139)
```javascript
// Name editing state
const isEditingName = ref(false);
const editNameValue = ref('');
const nameEditInput = ref(null);
```

#### b) Add edit functions (after existing methods ~line 400)
```javascript
function startEditName() {
  editNameValue.value = activeSessionName.value;
  isEditingName.value = true;
  nextTick(() => {
    nameEditInput.value?.focus();
  });
}

function cancelEditName() {
  isEditingName.value = false;
  editNameValue.value = '';
}

function clearSessionName() {
  editNameValue.value = '';
  nextTick(() => {
    nameEditInput.value?.focus();
  });
}

async function saveSessionName() {
  const newName = editNameValue.value.trim();
  const sessionId = activeSessionId.value;

  if (!newName) {
    uiStore.error('Session name cannot be empty');
    return;
  }

  try {
    const updated = await api.updateSession(sessionId, {
      name: newName,
      manuallyNamed: true
    });
    sessionsStore.updateSession({ ...updated, id: sessionId });
    uiStore.success('Session name updated');
    isEditingName.value = false;
    editNameValue.value = '';
  } catch (err) {
    uiStore.error(err.message || 'Failed to update session name');
  }
}
```

#### c) Update template header section (lines 11-43)
Replace the header-left div to show either edit form or name + pencil icon:

```vue
<div class="overlay-header-left">
  <!-- Editing mode -->
  <template v-if="isEditingName">
    <div class="name-edit-form">
      <input
        ref="nameEditInput"
        v-model="editNameValue"
        type="text"
        class="name-edit-input"
        placeholder="Session name"
        @keyup.enter="saveSessionName"
        @keyup.escape="cancelEditName"
      />
      <button class="btn-icon pr-edit-btn pr-save-btn" title="Save" @click="saveSessionName">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </button>
      <button class="btn-icon pr-edit-btn pr-cancel-btn" title="Cancel" @click="cancelEditName">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <button v-if="editNameValue" class="btn-icon pr-edit-btn pr-clear-btn" title="Clear name" @click="clearSessionName">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    </div>
  </template>

  <!-- Display mode -->
  <template v-else>
    <div class="session-name-wrapper">
      <span class="overlay-root-name">{{ activeSessionName }}</span>
      <button class="btn-link name-edit-trigger" @click="startEditName" title="Edit session name">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
      </button>
    </div>
  </template>
</div>
```

#### d) Add CSS styles (in `<style scoped>` section, before closing style tag ~line 660)
```css
/* Session name editing styles */
.session-name-wrapper {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex: 1;
  min-width: 0;
}

.name-edit-form {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
}

.name-edit-input {
  background: var(--color-bg-input, #1e1e1e);
  border: 1px solid var(--color-border, #333);
  border-radius: 4px;
  padding: 0.375rem 0.5rem;
  font-size: 0.8125rem;
  color: var(--color-text, #e0e0e0);
  min-width: 200px;
  max-width: 400px;
  flex: 1;
}

.name-edit-input:focus {
  outline: none;
  border-color: var(--color-primary, #00bcd4);
}

.name-edit-input::placeholder {
  color: var(--color-text-soft, #888);
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--color-text-soft, #888);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  flex-shrink: 0;
}

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text, #ccc);
}

.btn-icon:active {
  background: rgba(255, 255, 255, 0.15);
}

.pr-edit-btn {
  width: 28px;
  height: 28px;
}

.pr-save-btn {
  color: var(--color-success, #4caf50);
}

.pr-save-btn:hover {
  background: rgba(76, 175, 80, 0.1);
}

.pr-cancel-btn {
  color: var(--color-text-soft, #888);
}

.pr-cancel-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.pr-clear-btn {
  color: var(--color-error, #f44336);
}

.pr-clear-btn:hover {
  background: rgba(244, 67, 54, 0.1);
}

.name-edit-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  background: none;
  border: none;
  color: var(--color-text-soft, #888);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0.25rem 0.375rem;
  border-radius: 4px;
  transition: color 0.15s, background-color 0.15s;
}

.name-edit-trigger:hover {
  color: var(--color-primary, #00bcd4);
  background: rgba(0, 188, 212, 0.1);
}

.btn-link {
  background: none;
  border: none;
  cursor: pointer;
}
```

### 2. `/tests/e2e/session-tree-overlay.spec.ts`

Add the following test cases to the existing test suite. These mirror the tests from `session-name-editing.spec.ts` but adapted for the overlay context:

```typescript
test.describe('Session Name Editing in Overlay', () => {
  // Add this describe block inside the existing test.describe('Session Tree Overlay')

  test('can edit session name via inline editing in overlay', async ({ page }) => {
    const overlay = await openOverlay(page, parentSession.id);

    // Click the edit pencil icon in overlay header
    await overlay.locator('button.name-edit-trigger').click();

    // Edit input should appear
    const nameInput = overlay.locator('input.name-edit-input');
    await expect(nameInput).toBeVisible();

    // Clear and enter new name
    await nameInput.fill('');
    await nameInput.fill('Updated Overlay Session Name');

    // Click save button
    await overlay.locator('button.pr-save-btn').click();

    // Verify the name was updated in the overlay header
    await expect(overlay.locator('.overlay-root-name')).toHaveText('Updated Overlay Session Name');

    // Verify via API
    const updatedSession = await getSession(parentSession.id);
    expect(updatedSession.name).toBe('Updated Overlay Session Name');
    expect(updatedSession.manuallyNamed).toBe(true);
  });

  test('can edit child session name in overlay', async ({ page }) => {
    const overlay = await openOverlay(page, parentSession.id);

    // Switch to child session via dropdown
    await overlay.locator('.dropdown-trigger').click();
    await overlay.locator(`text=${childSession.name}`).click();

    // Wait for active session to change
    await expect(overlay.locator('.overlay-root-name')).toHaveText(childSession.name);

    // Click edit and rename
    await overlay.locator('button.name-edit-trigger').click();
    await overlay.locator('input.name-edit-input').fill('Renamed Child Session');
    await overlay.locator('button.pr-save-btn').click();

    // Verify child session was renamed
    await expect(overlay.locator('.overlay-root-name')).toHaveText('Renamed Child Session');
    const updatedChild = await getSession(childSession.id);
    expect(updatedChild.name).toBe('Renamed Child Session');
  });

  test('can cancel name editing by pressing Escape', async ({ page }) => {
    const overlay = await openOverlay(page, parentSession.id);

    await overlay.locator('button.name-edit-trigger').click();
    await overlay.locator('input.name-edit-input').fill('Should Not Save');
    await page.keyboard.press('Escape');

    // Verify original name is still shown
    await expect(overlay.locator('.overlay-root-name')).toHaveText(parentSession.name);
    const unchangedSession = await getSession(parentSession.id);
    expect(unchangedSession.name).toBe(parentSession.name);
  });

  test('can cancel name editing by clicking cancel button', async ({ page }) => {
    const overlay = await openOverlay(page, parentSession.id);

    await overlay.locator('button.name-edit-trigger').click();
    await overlay.locator('input.name-edit-input').fill('Should Not Save');
    await overlay.locator('button.pr-cancel-btn').click();

    // Verify original name is still shown
    await expect(overlay.locator('.overlay-root-name')).toHaveText(parentSession.name);
  });

  test('can save name by pressing Enter', async ({ page }) => {
    const overlay = await openOverlay(page, parentSession.id);

    await overlay.locator('button.name-edit-trigger').click();
    await overlay.locator('input.name-edit-input').fill('Saved Via Enter');
    await page.keyboard.press('Enter');

    await expect(overlay.locator('.overlay-root-name')).toHaveText('Saved Via Enter');
    const updatedSession = await getSession(parentSession.id);
    expect(updatedSession.name).toBe('Saved Via Enter');
  });

  test('shows pencil icon for name editing in overlay', async ({ page }) => {
    const overlay = await openOverlay(page, parentSession.id);

    const editTrigger = overlay.locator('button.name-edit-trigger');
    await expect(editTrigger).toBeVisible();
    await expect(editTrigger).toHaveAttribute('title', 'Edit session name');
  });

  test('clear button appears when editing session with name', async ({ page }) => {
    const overlay = await openOverlay(page, parentSession.id);

    // Clear button should not exist when not editing
    await expect(overlay.locator('.name-edit-form button.pr-clear-btn')).toHaveCount(0);

    // Enter edit mode
    await overlay.locator('button.name-edit-trigger').click();

    // Clear button should be visible
    const clearBtn = overlay.locator('.name-edit-form button.pr-clear-btn');
    await expect(clearBtn).toBeVisible();
    await expect(clearBtn).toHaveAttribute('title', 'Clear name');
  });

  test('clicking clear empties the input and keeps edit mode open', async ({ page }) => {
    const overlay = await openOverlay(page, parentSession.id);

    await overlay.locator('button.name-edit-trigger').click();
    const nameInput = overlay.locator('input.name-edit-input');
    await expect(nameInput).toHaveValue(parentSession.name);

    await overlay.locator('.name-edit-form button.pr-clear-btn').click();
    await expect(nameInput).toHaveValue('');
    await expect(nameInput).toBeVisible();
  });

  test('can clear name, type new name, and save', async ({ page }) => {
    const overlay = await openOverlay(page, parentSession.id);

    await overlay.locator('button.name-edit-trigger').click();
    await overlay.locator('.name-edit-form button.pr-clear-btn').click();

    const nameInput = overlay.locator('input.name-edit-input');
    await nameInput.fill('New Name After Clear');
    await overlay.locator('button.pr-save-btn').click();

    await expect(overlay.locator('.overlay-root-name')).toHaveText('New Name After Clear');
    const updatedSession = await getSession(parentSession.id);
    expect(updatedSession.name).toBe('New Name After Clear');
  });

  test('input is focused after clicking clear', async ({ page }) => {
    const overlay = await openOverlay(page, parentSession.id);

    await overlay.locator('button.name-edit-trigger').click();
    await overlay.locator('.name-edit-form button.pr-clear-btn').click();

    // Typing should go into the input
    await page.keyboard.type('Typed After Clear');
    const nameInput = overlay.locator('input.name-edit-input');
    await expect(nameInput).toHaveValue('Typed After Clear');
  });
});
```

**Note:** Add `getSession` helper to the imports if not already present:
```typescript
import { getSession } from './helpers';
```

## Implementation Notes

1. **Reuse existing patterns**: The implementation copies the same edit UI and logic from SessionHeaderPanel.vue for consistency
2. **Session context**: Uses `activeSessionId` instead of `props.sessionId` since the overlay can switch between sessions
3. **Correct session name**: Displays and edits `activeSessionName`, not `rootSessionName` - this allows renaming child sessions when they're active in the overlay
4. **Store integration**: Uses the same `api.updateSession()` and `sessionsStore.updateSession()` pattern
5. **UX consistency**: Same keyboard shortcuts (Enter to save, Escape to cancel), clear button functionality, and visual styling
6. **Toast notifications**: Uses `uiStore.success()` and `uiStore.error()` for user feedback

## Testing Summary

### Manual Testing Checklist
- [ ] Pencil icon appears next to session name in overlay header
- [ ] Clicking pencil icon switches to edit mode
- [ ] Input field is focused when edit mode opens
- [ ] Save button updates the session name
- [ ] Cancel button returns to display mode
- [ ] Enter key saves changes
- [ ] Escape key cancels editing
- [ ] Empty name shows error toast
- [ ] Success toast appears after saving
- [ ] Name change persists after page refresh
- [ ] Edit mode works for both root and descendant sessions
- [ ] Clear button appears when editing a session with a name
- [ ] Clear button is hidden when input is empty
- [ ] Clicking clear empties input and keeps focus
- [ ] Can switch between sessions in overlay and edit each one

### E2E Test Coverage
- 11 new test cases in `session-tree-overlay.spec.ts` covering:
  - Basic editing (save, cancel, keyboard shortcuts)
  - Editing both parent and child sessions
  - Clear button functionality
  - UI element visibility
  - API verification
