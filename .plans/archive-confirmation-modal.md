# Plan: Archive Confirmation Modal with Cleanup Option

## Summary

Replace the native browser `confirm()` dialog for session archiving with a custom modal that includes a "Clean up git worktree" checkbox (checked by default). When the checkbox is checked, the server will remove the git worktree associated with the session during the archive operation. The unarchive flow keeps a simple `confirm()` dialog (no cleanup checkbox needed).

---

## Current Flow

### Archive (from session list)
`SessionCardHeaderActions.onArchiveClick()` calls `confirm()` then emits `archive` -> `SessionCard` re-emits with `session.id` -> `SessionListView.handleArchive(sessionId)` calls `sessionsStore.archiveSession(sessionId)`

### Archive (from session detail)
`OverflowMenu` emits `archive` -> `SessionHeaderPanel` re-emits `archive` -> `SessionDetailView.handleArchive()` checks `isArchived` flag, calls `confirm()`, then calls either `archiveSession` or `unarchiveSession`

### Unarchive (from archived tab)
`SessionCardHeaderActions.onUnarchiveClick()` calls `confirm()` then emits `unarchive` -> `SessionCard` re-emits with `session.id` -> `ArchivedTabContent` re-emits `unarchive` -> `SessionListView.handleUnarchive(sessionId)`

### Unarchive (from session detail)
Same `handleArchive()` handler detects `isArchived=true`, calls `confirm()`, then `unarchiveSession()`

### Server
`POST /api/sessions/:id/archive` uses `requireSession` middleware, sets `archived: true`. No cleanup logic.

---

## Changes

### 1. New Component: `ArchiveConfirmModal.vue`

**File:** `packages/web/src/components/ArchiveConfirmModal.vue`

A modal component following the same pattern as `MoveCardModal.vue`:

- **Props:**
  - `isOpen` (Boolean) - controls visibility
  - `sessionName` (String) - shown in the confirmation message
  - `hasWorktree` (Boolean) - whether to show the cleanup checkbox
- **Emits:** `confirm(cleanupWorktree: boolean)`, `cancel`
- **UI:**
  - Teleported modal backdrop with click-to-close
  - Header: "Archive Session"
  - Body: "Are you sure you want to archive **{sessionName}**?"
  - Checkbox (only shown when `hasWorktree` is true): "Clean up git worktree" - checked by default
  - Footer: Cancel button (secondary) + Archive button (primary)
- **Behavior:**
  - Escape key closes modal
  - `cleanupWorktree` ref resets to `true` whenever `isOpen` changes to `true`
  - Emits `confirm(cleanupWorktree)` when user clicks Archive
  - Emits `cancel` on backdrop click, Escape, or Cancel button

### 2. Update `SessionCardHeaderActions.vue`

**File:** `packages/web/src/components/SessionCardHeaderActions.vue`

- **Archive path only:** Remove the `confirm()` from `onArchiveClick()` and emit `archive` directly
- **Unarchive path:** Keep the `confirm()` in `onUnarchiveClick()` as-is (no cleanup needed for unarchive)

### 3. Update `SessionListView.vue`

**File:** `packages/web/src/views/SessionListView.vue`

- Import and render `ArchiveConfirmModal`
- Add reactive state: `showArchiveModal` (ref, false), `sessionToArchive` (ref, null)
- Update `handleArchive(sessionId)`:
  - Look up the session: `const session = sessionsStore.sessions.find(s => s.id === sessionId)`
  - Set `sessionToArchive = session` and `showArchiveModal = true`
  - Do NOT call `archiveSession` yet
- Add `confirmArchive(cleanupWorktree)` handler:
  - Call `sessionsStore.archiveSession(sessionToArchive.id, { cleanup: cleanupWorktree })`
  - Close modal: `showArchiveModal = false`, `sessionToArchive = null`
- Add `cancelArchive()` handler to reset modal state
- Template: Add `<ArchiveConfirmModal>` with props bound from `sessionToArchive`:
  - `:is-open="showArchiveModal"`
  - `:session-name="sessionToArchive?.name || 'this session'"`
  - `:has-worktree="!!(sessionToArchive?.gitWorktree && !sessionToArchive?.parentSessionId)"`
  - `@confirm="confirmArchive"`, `@cancel="cancelArchive"`

### 4. Update `SessionDetailView.vue`

**File:** `packages/web/src/views/SessionDetailView.vue`

