# E2E Testing Guide

This document covers patterns, conventions, and infrastructure for writing and running end-to-end tests in claudetools.io.

## Running Tests

Always use `./scripts/pw.sh` — never run Playwright directly. This ensures server isolation and correct port assignment.

```bash
./scripts/pw.sh test                              # Run all E2E tests
./scripts/pw.sh test --grep="canvas"              # Filter by test name
./scripts/pw.sh test tests/e2e/canvas.spec.ts     # Run specific file
./scripts/pw.sh debug tests/e2e/canvas.spec.ts    # Headed browser (debug mode)
```

See the main [CLAUDE.md](../CLAUDE.md) for details on port assignment and server isolation.

## Test Structure

Tests live in `tests/e2e/*.spec.ts`. Shared helpers live in `tests/e2e/helpers.ts`.

A typical test file follows this pattern:

```typescript
import { test, expect } from '@playwright/test';
import { seedProject, seedSession, cleanupAll, navigateAndWait } from './helpers';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

test.describe('Feature Name', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('does something', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Hello',
      name: 'My Test',
      startImmediately: false,
    });
    // ... seed data, navigate, assert
  });
});
```

## LLM Mocking Strategy

The E2E tests use **three complementary strategies** to avoid real LLM calls. Understanding which one to use is critical when writing new tests.

### Strategy 1: Data Seeding (No LLM — Used by ~90% of Tests)

Most tests don't need the LLM at all. They create sessions with `startImmediately: false`, which puts the session in `'waiting'` (draft) status without ever calling the Claude SDK. Messages and other data are then seeded directly into the database.

```typescript
// Create a session that does NOT call the LLM
const session = await seedSession(project.id, {
  prompt: 'Hello',
  name: 'My Test',
  startImmediately: false,  // ← key flag — no LLM call
});

// Seed messages directly into the database (bypasses LLM entirely)
seedAssistantMessage(session.id, '# Hello World', 'claude-sonnet-4-20250514');
seedUserMessage(session.id, 'Thanks!');
seedAssistantMessageWithTools(session.id, 'Reading file...', [
  { type: 'tool_use', id: 'toolu_123', name: 'Read', input: { file_path: '/app.js' } }
], 'claude-sonnet-4-20250514');

// Set session to whatever state the test needs
await updateSessionStatus(session.id, 'waiting');  // or 'running', 'error', 'completed'
```

**How the seed helpers work:**

The `seedAssistantMessage`, `seedUserMessage`, and `seedAssistantMessageWithTools` helpers invoke `scripts/seed-message.mjs`, which writes directly to the SQLite `conversation_messages` table. Similarly, `seedWorkLog` writes via the REST API, and `seedSessionSummaryDirect` uses `scripts/seed-summary.mjs`.

**When to use this strategy:**
- Testing UI rendering (markdown, tool blocks, code blocks, model badges)
- Testing navigation, filtering, session list views
- Testing input controls (textarea, send button, stop button)
- Testing status-dependent UI (error banners, running indicators)
- Testing canvas items, notes, summaries, templates, scheduling UI
- Any test where you control the exact content being displayed

**Available seed helpers:**

| Helper | What it seeds |
|--------|--------------|
| `seedProject(name, dir)` | Project via REST API |
| `seedSession(projectId, opts)` | Session via REST API |
| `seedAssistantMessage(sessionId, content, model)` | Assistant message via DB script |
| `seedUserMessage(sessionId, content)` | User message via DB script |
| `seedAssistantMessageWithTools(sessionId, content, tools, model)` | Assistant message with tool use via DB script |
| `seedConversationHistory(sessionId, count)` | Alternating user/assistant messages |
| `seedWorkLog(sessionId, data)` | Work log entry via REST API |
| `seedCanvasItem(sessionId, data)` | Canvas item via REST API |
| `seedSessionNote(sessionId, data)` | Session note via REST API |
| `seedSessionSummaryDirect(sessionId, data)` | Summary via DB script |
| `seedSessionSummaryWithPR(sessionId, data)` | Summary + PR state via DB script |
| `seedTodos(sessionId, conversationId, todos)` | Todo items via DB script |
| `seedConversationTokens(sessionId, conversationId, tokens)` | Token usage via DB script |
| `seedCommandButton(projectId, data)` | Command button via REST API |
| `seedProjectTemplate(projectId, data)` | Project template via REST API |
| `seedGlobalTemplate(data)` | Global template via REST API |
| `seedScheduledSession(projectId, data)` | Scheduled session via REST API |
| `seedQuickResponse(projectId, data)` | Quick response via REST API |
| `updateSessionStatus(sessionId, status)` | Session status via REST PATCH |

### Strategy 2: VCR Cassettes (For Tests That Need the Full Session Lifecycle)

