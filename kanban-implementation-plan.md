# Kanban Board Feature - Implementation Plan

## Overview

A per-project Kanban-style task board where sessions are the cards. Lanes are fully configurable (names, order, count). Agents can inspect and manipulate the board via API. Lane entry can trigger template execution. The feature is toggled per-project (default: on).

---

## Phase 1: Database Schema & Migrations

### New Tables

#### `kanban_boards`
| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `project_id` | TEXT UNIQUE FK | One board per project, CASCADE delete |
| `created_at` | INTEGER | Unix ms |
| `updated_at` | INTEGER | Unix ms |

#### `kanban_lanes`
| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `board_id` | TEXT FK | References kanban_boards, CASCADE delete |
| `name` | TEXT NOT NULL | Lane display name |
| `sort_order` | INTEGER NOT NULL DEFAULT 0 | Position on the board |
| `on_enter_template_id` | TEXT FK NULL | Template to run when a session enters this lane (SET NULL on delete) |
| `created_at` | INTEGER | Unix ms |
| `updated_at` | INTEGER | Unix ms |

#### `kanban_cards`
| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `lane_id` | TEXT FK | References kanban_lanes, CASCADE delete |
| `sort_order` | INTEGER NOT NULL DEFAULT 0 | Position within lane |
| `created_at` | INTEGER | Unix ms |
| `updated_at` | INTEGER | Unix ms |

**Future-proofing note:** Cards are a separate entity from sessions. This allows us to later associate multiple sessions with a single card.

#### `kanban_card_sessions`
| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `card_id` | TEXT FK | References kanban_cards, CASCADE delete |
| `session_id` | TEXT FK UNIQUE | References sessions, CASCADE delete. UNIQUE ensures one card per session for now. |
| `created_at` | INTEGER | Unix ms |

### Schema Changes to Existing Tables

#### `projects` table — add column:
- `kanban_enabled` INTEGER NOT NULL DEFAULT 1 (boolean: 1 = on, 0 = off)

#### `sessions` table — add column:
- `target_lane_id` TEXT FK NULL — References kanban_lanes (SET NULL on delete). The lane this session should move to when the conversation turn ends.

#### `session_templates` table — add column:
- `target_lane_id` TEXT FK NULL — References kanban_lanes (SET NULL on delete). When a session is created from this template, place it in this lane.

### Migration Steps (in `DatabaseManager.js`)

1. Create `kanban_boards` table
2. Create `kanban_lanes` table with foreign keys
3. Create `kanban_cards` table with foreign keys
4. Create `kanban_card_sessions` join table
5. Add `kanban_enabled` column to `projects` (DEFAULT 1)
6. Add `target_lane_id` column to `sessions`
7. Add `target_lane_id` column to `session_templates`
8. Add indexes: `kanban_lanes(board_id, sort_order)`, `kanban_cards(lane_id, sort_order)`, `kanban_card_sessions(session_id)`

### Files to Create/Modify
- **Modify:** `packages/server/src/schema.sql` — add new table definitions
- **Modify:** `packages/server/src/db/DatabaseManager.js` — add migration logic
- **Create:** `packages/server/src/db/KanbanBoardRepository.js`
- **Create:** `packages/server/src/db/KanbanLaneRepository.js`
- **Create:** `packages/server/src/db/KanbanCardRepository.js`
- **Modify:** `packages/server/src/db/index.js` — export new repositories

---

## Phase 2: Server Repositories

### KanbanBoardRepository
- `getByProjectId(projectId)` — returns board or null
- `create(projectId)` — creates board with default lanes ("To Do", "In Progress", "Review", "Done")
- `getOrCreateForProject(projectId)` — lazy init: create on first access
- `delete(id)`

### KanbanLaneRepository
- `getByBoardId(boardId)` — returns lanes ordered by sort_order
- `create(boardId, { name, sortOrder, onEnterTemplateId })` — create lane
- `update(id, { name, sortOrder, onEnterTemplateId })` — update lane
- `delete(id)` — delete lane (cards cascade-delete, sessions lose their lane assignment)
- `reorder(boardId, laneIds[])` — bulk update sort_order based on array position
- `getById(id)` — single lane with board context

