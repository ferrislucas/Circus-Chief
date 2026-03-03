# Refactoring Plan: Break Large Files into ~200-Line Modules

## Target

**Hard ceiling: ~200 lines per file.** Every module, component, and composable should have a single, focused responsibility.

---

## Priority 1: Server Services

### 1.1 `sessionManager.js` (1,953 lines) → 12 modules

The largest file in the codebase. Currently mixes session lifecycle, stream handling, system prompts, token tracking, environment config, error handling, and mocks.

#### State & Infrastructure

| New Module | Functions / State | ~Lines | Responsibility |
|---|---|---|---|
| `sessionState.js` | 7 Maps (`activeSessions`, `thinkingAccumulators`, `textAccumulators`, `currentTurnUsage`, `activeConversationIds`, `currentModels`, `estimatedOutputTokens`) + `lastMessageIds`, getters/setters, `cleanupActiveSession()` | 70 | Encapsulated session state. Single import for all Map access. |
| `tokenUsageTracker.js` | `estimateTokens()`, `updateTurnUsage()`, usage broadcast helper | 80 | Token estimation, per-turn accumulation, WebSocket usage broadcasts |
| `sessionMocks.js` | `mockQuery()` async generator (104 lines of mock event yields) | 110 | E2E/test mock only. Zero production impact. |

#### Environment & Prompts (split the old 350-line prompt builder into 3 files)

| New Module | Functions | ~Lines | Responsibility |
|---|---|---|---|
| `providerConfig.js` | `resolveProviderFromModel()`, `buildProviderEnv()`, `buildSessionEnv()`, `getPermissionModeForSession()`, `isMockMode()`, `getApiBaseUrl()` | 100 | Provider lookup, env var assembly, thinking budget config, permission mapping |
| `systemPromptBuilder.js` | `buildSystemPromptConfig()`, `buildCanvasWriteSystemPrompt()`, `buildCanvasReadSystemPrompt()`, `buildWorktreeContext()`, `PLAN_MODE_PROMPT` constant | 80 | Orchestrates prompt assembly. Each sub-function is small; this file composes them. |
| `sessionApiDocs.js` | `buildSessionApiInstructions()` (113 lines of API documentation template) | 120 | The session/project/canvas API docs injected into system prompts. Pure string template. |
| `conversationContext.js` | `formatConversationHistory()`, `buildConversationContextForModelSwitch()`, `buildConversationContextForBranch()`, `buildPromptWithAttachments()`, `getSessionAttachmentsContext()`, `formatFileSize()` | 110 | Conversation history formatting for model switches, branches, and file attachments |

#### Stream Event Handling (split the 389-line switch into per-event handlers)

| New Module | Functions | ~Lines | Responsibility |
|---|---|---|---|
| `handleSystemEvent.js` | Handle `system` event type: extract session ID, model, slash commands; update conversation Maps | 50 | System/init event processing |
| `handleAssistantEvent.js` | Handle `assistant` event type: create messages, associate work logs, detect TodoWrite tool use, log tool usage | 90 | Assistant message creation + tool tracking |
| `handleStreamDeltaEvent.js` | Handle `stream_event` type (5 sub-cases): `message_start`, `message_delta`, `content_block_delta` (text + thinking), `content_block_stop` | 130 | Real-time streaming: text accumulation, thinking accumulation, token estimation |
| `handleResultEvent.js` | Handle `result` type: error/success branching, cost extraction, usage aggregation, conversation/session cumulative updates, final broadcast, map cleanup | 150 | Turn completion: usage rollup, persistence, cleanup |
| `streamEventRouter.js` | `handleStreamEvent()` dispatch function + `createWorkLog()`, `associateAndBroadcastWorkLogs()` | 60 | Thin router that delegates to per-event handlers + work log helpers |

#### Error Handling & Rescheduling

| New Module | Functions | ~Lines | Responsibility |
|---|---|---|---|
| `errorRescheduler.js` | `matchesTokenLimitError()`, `matchesServiceError()`, `shouldRescheduleOnError()`, `_checkProactiveReschedule()` | 120 | Error pattern matching (token limit, overloaded, rate limit), rescheduling decisions |

