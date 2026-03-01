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

    <div v-else-if="summary" class="summary-content card">
      <div v-if="generating" class="summary-updating">
        <span class="loading-spinner"></span>
        Updating summary...
      </div>

      <section class="summary-section">
        <h3>Overview</h3>
        <p class="full-summary">{{ summary.fullSummary }}</p>
      </section>

      <section v-if="summary.keyActions && summary.keyActions.length > 0" class="summary-section">
        <h3>Key Actions</h3>
        <ul class="key-actions-list">
          <li v-for="(action, index) in summary.keyActions" :key="index">
            <span class="action-icon">&#10003;</span>
            {{ action }}
          </li>
        </ul>
      </section>

      <section v-if="summary.filesModified && summary.filesModified.length > 0" class="summary-section">
        <h3>Files Modified</h3>
        <ul class="files-list">
          <li v-for="(file, index) in summary.filesModified" :key="index" class="file-item">
            <span class="file-icon">&#128196;</span>
            <code>{{ file }}</code>
          </li>
        </ul>
      </section>

      <section class="summary-section">
        <h3>Outcome</h3>
        <span :class="['outcome-badge', `outcome-${summary.outcome}`]">
          {{ formatOutcome(summary.outcome) }}
        </span>
      </section>

      <section v-if="hasPrInfo" class="summary-section" data-testid="pr-section">
        <h3>Pull Request</h3>
        <div class="pr-info">
          <!-- PR Link and State -->
          <div class="pr-header">
            <a :href="prUrl" target="_blank" class="pr-link">
              {{ extractPrNumber(prUrl) }}
            </a>
            <span :class="['status-badge', `pr-${summary.prState}`]">
              {{ formatPrState(summary.prState) }}
            </span>
          </div>

          <!-- Warnings Section -->
          <div v-if="summary.hasMergeConflicts || summary.ciStatus === 'failure'" class="pr-warnings" data-testid="pr-warnings">
            <!-- Merge Conflicts Warning -->
            <div v-if="summary.hasMergeConflicts" class="warning-item conflict-warning">
              <span class="warning-icon">⚠️</span>
              <span>Merge conflicts detected</span>
            </div>

            <!-- CI Failures Warning -->
            <div v-if="summary.ciStatus === 'failure'" class="warning-item ci-warning">
              <span class="warning-icon">❌</span>
              <span>CI checks failing</span>
              <ul v-if="summary.ciFailures?.length" class="failure-list">
                <li v-for="failure in summary.ciFailures" :key="failure" data-testid="pr-ci-failure-item">
                  {{ failure }}
                </li>
              </ul>
            </div>
          </div>

          <!-- CI Status Badge (when not failing) -->
          <div v-if="summary.ciStatus && summary.ciStatus !== 'failure'" class="ci-status" data-testid="ci-status">
            <span :class="['status-badge', `ci-${summary.ciStatus}`]">
              {{ summary.ciStatus === 'success' ? '✓ CI Passing' : '⏳ CI Pending' }}
            </span>
          </div>
        </div>
      </section>

      <div class="summary-footer">
        <span class="summary-date">
          Last updated: {{ formatDate(summary.generatedAt) }}
        </span>
        <button class="btn-link" @click="handleRegenerate" :disabled="generatingManual">
          <span v-if="generatingManual" class="loading-spinner"></span>
          Regenerate
        </button>
      </div>
    </div>

    <!-- Child Sessions Section -->
    <ChildSessionsPanel
      v-if="childSessions.length > 0"
      :sessions="childSessions"
      :parent-session-id="props.sessionId"
      :summaries="childSessionSummaries"
      :command-buttons="commandButtons"
    />

    <!-- Conversations Section -->
    <div class="conversations-section">
      <h3>Conversations</h3>

      <div v-if="loadingConversations" class="loading-state">
        <span class="loading-spinner"></span>
        Loading conversations...
      </div>

      <div v-else-if="conversations.length === 0" class="empty-conversations">
        <p>No conversations yet.</p>
      </div>

      <div v-else class="conversation-cards">
        <div
          v-for="conv in conversations"
          :key="conv.id"
          :class="['conversation-card card', { active: conv.isActive }]"
        >
          <div class="conv-header">
            <span class="conv-number">{{ getConversationNumber(conv.id) }}.</span>
            <span class="conv-name">{{ conv.name || 'Untitled' }}</span>
            <span v-if="conv.isActive" class="active-badge">Active</span>
            <span class="conv-meta">{{ conv.messageCount || 0 }} msgs</span>
          </div>

          <div class="conv-summary">
            <template v-if="conv.summary">
              {{ conv.summary }}
            </template>
            <template v-else-if="conv.isActive">
              <span class="pending-summary">Summary will generate when conversation ends</span>
            </template>
            <template v-else>
              <span class="pending-summary">No summary available</span>
            </template>
          </div>

          <div class="conv-footer">
            <button class="btn-link" @click="viewConversation(conv.id)">
              View Conversation
            </button>
          </div>
        </div>
      </div>
    </div>
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

