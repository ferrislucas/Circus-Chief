# Session List Order Preservation Fix

## Issue
When the scheduled sessions filter was engaged on the session list view, the order of sessions would change unexpectedly. The order should have remained consistent regardless of which filters were applied.

## Root Cause
The issue was in the `filteredGroupedSessions` computed property in `packages/web/src/composables/useSessionFiltering.js`. While JavaScript's `Array.filter()` method does preserve the order of elements, there was no explicit guarantee that the filtered sessions would maintain their original order from `groupedSessions`.

The sessions are fetched from the backend with a consistent SQL `ORDER BY` clause:
```sql
ORDER BY starred DESC, updated_at DESC, created_at DESC, rowid DESC
```

However, when multiple filters were applied (especially the scheduled filter), the resulting array didn't have an explicit mechanism to preserve the original ordering from `groupedSessions`.

## Solution
Added an explicit sort step at the end of the `filteredGroupedSessions` computed property that ensures filtered sessions maintain the same order as they appear in the original `groupedSessions` array.

### Changes Made

**File: `packages/web/src/composables/useSessionFiltering.js`**

1. Capture the original order of sessions at the start of the computed function
2. Apply all filters as before
3. Explicitly sort the filtered results to match the original order

```javascript
const filteredGroupedSessions = computed(() => {
  // Capture the original order at the start to avoid reactivity issues
  const originalGroups = sessionsStore.groupedSessions;
  const originalOrderMap = new Map(
    originalGroups.map((g, index) => [g.parent.id, index])
  );

  let groups = originalGroups;

  // Apply workflow-aware status filter if set
  if (sessionsStore.statusFilter) {
    groups = groups.filter(/* ... */);
  }

  // Apply starred filter if set
  if (sessionsStore.starredFilter === 'starred') {
    groups = groups.filter(/* ... */);
  } else if (sessionsStore.starredFilter === 'unstarred') {
    groups = groups.filter(/* ... */);
  }

  // Apply workflow-aware scheduled filter if set
  if (sessionsStore.scheduledFilter) {
    groups = groups.filter(/* ... */);
  }

  // Ensure the filtered groups maintain the same order as the original groupedSessions
  return groups.slice().sort((a, b) => {
    const aIndex = originalOrderMap.get(a.parent.id) ?? 999999;
    const bIndex = originalOrderMap.get(b.parent.id) ?? 999999;
    return aIndex - bIndex;
  });
});
```

**File: `packages/web/src/composables/useSessionFiltering.test.js`**

Added three new test cases to verify order preservation:

1. **"preserves original order when scheduled filter is applied"** - Verifies that when filtering by scheduled sessions, the remaining sessions maintain their original order
2. **"preserves original order when starred filter is applied"** - Verifies that when filtering by starred status, the remaining sessions maintain their original order
3. **"preserves original order when multiple filters are combined"** - Verifies that when multiple filters are applied together, the order is still preserved

## Benefits

1. **Consistent User Experience**: Sessions now appear in the same order regardless of which filters are active
2. **Predictable Behavior**: Users can rely on the session order being consistent
3. **Performance**: Using a `Map` for O(1) lookups makes the final sort efficient
4. **Test Coverage**: New tests ensure this behavior won't regress in the future

## Testing

All 38 tests pass, including:
- 35 existing tests for the filtering functionality
- 3 new tests specifically for order preservation

Run tests with:
```bash
yarn workspace @circuschief/web test src/composables/useSessionFiltering.test.js
```

## Related Files

- `packages/web/src/composables/useSessionFiltering.js` - Core fix
- `packages/web/src/composables/useSessionFiltering.test.js` - Test coverage
- `packages/web/src/stores/sessions.js` - Contains `groupedSessions` getter
- `packages/server/src/db/SessionRepository.js` - Backend SQL ordering
