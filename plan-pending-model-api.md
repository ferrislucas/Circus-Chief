# Implementation Plan: Add pendingModel to REST API

## Goal
Allow agents to modify the model for scheduled/waiting sessions via REST API by exposing `pendingModel` in two endpoints.

---

## Changes Required

### 1. Add `pendingModel` to `PATCH /api/sessions/:id`

**File:** `packages/server/src/api/sessions.js`

**Location:** Lines 883-1019 (the PATCH handler)

**Changes:**
1. Extract `pendingModel` from `req.body` (around line 894, add to destructuring)
2. Add validation and assignment to `updateData` (after line 941):
   ```javascript
   if (pendingModel !== undefined) {
     updateData.pendingModel = pendingModel;
   }
   ```

**Note:** No additional validation needed - `pendingModel` accepts any string or null, same as `model`.

---

### 2. Add `pendingModel` to `POST /api/sessions/:id/schedule`

**File:** `packages/server/src/api/sessions.js`

**Location:** Lines 1154-1249 (the schedule handler)

**Changes:**
1. Extract `pendingModel` from `req.body` (around line 1166, add to destructuring)
2. Add to `updateData` object (after line 1226):
   ```javascript
   if (pendingModel !== undefined) {
     updateData.pendingModel = pendingModel;
   }
   ```

---

## Testing

### Unit Tests to Add

**File:** `packages/server/src/api/sessions.test.js` (or create if needed)

1. **PATCH /api/sessions/:id**
   - Test updating `pendingModel` to a valid model string
   - Test clearing `pendingModel` by setting to `null`
   - Test that other fields are unaffected when only updating `pendingModel`

2. **POST /api/sessions/:id/schedule**
   - Test scheduling with `pendingModel` specified
   - Test scheduling without `pendingModel` (should not clear existing value)

### Manual Testing
1. Create a scheduled session via `POST /api/projects/:id/sessions`
2. Verify `pendingModel` is set correctly
3. Update `pendingModel` via `PATCH /api/sessions/:id`
4. Verify the change persists
5. Let the scheduler start the session and verify the correct model is used

---

## Implementation Order

1. Add `pendingModel` to `PATCH /api/sessions/:id`
2. Add `pendingModel` to `POST /api/sessions/:id/schedule`
3. Add unit tests
4. Manual verification

---

## Estimated Effort

~30 minutes - straightforward additions following existing patterns in the codebase.
