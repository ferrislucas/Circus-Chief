# Scheduled Sessions List Improvements Plan

## Overview
This plan outlines the changes needed to improve the scheduled sessions list feature based on the following requirements:
1. Remove the badge count from the Scheduled tab
2. Add links from each session to its detail view
3. Remove session from list when unscheduled (cancel)
4. Filter by project (only show scheduled sessions for current project)
5. Remove project name display (no longer needed with project filtering)
6. Sort by scheduled date/time, re-sort when editing

---

## 1. Remove Badge Count from Scheduled Tab

**File:** `packages/web/src/views/SessionListView.vue`

**Current Code (lines 52-58):**
```vue
<button
  class="tab"
  :class="{ active: activeTab === 'scheduled' }"
  @click="router.push(`/projects/${route.params.id}/scheduled`)"
>
  Scheduled
  <span v-if="scheduledSessions.length > 0" class="tab-badge">{{ scheduledSessions.length }}</span>
</button>
```

**Change:** Remove the `<span>` badge element showing the count.

---

## 2. Add Links to Session Detail View

**File:** `packages/web/src/components/ScheduledSessionCard.vue`

**Current Code (lines 5-6):**
```vue
<div class="session-info">
  <h3 class="session-name">{{ session.name }}</h3>
```

**Change:** Wrap the session name in a `<router-link>` to `/sessions/:id`:
```vue
<div class="session-info">
  <router-link :to="`/sessions/${session.id}`" class="session-name-link">
    <h3 class="session-name">{{ session.name }}</h3>
  </router-link>
```

Also add styles for the link hover state.

---

## 3. Remove Session from List When Unscheduled

**Analysis:** The store's `updateSession` action (lines 897-910 in sessions.js) already handles this:
```js
if (sessionData.status === 'scheduled') {
  // Add to scheduled list if not present
  ...
} else {
  // Remove from scheduled list when status changes from 'scheduled'
  this.scheduledSessions = this.scheduledSessions.filter((s) => s.id !== sessionData.id);
}
```

**Issue:** The `handleCancel` function in `ScheduledSessionCard.vue` calls `updateSessionFields` which updates via API, but the WebSocket event triggers `updateSession` in the store. This should work, but we need to verify the WebSocket is broadcasting the update.

**Files to verify:**
- `packages/server/src/api/sessions.js` - ensure PATCH updates broadcast via WebSocket

**If not working:** Add explicit removal in the cancel handler after API success:
```js
// After successful API call
sessionsStore.scheduledSessions = sessionsStore.scheduledSessions.filter(
  s => s.id !== props.session.id
);
```

---

## 4. Filter Scheduled Sessions by Project

### 4a. Server API - Already Supports Project Filter

**File:** `packages/server/src/db/SessionRepository.js`

The `getScheduledSessions(projectId = null)` method already supports filtering:
```js
getScheduledSessions(projectId = null) {
  let sql = `
    SELECT s.*, p.name as project_name
    FROM sessions s
    LEFT JOIN projects p ON s.project_id = p.id
    WHERE s.status = 'scheduled'
  `;
  const params = [];
  if (projectId) {
    sql += ' AND s.project_id = ?';
    params.push(projectId);
  }
  ...
}
```

### 4b. Server API Route - Add Query Parameter

**File:** `packages/server/src/api/sessions.js`

**Current Code (lines 26-29):**
```js
router.get('/scheduled', (req, res) => {
  const scheduledSessions = sessions.getScheduledSessions();
  res.json(scheduledSessions);
});
```

**Change to:**
```js
router.get('/scheduled', (req, res) => {
  const { projectId } = req.query;
  const scheduledSessions = sessions.getScheduledSessions(projectId || null);
  res.json(scheduledSessions);
});
```

### 4c. API Client - Add Project ID Parameter

**File:** `packages/web/src/api/ApiClient.js`

**Current Code (lines 117-119):**
```js
async getScheduledSessions() {
  return this.#request('GET', '/sessions/scheduled');
}
```

