<template>
  <div class="container">
    <div v-if="sessionsStore.loading" class="loading-state">
      <span class="loading-spinner"></span>
      Loading session...
    </div>

    <template v-else-if="sessionsStore.currentSession">
      <div class="session-header">
        <div>
          <router-link :to="`/projects/${sessionsStore.currentSession.projectId}/sessions`" class="back-link">
            &larr; Sessions
          </router-link>
          <h1>{{ sessionsStore.currentSession.name }}</h1>
          <div class="session-meta">
            <span :class="['status-badge', `status-${sessionsStore.currentSession.status}`]">
              {{ sessionsStore.currentSession.status }}
            </span>
            <span class="session-mode">{{ sessionsStore.currentSession.mode }}</span>
            <span v-if="sessionsStore.currentSession.gitBranch" class="session-branch">
              {{ sessionsStore.currentSession.gitBranch }}
            </span>
          </div>
        </div>
        <div class="session-actions">
          <button
            v-if="isActive"
            class="btn btn-danger"
            @click="handleStop"
          >
            Stop Session
          </button>
          <button
            v-if="!showDeleteConfirm"
            class="btn btn-outline-danger"
            @click="showDeleteConfirm = true"
          >
            Delete Session
          </button>
          <div v-else class="delete-confirm">
            <span class="delete-confirm-text">Delete this session?</span>
            <button
              class="btn btn-danger btn-sm"
              @click="handleDelete"
            >
              Confirm
            </button>
            <button
              class="btn btn-secondary btn-sm"
              @click="showDeleteConfirm = false"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      <div class="tabs">
        <router-link
          :to="`/sessions/${route.params.id}/conversation`"
          :class="['tab', { active: activeTab === 'conversation' }]"
        >
          Conversation
        </router-link>
        <router-link
          :to="`/sessions/${route.params.id}/changes`"
          :class="['tab', { active: activeTab === 'changes' }]"
        >
          Changes
        </router-link>
        <router-link
          :to="`/sessions/${route.params.id}/canvas`"
          :class="['tab', { active: activeTab === 'canvas' }]"
        >
          Canvas
        </router-link>
        <router-link
          :to="`/sessions/${route.params.id}/notes`"
          :class="['tab', { active: activeTab === 'notes' }]"
        >
          Notes
        </router-link>
      </div>

      <div class="tab-content">
        <ConversationTab v-if="activeTab === 'conversation'" :session-id="route.params.id" />
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
import { useUiStore } from '../stores/ui.js';
import { useSessionSubscription } from '../composables/useWebSocket.js';
import ConversationTab from '../components/ConversationTab.vue';
import ChangesTab from '../components/ChangesTab.vue';
import CanvasTab from '../components/CanvasTab.vue';
import NotesTab from '../components/NotesTab.vue';

const route = useRoute();
const router = useRouter();
const sessionsStore = useSessionsStore();
const canvasStore = useCanvasStore();
const uiStore = useUiStore();

const showDeleteConfirm = ref(false);

const activeTab = computed(() => route.params.tab || 'conversation');
const isActive = computed(() => {
  const status = sessionsStore.currentSession?.status;
  return status === 'running' || status === 'waiting';
});

const { subscribe, unsubscribe, onStatus, onMessage, onError, onCanvasAdd, onCanvasRemove } =
  useSessionSubscription(route.params.id);

let cleanups = [];
const pollIntervalId = ref(null);

// Poll for updates while session is actively processing (fallback for race conditions)
function startPolling() {
  if (pollIntervalId.value) return;
  pollIntervalId.value = setInterval(async () => {
    const status = sessionsStore.currentSession?.status;
    // Only poll while actively processing, not while waiting for user input
    // Use showLoading=false to avoid flickering
    if (status === 'running' || status === 'starting') {
      await sessionsStore.fetchSession(route.params.id, false);
      await sessionsStore.fetchMessages(route.params.id, false);
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
  await sessionsStore.fetchSession(route.params.id);
  await sessionsStore.fetchMessages(route.params.id);
  canvasStore.fetchItems(route.params.id);

  // Start polling if session is actively processing (handles race condition where session
  // completes before WebSocket subscription is established)
  const status = sessionsStore.currentSession?.status;
  if (status === 'running' || status === 'starting') {
    startPolling();
  }

  cleanups.push(
    onStatus((status) => {
      sessionsStore.updateSessionStatus(route.params.id, status);
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
});

onUnmounted(() => {
  stopPolling();
  unsubscribe();
  cleanups.forEach((cleanup) => cleanup());
});

async function handleStop() {
  try {
    await sessionsStore.stopSession(route.params.id);
    uiStore.success('Session stopped');
  } catch (err) {
    uiStore.error(err.message);
  }
}

async function handleDelete() {
  try {
    const projectId = sessionsStore.currentSession?.projectId;
    await sessionsStore.deleteSession(route.params.id);
    uiStore.success('Session deleted');
    // Navigate to project sessions list
    if (projectId) {
      router.push(`/projects/${projectId}/sessions`);
    } else {
      router.push('/');
    }
  } catch (err) {
    uiStore.error(err.message);
    showDeleteConfirm.value = false;
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

.back-link {
  font-size: 0.875rem;
  color: var(--color-text-soft);
  display: inline-block;
  margin-bottom: 0.5rem;
}

.session-header h1 {
  margin: 0 0 0.5rem;
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

.session-branch {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  font-family: var(--font-mono);
}

.tab-content {
  min-height: 400px;
}

.session-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.delete-confirm {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.delete-confirm-text {
  font-size: 0.875rem;
  color: var(--color-danger);
}
</style>
