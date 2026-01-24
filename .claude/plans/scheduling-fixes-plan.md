# Session Scheduling Fixes - Implementation Plan

## Overview

This plan addresses three issues with the session scheduling feature:

1. **Bug**: Scheduled sessions go into "running" state but never actually call Claude Code
2. **Missing Feature**: No way to schedule a follow-up message for an existing session
3. **Missing Feature**: No UI to toggle reschedule options for existing sessions

---

## Issue 1: Scheduled Sessions Not Actually Running

### Root Cause

In `schedulerService.js`, the `startScheduledSession()` method calls:

```javascript
await this.sessionManager.runSession(session.id);
```

But `runSession()` requires multiple parameters:

```javascript
export async function runSession(sessionId, prompt, workingDirectory, systemPrompt = null, fileAttachments = [], model = null)
```

The scheduled session starts with only `sessionId`, leaving `prompt` and `workingDirectory` as `undefined`, causing the session to hang.

### Solution

Fix `schedulerService.startScheduledSession()` to properly retrieve all required parameters before calling `runSession()`:

**File**: `packages/server/src/services/schedulerService.js`

```javascript
async startScheduledSession(session) {
  if (!this.sessionManager) {
    throw new Error('SchedulerService not initialized with sessionManager');
  }

  console.log(`[SchedulerService] Starting scheduled session ${session.id}: ${session.name}`);

  // Get the project for working directory and system prompt
  const project = projects.getById(session.projectId);
  if (!project) {
    throw new Error(`Project not found for session ${session.id}`);
  }

  // Determine working directory
  const workingDirectory = session.gitWorktree || project.workingDirectory;

  // Get the initial user message (prompt) from the session
  const sessionMessages = messages.getBySessionId(session.id);
  const userMessages = sessionMessages.filter(msg => msg.role === 'user');
  const hasAssistantResponses = sessionMessages.some(msg => msg.role === 'assistant');

  if (userMessages.length === 0) {
    throw new Error(`No user message found for session ${session.id}`);
  }

  // Get attachments for context
  const sessionAttachments = attachments.getBySessionId(session.id);

  // Update status from 'scheduled' to 'starting'
  sessions.update(session.id, {
    status: 'starting',
    scheduledAt: null,  // Use camelCase for update
  });
  broadcastToSession(session.id, WS_MESSAGE_TYPES.SESSION_STATUS, { sessionId: session.id, status: 'starting' });

  // Determine if this is an initial run or a continuation
  if (hasAssistantResponses) {
    // Session has conversation history - this is a scheduled continuation
    // Use the most recent user message as the follow-up
    const latestUserMessage = userMessages[userMessages.length - 1];
    await this.sessionManager.continueSession(
      session.id,
      latestUserMessage.content,
      workingDirectory,
      project.systemPrompt,
      sessionAttachments
    );
  } else {
    // Fresh session - initial run
    const initialMessage = userMessages[0];
    await this.sessionManager.runSession(
      session.id,
      initialMessage.content,
      workingDirectory,
      project.systemPrompt,
      sessionAttachments,
      session.model
    );
  }
}
```

**Required Imports** (add to top of `schedulerService.js`):
```javascript
import { sessions, messages, projects, attachments } from '../database.js';
```

---

## Issue 2: Schedule Follow-up for Existing Sessions

### Current State
- Sessions can only be scheduled at creation time
- No way to schedule a follow-up message for a session with existing conversation

### Solution

#### 2.1 Backend: Add Endpoint for Scheduling Follow-up

**File**: `packages/server/src/api/sessions.js`

Add new endpoint `POST /api/sessions/:id/schedule`:

