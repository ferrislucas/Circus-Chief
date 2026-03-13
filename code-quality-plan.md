# Code Quality Audit & Refactoring Plan

## Overview

Audit of all source files (excluding tests) identified **8 files over 200 lines** that are candidates for breaking up. These files account for disproportionate complexity and contain significant code duplication.

| # | File | Lines | Severity |
|---|------|------:|----------|
| 1 | `packages/web/src/stores/sessions.js` | 2,018 | 🔴 Critical |
| 2 | `packages/server/src/services/sessionManager.js` | 1,961 | 🔴 Critical |
| 3 | `packages/server/src/api/sessions.js` | 1,642 | 🔴 Critical |
| 4 | `packages/server/src/services/summaryService.js` | 1,605 | 🔴 Critical |
| 5 | `packages/web/src/components/ConversationTab.vue` | 1,599 | 🔴 Critical |
| 6 | `packages/web/src/api/ApiClient.js` | 1,348 | 🟡 High |
| 7 | `packages/web/src/views/SessionListView.vue` | 1,137 | 🟡 High |
| 8 | `packages/web/src/views/SessionDetailView.vue` | 1,126 | 🟡 High |

---

## Phase 1: `sessionManager.js` (1,961 → ~200 lines)

**The worst offender for duplication.** Three near-identical session execution functions (`runSession`, `continueSession`, `continueSessionWithExistingMessage`) share ~600 lines of duplicated logic.

### Extract these modules:

| New Module | Responsibility | ~Lines |
|------------|---------------|--------|
| `services/sessionPrompts.js` | All system prompt building (`buildCanvasWriteSystemPrompt`, `buildCanvasReadSystemPrompt`, `buildSessionApiInstructions`, `buildWorktreeContext`, `buildSystemPromptConfig`) | 200 |
| `services/sessionProvider.js` | Provider resolution & environment setup (`resolveProviderFromModel`, `buildProviderEnv`, `buildSessionEnv`, `getApiBaseUrl`) | 100 |
| `services/sessionErrors.js` | Error detection & rescheduling (`matchesTokenLimitError`, `matchesServiceError`, `shouldRescheduleOnError`, `_checkProactiveReschedule`) | 150 |
| `services/sessionContext.js` | Conversation context builders (`formatConversationHistory`, `buildConversationContextForModelSwitch`, `buildConversationContextForBranch`) | 60 |
| `services/streamEventHandler.js` | Stream event processing (currently handles system init, assistant messages, tool usage, token tracking, thinking blocks) | 400 |
| `services/usageTracker.js` | Token estimation & usage accumulation (`estimateTokens`, `updateTurnUsage`) | 60 |

### Deduplicate session execution:

Create a private `_executeSession(options)` function that encapsulates the shared pattern:
1. Setup AbortController → track in activeSessions
2. Ensure/get active conversation
3. Create agent via gateway
4. Resolve provider and build environment
5. Detect model changes
6. Build query params with SDK options
7. Loop through agent.execute events
8. Associate work logs at completion
9. Check proactive reschedule
10. Trigger template if needed
11. Error handling with rescheduling logic

Then `runSession`, `continueSession`, and `continueSessionWithExistingMessage` become thin wrappers (~20 lines each) that prepare their specific inputs and call `_executeSession`.

---

## Phase 2: `sessions.js` store (2,018 → ~400 lines)

**The largest file in the codebase.** A single Pinia store handling 10+ distinct responsibilities.

### Extract these stores/composables:

| New Module | Responsibility | ~Lines |
|------------|---------------|--------|
| `stores/sessionConversations.js` | Conversation management (`fetchConversations`, `createConversation`, `switchConversation`, `branchConversation`, `deleteConversation`, etc.) | 300 |
| `stores/sessionUsage.js` | Token tracking & display (`runningUsage`, `finalizeUsage`, `updateConversationUsage`, all token getters like `formattedTokens`, `billableTokens`, `contextPercentage`) | 250 |
| `stores/sessionStreaming.js` | Streaming state (`partialText`, `partialThinkingBySession`, throttle logic, `setPartialText`, `clearPartialText`) | 80 |
| `stores/sessionFilters.js` | Filter persistence (`statusFilter`, `starredFilter`, `scheduledFilter` with their save/restore/toggle methods) | 150 |

