# Agent Call Logs UI - Updated Implementation Plan

## Review Summary: Issues Found in Original Plan

### Issue 1 (Bug) - `complete()` fix is more involved than described

The plan's Step 1d correctly identifies that `complete()` on line 79 computes `totalTokens` as only `(inputTokens || 0) + (outputTokens || 0)`, omitting thinking/cache tokens. However, the plan's fix has a **cascading problem**:

- **The plan says** to add `thinkingTokens` to the `complete()` method signature.
- **But the caller** (`agentCallLogger.completeCall()` at line 51-58 of `agentCallLogger.js`) does **not** pass `thinkingTokens` in the usage object it forwards to `complete()`. It only passes: `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`.
- **The upstream caller** (`LoggingAgentWrapper.js` line 53) calls `completeCall(callId, { success: true })` with **no usage at all** on success, meaning the final `complete()` call gets `undefined` for all token values and relies on `COALESCE(?, input_tokens)` to preserve previously-streamed values.
- **Fix required**: Since `complete()` already gets undefined tokens (preserved via COALESCE), the `totalTokens` computation should read the **current DB values** instead of recomputing from the parameters. The correct fix is:
  ```js
  const currentRow = this.db.prepare('SELECT input_tokens, output_tokens, thinking_tokens, cache_read_tokens, cache_write_tokens FROM agent_call_logs WHERE id = ?').get(id);
  // After COALESCE updates:
  const finalInput = inputTokens ?? currentRow?.input_tokens ?? 0;
  const finalOutput = outputTokens ?? currentRow?.output_tokens ?? 0;
  const finalThinking = currentRow?.thinking_tokens ?? 0;  // not passed to complete()
  const finalCacheRead = cacheReadTokens ?? currentRow?.cache_read_tokens ?? 0;
  const finalCacheWrite = cacheWriteTokens ?? currentRow?.cache_write_tokens ?? 0;
  const totalTokens = finalInput + finalOutput + finalThinking + finalCacheRead + finalCacheWrite;
  ```
  Note: We already fetch `started_at` on line 77, so we can combine into a single SELECT to avoid an extra DB round-trip.

### Issue 2 (Omission) - `completeCall()` service method doesn't forward `thinkingTokens`

Even though `usage` from the caller may contain `thinkingTokens`, the `completeCall()` method in `agentCallLogger.js` (line 51-58) doesn't forward it:
```js
completeCall(callId, { success, usage, error }) {
    agentCallLogs.complete(callId, {
      success,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      // Missing: thinkingTokens: usage?.thinkingTokens,
      cacheReadTokens: usage?.cacheReadInputTokens,
      cacheWriteTokens: usage?.cacheCreationInputTokens,
      errorMessage: error?.message,
    });
```
This must be fixed if we want `complete()` to also persist `thinking_tokens`. However, the actual call site (`LoggingAgentWrapper.js:53`) doesn't pass usage at all on success (`{ success: true }`), so `thinking_tokens` is only set via `updateUsage()` during streaming, which already works correctly. **The plan should clarify that the `totalTokens` fix needs to read existing DB values rather than expecting all token types as parameters.**

### Issue 3 (Incorrect assumption) - `metrics.js` import pattern

The plan (Step 3a) says to call `agentCallLogger.getAll(filters)` through the service layer. But the existing `metrics.js` **also imports `agentCallLogs` directly** from `../database.js` (line 3) and uses it directly for the `/sessions/:sessionId/agent-calls` endpoint (line 18). The plan should be consistent: either both new endpoints go through the service layer, or one can go direct. The plan correctly specifies adding delegate methods to the service, which is the cleaner pattern - just noting that the existing code is mixed.

### Issue 4 (Missing detail) - `metrics.test.js` import pattern

The existing `metrics.test.js` imports from `'../db/index.js'` (line 4), NOT from `'../database.js'`. The plan's test section should specify this import source to match the existing pattern:
```js
import { projects, sessions, agentCallLogs } from '../db/index.js';
```

### Issue 5 (Missing detail) - Session creation in tests

