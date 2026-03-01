# Implementation Plan: Issue #576 — Strip content/data from canvas list endpoints

## Problem

The `GET /canvas`, `GET /canvas/all`, and `GET /canvas-trash` endpoints return full `content` and `data` fields inline for every canvas item. This causes payload bloat — responses can exceed 30K+ characters for sessions with large markdown documents or base64-encoded images, truncating results for API consumers.

---

## Execution Steps

### Step 1: Add new server endpoint — `GET /canvas/file/:filename/content`

**File:** `packages/server/src/api/canvas.js`

The existing `/canvas/file/:filename` endpoint writes content to a temp file on disk and returns a `filePath` — it was designed for Claude Code's `Read` tool, not for browser consumption. The frontend needs content returned inline in JSON.

**Route placement:** This route MUST be defined **before** the `GET /:id/canvas/file/:filename` route (currently line 392), right next to the existing `/history/:version` route (line 317). Express matches routes by registration order, and the single-segment `/:filename` route would otherwise swallow requests meant for `/:filename/content`.

**Add a new endpoint** that returns `content`/`data` inline for a single item:

```js
// Place BEFORE the /:id/canvas/file/:filename route (line 392)
// Right after the /:id/canvas/file/:filename/history/:version route (line 317)
router.get('/:id/canvas/file/:filename/content', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const allVersions = canvasItems.getAllVersionsByFilename(req.params.id, req.params.filename);
  if (allVersions.length === 0) return res.status(404).json({ error: 'File not found' });

  // Support ?version=N (1-based, 1 = oldest)
  const versionParam = parseInt(req.query.version);
  let item;
  if (!isNaN(versionParam) && versionParam >= 1 && versionParam <= allVersions.length) {
    item = allVersions[allVersions.length - versionParam]; // allVersions is newest-first
  } else {
    item = allVersions[0]; // latest
  }

  res.json({
    content: item.content ?? null,
    data: item.data ?? null,
    type: item.type,
    mimeType: item.mimeType,
    filename: item.filename,
  });
});
```

