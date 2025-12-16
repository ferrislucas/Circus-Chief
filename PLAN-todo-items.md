# Todo Items Feature Plan

## Overview
Display Claude Code's todo items in real-time within the Conversation tab. The todos appear in a collapsible drawer above the input area, only visible when todos exist.

## UI Design

### Layout: Bottom Drawer (Above Input)
```
┌─────────────────────────────────────────────────────────────────────────┐
│  Conversation | Changes | Canvas | Notes                               │
├─────────────────────────────────────────────────────────────────────────┤
│  user: Please implement auth                                            │
│                                                                         │
│  assistant: I'll help with that...                                      │
├─────────────────────────────────────────────────────────────────────────┤
│  Todos [▲]   ◐ Research existing  ○ Design  ○ Implement  ○ Tests      │
├─────────────────────────────────────────────────────────────────────────┤
│  [textarea]                                               [Send] [End] │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Behavior
- **Hidden by default** - drawer does not render when no todos exist
- **Auto-appears** when first todo is created
- **Collapsible** - user can toggle between compact (single row) and expanded (full list)
- **Auto-hides** when all todos are cleared (session ends or Claude clears them)
- **Persists toggle state** in localStorage per session

### Visual States
- `○` pending
- `◐` in_progress
- `●` completed

## Architecture

```
Claude Code CLI (TodoWrite tool)
         │
         ▼
sessionManager.js ─── detects TodoWrite in tool_use
         │
         ▼
todoStore.js ─── stores todos in session_todos table
         │
         ▼
WebSocketManager ─── broadcasts TODOS_UPDATE
         │
         ▼
useTodosStore (Pinia) ─── frontend state
         │
         ▼
ConversationTab.vue ─── renders TodoDrawer component
```

## Implementation Components

### Backend

| File | Changes |
|------|---------|
| `packages/server/src/schema.sql` | Add `session_todos` table |
| `packages/server/src/db/TodoRepository.js` | New repository (CRUD operations) |
| `packages/server/src/services/todoStore.js` | New service: parse TodoWrite, store, broadcast |
| `packages/server/src/services/sessionManager.js` | Detect TodoWrite tool calls, invoke todoStore |
| `packages/server/src/api/sessions.js` | Add `GET /api/sessions/:id/todos` endpoint |
| `packages/shared/src/protocol.js` | Add `TODOS_UPDATE` WebSocket message type |

### Frontend

| File | Changes |
|------|---------|
| `packages/web/src/stores/todos.js` | New Pinia store for todo state |
| `packages/web/src/components/TodoDrawer.vue` | New component: collapsible drawer UI |
| `packages/web/src/components/ConversationTab.vue` | Import TodoDrawer, place above input form |
| `packages/web/src/composables/useWebSocket.js` | Add `onTodosUpdate()` handler |
| `packages/web/src/views/SessionDetailView.vue` | Subscribe to TODOS_UPDATE, update store |

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS session_todos (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed')),
  position INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_todos_session ON session_todos(session_id);
```

## WebSocket Message Format

```javascript
// Server -> Client
{
  type: 'TODOS_UPDATE',
  payload: {
    sessionId: 'abc123',
    todos: [
      { id: '1', content: 'Research existing code', status: 'completed', position: 0 },
      { id: '2', content: 'Design auth flow', status: 'in_progress', position: 1 },
      { id: '3', content: 'Implement login', status: 'pending', position: 2 },
    ]
  }
}
```

## TodoWrite Detection Logic

In `sessionManager.js`, when processing assistant messages:

```javascript
case 'assistant': {
  const toolUse = event.message?.content?.filter((c) => c.type === 'tool_use') || [];

  // Check for TodoWrite tool
  const todoWrite = toolUse.find(t => t.name === 'TodoWrite');
  if (todoWrite?.input?.todos) {
    await todoStore.updateTodos(sessionId, todoWrite.input.todos);
  }

  // ... existing message handling
}
```

## Implementation Order

1. **Database & Repository** - Create table and TodoRepository
2. **Backend Service** - Create todoStore.js with updateTodos() and broadcast
3. **WebSocket Protocol** - Add TODOS_UPDATE message type
4. **API Endpoint** - Add GET /api/sessions/:id/todos for initial load
5. **SessionManager Integration** - Detect TodoWrite and invoke todoStore
6. **Frontend Store** - Create useTodosStore Pinia store
7. **WebSocket Handler** - Add onTodosUpdate to useSessionSubscription
8. **TodoDrawer Component** - Build the UI component
9. **ConversationTab Integration** - Add TodoDrawer above input
10. **SessionDetailView** - Wire up WebSocket subscription

## TodoDrawer Component Spec

```vue
<template>
  <!-- Only render if todos exist -->
  <div v-if="todos.length > 0" class="todo-drawer">
    <div class="todo-header" @click="toggleExpanded">
      <span class="todo-label">Todos</span>
      <span class="todo-summary" v-if="!expanded">
        <!-- Show inline preview when collapsed -->
        <span v-for="todo in todos.slice(0, 4)" :key="todo.id" class="todo-chip">
          <span :class="statusIcon(todo.status)"></span>
          {{ truncate(todo.content, 20) }}
        </span>
        <span v-if="todos.length > 4">(+{{ todos.length - 4 }} more)</span>
      </span>
      <button class="expand-toggle">{{ expanded ? '▼' : '▲' }}</button>
    </div>

    <div v-if="expanded" class="todo-list">
      <div v-for="todo in todos" :key="todo.id" class="todo-item">
        <span :class="['status-icon', `status-${todo.status}`]"></span>
        <span class="todo-content">{{ todo.content }}</span>
      </div>
    </div>
  </div>
</template>
```

## Open Questions (Resolved)

1. ✅ **Read-only** - Users observe, Claude controls
2. ✅ **No history tracking** - Just current state (simpler)
3. ✅ **Conditional visibility** - Hidden when no todos