The existing `metrics.test.js` creates sessions using `sessions.create(projectId, 'Test session', 'hello', 'standard')` (4 args). The existing `AgentCallLogRepository.test.js` creates sessions via raw SQL INSERT. The plan's test cases should specify which pattern to follow for consistency. The `metrics.test.js` pattern (using the repository) is cleaner.

### Issue 6 (Ambiguity) - `activeFilters` computed property not defined

The store plan references `this.activeFilters` in `fetchLogs()` but never defines it. This should be a getter:
```js
activeFilters: (state) => {
  const active = {};
  for (const [key, value] of Object.entries(state.filters)) {
    if (value != null) active[key] = value;
  }
  return active;
},
```

### Issue 7 (Style) - `bg-gray-750` doesn't exist in Tailwind

The styling section references `bg-gray-750` for alternating table rows. This is not a standard Tailwind class. Use `even:bg-gray-800/50` or `odd:bg-gray-850` with a custom color, or just `even:bg-gray-800 odd:bg-gray-900`.

### Issue 8 (Missing) - `SessionRepository` JOIN assumption

The plan says `getAll()` should LEFT JOIN with the `sessions` table to get `session_name`. Need to verify the sessions table column name. The sessions table uses column `name` (not `session_name`), so the JOIN should be:
```sql
LEFT JOIN sessions s ON acl.session_id = s.id
```
And select `s.name AS session_name`.

### Issue 9 (Missing) - No `activeFilters` getter in store spec

The store tests reference `fetchLogs()` calling the API with correct params including "only non-null filters", but don't test the `activeFilters` getter that produces this. Add a test case.

### Issue 10 (Incomplete) - `fetchFilterOptions()` stub in store

The store code for `fetchFilterOptions()` just says `/* calls api.getAgentCallFilterOptions() */`. This should be fully specified since it has error handling implications.

---

## Updated Plan

### 1. Backend: Fix `total_tokens` Computation in `complete()`

**File:** `packages/server/src/db/AgentCallLogRepository.js`

The existing `complete()` method computes `totalTokens` incorrectly (only input + output). Fix to read current DB values and compute the true total including all token types:

```js
complete(id, { success, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, errorMessage }) {
    const now = Date.now();
    const row = this.db.prepare(
      'SELECT started_at, input_tokens, output_tokens, thinking_tokens, cache_read_tokens, cache_write_tokens FROM agent_call_logs WHERE id = ?'
    ).get(id);
    const durationMs = row ? now - row.started_at : null;

    // Compute totalTokens using passed values (if provided) or existing DB values
    const finalInput = inputTokens ?? row?.input_tokens ?? 0;
    const finalOutput = outputTokens ?? row?.output_tokens ?? 0;
    const finalThinking = row?.thinking_tokens ?? 0; // only set via updateUsage()
    const finalCacheRead = cacheReadTokens ?? row?.cache_read_tokens ?? 0;
    const finalCacheWrite = cacheWriteTokens ?? row?.cache_write_tokens ?? 0;
    const totalTokens = finalInput + finalOutput + finalThinking + finalCacheRead + finalCacheWrite;

    // ... rest of UPDATE unchanged
}
```

**Key insight:** We do NOT need to add `thinkingTokens` to `complete()`'s signature because:
1. `thinkingTokens` is already set during streaming via `updateUsage()`
2. `LoggingAgentWrapper` calls `completeCall()` without usage data
3. Reading from DB handles this correctly

**Also update the existing test** in `AgentCallLogRepository.test.js` for `complete()` with success. The current test expects `totalTokens` to be 1500 (1000 + 500). After the fix, if thinking/cache tokens were set via `updateUsage()` beforehand, they'd be included. Add a test that calls `updateUsage()` before `complete()` and verifies total includes all token types.

### 2. Backend: Add Database Indexes

**File:** `packages/server/src/db/DatabaseManager.js` (in `#runMigrations()`, after the existing agent_call_logs block around line 509)

```sql
CREATE INDEX IF NOT EXISTS idx_agent_call_logs_agent_type ON agent_call_logs(agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_call_logs_call_type ON agent_call_logs(call_type);
CREATE INDEX IF NOT EXISTS idx_agent_call_logs_status ON agent_call_logs(status);
CREATE INDEX IF NOT EXISTS idx_agent_call_logs_model ON agent_call_logs(model);
```

