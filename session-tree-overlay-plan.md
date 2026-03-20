# Session Tree Overlay - Implementation Plan

## Reference

This plan implements the design specified in **session-tree-overlay-wireframe.md** (on canvas). That wireframe defines the full overlay layout, component hierarchy, visual design, conditional rendering rules, data flow, responsive breakpoints, and accessibility requirements. All implementation details below should conform to the wireframe spec.

## Overview

Add a full-viewport overlay triggered by a persistent right-edge handle on the SessionDetailView. The overlay displays the session hierarchy using a dropdown picker that mirrors the session list view's `WorkflowSessionItem` visual pattern, with a reusable conversation view per session.

---

## Phase 1: Right-Edge Handle (Trigger)

### New Component: `SessionTreeHandle.vue`

- **Location:** `packages/web/src/components/SessionTreeHandle.vue`
- **Placement:** Rendered inside `SessionDetailView.vue`, always visible when viewing a session
- **Design:**
  - Fixed position, anchored to the right edge of the viewport, vertically centered
  - Thin vertical tab/pill shape (~40px wide x 100px tall)
  - Semi-transparent `bg-gray-700/80` with `hover:bg-cyan-600/90` transition
  - Icon: small tree/branch icon or `|||` grip lines, rotated 90deg
  - `z-index: 900` (below modals at 1000, above normal content)
  - Slight `border-radius` on the left side (rounded away from screen edge)
  - `cursor: pointer`, subtle slide-in animation on hover (extends ~4px further left)
  - Tooltip on hover: "Session Tree" (optional)
- **Behavior:**
  - `@click` emits `open` event (or toggles a reactive state)
  - Keyboard: focusable, opens on `Enter`/`Space`
- **Responsive:**
  - Same position on all breakpoints
  - Touch-friendly size (min 44px hit target)

### Wire into SessionDetailView

- Import and render `<SessionTreeHandle />` alongside the session detail content
- Add `showTreeOverlay` ref to control overlay visibility
- Handle click: `showTreeOverlay = true`

---

## Phase 2: Overlay Shell

### New Component: `SessionTreeOverlay.vue`

- **Location:** `packages/web/src/components/SessionTreeOverlay.vue`
- **Rendering:** Uses `<Teleport to="body">` (consistent with existing modal pattern)
- **Props:**
  - `sessionId` (String, required) - the current session being viewed
- **Emits:** `close`
- **Template structure:**
  ```
  <Teleport to="body">
    <Transition name="slide-left">
      <div v-if="visible" class="overlay-backdrop" @click.self="close">
        <div class="overlay-content session-tree-overlay">
          <SessionTreeHeader />
          <SessionTreeBreadcrumb />
          <SessionTreeDropdown />  (conditional — only when children exist)
          <ConversationTab />      (reused)
        </div>
      </div>
    </Transition>
  </Teleport>
  ```
- **Styling:**
  - `position: fixed; inset: 0; z-index: 1000`
  - `bg-gray-900` (solid or slight transparency)
  - Slide-in transition from right (300ms ease)
  - Close on `Escape` keydown (global listener, cleaned up on unmount)
  - When `SessionTreePicker` is open, Escape closes the picker first; a second Escape closes the overlay
- **ConversationMessages height override:** The `.session-tree-overlay` wrapper class overrides the child `.messages` max-height using a scoped `:deep()` selector:
  ```css
  .session-tree-overlay :deep(.messages) {
    max-height: calc(100vh - 200px); /* header + breadcrumb + dropdown */
  }
  @media (max-width: 768px) {
    .session-tree-overlay :deep(.messages) {
      max-height: calc(100vh - 160px);
    }
  }
  ```

---

## Phase 3: Overlay Header & Breadcrumb

### `SessionTreeHeader` (inline within overlay or sub-component)

- Displays root session name prominently (`text-xl text-cyan-400`)
- Close button (X) top-right corner
- **Tree icon button** (desktop ≥768px only): small hierarchy icon next to close button, visible only when children exist. Clicking toggles the `SessionTreePicker` open/closed. `text-gray-400` default, `text-cyan-400` on hover.
- `bg-gray-800` strip, fixed height ~60px

