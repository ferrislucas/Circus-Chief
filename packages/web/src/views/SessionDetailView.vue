<template>
  <div class="container">
    <div v-if="sessionsStore.loading" class="loading-state">
      <span class="loading-spinner"></span>
      Loading session...
    </div>

    <template v-else-if="sessionsStore.currentSession">
      <div class="session-header">
        <div>
          <h3 class="session-name">{{ sessionsStore.currentSession.name }}</h3>
          <div class="session-meta">
            <span :class="['status-badge', `status-${sessionsStore.currentSession.status}`]">
              {{ sessionsStore.currentSession.status }}
            </span>
            <span class="session-mode">{{ sessionsStore.currentSession.mode }}</span>
          </div>
          <div v-if="sessionsStore.currentSession.gitBranch || sessionsStore.currentSession.prUrl" class="branch-row">
            <span
              v-if="sessionsStore.currentSession.gitBranch"
              class="branch-indicator"
              :title="sessionsStore.currentSession.gitBranch"
            >
              <svg class="branch-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/>
              </svg>
              {{ sessionsStore.currentSession.gitBranch }}
            </span>
            <a
              v-if="sessionsStore.currentSession.prUrl"
              :href="sessionsStore.currentSession.prUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="pr-link"
            >
              <svg class="pr-icon" viewBox="0 0 16 16" fill="currentColor">
                <path fill-rule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
              </svg>
              View PR #{{ prNumber }}
            </a>
          </div>
        </div>
        <div class="session-actions">
          <button
            class="btn btn-outline-danger"
            @click="handleDelete"
          >
            Delete Session
          </button>
        </div>
      </div>

      <div class="tabs">
        <router-link
          :to="`/projects/${sessionsStore.currentSession.projectId}/sessions`"
          class="tab tab-back"
        >
          ← Sessions
        </router-link>
        <span class="tab-separator"></span>

        <!-- Desktop tabs -->
        <div class="tabs-desktop">
          <router-link
            v-for="tab in tabs"
            :key="tab.id"
            :to="`/sessions/${route.params.id}/${tab.id}`"
            :class="['tab', { active: activeTab === tab.id }]"
          >
            {{ tab.label }}
          </router-link>
        </div>

        <!-- Mobile dropdown -->
        <div class="tabs-mobile">
          <select :value="activeTab" @change="navigateToTab($event.target.value)" class="tab-select">
            <option v-for="tab in tabs" :key="tab.id" :value="tab.id">
              {{ tab.label }}
            </option>
          </select>
        </div>
      </div>

      <div class="tab-content">
        <SummaryTab v-if="activeTab === 'summary'" :session-id="route.params.id" />
        <ConversationTab v-else-if="activeTab === 'conversation'" :session-id="route.params.id" />
        <ChangesTab v-else-if="activeTab === 'changes'" :session-id="route.params.id" />
        <CanvasTab v-else-if="activeTab === 'canvas'" :session-id="route.params.id" />
        <NotesTab v-else-if="activeTab === 'notes'" :session-id="route.params.id" />
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionsStore } from '../stores/sessions.js';
import { useCanvasStore } from '../stores/canvas.js';
import { useTodosStore } from '../stores/todos.js';
import { useUiStore } from '../stores/ui.js';
import { useSessionSubscription } from '../composables/useWebSocket.js';
import ConversationTab from '../components/ConversationTab.vue';
import ChangesTab from '../components/ChangesTab.vue';
import CanvasTab from '../components/CanvasTab.vue';
import NotesTab from '../components/NotesTab.vue';
import SummaryTab from '../components/SummaryTab.vue';

const route = useRoute();
const router = useRouter();
const sessionsStore = useSessionsStore();
const canvasStore = useCanvasStore();
const todosStore = useTodosStore();
const uiStore = useUiStore();

// Capture session ID at component creation to avoid race conditions during navigation.
// When navigating away, Vue Router updates route.params BEFORE unmounting the component.
// If polling reads route.params.id after navigation starts, it would get the wrong ID.
const sessionId = route.params.id;

const activeTab = computed(() => route.params.tab || 'conversation');

// Extract PR number from prUrl (e.g., https://github.com/owner/repo/pull/123 -> 123)
const prNumber = computed(() => {
  const prUrl = sessionsStore.currentSession?.prUrl;
  if (!prUrl) return '';
  const match = prUrl.match(/\/pull\/(\d+)/);
  return match ? match[1] : '';
});

const tabs = [
  { id: 'summary', label: 'Summary' },
  { id: 'conversation', label: 'Conversation' },
  { id: 'changes', label: 'Changes' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'notes', label: 'Notes' }
];

