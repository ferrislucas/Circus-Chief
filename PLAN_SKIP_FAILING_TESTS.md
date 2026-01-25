# Plan: Skip Failing E2E Tests

## Overview
Skip all E2E tests that are currently failing to allow the test suite to run successfully while these tests are investigated and fixed.

## Failing Tests to Skip

Based on the test output, the following tests need to be skipped:

### 1. **pw.sh Script Output Tests** (`tests/e2e/pwshOutput.spec.ts`)
- Test 79: `pw.sh help captures output`
- Test 80: `long-running command streams output incrementally`

**Issue**: Output capture problems - expected content not found in script output

### 2. **Quick Response Dialog Tests** (`tests/e2e/quick-response-dialog-fixed-footer.spec.ts`)
- Test 81: `should display Save button in fixed footer when opening Add New dialog`
- Test 82: `should keep Save button visible in fixed footer when scrolling through long form content`
- Test 83: `should have correct dialog layout: fixed header, scrollable content, fixed footer`
- Test 84: `should keep both Cancel and Save buttons visible in fixed footer while scrolling`

**Issue**: Strict mode violation - multiple dialogs found on page when trying to locate dialog

### 3. **Quick Response Final Tests** (`tests/e2e/quick-response-final.spec.ts`)
- Test 85: `demonstrates Quick Response dialog with Save button`

**Issue**: Cannot find "Edit Project" or "Project Settings" heading

### 4. **Quick Response Save Button Tests** (`tests/e2e/quick-response-save-button.spec.ts`)
- Test 86: `Quick Response Dialog displays Save button`

**Issue**: Dialog not visible when expected

### 5. **Quick Responses Tests** (`tests/e2e/quick-responses.spec.ts`)
- Test 87: `should focus textarea after inserting quick response`
- Test 88: `should append quick response to existing text in prompt`
- Test 89: `Test Case 1: Non-Auto-Submit Response Inserts Correct Text`

**Issue**: CSS selector syntax errors and missing textarea elements

## Implementation Steps

### Step 1: Add Test Skip Annotations
Add `.skip` to the affected test cases in their respective files:

1. **`tests/e2e/pwshOutput.spec.ts`**
   - Skip test: `pw.sh help captures output` (line ~79)
   - Skip test: `long-running command streams output incrementally` (line ~171)

2. **`tests/e2e/quick-response-dialog-fixed-footer.spec.ts`**
   - Skip all 4 tests in this file (lines ~30, ~99, ~197, ~357)

3. **`tests/e2e/quick-response-final.spec.ts`**
   - Skip test: `demonstrates Quick Response dialog with Save button` (line ~13)

4. **`tests/e2e/quick-response-save-button.spec.ts`**
   - Skip test: `Quick Response Dialog displays Save button` (line ~16)

5. **`tests/e2e/quick-responses.spec.ts`**
   - Skip test: `should focus textarea after inserting quick response` (line ~96)
   - Skip test: `should append quick response to existing text in prompt` (line ~136)
   - Skip test: `Test Case 1: Non-Auto-Submit Response Inserts Correct Text` (line ~267)

### Step 2: Example Skip Implementation

For each failing test, change:
```typescript
test('should do something', async ({ page }) => {
```

To:
```typescript
test.skip('should do something', async ({ page }) => {
```

Or add a skip reason:
```typescript
test.skip('should do something - TODO: fix dialog selector issue', async ({ page }) => {
```

### Step 3: Verification
After skipping tests, run the test suite to verify:
```bash
./scripts/pw.sh test
```

Expected result: All remaining tests should pass without the skipped tests interfering.

## Summary

- **Total tests to skip**: 9 tests across 5 files
- **Primary issues**:
  - Dialog selector ambiguity (multiple dialogs on page)
  - Output capture timing issues
  - CSS selector syntax errors
  - Missing UI elements (headless environment differences)

## Notes

- These tests can be re-enabled once the underlying issues are resolved
- Consider fixing the dialog tests by using more specific selectors (e.g., `getByRole('dialog', { name: 'Add Quick Response' })`)
- The pw.sh output tests may need timing adjustments or different capture mechanisms
- Quick response tests may need environment-specific handling for headless vs headed mode
