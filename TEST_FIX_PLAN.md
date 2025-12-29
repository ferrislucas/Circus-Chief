# Test Fix Plan

## Summary of Failures

**Test Results:** 18 test files failed, 72 individual tests failing, 1217 passing

The failing tests fall into 4 main categories:

---

## Category 1: Missing API Mock - `getSessionDefaultBranch` (21 tests)

### Affected Files
- `src/components/ChangesTab.test.js` - All 21 tests failing

### Root Cause
The test file mocks `../api/ApiClient.js` with only `getSessionChanges`, but the `ChangesTab.vue` component also calls `api.getSessionDefaultBranch()` on mount, which is not mocked.

### Error Message
```
api.getSessionDefaultBranch is not a function
```

### Fix
Add `getSessionDefaultBranch` to the API mock:

```javascript
vi.mock('../api/ApiClient.js', () => ({
  api: {
    getSessionChanges: vi.fn().mockResolvedValue({ staged: '', unstaged: '', untracked: '' }),
    getSessionDefaultBranch: vi.fn().mockResolvedValue({ branch: null }), // ADD THIS
  },
}));
```

---

## Category 2: Pinia Store Setup Issue (Multiple tests)

### Affected Files
- `src/stores/sessions.test.js`
- `src/stores/projects.test.js`

### Root Cause
The `setActivePinia(createPinia())` call is at the **module level** (outside `beforeEach`), which can cause issues with test isolation when tests modify the store state. The Pinia store gets contaminated between tests.

### Error Messages
```
Cannot read properties of undefined (reading 'get')
Cannot read properties of undefined (reading 'sessions')
```

### Fix
Move `setActivePinia(createPinia())` inside `beforeEach`:

```javascript
// BEFORE (problematic)
describe('Sessions Store', () => {
  setActivePinia(createPinia()); // At module level - BAD

  beforeEach(() => {
    const store = useSessionsStore();
    store.$reset();
  });
});

// AFTER (correct)
describe('Sessions Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia()); // Inside beforeEach - GOOD
    // ... rest of setup
  });
});
```

---

## Category 3: Store Method Name Mismatch (Multiple tests)

### Affected Files
- `src/views/SessionDetailView.navigation.test.js`
- `src/views/SessionDetailView.state.test.js`
- `src/views/SessionDetailView.api.test.js`

### Root Cause
The tests mock the sessions store expecting methods that don't exist or have different names:
- Tests expect `sessions.loadSession` but the actual store has `fetchSession`
- Tests expect `api.sendMessage` as a direct mock but it's called through the store

### Error Messages
```
sessions.loadSession is not a function
api.sendMessage is not a function
```

### Fix
Update the store mock to use the correct method names:

```javascript
// BEFORE (incorrect)
const mockSessionsStore = {
  loadSession: vi.fn(), // Wrong name
};

// AFTER (correct)
const mockSessionsStore = {
  fetchSession: vi.fn().mockResolvedValue(undefined),
  fetchMessages: vi.fn().mockResolvedValue(undefined),
  fetchConversations: vi.fn().mockResolvedValue(undefined),
  fetchWorkLogs: vi.fn().mockResolvedValue(undefined),
  // ... other methods
};
```

---

## Category 4: Incomplete Store Mocks (Multiple tests)

### Affected Files
- `src/views/SessionListView.test.js` (some tests)
- Various SessionDetailView test files

### Root Cause
Store mocks are missing required properties or the mock setup doesn't properly initialize before tests run.

### Fix
Ensure all store mocks return objects with all required properties:

```javascript
const mockSessionsStore = {
  // State
  loading: false,
  error: null,
  currentSession: null,
  sessions: [],
  archivedSessions: [],

  // Actions
  fetchSession: vi.fn(),
  fetchMessages: vi.fn(),
  fetchSessions: vi.fn(),
  // ... etc

  // Getters (if needed)
  getSessionById: vi.fn(() => () => null),
};
```

---

## Implementation Order

### Phase 1: Quick Fixes (Highest Impact)
1. **Fix ChangesTab.test.js** - Add `getSessionDefaultBranch` mock
   - Fixes: 21 tests
   - Effort: Low (single line addition)

### Phase 2: Store Setup Fixes
2. **Fix sessions.test.js** - Move Pinia setup to beforeEach
   - Effort: Low

3. **Fix projects.test.js** - Move Pinia setup to beforeEach
   - Effort: Low

### Phase 3: Method Name Corrections
4. **Fix SessionDetailView.*.test.js files** - Update mock method names
   - `SessionDetailView.navigation.test.js`
   - `SessionDetailView.state.test.js`
   - `SessionDetailView.api.test.js`
   - Effort: Medium (need to verify all method names)

---

## Verification Steps

After each fix:
```bash
# Run specific test file
yarn workspace @claudetools/web test src/components/ChangesTab.test.js

# Run all tests to verify no regressions
yarn workspace @claudetools/web test
```

---

## Notes

- The working test files (like `SessionDetailView.test.js`) can serve as reference implementations for correct mocking patterns
- The `useApi.js` composable re-exports `api` from `../api/index.js`, so tests can mock either path
- Some tests are intentionally skipped (`ConversationTab.test.js`, `FileAttachment.test.js`) - these should remain skipped
