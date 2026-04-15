# ESLint Tightening Plan

## Current State

- 0 lint errors, 8 warnings (Vue `v-html` / self-closing tags)
- All unit tests passing across all packages
- Already enforcing: `max-lines: 300`, `max-lines-per-function: 80`, `complexity: 12`, `max-depth: 3`, `max-params: 4`, `sonarjs/cognitive-complexity: 15`, `max-nested-callbacks: 3`

### Important: Vue `max-lines` Behavior

ESLint's `max-lines` rule with `vue-eslint-parser` does **not** count `<style>` block content toward the limit. Only `<template>` + `<script>` effective lines are checked. A Vue file with 1055 raw lines can pass a 600-line limit if its template + script section has fewer than 600 non-blank, non-comment lines. All Vue file counts below reflect this behavior (verified via actual ESLint dry-runs).

---

## Phase 1 — Quick Wins (~33 production violations, ~16 files)

### 1.1 Add `max-statements: 25` (NEW rule)

- **Why:** No statement-count guard exists today. Functions with 30-59 statements are hard to reason about.
- **Production violations:** 19
- **Files and functions:**
  - `LaneSettingsModal.vue` — `handleSave` (59 stmts), `resetForm` (41 stmts)
  - `useSessionInitializer.js` — `initializeSession` (46 stmts)
  - `sessionExecution.js` — `continueSessionCore` (37 stmts)
  - `templateTriggerService.js` — `checkAndTriggerNextTemplate` (32 stmts)
  - `AgentCallLogRepository.js` — `getAll` (32 stmts)
  - `ProjectRepository.js` — `update` (32 stmts)
  - `useSessionSubscription.js` — `useSessionSubscription` (31 stmts)
  - `projects.js` — POST handler (30 stmts)
  - `sessionManager.js` — `continueSessionWithExistingMessage` (29 stmts)
  - `ConversationRepository.js` — `update` (28 stmts)
  - `schedulerService.js` — `startScheduledSession` (28 stmts)
  - `commands.js` — async arrow (27 stmts)
  - `kanbanTriggers.js` — `triggerOnEnterTemplate` (27 stmts)
  - `summaryService.js` — `_doGenerateSummary` (27 stmts)
  - `useProviderForm.js` — `useProviderForm` (27 stmts)
  - `useProjectSessionSubscription.js` — async arrow (26 stmts)
  - `kanbanTriggers.js` — `triggerOnEnterPrompt` (26 stmts)
  - `QuickResponseRepository.js` — `update` (26 stmts)
- **Fix pattern:** Extract helper functions, group related statements into cohesive sub-functions.
- **Config change:** Add `'max-statements': ['error', 25]` to global rules AND add `'max-statements': 'off'` to the test file override block.

### 1.2 Tighten `max-nested-callbacks` 3 → 2

- **Violations:** 6 across 3 files
- **Files:**
  - `ActiveSessionsView.vue` — lines 275, 292, 317
  - `useProjectSessionSubscription.js` — lines 119, 120
  - `MarkdownEditor.vue` — line 31
- **Fix pattern:** Flatten with early returns, extract inner callbacks to named functions.

### 1.3 Tighten `max-lines-per-function` 80 → 70

- **Violations:** 8 across 6 files
- **Files:**
  - `AgentCallLogRepository.js` — `getAll` (78 lines)
  - `commandRunner.js` — `run` (76 lines), inner arrow (71 lines)
  - `sessionExecution.js` — `continueSessionCore` (76 lines)
  - `migrations/sessionsMigrations.js` — `migrateSessionsStatusConstraint` (76 lines)
  - `templateTriggerService.js` — `checkAndTriggerNextTemplate` (75 lines)
  - `commands.js` — async arrow (71 lines)
  - `LaneSettingsModal.vue` — `handleSave` (71 lines)
- **Fix pattern:** Extract setup/validation/cleanup into helpers. These overlap heavily with `max-statements` fixes — fixing one often fixes both.
- **Update composable override:** 250 → 230, API resources: 150 → 130

### Phase 1 Deliverable

Update `.eslintrc.cjs`, fix all violations, verify with full checklist below.

---

## Phase 2 — Complexity Reduction (~47 violations, ~35 files)

### 2.1 Tighten `complexity` 12 → 10

- **Violations:** 34 across ~25 files
- **Most are at 11-12** (barely over), so function decomposition is straightforward.
- **Key files:**
  - `sessions/tokenGetters.js` — 3 arrow fns at complexity 12
  - `sessionProvider.js` — `buildProviderEnv` at 12
  - `kanbanTriggers.js` — `triggerOnEnterPrompt` at 12
  - `projects-session-helpers.js` — `setupAndStartSession` at 12
  - `ConversationTab.vue` — `handleFormSubmit` at 12
  - `slashCommandResolver.js` — `resolvePromptSkillOrCommand` at 12
  - `usageTracking.js` — `extractUsageFromEvent` at 12
  - `ProjectDefaultsRepository.js` — `upsert` at 12
  - `summaryClaudeClient.js` — async generator at 12
  - `TerminalParser.js` — `#shouldClearLineForCSI` at 12
  - `LaneSettingsModal.vue` — `handleSave` at 11
  - `prUrlService.js` — `getPrInfo` at 11