- Import and render `ArchiveConfirmModal`
- Add reactive state: `showArchiveModal` (ref, false)
- Update `handleArchive()`:
  - **Unarchive path** (`isArchived === true`): Keep existing `confirm()` + `unarchiveSession()` logic unchanged
  - **Archive path** (`isArchived === false`): Replace `confirm()` with `showArchiveModal = true` (don't call API yet)
- Add `confirmArchive(cleanupWorktree)` handler:
  - `showArchiveModal = false`
  - Call `sessionsStore.archiveSession(currentSessionId.value, { cleanup: cleanupWorktree })`
  - Navigate to project sessions list on success (existing behavior)
- Add `cancelArchive()` handler: `showArchiveModal = false`
- Template: Add `<ArchiveConfirmModal>` with:
  - `:is-open="showArchiveModal"`
  - `:session-name="sessionsStore.currentSession?.name || 'this session'"`
  - `:has-worktree="!!(sessionsStore.currentSession?.gitWorktree && !sessionsStore.currentSession?.parentSessionId)"`
  - `@confirm="confirmArchive"`, `@cancel="cancelArchive"`

### 5. Update Sessions Store Action

**File:** `packages/web/src/stores/sessions/sessionActions.js`

- Update `archiveSession(id)` signature to `archiveSession(id, { cleanup = false } = {})`
- Pass the cleanup flag: `const updated = await api.archiveSession(id, { cleanup })`
- Rest of the method (moving between lists, updating currentSession) stays the same

### 6. Update Sessions API Client

**File:** `packages/web/src/api/resources/SessionsApi.js`

- Update `archiveSession(id)` to `archiveSession(id, { cleanup = false } = {})`
- Change from `this._post(\`/sessions/${id}/archive\`)` to `this._post(\`/sessions/${id}/archive\`, { cleanup })`
- The `_post(path, data)` method already supports sending a body

### 7. Update Server Archive Endpoint

**File:** `packages/server/src/api/sessions-archive.js`

- Import `gitService` and `requireSessionAndProject` middleware (replacing `requireSession`)
- Change the archive route handler to `async`:
  ```
  router.post('/:id/archive', requireSessionAndProject, async (req, res) => { ... })
  ```
- After the status check, read `const { cleanup } = req.body || {}`
- If `cleanup` is truthy AND `req.session_.gitWorktree` AND `!req.session_.parentSessionId`:
  - `await gitService.removeWorktree(req.project.workingDirectory, req.session_.gitWorktree, true)` (wrapped in try/catch, log warning on failure)
  - Update session with worktree cleared: `sessions.update(req.params.id, { archived: true, gitWorktree: null })`
- If cleanup is not requested (or not applicable), keep existing behavior: `sessions.update(req.params.id, { archived: true })`
- The response `updated` session object is assigned from whichever `sessions.update()` call was made

---

## File Change Summary

| File | Action |
|------|--------|
| `packages/web/src/components/ArchiveConfirmModal.vue` | **NEW** - Confirmation modal with cleanup checkbox |
| `packages/web/src/components/SessionCardHeaderActions.vue` | **EDIT** - Remove `confirm()` from archive only (keep for unarchive) |
| `packages/web/src/views/SessionListView.vue` | **EDIT** - Add modal, intercept archive to show it |
| `packages/web/src/views/SessionDetailView.vue` | **EDIT** - Add modal for archive path, keep unarchive confirm as-is |
| `packages/web/src/stores/sessions/sessionActions.js` | **EDIT** - Accept `{ cleanup }` option, forward to API |
| `packages/web/src/api/resources/SessionsApi.js` | **EDIT** - Send `{ cleanup }` as POST body |
| `packages/server/src/api/sessions-archive.js` | **EDIT** - Handle cleanup (async, removeWorktree, requireSessionAndProject) |

---

## Test Plan

### Server: `packages/server/src/api/sessions-archive.test.js` (NEW)

| # | Test Case |
|---|-----------|
| 1 | `POST /archive` with `cleanup: true` and session with `gitWorktree` calls `removeWorktree()` and sets `gitWorktree: null` |
| 2 | `POST /archive` with `cleanup: true` but session has no `gitWorktree` - archives normally, does not call `removeWorktree()` |
| 3 | `POST /archive` with `cleanup: true` on a child session (`parentSessionId` set) - archives normally, does not call `removeWorktree()` |
| 4 | `POST /archive` with `cleanup: true` when `removeWorktree()` throws - still archives successfully (logs warning) |
| 5 | `POST /archive` without `cleanup` flag - archives normally (backward compatible, no worktree removal) |
| 6 | `POST /archive` returns 400 for running/starting sessions (existing behavior preserved) |

### Store: `packages/web/src/stores/sessions.test.js` (UPDATE existing `archiveSession` tests)

| # | Test Case |
|---|-----------|
| 1 | `archiveSession(id)` without options - calls `api.archiveSession(id, { cleanup: false })` (backward compatible) |
| 2 | `archiveSession(id, { cleanup: true })` - calls `api.archiveSession(id, { cleanup: true })` |
| 3 | Existing tests still pass (session moves between lists, currentSession updated, error handling) |

### API Client: `packages/web/src/api/resources/SessionsApi.test.js` (UPDATE existing test)

| # | Test Case |
|---|-----------|
| 1 | `archiveSession(id)` sends POST to `/sessions/:id/archive` with body `{ cleanup: false }` |
| 2 | `archiveSession(id, { cleanup: true })` sends POST with body `{ cleanup: true }` |

---

## Edge Cases

- **No worktree:** Checkbox is hidden when `session.gitWorktree` is falsy - archive works exactly as before
- **Child sessions:** Don't offer cleanup (they share the parent's worktree). Check `session.parentSessionId`
- **Cleanup failure:** Log warning but still complete the archive (same resilience pattern as DELETE endpoint)
- **Unarchive after cleanup:** Session can still be unarchived, but the worktree will be gone. The `gitWorktree` field is null so no confusion
- **Backward compatibility:** Calling `archiveSession(id)` with no options behaves identically to current behavior