```javascript
// POST /api/sessions/:id/schedule - Schedule a follow-up message for an existing session
router.post('/:id/schedule', async (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Only allow scheduling for waiting, stopped, or error sessions
  if (!['waiting', 'stopped', 'error'].includes(session.status)) {
    return res.status(400).json({ error: 'Session must be in waiting, stopped, or error state to schedule' });
  }

  const { scheduledAt, prompt, autoRescheduleEnabled, rescheduleDelayMinutes,
          rescheduleOnTokenLimit, rescheduleOnServiceError, maxRescheduleCount,
          maxTotalTokens, rescheduleAtTokenCount } = req.body;

  // Validate scheduledAt is provided and in the future
  if (!scheduledAt || scheduledAt <= Date.now()) {
    return res.status(400).json({ error: 'scheduledAt must be a future timestamp' });
  }

  // Validate prompt if provided
  if (prompt && (typeof prompt !== 'string' || prompt.trim() === '')) {
    return res.status(400).json({ error: 'prompt must be a non-empty string if provided' });
  }

  try {
    // Get the project
    const project = projects.getById(session.projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // If a prompt is provided, store it as a new user message
    if (prompt && prompt.trim()) {
      // Get or create active conversation
      const activeConversation = conversations.ensureActiveConversation(req.params.id);

      // Create the user message (will be processed when scheduled time arrives)
      const message = messages.create(req.params.id, 'user', prompt.trim(), null, activeConversation.id);

      // Broadcast the message to session subscribers
      broadcastToSession(req.params.id, WS_MESSAGE_TYPES.SESSION_MESSAGE, { message });
    }

    // Build update data
    const updateData = {
      status: 'scheduled',
      scheduledAt,
    };

    // Apply scheduling options if provided
    if (autoRescheduleEnabled !== undefined) {
      updateData.autoRescheduleEnabled = Boolean(autoRescheduleEnabled);
    }
    if (rescheduleDelayMinutes !== undefined) {
      updateData.rescheduleDelayMinutes = parseInt(rescheduleDelayMinutes, 10);
    }
    if (rescheduleOnTokenLimit !== undefined) {
      updateData.rescheduleOnTokenLimit = Boolean(rescheduleOnTokenLimit);
    }
    if (rescheduleOnServiceError !== undefined) {
      updateData.rescheduleOnServiceError = Boolean(rescheduleOnServiceError);
    }
    if (maxRescheduleCount !== undefined) {
      updateData.maxRescheduleCount = maxRescheduleCount ? parseInt(maxRescheduleCount, 10) : null;
    }
    if (maxTotalTokens !== undefined) {
      updateData.maxTotalTokens = maxTotalTokens ? parseInt(maxTotalTokens, 10) : null;
    }
    if (rescheduleAtTokenCount !== undefined) {
      updateData.rescheduleAtTokenCount = rescheduleAtTokenCount ? parseInt(rescheduleAtTokenCount, 10) : null;
    }

    const updated = sessions.update(req.params.id, updateData);

    // Broadcast status update
    broadcastToSession(req.params.id, WS_MESSAGE_TYPES.SESSION_STATUS, {
      sessionId: req.params.id,
      status: 'scheduled',
    });

    // Broadcast session update to project subscribers
    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
      projectId: session.projectId,
      sessionId: req.params.id,
      session: updated,
    });

    res.json(updated);
  } catch (error) {
    console.error('Schedule session error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

Add required imports at top of file:
```javascript
import { conversations, projects } from '../database.js';
```

#### 2.2 Frontend: Schedule Modal Component

**File**: `packages/web/src/components/ScheduleSessionModal.vue` (NEW)

Create a modal that allows users to:
- Set a scheduled time
- Optionally provide a follow-up prompt
- Configure reschedule options

```vue
<template>
  <Teleport to="body">
    <div v-if="isOpen" class="modal-backdrop" @click.self="close">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title">Schedule Session</h2>
          <button @click="close" class="close-btn">&times;</button>
        </div>

        <div class="modal-body">
          <!-- Scheduled Time -->
          <div class="form-group">
            <label for="scheduled-at" class="form-label">Schedule Start Time *</label>
            <input
              id="scheduled-at"
              type="datetime-local"
              v-model="form.scheduledAtLocal"
              :min="minDateTime"
              class="form-input"
              required
            />
          </div>

          <!-- Optional Prompt -->
          <div class="form-group">
            <label for="prompt" class="form-label">Follow-up Message (optional)</label>
            <textarea
              id="prompt"
              v-model="form.prompt"
              class="form-input"
              rows="3"
              placeholder="Enter a message to send when the session starts..."
            ></textarea>
            <p class="form-help">Leave empty to continue with the existing conversation</p>
          </div>

          <!-- Scheduling Options (collapsible) -->
          <SchedulingOptions v-model="form.scheduling" />
        </div>

        <div class="modal-footer">
          <button @click="close" class="btn btn-secondary">Cancel</button>
          <button @click="handleSchedule" class="btn btn-primary" :disabled="loading || !isValid">
            {{ loading ? 'Scheduling...' : 'Schedule' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue';
import { api } from '../composables/useApi.js';
import { useUiStore } from '../stores/ui.js';
import SchedulingOptions from './SchedulingOptions.vue';

const props = defineProps({
  isOpen: Boolean,
  sessionId: String,
});

const emit = defineEmits(['close', 'scheduled']);

const uiStore = useUiStore();
const loading = ref(false);

const form = reactive({
  scheduledAtLocal: '',
  prompt: '',
  scheduling: {
    autoRescheduleEnabled: false,
    rescheduleDelayMinutes: 15,
    rescheduleOnTokenLimit: true,
    rescheduleOnServiceError: true,
    maxRescheduleCount: null,
    maxTotalTokens: null,
    rescheduleAtTokenCount: null,
  },
});

// Calculate min datetime (now + 1 minute)
const minDateTime = computed(() => {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 1);
  return now.toISOString().slice(0, 16);
});

const isValid = computed(() => {
  if (!form.scheduledAtLocal) return false;
  const scheduledTime = new Date(form.scheduledAtLocal).getTime();
  return scheduledTime > Date.now();
});

function close() {
  emit('close');
}

async function handleSchedule() {
  if (!isValid.value) return;

  loading.value = true;
  try {
    const scheduledAt = new Date(form.scheduledAtLocal).getTime();

    const payload = {
      scheduledAt,
      ...form.scheduling,
    };

    // Only include prompt if provided
    if (form.prompt && form.prompt.trim()) {
      payload.prompt = form.prompt.trim();
    }

    await api.scheduleSession(props.sessionId, payload);

    uiStore.showToast('Session scheduled successfully', 'success');
    emit('scheduled');
    close();
  } catch (error) {
    console.error('Failed to schedule session:', error);
    uiStore.showToast('Failed to schedule session: ' + error.message, 'error');
  } finally {
    loading.value = false;
  }
}

// Reset form when modal opens
watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    form.scheduledAtLocal = '';
    form.prompt = '';
    form.scheduling = {
      autoRescheduleEnabled: false,
      rescheduleDelayMinutes: 15,
      rescheduleOnTokenLimit: true,
      rescheduleOnServiceError: true,
      maxRescheduleCount: null,
      maxTotalTokens: null,
      rescheduleAtTokenCount: null,
    };
  }
});
</script>

