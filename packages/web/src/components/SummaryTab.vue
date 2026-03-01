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

    <!-- Session Summary Section (existing) -->
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
      :generating-manual="generatingManual"
      :has-pr-info="hasPrInfo"
      :pr-url="prUrl"
      :format-outcome="formatOutcome"
      :format-pr-state="formatPrState"
      :extract-pr-number="extractPrNumber"
      :format-date="formatDate"
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
    <ConversationSummaryList
      :conversations="conversations"
      :loading-conversations="loadingConversations"
      :get-conversation-number="getConversationNumber"
      @view-conversation="viewConversation"
    />
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router';
import { useUiStore } from '../stores/ui.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useSummaryData } from '../composables/useSummaryData.js';
import ChildSessionsPanel from './ChildSessionsPanel.vue';
import SummaryContent from './SummaryContent.vue';
import ConversationSummaryList from './ConversationSummaryList.vue';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const router = useRouter();
const uiStore = useUiStore();
const sessionsStore = useSessionsStore();

const {
  summary,
  childSessionSummaries,
  loading,
  generating,
  generatingManual,
  loadingConversations,
  conversations,
  session,
  prUrl,
  hasPrInfo,
  childSessions,
  commandButtons,
  totalMessages,
  getConversationNumber,
  formatDate,
  formatOutcome,
  formatPrState,
  extractPrNumber,
  handleRegenerate,
} = useSummaryData(props.sessionId);

// Navigate to conversation tab with specific conversation
function viewConversation(conversationId) {
  // Switch to the conversation in the store
  sessionsStore.switchConversation(props.sessionId, conversationId).then(() => {
    // Navigate to conversation tab
    router.push({
      name: 'session-detail',
      params: { id: props.sessionId, tab: 'conversation' },
    });
  }).catch((err) => {
    uiStore.error(err.message);
  });
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

.empty-state {
  text-align: center;
  padding: 2rem;
  color: var(--color-text-soft);
}

.empty-state p {
  margin-bottom: 1rem;
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

/* PR Status Styles */
.pr-link {
  color: var(--color-primary);
  text-decoration: none;
  font-weight: 500;
}

.pr-link:hover {
  text-decoration: underline;
}

.status-badge {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
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

.overview-pr {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border);
}
</style>
