<template>
  <div class="container">
    <div v-if="sessionsStore.loading" class="loading-state">
      <span class="loading-spinner"></span>
      Loading session...
    </div>

    <template v-else-if="sessionsStore.currentSession">
      <!-- Delete overlay -->
      <Transition name="fade">
        <div v-if="isDeleting" class="delete-overlay">
          <div class="delete-overlay-content">
            <span class="delete-spinner"></span>
            <span>Deleting session...</span>
          </div>
        </div>
      </Transition>
      <!-- Session hierarchy breadcrumb -->
      <SessionHierarchyBreadcrumb
        v-if="sessionPath.length > 1"
        :path="sessionPath"
        :current-session-id="currentSessionId"
      />

      <SessionDetailHeader
        :session="sessionsStore.currentSession"
        :is-deleting="isDeleting"
        :is-editing-pr-url="isEditingPrUrl"
        :edit-pr-url-value="editPrUrlValue"
        :summary="summary"
        :button-statuses-to-display="buttonStatusesToDisplay"
        @duplicate="handleDuplicate"
        @copySessionId="handleCopySessionId"
        @archive="handleArchive"
        @delete="handleDelete"
        @star="handleStar"
        @startEditPrUrl="startEditPrUrl"
        @cancelEditPrUrl="cancelEditPrUrl"
        @savePrUrl="savePrUrl"
        @clearPrUrl="clearPrUrl"
        @update:editPrUrlValue="editPrUrlValue = $event"
      />

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
            <span
              v-if="tab.id === 'changes' && hasChanges"
              class="changes-indicator"
              title="Uncommitted changes"
            ></span>
            <span
              v-if="tab.id === 'canvas' && canvasItemCount > 0"
              class="canvas-indicator"
              title="Canvas contains files"
            ></span>
          </router-link>
        </div>

        <!-- Mobile dropdown -->
        <div class="tabs-mobile">
          <select :value="activeTab" @change="navigateToTab($event.target.value)" class="tab-select">
            <option v-for="tab in tabs" :key="tab.id" :value="tab.id">
              {{ tab.label }}{{ tab.id === 'changes' && hasChanges ? ' •' : '' }}{{ tab.id === 'canvas' && canvasItemCount > 0 ? ' •' : '' }}
            </option>
          </select>
        </div>
      </div>

      <!-- Scheduling Info Panel -->
      <SchedulingInfo v-if="sessionsStore.currentSession" :session="sessionsStore.currentSession" />

      <div class="tab-content">
        <!-- CRITICAL: :key ensures components remount when navigating between sessions,
             preventing stale WebSocket handlers from capturing the wrong sessionId -->
        <SummaryTab v-if="activeTab === 'summary'" :key="route.params.id" :session-id="route.params.id" />
        <ConversationTab v-else-if="activeTab === 'conversation'" :key="route.params.id" :session-id="route.params.id" />
        <ChangesTab v-else-if="activeTab === 'changes'" :key="route.params.id" :session-id="route.params.id" @update:file-count="changesFileCount = $event" />
        <CanvasTab v-else-if="activeTab === 'canvas'" :key="route.params.id" :session-id="route.params.id" />
        <CommandsTab v-else-if="activeTab === 'commands'" :key="route.params.id" :session-id="route.params.id" :project-id="sessionsStore.currentSession?.projectId" />
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, onActivated, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionsStore } from '../stores/sessions.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useSessionWebSocket } from '../composables/useSessionWebSocket.js';
import { useSessionActions } from '../composables/useSessionActions.js';
import ConversationTab from '../components/ConversationTab.vue';
import ChangesTab from '../components/ChangesTab.vue';
import CanvasTab from '../components/CanvasTab.vue';
import SummaryTab from '../components/SummaryTab.vue';
import CommandsTab from '../components/CommandsTab.vue';
import SchedulingInfo from '../components/SchedulingInfo.vue';
import SessionHierarchyBreadcrumb from '../components/SessionHierarchyBreadcrumb.vue';
import SessionDetailHeader from '../components/SessionDetailHeader.vue';

const route = useRoute();
const router = useRouter();
const sessionsStore = useSessionsStore();
const commandButtonsStore = useCommandButtonsStore();

// Reactive session ID that tracks route changes
// When navigating between sessions (parent/child), the component is reused
// and the route watcher handles cleanup and re-initialization
const currentSessionId = ref(route.params.id);

// WebSocket subscription, polling, and data fetching
const {
  summary,
  hasChanges,
  changesFileCount,
  canvasItemCount,
  cleanup: wsCleanup,
  initializeSession,
  destroy: wsDestroy,
} = useSessionWebSocket(currentSessionId);

