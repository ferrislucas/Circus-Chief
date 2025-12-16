# Plan: Active/Waiting Sessions List View

## Overview

Create a new view that shows all sessions across all projects that are currently "active" (running, waiting, or starting). This provides users with a quick way to see all sessions that need attention without having to navigate to each project individually.

## Session Statuses Reference

- `starting` - Initial creation (ACTIVE)
- `running` - Claude is actively processing (ACTIVE)
- `waiting` - Waiting for user input (ACTIVE)
- `completed` - Session ended
- `error` - An error occurred

**Active sessions = `starting`, `running`, or `waiting` status**

---

## Implementation Steps

### 1. Backend: Add Repository Method

**File:** `packages/server/src/db/SessionRepository.js`

Add a new method to fetch all active sessions across all projects:

```javascript
getActiveAndWaiting() {
  const rows = this.db
    .prepare(
      `SELECT s.*, p.name as project_name, p.path as project_path
       FROM sessions s
       JOIN projects p ON s.project_id = p.id
       WHERE s.status IN ('starting', 'running', 'waiting')
       ORDER BY s.updated_at DESC`
    )
    .all();
  return rows.map(row => ({
    ...this.map(row),
    projectName: row.project_name,
    projectPath: row.project_path
  }));
}
```

### 2. Backend: Add API Endpoint

**File:** `packages/server/src/api/sessions.js`

Add a new route at the beginning of the router (before `/:id` routes):

```javascript
router.get('/', async (req, res) => {
  const sessions = req.sessionRepository.getActiveAndWaiting();
  res.json(sessions);
});
```

This will be accessible at `GET /api/sessions`.

### 3. Frontend: Add API Client Method

**File:** `packages/web/src/api/ApiClient.js`

Add method:

```javascript
async getActiveSessions() {
  return this.get('/sessions');
}
```

### 4. Frontend: Update Sessions Store

**File:** `packages/web/src/stores/sessions.js`

Add new state and action:

```javascript
// In state
activeSessions: []

// New action
async fetchActiveSessions() {
  this.loading = true;
  this.error = null;
  try {
    this.activeSessions = await apiClient.getActiveSessions();
  } catch (error) {
    this.error = error.message;
  } finally {
    this.loading = false;
  }
}
```

### 5. Frontend: Create New View Component

**File:** `packages/web/src/views/ActiveSessionsView.vue` (new file)

Create a view that:
- Fetches and displays all active/waiting sessions on mount
- Shows session name, project name, status, mode, and last updated time
- Links to the session detail view
- Highlights "waiting" sessions as needing user attention
- Shows empty state when no active sessions exist
- Auto-refreshes periodically (every 10 seconds) to keep status current

### 6. Frontend: Add Route

**File:** `packages/web/src/router.js`

Add new route BEFORE the `/sessions/:id/:tab?` route to avoid conflict:

```javascript
{
  path: '/sessions/active',
  name: 'ActiveSessions',
  component: () => import('./views/ActiveSessionsView.vue'),
}
```

### 7. Frontend: Add Navigation Link

**File:** `packages/web/src/App.vue`

Add a link to the active sessions view in the main navigation.

### 8. Tests

**Files to update:**
- `packages/server/src/db/SessionRepository.test.js` - Test `getActiveAndWaiting()` method

---

## Files to Modify/Create Summary

| File | Action |
|------|--------|
| `packages/server/src/db/SessionRepository.js` | Add `getActiveAndWaiting()` method |
| `packages/server/src/api/sessions.js` | Add `GET /api/sessions` route |
| `packages/web/src/api/ApiClient.js` | Add `getActiveSessions()` method |
| `packages/web/src/stores/sessions.js` | Add `activeSessions` state and fetch action |
| `packages/web/src/views/ActiveSessionsView.vue` | **Create new file** |
| `packages/web/src/router.js` | Add route for active sessions |
| `packages/web/src/App.vue` | Add navigation link |
| `packages/server/src/db/SessionRepository.test.js` | Add tests for new method |