### `SessionTreeBreadcrumb` (new — inline in overlay, NOT reusing `SessionHierarchyBreadcrumb`)

The existing `SessionHierarchyBreadcrumb` component navigates via `<router-link>` which would navigate the whole app away from the overlay. The overlay needs breadcrumb clicks to switch the active session instead.

- Build the breadcrumb inline within `SessionTreeOverlay.vue` (or as a small sub-component)
- Uses `getSessionPath(activeSessionId)` getter from sessions store
- Only visible when path length > 1
- Clickable segments call the overlay's internal `selectSession(sessionId)` method to switch the active session — no router navigation
- Same visual styling as `SessionHierarchyBreadcrumb` (`text-gray-400`, `/` separator, hover `text-cyan-400`)

---

## Phase 4: Session Tree Picker (Replaces Tabs)

Instead of horizontal tabs, the overlay uses a dropdown picker that displays the session hierarchy using the same visual pattern as the session list view (`WorkflowSessionItem` / `SessionCardWorkflowPanel`).

### New Component: `SessionTreePicker.vue`

- **Location:** `packages/web/src/components/SessionTreePicker.vue`
- **Purpose:** Reusable dropdown panel showing the full session chain with hierarchy indentation, status badges, summaries, and timestamps — matching the session list view's visual style.
- **Props:**
  - `sessions` (Array) - ordered list: [root, child1, child2, ...]
  - `activeSessionId` (String) - currently selected session
  - `summaries` (Object, optional) - summary data keyed by session ID
- **Emits:** `select(sessionId)`
- **Visual style** (mirrors `WorkflowSessionItem`):
  - Root item: `◉ ROOT` label, no indentation, `paddingLeft: 0.5rem`
  - Direct children: `CHILD` label, `paddingLeft: 1.5 + 0.5rem`
  - Nested children: `└─ CHILD` label, `paddingLeft: depth * 1.5 + 0.5rem`
  - Each item shows: role label, status badge, session name (truncated), summary text, timestamp
  - Active session: highlighted `bg-gray-700`
  - Hover: `rgba(255, 255, 255, 0.05)`
  - Status badges: `● Running` (green), `⏰ Scheduled` (cyan), `⚠ Error` (red)
- **Container:** `bg-gray-800`, `border: 1px solid var(--color-border)`, `border-radius: 6px`, `max-height: 50vh`, `overflow-y: auto`
- **Accessibility:** `role="listbox"` on container, `role="option"` on items, `aria-selected` on active item, arrow key navigation between items

### `SessionTreeDropdown` (inline in overlay)

- **Conditional rendering:** Only rendered when the session chain has more than 1 entry (children exist)
- **Dropdown trigger:** Shows current session name + `▼`/`▲` chevron. Clicking toggles the `SessionTreePicker` open/closed.
  - `bg-gray-800`, `text-gray-100`, chevron `text-gray-400`
  - `aria-expanded` attribute tracks open state
- **Dropdown panel:** Renders `<SessionTreePicker>` below the trigger when open
- **Close behavior:** Click outside, press Escape, or select an item → closes picker

### Data Loading — Full Descendant Chain

`fetchSession()` only loads direct children (one level) into the store. For deeply nested session chains, the overlay must fetch the full descendant tree itself.

**On overlay open:**
1. Use `getRootSession(sessionId)` to find root
2. Use `getAllDescendants(rootId)` to get whatever is already in the store
3. If the chain appears incomplete (any descendant has `hasChildren(id)` true but no children in store), recursively fetch missing children via `api.getSession(childId)` and add them to the store
4. Build the ordered array by walking the chain: start at root, follow `getChildSessions(currentId)[0]` to the next link, repeat. This produces depth-ordered results regardless of what `getAllDescendants` returns.
5. When a picker item is clicked:
   1. Close the `SessionTreePicker`
   2. Set `activeSessionId`
   3. Call `cleanup()` on the previous session's initializer
   4. Call `initializeSession(newSessionId)` (see Phase 5)

