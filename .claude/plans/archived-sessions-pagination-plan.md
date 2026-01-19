# Archived Sessions Pagination Plan

## Overview
Implement pagination for the archived sessions list with 25 sessions per page.

---

## Current Architecture

### Data Flow
```
SessionListView.vue → sessions.js store → ApiClient.js → projects.js API → SessionRepository.js
```

### Current Behavior
- `sessionsStore.fetchArchivedSessions(projectId)` loads ALL archived sessions at once
- No pagination support exists in the current implementation

---

## Implementation Plan

### Phase 1: Backend Changes

#### 1.1 SessionRepository.js
**File:** `packages/server/src/db/SessionRepository.js`

Add pagination support to `getByProjectId()`:

```js
getByProjectId(projectId, { archived = null, starred = null, limit = null, offset = 0 } = {}) {
  // ... existing WHERE clause logic ...

  // Add LIMIT/OFFSET for pagination
  if (limit !== null) {
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);
  }

  const rows = this.db.prepare(sql).all(...params);
  return this.mapAll(rows);
}
```

Add new method for counting total archived sessions:

```js
getCountByProjectId(projectId, { archived = null, starred = null } = {}) {
  let sql = `SELECT COUNT(*) as count FROM sessions WHERE project_id = ?`;
  const params = [projectId];

  if (archived !== null) {
    sql += ` AND archived = ?`;
    params.push(archived ? 1 : 0);
  }

  if (starred !== null) {
    sql += ` AND starred = ?`;
    params.push(starred ? 1 : 0);
  }

  return this.db.prepare(sql).get(...params).count;
}
```

#### 1.2 Projects API Route
**File:** `packages/server/src/api/projects.js`

Modify GET `/api/projects/:id/sessions` endpoint:

```js
// Add query params: ?limit=25&offset=0
const { archived, starred, limit, offset } = req.query;

// Parse pagination params
const parsedLimit = limit ? parseInt(limit, 10) : null;
const parsedOffset = offset ? parseInt(offset, 10) : 0;

// Get paginated sessions
const projectSessions = sessions.getByProjectId(req.params.id, {
  archived: archivedFilter,
  starred: starredFilter,
  limit: parsedLimit,
  offset: parsedOffset
});

// Get total count for pagination (only when limit is specified)
let total = null;
if (parsedLimit !== null) {
  total = sessions.getCountByProjectId(req.params.id, {
    archived: archivedFilter,
    starred: starredFilter
  });
}

// Return response with pagination metadata
res.json({
  sessions: sessionsWithRuns,
  pagination: parsedLimit !== null ? {
    total,
    limit: parsedLimit,
    offset: parsedOffset,
    hasMore: parsedOffset + projectSessions.length < total
  } : null
});
```

---

### Phase 2: Frontend API Client

#### 2.1 ApiClient.js
**File:** `packages/web/src/api/ApiClient.js`

Update `getProjectSessions()` method:

```js
async getProjectSessions(projectId, archived = null, starred = null, { limit = null, offset = 0 } = {}) {
  let path = `/projects/${projectId}/sessions`;
  const params = new URLSearchParams();

  if (archived !== null) params.append('archived', archived);
  if (starred === 'starred') params.append('starred', true);
  else if (starred === 'unstarred') params.append('starred', false);

  // Add pagination params
  if (limit !== null) {
    params.append('limit', limit);
    params.append('offset', offset);
  }

  const query = params.toString();
  if (query) path += `?${query}`;

  return this.#request('GET', path);
}
```

---

### Phase 3: Frontend Store

#### 3.1 sessions.js Store
**File:** `packages/web/src/stores/sessions.js`

Add pagination state:

```js
state: () => ({
  // ... existing state ...
  archivedSessions: [],
  archivedPagination: {
    total: 0,
    offset: 0,
    hasMore: false,
    loading: false
  },
}),
```

Update `fetchArchivedSessions` action:

