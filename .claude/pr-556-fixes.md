# PR #556 Fix Plan

## 1. Remove `conv.model` from frontend sessions store

**File:** `packages/web/src/stores/sessions.js`

- Remove `model: conv.model` from the conversation mapping in the store getter
- This field is no longer written to on the server side and will always be `null` for new conversations

---

## 2. Update frontend tests to use `currentSession.model` instead of `activeConversation.model`

**File:** `packages/web/src/components/ConversationTab.test.js`

Tests in the "Model initialization from active conversation" and "Model updates when conversation changes" describe blocks currently set `model` on the mock `activeConversation`. Since the watcher now reads from `sessionsStore.currentSession?.model`, these tests need to:

- Set `mockSessionsStore.currentSession.model` to the desired model value
- Remove or stop relying on `activeConversation.model` as the source of truth
- Verify the tests actually exercise the new code path (not just hitting the `'sonnet'` fallback)

Affected tests (~6):
- `initializes selectedModel from activeConversation.model on mount` (line 1385)
- `uses sonnet model when activeConversation has sonnet` (line 1402)
- `sends message with the model from activeConversation` (line 1415)
- `updates selectedModel when activeConversation.model changes` (line 1440)
- `updates selectedModel when switching to a different conversation` (line 1464)
- Any other tests referencing `activeConversation.model` for model selection

---

## 3. Update stale documentation comments

**File:** `packages/web/src/components/ConversationTab.model-init.test.js`

- Update the file-level doc comment (line 19) from:
  `conv.model || session.model || projectDefault || 'sonnet'`
  to: `session.model || projectDefault || 'sonnet'`

**File:** `tests/e2e/model-selector-default.spec.ts`

- Update the comment (line 10) from:
  `conversation.model -> session.model -> project default -> 'sonnet'`
  to: `session.model -> project default -> 'sonnet'`

---

## 4. Add missing `session` refresh in `runSession` after model update

**File:** `packages/server/src/services/sessionManager.js` (~line 940)

- After `sessions.update(sessionId, { model })`, add `session = sessions.getById(sessionId)` to match the pattern used in `continueSession` and `continueSessionWithExistingMessage`
- Optionally combine the two back-to-back `sessions.update()` calls into one:
  ```js
  sessions.update(sessionId, { status: 'running', ...(model && { model }) });
  session = sessions.getById(sessionId);
  ```

---

## 5. Add missing unit tests for model change detection

**File:** `packages/server/src/services/sessionManager.test.js` (or new test file)

Add tests for:

1. **`continueSession` with model change** - Call `continueSession` where `session.model` is `'opus'` and the new `model` param is `'sonnet'`. Verify `modelChanged` triggers (conversation context is included instead of resume).

2. **`continueSessionWithExistingMessage` with model change** - Same scenario for the branching code path.

3. **`continueSession` with `model: null`** - Verify that when `model` is null, `modelChanged` is `false` and `session.model` is not overwritten. This guards the `model && session.model && model !== session.model` expression.

---

## 6. (Optional) Clean up dead `conversations.model` schema

**File:** `packages/server/src/db/DatabaseManager.js` (line 262-264)

- The migration that adds `conversations.model` is now dead code
- **Conservative approach:** Leave it and add a comment: `// Legacy: no longer written to, kept for backward compatibility`
- **Clean break approach:** Remove the migration block and update `DatabaseManager.test.js` tests that write to / assert on `conversations.model`

Recommend the conservative approach unless a clean break is preferred.
