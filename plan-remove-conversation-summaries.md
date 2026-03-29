# Plan: Remove Conversation Summary Feature

Remove the conversation summary feature while preserving all session summary functionality. Database schema fields are kept for backward compatibility.

---

## Phase 1 — Delete Dedicated Files

| # | Action | File |
|---|--------|------|
| 1 | **Delete** | `packages/server/src/services/conversationSummary.js` |
| 2 | **Delete** | `packages/server/src/services/conversationSummary.test.js` |

These files are 100% conversation-summary-specific with no shared code.

---

## Phase 2 — Backend Service Cleanup

### `packages/server/src/services/summaryService.js`
- Remove import of `isConversationSummaryEnabled`, `generateConversationSummary`, `doGenerateSessionAndConversationSummary` from `conversationSummary.js` (line 34)
- Remove import of `CONVERSATION_SUMMARY_SYSTEM_PROMPT`, `COMBINED_SUMMARY_SYSTEM_PROMPT` from `summaryPrompts.js` (lines 24-25)
- Remove the `generateSessionAndConversationSummary()` function (lines 479-487)
- Remove re-exports of `isConversationSummaryEnabled`, `generateConversationSummary` (lines 554-555)
- Remove re-exports of `CONVERSATION_SUMMARY_SYSTEM_PROMPT`, `COMBINED_SUMMARY_SYSTEM_PROMPT` (lines 536-537)

### `packages/server/src/services/summaryPrompts.js`
- Remove `CONVERSATION_SUMMARY_SYSTEM_PROMPT` constant (lines 40-46)
- Remove `COMBINED_SUMMARY_SYSTEM_PROMPT` constant (lines 48-68)
- Remove `buildConversationSummaryPrompt()` function (lines 139-145)
- Remove `parseConversationSummaryResponse()` function (lines 219-229)

### `packages/server/src/services/summaryBroadcast.js`
- Remove `broadcastConversationSummaryUpdate()` function (lines 47-52)
- Remove its import of `WS_MESSAGE_TYPES.CONVERSATION_SUMMARY_UPDATED` (used only by that function)

### `packages/server/src/services/summaryPrompts.test.js`
- Remove the `CONVERSATION_SUMMARY_SYSTEM_PROMPT` test (lines 45-48): `'CONVERSATION_SUMMARY_SYSTEM_PROMPT contains conversation instructions'`
- Remove the `COMBINED_SUMMARY_SYSTEM_PROMPT` test (lines 50-53): `'COMBINED_SUMMARY_SYSTEM_PROMPT contains both session and conversation instructions'`
- Remove the entire `describe('buildConversationSummaryPrompt')` block (lines 221-232)
- Remove the entire `describe('parseConversationSummaryResponse')` block (lines 539-563)

### `packages/server/src/services/summaryBroadcast.test.js`
- Remove the entire `describe('broadcastConversationSummaryUpdate')` block (lines 68-91)
- Remove import of `broadcastConversationSummaryUpdate` (line 9)

### `packages/server/src/services/summaryService.test.js`
- Remove or update every `describe`/`it` block that tests conversation summary generation. Key blocks to remove:
  - Any `it('skips conversation summary generation when disableConversationSummaries is true')` tests
  - Any `it('generates conversation summary when disableConversationSummaries is explicitly set to false')` tests
  - Any test blocks exercising `generateConversationSummary`, `isConversationSummaryEnabled`, `generateSessionAndConversationSummary`, or `doGenerateSessionAndConversationSummary`
  - All `settings.setSummarySettings({ disableConversationSummaries: ... })` calls — remove the `disableConversationSummaries` key, keeping other settings fields
- **Keep** all session summary tests, `generateSummary`, `onSessionActivity`, `onSessionComplete`, `regenerateSummary` tests

---

## Phase 3 — API Route Cleanup

### `packages/server/src/api/sessions-conversations.js`
- Remove the `summaryService` import (line 6) — no longer needed by this file
- Remove the auto-summary block in POST `/:id/conversations` (lines 27-34): the `if (previousActive && !previousActive.summary && summaryService.isConversationSummaryEnabled(...))` block
- Remove the auto-summary block in PATCH `/:id/conversations/:convId` (lines 73-83): the `if (isActive && !conversation.isActive)` block that calls `generateConversationSummary`
- Remove the entire POST `/:id/conversations/:convId/summary` route (lines 125-138)
- Remove the auto-summary block in POST `/:id/conversations/:convId/branch` (lines 172-179): the `if (previousActive && !previousActive.summary && summaryService.isConversationSummaryEnabled(...))` block

### `packages/server/src/api/settings.js`
- In PUT `/summary` handler (lines 94-122): remove `disableConversationSummaries` from the destructured body (line 96), remove its `typeof` validation check (line 100), remove it from the error message string (line 103), remove it from the `setSummarySettings` call (line 109)
- **Note:** The validation currently requires all three fields. After removing `disableConversationSummaries`, update the validation to only require `disableSessionSummaries` (boolean) and `sessionTitlePrompt` (string).

### `packages/server/src/api/sessions-conversations.test.js`
- Remove the entire `describe('POST /api/sessions/:id/conversations/:convId/summary')` block (lines 194-201)
- Remove the `summaryService` mock entries for `generateConversationSummary` and `isConversationSummaryEnabled` (lines 26-28)

### `packages/server/src/api/sessions.conversations.test.js`
- Remove mock entries for `generateConversationSummary`, `generateSessionAndConversationSummary`, `isConversationSummaryEnabled` (lines 13-22)
- Remove the entire `describe('POST /sessions/:id/conversations/:convId/summary')` block (lines 296-311)
- Remove the entire `describe('Conversation Branching with Summary Flag')` block (lines 313-393)
- Remove the entire `describe('Multi-conversation summary guard')` block (lines 397-531)

