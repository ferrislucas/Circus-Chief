# Plan: Canvas Markdown Editor

## Goal

Enable users to edit markdown files directly in the canvas detail view, with auto-saving and versioning that creates a new version only when the user returns to edit after navigating away.

## Library Choice: md-editor-v3

After evaluating 7 libraries (md-editor-v3, Milkdown, Tiptap, ink-mde, ByteMD, Toast UI Editor, Monaco), **md-editor-v3** is the best fit:

- **Native Vue 3** — no wrapper layers, written in TSX/TypeScript
- **Built-in dark theme** — `theme="dark"` prop with CSS variable overrides to match our `bg-gray-900` palette
- **Zero-config toolbar** — bold, italic, headings, lists, code, links, tables, etc. with keyboard shortcuts
- **Split-pane + preview modes** — toggle between edit, preview, and side-by-side
- **Actively maintained** — v6.4.0 released recently, 20+ contributors, MIT license
- **Also provides `MdPreview`** — standalone read-only component (could replace our current MarkdownViewer if desired)
- **~617 kB npm tarball** — mitigated via dynamic `import()` since it's only loaded when editing

Runners-up considered: Milkdown (Notion-like WYSIWYG, steeper learning curve), Tiptap (markdown is not native format, early-stage `@tiptap/markdown` extension).

---

## Architecture Overview

### Current Flow (read-only)
```
CanvasFileViewer → MarkdownViewer → rendered HTML (markdown-it + DOMPurify)
```

### New Flow (read + edit)
```
CanvasFileViewer → (toggle) → MarkdownViewer (read) | MdEditor (edit)
                                                          ↓
                                              debounced auto-save (1s)
                                                          ↓
                                              PUT /api/sessions/:id/canvas/:itemId
                                                          ↓
                                              updates content in-place (no new version)
                                                          ↓
                                    on navigate away → sets "editing session ended" flag
                                                          ↓
                                    next edit of same file → creates NEW version (POST)
```

---

## Implementation Steps

### Step 1: Install md-editor-v3

```bash
yarn workspace @claudetools/web add md-editor-v3
```

### Step 2: Server — Add `PUT` endpoint to update canvas item content

**File:** `packages/server/src/api/canvas.js`

Add a new `PUT /:id/canvas/:itemId` route:

```
PUT /api/sessions/:id/canvas/:itemId
Body: { content: string }
```

- Validates the item exists, belongs to the session, and is a text-based type (markdown, text, code)
- Updates `content` and `updated_at` on the existing row (no new version)
- Broadcasts `CANVAS_UPDATE` via WebSocket
- Returns the updated item

**File:** `packages/server/src/db/CanvasItemRepository.js`

Add an `updateContent(itemId, content)` method:

```js
updateContent(itemId, content) {
  const now = Date.now();
  this.db
    .prepare('UPDATE canvas_items SET content = ?, updated_at = ? WHERE id = ?')
    .run(content, now, itemId);
  return this.getById(itemId);
}
```

### Step 3: Server — Add WebSocket message type for canvas updates

**File:** `packages/shared/src/protocol.js`

Add `CANVAS_UPDATE: 'canvas:update'` to `WS_MESSAGE_TYPES`.

This message will be broadcast when content is updated in-place (vs. `CANVAS_ADD` for new versions).

### Step 4: Client API — Add `updateCanvasItem` method

**File:** `packages/web/src/api/resources/CanvasApi.js`

```js
async updateCanvasItem(sessionId, itemId, data) {
  return this._put(`/sessions/${sessionId}/canvas/${itemId}`, data);
}
```

If `_put` doesn't exist on the ApiClient, add it (following the pattern of `_post`).

### Step 5: Canvas Store — Add update action + versioning logic

**File:** `packages/web/src/stores/canvas.js`

Add state:
```js
editingSessionMap: {}  // { [filename]: latestItemId } — tracks "active editing session"
```

Add actions:

**`updateItemContent(sessionId, itemId, content)`** — calls the PUT API, patches the item in local store state.

**`startEditing(filename, itemId)`** — records that we're in an active editing session for this file. If there's already an entry and it matches the current `itemId`, continue editing (no new version needed). If the entry is absent (first time or returned after navigating away), set it.

**`endEditing(filename)`** — clears the entry from `editingSessionMap`. Called when the user navigates away from the file viewer.

**`saveMarkdownContent(sessionId, filename, content)`** — the main save logic:
1. Look up `editingSessionMap[filename]`
2. If an entry exists → call `updateItemContent` (in-place update, no new version)
3. If no entry exists → call `createCanvasItem` (creates a new version), then call `startEditing` with the new item's ID
4. After a successful save via either path, call `startEditing` to record/confirm the active editing session

