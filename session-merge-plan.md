# Session Consolidation Plan

## Current State Analysis

### Active Sessions (Non-Archived)

**13 Test-Fixing Sessions** (GitHub Issues #245-257):

| Session | Issue | Status | Files Modified |
|---------|-------|--------|----------------|
| 4276f5c6 | #246 CanvasFileViewer | Waiting | CanvasFileViewer.test.js, vitest.setup.js, vitest.config.js |
| 3758798c | #254 CommandsTab | Waiting | CommandsTab.test.js |
| 985abf19 | #255 DOMPurify Mock | Waiting | vitest.setup.js |
| 1eb4de23 | #252 ActiveSessionsView | Waiting | ActiveSessionsView.test.js |
| fcfeda61 | LiveWorkLogPanel | Waiting | LiveWorkLogPanel.test.js |
| 18cfa1af | #249 WorkLogPanel | Waiting | WorkLogPanel.test.js |
| 6d56d09c | #245 SessionListView | Waiting | SessionListView.test.js |
| ab5208b8 | #257 Utility Tests | Waiting | validators.js (new), validators.test.js (new), formatters.test.js |
| 2f240bc4 | #250 TemplateSelector | Waiting | TemplateSelector.test.js |
| 5f858961 | #247 ConversationSelector | Waiting | ConversationSelector.test.js |
| 53bb969f | #253 SummaryTab | Waiting | SummaryTab.test.js |
| 0c42aeb0 | #256 Pinia Stores | Waiting | vitest.config.js, 5 store test files |
| 4493cd3d | #251 CanvasTab | Waiting | CanvasTab.test.js |

**1 Orchestrator Session**:
| Session | Purpose | Branch |
|---------|---------|--------|
| 0e0966ec | Batch Management | claude-tools/c248-stop-all-sessions |

**This Session** (22d1512d): Creating this consolidation plan

---

## Key Finding

**All 13 test-fixing sessions ran WITHOUT git worktrees/branches**

This means all changes were made directly to the **main repository working directory** and are currently **uncommitted**.

### Uncommitted Changes in Main Repo

**Modified Files (16):**
```
packages/web/src/components/CanvasFileViewer.test.js
packages/web/src/components/CanvasTab.test.js
packages/web/src/components/CommandsTab.test.js
packages/web/src/components/ConversationSelector.test.js
packages/web/src/components/LiveWorkLogPanel.test.js
packages/web/src/components/SummaryTab.test.js
packages/web/src/components/TemplateSelector.test.js
packages/web/src/components/WorkLogPanel.test.js
packages/web/src/stores/canvas.test.js
packages/web/src/stores/commandButtons.test.js
packages/web/src/stores/sessions.test.js
packages/web/src/stores/templates.test.js
packages/web/src/stores/ui.test.js
packages/web/src/views/ActiveSessionsView.test.js
packages/web/src/views/SessionListView.test.js
packages/web/vitest.config.js
```

**New Files (4):**
```
PINIA_TEST_FIXES.md (documentation)
packages/web/src/utils/validators.js
packages/web/src/utils/validators.test.js
packages/web/vitest.setup.js
```

---

## Consolidation Plan

### Step 1: Verify Test Suite
```bash
cd /home/ubuntu/workspace/claudetools.io
yarn workspace @claudetools/web test
```
Confirm all tests pass with the combined changes.

### Step 2: Create Feature Branch
```bash
cd /home/ubuntu/workspace/claudetools.io
git checkout -b fix/test-suite-fixes-batch
```

### Step 3: Stage All Changes
```bash
git add packages/web/src/components/*.test.js
git add packages/web/src/stores/*.test.js
git add packages/web/src/views/*.test.js
git add packages/web/src/utils/validators.js
git add packages/web/src/utils/validators.test.js
git add packages/web/vitest.setup.js
git add packages/web/vitest.config.js
# Note: Skip PINIA_TEST_FIXES.md (temp documentation)
```

### Step 4: Create Consolidated Commit
```bash
git commit -m "fix: resolve 200+ failing tests across Vue component and store test suites

Consolidates fixes from GitHub Issues #245-257:
- #245: SessionListView tests (46 tests)
- #246: CanvasFileViewer tests (34 tests)
- #247: ConversationSelector tests (32 tests)
- #249: WorkLogPanel tests (14 tests)
- #250: TemplateSelector tests (13 tests)
- #251: CanvasTab tests (13 tests)
- #252: ActiveSessionsView tests (25 tests)
- #253: SummaryTab tests (15 tests)
- #254: CommandsTab tests (9+ tests)
- #255: DOMPurify mock tests (20 tests)
- #256: Pinia store tests (5 files)
- #257: Utility validators (37 tests)
- LiveWorkLogPanel tests (17 tests)

Key changes:
- Add centralized vitest.setup.js with Pinia and DOMPurify mocks
- Update vitest.config.js to use setup file
- Fix test isolation and async handling patterns
- Add validators.js utility module with tests
- Standardize beforeEach patterns across all test files"
```

### Step 5: Push and Create PR
```bash
git push -u origin fix/test-suite-fixes-batch
gh pr create --title "fix: Resolve 200+ failing tests in Vue test suite" \
  --body "## Summary
- Consolidated fixes from 13 parallel test-fixing sessions
- Resolves GitHub Issues #245-257
- Adds centralized test infrastructure (vitest.setup.js)
- Standardizes test patterns across component and store tests

## Test Plan
- [x] All unit tests pass
- [x] No regressions in existing functionality"
```

### Step 6: Clean Up Sessions

After PR is merged, archive all 13 test-fixing sessions plus the batch management session.

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Conflicting changes (multiple sessions edited same file) | Medium | vitest.setup.js was touched by #246 and #255 - need to verify merged state |
| Tests still failing after consolidation | Low | Run full test suite before committing |
| Missing changes from race conditions | Medium | Review git diff carefully against session summaries |

---

## Archived Sessions (Already Merged)

These sessions have PRs already merged and can be ignored:
- PR #244, #243, #242, #241, #240, #239, #238, #237, #236, #235, #234, #233, #232, #231, #230, #226, #225

---

## Next Steps

1. [ ] Run test suite to verify current state
2. [ ] Review diff for completeness
3. [ ] Create feature branch and commit
4. [ ] Push and create PR
5. [ ] Wait for CI to pass
6. [ ] Merge PR
7. [ ] Archive completed sessions