#### Session Lifecycle (split 3 execution functions + shared helper)

| New Module | Functions | ~Lines | Responsibility |
|---|---|---|---|
| `sessionExecutor.js` | Private `_executeSessionQuery()` (shared loop: query iteration, stream handling, post-completion, error handling, finally cleanup — ~70 lines extracted from duplication) | 90 | Shared execution core used by all 3 session entry points |
| `sessionManager.js` (slimmed) | `runSession()`, `continueSession()`, `continueSessionWithExistingMessage()`, `stopSession()`, `restartSession()`, `broadcastSessionStatus()`, `broadcastChangesUpdate()` | 200 | Public lifecycle API. Each function does setup/teardown and delegates to `sessionExecutor`. |

**Total: 12 files, largest is 200 lines.**

---

### 1.2 `summaryService.js` (989 lines) → 7 modules

#### PR URL Handling

| New Module | Functions | ~Lines | Responsibility |
|---|---|---|---|
| `prUrlExtractor.js` | `extractPrUrlFromMessages()`, `extractPrUrlIfNeeded()` | 60 | Regex-scan messages for GitHub PR URLs, broadcast when found |
| `prUrlValidator.js` | `parsePrUrl()`, `validatePrUrl()` | 80 | URL parsing into owner/repo/number, cross-validation against project repo |

#### Claude Integration

| New Module | Functions | ~Lines | Responsibility |
|---|---|---|---|
| `summaryClaudeAdapter.js` | `callClaude()`, `mockSummaryQuery()`, `parseSummaryResponse()`, `parseConversationSummaryResponse()` | 170 | SDK query wrapper, mock mode, structured output parsing, markdown stripping |

#### Prompt Building

| New Module | Functions | ~Lines | Responsibility |
|---|---|---|---|
| `summaryPromptBuilder.js` | `formatMessages()`, `buildIncrementalPrompt()`, `buildConversationSummaryPrompt()`, `DEFAULT_SESSION_TITLE_PROMPT` | 100 | Message formatting, prompt construction for both session and conversation summaries |

#### Context & Hierarchy

| New Module | Functions | ~Lines | Responsibility |
|---|---|---|---|
| `sessionHierarchy.js` | `getChildSessions()`, `buildChildSessionContext()`, `aggregateFilesModified()`, `propagateToParent()` | 60 | Workflow-aware child context, recursive file aggregation, parent propagation |

#### Conversation Summaries (standalone feature)

| New Module | Functions | ~Lines | Responsibility |
|---|---|---|---|
| `conversationSummaryService.js` | `isConversationSummaryEnabled()`, `generateConversationSummary()` | 100 | Conversation-level summary generation. Self-contained — uses `callClaude`, `buildConversationSummaryPrompt`, `parseConversationSummaryResponse` |

#### Core Orchestrator

| New Module | Functions | ~Lines | Responsibility |
|---|---|---|---|
| `summaryService.js` (slimmed) | `generateSummary()` (refactored into phases: validate → build prompt → call Claude → enrich with PR/GitHub → persist → broadcast), `onSessionActivity()`, `onSessionComplete()`, `generateSummaryNow()`, `getSummary()`, `regenerateSummary()`, `isSummaryStale()`, `cleanupSession()`, debounce timer management | 200 | Lifecycle orchestration only. All heavy lifting delegated to imported modules. |

**Total: 7 files, largest is 200 lines.**

---

### 1.3 `slashCommandService.js` (618 lines) → 4 modules

| New Module | Functions | ~Lines | Responsibility |
|---|---|---|---|
| `commandParser.js` | `parseCommandFile()`, `parseSkillFile()`, `normalizeArgument()` | 120 | YAML frontmatter parsing, argument validation/normalization |
| `commandDiscovery.js` | `discoverCommandsFromDir()`, `discoverSkillsFromDir()`, `discoverPluginCommands()`, `discoverPluginSkills()`, `isMatchingProject()` | 200 | Filesystem scanning, plugin filtering, worktree-aware project matching |
| `commandBuilder.js` | `buildCommandString()` | 90 | Argument substitution (`$ARGUMENTS`, `$name`, `$0`), command string assembly |
| `slashCommandService.js` (slimmed) | `getCommands()`, `getCommand()`, `getCommandBody()` | 100 | Public API: resolution, dedup, body retrieval |

