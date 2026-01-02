# Frontend Test Fix Plan - Phase 2 & 3 Implementation Roadmap

**Status**: Ready for Phase 2-3 Implementation
**Current State**: 148 failing tests (11.2% failure rate)
**Target**: All 1,325 tests passing (100% pass rate)
**Estimated Effort**: 6-10 hours

---

## Executive Summary

Phase 1 is complete (34 tests fixed). Root causes for remaining 148 failures have been identified and documented. This plan provides a clear, step-by-step approach to complete Phases 2-3.

**Success Metrics:**
- ✅ All Vue ref errors eliminated (Phase 1)
- 🎯 All async/await patterns applied (Phase 2)
- 🎯 All mock stores properly reactive (Phase 3)
- 🎯 All 1,325 tests passing

---

## Phase 2: Async/Reactivity Issues - Implementation Plan

**Goal**: Apply proper async/await patterns to all tests that trigger state changes
**Estimated Impact**: 70+ additional tests
**Effort**: 4-6 hours

### Pattern to Apply Everywhere

```javascript
// BEFORE (Broken)
await button.trigger('click');
expect(button.classes()).toContain('active');

// AFTER (Fixed)
await button.trigger('click');
await flushPromises();
await nextTick();
button = wrapper.find('.button');  // RE-QUERY
expect(button.classes()).toContain('active');
```

### Step 1: Fix CommandButtonItem.test.js (25 failures)
**File**: `packages/web/src/components/CommandButtonItem.test.js`
**Pattern**: Event triggers and state changes without proper awaits
**Action Items**:
- [ ] Add `await flushPromises()` after every `.trigger()` call
- [ ] Add `await nextTick()` after every async operation
- [ ] Change `const` to `let` for DOM element references
- [ ] Re-query DOM elements after state updates (before assertions)
- [ ] Update 15+ test functions with proper async patterns

**Verification**: Run `yarn workspace @claudetools/web test src/components/CommandButtonItem.test.js`
**Expected Result**: Reduce failures from 25 to ~5 (remaining failures are Phase 3)

---

### Step 2: Fix ProjectEditView.test.js (14 failures)
**File**: `packages/web/src/views/ProjectEditView.test.js`
**Pattern**: Form watchers using arbitrary setTimeout delays
**Action Items**:
- [ ] Replace all `setTimeout(resolve, 100)` delays with proper async patterns
- [ ] Add `await flushPromises()` instead of relying on timing
- [ ] Add `await nextTick()` for DOM updates
- [ ] Ensure form state updates properly trigger computed properties

**Expected Result**: Reduce failures from 14 to ~3

---

### Step 3: Fix SummaryTab.test.js (10 failures)
**File**: `packages/web/src/components/SummaryTab.test.js`
**Pattern**: Mixed async handling, some tests have good pattern some don't
**Action Items**:
- [ ] Identify inconsistent async patterns
- [ ] Apply consistent `flushPromises()` + `nextTick()` everywhere
- [ ] Use the flushAll() helper consistently across all tests
- [ ] Re-query DOM elements after state updates

**Expected Result**: Reduce failures from 10 to ~2

---

### Step 4: Fix WorkLogPanel.test.js (13 failures)
**File**: `packages/web/src/components/WorkLogPanel.test.js`
**Pattern**: Toggle and expansion tests need async fixes
**Action Items**:
- [ ] Add `await flushPromises()` after DOM triggers
- [ ] Add `await nextTick()` before DOM assertions
- [ ] Re-query element references after state updates

**Expected Result**: Reduce failures from 13 to ~1

---

### Step 5: Fix ConversationSelector.test.js (13 failures)
**File**: `packages/web/src/components/ConversationSelector.test.js`
**Pattern**: Dropdown interaction and state tests
**Action Items**:
- [ ] Add `await flushPromises()` + `await nextTick()` after dropdown triggers
- [ ] Re-query dropdown button and menu items after opening/closing
- [ ] Fix "adds active class to selected filter button" tests

**Expected Result**: Reduce failures from 13 to ~5 (remaining Phase 3)

---

### Step 6: Fix Remaining Small Files (27 failures across 6+ files)
**Files**:
- TemplateSelector.test.js (3 failures)
- SessionCard.test.js (1 failure)
- ButtonStatusModal.test.js (1 failure)
- ChangesTab.test.js (1 failure)
- CanvasFileViewer.test.js (1 failure)
- DiffViewer.test.js (2 failures)
- CommandButtonDetailView.test.js (6 failures)
- Others

**Pattern**: Same async/await and re-query patterns
**Action Items**:
- [ ] Apply Phase 2 pattern consistently to each file
- [ ] Use automated search/replace where possible
- [ ] Test each file individually

---

## Phase 3: Mock Store Reactivity - Implementation Plan

**Goal**: Fix mock stores to properly trigger reactivity on state changes
**Estimated Impact**: 50+ additional tests (combined with Phase 2)
**Effort**: 2-4 hours

### Root Cause #1: Mock Stores Not Using reactive()

**Problem**:
```javascript
// ❌ WRONG - Plain object won't trigger Vue reactivity
const mockStore = { statusFilter: null };
mockStore.setStatusFilter = (f) => { mockStore.statusFilter = f; };
```

**Solution**:
```javascript
// ✅ RIGHT - Wrapped in reactive()
import { reactive } from 'vue';
const mockStore = reactive({ statusFilter: null });
mockStore.setStatusFilter = (f) => { mockStore.statusFilter = f; };
```

### Step 1: Audit All Test Files for Proper reactive() Usage