### `packages/server/test/sessions-conversations.test.js`
- Remove the entire `describe('Conversation summary generation')` block (lines 301-372) — tests `generateConversationSummary` with various settings
- Remove `settings` import if no longer needed after removal
- Remove `settings.resetSummarySettings()` from `afterEach` if no longer needed
- Remove `summaryService` import (line 39) if no longer needed

---

## Phase 4 — Settings & Database

### `packages/server/src/db/SettingsRepository.js`
- In `getSummarySettings()` (lines 114-137): remove `disableConversationSummaries` from the default return (line 119), the parsed return (line 127), and the catch fallback (line 133)
- In `setSummarySettings()` (lines 146-154): remove `disableConversationSummaries` from the validated object (line 149) and JSDoc (line 143)
- In `resetSummarySettings()` (lines 160-167): remove `disableConversationSummaries` from the return (line 164)

### `packages/server/src/db/SettingsRepository.test.js`
- Remove or update every test that asserts on `disableConversationSummaries`. Key changes:
  - In `getSummarySettings` tests: remove `disableConversationSummaries` from all expected default objects and assertions (lines 256, 264, 279-280, 289)
  - In `setSummarySettings` tests: remove `disableConversationSummaries` from all test input/assertion objects (lines 305, 311, 313, 322, 334, 345, 349-350, 356, 367, 372, 380, 393, 399, 404, 415, 424, 434, 442)
  - Remove the entire `it('validates and coerces disableConversationSummaries to boolean')` test (line 342)

### Database schema (`schema.sql`) — **NO CHANGES**
- Keep `summary` and `summary_generated_at` columns on the conversations table (avoid data loss)

### `packages/server/src/db/ConversationRepository.js` — **NO CHANGES**
- Keep field mappings for `summary` / `summaryGeneratedAt` (harmless, preserves existing data)

---

## Phase 5 — Frontend Cleanup

### `packages/web/src/views/SummarySettingsView.vue`
- Remove the "Disable conversation summaries" checkbox `<div class="form-group">` block (lines 21-32)
- Remove the `disableConversationSummaries` ref (line 72)
- Remove `disableConversationSummaries.value = settings.disableConversationSummaries` from the watcher (line 86)
- Remove `disableConversationSummaries: disableConversationSummaries.value` from `handleSave()` (line 99)

### `packages/web/src/stores/settings.js`
- Remove `disableConversationSummaries: true` from `summarySettings` initial state (line 10)
- Remove `disableConversationSummaries: true` from the fallback default in `fetchSummarySettings` catch (line 98)

### `packages/web/src/api/resources/ConversationsApi.js`
- Remove the `generateConversationSummary()` method (lines 58-66)

### `packages/web/src/api/resources/ConversationsApi.test.js`
- Remove the entire `describe('generateConversationSummary')` block (lines 107-118)

### `packages/web/src/api/resources/SettingsApi.js`
- Update JSDoc `@returns` annotations (lines 35, 44, 52) to remove `disableConversationSummaries` from the documented return type

### `packages/web/src/api/resources/SettingsApi.test.js`
- Remove `disableConversationSummaries` from the test data object (line 67)

### `packages/web/src/stores/sessions.test.js` and `packages/web/src/stores/sessions.bte.test.js`
- Remove `generateConversationSummary: vi.fn()` from the API mock object (line 30 in each)

---

## Phase 6 — Protocol & E2E

### `packages/shared/src/protocol.js`
- Remove `CONVERSATION_SUMMARY_UPDATED: 'conversation:summary_updated'` (line 35)

### `tests/e2e/helpers.ts`
- Remove the `generateConversationSummary()` helper function (lines 1551-1561)
- Remove `disableConversationSummaries` from the `SummarySettings` type definition (lines 2234-2253)

### `tests/e2e/conversation-management.spec.ts`
- Remove the `generateConversationSummary` import (line 17)
- Remove the `'summary endpoint returns response for conversation'` test (lines 714-725)
- Remove the `'switching conversations triggers background summary generation'` test (lines 727-749)
- Keep the `'new conversation has null summary'` test (lines 703-712) — this validates data shape, not the generation feature

### `tests/e2e/session-summaries.spec.ts`
- Remove or update all references to `disableConversationSummaries` (lines 533, 545, 554, 563, 581, 596)
- Update any test that sends `disableConversationSummaries` in a PUT body to omit it
- Update any assertion that checks `disableConversationSummaries` in a response

### `tests/e2e/settings.spec.ts`
- Remove `disableConversationSummaries` from all test payloads and assertions (lines 182, 215, 225, 277, 309, 320, 330, 335, 345, 351, 362, 376, 383, 389)
- Update validation/assertion logic throughout the summary settings tests

---

## Phase 7 — Verify

- Run `yarn test` — all unit tests pass
- Run `yarn lint` — no lint errors
- Run `yarn build` — builds cleanly

---

## What stays untouched
- All session summary generation, display, and settings
- `SummaryTab.vue`, `SummaryContent.vue`, `SessionCardSummary.vue`
- Session summary prompts (`SUMMARY_SYSTEM_PROMPT`) in `summaryPrompts.js`
- `broadcastSummaryUpdate()` and `broadcastGeneratingStatus()` in `summaryBroadcast.js`
- Database columns (`summary`, `summary_generated_at` on conversations table)
- `ConversationRepository` field mappings