**Total: 4 files, largest is 200 lines.**

---

### 1.4 `commandRunner.js` (568 lines) → 4 modules

| New Module | Functions | ~Lines | Responsibility |
|---|---|---|---|
| `terminalOutputProcessor.js` | `stripAnsiCodes()`, `TerminalOutputProcessor` class (cursor control state machine) | 155 | ANSI stripping, terminal simulation. Zero external deps — pure utility. |
| `processRegistry.js` | Active processes Map, `getActiveRuns()`, `isRunning()`, `getRunningByProjectId()`, `getRunsBySession()`, orphan detection | 150 | Process tracking, in-memory + DB merge, orphan cleanup |
| `outputBuffer.js` | `OutputBuffer` class: `initialize(runId)`, `append(text)`, `flush()`, `cleanup()`, circular buffer, periodic flush timer (500ms) | 80 | Buffer management + periodic DB persistence. Extracted from `run()` internals. |
| `commandRunner.js` (slimmed) | `run()` (now delegates to outputBuffer + processRegistry), `kill()` (two-phase SIGTERM→SIGKILL) | 180 | Process spawning, TTY wrapping, graceful shutdown. |

**Total: 4 files, largest is 180 lines.**

---

### 1.5 `gitService.js` (452 lines) → 4 modules

| New Module | Functions | ~Lines | Responsibility |
|---|---|---|---|
| `gitExecutor.js` | `git()` wrapper, `safeFetchOrigin()`, `setLogger()`, logger interface | 50 | Low-level child_process exec wrapper |
| `gitBranchService.js` | `getOriginDefaultBranch()` (with cache + TTL + LRU), `clearDefaultBranchCache()`, `getCacheSize()`, `getBranches()`, `branchExists()`, `checkoutBranch()`, `getCurrentBranch()`, `isGitRepo()` | 170 | Branch queries, default branch detection with multi-strategy fallback |
| `gitWorktreeService.js` | `getWorktrees()`, `createWorktree()`, `removeWorktree()`, `createWorktreeForBranch()` | 120 | Worktree CRUD, branch-aware creation |
| `gitDiffService.js` | `getDiff()`, `getStagedDiff()`, `getDiffAgainstBranch()`, `getStagedDiffAgainstBranch()`, `getDiffBetweenRefs()`, `getUntrackedFiles()`, `getModifiedFilesCount()` | 140 | All diff generation, change detection, file counting |

**Total: 4 files, largest is 170 lines.**

---

## Priority 2: Vue Components

### 2.1 `ConversationTab.vue` (1,757 lines) → 5 composables + 6 components

#### Composables (`packages/web/src/composables/`)

| Composable | Extracted Logic | ~Lines |
|---|---|---|
| `useConversationScroll.js` | `scrollToBottom()`, `scrollToClaudesTurn()`, `handleScroll()`, `isNearBottom` ref, `hasNewMessages` ref, `SCROLL_THRESHOLD` constant, watcher on `messages.length` for auto-scroll | 70 |
| `useSessionInput.js` | `input` ref, `attachedFiles` ref, `selectedModel` ref, `inputHasContent` computed, `isSendDisabled` computed, `sendButtonDisabledReason` computed, `savePendingPrompt()` debounce, `handleSend()`, `handleStart()` | 120 |
| `useStreamingState.js` | `partialText` ref, `pendingPartialText` ref, `partialThrottleTimer`, `PARTIAL_THROTTLE_MS`, throttled update logic from `onMounted`, cleanup | 60 |
| `useConversationSubscriptions.js` | 8 WebSocket event subscriptions (`onPartial`, `onMessage`, `onWorkLog`, `onWorkLogsAssociated`, `onThinkingPartial`, `onConversationCreated/Updated/Deleted`), 8 unsubscribe refs, cleanup in `onUnmounted` | 120 |
| `useConversationWatchers.js` | Watchers for `currentSession.status`, `sessionsStore.messages`, `activeConversationId`, `route.query.conv`, `activeConversation`, `getProjectDefaultModel` helper | 130 |

