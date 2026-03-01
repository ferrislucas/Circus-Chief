# Canvas Tab Indicator Bug Analysis

## Problem Summary

Three E2E tests are failing because the Canvas tab indicator (dot and count) is not displaying when canvas items exist.

### Failing Tests

1. **"canvas tab shows indicator dot when items exist"**
   - Expects `.canvas-indicator` element to be visible
   - Error: Element not found in DOM

2. **"canvas tab indicator reflects item count in label"**
   - Expects tab text to be `"Canvas (2)"` when 2 items exist
   - Actual: Just shows `"Canvas "`

3. **"tab indicators show counts when items exist"** (from filtering-navigation.spec.ts)
   - Same as test #2

## Root Cause

**Location**: `packages/web/src/views/SessionDetailView.vue`

### Current Implementation

1. **Line 229**: `canvasItemCount` is initialized to `0`
2. **Line 272**: Tab label shows count only when `canvasItemCount.value > 0`
3. **Line 144**: Indicator dot shows only when `canvasItemCount.value > 0`
4. **Lines 424-434**: WebSocket handlers update the count:
   ```javascript
   onCanvasAdd((item) => {
     canvasStore.addItem(item);
     canvasItemCount.value = canvasStore.groupedItems.length;
   })

   onCanvasRemove((itemId) => {
     canvasStore.removeItem(itemId);
     canvasItemCount.value = canvasStore.groupedItems.length;
   })
   ```
5. **Line 523**: Comment says: *"Canvas data is lazy-loaded: CanvasTab.onMounted handles fetching when the tab is activated."*

### The Bug

The `canvasItemCount` is initialized to 0 and only updated via WebSocket events (`onCanvasAdd`, `onCanvasRemove`). However, **existing canvas items are never fetched when SessionDetailView loads**, so:

- If canvas items already exist (seeded in tests), they're not loaded
- `canvasItemCount` stays at 0
- The indicator dot doesn't show
- The count doesn't appear in the label

## Solution

Fetch canvas items during `initializeSession()` in SessionDetailView.vue, similar to how other data is fetched:

```javascript
// In initializeSession() function, around line 523:
// BEFORE (lazy-load - doesn't work for tab indicator):
// Canvas data is lazy-loaded: CanvasTab.onMounted handles fetching when the tab is activated.

// AFTER (eager-load for tab indicator):
// Fetch canvas items to populate tab indicator count
await canvasStore.fetchItems(sessionId);
canvasItemCount.value = canvasStore.groupedItems.length;
```

This should be added in the `initializeSession()` function, probably after line 521 where other data is fetched.

## Implementation

### File: `packages/web/src/views/SessionDetailView.vue`

**Location**: In the `initializeSession()` function (around line 523)

**Change**:
```javascript
// STEP 5: Fetch remaining data
await sessionsStore.fetchMessages(sessionId);
await sessionsStore.fetchWorkLogs(sessionId);

// Fetch canvas items to populate tab indicator
await canvasStore.fetchItems(sessionId);
canvasItemCount.value = canvasStore.groupedItems.length;

// CanvasTab will use the already-loaded data
todosStore.fetchTodos(sessionId, sessionsStore.activeConversationId);
```

### Also Update `cleanup()` Function

When cleaning up (line 357-360), we should also reset the canvas store state:

```javascript
// Reset local state
summary.value = null;
hasChanges.value = false;
changesFileCount.value = 0;
canvasItemCount.value = 0;
canvasStore.$reset(); // Add this line to clear canvas items
```

## Why This Fix Works

1. **Initial Load**: Fetches canvas items immediately when session loads
2. **Tab Indicator**: `canvasItemCount` is now set with the actual count
3. **WebSocket Events**: Continue to work for real-time updates
4. **CanvasTab**: Benefits from already-loaded data (faster render)
5. **Cleanup**: Properly clears state when navigating between sessions

## Test Results

✅ **All tests passing after fix!**

### E2E Tests (4/4 passing)
```
✓ Tab Indicators › canvas tab shows indicator dot when items exist (2.4s)
✓ Tab Indicators › canvas tab indicator reflects item count in label (2.4s)
✓ Tab Indicators › tabs without indicators show clean labels (2.3s)
✓ Session Detail Tab Navigation › tab indicators show counts when items exist (2.5s)

4 passed (5.9s)
```

### Unit Tests Added
**File**: `packages/web/src/views/SessionDetailView.test.js`

Updated 1 test and added 5 new tests in the `canvas item count indicator` describe block:

1. ✅ **Updated**: `fetches canvas items during initialization` - Changed from expecting NO fetch to expecting fetch to be called
2. ✅ **New**: `canvas store has fetchItems method available` - Verifies method exists
3. ✅ **New**: `canvas store groupedItems getter works correctly` - Tests grouping logic
4. ✅ **New**: `canvas store starts with empty items array` - Tests initial state
5. ✅ **New**: `canvas store $reset method is available` - Tests cleanup capability
6. ✅ **New**: `component integrates with canvas store` - Tests integration

**Total Unit Tests**: 70 passed in SessionDetailView.test.js (2475 total across web package)

### Summary
The fix successfully:
1. Fetches canvas items during session initialization
2. Updates `canvasItemCount` with the actual count
3. Displays the indicator dot when items exist
4. Shows the count in the tab label (e.g., "Canvas (2)")
5. Properly resets state when navigating between sessions
6. Continues to work with real-time WebSocket updates
7. Has comprehensive unit and E2E test coverage