<style scoped>
/* Modal styles - dark theme */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--color-background-secondary, #1f2937);
  border-radius: 0.5rem;
  width: 100%;
  max-width: 500px;
  max-height: 90vh;
  overflow-y: auto;
  border: 1px solid var(--color-border);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--color-border);
}

.modal-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  color: var(--color-text-soft);
  cursor: pointer;
}

.modal-body {
  padding: 1.5rem;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--color-border);
}

.form-group {
  margin-bottom: 1rem;
}

.form-label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
}

.form-input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  background: var(--color-background);
  color: var(--color-text);
}

.form-help {
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 0.25rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
}

.btn-primary {
  background: var(--color-primary);
  color: white;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--color-background);
  border: 1px solid var(--color-border);
  color: var(--color-text);
}
</style>
```

#### 2.3 Frontend: Add API Method

**File**: `packages/web/src/composables/useApi.js`

Add the `scheduleSession` method:

```javascript
async scheduleSession(sessionId, data) {
  const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to schedule session');
  }
  return response.json();
}
```

#### 2.4 Frontend: Add Schedule Button to Session Detail View

**File**: `packages/web/src/views/SessionDetailView.vue`

Add schedule button to the header/actions area for sessions that can be scheduled (waiting/stopped/error):

```vue
<!-- Add in template -->
<button
  v-if="canSchedule"
  @click="showScheduleModal = true"
  class="btn btn-secondary"