#### Child Components

| Component | Extracted From | ~Lines |
|---|---|---|
| `ConversationMessages.vue` | Messages container (template lines 6-98): message loop, draft/scheduled rendering, streaming indicator, "jump to latest" button + `formatTime()`, `formatModelName()`, `formatFileSize()`, `getAttachmentIcon()` | 180 |
| `SessionInputForm.vue` | Input section (template lines 119-201): textarea, quick response triggers, send/save buttons, controls row (mode, model, file, slash, thinking toggle), orchestration panel | 180 |
| `BranchingPanel.vue` | Branch editor UI + `openBranchEditor()`, `closeBranchEditor()`, `handleBranchCreate()` (40-line complex function with navigation + state reset) | 80 |
| `RunningStatePanel.vue` | Running state block (template lines 203-235): header with stop button, `LiveWorkLogPanel`, next template indicator + `handleStop()`, `handleRestart()` | 80 |
| `ErrorBanner.vue` | Error display (template lines 237-255) + `copyError()` clipboard function | 40 |
| `ConversationModals.vue` | Modal section (template lines 257-286): quick responses, schedule, reschedule, slash commands modals + `closeScheduleModal()`, `handleScheduled()`, `handleThinkingToggle()`, `handleTemplateChange()`, `handleSlashCommandExecuted()` | 80 |

#### Result

| File | ~Lines | Role |
|---|---|---|
| `ConversationTab.vue` (slimmed) | 180 | Layout orchestrator: imports composables + child components, passes props/events, minimal template |

---

### 2.2 `SessionListView.vue` (1,083 lines) → 3 composables + 2 components

#### Composables

| Composable | Extracted Logic | ~Lines |
|---|---|---|
| `useSessionSummaries.js` | `summaries`, `loadingSummaries`, `summaryErrors` reactive objects, `fetchSummaries()` parallel loop, `fetchSummary()` with error handling, `retryFetchSummary()`, `fetchArchivedSummaries()`, watcher on sessions changes | 100 |
| `useProjectSubscriptions.js` | Subscription creation, 7 event handlers (`onSessionCreated`, `onSessionUpdated`, `onSessionDeleted`, `onSessionSummaryUpdated`, `onCommandRunOutput`, `onCommandRunComplete`, `onCommandRunError`), cleanup array, `currentUnsubscribe` ref | 170 |
| `useSessionFilters.js` | `toggleFilter()`, `toggleStarFilterIcon()`, `toggleScheduledFilterIcon()`, `starFilterTooltip` computed, `scheduledFilterTooltip` computed, `filteredGroupedSessions` computed (51-line 3-level filter chain) | 130 |

#### Child Components

| Component | Extracted From | ~Lines |
|---|---|---|
| `SessionFiltersBar.vue` | Filter section (template lines 77-146): status/starred/scheduled filter buttons with icons and tooltips | 100 |
| `ArchivedSessionsPanel.vue` | Archived tab content (template lines 189-231): paginated archived list, load-more button, `loadArchivedSessions()`, `loadMoreArchived()`, `handleArchive()`, `handleUnarchive()` | 100 |

#### Result

| File | ~Lines | Role |
|---|---|---|
| `SessionListView.vue` (slimmed) | 200 | Page layout, tab routing, active session list rendering |

---

### 2.3 `SessionDetailView.vue` (1,023 lines) → 3 composables + 2 components

#### Composables

| Composable | Extracted Logic | ~Lines |
|---|---|---|
| `useSessionDetailSubscriptions.js` | `initializeSession()` 6-step setup, 14 event handler registrations (status, message, error, canvas add/remove, todos, session update, summary update, conversation updated, usage update, changes update, command output/complete/error), `cleanup()` function | 200 |
| `useSessionPolling.js` | `checkForChanges()` (fetch git status + parse diff), `startPolling()` (1000ms interval), `stopPolling()`, watcher on `currentSession.status` to start/stop polling | 60 |
| `usePrUrlEditing.js` | `isEditingPrUrl` ref, `editPrUrlValue` ref, `startEditPrUrl()`, `cancelEditPrUrl()`, `savePrUrl()` (with API call + broadcast), `clearPrUrl()` | 60 |