When a test needs to exercise the actual session flow — creating a session, having the agent process it, streaming events back — the server uses a **VCR (Video Cassette Recorder)** pattern that intercepts SDK calls at the server level.

#### How VCR Works

The VCR adapter wraps the real Claude agent SDK. When `VCR_MODE` is set, the `VCRAgentAdapter` intercepts all calls to the agent's `execute()` method:

```
SessionManager → AgentGateway → VCRAgentAdapter → ClaudeCodeAdapter → SDK
                                      ↕
                              tests/e2e/cassettes/*.json
```

The adapter records or replays the full event stream from the SDK, including `message_start`, `content_block_delta`, `tool_use`, `message_stop`, etc.

#### VCR Modes

| Mode | Behavior | When Used |
|------|----------|-----------|
| `auto` | Replay if cassette exists; record if not | Default for `./scripts/pw.sh test` |
| `record` | Always call real SDK, save result to cassette | Recording new test data |
| `replay` | Always replay from cassette; error if missing | CI / strict reproducibility |
| _(unset)_ | VCR disabled — pass through to real SDK | Development without VCR |

`pw.sh` automatically sets `VCR_MODE=auto` when running tests. You can override:

```bash
VCR_MODE=record ./scripts/pw.sh test tests/e2e/template-system.spec.ts
```

#### Cassette Files

Cassettes are JSON files committed to `tests/e2e/cassettes/`:

```
tests/e2e/cassettes/
├── runSession-07104894ef68cb7d.json
├── continueSession-6cc8519b91584e8b.json
├── continueSessionWithExistingMessage-94e658ffd242ab78.json
└── ...
```

Each cassette is keyed by `{callType}-{sha256(prompt).substring(0,16)}`. The key is derived **only** from the user prompt text, making it stable across runs (UUIDs, ports, and system prompts are excluded from the hash).

Cassette structure:

```json
{
  "key": "runSession-07104894ef68cb7d",
  "prompt": "Hello, please help me...",
  "model": "claude-haiku-4-5-20251001",
  "recordedAt": "2025-07-15T12:00:00.000Z",
  "events": [
    { "type": "message_start", "message": { "id": "msg_01..." } },
    { "type": "content_block_start", "content_block": { "type": "text" } },
    { "type": "content_block_delta", "delta": { "type": "text_delta", "text": "Here is..." } },
    { "type": "content_block_stop" },
    { "type": "message_delta", "delta": { "stop_reason": "end_turn" } },
    { "type": "message_stop" }
  ]
}
```

#### Cost Control

When VCR mode is active, the session manager automatically:
- Forces the **Haiku** model (cheapest) to minimize recording costs
- Disables **thinking tokens** to keep cassettes small

#### Summary VCR

The summary service has its own VCR wrapper (`VCRSummaryWrapper`) because it calls the SDK `query()` directly rather than going through the agent gateway. Summary cassettes are stored in `tests/e2e/cassettes/summaries/`.

#### When to Use VCR

Use VCR for tests that exercise:
- The full session start → LLM response → completion lifecycle
- Template chaining (session completes → next template auto-starts)
- Conversation branching with re-execution
- Any flow where session status transitions naturally from `starting` → `running` → `waiting`/`completed`

Tests using VCR typically look like:

```typescript
const session = await seedSession(project.id, {
  prompt: 'Specific prompt that matches a cassette',
  name: 'VCR Test',
  // startImmediately defaults to true — triggers the LLM (or VCR replay)
});

// Wait for the session to finish
await waitForStatus(session.id, 'waiting', 30000);

// Now assert on what happened
const messages = await getSessionMessages(session.id);
expect(messages.length).toBeGreaterThan(0);
```

#### Recording New Cassettes

When writing a new test that needs VCR:

1. Write the test with the prompt you want
2. Run with `VCR_MODE=record`:
   ```bash
   VCR_MODE=record ./scripts/pw.sh test tests/e2e/my-new-test.spec.ts
   ```
3. This makes real API calls and saves the responses as cassettes
4. Commit the new cassette files in `tests/e2e/cassettes/`
5. Subsequent runs with `VCR_MODE=auto` will replay from the cassettes

### Strategy 3: Playwright Route Interception (For API Error Simulation)

A small number of tests use `page.route()` to intercept REST API calls. This is **not** used for LLM mocking — it's used to simulate server errors and test the UI's error handling:

```typescript
// Simulate a server error on archive
await page.route('**/api/sessions/*/archive', (route) =>
  route.fulfill({ status: 500, body: JSON.stringify({ error: 'Server error' }) })
);

// Simulate a session fetch failure
await page.route(`**/api/sessions/${session.id}`, (route) =>
  route.fulfill({ status: 500, body: JSON.stringify({ error: 'Internal error' }) })
);
```

**When to use this:** Only for testing how the frontend handles API failures (error toasts, retry logic, fallback states).

## Helper Reference

