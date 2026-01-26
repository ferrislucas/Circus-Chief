# Fix Session Scheduling Display Issues

## Root Cause Discovery

**The scheduling feature code exists in this branch but hasn't been merged to main yet. The running server (port 5000) is using the main codebase which lacks the scheduling API routes entirely.**

### Evidence:
1. `GET /api/sessions/scheduled` returns 404 "Session not found" - the route doesn't exist in main
2. The `/scheduled` route exists at line 26 of the worktree's `sessions.js`, but NOT in main
3. Main repo's `sessions.js` has NO scheduling-related code (`scheduledAt`, `POST /:id/schedule`, etc.)
4. The scheduling commits (`d057848`, `5e960d7`) are in this branch but not merged

### Database shows scheduling was used:
```sql
-- Sessions with scheduled_at set:
8f38d811-ab27-4f77-b5c1-aca448b6203e | status='error' | scheduled_at=2026-01-15 22:58
d3dddb08-08b4-46d9-a8c2-06cbee3c5068 | status='running' | scheduled_at=2026-01-16 07:27
```
These sessions were scheduled when the worktree code was running, but now the main server can't query them.

---

## Issues to Fix

### Issue 1: Session Cards Don't Show Scheduling Info
**Status: Code exists but missing scheduling indicator**

`SessionCard.vue` shows status badges but lacks:
- Special styling for `status-scheduled` badge
- Display of when the session is scheduled to run (`scheduledAt` timestamp)
- Visual distinction for scheduled sessions

### Issue 2: Scheduled Tab Never Shows Sessions
**Status: Two problems**

1. **API Route Missing in Main** - The `GET /api/sessions/scheduled` route is only in this branch
2. **Local State Not Synced** - Even if the route existed, `SessionListView.vue` stores `scheduledSessions` as a local ref that doesn't update via WebSocket

---

## Implementation Plan

### Step 1: Verify All Scheduling Routes Exist

Confirm these routes are in `packages/server/src/api/sessions.js`:

```js
// Line 26 - GET scheduled sessions
router.get('/scheduled', (req, res) => {
  const scheduledSessions = sessions.getScheduledSessions();
  res.json(scheduledSessions);
});

// Line 982 - POST schedule a session
router.post('/:id/schedule', async (req, res) => {
  // ... scheduling logic
});

// PATCH includes scheduledAt handling (line 828)
if (scheduledAt !== undefined) {
  updateData.scheduledAt = scheduledAt;
}
```

**These already exist in the worktree** ✓

### Step 2: Add Scheduling Indicator to SessionCard

**File: `packages/web/src/components/SessionCard.vue`**

Add visual indicator showing when a session is scheduled:

```vue
<!-- Add after status badge -->
<span v-if="session.status === 'scheduled' && session.scheduledAt"
      class="ml-2 text-xs text-cyan-400 flex items-center gap-1">
  <span>⏰</span>
  <span>{{ formatScheduledTime(session.scheduledAt) }}</span>
</span>
```

Add formatting helper:
```js
function formatScheduledTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = date - now;

  if (diffMs < 0) return 'overdue';
  if (diffMs < 60000) return 'in < 1 min';
  if (diffMs < 3600000) return `in ${Math.round(diffMs / 60000)} min`;
  if (diffMs < 86400000) return `at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  return date.toLocaleDateString();
}
```

Add CSS for scheduled status badge:
```css
.status-scheduled {
  background-color: rgba(34, 197, 255, 0.2);
  color: #22c5ff;
}
```

### Step 3: Move Scheduled Sessions to Pinia Store

**File: `packages/web/src/stores/sessions.js`**

1. Add `scheduledSessions` to state:
```js
state: () => ({
  // ... existing state
  scheduledSessions: [],
  loadingScheduled: false,
})
```

2. Add `fetchScheduledSessions()` action:
```js
async fetchScheduledSessions() {
  this.loadingScheduled = true;
  try {
    this.scheduledSessions = await api.getScheduledSessions();
  } catch (err) {
    console.error('Failed to fetch scheduled sessions:', err);
  } finally {
    this.loadingScheduled = false;
  }
},
```

3. Update `updateSession()` to handle scheduled status changes:
```js
updateSession(sessionData) {
  // ... existing logic ...

  // Handle scheduled status transitions
  if (sessionData.status === 'scheduled') {
    // Add to scheduled list if not present
    const exists = this.scheduledSessions.some(s => s.id === sessionData.id);
    if (!exists) {
      this.scheduledSessions.push(sessionData);
    } else {
      const idx = this.scheduledSessions.findIndex(s => s.id === sessionData.id);
      if (idx !== -1) {
        this.scheduledSessions[idx] = { ...this.scheduledSessions[idx], ...sessionData };
      }
    }
  } else {
    // Remove from scheduled list when status changes from 'scheduled'
    this.scheduledSessions = this.scheduledSessions.filter(s => s.id !== sessionData.id);
  }
}
```

### Step 4: Update SessionListView

**File: `packages/web/src/views/SessionListView.vue`**

Replace local state with store:

```vue
<script setup>
// Remove these local refs:
// const scheduledSessions = ref([]);
// const loadingScheduled = ref(false);

// Use store instead:
const scheduledSessions = computed(() => sessionsStore.scheduledSessions);
const loadingScheduled = computed(() => sessionsStore.loadingScheduled);

// Update fetchScheduledSessions to use store:
async function fetchScheduledSessions() {
  await sessionsStore.fetchScheduledSessions();
}
</script>
```

### Step 5: Add API Method

**File: `packages/web/src/api/ApiClient.js`**

Add if missing:
```js
async getScheduledSessions() {
  return this.#request('GET', '/sessions/scheduled');
}
```

---

## Testing Checklist

1. **Merge/deploy this branch first** - The server must have the scheduling routes

2. **Schedule a new session**
   - [ ] Session status changes to 'scheduled'
   - [ ] Session appears in Scheduled tab
   - [ ] Session card shows ⏰ indicator with scheduled time

3. **View scheduled sessions**
   - [ ] Scheduled tab loads sessions correctly
   - [ ] Sessions are sorted by scheduled time

4. **When scheduled time arrives**
   - [ ] Session automatically starts (status → 'starting' → 'running')
   - [ ] Session is removed from Scheduled tab
   - [ ] Session appears in regular Sessions tab

5. **WebSocket updates**
   - [ ] Scheduling a session updates the Scheduled tab in real-time
   - [ ] Starting a scheduled session removes it from the tab in real-time

---

## Files to Modify

1. `packages/web/src/components/SessionCard.vue` - Add scheduling time indicator
2. `packages/web/src/stores/sessions.js` - Add scheduledSessions state and actions
3. `packages/web/src/views/SessionListView.vue` - Use store for scheduled sessions
4. `packages/web/src/api/ApiClient.js` - Add getScheduledSessions() if missing

## Already Implemented (in this branch)

- `packages/server/src/api/sessions.js` - GET /scheduled, POST /:id/schedule routes
- `packages/server/src/db/SessionRepository.js` - getScheduledSessions(), scheduledAt mapping
- `packages/web/src/components/ScheduleSessionModal.vue` - UI for scheduling
