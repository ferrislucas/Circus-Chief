# Plan: Session-Scoped Todo List Isolation

## Problem Statement
When a new conversation (session) is started, the todo list for Claude should be erased. Switching back to an existing session should restore that session's todo list.

## Current Architecture
The codebase already has the foundation for per-session todos:
- **Database**: `session_todos` table with `session_id` foreign key
- **Backend**: `TodoRepository`, `todoStore` service, REST endpoint `GET /api/sessions/:id/todos`
- **Frontend**: Pinia `todos` store, `TodoDrawer` component, WebSocket handlers

## Gap Analysis
The current implementation persists todos per-session in the database, but there's a UX issue:
1. When navigating away from a session, the todos store **is not cleared**
2. When navigating to a new/different session, the old todos may flash briefly before the fetch completes
3. The store needs explicit clearing during session transitions

## Implementation Plan

### Phase 1: Frontend Store Cleanup on Session Switch

**File: `packages/web/src/stores/todos.js`**
- Add a `clearTodos()` action (already exists, verify it resets properly)
- Ensure `items`, `loading`, and `error` are all reset

**File: `packages/web/src/views/SessionDetailView.vue`**
- Call `todosStore.clearTodos()` at the START of `onMounted()` before fetching
- This ensures the old session's todos don't persist visually during the transition

### Phase 2: Handle Route Changes Within Same Component

**File: `packages/web/src/views/SessionDetailView.vue`**
- Add a `watch` on `route.params.sessionId` to detect session switches without unmount
- When sessionId changes:
  1. Clear todos store
  2. Fetch new session's todos
  3. Re-subscribe to WebSocket for new session

### Phase 3: Verify New Session Behavior

**Expected behavior for NEW sessions:**
- Database has no `session_todos` entries for the new `sessionId`
- `fetchTodos(sessionId)` returns empty array
- TodoDrawer shows empty state (collapsed or hidden)

**Expected behavior for EXISTING sessions:**
- `fetchTodos(sessionId)` returns saved todos
- TodoDrawer populates with restored state

### Phase 4: Optional - Persist Expanded/Collapsed State Per-Session

Currently `expanded` state is global in the todos store. Consider:
- Store `expanded` per sessionId in localStorage or DB
- Restore UI state when switching back to a session

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/web/src/stores/todos.js` | Verify `clearTodos()` resets all state |
| `packages/web/src/views/SessionDetailView.vue` | Add `clearTodos()` call on mount and route watch |
| `packages/web/src/composables/useWebSocket.js` | (Optional) Ensure subscription cleanup |

## Sequence Diagram

```
User clicks "New Session"
         │
         ▼
Router navigates to /sessions/:newId
         │
         ▼
SessionDetailView.vue onMounted()
         │
         ├── 1. todosStore.clearTodos()  ← CLEAR immediately
         │
         ├── 2. subscribeToWebSocket(newId)
         │
         └── 3. todosStore.fetchTodos(newId)
                    │
                    ▼
            HTTP GET /api/sessions/:newId/todos
                    │
                    ▼
            Returns [] for new session
            Returns [saved todos] for existing session
                    │
                    ▼
            TodoDrawer renders correct state
```

## Testing Checklist

- [ ] Create new session → todo list is empty
- [ ] Add todos in session A → todos appear
- [ ] Switch to new session B → todos clear, session B has empty todos
- [ ] Switch back to session A → original todos restored
- [ ] Refresh browser on session A → todos persist
- [ ] Delete session with todos → no orphan data

## Estimated Effort
- **Low complexity**: ~30 minutes
- Core change is adding `clearTodos()` call at session transition points