---

## Phase 5: Conversation View Integration

### Reuse `ConversationTab`

- The overlay's main content area renders `<ConversationTab :session-id="activeSessionId" :key="activeSessionId" />`
- The `:key` binding ensures proper remounting when switching between sessions (critical for WebSocket cleanup)
- ConversationTab already handles:
  - ConversationPanel (conversation selector)
  - ConversationMessages (message list with scrolling)
  - TodoDrawer
  - RunningState (live work logs)
  - InputForm (message input)
  - SchedulingInfo
  - All modals (QuickResponseSettings, ScheduleSessionModal, etc.)

### Route dependency in ConversationTab

ConversationTab calls `useRoute()` internally for two things:
1. **On mount:** reads `route.query.conv` to restore a conversation selection from the URL
2. **Watch:** watches `route.query.conv` for changes to switch conversations

When rendered in the overlay, the route won't have a matching `conv` query param for the overlay's active session. This is acceptable:
- On mount, `route.query.conv` will be `undefined` or stale — ConversationTab will fall through to the default conversation (the active one from `fetchConversations`), which is correct behavior.
- The watcher will fire but won't match, so it's a no-op.
- Conversation branching in `ConversationMessages` calls `router.push()` which will navigate the underlying route. This is fine — the overlay stays open (it's Teleported to body and keyed on `activeSessionId`, not the route), and if the user closes the overlay they'll land on the branched conversation.

No modifications to ConversationTab are needed.

### WebSocket / Session Initialization

The overlay must manage its own `useSessionInitializer` lifecycle for the active session:
- Call `useSessionInitializer()` in the overlay component
- On mount and on session switch: call `cleanup()` then `initializeSession(activeSessionId)`
- On overlay close / unmount: call `cleanup()`
- This is independent of the SessionDetailView's own initializer (they can coexist — WebSocket subscriptions are additive)

---

## Phase 6: Overlay State Management

### In `SessionDetailView.vue`

- `const showTreeOverlay = ref(false)`
- `const openTreeOverlay = () => { showTreeOverlay.value = true }`
- `const closeTreeOverlay = () => { showTreeOverlay.value = false }`
- Pass to overlay: `<SessionTreeOverlay v-if="showTreeOverlay" :session-id="sessionId" @close="closeTreeOverlay" />`

### Session Data

- The overlay manages its own `activeSessionId` internally
- On open, defaults to the current session being viewed
- Session switching updates `activeSessionId` but does NOT change the URL/route
- The overlay is a "peek" view - closing returns to whatever was on screen

---

## Phase 7: Unit Tests

Unit tests co-located with components following existing patterns (vitest + @vue/test-utils).

### `SessionTreeHandle.test.js`

- **Renders** the handle element with correct CSS classes and ARIA attributes
- **Emits `open`** on click
- **Emits `open`** on Enter keypress
- **Emits `open`** on Space keypress
- **Is focusable** (has `tabindex="0"`)
- **Has accessible label** (`aria-label="Open session tree"`)
- **Has correct z-index** (verifiable via computed style or class check)

### `SessionTreePicker.test.js`

- **Renders an item for each session** in the `sessions` prop array
- **First item shows `◉ ROOT` label** — verify role text
- **Child items show `CHILD` or `└─ CHILD` label** based on depth
- **Indentation increases with depth** — verify inline `paddingLeft` style matches `depth * 1.5 + 0.5rem`
- **Highlights active item** with `bg-gray-700` class based on `activeSessionId` prop
- **Does not highlight inactive items** — verify non-active items lack the active class
- **Emits `select`** with the correct session ID when an item is clicked
- **Truncates long session names** — provide a session with a 100-char name, verify text is truncated
- **Shows status badge** for `running` status (`● Running`, green class)
- **Shows status badge** for `scheduled` status (`⏰ Scheduled`, cyan class)
- **Shows status badge** for `error` status (`⚠ Error`, red class)
- **Shows no status badge** for `completed` or `waiting` status
- **Shows summary text** from `summaries` prop for each session
- **Shows "No summary yet"** when summary is missing
- **Shows formatted timestamp** for each session
- **Arrow down** moves focus to the next item
- **Arrow up** moves focus to the previous item
- **Has `role="listbox"`** on container
- **Has `role="option"`** on each item
- **Has `aria-selected="true"`** on active item

### `SessionTreeOverlay.test.js`

Mock dependencies: sessions store (with `getSessionPath`, `getRootSession`, `getAllDescendants`, `getChildSessions`, `hasChildren`), `useSessionInitializer`, `useRoute`, `useRouter`.

- **Renders overlay content** when mounted (Teleport target)
- **Displays root session name** in header from `getRootSession` result
- **Emits `close`** when close button is clicked
- **Emits `close`** on Escape keydown when picker is closed
- **Does not emit `close`** on Escape when picker is open — instead closes the picker
- **Emits `close`** when clicking the backdrop (not the content area)
- **Does not emit `close`** when clicking inside the overlay content
- **Hides dropdown** when session has no descendants (scenario 1 from wireframe): mount with sessions store returning empty `getAllDescendants`, verify no dropdown trigger rendered
- **Shows dropdown** when session has descendants (scenario 2 from wireframe): mount with store returning descendants, verify dropdown trigger is rendered with current session name
- **Defaults `activeSessionId`** to the passed `sessionId` prop on mount
- **Renders breadcrumb** when `getSessionPath` returns path with length > 1
- **Hides breadcrumb** when `getSessionPath` returns path with length === 1
- **Calls `initializeSession`** on mount with the session ID
- **Calls `cleanup`** on unmount
- **Breadcrumb click** calls internal `selectSession` and updates active session (does NOT call `router.push`)
- **Picker select** event updates active session, calls `cleanup` then `initializeSession` with new session ID, closes picker
- **Shows tree icon button** on desktop (≥768px) when children exist
- **Hides tree icon button** on mobile (<768px)
- **Tree icon click** toggles picker open/closed

---

## Phase 8: E2E Tests

New E2E test file: `tests/e2e/session-tree-overlay.spec.ts`

Run via: `./scripts/pw.sh test tests/e2e/session-tree-overlay.spec.ts`

Uses existing helpers from `tests/e2e/helpers.ts`: `seedProject`, `seedSession`, `seedChildSession`, `cleanupCreatedResources`, `navigateAndWait`, `waitForSessionToExist`, `updateSessionStatus`, `getSession`.

### Setup

- `beforeAll`: `seedProject` + `seedSession` (root) + optionally `seedChildSession` x2 for child tests
- `afterAll`: `cleanupCreatedResources`
- Navigate to session detail page: `/sessions/${sessionId}/conversation`

### Handle Visibility & Interaction

- **Handle is visible** on session detail view (`data-testid="session-tree-handle"` is visible)
- **Handle has correct position** — anchored to right edge (verify CSS `right: 0` or similar)

### Open / Close

- **Clicking handle opens overlay**: click handle, verify `data-testid="session-tree-overlay"` becomes visible
- **Clicking close button closes overlay**: open overlay, click close button, verify overlay is removed from DOM
- **Pressing Escape closes overlay**: open overlay, press Escape, verify overlay is removed
- **Clicking backdrop closes overlay**: open overlay, click the backdrop area (outside content), verify overlay closes
- **Clicking inside overlay content does NOT close**: open overlay, click inside content, verify overlay stays open

### Root-Only Session (No Children — Wireframe Scenario 1)

- Use the root session with no children
- **No session dropdown rendered** — open overlay, verify `data-testid="session-tree-dropdown"` does not exist
- **No tree icon rendered** — verify no tree icon button in header
- **Conversation messages visible** — verify `.messages` container or `data-testid="conversation-messages"` is present
- **Root session name shown** in overlay header text

### Session with Children (Wireframe Scenario 2)

- Seed root + 2 child sessions with distinct names
- Navigate to root session detail, open overlay
- **Session dropdown rendered** — verify `data-testid="session-tree-dropdown"` exists, shows current session name
- **Clicking dropdown opens picker**: click dropdown trigger, verify `data-testid="session-tree-picker"` becomes visible
- **Picker shows all sessions**: verify 3 items (root + 2 children) with correct names
- **Picker shows hierarchy** — root item has `◉ ROOT` label, children have `CHILD` / `└─ CHILD` labels
- **Picker items indented by depth** — verify progressive indentation
- **Active session highlighted** — verify current session's picker item has highlight class
- **Clicking a child item switches conversation**: click child in picker, verify picker closes and conversation area updates
- **Clicking root item switches back**: open picker, click root, verify root conversation is shown
- **Status indicators visible** — set one child to `completed` via `updateSessionStatus`, verify the picker item shows the appropriate status badge

### Picker Close Behavior

- **Escape closes picker but not overlay**: open picker, press Escape, verify picker closes but overlay remains
- **Click outside picker closes it**: open picker, click on conversation area, verify picker closes
- **Selecting an item closes picker**: open picker, click an item, verify picker closes

### Tree Icon (Desktop)

- **Tree icon visible** when children exist (on sufficiently wide viewport)
- **Clicking tree icon opens picker**: click tree icon, verify picker opens
- **Clicking tree icon again closes picker**: click tree icon while picker open, verify picker closes

### Conversation Interaction Within Overlay

- Open overlay for a session with messages
- **Messages are visible** and scrollable within the overlay
- **Input form is present** at the bottom of the overlay

### Re-open Persistence

- Open overlay, switch to child session via picker, close overlay
- Re-open overlay — verify it opens on the current session (resets to the sessionId passed by SessionDetailView, not the previously selected child)

---

## File Summary

| File | Action |
|------|--------|
| `packages/web/src/components/SessionTreeHandle.vue` | **Create** - Right-edge trigger handle |
| `packages/web/src/components/SessionTreeHandle.test.js` | **Create** - Unit tests for handle |
| `packages/web/src/components/SessionTreePicker.vue` | **Create** - Hierarchy dropdown panel (reusable) |
| `packages/web/src/components/SessionTreePicker.test.js` | **Create** - Unit tests for picker |
| `packages/web/src/components/SessionTreeOverlay.vue` | **Create** - Full overlay container (header, breadcrumb, dropdown, conversation) |
| `packages/web/src/components/SessionTreeOverlay.test.js` | **Create** - Unit tests for overlay |
| `packages/web/src/views/SessionDetailView.vue` | **Modify** - Add handle + overlay |
| `tests/e2e/session-tree-overlay.spec.ts` | **Create** - E2E tests |

---

## Implementation Order

1. Create `SessionTreeHandle.vue` with styling and click behavior
2. Create `SessionTreeHandle.test.js` — unit tests for handle
3. Create `SessionTreePicker.vue` — hierarchy list mirroring `WorkflowSessionItem` visual style
4. Create `SessionTreePicker.test.js` — unit tests for rendering, selection, indentation, status badges, keyboard navigation
5. Create `SessionTreeOverlay.vue` shell (header, close, tree icon, dropdown trigger, picker integration, breadcrumb, transitions, escape key, `:deep()` height override)
6. Create `SessionTreeOverlay.test.js` — unit tests for overlay open/close/escape/breadcrumb/dropdown/picker conditional
7. Wire handle + overlay into `SessionDetailView.vue` — verify open/close works
8. Add full descendant chain fetching logic in overlay (walk chain, fetch missing children)
9. Integrate `ConversationTab` into overlay with session switching + `useSessionInitializer` lifecycle
10. Create `tests/e2e/session-tree-overlay.spec.ts` — E2E tests for full workflow
11. Run full test suite (`yarn test` + `./scripts/pw.sh test`) and fix regressions
