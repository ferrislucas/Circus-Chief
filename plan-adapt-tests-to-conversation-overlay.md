# Plan: Adapt Failing E2E Tests to Use Conversation Overlay

## Context

The **Conversation tab** in `SessionDetailView` is being removed. Conversations will only be accessible via the **SessionTreeOverlay** (the slide-in panel triggered by the handle on the right side of the page). The default tab will change from `conversation` to `summary`.

This means any E2E test that currently:
- Navigates to `/sessions/:id` expecting to see messages (currently defaults to conversation tab)
- Navigates to `/sessions/:id/conversation` explicitly
- Looks for message selectors, running state, or work log panels on the main page

...will need to **open the overlay first** before those elements are visible in the DOM.

---

## Step 0: Add a Shared Helper to `tests/e2e/helpers.ts`

Create a reusable `openConversationOverlay()` helper that all adapted tests can use:

```typescript
export async function openConversationOverlay(page: Page, sessionId: string) {
  await navigateAndWait(page, `/sessions/${sessionId}`, {
    waitFor: '.session-detail',
    timeout: 15000,
  });
  const handle = page.locator('[data-testid="session-tree-handle"]');
  await expect(handle).toBeVisible({ timeout: 10000 });
  await handle.click();
  const overlay = page.locator('[data-testid="session-tree-overlay"]');
  await expect(overlay).toBeVisible({ timeout: 5000 });
  return overlay;
}
```

All message/conversation selectors should then be **scoped to the overlay**:
```typescript
const overlay = await openConversationOverlay(page, session.id);
// Instead of: page.locator('[data-testid="message-assistant"]')
// Use:        overlay.locator('[data-testid="message-assistant"]')
```

---

## Step 1: `work-log-panels.spec.ts` (14 tests)

**File:** `tests/e2e/work-log-panels.spec.ts`

### What needs to change

These tests navigate to `/sessions/${id}` and immediately look for:
- `.running-state` / `.running-title` / `.live-work-log-panel` (live work log tests)
- `[data-testid="message-assistant"]` / `[data-testid="message-user"]` (completed message tests)
- `.work-log-panel`, `.work-log-header`, `.work-log-count`, etc.

### Adaptation

**For all 14 tests:**
1. Replace direct `page.goto()` with `openConversationOverlay(page, session.id)`
2. Scope all message/work-log selectors to the returned overlay locator
3. For running-state tests: the overlay must render `RunningState` when the session is running -- verify this is the case since `ConversationTab` (embedded in the overlay) renders it

**Example before:**
```typescript
await page.goto(`${API_URL}/sessions/${session.id}`);
await page.waitForSelector('.running-state', { timeout: 10000 });
```

**Example after:**
```typescript
const overlay = await openConversationOverlay(page, session.id);
await expect(overlay.locator('.running-state')).toBeVisible({ timeout: 10000 });
```

---

## Step 2: `session-message-persistence.spec.ts` (4 tests)

**File:** `tests/e2e/session-message-persistence.spec.ts`

### What needs to change

Tests navigate to `/sessions/${id}` and check for:
- `[data-testid="message-assistant"]`
- `[data-testid="message-user"]`
- `.message-content`
- Message count before/after page refresh

### Adaptation

1. Use `openConversationOverlay()` instead of `page.goto()`
2. Scope all message selectors to the overlay
3. **Page refresh test**: After `page.reload()`, the overlay will close. Must re-open the overlay and re-scope selectors before counting messages again.

**Special attention:** The "message count before refresh matches after refresh" test needs:
```typescript
// Count messages in overlay
const overlay1 = await openConversationOverlay(page, session.id);
const countBefore = await overlay1.locator('[data-testid="message-assistant"]').count();

// Refresh closes the overlay
await page.reload();

// Re-open overlay and re-count
const overlay2 = await openConversationOverlay(page, session.id);
const countAfter = await overlay2.locator('[data-testid="message-assistant"]').count();

expect(countAfter).toBe(countBefore);
```

---

## Step 3: `sessions.spec.ts` (1 test)

**File:** `tests/e2e/sessions.spec.ts`

### What needs to change

The "displays session messages" test navigates to `/sessions/${id}` and checks for `.message-content`.

### Adaptation

1. Use `openConversationOverlay()` to access messages
2. Scope `.message-content` selector to the overlay
3. If the test also navigates to `/sessions/${id}/conversation` explicitly, change that to open the overlay instead

---

## Step 4: `websocket-recovery.spec.ts` (3 tests)

**File:** `tests/e2e/websocket-recovery.spec.ts`

### What needs to change

Tests navigate to `/sessions/${id}` and check for:
- `text=hello` (literal text matcher for messages)
- `text=message-after-wake` (text after reconnect)
- `.toast.toast-error`

### Adaptation

1. Use `openConversationOverlay()` for session detail tests
2. Scope message text locators to the overlay
3. **Toast selectors** (`.toast.toast-error`) should remain page-scoped since toasts render at the body level
4. **Session list test** ("session list recovers project subscription after sleep") does NOT need overlay changes -- it tests the session list page, not session detail