```js
async fetchArchivedSessions(projectId, { reset = true } = {}) {
  const PAGE_SIZE = 25;

  if (reset) {
    this.archivedSessions = [];
    this.archivedPagination.offset = 0;
  }

  this.archivedPagination.loading = true;
  this.error = null;

  try {
    const response = await api.getProjectSessions(
      projectId,
      true, // archived
      this.starredFilter,
      { limit: PAGE_SIZE, offset: this.archivedPagination.offset }
    );

    if (reset) {
      this.archivedSessions = response.sessions;
    } else {
      this.archivedSessions = [...this.archivedSessions, ...response.sessions];
    }

    this.archivedPagination = {
      total: response.pagination.total,
      offset: this.archivedPagination.offset + response.sessions.length,
      hasMore: response.pagination.hasMore,
      loading: false
    };
  } catch (err) {
    this.error = err.message;
    this.archivedPagination.loading = false;
  }
},

async loadMoreArchivedSessions(projectId) {
  if (this.archivedPagination.hasMore && !this.archivedPagination.loading) {
    await this.fetchArchivedSessions(projectId, { reset: false });
  }
}
```

---

### Phase 4: Frontend UI

#### 4.1 SessionListView.vue
**File:** `packages/web/src/views/SessionListView.vue`

Add "Load More" button at the bottom of the archived sessions list:

```vue
<!-- Archived Tab -->
<div v-if="activeTab === 'archived'">
  <!-- ... existing loading/error/empty states ... -->

  <div v-else class="session-list">
    <SessionCard
      v-for="session in sessionsStore.archivedSessions"
      :key="session.id"
      :session="session"
      <!-- ... other props ... -->
    />

    <!-- Load More Button -->
    <div v-if="sessionsStore.archivedPagination.hasMore" class="load-more-container">
      <button
        class="btn btn-secondary"
        :disabled="sessionsStore.archivedPagination.loading"
        @click="loadMoreArchived"
      >
        <span v-if="sessionsStore.archivedPagination.loading">Loading...</span>
        <span v-else>Load More ({{ archivedRemaining }} remaining)</span>
      </button>
    </div>
  </div>
</div>
```

Add computed property and method:

```js
const archivedRemaining = computed(() => {
  const { total, offset } = sessionsStore.archivedPagination;
  return Math.max(0, total - offset);
});

async function loadMoreArchived() {
  await sessionsStore.loadMoreArchivedSessions(projectId.value);
  fetchArchivedSummaries(); // Fetch summaries for newly loaded sessions
}
```

Add CSS for load more button:

```css
.load-more-container {
  display: flex;
  justify-content: center;
  padding: 1.5rem;
}
```

---

## Testing Considerations

1. **Unit Tests**
   - `SessionRepository.test.js`: Test pagination parameters
   - `sessions.test.js`: Test paginated fetch and load more

2. **API Tests**
   - `projects.test.js`: Test pagination query params and response format

3. **Manual Testing**
   - Verify 25 items per page
   - Test "Load More" button functionality
   - Test starred filter with pagination
   - Test empty state (no archived sessions)
   - Test boundary case (exactly 25 archived sessions)

---

## Migration Notes

- **Backward Compatibility**: The API remains backward compatible - if no `limit` param is passed, all sessions are returned (existing behavior)
- **Active Sessions**: This change only affects archived sessions; active sessions list continues to load all at once (typically smaller)

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/server/src/db/SessionRepository.js` | Add pagination params, add count method |
| `packages/server/src/api/projects.js` | Parse pagination query params, return pagination metadata |
| `packages/web/src/api/ApiClient.js` | Add pagination params to `getProjectSessions()` |
| `packages/web/src/stores/sessions.js` | Add pagination state, update actions |
| `packages/web/src/views/SessionListView.vue` | Add "Load More" button and logic |

---

## Estimated Effort

- Backend: ~1 hour
- Frontend API/Store: ~1 hour
- Frontend UI: ~30 minutes
- Testing: ~1 hour

**Total: ~3.5 hours**