**Change to:**
```js
async getScheduledSessions(projectId = null) {
  const params = projectId ? `?projectId=${projectId}` : '';
  return this.#request('GET', `/sessions/scheduled${params}`);
}
```

### 4d. Store Action - Accept Project ID

**File:** `packages/web/src/stores/sessions.js`

**Current Code (lines 303-314):**
```js
async fetchScheduledSessions() {
  this.loadingScheduled = true;
  this.error = null;
  try {
    this.scheduledSessions = await api.getScheduledSessions();
  } catch (err) {
    ...
  }
}
```

**Change to:**
```js
async fetchScheduledSessions(projectId = null) {
  this.loadingScheduled = true;
  this.error = null;
  try {
    this.scheduledSessions = await api.getScheduledSessions(projectId);
  } catch (err) {
    ...
  }
}
```

### 4e. View - Pass Project ID When Fetching

**File:** `packages/web/src/views/SessionListView.vue`

**Current Code (line 611-613):**
```js
async function fetchScheduledSessions() {
  await sessionsStore.fetchScheduledSessions();
}
```

**Change to:**
```js
async function fetchScheduledSessions() {
  await sessionsStore.fetchScheduledSessions(projectId.value);
}
```

---

## 5. Remove Project Name Display

**File:** `packages/web/src/components/ScheduledSessionCard.vue`

**Remove (lines 7-9):**
```vue
<p class="session-project" v-if="session.projectName">
  <span class="project-name">{{ session.projectName }}</span>
</p>
```

Also remove the associated styles for `.session-project` and `.project-name`.

---

## 6. Sort by Scheduled Date/Time

### 6a. Sort When Fetching

**File:** `packages/web/src/stores/sessions.js`

After fetching, sort by `scheduledAt`:
```js
async fetchScheduledSessions(projectId = null) {
  this.loadingScheduled = true;
  this.error = null;
  try {
    const sessions = await api.getScheduledSessions(projectId);
    // Sort by scheduledAt (earliest first)
    this.scheduledSessions = sessions.sort((a, b) =>
      new Date(a.scheduledAt) - new Date(b.scheduledAt)
    );
  } catch (err) {
    ...
  }
}
```

### 6b. Re-sort When Session Updated

In the `updateSession` action, after updating a scheduled session, re-sort the list:

**Add after line 905:**
```js
if (scheduledIndex === -1) {
  this.scheduledSessions.push(sessionData);
} else {
  this.scheduledSessions[scheduledIndex] = { ...this.scheduledSessions[scheduledIndex], ...sessionData };
}
// Re-sort after update
this.scheduledSessions.sort((a, b) =>
  new Date(a.scheduledAt) - new Date(b.scheduledAt)
);
```

---

## Implementation Order

1. **Remove badge count** (SessionListView.vue) - Simple UI change
2. **Remove project name** (ScheduledSessionCard.vue) - Simple UI change
3. **Add session detail link** (ScheduledSessionCard.vue) - UI enhancement
4. **Filter by project** (4 files) - Core functionality
5. **Sort by date/time** (sessions.js store) - UX improvement
6. **Verify cancel removes from list** - May already work, verify & fix if needed

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/web/src/views/SessionListView.vue` | Remove badge, pass projectId to fetch |
| `packages/web/src/components/ScheduledSessionCard.vue` | Add link, remove project name |
| `packages/web/src/stores/sessions.js` | Add projectId param, add sorting |
| `packages/web/src/api/ApiClient.js` | Add projectId param |
| `packages/server/src/api/sessions.js` | Accept projectId query param |

---

## Testing Checklist

- [ ] Scheduled tab no longer shows badge count
- [ ] Clicking session name navigates to session detail view
- [ ] Canceling a scheduled session removes it from the list immediately
- [ ] Scheduled sessions list only shows sessions for the current project
- [ ] Project name is not displayed on scheduled session cards
- [ ] Sessions are sorted by scheduled date/time (earliest first)
- [ ] Editing a session's scheduled time re-sorts the list correctly
