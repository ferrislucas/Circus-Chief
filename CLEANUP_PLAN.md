# E2E Test Cleanup Plan - Skipped Tests to Remove

## Summary
Found 28 skipped tests across 8 test files. These tests are using `test.skip()` and should be completely removed.

## Files with Skipped Tests

### 1. **session-navigation.spec.ts** (1 test)
- Line 105: `test.skip('back button works after navigating via breadcrumb')`
  - Reason: Browser back button doesn't work reliably with route key-based remounting
  - Action: **REMOVE entire test** (lines 105-121)

### 2. **scheduling-ui.spec.ts** (3 tests)
- Line 54: `test.skip('clock icon appears next to Send button for waiting sessions')`
  - Reason: Requires session in waiting state, marked as TODO
  - Action: **REMOVE entire test describe block** (lines 54-56)

- Line 80: `test.skip('clicking clock icon opens scheduling modal for waiting session')`
  - Reason: Requires session in waiting state
  - Action: **REMOVE entire test** (lines 80-82)

- Line 110: `test.skip('no "Configure Auto-Reschedule" button on waiting session')`
  - Reason: Requires session in waiting state
  - Action: **REMOVE entire test describe block** (lines 110-112)

### 3. **sessions.spec.ts** (1 test)
- Line 352: `test.skip('supports multi-turn conversation')`
  - Reason: WebSocket message delivery not reliable in CI, marked as TODO
  - Action: **REMOVE entire test** (lines 352-414)

### 4. **projects.spec.ts** (1 test)
- Line 15: `test.skip('displays empty state when no projects exist')`
  - Reason: Requires no non-test projects in database
  - Action: **REMOVE entire test** (lines 15-19)

### 5. **canvas.spec.ts** (2 tests)
- Line 343: `test.skip(!!process.env.CI, 'Skipped in CI - requires shared filesystem')`
  - Part of test: 'image renders correctly when using filePath' (lines 342-378)
  - Action: **REMOVE entire test** (lines 342-378)

- Line 422: `test.skip(!!process.env.CI, 'Skipped in CI - requires shared filesystem')`
  - Part of test: 'API returns error for unsupported image format' (lines 421-...)
  - Action: **REMOVE entire test** (need to find end of this test)

### 6. **quick-responses.spec.ts** (8 tests)
Multiple `test.skip()` calls in quick response tests:
- Line 92: `test.skip()` in test starting at line 40
- Line 109: `test.skip()` in test starting at line 96
- Line 132: `test.skip()` in test starting at line 136
- Line 149: `test.skip()` in test starting at line 136
- Line 180: `test.skip()` in test starting at line 136
- Line 318: `test.skip()` in test starting at line 267
- Line 363: `test.skip()` in test starting at line 322
- Line 377: `test.skip()` in test starting at line 367
- Line 428: `test.skip()` in test starting at line 367
- Line 442: `test.skip()` in test starting at line 432
- Line 487: `test.skip()` in test starting at line 432

These appear to be conditional skips within tests based on test data availability. Need careful review.

### 7. **screenshots-175.spec.ts** (1 test group)
- Line 43: `test.skip(!process.env.SCREENSHOT_MODE, 'Screenshots only run with SCREENSHOT_MODE=1')`
  - Affects all 5 tests in this describe block (lines 43-146)
  - Action: **REMOVE entire describe block** (lines 40-166)

### 8. **screenshots-star-jump.spec.ts** (1 test group)
- Line 51: `test.skip(!process.env.SCREENSHOT_MODE, 'Screenshots only run with SCREENSHOT_MODE=1')`
  - Affects all 4 tests in this describe block (lines 51-236)
  - Action: **REMOVE entire describe block** (lines 49-237)

## Removal Strategy
1. Remove full test functions/describe blocks
2. Remove conditional skips that guard entire test groups
3. For conditional skips within tests, remove the entire test containing the skip
4. Preserve test structure and imports for remaining tests