### KanbanCardRepository
- `getByLaneId(laneId)` — returns cards with session data, ordered by sort_order
- `getByBoardId(boardId)` — returns ALL cards across all lanes with session data (for full board view)
- `getBySessionId(sessionId)` — returns card for a given session (via join)
- `create(laneId, sessionId)` — creates card + card_session link in transaction
- `moveToLane(cardId, targetLaneId, sortOrder)` — moves card between lanes
- `delete(cardId)` — remove card from board (doesn't delete session)
- `reorder(laneId, cardIds[])` — bulk update sort_order within a lane

### Files to Create
- `packages/server/src/db/KanbanBoardRepository.js`
- `packages/server/src/db/KanbanLaneRepository.js`
- `packages/server/src/db/KanbanCardRepository.js`

---

## Phase 3: Shared Contracts & Types

### New Zod Contracts

#### `packages/shared/src/contracts/kanban.js`

```javascript
// Board
KanbanBoardResponse { id, projectId, lanes: KanbanLaneResponse[], createdAt, updatedAt }

// Lane
CreateKanbanLaneRequest { name: string(min 1), sortOrder?: number, onEnterTemplateId?: uuid|null }
UpdateKanbanLaneRequest { name?: string, sortOrder?: number, onEnterTemplateId?: uuid|null }
ReorderKanbanLanesRequest = z.array(z.string().uuid()) // ordered lane IDs
KanbanLaneResponse { id, boardId, name, sortOrder, onEnterTemplateId, createdAt, updatedAt }

// Card
CreateKanbanCardRequest { sessionId: uuid, laneId: uuid }
MoveKanbanCardRequest { targetLaneId: uuid, sortOrder?: number, runOnEnterTemplate?: boolean (default true) }
KanbanCardResponse { id, laneId, sortOrder, sessions: [{ id, name, status, ... }], createdAt, updatedAt }
```

### Protocol Updates (`packages/shared/src/protocol.js`)

Add WebSocket message types:
- `kanban:board_updated` — board structure changed (lanes added/removed/reordered)
- `kanban:card_moved` — card moved between lanes
- `kanban:card_added` — new card added to board
- `kanban:card_removed` — card removed from board

### Type Updates (`packages/shared/src/types.js`)

Add JSDoc types for KanbanBoard, KanbanLane, KanbanCard.

### Files to Create/Modify
- **Create:** `packages/shared/src/contracts/kanban.js`
- **Modify:** `packages/shared/src/protocol.js`
- **Modify:** `packages/shared/src/types.js`
- **Modify:** `packages/shared/src/contracts/index.js`

---

## Phase 4: Server API Routes

### New Route File: `packages/server/src/api/kanban.js`

Mounted at `/api/projects/:projectId/kanban`

#### Board Endpoints
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Get board with all lanes and cards for project. Auto-creates board if kanban_enabled and board doesn't exist. |
| `DELETE` | `/` | Delete board (resets all kanban data for project) |

#### Lane Endpoints
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/lanes` | Create a new lane |
| `PATCH` | `/lanes/:laneId` | Update lane (name, template) |
| `DELETE` | `/lanes/:laneId` | Delete lane |
| `PUT` | `/lanes/reorder` | Reorder all lanes (accepts ordered array of lane IDs) |

#### Card Endpoints
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/cards` | Add a session to the board (create card in a lane) |
| `PATCH` | `/cards/:cardId/move` | Move card to a different lane. Body includes `runOnEnterTemplate` boolean. |
| `DELETE` | `/cards/:cardId` | Remove card from board |
| `PUT` | `/lanes/:laneId/cards/reorder` | Reorder cards within a lane |

### Modify Existing Routes

#### `packages/server/src/api/projects.js`
- `PATCH /api/projects/:id` — accept `kanbanEnabled` field in update body
- Return `kanbanEnabled` in project responses

#### `packages/server/src/api/sessions.js`
- When creating a session from a template that has `target_lane_id`, auto-add session to that lane
- `PATCH /api/sessions/:id` — accept `targetLaneId` field

#### `packages/server/src/api/templates.js`
- `POST` and `PATCH` — accept `targetLaneId` field

### Files to Create/Modify
- **Create:** `packages/server/src/api/kanban.js`
- **Modify:** `packages/server/src/api/index.js` — mount kanban router
- **Modify:** `packages/server/src/api/projects.js` — kanbanEnabled field
- **Modify:** `packages/server/src/api/sessions.js` — targetLaneId handling
- **Modify:** `packages/server/src/api/templates.js` — targetLaneId field

---

## Phase 5: Kanban Service (Business Logic)

### New Service: `packages/server/src/services/kanbanService.js`

#### Core Functions

- **`getFullBoard(projectId)`** — Returns complete board with lanes, cards, and session data. Lazy-creates board with default lanes if it doesn't exist and kanban is enabled.

- **`addSessionToBoard(sessionId, laneId, options?)`** — Creates a card for a session in the specified lane. Called:
  - Manually via API
  - Automatically when session created from template with `target_lane_id`
  - By agent via API

- **`moveCard(cardId, targetLaneId, { runOnEnterTemplate = true })`** — Moves card to target lane. If `runOnEnterTemplate` is true AND the target lane has `on_enter_template_id`:
  1. Move the card
  2. Look up the lane's template
  3. Execute the template as a child session against the card's session (using the same pattern as `templateTriggerService.checkAndTriggerNextTemplate()`)
  4. Broadcast `kanban:card_moved`

- **`handleTurnCompletion(sessionId)`** — Called from `streamEventHandler.js` when a session's turn ends. Checks `session.target_lane_id`:
  1. If set, find the card for this session
  2. Move it to the target lane
  3. Clear `target_lane_id` on the session
  4. Optionally trigger on-enter template
  5. Broadcast updates

- **`removeSessionFromBoard(sessionId)`** — Removes card when session is deleted.

### Integration Points

#### `packages/server/src/services/streamEventHandler.js`
In `handleTurnCompletion()`, after existing template trigger logic:
```javascript
// Check kanban lane movement
await kanbanService.handleTurnCompletion(sessionId);
```

#### `packages/server/src/services/sessionManager.js`
In session creation flow, after session is created:
- If session was created from template with `target_lane_id`, call `kanbanService.addSessionToBoard()`

#### Session deletion cleanup
When a session is deleted, the CASCADE delete on `kanban_card_sessions.session_id` handles cleanup automatically. But we should also broadcast `kanban:card_removed`.

### Files to Create/Modify
- **Create:** `packages/server/src/services/kanbanService.js`
- **Modify:** `packages/server/src/services/streamEventHandler.js` — call kanbanService on turn completion
- **Modify:** `packages/server/src/services/sessionManager.js` — auto-add to board on template-based creation
- **Modify:** `packages/server/src/api/sessions.js` — broadcast card removal on session delete

---

## Phase 6: Agent System Prompt Integration

### Modify: `packages/server/src/services/sessionPrompts.js`

Add a new section builder: `buildKanbanApiInstructions(sessionId, projectId)`

This will be included in the system prompt (after session API instructions) and will provide the agent with:

```markdown
## Kanban Board API

This project has a Kanban board for organizing sessions into lanes.

### View the Board
```bash
curl {apiUrl}/api/projects/{projectId}/kanban
```

### Move a Session to a Lane
```bash
curl -X PATCH {apiUrl}/api/projects/{projectId}/kanban/cards/{cardId}/move \
  -H "Content-Type: application/json" \
  -d '{"targetLaneId": "<lane_id>", "runOnEnterTemplate": false}'
```
Set `runOnEnterTemplate` to `false` to skip the lane's auto-trigger template.

### Add Current Session to a Lane
```bash
curl -X POST {apiUrl}/api/projects/{projectId}/kanban/cards \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "{sessionId}", "laneId": "<lane_id>"}'
```

### Set Target Lane for End of Turn
```bash
curl -X PATCH {apiUrl}/api/sessions/{sessionId} \
  -H "Content-Type: application/json" \
  -d '{"targetLaneId": "<lane_id>"}'