### 3. Backend: Repository Method `getAll()`

**File:** `packages/server/src/db/AgentCallLogRepository.js`

```js
getAll({ limit = 25, offset = 0, agentType, callType, status, startDate, endDate, sessionId, model, sortBy = 'started_at', sortOrder = 'DESC' } = {}) {
    const SORTABLE_COLUMNS = ['started_at', 'status', 'agent_type', 'call_type', 'model', 'total_tokens', 'duration_ms'];
    const safeSortBy = SORTABLE_COLUMNS.includes(sortBy) ? sortBy : 'started_at';
    const safeSortOrder = sortOrder === 'ASC' ? 'ASC' : 'DESC';

    const conditions = [];
    const params = [];

    if (agentType) { conditions.push('acl.agent_type = ?'); params.push(agentType); }
    if (callType) { conditions.push('acl.call_type = ?'); params.push(callType); }
    if (status) { conditions.push('acl.status = ?'); params.push(status); }
    if (model) { conditions.push('acl.model = ?'); params.push(model); }
    if (sessionId) { conditions.push('acl.session_id = ?'); params.push(sessionId); }
    if (startDate) { conditions.push('acl.started_at >= ?'); params.push(startDate); }
    if (endDate) { conditions.push('acl.started_at <= ?'); params.push(endDate); }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const countRow = this.db.prepare(
      `SELECT COUNT(*) as count FROM agent_call_logs acl ${whereClause}`
    ).get(...params);
    const total = countRow.count;

    const rows = this.db.prepare(
      `SELECT acl.*, s.name AS session_name
       FROM agent_call_logs acl
       LEFT JOIN sessions s ON acl.session_id = s.id
       ${whereClause}
       ORDER BY acl.${safeSortBy} ${safeSortOrder}
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    // Use dedicated mapper that includes sessionName
    const mappedRows = rows.map(row => {
      const mapped = mapRow(row);
      if (mapped) mapped.sessionName = row.session_name || null;
      return mapped;
    }).filter(Boolean);

    return { rows: mappedRows, total };
}
```

### 4. Backend: Repository Method `getFilterOptions()`

**File:** `packages/server/src/db/AgentCallLogRepository.js`

```js
getFilterOptions() {
    const agentTypes = this.db.prepare('SELECT DISTINCT agent_type FROM agent_call_logs WHERE agent_type IS NOT NULL ORDER BY agent_type').all().map(r => r.agent_type);
    const callTypes = this.db.prepare('SELECT DISTINCT call_type FROM agent_call_logs WHERE call_type IS NOT NULL ORDER BY call_type').all().map(r => r.call_type);
    const statuses = this.db.prepare('SELECT DISTINCT status FROM agent_call_logs WHERE status IS NOT NULL ORDER BY status').all().map(r => r.status);
    const models = this.db.prepare('SELECT DISTINCT model FROM agent_call_logs WHERE model IS NOT NULL ORDER BY model').all().map(r => r.model);
    return { agentTypes, callTypes, statuses, models };
}
```

### 5. Backend: Service Layer Delegates

**File:** `packages/server/src/services/agentCallLogger.js`

Add two delegate methods to the `AgentCallLogger` class:

```js
getAll(filters) {
    return agentCallLogs.getAll(filters);
}