// Get conversation number (1-indexed)
function getConversationNumber(convId) {
  const index = conversations.value.findIndex((c) => c.id === convId);
  return index + 1;
}

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

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatOutcome(outcome) {
  const labels = {
    completed: 'Task Completed Successfully',
    partial: 'Partial Progress',
    failed: 'Task Failed',
    ongoing: 'In Progress',
  };
  return labels[outcome] || outcome;
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

async function handleGenerate() {
  generatingManual.value = true;
  try {
    summary.value = await api.generateSessionSummary(props.sessionId);
    uiStore.success('Summary generated');
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    generatingManual.value = false;
  }
}

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

.empty-state {
  text-align: center;
  padding: 2rem;
  color: var(--color-text-soft);
}

.empty-state p {
  margin-bottom: 1rem;
}

.summary-content {
  position: relative;
}

.summary-updating {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.summary-section {
  margin-bottom: 1.5rem;
}

.summary-section:last-of-type {
  margin-bottom: 0;
}

.summary-section h3 {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-soft);
  margin: 0 0 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.full-summary {
  margin: 0;
  line-height: 1.6;
}

.key-actions-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.key-actions-list li {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.action-icon {
  color: var(--color-success);
  flex-shrink: 0;
}

.files-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.file-icon {
  flex-shrink: 0;
}

.file-item code {
  font-family: var(--font-mono);
  font-size: 0.875rem;
  background-color: var(--color-bg-soft);
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
}

.outcome-badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.875rem;
  font-weight: 500;
}

.outcome-completed {
  background-color: rgba(46, 160, 67, 0.15);
  color: var(--color-success);
}

.outcome-partial {
  background-color: rgba(210, 153, 34, 0.15);
  color: var(--color-warning);
}

.outcome-failed {
  background-color: rgba(248, 81, 73, 0.15);
  color: var(--color-error);
}

.outcome-ongoing {
  background-color: rgba(88, 166, 255, 0.15);
  color: var(--color-primary);
}

.summary-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}

.summary-date {
  font-size: 0.75rem;
  color: var(--color-text-soft);
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
.pr-info {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.pr-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

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

.pr-warnings {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.warning-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  font-size: 0.875rem;
}

.conflict-warning {
  background-color: rgba(248, 81, 73, 0.1);
  color: var(--color-error);
}

.ci-warning {
  background-color: rgba(248, 81, 73, 0.1);
  color: var(--color-error);
  flex-wrap: wrap;
}

.failure-list {
  width: 100%;
  margin: 0.25rem 0 0 1.5rem;
  padding: 0;
  font-size: 0.8rem;
  opacity: 0.9;
  list-style: disc;
}

.ci-status {
  margin-top: 0.25rem;
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

/* Conversations Section Styles */
.conversations-section {
  margin-bottom: 1.5rem;
}

.conversations-section h3 {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-soft);
  margin: 0 0 1rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.empty-conversations {
  text-align: center;
  padding: 1.5rem;
  color: var(--color-text-soft);
  background: var(--color-background-soft);
  border-radius: var(--border-radius);
}

.empty-conversations p {
  margin: 0;
}

.conversation-cards {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.conversation-card {
  padding: 1rem;
  transition: border-color 0.15s;
}

.conversation-card.active {
  border-color: var(--color-primary);
  border-left: 3px solid var(--color-primary);
}

.conv-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.conv-number {
  font-weight: 600;
  color: var(--color-text-soft);
}

.conv-name {
  font-weight: 500;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.active-badge {
  padding: 0.125rem 0.5rem;
  background: rgba(88, 166, 255, 0.15);
  color: var(--color-primary);
  border-radius: 9999px;
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
}

.conv-meta {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  white-space: nowrap;
}

.conv-summary {
  font-size: 0.875rem;
  color: var(--color-text);
  line-height: 1.5;
  margin-bottom: 0.75rem;
}

.pending-summary {
  color: var(--color-text-soft);
  font-style: italic;
}

.conv-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
