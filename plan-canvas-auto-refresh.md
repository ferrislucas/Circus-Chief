# Plan: Auto-refresh Canvas File Detail View on Update

## Prerequisites

Before starting implementation:

```bash
git fetch origin
git merge origin/main
```

Resolve any merge conflicts before proceeding.

## Problem

When a user is viewing a canvas file in the detail view (`CanvasFileViewer`), and that file is updated (e.g., a new version is added via WebSocket `canvas:add`), the viewer continues showing the stale content. The store knows about the new item, but the viewer doesn't react to it.

## Root Cause

The current flow when a canvas item is added via WebSocket:

1. `onCanvasAdd` fires in `useSessionInitializer.js`
2. `canvasStore.addItem(item)` prepends the new item to `state.items` (the new item **includes** `content` and `data` since the server broadcasts the full item from `canvasItems.create()` → `getById()`)
3. The new item has a **different `id`** but the **same `filename`** as the currently viewed item

The `CanvasFileViewer` only watches `props.item.id` to trigger content fetching. Since the parent (`CanvasTab`) computes `selectedItem` by matching on `route.query.item` (the selected item ID), the viewer continues displaying the old item. Nobody updates the route query to point to the new version.

## Solution

### Approach: Auto-navigate to the latest version when the viewed file is updated

When a new canvas item arrives with the same filename as the currently viewed file, automatically update the route to point to the new item. This mirrors the existing behavior in `uploadFile()` in `CanvasTab.vue`, which already does exactly this for user uploads.

### Changes Required

#### 1. `CanvasTab.vue` — Watch for new canvas items matching the viewed file

Add `watch` to the Vue import (line 111), then add a watcher on `canvasStore.items.length` that detects when a new item arrives for the currently viewed filename and auto-navigates to it.

**Import change:**
```js
import { ref, computed, onMounted, watch } from 'vue';
```

**Add watcher after the existing computed properties (around line 168):**
```js
// Auto-navigate to the latest version when a new version of the viewed file arrives
watch(
  () => canvasStore.items.length,
  () => {
    if (!selectedItem.value) return;

    const currentFilename = selectedItem.value.filename || selectedItem.value.id;

    // Find the latest item with the same filename
    const latest = canvasStore.items
      .filter(i => (i.filename || i.id) === currentFilename)
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    // If the latest version is different from what we're viewing, navigate to it
    if (latest && latest.id !== selectedItemId.value) {
      router.replace({
        query: { ...route.query, item: latest.id }
      });
    }
  }
);
```

**Why `router.replace` instead of `router.push`?** We don't want an auto-refresh to create a new history entry. The user didn't navigate; the content auto-refreshed.

**Why watch `.length`?** The `addItem` store action uses `this.items.unshift(item)`, which mutates the existing array. Vue's `watch` with `deep: false` on an array only fires when the array reference changes. Watching `.length` is a cheap, reliable proxy for "an item was added or removed."

**Edge case — viewing an older version:** If the user manually selected an older version of a file and a new version arrives, this watcher will auto-navigate to the latest version. This is acceptable behavior: the user is being shown the most current state, and can use the version selector to go back to an older version if needed.

#### 2. `CanvasFileViewer.vue` — No changes needed

The existing `watch(() => props.item.id, ...)` watcher with `{ immediate: true }` already handles loading content when the item ID changes. When `CanvasTab` updates the route to the new item ID:

1. `selectedItem` computed recomputes to the new item
2. `CanvasFileViewer` receives the new item as a prop
3. The watcher fires because `item.id` changed
4. The new item arrives from WebSocket with `content` and `data` already populated (the server broadcasts the full item), so the `content === undefined && data === undefined` guard skips the fetch — content renders immediately with no network request

#### 3. `canvas.js` (store) — No changes needed

No cache invalidation is needed. The WebSocket broadcast from the server includes the full item (with `content` and `data`) because `broadcastCanvasUpdate` sends the result of `canvasItems.create()`, which calls `getById()` returning the complete database row. So the new item in the store already has its content, and `CanvasFileViewer` will display it directly without needing `fetchItemContent`.

