# Fix VCR Token Leak in E2E Tests

## Problem

Running Playwright E2E tests consumes ~7% of a 4-hour token allotment despite all VCR cassettes being committed. Real Claude API calls are being made when they shouldn't be.

## Root Causes

### Bug 1 (Critical): `callClaudeWithCustomSchema` bypasses VCR entirely

**File:** `packages/server/src/services/summaryService.js` line 1388-1389

```javascript
const queryFn = isMockMode() ? mockCombinedSummaryQuery : query;
```

This function checks `MOCK_CLAUDE` (a legacy env var) instead of `VCR_MODE`. When `VCR_MODE=auto` is set (normal E2E test run), this code ignores it and calls the raw SDK `query` directly.

`callClaudeWithCustomSchema` is called from `generateSessionAndConversationSummary` (the "combined summary" path). `onSessionComplete` prefers the combined path whenever an active conversation exists without a summary — which is the common case. This means every session completion during E2E tests fires a real, un-cached Claude API call.

Additionally, when the combined summary call fails, the fallback path calls `generateSummary` (which uses `callClaude`) AND `generateConversationSummary` (also `callClaude`) — both of which ARE VCR-wrapped but still leak tokens due to Bug 2.

**Affected E2E test path:** `conversation-management.spec.ts` uses `seedSessionWithMessages()` which calls `seedSession()` without `startImmediately: false`. This defaults to `startImmediately: true`, triggering real session runs via the VCR-wrapped agent. When those sessions complete, `onSessionComplete` fires and hits the un-wrapped combined summary path.

The `onSessionActivity` debounced path (60s delay) also triggers `generateSummary` → `callClaude` on every turn completion for these sessions, contributing additional token usage via Bug 2.

### Bug 2 (Secondary): Summary cassette keys are inherently unstable

Summary cassettes hash the **full prompt text** via `buildSummaryKey()` in `VCRSummaryWrapper.js`:

```javascript
function buildSummaryKey(queryParams) {
  const promptText = queryParams.prompt || '';
  return CassetteStore.buildKey('summary', promptText);
}
```

Summary prompts are built dynamically from existing summary content, recent message content, session status, and child session context. This content changes every run (different session IDs, different message content from VCR replays, different existing summary state). So even the correctly-wrapped `callClaude` path will almost always miss its cassette and re-record in `auto` mode — making a real API call.

### Bug 3 (Cleanup): `MOCK_CLAUDE` is a dead legacy mechanism

`MOCK_CLAUDE` is a pre-VCR testing mechanism. It is referenced in exactly 3 places:

1. `summaryService.js` line 30: `isMockMode()` function definition
2. `sessionManager.test.js` lines 1143/1159: Set/cleared in the "summary service integration" `beforeEach`/`afterEach` — but this is redundant because line 22 already has `vi.mock('@anthropic-ai/claude-agent-sdk')` which intercepts all SDK calls for the entire test file
3. `api-sessions-summary.test.js` line 20: `vi.stubEnv('MOCK_CLAUDE', 'true')` — but this test only exercises the `PUT /api/sessions/:id/summary` HTTP endpoint which upserts summaries directly in the database and never calls Claude

`isMockMode` is exported from `summaryService.js` but never imported anywhere.

---

## Plan

### Step 1: Wire `callClaudeWithCustomSchema` through VCR

**File:** `packages/server/src/services/summaryService.js`

In `callClaudeWithCustomSchema` (line 1388), replace:
```javascript
const queryFn = isMockMode() ? mockCombinedSummaryQuery : query;
```
with:
```javascript
const queryFn = process.env.VCR_MODE
  ? createVCRQueryFn(query, 'tests/e2e/cassettes/summaries')
  : query;
```

Remove the `isMockMode()` ternary from `queryParams` construction (lines 1391-1406). Always build the real SDK params object:
```javascript
const queryParams = {
  prompt,
  options: {
    cwd: process.cwd(),
    permissionMode: 'bypassPermissions',
    maxTurns: 1,
    model: 'claude-haiku-4-5-20251001',
    systemPrompt,
    outputFormat: {
      type: 'json_schema',
      schema: jsonSchema,
    },
  },
};
```

Remove the `isMockMode()` ternary from the `agentCallLogger.startCall` model field (line 1415). Always use `'claude-haiku-4-5-20251001'`.

### Step 2: Remove `MOCK_CLAUDE` and all related code

**`packages/server/src/services/summaryService.js`:**
- Delete the `isMockMode` function (line 30: `const isMockMode = () => process.env.MOCK_CLAUDE === 'true';`)
- Delete the `mockCombinedSummaryQuery` async generator function (lines 1331-1376)
- Remove `isMockMode` from the named exports on line 1605

**`packages/server/test/api-sessions-summary.test.js`:**
- Delete line 20: `vi.stubEnv('MOCK_CLAUDE', 'true');`
- No replacement needed — this test exercises the PUT summary HTTP endpoint which writes directly to the DB and never calls Claude

**`packages/server/src/services/sessionManager.test.js`:**
- Delete line 1143: `process.env.MOCK_CLAUDE = 'true';`
- Delete line 1159: `delete process.env.MOCK_CLAUDE;`
- No replacement needed — line 22 already has `vi.mock('@anthropic-ai/claude-agent-sdk')` which mocks all SDK calls for the entire file. The summary service integration tests (line 1165+) additionally mock `onSessionActivity`, `onSessionComplete`, and `extractPrUrlIfNeeded` with `vi.spyOn(...).mockImplementation()`, so no summary code runs.

### Step 3: Stabilize summary cassette keys

**File:** `packages/server/src/agents/vcr/VCRSummaryWrapper.js`

