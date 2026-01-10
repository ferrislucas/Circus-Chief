# Mobile Canvas View Fix Plan

## Current Issues (from screenshot)

### 1. Action Buttons Overflow
The row containing **Duplicate**, **Star**, **Archive**, and **Delete Session** buttons is overflowing horizontally on mobile. The red "Delete Session" button is cut off on the right side.

**File:** `packages/web/src/views/SessionDetailView.vue`

### 2. Canvas File List Item Layout
The filename "copy_button_fix_plan.md" is wrapping awkwardly across multiple lines in the canvas file list card. The current `flex-wrap: wrap` on `.file-row` combined with `word-break: break-word` on `.file-name` causes poor text layout.

**File:** `packages/web/src/components/CanvasFileList.vue`

### 3. Overall Mobile Spacing
The general spacing and layout could be improved for mobile viewports to make better use of limited screen real estate.

---

## Implementation Plan

### Task 1: Fix Action Buttons Row (SessionDetailView.vue)

**Current code (lines 533-539):**
```css
.session-action-buttons {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
  flex-shrink: 0;
}
```

**Fix:** Add horizontal scrolling for the action buttons on mobile, or make them wrap into a 2x2 grid:

```css
@media (max-width: 640px) {
  .session-action-buttons {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    width: 100%;
    margin-top: 0.75rem;
  }

  .session-action-buttons .btn {
    font-size: 0.8125rem;
    padding: 0.5rem 0.75rem;
    justify-content: center;
  }

  .btn-delete-session {
    grid-column: span 2; /* Full width for delete button */
  }
}
```

**Alternative:** Use horizontal scroll container:
```css
@media (max-width: 640px) {
  .session-action-buttons {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 0.25rem;
    margin-left: 0;
    width: 100%;
  }
}
```

---

### Task 2: Fix Canvas File List Item (CanvasFileList.vue)

**Current issue:** The `.file-row` uses `flex-wrap: wrap` on mobile (line 348) which causes content to wrap oddly.

**Fix:** Restructure the mobile layout to use a two-line approach:

```css
@media (max-width: 640px) {
  .file-row {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    grid-template-rows: auto auto;
    gap: 0.375rem 0.5rem;
    padding: 0.75rem 1rem;
    align-items: center;
  }

  /* Checkbox spans both rows */
  .item-checkbox {
    grid-row: span 2;
    align-self: center;
  }

  /* Icon */
  .file-icon {
    grid-column: 2;
    grid-row: 1;
  }

  /* Filename - full remaining width on first row */
  .file-name {
    grid-column: 2 / -1;
    grid-row: 1;
    font-size: 0.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Second row: metadata */
  .copy-button,
  .version-badge,
  .file-time,
  .file-arrow {
    grid-row: 2;
  }

  .copy-button {
    min-width: 2.25rem;
    min-height: 2.25rem;
  }

  .file-time {
    margin-left: auto;
  }
}
```

**Alternative simpler fix:** Keep filename on single line with ellipsis:
```css
@media (max-width: 640px) {
  .file-row {
    flex-wrap: nowrap; /* Remove wrap */
  }

  .file-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 150px;
  }

  .copy-button {
    min-width: 2.25rem;
    min-height: 2.25rem;
  }

  .file-type {
    display: none;
  }
}
```

---

### Task 3: Improve Branch Line Layout (SessionDetailView.vue)

The `.branch-line` container needs better mobile handling:

```css
@media (max-width: 640px) {
  .branch-line {
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
  }

  .branch-pr-indicators {
    order: 2;
  }

  .session-action-buttons {
    order: 1;
  }
}
```

---

## Recommended Approach

1. **Start with Task 1** - Fix the action buttons overflow first as it's the most visually broken element
2. **Then Task 2** - Improve the canvas file list layout
3. **Finally Task 3** - Polish the overall mobile layout

## Testing Checklist

- [ ] Test on iPhone SE (375px width)
- [ ] Test on iPhone 14 Pro (393px width)
- [ ] Test on iPad Mini (768px width)
- [ ] Verify touch targets are at least 44x44px
- [ ] Check horizontal scrolling doesn't occur unexpectedly
- [ ] Verify text remains readable
- [ ] Test both portrait and landscape orientations

---

## Files to Modify

1. `packages/web/src/views/SessionDetailView.vue` - Action buttons + branch line
2. `packages/web/src/components/CanvasFileList.vue` - File list item layout
3. Potentially `packages/web/src/components/CanvasTab.vue` - If canvas header needs adjustment
