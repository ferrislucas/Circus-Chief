# Session Tree Overlay — Bug Fixes Plan

Three targeted CSS/template fixes in `SessionTreeOverlay.vue`.

---

## 1. Fix horizontal scroll when overlay is active

**Problem:** The page scrolls left/right slightly when the overlay is open.

**Root cause:** When the overlay backdrop appears (`position: fixed; inset: 0`), the underlying page's scrollbar disappears. This causes a layout shift because the body width changes. The overlay content itself may also be slightly wider than the viewport due to padding.

**Fix:**
- Add `overflow-x: hidden` to `.overlay-backdrop` to prevent any horizontal scroll within the overlay itself.
- On mount, set `document.body.style.overflow = 'hidden'` to lock the body and prevent scrollbar-related layout shift. Restore on unmount/close.

**File:** `packages/web/src/components/SessionTreeOverlay.vue`

---

## 2. Don't ellipsis the session name too early in the header

**Problem:** The `.overlay-root-name` element truncates the session name aggressively because `.overlay-header-left` has `min-width: 0` and the name element has `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` with no explicit width allowance.

**Fix:**
- Remove `overflow: hidden`, `text-overflow: ellipsis`, and `white-space: nowrap` from `.overlay-root-name` so the name wraps naturally instead of truncating.
- Alternatively, allow `.overlay-header-left` to take up more space by setting `flex: 1; min-width: 0` and giving `.overlay-root-name` more room (e.g., `max-width: calc(100% - 2rem)`) — but the cleanest approach is simply letting the name wrap, since the header has a fixed width container (max-width: 900px) and there's plenty of room.

**File:** `packages/web/src/components/SessionTreeOverlay.vue`

---

## 3. Make the overlay header sticky

**Problem:** The header scrolls away with the content when the user scrolls down through a long conversation.

**Fix:**
- Make `.overlay-header` sticky with `position: sticky; top: 0; z-index: 10`.
- Since the scrollable container is `.overlay-backdrop` (which has `overflow-y: auto`), sticky positioning inside `.overlay-content` will work relative to that scroll container.
- Ensure the header has a solid background (it already uses `var(--color-background-secondary, #1f2937)`).
- Adjust `margin-top` to `padding-top` on the overlay-content so the sticky header sits flush at the top.

**File:** `packages/web/src/components/SessionTreeOverlay.vue`

---

## Summary of Changes

All changes are in **one file**: `packages/web/src/components/SessionTreeOverlay.vue` (style section + minor script changes for body scroll lock).

| # | What | How |
|---|------|-----|
| 1 | No horizontal scroll | `overflow-x: hidden` on backdrop + body scroll lock on mount/unmount |
| 2 | Don't ellipsis name early | Remove truncation CSS from `.overlay-root-name`, allow natural wrapping |
| 3 | Sticky header | `position: sticky; top: 0; z-index: 10` on `.overlay-header` |