function navigateToTab(tabId) {
  router.push(`/sessions/${route.params.id}/${tabId}`);
}

const { subscribe, unsubscribe, onStatus, onMessage, onError, onCanvasAdd, onCanvasRemove, onTodosUpdate, onSessionUpdate } =
  useSessionSubscription(sessionId);

let cleanups = [];
const pollIntervalId = ref(null);
const showDeleteConfirm = ref(false);

// Poll for updates while session is actively processing (fallback for race conditions)
function startPolling() {
  if (pollIntervalId.value) return;
  pollIntervalId.value = setInterval(async () => {
    const status = sessionsStore.currentSession?.status;
    // Only poll while actively processing, not while waiting for user input
    // Use showLoading=false to avoid flickering
    if (status === 'running' || status === 'starting') {
      await sessionsStore.fetchSession(sessionId, false);
      await sessionsStore.fetchMessages(sessionId, false);
      await sessionsStore.fetchWorkLogs(sessionId);
    } else {
      // Session no longer actively processing, stop polling
      stopPolling();
    }
  }, 2000);
}

function stopPolling() {
  if (pollIntervalId.value) {
    clearInterval(pollIntervalId.value);
    pollIntervalId.value = null;
  }
}

// Watch for status changes from any source (optimistic updates, WebSocket, etc.)
// This ensures polling starts even when status is updated directly in the store
watch(
  () => sessionsStore.currentSession?.status,
  (newStatus, oldStatus) => {
    if (newStatus === 'running' || newStatus === 'starting') {
      startPolling();
    } else if (oldStatus === 'running' || oldStatus === 'starting') {
      stopPolling();
    }
  }
);

onMounted(async () => {
  // Subscribe to WebSocket first to minimize race condition window
  subscribe();

  // Then fetch data - this ensures we don't miss updates
  await sessionsStore.fetchSession(sessionId);
  await sessionsStore.fetchMessages(sessionId);
  canvasStore.fetchItems(sessionId);
  todosStore.fetchTodos(sessionId);

  // Start polling if session is actively processing (handles race condition where session
  // completes before WebSocket subscription is established)
  const status = sessionsStore.currentSession?.status;
  if (status === 'running' || status === 'starting') {
    startPolling();
  }

  cleanups.push(
    onStatus((status) => {
      sessionsStore.updateSessionStatus(sessionId, status);
      // Start polling when session starts processing, stop when done
      if (status === 'running' || status === 'starting') {
        startPolling();
      } else {
        stopPolling();
      }
    })
  );

  cleanups.push(
    onMessage((message) => {
      sessionsStore.addMessage(message);
    })
  );

  cleanups.push(
    onError((error) => {
      uiStore.error(error);
    })
  );

  cleanups.push(
    onCanvasAdd((item) => {
      canvasStore.addItem(item);
    })
  );

  cleanups.push(
    onCanvasRemove((itemId) => {
      canvasStore.removeItem(itemId);
    })
  );

  cleanups.push(
    onTodosUpdate((todos) => {
      todosStore.updateTodos(todos);
    })
  );

  cleanups.push(
    onSessionUpdate((session) => {
      sessionsStore.updateSession(session);
    })
  );
});

onUnmounted(() => {
  stopPolling();
  unsubscribe();
  cleanups.forEach((cleanup) => cleanup());
});

async function handleDelete() {
  if (!confirm('Are you sure you want to delete this session?')) return;

  try {
    const projectId = sessionsStore.currentSession?.projectId;
    await sessionsStore.deleteSession(sessionId);
    uiStore.success('Session deleted');
    // Navigate to project sessions list
    if (projectId) {
      router.push(`/projects/${projectId}/sessions`);
    } else {
      router.push('/');
    }
  } catch (err) {
    uiStore.error(err.message);
  }
}
</script>

<style scoped>
.loading-state {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
  padding: 3rem;
}

.session-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1.5rem;
}

.session-name {
  margin: 0 0 0.5rem;
  font-size: 1.25rem;
  font-weight: 600;
}

.session-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.session-mode {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  text-transform: capitalize;
}

.branch-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.branch-indicator {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  font-family: var(--font-mono);
  color: var(--color-text-soft);
}

.branch-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.tab-content {
  min-height: 400px;
}

.session-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.pr-link {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: white;
  background: var(--color-primary);
  border-radius: 4px;
  text-decoration: none;
  transition: background-color 0.2s;
}

.pr-link:hover {
  background: var(--color-primary-hover, #2563eb);
}

.pr-icon {
  width: 14px;
  height: 14px;
}
</style>
