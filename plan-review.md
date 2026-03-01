# Plan Review: Issue #576

## Overall Assessment

The plan is solid and its assumptions match the code. Below are the issues I found, from most important to least.

---

## Issue 1: Route ordering — new `/content` endpoint will be swallowed

**Severity: Blocking**

The plan proposes `GET /:id/canvas/file/:filename/content`. But Express sees `content` as just another `:version` parameter in the **already-defined** route:

```
GET /:id/canvas/file/:filename/history/:version   (line 317)
GET /:id/canvas/file/:filename                    (line 392)
```

A request to `/canvas/file/foo.txt/content` will match the catch-all `/:id/canvas/file/:filename` route with `filename = "foo.txt"` — wait, actually no. Express would not match `/file/foo.txt/content` to `/file/:filename` because that route expects exactly one segment after `/file/`. Let's look more carefully:

- `/:id/canvas/file/:filename/history/:version` — matches `/file/foo.txt/history/1`
- `/:id/canvas/file/:filename` — matches `/file/foo.txt`
- `/:id/canvas/file/:filename/content` — matches `/file/foo.txt/content`

Since `/content` is a fixed string (not a param), it won't collide with `/history/:version` which has TWO more path segments. And `/:id/canvas/file/:filename` only matches paths with exactly one segment after `/file/`. So **this actually works fine** — BUT the new route must be defined **before** the `/:id/canvas/file/:filename` route (line 392), just like the `/history/:version` route is. The plan doesn't call this out. If it's placed at the end of the file, it might work because Express matches by registration order, and `/:id/canvas/file/:filename` has fewer segments — but it's fragile and should be explicit.

**Recommendation:** The plan should specify that the new `/content` endpoint must be defined **before** line 392 (the `/:id/canvas/file/:filename` route), right next to the `/history/:version` route. Add a note about this.

---

## Issue 2: Version selection in CanvasFileViewer needs content fetch

**Severity: Medium**

The plan covers fetching content when `item.content`/`item.data` is `undefined` on mount. But it doesn't address **version switching**. When the user selects a different version via the version dropdown (`selectVersion` event), the component switches to a different item from `selectedVersions`. That version item also won't have content (it came from the same stripped list response).

Looking at the code flow:
1. `CanvasTab.vue` lines 152-158: `selectedVersions` is computed from `canvasStore.items` — ALL versions for the selected file
2. `CanvasFileViewer.vue` receives `versions` prop and emits `selectVersion(itemId)`
3. `CanvasTab.vue` handles it by updating the route query `?item=itemId`
4. This changes `selectedItem` to a different item in the store — which also won't have content

The plan's `watch(needsContent, ...)` approach should handle this IF the watcher re-fires when `item` prop changes. Since `needsContent` is a computed based on `item.value`, changing the item should trigger a re-evaluation. **But this needs to be explicit in the plan** — the watcher must watch the item prop itself (not just `needsContent`) to handle the case where a user switches from one content-less version to another content-less version (both have `undefined` content, so `needsContent` doesn't change from `true` to `true` — Vue watchers don't fire when the value stays the same).

**Recommendation:** Watch `() => item.value.id` or `() => item.value` directly, and fetch content when it changes. The `needsContent` computed alone is insufficient.

---

## Issue 3: `CanvasFileList` already has `sessionId` access via the store — no prop needed

**Severity: Low (simplification)**

The plan says to "accept `sessionId` as a prop" for `CanvasFileList.vue` and `CanvasFileViewer.vue`. But `CanvasFileList` already imports `useCanvasStore()` (line 90-92). You could pass `sessionId` through the store instead of adding a prop. However, the store currently doesn't store `sessionId` as state, so a prop is simpler. This is fine — just noting it's a design choice. A prop is actually cleaner since the store is for canvas data, not session identity.

No change needed — just confirming the plan's approach is reasonable.

---

## Issue 4: Test coverage is not explicit enough

**Severity: Medium**

### 4a: Server tests — which specific existing tests need to change?

The plan says "update existing tests that assert `content`/`data` are present in list responses — assert they are absent." But it doesn't name them. Here are the specific tests that will break:

**`GET /canvas` list endpoint** (lines 1008-1027):
- `'includes content field for text-based types'` (line 1008) — asserts `res.body[0].content === 'Hello World'` — **MUST be inverted**
- `'includes data field for image type'` (line 1018) — asserts `res.body[0].data === base64Image` — **MUST be inverted**
- `'includes all standard fields in response'` (line 1041) — asserts `item.toHaveProperty('content')` — **MUST remove content/data assertions**

**`GET /canvas/all` list endpoint** (lines 1211-1229):
- `'includes content field for text-based types'` (line 1211) — asserts `res.body[0].content === 'Hello World'` — **MUST be inverted**
- `'includes data field for image type'` (line 1221) — asserts `res.body[0].data === base64Image` — **MUST be inverted**

**`GET /canvas-trash` trash endpoint** (lines 1481-1518):
- No existing tests assert on `content`/`data` for trash items — but a couple tests (e.g., line 1536 `recoverRes.body.content === 'Recover me'`) assert content on **recover endpoints**, not on the trash list. Those should remain (recover returns a single item, not a list).

**Recommendation:** List each test by name and describe exactly what changes: "invert assertion" vs. "remove field from assertion" vs. "add new negative assertion."

### 4b: Frontend store test — `fetchItemContent` test cases are too vague

The plan says "cache miss triggers API call and patches item, cache hit skips API call." But it doesn't specify:
- What does "cache hit" mean exactly? `item.content !== undefined`? Or `item.content !== null`? (An item could have `content: null` for image types — that's a valid value, not a cache miss)
- Should `fetchItemContent` handle the case where the item doesn't exist in the store at all?
- What about items that have `content: ''` (empty string is valid for text files)?

**Recommendation:** Define the cache-hit detection logic explicitly: `content` OR `data` is a non-nullish value (not `undefined`). Use `!== undefined` not `!= null`, since `null` is a valid value for fields that don't apply to the type.

### 4c: Missing test: CanvasFileViewer version switching triggers content fetch

No test is specified for the version-switching scenario described in Issue 2.

### 4d: Missing test: `CanvasFileList` "Copy Contents" with no content shows loading

The plan mentions a "brief loading indicator" but doesn't specify a test for it.

---

## Issue 5: `fetchItemContent` caching logic needs nuance for `null` vs `undefined`

**Severity: Medium**

After stripping, items from the list endpoint won't have `content`/`data` keys at all (they'll be `undefined`). But some item types legitimately have `content: null` (e.g., images store data in `data`, not `content`). The fetch-content endpoint returns `content: null` for images.

The plan's `fetchItemContent` patches both `content` and `data` from the response. But detecting "already fetched" vs. "not yet fetched" requires distinguishing between:
- `item.content === undefined` → not fetched yet (stripped by list endpoint)
- `item.content === null` → fetched, but this field doesn't apply to this type

The plan's `needsContent` computed (`item.content === undefined && item.data === undefined`) is correct for the initial detection. But after fetching an image, the item will have `content: null, data: "base64..."` — and `needsContent` will become `false` because `data` is defined. This works correctly.

**But** the `CanvasFileList` copy action uses `if (!item.content && !item.data)` which treats `null`, `undefined`, `''`, and `0` the same way. An empty text file has `content: ''` which is falsy — this would trigger a re-fetch every time.

**Recommendation:** Use `item.content === undefined && item.data === undefined` consistently (not `!item.content && !item.data`).

---

## Issue 6: Plan says "no changes to WebSocket" but should verify

**Severity: Low (informational)**

The plan correctly notes that `CANVAS_ADD` WebSocket events include full content. I verified this: the server broadcasts `{ item }` where `item` is the full object from `canvasItems.create()` (line 279 in canvas.js). The `addItem` action in the store (line 119-121) just pushes the full object into the array. So WS-pushed items **will** have content, and the cache-check logic will correctly skip fetching for them. This is confirmed correct.

---

## Summary of Recommended Changes to the Plan

| # | Issue | Fix |
|---|-------|-----|
| 1 | Route ordering | Add note: new `/content` route must be defined before line 392 |
| 2 | Version switching needs content fetch | Watch `item.id` not just `needsContent` to handle version switches |
| 3 | n/a | No change needed |
| 4 | Test coverage too vague | Name the 5 specific tests that break, add version-switch test, define cache-hit semantics |
| 5 | `null` vs `undefined` for cache detection | Use `=== undefined` consistently, not falsy checks |
| 6 | n/a | Already correct, no change |