**Tests to add in `canvas.test.js`:**
- Returns `content` for text/markdown/code items
- Returns `data` for image/pdf items
- Returns `content: null` (not `undefined`) for image items (field doesn't apply)
- Returns `data: null` (not `undefined`) for text items (field doesn't apply)
- Returns 404 for missing files
- Returns 404 for non-existent session
- `?version=N` parameter selects correct version
- `?version=N` returns 404 for out-of-range version (matches `/history/:version` behavior)

---

### Step 2: Strip `content`/`data` from list endpoints

**File:** `packages/server/src/api/canvas.js`

For each of the three list endpoints, map items to strip `content` and `data` before responding:

| Endpoint | Current code | New code |
|----------|-------------|----------|
| `GET /:id/canvas` (~line 296) | `res.json(items)` | `res.json(items.map(({ content, data, ...meta }) => meta))` |
| `GET /:id/canvas/all` (~line 310) | `res.json(items)` | `res.json(items.map(({ content, data, ...meta }) => meta))` |
| `GET /:id/canvas-trash` (~line 472) | `res.json(items)` | `res.json(items.map(({ content, data, ...meta }) => meta))` |

**Specific existing tests to update in `canvas.test.js`:**

`GET /canvas` list endpoint — 3 tests change:
| Test name | Line | Current assertion | New assertion |
|-----------|------|-------------------|---------------|
| `'includes content field for text-based types'` | 1008 | `expect(res.body[0].content).toBe('Hello World')` | Rename test to `'does not include content field'`; assert `expect(res.body[0]).not.toHaveProperty('content')` |
| `'includes data field for image type'` | 1018 | `expect(res.body[0].data).toBe(base64Image)` | Rename test to `'does not include data field'`; assert `expect(res.body[0]).not.toHaveProperty('data')` |
| `'includes all standard fields in response'` | 1041 | `expect(item).toHaveProperty('content')` | Remove the `content` assertion; add `expect(item).not.toHaveProperty('content')` and `expect(item).not.toHaveProperty('data')` |

`GET /canvas/all` list endpoint — 2 tests change:
| Test name | Line | Current assertion | New assertion |
|-----------|------|-------------------|---------------|
| `'includes content field for text-based types'` | 1211 | `expect(res.body[0].content).toBe('Hello World')` | Rename test to `'does not include content field'`; assert `expect(res.body[0]).not.toHaveProperty('content')` |
| `'includes data field for image type'` | 1221 | `expect(res.body[0].data).toBe(base64Image)` | Rename test to `'does not include data field'`; assert `expect(res.body[0]).not.toHaveProperty('data')` |

`GET /canvas-trash` trash endpoint — **no tests change** (no existing tests assert on `content`/`data` for trash list items). Add one new test: `'does not include content or data fields in trash list'`.

**Recover endpoint tests are unaffected** — they return single items (not lists), so `content`/`data` should remain. E.g., line 1536 `recoverRes.body.content === 'Recover me'` stays as-is.

---

### Step 3: Add `getCanvasFileContent()` to `ApiClient.js`

**File:** `packages/web/src/api/ApiClient.js`

```js
async getCanvasFileContent(sessionId, filename) {
  return this.#request('GET', `/sessions/${sessionId}/canvas/file/${encodeURIComponent(filename)}/content`);
}
```

---

### Step 4: Add `fetchItemContent()` action to canvas store

**File:** `packages/web/src/stores/canvas.js`

Add an action that fetches content for a single item on demand and caches it in the store:

```js
async fetchItemContent(sessionId, filename) {
  // Check if already fetched (cache hit).
  // Use === undefined (NOT falsy check) because:
  //   - null is a valid fetched value (e.g., content is null for image items)
  //   - '' is a valid fetched value (empty text files)
  //   - undefined means the field was stripped by the list endpoint (not yet fetched)
  const existing = this.items.find(i => i.filename === filename);
  if (existing && (existing.content !== undefined || existing.data !== undefined)) {
    return { content: existing.content, data: existing.data };
  }

  const result = await api.getCanvasFileContent(sessionId, filename);
  // Patch the content/data into ALL matching items in the store (all versions of this file)
  for (const item of this.items) {
    if (item.filename === filename) {
      item.content = result.content;
      item.data = result.data;
    }
  }
  return result;
},
```

**Cache-hit detection semantics:** An item is considered "already fetched" when `content !== undefined` OR `data !== undefined`. This distinguishes:
- `undefined` → field was stripped by the list endpoint, content not yet fetched
- `null` → fetched, but this field doesn't apply to this item type (e.g., `content` is `null` for images)
- `''` → fetched, the file is empty (valid for text files)

**Key detail:** Items arriving via WebSocket `CANVAS_ADD` events already include `content`/`data` (they're single-item pushes, not bulk lists), so newly-pushed items will have `content !== undefined` and won't trigger a fetch.

**Note:** The cache-hit check above only checks the first matching item. When fetching content for a specific version (not yet needed — the endpoint defaults to latest), this would need to be version-aware. For now, all versions of a file share the same filename, and the endpoint returns the latest version's content, which gets patched onto all versions in the store. This is acceptable because `CanvasFileViewer` fetches fresh content when switching versions (see Step 5).

**Tests to add in `stores/canvas.test.js`:**
- Cache miss (`content === undefined && data === undefined`): calls API, patches items in store, returns result
- Cache hit (`content` is a string): skips API call, returns cached values
- Cache hit when `content` is `null` (image item already fetched): skips API call
- Cache hit when `content` is `''` (empty text file already fetched): skips API call
- Error from API: propagates error, doesn't corrupt store state
- Item not in store: calls API, returns result (no items to patch)

---

### Step 5: Update `CanvasFileViewer.vue` — fetch content on demand

**File:** `packages/web/src/components/CanvasFileViewer.vue`

This component renders file previews (images, markdown, code, JSON, text). Currently reads `item.content` / `item.data` directly from props.

**Changes:**
1. Accept `sessionId` as a prop (threaded from parent CanvasTab)
2. Watch `item.id` (not just a computed `needsContent`) to handle version switching
3. On each item change, check if content needs fetching and show a loading spinner
4. Once fetched, the store update triggers reactivity and the content renders

```vue
const loading = ref(false);

// Watch the item's id to handle both initial load AND version switching.
// Cannot watch just a `needsContent` computed because switching between two
// content-less versions keeps needsContent=true — Vue watchers don't fire
// when the value doesn't change.
watch(() => props.item.id, async () => {
  const item = props.item;
  if (item.content === undefined && item.data === undefined) {
    loading.value = true;
    try {
      await canvasStore.fetchItemContent(props.sessionId, item.filename);
    } finally {
      loading.value = false;
    }
  }
}, { immediate: true });
```

Also update the **Copy Contents** action in this component to ensure content is fetched before copying:

```js
async function handleMenuCopyContents() {
  if (props.item.content === undefined && props.item.data === undefined) {
    await canvasStore.fetchItemContent(props.sessionId, props.item.filename);
  }
  // existing copy logic...
}
```

**Tests to add in `CanvasFileViewer.test.js`:**
- Shows loading spinner when `item.content` and `item.data` are both `undefined`
- Calls `fetchItemContent` on mount when content is missing
- Does NOT call `fetchItemContent` when `item.content` is already populated
- Does NOT call `fetchItemContent` when `item.content` is `null` (image type, already fetched)
- Re-fetches content when item prop changes (version switch) and new item has no content
- Copy Contents action fetches content on demand before copying

---

### Step 6: Update `CanvasFileList.vue` — fetch content for "Copy Contents"

**File:** `packages/web/src/components/CanvasFileList.vue`

The `handleMenuCopyContents(item)` function reads `item.content` / `item.data` for clipboard copy.

**Changes:**
1. Accept `sessionId` as a prop
2. Before copying, check if content is available using `=== undefined` (NOT falsy check — empty string and `null` are valid fetched values)
3. Show a brief loading indicator on the menu item while fetching

```js
async function handleMenuCopyContents(item) {
  // Use === undefined, NOT falsy check.
  // '' (empty text file) and null (field N/A for type) are valid fetched values.
  if (item.content === undefined && item.data === undefined) {
    await canvasStore.fetchItemContent(props.sessionId, item.filename);
  }
  // existing copy logic...
}
```

**Tests to add:**
- Copy Contents fetches content on demand when `content === undefined`
- Copy Contents does NOT re-fetch when `content` is `''` (empty file)
- Copy Contents does NOT re-fetch when `content` is `null`

---

### Step 7: Thread `sessionId` through components

**File:** `packages/web/src/components/CanvasTab.vue`

`CanvasTab` already has `sessionId` as a prop (line 119-121). Thread it down to both child components:

```vue
<!-- CanvasFileViewer -->
<CanvasFileViewer
  v-else-if="shouldShowViewer && selectedItem"
  :item="selectedItem"
  :sessionId="sessionId"         <!-- ADD THIS -->
  :versions="selectedVersions"
  :showBackButton="showBackButton"
  @back="handleBack"
  @selectVersion="handleSelectVersion"
  @deleteAll="handleDeleteAll"
/>

<!-- CanvasFileList -->
<CanvasFileList
  v-else
  :items="groupedItems"
  :sessionId="sessionId"          <!-- ADD THIS -->
  @select="handleSelect"
  @deleteItem="handleDeleteItem"
/>
```

---

### Step 8: Full test inventory

#### Server tests (`packages/server/src/api/canvas.test.js`)

**Existing tests to modify (5 total):**

| # | Test name | Describe block | Line | Change |
|---|-----------|---------------|------|--------|
| 1 | `'includes content field for text-based types'` | `GET /canvas` | 1008 | Rename → `'does not include content field'`; invert assertion |
| 2 | `'includes data field for image type'` | `GET /canvas` | 1018 | Rename → `'does not include data field'`; invert assertion |
| 3 | `'includes all standard fields in response'` | `GET /canvas` | 1041 | Remove `content` from expected fields; add negative assertions for `content` and `data` |
| 4 | `'includes content field for text-based types'` | `GET /canvas/all` | 1211 | Rename → `'does not include content field'`; invert assertion |
| 5 | `'includes data field for image type'` | `GET /canvas/all` | 1221 | Rename → `'does not include data field'`; invert assertion |

**New tests to add:**

New `describe` block: `'GET /canvas/file/:filename/content'`:
- Returns `content` for text item, `data: null`
- Returns `content` for markdown item
- Returns `content` for code item
- Returns `data` for image item, `content: null`
- Returns `data` for PDF item, `content: null`
- Returns 404 for missing file
- Returns 404 for non-existent session
- `?version=1` returns oldest version content
- `?version=N` returns latest version content
- Returns correct content when switching between versions

New test in `GET /canvas-trash` describe block:
- `'does not include content or data fields in trash list'`

#### Frontend store tests (`packages/web/src/stores/canvas.test.js`)

New tests for `fetchItemContent` action:
- Cache miss: calls API, patches items, returns result
- Cache hit (content is string): skips API
- Cache hit (content is `null`): skips API
- Cache hit (content is `''`): skips API
- API error: propagates, store unchanged
- Item not in store: calls API, returns result

#### Frontend component tests (`packages/web/src/components/CanvasFileViewer.test.js`)

- Loading spinner shown when content not yet fetched
- Calls `fetchItemContent` on mount when content missing
- Does NOT fetch when content already present
- Does NOT fetch when content is `null` (image type)
- Re-fetches when item ID changes (version switch)
- Copy Contents fetches on demand before copying

#### Frontend component tests (`packages/web/src/components/CanvasTab.test.js`)

- Passes `sessionId` prop to `CanvasFileViewer`
- Passes `sessionId` prop to `CanvasFileList`
- Remove `content`/`data` from mock canvas items if present in existing test mocks

---

## What does NOT change

- **WebSocket `CANVAS_ADD` events** — single item pushes, content is fine here (no bulk bloat). Verified: server broadcasts full item from `canvasItems.create()`, and `addItem` in the store pushes the full object. These items will have `content !== undefined`, so the cache-check skips fetching.
- **POST/PUT canvas endpoints** — content is needed for creation/update
- **`/canvas/file/:filename`** (existing temp-file endpoint) — unchanged, still used by Claude Code's `Read` tool
- **`/canvas/file/:filename/history/:version`** — unchanged
- **Recover endpoints** (`POST /:id/canvas/:itemId/recover`, `POST /:id/canvas-trash/recover-file/:filename`) — these return single items, content should remain