### Navigation & Waiting

```typescript
await navigateAndWait(page, url);                 // Navigate + wait for networkidle
await navigateAndWait(page, url, { waitFor: '.my-selector' }); // + wait for element
await waitForPageReady(page);                      // Wait for networkidle + loading spinners
await waitForElement(page, '.selector');            // Wait for element visible
await waitForTextVisible(page, 'Hello');            // Wait for text visible
await waitForSessionStatus(page, sessionId, 'waiting');  // Poll API for status
await waitForStatus(sessionId, 'waiting', 60000);  // Poll API for status (no page needed)
```

### API Verification

```typescript
const project = await getProject(id);
const sessions = await getProjectSessions(projectId);
const session = await getSession(sessionId);
const messages = await getSessionMessages(sessionId);
const items = await getCanvasItems(sessionId);
const notes = await getSessionNotes(sessionId);
```

### Cleanup

Every test should clean up after itself:

```typescript
test.beforeEach(async () => {
  await cleanupAll();  // Cleans up test-prefixed projects + providers
});

test.afterEach(async () => {
  await cleanupAll();
});
```

The `cleanupAll()` function only deletes resources prefixed with the current worker's `TEST_PREFIX`, making it safe for parallel execution.

For more targeted cleanup, use `cleanupCreatedResources()`, which only deletes resources explicitly created by the current test (tracked via `seedProject`, `seedSession`, etc.).

### WebSocket Testing

```typescript
const ws = await connectWebSocket();
subscribeToSession(ws, sessionId);

// Wait for a specific message type
const msg = await waitForWSMessage(ws, 'session:status', 10000);

// Collect all messages in a time window
const msgs = await collectWSMessages(ws, 2000);

// Collect until a stop condition
const msgs = await collectWSMessagesUntil(ws, 'session:status', 15000);

// Assert no message received
await assertNoWSMessage(ws, 'session:deleted', 1000);
```

## Parallel Test Execution

Tests run in parallel across multiple Playwright workers. To avoid conflicts:

1. **Unique prefixes**: Each worker generates a unique `TEST_PREFIX` based on timestamp + random string. All seeded projects/providers include this prefix.
2. **Scoped cleanup**: `cleanupAll()` only deletes resources matching the current worker's prefix.
3. **Atomic cassette writes**: `CassetteStore` uses temp-file-then-rename to prevent corruption from concurrent writes.
4. **Independent databases**: Each test server instance has its own SQLite database.

## Writing New Tests

### Deciding Which Strategy to Use

Ask yourself: **Does this test need the LLM to actually respond?**

- **No** (vast majority) → Use data seeding with `startImmediately: false`
- **Yes, and I need the full streaming lifecycle** → Use VCR cassettes
- **I need to test error handling in the UI** → Use `page.route()` interception

### Test File Naming

Follow existing conventions:
- Feature tests: `feature-name.spec.ts` (e.g., `canvas.spec.ts`, `templates.spec.ts`)
- Sub-feature tests: `feature-subfeature.spec.ts` (e.g., `command-buttons-extended.spec.ts`)
- UI-focused tests: `ui-ux.spec.ts`, `session-detail-scroll.spec.ts`

### Common Patterns

**Testing a UI component with seeded data:**

```typescript
test('shows markdown table in assistant message', async ({ page }) => {
  const session = await seedSession(project.id, {
    prompt: 'Hello', name: 'Table Test', startImmediately: false,
  });
  seedAssistantMessage(session.id,
    '| A | B |\n|---|---|\n| 1 | 2 |',
    'claude-sonnet-4-20250514'
  );
  await updateSessionStatus(session.id, 'waiting');

  await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}`);
  await expect(page.locator('table')).toBeVisible({ timeout: 10000 });
});
```

**Testing a session lifecycle with VCR:**

```typescript
test('session completes and shows response', async ({ page }) => {
  const session = await seedSession(project.id, {
    prompt: 'Say hello in exactly 3 words',
    name: 'Lifecycle Test',
    // startImmediately defaults to true — VCR will replay the cassette
  });

  await waitForStatus(session.id, 'waiting', 30000);
  await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}`);

  const assistant = page.locator('[data-testid="message-assistant"]');
  await expect(assistant).toBeVisible({ timeout: 10000 });
});
```

**Testing API error handling:**

```typescript
test('shows error toast on archive failure', async ({ page }) => {
  const session = await seedSession(project.id, {
    prompt: 'Hello', name: 'Error Test', startImmediately: false,
  });
  await updateSessionStatus(session.id, 'completed');

  await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}`);

  // Intercept the archive API to return an error
  await page.route('**/api/sessions/*/archive', (route) =>
    route.fulfill({ status: 500, body: JSON.stringify({ error: 'Server error' }) })
  );

  await page.locator('.btn-archive').click();
  await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
});
```