>
  ⏰ Schedule
</button>

<ScheduleSessionModal
  :is-open="showScheduleModal"
  :session-id="sessionId"
  @close="showScheduleModal = false"
  @scheduled="handleScheduled"
/>

<!-- Add in script -->
import ScheduleSessionModal from '../components/ScheduleSessionModal.vue';

const showScheduleModal = ref(false);

const canSchedule = computed(() => {
  const status = sessionsStore.currentSession?.status;
  return ['waiting', 'stopped', 'error'].includes(status);
});

function handleScheduled() {
  // Refresh session data
  sessionsStore.fetchSession(sessionId);
}
```

---

## Issue 3: Toggle Reschedule Options for Existing Sessions

### Current State
- `SchedulingInfo.vue` displays scheduling info but has no edit capability
- Backend already supports updating via `PATCH /api/sessions/:id`

### Solution

#### 3.1 Enhance SchedulingInfo Component

**File**: `packages/web/src/components/SchedulingInfo.vue`

Add edit functionality to the existing component:

```vue
<template>
  <!-- Scheduled Session Info -->
  <div v-if="session.status === 'scheduled'" class="scheduling-info scheduled-panel">
    <div class="info-header">
      <span class="info-icon">⏰</span>
      <h3 class="info-title">Scheduled Session</h3>
      <button @click="showEditModal = true" class="edit-btn" title="Edit schedule">
        ✏️
      </button>
    </div>

    <!-- ... existing content ... -->

    <div class="actions">
      <button @click="handleStartNow" class="btn btn-primary" :disabled="loading">
        {{ loading ? 'Loading...' : 'Start Now' }}
      </button>
      <button @click="showEditModal = true" class="btn btn-secondary">
        Edit Schedule
      </button>
      <button @click="handleCancelSchedule" class="btn btn-danger">
        Cancel
      </button>
    </div>
  </div>

  <!-- Auto-Reschedule Info (for running/waiting sessions) -->
  <div
    v-else-if="(session.status === 'running' || session.status === 'waiting') && session.autoRescheduleEnabled"
    class="auto-reschedule-panel"
  >
    <div class="info-header">
      <span class="info-icon">🔄</span>
      <h3 class="info-title">Auto-Reschedule Enabled</h3>
      <button @click="showEditModal = true" class="edit-btn" title="Edit settings">
        ✏️
      </button>
    </div>

    <!-- ... existing grid content ... -->

    <div class="actions" v-if="session.status === 'waiting'">
      <button @click="handleDisableReschedule" class="btn btn-secondary">
        Disable Auto-Reschedule
      </button>
    </div>
  </div>

  <!-- Enable Auto-Reschedule for waiting sessions without it enabled -->
  <div
    v-else-if="session.status === 'waiting' && !session.autoRescheduleEnabled"
    class="enable-reschedule-panel"
  >
    <button @click="showEditModal = true" class="btn btn-secondary btn-sm">
      ⚙️ Configure Auto-Reschedule
    </button>
  </div>

  <!-- Edit Modal -->
  <SchedulingEditModal
    :is-open="showEditModal"
    :session="session"
    @close="showEditModal = false"
    @saved="handleSaved"
  />
</template>

<script setup>
import { ref } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';
import SchedulingEditModal from './SchedulingEditModal.vue';

// ... existing code ...

const showEditModal = ref(false);

async function handleCancelSchedule() {
  if (!confirm('Cancel the scheduled session?')) return;

  loading.value = true;
  try {
    await sessionsStore.updateSessionFields(props.session.id, {
      status: 'stopped',
      scheduledAt: null,
    });
    uiStore.showToast('Schedule cancelled', 'success');
  } catch (error) {
    uiStore.showToast('Failed to cancel schedule: ' + error.message, 'error');
  } finally {
    loading.value = false;
  }
}

async function handleDisableReschedule() {
  try {
    await sessionsStore.updateSessionFields(props.session.id, {
      autoRescheduleEnabled: false,
    });
    uiStore.showToast('Auto-reschedule disabled', 'success');
  } catch (error) {
    uiStore.showToast('Failed to update settings: ' + error.message, 'error');
  }
}

