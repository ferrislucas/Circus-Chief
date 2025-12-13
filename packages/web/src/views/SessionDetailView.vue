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
import { computed, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { useSessionsStore } from '../stores/sessions.js';
import { useCanvasStore } from '../stores/canvas.js';
import { useUiStore } from '../stores/ui.js';
import { useSessionSubscription } from '../composables/useWebSocket.js';
import ConversationTab from '../components/ConversationTab.vue';
import ChangesTab from '../components/ChangesTab.vue';
import CanvasTab from '../components/CanvasTab.vue';
import NotesTab from '../components/NotesTab.vue';

const route = useRoute();
const sessionsStore = useSessionsStore();
const canvasStore = useCanvasStore();
const uiStore = useUiStore();

const activeTab = computed(() => route.params.tab || 'conversation');
const isActive = computed(() => {
  const status = sessionsStore.currentSession?.status;
  return status === 'running' || status === 'waiting';
});

const { subscribe, unsubscribe, onStatus, onMessage, onError, onCanvasAdd, onCanvasRemove } =
  useSessionSubscription(route.params.id);

let cleanups = [];

onMounted(() => {
  sessionsStore.fetchSession(route.params.id);
  sessionsStore.fetchMessages(route.params.id);
  canvasStore.fetchItems(route.params.id);

  subscribe();

  cleanups.push(
    onStatus((status) => {
      sessionsStore.updateSessionStatus(route.params.id, status);
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
</style>