**Files to Check**:
- [ ] SessionListView.test.js - Check createSessionsStoreMock()
- [ ] ActiveSessionsView.test.js - Check store setup in beforeEach
- [ ] ProjectEditView.test.js - Check mock store setup
- [ ] SummaryTab.test.js - Check store mocking
- [ ] All other test files

**Verification Checklist**:
- [ ] All mock stores use `reactive()` wrapper
- [ ] All mock objects have proper getters/setters
- [ ] Computed properties are properly set up

---

### Step 2: Ensure setActivePinia() Called in All beforeEach

**Problem**: Some tests don't initialize Pinia, breaking store reactivity

**Solution**: Add to EVERY test file beforeEach:
```javascript
beforeEach(() => {
  setActivePinia(createPinia());
  // ... other setup
});
```

**Files to Update**:
- [ ] SessionListView.test.js
- [ ] ActiveSessionsView.test.js
- [ ] ProjectEditView.test.js
- [ ] SummaryTab.test.js
- [ ] CommandButtonItem.test.js
- [ ] All others that use stores

---

### Step 3: Verify Computed Properties Work with Mock Stores

**Pattern to Test**:
```javascript
// Setup reactive store
const mockStore = reactive({ statusFilter: null });

// Verify computed property updates when store changes
mockStore.statusFilter = 'running';
await nextTick();
expect(mockStore.statusFilter).toBe('running');  // Should reflect change
```

**Tests Affected**:
- SessionListView filter tests
- ActiveSessionsView filter tests
- Any test checking computed property results after state change

---

### Step 4: Test Summary Update Callbacks

**Pattern**:
```javascript
// When callback updates reactive object
onSessionSummaryUpdatedCallback('session-1', newSummary);
await flushPromises();
await nextTick();

// Verify component received the update
const card = wrapper.find('[data-session-id="session-1"]');
expect(card.attributes('data-summary')).toBe(JSON.stringify(newSummary));
```

**Files to Fix**:
- [ ] SessionListView.test.js - Summary update tests (3 failures)
- [ ] ActiveSessionsView.test.js - Summary update tests (3 failures)

---

## Implementation Checklist

### Phase 2 Tasks (6-8 hours)
- [ ] CommandButtonItem.test.js - Apply async pattern (25 → 5 expected failures)
- [ ] ProjectEditView.test.js - Replace setTimeout (14 → 3 expected)
- [ ] SummaryTab.test.js - Apply consistent patterns (10 → 2 expected)
- [ ] WorkLogPanel.test.js - Apply async pattern (13 → 1 expected)
- [ ] ConversationSelector.test.js - Dropdown async fixes (13 → 5 expected)
- [ ] Small files - Apply patterns (27 → 5 expected)
- [ ] Run full test suite - Verify Phase 2 progress

### Phase 3 Tasks (2-4 hours)
- [ ] Audit all test files for reactive() usage
- [ ] Add setActivePinia() to missing beforeEach blocks
- [ ] Verify computed properties work with mock stores
- [ ] Fix summary update callback tests
- [ ] Run full test suite - Verify Phase 3 progress
- [ ] Final validation: All 1,325 tests passing

---

## Expected Results After Each Phase

### After Phase 2 Completion:
- CommandButtonItem: 25 → ~5 failures
- ProjectEditView: 14 → ~3 failures
- SummaryTab: 10 → ~2 failures
- WorkLogPanel: 13 → ~1 failure
- ConversationSelector: 13 → ~5 failures
- Small files: 27 → ~5 failures
- **Total**: 148 → ~65 failures

### After Phase 3 Completion:
- SessionListView filter tests: Working
- ActiveSessionsView filter tests: Working
- Summary update tests: Working
- **Total**: 65 → 0 failures ✅

---

## Testing Strategy

### Test Individual Files as You Fix Them
```bash
# After fixing each file, run its tests immediately
yarn workspace @claudetools/web test src/path/to/file.test.js
```

### Run Full Suite Periodically
```bash
# After completing each phase
yarn workspace @claudetools/web test

# Check progress with grep
yarn workspace @claudetools/web test 2>&1 | grep "Test Files\|Tests"
```

### Git Commits Strategy
- Commit after each file is fixed and tests verified
- Include test counts in commit messages
- Track progress visually: "25 → 5 failures"

---

## Success Criteria

✅ Phase 2 Complete:
- All async/await patterns applied
- All DOM elements re-queried after state changes
- All tests using proper `flushPromises()` + `nextTick()`

✅ Phase 3 Complete:
- All mock stores wrapped in `reactive()`
- All test files have `setActivePinia(createPinia())`
- All computed properties working with mock stores
- All callback-based state updates working

✅ Final:
- All 1,325 tests passing
- 0 failing tests
- 100% pass rate

---

## Estimated Timeline

- **Phase 2**: 6-8 hours
  - CommandButtonItem: 1.5 hours
  - ProjectEditView: 1 hour
  - SummaryTab: 1 hour
  - WorkLogPanel: 1 hour
  - ConversationSelector: 1 hour
  - Small files + testing: 1.5 hours

- **Phase 3**: 2-4 hours
  - Audit & fixes: 2 hours
  - Testing & verification: 1-2 hours

- **Total**: 8-12 hours from start to complete

---

## Notes for Implementation

1. **Work Top-to-Bottom**: Start with files having most failures first
2. **Verify Incrementally**: Test each file as you complete it
3. **Pattern Consistency**: Use the same async pattern everywhere
4. **Commit Often**: Small commits make it easy to track progress
5. **Document Issues**: If you find new patterns, document them
6. **Re-use Solutions**: Solutions for one file often apply to others

---

Generated: Claude Code - Frontend Test Fix Plan
Date: December 28, 2025
Version: Phase 2-3 Roadmap
