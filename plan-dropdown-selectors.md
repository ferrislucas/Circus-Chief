# Plan: Convert Model and Mode Selectors to Dropdowns

## Overview

Convert the current button-group style selectors for **Model** and **Mode** to native `<select>` dropdowns for a more compact and conventional UI.

---

## Current State

### Model Selector (`ModelSelector.vue`)
- **Location**: `packages/web/src/components/ModelSelector.vue`
- **UI**: Button group with 3 buttons (Sonnet 4.5, Opus 4.5, Haiku 4.5)
- **Used in**:
  - `NewSessionView.vue` (line 81)
  - `ConversationTab.vue` (line 162)

### Mode Selector (inline code, duplicated)
- **Locations**:
  - `NewSessionView.vue` (lines 62-78)
  - `ConversationTab.vue` (lines 123-138)
- **UI**: Button group with 3 buttons (Plan, Standard, YOLO)
- **No reusable component exists** - code is duplicated in both files

---

## Implementation Steps

### Phase 1: Update ModelSelector Component

**File**: `packages/web/src/components/ModelSelector.vue`

1. Replace button group template with a `<select>` dropdown:
   ```vue
   <select
     v-model="selectedModel"
     @change="handleModelChange($event.target.value)"
     :disabled="disabled || togglingModel"
     class="model-select"
   >
     <option v-for="m in models" :key="m.id" :value="m.id">
       {{ m.name }}
     </option>
   </select>
   ```

2. Update styles to match dark theme (similar to existing `form-input` styles)

3. Ensure the "Model:" label is preserved

---

### Phase 2: Create ModeSelector Component

**New file**: `packages/web/src/components/ModeSelector.vue`

1. Create a new reusable component following the same pattern as ModelSelector

2. Accept props:
   - `sessionId` (for existing session context)
   - `modelValue` (for v-model in form context)
   - `disabled`

3. Use `<select>` dropdown with options:
   - Plan - "Agent plans before implementing"
   - Standard - "Balanced approach"
   - YOLO - "Auto-approve mode"

4. Handle both session updates (via store) and form binding (via v-model)

---

### Phase 3: Update NewSessionView

**File**: `packages/web/src/views/NewSessionView.vue`

1. Import the new `ModeSelector` component

2. Replace inline mode button group (lines 62-78) with:
   ```vue
   <ModeSelector v-model="mode" />
   ```

3. Remove the inline `modes` array (or keep for reference if needed elsewhere)

4. Remove related CSS for `.mode-selector`, `.mode-buttons`, `.mode-btn`

---

### Phase 4: Update ConversationTab

**File**: `packages/web/src/components/ConversationTab.vue`

1. Import the new `ModeSelector` component

2. Replace inline mode switcher (lines 123-138) with:
   ```vue
   <ModeSelector :sessionId="sessionId" :disabled="togglingMode" />
   ```

3. Remove the inline `modes` array and `handleModeChange` function (ModeSelector handles this)

4. Remove related CSS for `.mode-switcher`, `.mode-buttons`, `.mode-btn`

---

### Phase 5: Styling Consistency

Ensure both dropdowns follow the dark theme design:

```css
.model-select,
.mode-select {
  appearance: none;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  padding: 0.375rem 2rem 0.375rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--color-text);
  cursor: pointer;
  background-image: url("data:image/svg+xml,..."); /* chevron icon */
  background-repeat: no-repeat;
  background-position: right 0.5rem center;
}

.model-select:hover:not(:disabled),
.mode-select:hover:not(:disabled) {
  border-color: var(--color-border-hover);
  background-color: var(--color-bg-hover);
}

.model-select:disabled,
.mode-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

---

### Phase 6: Update Tests

1. **ModelSelector.test.js** - Update to test dropdown behavior instead of buttons
2. **Create ModeSelector.test.js** - New test file for the new component
3. **NewSessionView.test.js** - Update any tests that interact with mode selector
4. **ConversationTab.test.js** - Update any tests that interact with mode selector

---

## Files to Modify

| File | Action |
|------|--------|
| `packages/web/src/components/ModelSelector.vue` | Refactor button group to dropdown |
| `packages/web/src/components/ModeSelector.vue` | **Create new file** |
| `packages/web/src/views/NewSessionView.vue` | Use ModeSelector, remove inline code |
| `packages/web/src/components/ConversationTab.vue` | Use ModeSelector, remove inline code |
| `packages/web/src/components/ModelSelector.test.js` | Update tests |
| `packages/web/src/components/ModeSelector.test.js` | **Create new file** |

---

## Benefits

1. **More compact UI** - Dropdowns take less horizontal space
2. **DRY principle** - ModeSelector eliminates duplicated code
3. **Consistency** - Both selectors will have matching UI patterns
4. **Accessibility** - Native select elements have built-in keyboard navigation
5. **Mobile friendly** - Native dropdowns work better on touch devices

---

## Estimated Effort

- Phase 1 (ModelSelector): ~30 minutes
- Phase 2 (ModeSelector): ~45 minutes
- Phase 3 (NewSessionView): ~15 minutes
- Phase 4 (ConversationTab): ~15 minutes
- Phase 5 (Styling): ~20 minutes
- Phase 6 (Tests): ~30 minutes

**Total: ~2.5 hours**