#### Child Components

| Component | Extracted From | ~Lines |
|---|---|---|
| `SessionHeader.vue` | Header block (template lines 25-109): star button, session name, PR URL display/edit form, branch indicator, command button status badges, action menu (duplicate/archive/delete/copy ID) | 150 |
| `SessionTabNavigation.vue` | Tab block (template lines 111-150): back button, desktop tab buttons with change indicators, mobile dropdown | 60 |

#### Result

| File | ~Lines | Role |
|---|---|---|
| `SessionDetailView.vue` (slimmed) | 200 | Page layout, tab content rendering, session action handlers (`handleDuplicate`, `handleDelete`, `handleArchive`, `handleStar`, `handleCopySessionId`) |

---

### 2.4 `SessionCard.vue` (911 lines) → 1 composable + 3 components

#### Composable

| Composable | Extracted Logic | ~Lines |
|---|---|---|
| `useWorkflowStatus.js` | `workflowStatus` computed (running/scheduled/error/total counts), `allDescendants` computed, `getSessionDepth()`, `buttonStatusesToDisplay` computed (29 lines of filtering) | 80 |

#### Child Components

| Component | Extracted From | ~Lines |
|---|---|---|
| `SessionCardHeader.vue` | Header row (template lines 9-121): star button, session name/badges, status indicators (running/scheduled/error), PR link, command button status, date, archive buttons | 170 |
| `SessionSummarySection.vue` | Summary section (template lines 124-142): loading spinner, error with retry, rendered summary text | 60 |
| `WorkflowExpansionPanel.vue` | Expansion panel (template lines 145-185): expand toggle button, root session card, recursive children list, `WorkflowSessionItem` integration | 80 |

#### Result

| File | ~Lines | Role |
|---|---|---|
| `SessionCard.vue` (slimmed) | 180 | Card shell: props/emits, router link, delegates to header/summary/workflow children |

---

### 2.5 `NewSessionView.vue` (884 lines) → 2 composables + 3 components

#### Composables

| Composable | Extracted Logic | ~Lines |
|---|---|---|
| `useNewSessionForm.js` | All form refs, `loadDefaults()` from localStorage, `saveDefaults()`, debounced branch name generation, `handleSubmit()` orchestration | 150 |
| `useGitBranches.js` | Branch list fetching, worktree list fetching, branch validation, `branchExists` computed | 60 |

#### Child Components

| Component | Extracted From | ~Lines |
|---|---|---|
| `GitOptionsSection.vue` | Git mode radio group (worktree/existing branch/current), branch name input, worktree path display | 120 |
| `SessionTemplateChain.vue` | Next template selector dropdown, parent session selector, chaining preview | 100 |
| `PromptInputSection.vue` | Prompt textarea, model selector, thinking toggle, permission mode, provider selector | 120 |

#### Result

| File | ~Lines | Role |
|---|---|---|
| `NewSessionView.vue` (slimmed) | 150 | Page layout, form submission, navigation |

---

### 2.6 `SummaryTab.vue` (822 lines) → 4 components

| Component | Extracted From | ~Lines |
|---|---|---|
| `SessionOverviewCard.vue` | Stats display: conversation count, message count, total cost, duration | 80 |
| `SummaryContent.vue` | Overview text, key actions list, files modified list, outcome section | 120 |
| `PullRequestCard.vue` | PR info display, merge conflict warnings, CI status badges, PR link | 100 |
| `ConversationSummaryCard.vue` | Individual conversation summary: title, summary text, message count, cost | 80 |

#### Result

| File | ~Lines | Role |
|---|---|---|
| `SummaryTab.vue` (slimmed) | 150 | Layout, data fetching, regenerate action, passes data to child cards |

---

### 2.7 `CommandGrid.vue` (418 lines) → 1 composable + 2 components

| Extract | Type | ~Lines |
|---|---|---|
| `useCommandFiltering.js` | Composable | 80 | Search filtering across 7 command source types |
| `CommandSection.vue` | Component | 60 | Reusable section with title, description, command list slot |
| `CommandCard.vue` | Component | 80 | Individual command/skill card: name, description, arguments preview, click handler |