```
The session will be moved to this lane when the current conversation turn ends.
```

**Conditional inclusion:** Only include this section if the project has `kanban_enabled = true`.

### Files to Modify
- `packages/server/src/services/sessionPrompts.js` — add `buildKanbanApiInstructions()`, include it in `buildSystemPromptConfig()`

---

## Phase 7: Frontend - Pinia Store

### New Store: `packages/web/src/stores/kanban.js`

```javascript
State:
  board: null            // Full board object with lanes and cards
  loading: boolean
  error: string|null
  dragState: {           // For drag-and-drop UI
    cardId: string|null
    sourceLaneId: string|null
  }

Getters:
  lanes                  // board.lanes sorted by sortOrder
  getCardsByLaneId(laneId)  // cards for a lane
  getCardForSession(sessionId)  // find card by session ID
  isSessionOnBoard(sessionId)  // boolean check

Actions:
  fetchBoard(projectId)
  addCard(projectId, { sessionId, laneId })
  moveCard(projectId, cardId, { targetLaneId, sortOrder, runOnEnterTemplate })
  removeCard(projectId, cardId)
  createLane(projectId, { name, sortOrder, onEnterTemplateId })
  updateLane(projectId, laneId, { name, onEnterTemplateId })
  deleteLane(projectId, laneId)
  reorderLanes(projectId, laneIds)
  reorderCards(projectId, laneId, cardIds)

  // WebSocket handlers
  handleBoardUpdated(data)
  handleCardMoved(data)
  handleCardAdded(data)
  handleCardRemoved(data)
```