### Deduplicate patterns:

- **Multi-list update pattern** (appears 8+ times): Extract `updateSessionInAllLists(sessionId, updates)` helper that updates `sessions`, `archivedSessions`, `activeSessions`, and `currentSession` in one call
- **Filter persistence pattern** (12 methods for 4 filters): Create generic `createFilterPersistence(key, storageType)` factory

---

## Phase 3: `sessions.js` API routes (1,642 → ~500 lines)

**43 route handlers with heavy inline business logic and repeated validation patterns.**

### Extract middleware:

| Middleware | Replaces | Occurrences |
|------------|----------|-------------|
| `validateSession` | `sessions.getById()` + 404 check | 40+ |
| `validateProject` | `projects.getById()` + 404 check | 20+ |
| `validateSessionStatus(allowed)` | Status validation checks | 3+ |

### Extract route groups into separate files:

| New Route File | Routes | ~Lines |
|----------------|--------|--------|
| `api/sessions-conversations.js` | 8 conversation routes (list, create, get, update, delete, summary, branch, messages) | 230 |
| `api/sessions-commands.js` | 4 command button routes (run, list runs, get run, kill) | 200 |
| `api/sessions-notes.js` | 4 notes CRUD routes | 50 |

### Move business logic to services:

- **POST /:id/start** (115 lines of inline logic) → `DraftSessionService.startDraft()`
- **PATCH /:id** (150 lines of field validation) → Use Zod schema validation from `@claudetools/shared`
- **POST /:id/schedule** (99 lines) → `ScheduleService.configureSchedule()`

---

## Phase 4: `summaryService.js` (1,605 → ~300 lines)

**Two nearly-identical Claude query functions and duplicated concurrency guards.**

### Extract these modules:

| New Module | Responsibility | ~Lines |
|------------|---------------|--------|
| `services/summaryClaudeClient.js` | Unified Claude query function (merge `callClaude` and `callClaudeWithCustomSchema` into one with optional schema param) | 150 |
| `services/summaryPrompts.js` | All prompt templates + `buildIncrementalPrompt` + `formatMessages` | 60 |
| `services/prUrlService.js` | PR URL extraction, parsing, validation, enrichment (consolidate 2 duplicated PR validation blocks) | 100 |
| `services/conversationSummary.js` | Conversation-specific summary generation | 150 |
| `services/sessionContext.js` | Child session context building, hierarchy traversal, `aggregateFilesModified` | 120 |

### Deduplicate patterns:

- **Concurrency guard** (appears 2x): Extract `withConcurrencyGuard(key, fn)` utility
- **Broadcasting** (appears 12x): Create `broadcastSummaryUpdate(sessionId, data)` helper
- **PR enrichment** (appears 2x): Consolidate into single `enrichPrUrl()` function

---

## Phase 5: `ConversationTab.vue` (1,599 → ~400 lines)

**A massive Vue component handling messages, input, streaming, and session control.**

### Extract components:

| New Component | Template Lines Saved | Purpose |
|---------------|---------------------|---------|
| `MessageItem.vue` | 60 | Individual message with header, content, attachments, tools, work logs |
| `InputForm.vue` | 83 | Textarea + controls + send button + mode/model selectors |
| `RunningState.vue` | 36 | "Claude is working..." UI with work logs and template indicator |
| `StreamingMessage.vue` | 13 | Animated dots + partial markdown content |

### Extract composables:

| Composable | Script Lines Saved | Purpose |
|------------|-------------------|---------|
| `useMessageScroll.js` | ~40 | `handleScroll`, `scrollToBottom`, `scrollToClaudesTurn`, near-bottom detection |
| `useMessageFormatting.js` | ~30 | `formatTime`, `formatModelName`, `formatFileSize`, `getAttachmentIcon` |
| `useDraftSaving.js` | ~40 | `handleInput` with debounced server save, `savePendingPrompt` |
| `useSessionControl.js` | ~50 | `handleStop`, `handleStart`, `handleRestart`, `handleThinkingToggle` |

---