#### Result

| File | ~Lines | Role |
|---|---|---|
| `CommandGrid.vue` (slimmed) | 120 | Grid layout, sections for each command source |

---

## Implementation Strategy

### Phase 1: Server — `sessionManager.js` (12 extractions)

Do these in dependency order so tests pass after each step:

1. **`sessionState.js`** — Extract 7 Maps + getters. Update all imports. Run tests.
2. **`sessionMocks.js`** — Move `mockQuery()`. Zero risk. Run tests.
3. **`providerConfig.js`** — Extract env/provider functions. Run tests.
4. **`sessionApiDocs.js`** — Extract 113-line string template. Run tests.
5. **`systemPromptBuilder.js`** — Extract prompt composition. Run tests.
6. **`conversationContext.js`** — Extract formatting/attachment functions. Run tests.
7. **`tokenUsageTracker.js`** — Extract token estimation + usage tracking. Run tests.
8. **`errorRescheduler.js`** — Extract error matching + rescheduling. Run tests.
9. **Stream event handlers** (5 files) — Extract one at a time: `handleSystemEvent` → `handleAssistantEvent` → `handleStreamDeltaEvent` → `handleResultEvent` → `streamEventRouter`. Run tests after each.
10. **`sessionExecutor.js`** — Extract shared execution loop from `runSession`/`continueSession`/`continueSessionWithExistingMessage`. Run tests.
11. **Verify** `sessionManager.js` is now ~200 lines. Run full test suite.

### Phase 2: Server — remaining services

12. `summaryService.js` → 7 modules (same approach: extract leaf dependencies first)
13. `slashCommandService.js` → 4 modules
14. `commandRunner.js` → 4 modules
15. `gitService.js` → 4 modules

### Phase 3: Vue composables

16. Create `packages/web/src/composables/` directory
17. Extract composables for `ConversationTab` first (highest line count)
18. Then `SessionListView`, `SessionDetailView`, `SessionCard`, `NewSessionView`

### Phase 4: Vue child components

19. Extract leaf components first (no children of their own): `ErrorBanner`, `CommandCard`, `ConversationSummaryCard`
20. Extract medium components: `SessionInputForm`, `ConversationMessages`, `SessionHeader`
21. Slim parent components to orchestrators

### Testing approach for each extraction

1. Ensure existing tests pass before starting
2. Extract module + update imports in one commit
3. Move relevant test cases alongside extracted modules
4. Run full test suite after each extraction
5. Add focused unit tests for extracted modules where coverage is thin

---

## Summary

| Area | Current Files | Current Max Lines | Post-Refactor Files | Post-Refactor Max Lines |
|---|---|---|---|---|
| **sessionManager.js** | 1 | 1,953 | 12 | 200 |
| **summaryService.js** | 1 | 989 | 7 | 200 |
| **slashCommandService.js** | 1 | 618 | 4 | 200 |
| **commandRunner.js** | 1 | 568 | 4 | 180 |
| **gitService.js** | 1 | 452 | 4 | 170 |
| **ConversationTab.vue** | 1 | 1,757 | 12 (5 composables + 6 components + 1 slimmed) | 180 |
| **SessionListView.vue** | 1 | 1,083 | 6 (3 composables + 2 components + 1 slimmed) | 200 |
| **SessionDetailView.vue** | 1 | 1,023 | 6 (3 composables + 2 components + 1 slimmed) | 200 |
| **SessionCard.vue** | 1 | 911 | 5 (1 composable + 3 components + 1 slimmed) | 180 |
| **NewSessionView.vue** | 1 | 884 | 6 (2 composables + 3 components + 1 slimmed) | 150 |
| **SummaryTab.vue** | 1 | 822 | 5 (4 components + 1 slimmed) | 150 |
| **CommandGrid.vue** | 1 | 418 | 4 (1 composable + 2 components + 1 slimmed) | 120 |

**Total new files: ~55 modules/composables/components**
**Hard ceiling: 200 lines per file. No exceptions.**