### New API Mixin: `packages/web/src/api/KanbanApi.js`

```javascript
getKanbanBoard(projectId)
createKanbanLane(projectId, data)
updateKanbanLane(projectId, laneId, data)
deleteKanbanLane(projectId, laneId)
reorderKanbanLanes(projectId, laneIds)
createKanbanCard(projectId, data)
moveKanbanCard(projectId, cardId, data)
deleteKanbanCard(projectId, cardId)
reorderKanbanCards(projectId, laneId, cardIds)
```

### Files to Create/Modify
- **Create:** `packages/web/src/stores/kanban.js`
- **Create:** `packages/web/src/api/KanbanApi.js`
- **Modify:** `packages/web/src/api/ApiClient.js` — add KanbanApi mixin

---

## Phase 8: Frontend - Kanban Board UI

### New Components

#### `KanbanBoard.vue` — Main board container
- Fetches board data on mount
- Renders lanes horizontally (desktop) / vertically stacked (mobile)
- Subscribes to WebSocket kanban events
- Includes "Add Lane" button and board settings access
- **Mobile layout:** Horizontal scroll with snap points, or a lane selector dropdown + single lane view

#### `KanbanLane.vue` — Single lane column
- Displays lane header with name, card count, edit button
- Renders KanbanCard components
- Supports drag-and-drop target zone
- "Add session" button at bottom
- **Mobile:** Full-width column in horizontal scroll or selected lane view

#### `KanbanCard.vue` — Card representing a session
- Shows session name, status badge, short summary (if available)
- Draggable (desktop) / long-press-to-drag or move button (mobile)
- Click navigates to session detail
- Compact display: status indicator dot, name, truncated summary
- Show cost if available, show star indicator

#### `KanbanLaneSettings.vue` — Lane configuration modal/panel
- Edit lane name
- Select on-enter template (dropdown of available templates)
- Delete lane (with confirmation)

#### `KanbanBoardSettings.vue` — Board-level settings modal/panel
- Add new lane (name input)
- Reorder lanes (drag or up/down buttons)
- Manage lane templates

#### `AddSessionToLaneModal.vue` — Modal to pick a session to add to a lane
- Searchable list of sessions not currently on the board
- Or: a dropdown in the session detail view to assign to a lane

### Drag and Drop Strategy
- Use HTML5 Drag and Drop API (works on desktop)
- For mobile: Use a "Move to..." action menu (tap card → select target lane from dropdown)
- Consider `@vueuse/core` `useDraggable` or a lightweight library if HTML5 DnD proves insufficient
- CSS `touch-action: none` on drag handles for mobile

### Mobile-Responsive Design
- **>768px (tablet+):** Horizontal lanes with horizontal scroll, cards in columns
- **<=480px (phone):** Tab/dropdown lane selector showing one lane at a time (similar to the existing tab pattern in SessionListView)
- Lane headers should be sticky
- Cards should be full-width on mobile
- Touch targets must be at least 44px (iOS Human Interface Guidelines)

### Files to Create
- `packages/web/src/components/KanbanBoard.vue`
- `packages/web/src/components/KanbanLane.vue`
- `packages/web/src/components/KanbanCard.vue`
- `packages/web/src/components/KanbanLaneSettings.vue`
- `packages/web/src/components/KanbanBoardSettings.vue`
- `packages/web/src/components/AddSessionToLaneModal.vue`

---

## Phase 9: Frontend - Route & Tab Integration

### New Route
Add to `packages/web/src/router.js`:
```javascript
{
  path: '/projects/:id/board',
  name: 'ProjectBoard',
  component: SessionListView
}
```

### SessionListView Tab Integration

#### Modify: `packages/web/src/views/SessionListView.vue`