The current `buildSummaryKey` hashes the full dynamic prompt, which changes every run.

**Change `createVCRQueryFn` to accept an optional `keyHint` string parameter.** When provided, use `keyHint` instead of `queryParams.prompt` for cassette key generation:

```javascript
export function createVCRQueryFn(realQueryFn, cassetteDir, keyHint = null) {
  const mode = process.env.VCR_MODE || undefined;

  return async function* vcrQuery(queryParams) {
    const keySource = keyHint || queryParams.prompt || '';
    const key = CassetteStore.buildKey('summary', keySource);
    // ... rest unchanged
  };
}
```

**File:** `packages/server/src/services/summaryService.js`

Update `callClaude` and `callClaudeWithCustomSchema` to pass a stable `keyHint` when creating the VCR query function. The key hint should be derived from the `logMeta.callType` combined with the `sessionId` — both are stable across runs for the same test:

In `callClaude` (line 96-100):
```javascript
const keyHint = logMeta ? `${logMeta.callType}:${logMeta.sessionId}` : null;
const queryFn = process.env.VCR_MODE
  ? createVCRQueryFn(query, 'tests/e2e/cassettes/summaries', keyHint)
  : query;
```

Same pattern in `callClaudeWithCustomSchema`.

**Why `callType:sessionId`?** The `callType` distinguishes between `generateSessionSummary`, `generateCombinedSummary`, and `generateConversationSummary`. The `sessionId` is a UUID that remains stable for the lifetime of a session within a single test run. Together they produce a unique, stable key per summary call within a test. Different tests create different sessions (different UUIDs), so keys won't collide across tests.

**Important caveat:** Session UUIDs are different across test runs (they're generated fresh each time). This means cassettes keyed on sessionId will miss on replay. To make this work, we need to key on something truly stable. Two options:

**Option A — Key on `callType` + session's original prompt:** The session's original prompt is a hardcoded string in E2E tests (e.g., `'Test conversation switching'`). Look up the session from the DB using `logMeta.sessionId` to get its original prompt:

```javascript
// In callClaude / callClaudeWithCustomSchema:
let keyHint = null;
if (process.env.VCR_MODE && logMeta?.sessionId) {
  const session = sessions.getById(logMeta.sessionId);
  keyHint = session ? `${logMeta.callType}:${session.prompt}` : null;
}
const queryFn = process.env.VCR_MODE
  ? createVCRQueryFn(query, 'tests/e2e/cassettes/summaries', keyHint)
  : query;
```

This is the preferred approach because:
- Session prompts are hardcoded strings in tests (e.g., `'Test conversation switching'`)
- The same test always produces the same cassette key
- Different tests with different prompts get distinct cassette keys
- No dependency on UUIDs which change every run

**Option B — Key on `callType` only:** Simpler but risks collisions if multiple tests trigger the same callType. Not recommended.

**Use Option A.**

### Step 4: Unit tests for changes

**`packages/server/src/agents/vcr/VCRSummaryWrapper.test.js`** — add tests for `keyHint`:

1. **`keyHint overrides prompt for cassette key`**: Create VCR query fn with `keyHint='stable-key'`, record a cassette, then verify it can be replayed using the same `keyHint` even when the prompt text is different.

2. **`keyHint=null falls back to prompt hashing`**: Create VCR query fn without `keyHint`, verify behavior is unchanged from current (uses `queryParams.prompt` for key).

3. **`same keyHint with different prompts replays same cassette`**: Record with prompt A + keyHint X, replay with prompt B + keyHint X — should replay the cassette from A.

The E2E tests themselves (Step 5) serve as the integration test for the `summaryService.js` changes — running in `VCR_MODE=replay` will fail if `callClaudeWithCustomSchema` isn't properly wired through VCR.

### Step 5: Record cassettes and verify

1. Run unit tests: `yarn workspace @claudetools/server test`
2. Delete existing summary cassettes: `rm tests/e2e/cassettes/summaries/*.json`
3. Record fresh summary cassettes: `VCR_MODE=record ./scripts/pw.sh test`
4. Verify replay mode works with zero real API calls: `VCR_MODE=replay ./scripts/pw.sh test`
5. Verify no references to `MOCK_CLAUDE` remain: `grep -r MOCK_CLAUDE packages/ tests/`

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/server/src/services/summaryService.js` | Wire `callClaudeWithCustomSchema` through VCR with `keyHint`; update `callClaude` to pass `keyHint`; delete `isMockMode` function; delete `mockCombinedSummaryQuery` generator; remove `isMockMode` from exports |
| `packages/server/src/agents/vcr/VCRSummaryWrapper.js` | Add `keyHint` parameter to `createVCRQueryFn`; use `keyHint` over `queryParams.prompt` when provided |
| `packages/server/src/agents/vcr/VCRSummaryWrapper.test.js` | Add 3 tests for `keyHint` behavior (override, fallback, cross-prompt replay) |
| `packages/server/test/api-sessions-summary.test.js` | Delete `vi.stubEnv('MOCK_CLAUDE', 'true')` line (no replacement needed) |
| `packages/server/src/services/sessionManager.test.js` | Delete `process.env.MOCK_CLAUDE = 'true'` and `delete process.env.MOCK_CLAUDE` lines (no replacement needed — SDK already mocked via `vi.mock`) |

## Files to Verify (no changes expected)

| File | Verify |
|------|--------|
| `packages/server/src/agents/vcr/VCRAgentAdapter.js` | Already correct — session calls use VCR properly |
| `packages/server/src/agents/vcr/CassetteStore.js` | No changes needed |
| `packages/server/src/services/sessionManager.js` | Already correct — wraps agent with VCR |
| `scripts/pw.sh` | Already sets `VCR_MODE` correctly |
