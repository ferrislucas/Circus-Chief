# Plan: Stricter Lint Rules, Vitest Coverage Config, and Code Quality Improvements

*Adapted from [PR #666](https://github.com/ferrislucas/claudetools.io/pull/666) against the current codebase*

---

## Current State (measured on this branch)

### ESLint Rules
| Rule | Level | Threshold | Notes |
|------|-------|-----------|-------|
| max-depth | **error** | 4 | Fully enforced |
| max-params | warn | 4 | 0 production violations (1 test-only) |
| complexity | warn | 20 | 18 production violations at threshold 15 |
| max-lines | warn | 500 (600 for Vue) | 24 production files over 400; 5 over 500 |

### Known Config Issue
The Vue override in `.eslintrc.cjs` matches `packages/web/**/*.js` in addition to `*.vue` files, giving all web JS files (stores, composables, API modules) the relaxed 600-line limit instead of 500. Only `.vue` files should get the higher limit.

### Vitest Coverage
- `@vitest/coverage-v8` is **not** installed
- No `test:coverage` scripts exist in any `package.json`
- No coverage config in any `vitest.config.js`
- `packages/shared` has **no** `vitest.config.js` at all
- `coverage/` is already in `.gitignore`

---

## Violations at Target Thresholds

| Rule | Threshold | Production Violations | Test-Only Violations |
|------|-----------|----------------------|---------------------|
| `max-params` | 4 | 0 | 1 |
| `complexity` | 15 | 18 | 0 |
| `max-nested-callbacks` | 3 | 0 | 1,139 |
| `max-lines-per-function` | 80 | 25 | ~491 |
| `max-lines` | 400 general / 500 Vue | 5 Vue files over 500 + 4 server files over 400 | 65 test files |

---

## Plan

### Phase 1: Promote `max-params` to error (safe — zero production violations)

**File:** `.eslintrc.cjs`

- Change `max-params` from `['warn', 4]` to `['error', 4]`
- Already zero production violations; the single test-file violation is in a helper (`makeCpuSample` with 5 params) — exempt test files from this rule (already done)

---

### Phase 2: Add `max-nested-callbacks` rule

**File:** `.eslintrc.cjs`

- Add `'max-nested-callbacks': ['error', 3]` to root rules
- Add `'max-nested-callbacks': ['warn', 5]` override for test files (`**/*.test.js`)
- Zero production violations — safe to adopt immediately
- 1,139 test violations all come from `describe`/`it` nesting; the `warn` at 5 suppresses most

---

### Phase 3: Lower `complexity` from 20 → 15 and promote to error

**File:** `.eslintrc.cjs`

Change `complexity` from `['warn', 20]` to `['error', 15]`.

**18 functions to refactor** — extract helpers, use early returns, simplify conditionals:

| File | Function | Complexity |
|------|----------|------------|
| `server/src/agents/LoggingAgentWrapper.js` | `execute` | 16 |
| `server/src/api/projects.js` | `prepareSessionConfig` | 16 |
| `server/src/db/KanbanLaneRepository.js` | `create` | 20 |
| `server/src/db/SessionRepository.js` | `#mapSession` | 19 |
| `server/src/db/SessionRepository.js` | `create` | 20 |
| `server/src/db/SessionSummaryRepository.js` | `update` | 16 |
| `server/src/services/draftSessionService.js` | `startDraft` | 18 |
| `server/src/services/kanbanService.js` | `triggerOnEnterPrompt` | 19 |
| `server/src/services/scheduleService.js` | `configureSchedule` | 17 |
| `server/src/services/sessionManager.js` | `continueSessionWithExistingMessage` | 18 |
| `server/src/ws/WebSocketManager.js` | `#handleMessage` | 17 |
| `web/src/composables/useProviderForm.js` | `reconcileModels` | 16 |
| `web/src/stores/kanban.js` | `moveCard` | 18 |
| `web/src/stores/sessions/sessionActions.js` | `updateSession` | 16 |
| `web/src/stores/sessions/tokenGetters.js` | `formattedTokens` | 17 |
| `web/src/utils/diffParser.js` | `parseDiff` | 16 |
| `web/src/views/NewSessionView.vue` | anonymous async arrow | 16 |
| `web/src/views/SessionDetailView.vue` | `buildSessionChain` | 16 |

---

### Phase 4: Add `max-lines-per-function` rule

**File:** `.eslintrc.cjs`

- Add `'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }]` to root rules
- Add `'max-lines-per-function': 'off'` override for test files

**25 production functions to refactor** — the worst offenders:

**Server (10):**
- `commandRunner.js` — `run` (150 lines)
- `sessions-commands.js` — anonymous arrow (107 lines)
- `kanbanService.js` — `triggerOnEnterTemplate` (110), `triggerOnEnterPrompt` (105)
- `templateTriggerService.js` — `checkAndTriggerNextTemplate` (102)
- `commandButtons.js` — anonymous arrow (93 lines)
- `sessionPrompts.js` — `buildSessionApiInstructions` (91 lines)
- `sessionManager.js` — `continueSession` (90), `continueSessionWithExistingMessage` (81)

**Web (15):**
- `useSessionInitializer.js` — `useSessionInitializer` (262), `initializeSession` (222)
- `useSessionSubscription.js` — `useSessionSubscription` (262)
- `useProviderForm.js` — `useProviderForm` (190)
- `useProjectSessionSubscription.js` — composable (178), inner arrow (155)
- `useProjectSubscription.js` — composable (145)
- `SessionsApi.js` — `SessionsApi` (138)
- `useMessageScroll.js` — `useMessageScroll` (133)
- `useRunningSessionSubscriptions.js` — composable (119)
- `MiscApi.js` — `MiscApi` (116)
- `ActiveSessionsView.vue` — async arrow (116)
- `useSessionFiltering.js` — composable (97)
- `useSummaries.js` — composable (89)
- `useSessionControl.js` — composable (84)

---

### Phase 5: Tighten `max-lines` — lower thresholds and promote to error

**File:** `.eslintrc.cjs`

- Root rule: `'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }]`
- Vue override: `'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }]`
- Fix Vue override scope: only `.vue` files get the 500 limit (not `*.js`)

**Server files over 400 (4):**
1. `api/canvas.js` (499) — extract trash/bulk operations into `canvas-trash.js`
2. `api/projects.js` (480) — extract command button routes into `projects-command-buttons.js`
3. `api/sessions.js` (493) — extract lifecycle routes into `sessions-lifecycle.js`
4. `services/streamEventHandler.js` (475) — extract result handling into `streamEventHandlerResult.js`

**Vue files over 500 (5):**
1. `components/CanvasFileViewerHeader.vue` (548) — extract menu logic into `useFileViewerMenu.js`
2. `components/CommandButtonItem.vue` (580) — extract actions into `useCommandButtonActions.js`
3. `components/SummaryTab.vue` (645) — extract sections into sub-components
4. `views/NewSessionView.vue` (584) — extract form logic into `useNewSessionForm.js`
5. `views/SessionDetailView.vue` (539) — extract logic into composables

---

### Phase 6: Vitest coverage infrastructure

**6a: Install `@vitest/coverage-v8`**

Add `@vitest/coverage-v8` to root `devDependencies` in `package.json`.

**6b: Add `test:coverage` scripts**

- Root `package.json`: `"test:coverage": "yarn workspaces run test:coverage"`
- `packages/server/package.json`: `"test:coverage": "vitest run --coverage"`
- `packages/web/package.json`: `"test:coverage": "vitest run --coverage"`
- `packages/shared/package.json`: `"test:coverage": "vitest run --coverage"`

**6c: Create `packages/shared/vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.js'],
      exclude: ['src/**/*.test.js'],
    },
  },
});
```

**6d: Add coverage config to existing vitest configs**

Add `coverage` blocks to `packages/server/vitest.config.js` and `packages/web/vitest.config.js`:

```js
coverage: {
  provider: 'v8',
  reporter: ['text', 'json', 'html'],
  include: ['src/**/*.js'],
  exclude: ['src/**/*.test.js'],
},
```

**6e: Measure baselines, then add thresholds**

Run `yarn test:coverage` in each workspace, record actual percentages, then set thresholds 2-3% below measured baselines using a `thresholds` block in each config. Initial estimates (from PR #666):

| Package | Statements | Branches | Functions | Lines |
|---------|-----------|----------|-----------|-------|
| Server  | 75% | 70% | 80% | 75% |
| Web     | 40% | 30% | 40% | 40% |
| Shared  | 60% | 50% | 60% | 60% |

*These must be validated against actual measurements before committing.*

---

### Phase 7: Fix `yarn test` command

**File:** root `package.json`

Change `"test": "yarn workspaces foreach -A run test"` to `"test": "yarn workspaces run test"` to match updated Yarn workspace syntax.

---

## Summary of Final ESLint Config

| Rule | Level | Value | Change |
|------|-------|-------|--------|
| max-depth | error | 4 | unchanged |
| max-params | **error** | 4 | promoted from warn |
| complexity | **error** | **15** | promoted + tightened (was warn 20) |
| max-lines | **error** | **400** (500 Vue-only) | promoted + tightened (was warn 500/600) |
| max-lines-per-function | **error** | **80** | NEW |
| max-nested-callbacks | **error** | **3** (warn 5 for tests) | NEW |

Vue override scope fixed so only `.vue` files get the relaxed max-lines of 500.

---

## Recommended Implementation Order

Each phase as a **separate session**, in dependency order:

1. **Phase 1** (trivial) — Promote `max-params` to error
2. **Phase 2** (trivial) — Add `max-nested-callbacks` rule
3. **Phase 6** (standalone) — Install coverage tooling, create configs, measure baselines, set thresholds
4. **Phase 7** (trivial) — Fix `yarn test` command
5. **Phase 3** (medium) — Tighten complexity: 18 functions to refactor
6. **Phase 4** (large) — Add `max-lines-per-function`: 25 functions to refactor
7. **Phase 5** (large) — Tighten max-lines: 9+ files to split

Phases 1, 2, 6, 7 can all be done in parallel. Phases 3-5 should be sequential since refactoring in Phase 5 often addresses Phase 3/4 violations too.

---

## Risks and Considerations

- **Phase 5 is the biggest effort** — 9+ files need splitting into sub-modules; do file-by-file to avoid regressions
- **Phase 4 is significant** — 25 functions need breaking up, especially Vue composables which are naturally large
- **Coverage thresholds must be data-driven** — measure actual baselines first, set 2-3% below. Ratchet up over time
- **Test file exemptions** are critical — tests need long functions (`describe` blocks), more params, and deeper nesting
- **Vue component line limit (500)** accounts for template/script/style inflation
- **Phase 3 scope is well-defined** — all 18 violations are identified with exact complexity values