### Step 6: Frontend — Create `MarkdownEditor.vue` component

**File:** `packages/web/src/components/MarkdownEditor.vue`

A wrapper component around md-editor-v3's `MdEditor`:

- **Props:** `content` (String), `sessionId` (String), `filename` (String)
- **Emits:** `save` (with updated content)
- **Behavior:**
  - Renders `MdEditor` with `v-model` bound to a local `editorContent` ref
  - Applies `theme="dark"` and custom CSS variable overrides to match the app's dark palette
  - Watches `editorContent` with a **1-second debounce** → emits `save` on change
  - On mount → calls `canvasStore.startEditing(filename, itemId)`
  - On unmount → calls `canvasStore.endEditing(filename)`
  - Uses dynamic `import()` via `defineAsyncComponent` to lazy-load md-editor-v3

### Step 7: Frontend — Update `CanvasFileViewer.vue` to support edit mode

**File:** `packages/web/src/components/CanvasFileViewer.vue`

Changes:
1. Add an `isEditing` ref (boolean, default `false`)
2. Add an "Edit" button (pencil icon) in the header area for markdown files
3. When `isEditing` is true and `item.type === 'markdown'`:
   - Hide `MarkdownViewer`
   - Show `MarkdownEditor` (lazy-loaded)
   - Pass current `item.content`, `sessionId`, and `filename` as props
4. Handle the `@save` event from `MarkdownEditor`:
   - Call `canvasStore.saveMarkdownContent(sessionId, filename, content)`
5. Add a "Done" / "Preview" button to exit edit mode back to read-only view
6. The edit/preview toggle should feel seamless — no page reload, no flicker

### Step 8: Frontend — Handle WebSocket `CANVAS_UPDATE` messages

**File:** `packages/web/src/stores/canvas.js` (or wherever WS messages are handled)

When a `CANVAS_UPDATE` message arrives:
- Find the item in `this.items` by ID
- Patch its `content` and `updatedAt` fields
- This keeps the store in sync if the update was triggered by another tab or client

### Step 9: Styling — Dark theme integration

Ensure the md-editor-v3 component blends with the existing dark theme:

- Import `md-editor-v3/lib/style.css`
- Override CSS variables to match:
  - `--md-bk-color` → `rgb(17 24 39)` (gray-900)
  - `--md-border-color` → match `var(--color-border)`
  - `--md-color` → `rgb(243 244 246)` (gray-100)
  - Toolbar background, hover states, etc.
- Scope overrides to a `.canvas-md-editor` wrapper class

### Step 10: Tests

**Unit tests:**
- `CanvasItemRepository.updateContent()` — verify it updates content without creating a new row
- Canvas API `PUT` route — verify content update, validation, and error handling
- Canvas store `saveMarkdownContent` — verify version creation logic (new version vs. in-place update)

**E2E tests:**
- Open a markdown file on the canvas → click Edit → verify editor loads
- Type in the editor → wait for debounce → verify content is saved (check API call)
- Navigate away → navigate back → edit again → verify a new version was created
- Verify the preview mode renders the updated content

---

## Versioning Behavior Summary

| Scenario | What happens |
|---|---|
| User opens markdown file and starts editing | In-place update (PUT). No new version. |
| User types multiple changes over 30 seconds | Each debounced save → PUT update to same row |
| User navigates away from the file viewer | `endEditing()` clears the editing session |
| User returns to the same file and edits again | First save creates a NEW version (POST), subsequent saves update that new version (PUT) |
| Another tab or client views the file | WebSocket `CANVAS_UPDATE` pushes the latest content |

---

## File Change Summary

| File | Change |
|---|---|
| `packages/web/package.json` | Add `md-editor-v3` dependency |
| `packages/shared/src/protocol.js` | Add `CANVAS_UPDATE` WS message type |
| `packages/server/src/db/CanvasItemRepository.js` | Add `updateContent()` method |
| `packages/server/src/api/canvas.js` | Add `PUT /:id/canvas/:itemId` route |
| `packages/web/src/api/resources/CanvasApi.js` | Add `updateCanvasItem()` method |
| `packages/web/src/stores/canvas.js` | Add `editingSessionMap`, `updateItemContent`, `startEditing`, `endEditing`, `saveMarkdownContent` |
| `packages/web/src/components/MarkdownEditor.vue` | **New file** — md-editor-v3 wrapper |
| `packages/web/src/components/CanvasFileViewer.vue` | Add edit/preview toggle for markdown |
| `packages/web/src/components/CanvasFileViewerHeader.vue` | Add Edit button for markdown files |
| WebSocket handler (wherever WS messages are consumed) | Handle `CANVAS_UPDATE` messages |