## Unit Tests

### `CanvasTab.test.js` — Changes Required

#### 1. Extend the router mock to include `replace`

Update the mock at the top of the file (around line 37):

```js
const mockPush = vi.fn();
const mockReplace = vi.fn();
vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
}));
```

#### 2. Add `mockReplace.mockClear()` to beforeEach

Update the `beforeEach` block (around line 90):

```js
mockPush.mockClear();
mockReplace.mockClear();
```

#### 3. Add new test describe block with test cases

Add after the existing `describe('viewer and list behavior', ...)` block:

```js
describe('auto-navigation on WebSocket update', () => {
  it('auto-navigates to new version when viewed file is updated', async () => {
    api.getAllCanvasItems.mockResolvedValue([
      { id: '1', filename: 'doc.md', type: 'markdown', createdAt: 1000 },
    ]);
    mockRoute.query = { item: '1' };

    const wrapper = mountComponent();
    await flushAll(wrapper);

    // Simulate WebSocket delivering a new version
    canvasStore.addItem({ id: '2', filename: 'doc.md', type: 'markdown', createdAt: 2000 });
    await flushAll(wrapper);

    expect(mockReplace).toHaveBeenCalledWith({
      query: { item: '2' }
    });
  });

  it('does not auto-navigate when not viewing any file', async () => {
    api.getAllCanvasItems.mockResolvedValue([
      { id: '1', filename: 'doc.md', type: 'markdown', createdAt: 1000 },
    ]);
    mockRoute.query = {}; // No item selected

    const wrapper = mountComponent();
    await flushAll(wrapper);

    canvasStore.addItem({ id: '2', filename: 'doc.md', type: 'markdown', createdAt: 2000 });
    await flushAll(wrapper);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not auto-navigate when new item is for a different file', async () => {
    api.getAllCanvasItems.mockResolvedValue([
      { id: '1', filename: 'a.md', type: 'markdown', createdAt: 1000 },
    ]);
    mockRoute.query = { item: '1' };

    const wrapper = mountComponent();
    await flushAll(wrapper);

    // New item is for a different file
    canvasStore.addItem({ id: '2', filename: 'b.md', type: 'markdown', createdAt: 2000 });
    await flushAll(wrapper);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('auto-navigates even when viewing an older version', async () => {
    api.getAllCanvasItems.mockResolvedValue([
      { id: '1', filename: 'doc.md', type: 'markdown', createdAt: 1000 },
      { id: '2', filename: 'doc.md', type: 'markdown', createdAt: 2000 },
    ]);
    mockRoute.query = { item: '1' }; // Viewing the older version

    const wrapper = mountComponent();
    await flushAll(wrapper);

    // New version arrives
    canvasStore.addItem({ id: '3', filename: 'doc.md', type: 'markdown', createdAt: 3000 });
    await flushAll(wrapper);

    expect(mockReplace).toHaveBeenCalledWith({
      query: { item: '3' }
    });
  });
});
```

### `canvas.test.js` — No changes needed

The `addItem` action is not being modified, so the existing tests remain valid.

## Files Modified

| File | Change |
|------|--------|
| `packages/web/src/components/CanvasTab.vue` | Add `watch` to import, add watcher on `canvasStore.items.length` |
| `packages/web/src/components/CanvasTab.test.js` | Add `mockReplace` to router mock, add to `beforeEach`, add 4 new test cases |

## Verification Steps

After implementation:

1. Run unit tests: `yarn workspace @claudetools/web test src/components/CanvasTab.test.js`
2. Run all web tests: `yarn workspace @claudetools/web test`
3. Manual verification:
   - Open a canvas file in detail view
   - From another session or via API, add a new version of the same file
   - Verify the viewer auto-updates to show the new version
   - Verify the version selector shows the updated version count
   - Verify browser back button doesn't create extra history entries