- **Fix pattern:** Extract conditional branches into named predicate functions. Replace switch/if chains with lookup objects where possible.

### 2.2 Tighten `sonarjs/cognitive-complexity` 15 → 12

- **Violations:** 13 across 13 files
- **All violating files:**
  - `streamEventCallbacks.js` — `handleTurnCompletion` (15)
  - `sessionProvider.js` — `buildProviderEnv` (14)
  - `ProjectDefaultsRepository.js` — `upsert` (14)
  - `prStatusService.js` — `checkPrStatus` chain (14)
  - `ModelSelector.vue` — arrow fn (14)
  - `ConversationRepository.js` — `update` (13)
  - `prUrlService.js` — function (13)
  - `scheduleService.js` — function (13)
  - `summaryClaudeClient.js` — function (13)
  - `ConversationTab.vue` — `handleFormSubmit` (13)
  - `SlashCommandWizard.vue` — `buildInsertString` (13)
  - `sessions.js` store — arrow fn (13)
  - `SessionDetailView.vue` — function (13)
- **Fix pattern:** Reduce nesting, extract early-return guards, break complex conditionals into helper functions. High overlap with `complexity` — fixing 2.1 first will reduce this list.

### Phase 2 Deliverable

Update `.eslintrc.cjs`, fix all violations, verify with full checklist below.

---

## Phase 3 — File Size & Parameter Discipline (~64 violations, ~50 files)

### 3.1 Tighten `max-lines` 300 → 275 (Vue: 600 → 550)

- **Violations:** 12 (4 server JS + 3 Vue + 5 web JS)
- **Server files over 275 effective lines:**
  - `commandRunner.js` (297 effective)
  - `projects.js` (290 effective)
  - `summaryService.js` (288 effective)
  - `sessionPrompts.js` (281 effective)
- **Vue files over 550 effective lines (template + script only, style excluded):**
  - `CommandButtonItem.vue` (567 effective)
  - `TemplatesPanel.vue` (561 effective)
  - `ProjectEditView.vue` (556 effective)
- **Web JS files over 275 effective lines:**
  - `sessions.js` (290 effective)
  - `kanban.js` (288 effective)
  - `canvas.js` (286 effective)
  - `sessionConversations.js` (284 effective)
  - `useSessionInitializer.js` (284 effective)
- **Fix pattern:** Extract sub-components from large Vue files, split service files into focused modules, move shared helpers to utility files.

### 3.2 Tighten `max-params` 4 → 3

- **Violations:** ~52 across 40 files
- **Architectural change:** Push toward options-object pattern for 4+ param functions.
- **Special cases needing `eslint-disable`:**
  - Express error handler `(err, req, res, next)` — cannot change signature
- **Key refactors:**
  - Repository `create` methods → accept single options object
  - Service functions like `runSession`, `continueSession` → options object
  - WebSocket callbacks → destructured options
- **Fix pattern:** `fn(a, b, c, d)` → `fn({ a, b, c, d })` with destructuring in function body.

### Phase 3 Deliverable

Update `.eslintrc.cjs`, fix all violations, verify with full checklist below.

---

## Not Planned (Stay at Current)

### `max-depth` — keep at 3

- Tightening to 2 would cause 75 violations across 47 files.
- Depth 2 is unusually strict — it means you can't have an `if` inside a `for` without extracting a function.
- Current limit of 3 is already stricter than most codebases.

---

## Verification Checklist (Each Phase)

After every phase, run these commands and confirm they all pass:

```bash
# 1. Lint — must exit 0 with no new errors
yarn lint

# 2. Unit tests with coverage enforcement — must pass thresholds
#    Server: 81% stmts, 78% branches, 85% fns, 81% lines
#    Web:    62% stmts, 57% branches, 56% fns, 63% lines
#    Shared: 77% stmts, 89% branches, 85% fns, 76% lines
yarn workspace @circuschief/server test:coverage
yarn workspace @circuschief/web test:coverage
yarn workspace @circuschief/shared test:coverage

# 3. Integration tests — covers session lifecycle and model providers
yarn test:integration
```

If any refactored function has its test coverage drop, add or update unit tests to maintain the thresholds before moving on.

---

## Summary

| Phase | Rules Changed | Violations | Files | Effort |
|-------|--------------|------------|-------|--------|
| 1 | `max-statements` (new at 25), `max-nested-callbacks` (3→2), `max-lines-per-function` (80→70) | ~33 | ~16 | Low-Med |
| 2 | `complexity` (12→10), `sonarjs/cognitive-complexity` (15→12) | ~47 | ~35 | Medium |
| 3 | `max-lines` (300→275, Vue 600→550), `max-params` (4→3) | ~64 | ~50 | High |
| **Total** | 7 rules | **~144** | **~80** | |
