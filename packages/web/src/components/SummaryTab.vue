<template>
  <div class="summary-tab">
    <!-- Session Overview Section -->
    <div class="session-overview card">
      <div class="overview-header">
        <h3>Session Overview</h3>
        <button class="btn-link" @click="handleRegenerate" :disabled="generatingManual || generating">
          <span v-if="generatingManual" class="loading-spinner"></span>
          Regenerate
        </button>
      </div>

      <div class="overview-stats">
        <div class="stat-item">
          <span class="stat-value">{{ conversations.length }}</span>
          <span class="stat-label">Conversations</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ totalMessages }}</span>
          <span class="stat-label">Messages</span>
        </div>
        <div v-if="session" class="stat-item">
          <span class="stat-value status-badge" :class="`status-${session.status}`">{{ session.status }}</span>
          <span class="stat-label">Status</span>
        </div>
      </div>

      <!-- PR Info in Overview -->
      <div v-if="hasPrInfo" class="overview-pr" data-testid="pr-overview-badge">
        <a :href="prUrl" target="_blank" class="pr-link">
          {{ extractPrNumber(prUrl) }}
        </a>
        <span :class="['status-badge', `pr-${summary?.prState}`]">
          {{ formatPrState(summary?.prState) }}
        </span>
        <span v-if="summary?.ciStatus" :class="['status-badge', `ci-${summary.ciStatus}`]">
          {{ summary.ciStatus === 'success' ? 'CI Passing' : summary.ciStatus === 'failure' ? 'CI Failing' : 'CI Pending' }}
        </span>
      </div>
    </div>

    <!-- Session Summary Section -->
    <div v-if="loading" class="loading-state">
      <span class="loading-spinner"></span>
      Loading summary...
    </div>

    <div v-else-if="generating" class="generating-state">
      <span class="loading-spinner"></span>
      Generating summary...
    </div>

    <SummaryContent
      v-else-if="summary"
      :summary="summary"
      :generating="generating"
      :regenerating="generatingManual"
      :has-pr-info="hasPrInfo"
      :pr-url="prUrl"
      @regenerate="handleRegenerate"
    />

    <!-- Child Sessions Section -->
    <ChildSessionsPanel
      v-if="childSessions.length > 0"
      :sessions="childSessions"
      :parent-session-id="props.sessionId"
      :summaries="childSessionSummaries"
      :command-buttons="commandButtons"
    />

    <!-- Conversations Section -->
    <SummaryConversationList
      :conversations="conversations"
      :loading="loadingConversations"
      @view-conversation="viewConversation"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../composables/useApi.js';
import { useUiStore } from '../stores/ui.js';
import { useSessionSubscription } from '../composables/useWebSocket.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import ChildSessionsPanel from './ChildSessionsPanel.vue';
import SummaryContent from './SummaryContent.vue';
import SummaryConversationList from './SummaryConversationList.vue';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const router = useRouter();
const uiStore = useUiStore();
const sessionsStore = useSessionsStore();
const commandButtonsStore = useCommandButtonsStore();
const { onSummaryUpdate, onSummaryGenerating } = useSessionSubscription(props.sessionId);

const summary = ref(null);
const childSessionSummaries = ref({});
const loading = ref(false);
const generating = ref(false);
const generatingManual = ref(false);
const loadingConversations = ref(false);
const conversations = ref([]);

// Computed property to get the session's prUrl
// Check both sessions array and currentSession (the latter is always populated on session detail page)
const session = computed(() =>
  sessionsStore.sessions.find((s) => s.id === props.sessionId)
  || (sessionsStore.currentSession?.id === props.sessionId ? sessionsStore.currentSession : null)
);
const prUrl = computed(() => session.value?.prUrl || null);
const hasPrInfo = computed(() => prUrl.value && summary.value?.prState);

// Get child sessions for this session
const childSessions = computed(() => {
  return sessionsStore.getChildSessions(props.sessionId);
});

// Command buttons for child session indicators
const commandButtons = computed(() => {
  const projectId = session.value?.projectId;
  if (!projectId) return [];
  return commandButtonsStore.getButtonsByProjectId(projectId);
});

// Calculate total messages across all conversations
const totalMessages = computed(() => {
  return conversations.value.reduce((sum, conv) => sum + (conv.messageCount || 0), 0);
});