1. **Add "Board" tab** to the tab list (conditionally, based on project's `kanbanEnabled`):
   - Desktop: New tab button between existing tabs
   - Mobile: New option in dropdown select

2. **Tab routing:**
   ```javascript
   case 'ProjectBoard': return 'board';
   ```

3. **Tab content:**
   ```html
   <KanbanBoard v-if="activeTab === 'board'" :project-id="route.params.id" />
   ```

4. **Conditional display:** Only show the Board tab if `projectsStore.currentProject?.kanbanEnabled !== false`

### Project Edit View Integration

#### Modify: `packages/web/src/views/ProjectEditView.vue`

Add a checkbox in the main settings area (not in an advanced section — this is a primary feature toggle):

```html
<div class="form-group">
  <label class="checkbox-label">
    <input type="checkbox" v-model="kanbanEnabled" />
    Enable Kanban Board
  </label>
  <p class="form-help">
    Show a Kanban board tab for organizing sessions into lanes.
  </p>
</div>
```

### Session Detail Integration

#### Modify: `packages/web/src/views/SessionDetailView.vue` or a sidebar component

Add ability to:
- See which lane a session is in (small badge/indicator)
- Move session to a different lane (dropdown)
- Set "target lane" for end of turn
- Remove session from board

This could be a small section in the session header/sidebar area, or part of the session settings.

### Template Editor Integration

#### Modify: `packages/web/src/views/TemplateDetailView.vue` and `TemplatesPanel.vue`

Add a "Target Lane" dropdown to the template form:
- Lists lanes from the current project's board
- When a session is created from this template, it gets placed in this lane

### Files to Modify
- `packages/web/src/router.js` — add board route
- `packages/web/src/views/SessionListView.vue` — add Board tab
- `packages/web/src/views/ProjectEditView.vue` — kanbanEnabled toggle
- `packages/web/src/views/SessionDetailView.vue` — lane assignment UI
- `packages/web/src/views/TemplateDetailView.vue` — target lane selector
- `packages/web/src/components/TemplatesPanel.vue` — target lane in create form

---

## Phase 10: WebSocket Real-Time Updates

### Server Side

In kanban API handlers and kanbanService, broadcast events:

```javascript
broadcastToProject(projectId, WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED, { board });
broadcastToProject(projectId, WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, { cardId, fromLaneId, toLaneId });
broadcastToProject(projectId, WS_MESSAGE_TYPES.KANBAN_CARD_ADDED, { card });
broadcastToProject(projectId, WS_MESSAGE_TYPES.KANBAN_CARD_REMOVED, { cardId, laneId });
```

### Client Side

In `useProjectSessionSubscription.js`, register handlers for kanban events:

```javascript
// On kanban events, update the kanban store
ws.on('kanban:board_updated', (data) => kanbanStore.handleBoardUpdated(data));
ws.on('kanban:card_moved', (data) => kanbanStore.handleCardMoved(data));
ws.on('kanban:card_added', (data) => kanbanStore.handleCardAdded(data));
ws.on('kanban:card_removed', (data) => kanbanStore.handleCardRemoved(data));
```

Also update existing session status handlers — when a session status changes, the kanban card should reflect the new status in real-time (this works automatically if KanbanCard.vue reads from sessionsStore).

### Files to Modify
- `packages/web/src/composables/useProjectSessionSubscription.js` — handle kanban WS events
- `packages/web/src/composables/useWebSocket.js` — register kanban message types if needed

---

## Phase 11: Turn Completion → Lane Movement

### Flow
1. Session has `target_lane_id` set (via API or agent)
2. Agent's turn ends → `handleTurnCompletion()` in `streamEventHandler.js`
3. `kanbanService.handleTurnCompletion(sessionId)` is called
4. Service checks `session.target_lane_id`
5. If set:
   a. Find the card for this session
   b. If no card exists, create one in the target lane
   c. If card exists, move it to the target lane
   d. Clear `target_lane_id` on the session
   e. Check if target lane has `on_enter_template_id`
   f. If so, trigger the template as a child session (same pattern as templateTriggerService)
   g. Broadcast kanban updates

### Lane Entry Template Trigger Flow
1. Card moves to a lane that has `on_enter_template_id`
2. `kanbanService` loads the template
3. Renders template prompt with Liquid (with parent session context)
4. Creates a child session via `templateTriggerService` pattern:
   - `parentSessionId: session.id`
   - Inherits git worktree from parent
   - `nextTemplateId: template.nextTemplateId` for further chaining
5. Runs the child session asynchronously
6. Broadcasts `SESSION_CREATED`

### Files to Modify
- `packages/server/src/services/streamEventHandler.js` — add kanbanService.handleTurnCompletion() call
- `packages/server/src/services/kanbanService.js` — implement handleTurnCompletion and template triggering

---

## Phase 12: Contracts Update for Existing Entities

### Update `packages/shared/src/contracts/projects.js`
- Add `kanbanEnabled` to `CreateProjectRequest` (optional, default true)
- Add `kanbanEnabled` to `UpdateProjectRequest` (optional)
- Add `kanbanEnabled` to `ProjectResponse`

### Update `packages/shared/src/contracts/sessions.js`
- Add `targetLaneId` to `CreateSessionRequest` (optional)
- Add `targetLaneId` to `SessionResponse`

### Update `packages/shared/src/contracts/templates.js`
- Add `targetLaneId` to `CreateSessionTemplateRequest` (optional)
- Add `targetLaneId` to `SessionTemplateResponse`

---

## Implementation Order

We implement in this order to build foundation first, then layer features:

| Step | Phase | Description | Est. Effort |
|------|-------|-------------|-------------|
| 1 | Phase 1 | Database schema + migrations | Medium |
| 2 | Phase 2 | Server repositories | Medium |
| 3 | Phase 3 + 12 | Shared contracts, types, protocol updates | Small |
| 4 | Phase 4 | API routes (kanban + updates to existing) | Medium-Large |
| 5 | Phase 5 | Kanban service (business logic) | Medium |
| 6 | Phase 7 | Frontend store + API client | Small-Medium |
| 7 | Phase 8 | Frontend Kanban UI components | Large |
| 8 | Phase 9 | Route/tab integration + settings UI | Medium |
| 9 | Phase 10 | WebSocket real-time updates | Small-Medium |
| 10 | Phase 11 | Turn completion → lane movement logic | Medium |
| 11 | Phase 6 | Agent system prompt integration | Small |
| 12 | — | Testing (unit + E2E) | Medium-Large |

---

## Key Design Decisions

### 1. Card ≠ Session (Future-Proofing)
Cards are a separate entity linked to sessions via `kanban_card_sessions`. Currently 1:1 (enforced by UNIQUE constraint on `session_id`), but the join table allows future N:1 (multiple sessions per card). The UI treats each card as having a single session for now.

### 2. Lazy Board Creation
Boards are created on first access (when user navigates to the Board tab or API is called), not when the project is created. This avoids schema changes for existing projects and keeps things clean. Default lanes: "To Do", "In Progress", "Review", "Done".

### 3. Lane Entry Template = Child Session
When a session enters a lane with a template, the template runs as a **child session** (same pattern as template chaining). This reuses existing infrastructure and means the child session appears in the session list with `parentSessionId` set.

### 4. Agent Control
Agents can:
- Read the board state (`GET /api/projects/:projectId/kanban`)
- Move cards between lanes with template opt-out
- Set `targetLaneId` on their own session for end-of-turn movement
- Add sessions to the board

### 5. Mobile Strategy
- Phone: Single-lane view with lane selector dropdown (same pattern as mobile tab navigation already in SessionListView)
- Tablet: Horizontal scroll with visible lane columns
- Desktop: Full horizontal board
- Move actions use a dropdown/modal rather than drag-and-drop on touch devices

### 6. Feature Toggle
`kanban_enabled` on the project controls visibility of the Board tab. Default is `true` (on). When disabled, the tab is hidden but data is preserved (not deleted).

---

## Testing Strategy

### Unit Tests
- Repository tests for all CRUD operations (Board, Lane, Card)
- KanbanService tests for:
  - Board creation with default lanes
  - Card movement between lanes
  - Turn completion lane movement
  - Lane entry template triggering
  - Agent template opt-out
- API route tests for all endpoints
- Contract validation tests

### E2E Tests (Playwright)
- Create project → Board tab visible
- Configure lanes (add, rename, reorder, delete)
- Add session to board
- Drag card between lanes (desktop)
- Move card via action menu (mobile viewport)
- Lane entry triggers template (verify child session created)
- Disable kanban → tab disappears
- Session detail → lane assignment
- Template → target lane configuration

### Files to Create
- `packages/server/src/db/KanbanBoardRepository.test.js`
- `packages/server/src/db/KanbanLaneRepository.test.js`
- `packages/server/src/db/KanbanCardRepository.test.js`
- `packages/server/src/services/kanbanService.test.js`
- `tests/e2e/kanban.spec.ts`