getFilterOptions() {
    return agentCallLogs.getFilterOptions();
}
```

### 6. Backend: API Endpoints

**File:** `packages/server/src/api/metrics.js`

Add two new endpoints. Note: existing `metrics.js` imports both `agentCallLogger` (service) and `agentCallLogs` (repository directly). New endpoints should use the service layer for consistency.

#### `GET /api/agent-calls`

```js
router.get('/agent-calls', (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 25;
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;
    const startDate = req.query.startDate ? parseInt(req.query.startDate) : undefined;
    const endDate = req.query.endDate ? parseInt(req.query.endDate) : undefined;

    const result = agentCallLogger.getAll({
      limit, offset,
      agentType: req.query.agentType,
      callType: req.query.callType,
      status: req.query.status,
      model: req.query.model,
      sessionId: req.query.sessionId,
      startDate, endDate,
      sortBy: req.query.sortBy,
      sortOrder: req.query.sortOrder,
    });

    res.json({
      logs: result.rows,
      pagination: {
        total: result.total,
        limit,
        offset,
        hasMore: offset + limit < result.total,
      },
    });
  } catch (err) {
    console.error('Failed to get agent call logs:', err);
    res.status(500).json({ error: 'Failed to get agent call logs' });
  }
});
```

#### `GET /api/agent-calls/filter-options`

```js
router.get('/agent-calls/filter-options', (req, res) => {
  try {
    const options = agentCallLogger.getFilterOptions();
    res.json(options);
  } catch (err) {
    console.error('Failed to get filter options:', err);
    res.status(500).json({ error: 'Failed to get filter options' });
  }
});
```

**Important:** The `/agent-calls/filter-options` route must be registered BEFORE any `/agent-calls/:id` pattern route (if one existed) to avoid path conflicts. In this case there's no conflict, but register `filter-options` first as a best practice.

### 7. Frontend: API Client Methods

**File:** `packages/web/src/api/ApiClient.js`

Add two methods to the `ApiClient` class:

```js
async getAgentCallLogs({ limit, offset, agentType, callType, status, startDate, endDate, sessionId, model, sortBy, sortOrder } = {}) {
    const params = new URLSearchParams();
    if (limit != null) params.append('limit', limit);
    if (offset != null) params.append('offset', offset);
    if (agentType) params.append('agentType', agentType);
    if (callType) params.append('callType', callType);
    if (status) params.append('status', status);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (sessionId) params.append('sessionId', sessionId);
    if (model) params.append('model', model);
    if (sortBy) params.append('sortBy', sortBy);
    if (sortOrder) params.append('sortOrder', sortOrder);
    const query = params.toString();
    return this.#request('GET', `/agent-calls${query ? '?' + query : ''}`);
}

async getAgentCallFilterOptions() {
    return this.#request('GET', '/agent-calls/filter-options');
}
```

### 8. Frontend: Pinia Store

**New File:** `packages/web/src/stores/agentLogs.js`

Import `api` from `'../composables/useApi.js'` (confirmed: this matches settings.js pattern and exports from `'../api/index.js'`).

```js
import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