function handleSaved() {
  // Settings updated, modal will close
}
</script>
```

#### 3.2 Create Scheduling Edit Modal

**File**: `packages/web/src/components/SchedulingEditModal.vue` (NEW)

```vue
<template>
  <Teleport to="body">
    <div v-if="isOpen" class="modal-backdrop" @click.self="close">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title">Edit Scheduling Settings</h2>
          <button @click="close" class="close-btn">&times;</button>
        </div>

        <div class="modal-body">
          <!-- Schedule Time (only for scheduled sessions) -->
          <div v-if="session.status === 'scheduled'" class="form-group">
            <label for="scheduled-at" class="form-label">Scheduled Time</label>
            <input
              id="scheduled-at"
              type="datetime-local"
              v-model="form.scheduledAtLocal"
              :min="minDateTime"
              class="form-input"
            />
          </div>

          <!-- Auto-Reschedule Settings -->
          <div class="form-group">
            <label class="toggle-switch">
              <input type="checkbox" v-model="form.autoRescheduleEnabled" />
              <span class="toggle-slider"></span>
              <span class="toggle-label">Auto-reschedule on errors</span>
            </label>
          </div>

          <div v-if="form.autoRescheduleEnabled" class="reschedule-settings">
            <!-- Reschedule Triggers -->
            <div class="form-group">
              <p class="settings-label">Reschedule Triggers</p>
              <label class="checkbox-option">
                <input type="checkbox" v-model="form.rescheduleOnTokenLimit" />
                <span>Token limit errors</span>
              </label>
              <label class="checkbox-option">
                <input type="checkbox" v-model="form.rescheduleOnServiceError" />
                <span>Service unavailability</span>
              </label>
            </div>

            <!-- Delay -->
            <div class="form-group">
              <label class="form-label">Reschedule Delay</label>
              <select v-model.number="form.rescheduleDelayMinutes" class="form-input">
                <option :value="5">5 minutes</option>
                <option :value="15">15 minutes</option>
                <option :value="30">30 minutes</option>
                <option :value="60">1 hour</option>
                <option :value="120">2 hours</option>
              </select>
            </div>

            <!-- Limits -->
            <div class="form-group">
              <label class="form-label">Max Reschedule Count</label>
              <input
                type="number"
                v-model.number="form.maxRescheduleCount"
                min="1"
                max="100"
                class="form-input"
                placeholder="Unlimited"
              />
            </div>

            <div class="form-group">
              <label class="form-label">Max Total Tokens</label>
              <input
                type="number"
                v-model.number="form.maxTotalTokens"
                min="1000"
                step="1000"
                class="form-input"
                placeholder="Unlimited"
              />
            </div>

            <div class="form-group">
              <label class="form-label">Reschedule At Token Count</label>
              <input
                type="number"
                v-model.number="form.rescheduleAtTokenCount"
                min="10000"
                step="10000"
                class="form-input"
                placeholder="None"
              />
            </div>

            <!-- Reset reschedule count -->
            <div class="form-group">
              <label class="checkbox-option">
                <input type="checkbox" v-model="form.resetRescheduleCount" />
                <span>Reset reschedule count to 0</span>
              </label>
              <p class="form-help">Current count: {{ session.rescheduleCount }}</p>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button @click="close" class="btn btn-secondary">Cancel</button>
          <button @click="handleSave" class="btn btn-primary" :disabled="loading">
            {{ loading ? 'Saving...' : 'Save' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';

const props = defineProps({
  isOpen: Boolean,
  session: Object,
});

const emit = defineEmits(['close', 'saved']);

const sessionsStore = useSessionsStore();
const uiStore = useUiStore();
const loading = ref(false);

const form = reactive({
  scheduledAtLocal: '',
  autoRescheduleEnabled: false,
  rescheduleDelayMinutes: 15,
  rescheduleOnTokenLimit: true,
  rescheduleOnServiceError: true,
  maxRescheduleCount: null,
  maxTotalTokens: null,
  rescheduleAtTokenCount: null,
  resetRescheduleCount: false,
});

const minDateTime = computed(() => {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 1);
  return now.toISOString().slice(0, 16);
});

function close() {
  emit('close');
}

function convertToLocalDatetime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

async function handleSave() {
  loading.value = true;
  try {
    const updateData = {
      autoRescheduleEnabled: form.autoRescheduleEnabled,
      rescheduleDelayMinutes: form.rescheduleDelayMinutes,
      rescheduleOnTokenLimit: form.rescheduleOnTokenLimit,
      rescheduleOnServiceError: form.rescheduleOnServiceError,
      maxRescheduleCount: form.maxRescheduleCount || null,
      maxTotalTokens: form.maxTotalTokens || null,
      rescheduleAtTokenCount: form.rescheduleAtTokenCount || null,
    };

    // Update scheduled time if changed
    if (props.session.status === 'scheduled' && form.scheduledAtLocal) {
      updateData.scheduledAt = new Date(form.scheduledAtLocal).getTime();
    }

    // Reset reschedule count if requested
    if (form.resetRescheduleCount) {
      updateData.rescheduleCount = 0;
    }

    await sessionsStore.updateSessionFields(props.session.id, updateData);

    uiStore.showToast('Settings saved', 'success');
    emit('saved');
    close();
  } catch (error) {
    uiStore.showToast('Failed to save settings: ' + error.message, 'error');
  } finally {
    loading.value = false;
  }
}

// Initialize form when modal opens
watch(() => props.isOpen, (isOpen) => {
  if (isOpen && props.session) {
    form.scheduledAtLocal = convertToLocalDatetime(props.session.scheduledAt);
    form.autoRescheduleEnabled = props.session.autoRescheduleEnabled || false;
    form.rescheduleDelayMinutes = props.session.rescheduleDelayMinutes || 15;
    form.rescheduleOnTokenLimit = props.session.rescheduleOnTokenLimit ?? true;
    form.rescheduleOnServiceError = props.session.rescheduleOnServiceError ?? true;
    form.maxRescheduleCount = props.session.maxRescheduleCount;
    form.maxTotalTokens = props.session.maxTotalTokens;
    form.rescheduleAtTokenCount = props.session.rescheduleAtTokenCount;
    form.resetRescheduleCount = false;
  }
});
</script>

<style scoped>
/* Same modal styles as ScheduleSessionModal */
</style>
```

---

## Implementation Order

1. **Fix Issue 1 first** (Critical bug)
   - Update `schedulerService.js` to properly call `runSession` with all required parameters
   - Test with a new scheduled session

2. **Implement Issue 3** (UI for editing existing session settings)
   - Create `SchedulingEditModal.vue`
   - Update `SchedulingInfo.vue` with edit button and toggle options
   - Test updating reschedule settings on waiting/running sessions

3. **Implement Issue 2** (Schedule follow-up for existing sessions)
   - Add `POST /api/sessions/:id/schedule` endpoint
   - Create `ScheduleSessionModal.vue`
   - Add API method to `useApi.js`
   - Add schedule button to `SessionDetailView.vue`
   - Test scheduling a follow-up message

---

## Testing Checklist

### Issue 1
- [ ] Create a scheduled session with `scheduledAt` set to 1-2 minutes in the future
- [ ] Verify session status is 'scheduled'
- [ ] Wait for scheduled time
- [ ] Verify session transitions to 'starting' then 'running'
- [ ] Verify Claude actually processes the prompt and produces output
- [ ] Verify session transitions to 'waiting' when complete

### Issue 2
- [ ] Open an existing session with conversation history (status: waiting)
- [ ] Click "Schedule" button
- [ ] Set a future time and optionally a follow-up prompt
- [ ] Verify session transitions to 'scheduled'
- [ ] Wait for scheduled time
- [ ] Verify Claude processes the scheduled message

### Issue 3
- [ ] Open a session with auto-reschedule enabled
- [ ] Click edit button on SchedulingInfo panel
- [ ] Modify reschedule settings
- [ ] Save and verify settings are updated
- [ ] Test disabling auto-reschedule
- [ ] Test enabling auto-reschedule on a session that didn't have it