// Fetch summaries for child sessions
async function fetchChildSummaries() {
  const children = sessionsStore.getChildSessions(props.sessionId);
  for (const child of children) {
    if (!childSessionSummaries.value[child.id]) {
      try {
        const summaryData = await api.getSessionSummary(child.id);
        childSessionSummaries.value[child.id] = summaryData;
      } catch (e) {
        // Ignore - summary may not exist
      }
    }
  }
}

// Navigate to conversation tab with specific conversation
function viewConversation(conversationId) {
  sessionsStore.switchConversation(props.sessionId, conversationId).then(() => {
    router.push({
      name: 'session-detail',
      params: { id: props.sessionId, tab: 'conversation' },
    });
  }).catch((err) => {
    uiStore.error(err.message);
  });
}

function formatPrState(state) {
  const labels = {
    merged: 'Merged',
    open: 'Open',
    closed: 'Closed',
    draft: 'Draft',
  };
  return labels[state] || state;
}

function extractPrNumber(url) {
  if (!url) return 'PR';
  const match = url.match(/\/pull\/(\d+)/);
  return match ? `PR #${match[1]}` : 'PR';
}

onMounted(async () => {
  // Fetch conversations
  loadingConversations.value = true;
  try {
    conversations.value = await api.getConversations(props.sessionId);
  } catch (err) {
    console.error('Failed to load conversations:', err);
  } finally {
    loadingConversations.value = false;
  }

  // Fetch summaries for child sessions (don't await - not critical path)
  fetchChildSummaries();

  // Fetch session summary
  loading.value = true;
  try {
    summary.value = await api.getSessionSummary(props.sessionId);
  } catch (err) {
    // Don't show error for missing summary
    if (!err.message.includes('404')) {
      uiStore.error(err.message);
    }
  } finally {
    loading.value = false;
  }

  // Listen for WebSocket updates
  onSummaryUpdate((newSummary) => {
    summary.value = newSummary;
    generating.value = false;       // Belt-and-suspenders: summary arrived = not generating
    generatingManual.value = false;
  });

  onSummaryGenerating((isGenerating) => {
    generating.value = isGenerating;
  });
});

onUnmounted(() => {
  // Clean up if needed
});

async function handleRegenerate() {
  generatingManual.value = true;
  try {
    summary.value = await api.generateSessionSummary(props.sessionId);
    uiStore.success('Summary regenerated');
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    generatingManual.value = false;
  }
}
</script>

<style scoped>
.summary-tab {
  padding: 1rem 0;
}

.loading-state,
.generating-state {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
  padding: 2rem;
}

.btn-link {
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.btn-link:hover {
  text-decoration: underline;
}

.btn-link:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Session Overview Styles */
.session-overview {
  margin-bottom: 1.5rem;
}

.overview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.overview-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.overview-stats {
  display: flex;
  gap: 2rem;
  margin-bottom: 1rem;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.stat-value {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text);
}

.stat-label {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.status-badge {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
}

.status-running {
  background: rgba(88, 166, 255, 0.15);
  color: var(--color-primary);
}

.status-waiting {
  background: rgba(210, 153, 34, 0.15);
  color: var(--color-warning);
}

.status-completed {
  background: rgba(46, 160, 67, 0.15);
  color: var(--color-success);
}

.status-stopped, .status-error {
  background: rgba(248, 81, 73, 0.15);
  color: var(--color-error);
}

.status-badge.pr-merged {
  background: rgba(130, 80, 223, 0.15);
  color: #8250df;
}

.status-badge.pr-open {
  background: rgba(46, 160, 67, 0.15);
  color: var(--color-success);
}

.status-badge.pr-closed {
  background: rgba(110, 119, 129, 0.15);
  color: #6e7781;
}

.status-badge.pr-draft {
  background: rgba(210, 153, 34, 0.15);
  color: var(--color-warning);
}

.status-badge.ci-success {
  background: rgba(46, 160, 67, 0.15);
  color: var(--color-success);
}

.status-badge.ci-pending {
  background: rgba(210, 153, 34, 0.15);
  color: var(--color-warning);
}

.overview-pr {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border);
}

.pr-link {
  color: var(--color-primary);
  text-decoration: none;
  font-weight: 500;
}

.pr-link:hover {
  text-decoration: underline;
}
</style>