export const useAgentLogsStore = defineStore('agentLogs', {
  state: () => ({
    logs: [],
    pagination: { total: 0, limit: 25, offset: 0, hasMore: false },
    filters: {
      agentType: null,
      callType: null,
      status: null,
      model: null,
      startDate: null,
      endDate: null,
      sessionId: null,
    },
    filterOptions: {
      agentTypes: [],
      callTypes: [],
      statuses: [],
      models: [],
    },
    perPage: 25,
    currentPage: 1,
    sortBy: 'started_at',
    sortOrder: 'DESC',
    loading: false,
    error: null,
  }),

  getters: {
    totalPages: (state) => Math.ceil(state.pagination.total / state.perPage) || 0,
    activeFilters: (state) => {
      const active = {};
      for (const [key, value] of Object.entries(state.filters)) {
        if (value != null) active[key] = value;
      }
      return active;
    },
  },

  actions: {
    async fetchLogs() {
      this.loading = true;
      this.error = null;
      try {
        const offset = (this.currentPage - 1) * this.perPage;
        const result = await api.getAgentCallLogs({
          limit: this.perPage,
          offset,
          ...this.activeFilters,
          sortBy: this.sortBy,
          sortOrder: this.sortOrder,
        });
        this.logs = result.logs;
        this.pagination = result.pagination;
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },

    async fetchFilterOptions() {
      try {
        const options = await api.getAgentCallFilterOptions();
        this.filterOptions = options;
      } catch (err) {
        console.error('Failed to fetch filter options:', err);
        // Silently fail - dropdowns will just be empty
      }
    },

    setFilter(key, value) {
      this.filters[key] = value || null;
      this.currentPage = 1;
      this.fetchLogs();
    },

    clearFilters() {
      Object.keys(this.filters).forEach(k => this.filters[k] = null);
      this.currentPage = 1;
      this.fetchLogs();
    },

    setPage(page) {
      this.currentPage = page;
      this.fetchLogs();
    },

    setPerPage(perPage) {
      this.perPage = perPage;
      this.currentPage = 1;
      this.fetchLogs();
    },

    setSort(sortBy, sortOrder) {
      this.sortBy = sortBy;
      this.sortOrder = sortOrder;
      this.currentPage = 1;
      this.fetchLogs();
    },
  },
});
```

### 9. Frontend: Router

**File:** `packages/web/src/router.js`

Add to the `children` array of the `/settings` route (after `general` at line 93):

```js
{
  path: 'logs',
  name: 'AgentLogs',
  component: () => import('./views/AgentLogsView.vue'),
},
```

### 10. Frontend: Settings Tab

**File:** `packages/web/src/views/SettingsView.vue`

Add after the existing "Settings" tab (line 26):

```html
<router-link
  to="/settings/logs"
  class="tab"
  :class="{ active: $route.path === '/settings/logs' }"
>
  Logs
</router-link>
```

### 11. Frontend: AgentLogsView Component

**New File:** `packages/web/src/views/AgentLogsView.vue`

Composed of three sections:

#### Filter Bar
- Horizontal bar with: Date Range (two `<input type="date">`), Agent Type `<select>`, Call Type `<select>`, Status `<select>` (with colored dot indicators), Model `<select>`, Clear Filters button (shown only when filters active)
- All dropdowns populated from `filterOptions` via `fetchFilterOptions()` on mount
- Each dropdown has an "All" option that clears that filter

#### Log Table
| Column | Content | Sortable? |
|--------|---------|-----------|
| Status | Colored dot + text | Yes |
| Agent Type | e.g. "claude-code" | Yes |
| Call Type | e.g. "runSession" | Yes |
| Model | e.g. "claude-sonnet-4-20250514" | Yes |
| Session | Session name (link to `/sessions/:id`) | No |
| Tokens | Total (tooltip: input/output/thinking/cache-read/cache-write) | Yes |
| Duration | Human-readable (e.g. "2.3s", "1m 45s") | Yes |
| Started | Relative time + tooltip for absolute | Yes (default DESC) |

- Empty state: "No agent call logs found."
- Error state: Red banner with retry button
- Loading state: Spinner overlay

#### Pagination Bar
- Per-page dropdown (10, 25, 50, 100)
- "Showing X-Y of Z logs" text
- First/Prev/Page numbers (max 5 with ellipsis)/Next/Last buttons

### 12. Styling

Follow dark-mode Tailwind conventions:
- Table: `bg-gray-800` rows, `even:bg-gray-800/50` alternating, `border-gray-700`
- Status dots: `bg-emerald-400` (completed), `bg-red-400` (error), `bg-amber-400` (pending/streaming)
- Filter bar: `bg-gray-800` card, rounded, subtle border
- Responsive: `overflow-x-auto` for mobile table scrolling

---

## 13. Testing

### 13a. Repository Tests

**File:** `packages/server/src/db/AgentCallLogRepository.test.js`

**Update existing `describe('complete')`:**

| # | Test | Details |
|---|------|---------|
| 1 | `totalTokens` includes all token types when `updateUsage()` called before `complete()` | Call `updateUsage()` with thinkingTokens=200, cacheRead=300, cacheWrite=100, then `complete()` with inputTokens=1000, outputTokens=500. Assert `totalTokens` = 1000+500+200+300+100 = 2100 |
| 2 | `totalTokens` uses existing DB values when `complete()` params are undefined | Call `updateUsage()` first, then `complete()` with `success: true` and no token params. Assert totalTokens includes the updateUsage values |

**New `describe('getAll')`:**

| # | Test | Details |
|---|------|---------|
| 1 | returns `{ rows, total }` shape | Create 1 entry, call `getAll()`, assert `result.rows` is array, `result.total` is number |
| 2 | returns correct `total` even with limit/offset | Create 10 entries, `getAll({ limit: 3, offset: 2 })`, assert `total` = 10, `rows.length` = 3 |
| 3 | filters by `agentType` | Create entries with types 'claude-code' and 'other', filter `agentType: 'claude-code'`, assert only matching returned |
| 4 | filters by `callType` | Create 'runSession' and 'continueSession', filter to one |
| 5 | filters by `status` | Create completed + error entries, filter to completed only |
| 6 | filters by `model` | Create entries with different models, filter to one |
| 7 | filters by date range | Create entries, use future startDate to get empty results |
| 8 | filters by `sessionId` | Create entries across 2 sessions, filter to one |
| 9 | combines multiple filters | Apply agentType + status together |
| 10 | sorts by `total_tokens ASC` | Create entries with different token counts, verify ascending order |
| 11 | sorts by `duration_ms DESC` | Similar to above |
| 12 | defaults to `started_at DESC` | Omit sortBy/sortOrder, verify default |
| 13 | rejects invalid `sortBy` by falling back to default | Pass `sortBy: 'DROP TABLE'`, verify it uses `started_at` and returns 200-equivalent results |
| 14 | includes `sessionName` from joined sessions table | Create entry with a named session, verify `sessionName` in result |
| 15 | returns `{ rows: [], total: 0 }` when no data | Call `getAll()` with empty DB |

**New `describe('getFilterOptions')`:**

| # | Test | Details |
|---|------|---------|
| 1 | returns distinct values from actual data | Create entries with varied types, verify distinct lists |
| 2 | returns empty arrays when no data | `{ agentTypes: [], callTypes: [], statuses: [], models: [] }` |
| 3 | excludes NULL values | Create entry with `model: null`, verify not in models list |

### 13b. API Route Tests

**File:** `packages/server/src/api/metrics.test.js`

Import pattern (matches existing): `import { projects, sessions, agentCallLogs } from '../db/index.js';`

Session creation pattern (matches existing): `sessions.create(projectId, 'Test session', 'hello', 'standard')`

**New `describe('GET /api/agent-calls')`:**

| # | Test | Details |
|---|------|---------|
| 1 | returns `{ logs, pagination }` shape | Verify top-level keys + pagination sub-keys (total, limit, offset, hasMore) |
| 2 | returns empty logs with correct pagination when no data | `{ logs: [], pagination: { total: 0, limit: 25, offset: 0, hasMore: false } }` |
| 3 | respects `limit` and `offset` | Create 5 entries, request `?limit=2&offset=1` |
| 4 | filters by `agentType` | Create mixed entries, filter via query param |
| 5 | filters by `callType` | Same pattern |
| 6 | filters by `status` | Same pattern |
| 7 | filters by `model` | Same pattern |
| 8 | filters by `startDate` and `endDate` | Use date ranges |
| 9 | defaults to `started_at DESC` sort | Verify order without sort params |
| 10 | accepts valid `sortBy` and `sortOrder` | `?sortBy=total_tokens&sortOrder=ASC` |
| 11 | rejects invalid `sortBy` gracefully | Pass `?sortBy=malicious`, verify 200 + valid results |
| 12 | includes `sessionName` in log entries | Verify present in response |
| 13 | returns `hasMore: true` when more pages exist | Create 30 entries, default limit 25, verify hasMore |

**New `describe('GET /api/agent-calls/filter-options')`:**

| # | Test | Details |
|---|------|---------|
| 1 | returns distinct values | Create entries, verify response shape |
| 2 | returns empty arrays when no data | All arrays empty |
| 3 | returns 500 on server failure | Would need mock; optional - can skip if too complex with supertest+real DB |

### 13c. Store Tests

**New File:** `packages/web/src/stores/agentLogs.test.js`

Mock pattern (confirmed matches `settings.test.js`):
```js
vi.mock('../composables/useApi.js', () => ({
  api: {
    getAgentCallLogs: vi.fn(),
    getAgentCallFilterOptions: vi.fn(),
  },
}));
import { api } from '../composables/useApi.js';
```

| # | Test | Details |
|---|------|---------|
| 1 | has correct initial state | Empty logs, default pagination, null filters, perPage=25, page=1, sortBy='started_at', sortOrder='DESC' |
| 2 | `fetchLogs()` calls API with correct params | Mock API, verify limit, offset=(page-1)*perPage, active filters, sortBy, sortOrder |
| 3 | `fetchLogs()` updates logs and pagination state | Mock API with data, verify state updated |
| 4 | `fetchLogs()` sets loading=true during fetch | Capture loading in mock implementation |
| 5 | `fetchLogs()` sets loading=false after completion | Verify loading false after await |
| 6 | `fetchLogs()` handles errors gracefully | Mock rejection, verify error set, loading=false, logs unchanged |
| 7 | `fetchLogs()` clears error on success after previous error | Set error, then succeed, verify error=null |
| 8 | `fetchFilterOptions()` populates filterOptions | Mock API, verify state |
| 9 | `fetchFilterOptions()` handles errors silently | Mock rejection, verify filterOptions unchanged |
| 10 | `setFilter()` updates specific filter and resets page to 1 | Set currentPage=3 first, then setFilter, verify page=1 |
| 11 | `setFilter()` triggers `fetchLogs()` | Spy on fetchLogs |
| 12 | `setFilter()` with falsy value sets to null | `setFilter('agentType', '')` => null |
| 13 | `clearFilters()` resets all filters to null | Set multiple, clear, verify all null |
| 14 | `clearFilters()` resets to page 1 and triggers fetch | Verify |
| 15 | `setPage()` updates currentPage and triggers fetch | Set page 3 |
| 16 | `setPerPage()` updates perPage, resets page 1, triggers fetch | Change to 50 |
| 17 | `setSort()` updates sortBy/sortOrder, resets page 1 | Change sort |
| 18 | `totalPages` getter computes correctly | total=100, perPage=25 => 4 |
| 19 | `totalPages` returns 0 when total is 0 | Verify |
| 20 | `activeFilters` getter returns only non-null filters | Set 2 of 7 filters, verify only those 2 returned |
| 21 | `activeFilters` returns empty object when no filters set | Verify `{}` |

---

## 14. Implementation Order

1. Fix `total_tokens` computation in `AgentCallLogRepository.complete()` (Step 1) + add complete() tests
2. Add database indexes (Step 2)
3. Add `getAll()` and `getFilterOptions()` repository methods (Steps 3-4)
4. Add repository tests for `getAll()` and `getFilterOptions()` (Step 13a)
5. Add service delegate methods (Step 5)
6. Add API endpoints (Step 6)
7. Add API route tests (Step 13b)
8. Add ApiClient methods (Step 7)
9. Create Pinia store (Step 8)
10. Create store tests (Step 13c)
11. Add router config (Step 9)
12. Add Settings tab link (Step 10)
13. Build AgentLogsView component (Step 11)
14. Run full test suite (`yarn test`) and manual smoke test

---

## 15. Files Created / Modified

### New Files
| File | Purpose |
|------|---------|
| `packages/web/src/views/AgentLogsView.vue` | Logs tab view with filters, table, pagination |
| `packages/web/src/stores/agentLogs.js` | Pinia store for log data |
| `packages/web/src/stores/agentLogs.test.js` | Store unit tests (~21 cases) |

### Modified Files
| File | Changes |
|------|---------|
| `packages/server/src/db/AgentCallLogRepository.js` | Fix `complete()` totalTokens, add `getAll()`, add `getFilterOptions()` |
| `packages/server/src/db/AgentCallLogRepository.test.js` | Update `complete()` tests, add ~18 test cases for new methods |
| `packages/server/src/db/DatabaseManager.js` | Add 4 indexes on filter columns |
| `packages/server/src/services/agentCallLogger.js` | Add `getAll()` and `getFilterOptions()` delegates |
| `packages/server/src/api/metrics.js` | Add 2 new endpoints with error handling |
| `packages/server/src/api/metrics.test.js` | Add ~16 test cases for new endpoints |
| `packages/web/src/api/ApiClient.js` | Add `getAgentCallLogs()` and `getAgentCallFilterOptions()` |
| `packages/web/src/router.js` | Add `/settings/logs` child route |
| `packages/web/src/views/SettingsView.vue` | Add "Logs" tab link |
