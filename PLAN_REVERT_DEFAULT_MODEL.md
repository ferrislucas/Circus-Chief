# Plan: Focus E2E Test Model Changes on Tests Only

## Problem
The current branch changes the default model for the **entire system** from Opus to Haiku by modifying `packages/shared/src/types.js`. However, the intention was to **only change the default model for E2E tests** to make them faster and cheaper.

## Current Changes (Incorrect)

### `packages/shared/src/types.js`
```javascript
// BEFORE:
export const CLAUDE_MODELS = [
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', description: 'Fast & lightweight' },
  { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet 4.5', description: 'Balanced' },
  { id: 'claude-opus-4-5-20251101', name: 'Opus 4.5', description: 'Most capable (default)' },
];
export const DEFAULT_MODEL = 'claude-opus-4-5-20251101';

// AFTER:
export const CLAUDE_MODELS = [
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', description: 'Fast & lightweight (default)' },
  { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet 4.5', description: 'Balanced' },
  { id: 'claude-opus-4-5-20251101', name: 'Opus 4.5', description: 'Most capable' },
];
export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
```

**Impact:** This changes the default for ALL users of the system, not just E2E tests.

## Solution

### 1. Revert changes to `packages/shared/src/types.js`
Restore the original DEFAULT_MODEL and descriptions:

```javascript
export const CLAUDE_MODELS = [
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', description: 'Fast & lightweight' },
  { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet 4.5', description: 'Balanced' },
  { id: 'claude-opus-4-5-20251101', name: 'Opus 4.5', description: 'Most capable (default)' },
];
export const DEFAULT_MODEL = 'claude-opus-4-5-20251101';
```

### 2. Keep E2E test changes
The E2E test changes are correct - they use a `TEST_MODEL` constant to explicitly set Haiku for tests only:

**`tests/e2e/draft-sessions.spec.ts`:**
```javascript
const TEST_MODEL = 'claude-haiku-4-5-20251001';
```

**`tests/e2e/sessionDefaults.spec.ts`:**
```javascript
const TEST_MODEL = 'claude-haiku-4-5-20251001';
```

These changes ensure that:
- E2E tests explicitly use Haiku via `TEST_MODEL` constant
- Tests don't rely on `DEFAULT_MODEL` from types.js
- The system's default remains Opus for normal usage
- Tests are faster and cheaper to run

## Implementation Steps

1. **Revert `packages/shared/src/types.js`**
   - Change `DEFAULT_MODEL` back to `'claude-opus-4-5-20251101'`
   - Update Haiku description back to `'Fast & lightweight'` (remove "(default)")
   - Update Opus description back to `'Most capable (default)'` (add "(default)")

2. **Verify E2E tests still work**
   - Run `./scripts/pw.sh test` to ensure tests still pass
   - Tests should use their own `TEST_MODEL` constant, not the system default

3. **Remove documentation files** (optional)
   - The cleanup plan files (CLEANUP_PLAN.md, CLEANUP_SUMMARY.md, etc.) were likely temporary
   - Consider removing them if they're not needed for the final PR

## Files to Modify

### Modify (1 file):
- `packages/shared/src/types.js` - Revert DEFAULT_MODEL and model descriptions

### Keep Unchanged:
- `tests/e2e/draft-sessions.spec.ts` - Keep TEST_MODEL constant
- `tests/e2e/sessionDefaults.spec.ts` - Keep TEST_MODEL constant
- All other E2E test changes from the cleanup work

### Delete (Optional):
- `CLEANUP_PLAN.md`
- `CLEANUP_SUMMARY.md`
- `E2E_TEST_CLEANUP_REPORT.md`
- `PLAN_SKIP_FAILING_TESTS.md`

## Expected Outcome

After this fix:
- ✅ System default model remains **Opus** (for real usage)
- ✅ E2E tests explicitly use **Haiku** (for speed/cost)
- ✅ No reliance on DEFAULT_MODEL in tests
- ✅ Cleaner separation between test configuration and production defaults

---

## Status: ✅ COMPLETE

**Commit:** `a334b37` - "Revert DEFAULT_MODEL to Opus; keep Haiku for E2E tests only"

### Changes Applied:
1. ✅ Reverted `packages/shared/src/types.js`:
   - `DEFAULT_MODEL` = `'claude-opus-4-5-20251101'`
   - Haiku description: `'Fast & lightweight'`
   - Opus description: `'Most capable (default)'`

2. ✅ E2E tests continue using `TEST_MODEL` constant:
   - `tests/e2e/draft-sessions.spec.ts` - uses `TEST_MODEL = 'claude-haiku-4-5-20251001'`
   - `tests/e2e/sessionDefaults.spec.ts` - uses `TEST_MODEL = 'claude-haiku-4-5-20251001'`

### Verification:
- ✅ System default is now Opus (production-ready)
- ✅ E2E tests explicitly use Haiku (faster/cheaper)
- ✅ Clean separation between test and production configuration
- ✅ No implicit reliance on DEFAULT_MODEL in tests