**Special attention:** The sleep/wake simulation may close the overlay. After simulating wake, the test may need to:
- Check if overlay is still open
- Re-open if closed
- Then verify messages appear

---

## Step 5: `work-log-dedup.spec.ts` (2 tests)

**File:** `tests/e2e/work-log-dedup.spec.ts`

### What needs to change

Tests navigate to `/sessions/${id}`, wait for `[data-testid="message-assistant"]`, then use `page.evaluate()` to access the Pinia store directly.

### Adaptation

1. Use `openConversationOverlay()` to make messages visible
2. Scope the `[data-testid="message-assistant"]` wait to the overlay
3. **Store access via `page.evaluate()`** can remain page-scoped since the Pinia store is a global singleton -- it doesn't matter whether the overlay is the active context

---

## Step 6: `scheduling-ui.spec.ts` (4 tests)

**File:** `tests/e2e/scheduling-ui.spec.ts`

### What needs to change

Tests look for `.orchestration-panel .panel-header` which is currently rendered inside `ConversationTab`.

### Decision needed

The orchestration panel is part of the `ConversationTab` component. When the conversation tab is removed from the main view, the orchestration panel will only exist inside the overlay (since the overlay embeds `ConversationTab`).

### Adaptation

1. Use `openConversationOverlay()` to access the orchestration panel
2. Scope `.orchestration-panel` selectors to the overlay
3. Scope `textarea`, `.btn-schedule`, and modal selectors appropriately
4. **Modal selectors** (`.modal-backdrop`, `input[type="datetime-local"]`) may render at body level via Teleport -- keep those page-scoped

**Alternative**: If the orchestration panel is moved to the main session detail view (outside the overlay), these tests won't need overlay changes. This depends on the UI design decision.

---

## Step 7: `session-summaries.spec.ts` (7 tests)

**File:** `tests/e2e/session-summaries.spec.ts`

### What needs to change

These tests navigate directly to `/sessions/${id}/summary` and interact with summary-specific selectors. They do **NOT** interact with the conversation view.

### Adaptation

**Likely NO conversation overlay changes needed.** These tests already navigate to the summary tab explicitly. Their failures are caused by the separate WebSocket status overwrite issue (documented in the failing tests analysis), not by the conversation tab.

**However**, verify that:
- Summary tab still renders correctly when it becomes the default tab
- No selectors depend on the conversation tab being present in the DOM

---

## Step 8: `summary-regenerate.spec.ts` (2 tests)

**File:** `tests/e2e/summary-regenerate.spec.ts`

### What needs to change

Same as session-summaries -- these navigate to `/sessions/${id}/summary` explicitly.

### Adaptation

**Likely NO conversation overlay changes needed.** These failures are from the WebSocket status overwrite issue, not conversation tab removal.

---

## Summary of Changes by File

| File | Tests | Overlay Change Needed? | Key Selectors to Scope |
|------|-------|----------------------|----------------------|
| `work-log-panels.spec.ts` | 14 | Yes | `.running-state`, `[data-testid="message-*"]`, `.work-log-panel`, `.live-work-log-panel` |
| `session-message-persistence.spec.ts` | 4 | Yes | `[data-testid="message-*"]`, `.message-content` |
| `sessions.spec.ts` | 1 | Yes | `.message-content` |
| `websocket-recovery.spec.ts` | 2 of 3 | Yes | `text=hello`, `text=message-after-wake` |
| `work-log-dedup.spec.ts` | 2 | Yes | `[data-testid="message-assistant"]`, `.work-log-panel` |
| `scheduling-ui.spec.ts` | 4 | Yes (if panel stays in ConversationTab) | `.orchestration-panel`, `.btn-schedule` |
| `session-summaries.spec.ts` | 7 | No | N/A (summary tab) |
| `summary-regenerate.spec.ts` | 2 | No | N/A (summary tab) |

**Total tests requiring overlay adaptation: ~27 of 37**

---

## Risks & Edge Cases

1. **Overlay animations**: The overlay uses a `slide-left` CSS transition. Tests may need small waits or `toBeVisible()` assertions before interacting with overlay content.

2. **Page reload closes overlay**: Any test that refreshes the page will need to re-open the overlay afterward.

3. **WebSocket events while overlay is open**: The overlay's ConversationTab should still receive store updates. Verify that WebSocket-driven changes (status updates, new messages) are reflected inside the overlay.

4. **Orchestration panel location**: Need a design decision on whether the orchestration panel stays in the overlay or moves to the main page. This affects 4 scheduling tests.

5. **Other test files**: The failing tests document covers 8 files, but there may be other passing tests that navigate to `/sessions/:id` expecting conversation content. A grep for `page.goto.*\/sessions\/.*` and `/conversation` across all E2E tests should catch these.

6. **Default tab change**: Tests in `filtering-navigation.spec.ts` currently test "session detail defaults to conversation tab" -- this test will need to be updated to expect the summary tab as the default.