## Phase 6: `ApiClient.js` (1,348 → ~60 lines core)

**107 methods in a single class.** Clean, but too large to navigate.

### Split into resource modules using mixin pattern:

| New Module | Methods | ~Lines |
|------------|---------|--------|
| `api/resources/SessionsApi.js` | 23 session methods | 200 |
| `api/resources/CanvasApi.js` | 13 canvas methods | 100 |
| `api/resources/ProvidersApi.js` | 11 provider methods | 100 |
| `api/resources/CommandButtonsApi.js` | 10 command button methods | 90 |
| `api/resources/SettingsApi.js` | 9 settings methods | 80 |
| `api/resources/ConversationsApi.js` | 8 conversation methods | 70 |
| `api/resources/TemplatesApi.js` | 7 template methods | 50 |
| `api/resources/QuickResponsesApi.js` | 7 quick response methods | 60 |
| `api/resources/ProjectsApi.js` | 5 project methods | 40 |
| `api/resources/MiscApi.js` | 14 remaining methods (git, todos, summaries, notes, filesystem, slash commands, agent logs) | 120 |

### Deduplicate:

- **FormData upload** (3 occurrences): Extract `#uploadFormData(path, formData)` private method
- **Query param building** (3 occurrences): Extract `#buildQueryPath(basePath, params)` private method

---

## Phase 7: `SessionListView.vue` (1,137 → ~350 lines)

### Extract components:

| New Component | Lines Saved |
|---------------|------------|
| `SessionFiltersPanel.vue` | 44 template + 60 script |
| `ArchivedTabContent.vue` | 42 template |
| `ScheduledTabContent.vue` | 18 template |

### Extract composables:

| Composable | Lines Saved |
|------------|------------|
| `useSessionSummaries.js` | ~100 (summary state + batch/individual loading + error handling) |
| `useSessionFiltering.js` | ~60 (filter toggle cycling + tooltip computation) |

### Refactor `projectId` watcher:

The 170-line `projectId` watch handler should be broken into a `useProjectSubscription` composable that encapsulates WebSocket event handler registration and cleanup.

---

## Phase 8: `SessionDetailView.vue` (1,126 → ~450 lines)

### Extract components:

| New Component | Lines Saved |
|---------------|------------|
| `SessionHeaderPanel.vue` | 85 template + 80 script (includes star, PR URL editing, overflow menu) |
| `SessionTabsPanel.vue` | 48 template (desktop/mobile tab navigation with indicators) |
| `PrUrlEditor.vue` | 42 template + 60 script |

### Extract composables:

| Composable | Lines Saved |
|------------|------------|
| `useSessionPolling.js` | ~90 (checkForChanges, startPolling, stopPolling, interval management) |
| `useSessionInitializer.js` | ~170 (40+ WebSocket handler registrations, subscription setup, cleanup) |

---

## Execution Order & Rationale

| Priority | Phase | Impact | Risk |
|----------|-------|--------|------|
| 1st | Phase 1: sessionManager.js | Eliminates ~600 lines of duplication | Medium (core execution path) |
| 2nd | Phase 2: sessions.js store | Reduces largest file, improves frontend maintainability | Medium (widely imported) |
| 3rd | Phase 4: summaryService.js | Eliminates duplicated Claude client code | Low (isolated service) |
| 4th | Phase 3: sessions API routes | Adds missing validation middleware, cleaner routes | Low (additive changes) |
| 5th | Phase 5: ConversationTab.vue | Improves component reusability | Low (UI extraction) |
| 6th | Phase 6: ApiClient.js | Better navigation, no behavior change | Low (pure restructuring) |
| 7th | Phase 7: SessionListView.vue | Cleaner view composition | Low (UI extraction) |
| 8th | Phase 8: SessionDetailView.vue | Cleaner view composition | Low (UI extraction) |

Each phase should be followed by running `yarn test` and `yarn lint` to ensure no regressions.

---

## Success Criteria

- No file over 400 lines (excluding ApiClient resource modules which are simple CRUD)
- Zero duplicated logic patterns (session execution, filter persistence, multi-list updates)
- All existing tests continue to pass
- Each extracted module has clear, single responsibility