// Session action handlers (duplicate, delete, archive, star, PR URL editing)
const {
  isDeleting,
  isEditingPrUrl,
  editPrUrlValue,
  handleDuplicate,
  handleDelete,
  handleArchive,
  handleStar,
  handleCopySessionId,
  startEditPrUrl,
  cancelEditPrUrl,
  savePrUrl,
  clearPrUrl,
} = useSessionActions(currentSessionId);

const activeTab = computed(() => route.params.tab || 'conversation');

// Get the session hierarchy path (for breadcrumbs)
const sessionPath = computed(() => {
  // Use route.params.id directly to be reactive to route changes
  return sessionsStore.getSessionPath(route.params.id);
});

// Command button status indicators for real-time updates (mirrors SessionCard behavior)
const buttonStatusesToDisplay = computed(() => {
  // Access commandRunVersion to establish Vue dependency tracking.
  // This forces the computed to re-evaluate whenever updateSessionCommandRun is called,
  // ensuring real-time updates on the session detail view.
  // eslint-disable-next-line no-unused-vars
  const _version = sessionsStore.commandRunVersion;

  const projectId = sessionsStore.currentSession?.projectId;
  if (!projectId) return [];

  const buttons = commandButtonsStore.getButtonsByProjectId(projectId);
  const buttonMap = Object.fromEntries(buttons.map(b => [b.id, b]));

  const latestRuns = sessionsStore.currentSession?.latestCommandRuns || [];
  return latestRuns
    .filter(run => buttonMap[run.buttonId]?.showOnList)
    .map(run => ({
      buttonId: run.buttonId,
      label: buttonMap[run.buttonId].label,
      command: buttonMap[run.buttonId].command,
      status: run.status,
      latestRun: run,
    }));
});

const tabs = computed(() => [
  { id: 'summary', label: 'Summary' },
  { id: 'conversation', label: 'Conversations' },
  { id: 'changes', label: changesFileCount.value > 0 ? `Changes (${changesFileCount.value})` : 'Changes' },
  { id: 'canvas', label: canvasItemCount.value > 0 ? `Canvas (${canvasItemCount.value})` : 'Canvas' },
  { id: 'commands', label: 'Commands' }
]);

function navigateToTab(tabId) {
  router.push(`/sessions/${route.params.id}/${tabId}`);
}

onMounted(async () => {
  // Initialize the session with WebSocket subscription and data fetching
  await initializeSession(currentSessionId.value);
});

// Watch for session changes within the same component (e.g., navigating between sessions)
// This handles the case where the route changes but the component doesn't unmount/remount
// CRITICAL: This fixes the WebSocket subscription leak bug - we must cleanup the old session
// and reinitialize with the new session to prevent messages from leaking across sessions
watch(
  () => route.params.id,
  async (newSessionId, oldSessionId) => {
    // Only proceed if the session ID actually changed
    if (newSessionId && newSessionId !== oldSessionId) {
      // STEP 1: Cleanup old session (unsubscribe WebSocket, clear handlers, reset state)
      wsCleanup();

      // STEP 2: Update the reactive session ID
      currentSessionId.value = newSessionId;

      // STEP 3: Initialize the new session (subscribe WebSocket, register handlers, fetch data)
      await initializeSession(newSessionId);
    }
  }
);

// Handle component reactivation (keep-alive) - refresh data when view becomes active again
// This ensures fresh token counts and other data when returning from another tab/session
onActivated(() => {
  if (currentSessionId.value) {
    // Refetch conversations to get latest token counts and other updated data
    sessionsStore.fetchConversations(currentSessionId.value);
  }
});

onUnmounted(() => {
  // Use the centralized cleanup/destroy function to ensure all resources are freed
  wsDestroy();
});
</script>

<style scoped>
.loading-state {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
  padding: 3rem;
}

.tab-content {
  min-height: 400px;
}

.changes-indicator {
  display: inline-block;
  width: 6px;
  height: 6px;
  background-color: var(--color-warning, #d29922);
  border-radius: 50%;
  margin-left: 4px;
  vertical-align: middle;
}

.canvas-indicator {
  display: inline-block;
  width: 6px;
  height: 6px;
  background-color: var(--color-warning, #d29922);
  border-radius: 50%;
  margin-left: 4px;
  vertical-align: middle;
}

/* Delete overlay styles */
.delete-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(2px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.delete-overlay-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  color: var(--color-text, #e0e0e0);
  font-size: 1.125rem;
}

.delete-spinner {
  display: inline-block;
  width: 3rem;
  height: 3rem;
  border: 3px solid rgba(0, 188, 212, 0.2);
  border-top-color: var(--color-primary, #00bcd4);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Fade transition for overlay */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
