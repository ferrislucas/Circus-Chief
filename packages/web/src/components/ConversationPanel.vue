<template>
  <div v-if="!isSessionRunning" class="conversation-panel">
    <!-- Compact header: conversation selector + BTE + new button -->
    <div class="panel-header">
      <div class="header-row">
        <!-- Conversation dropdown -->
        <div v-if="conversations.length > 1" class="dropdown-container">
          <button
            type="button"
            class="dropdown-trigger"
            data-testid="conversation-selector"
            @click.stop="toggleDropdown"
            title="Switch conversation"
          >
            <span class="dropdown-label">
              {{ activeConversationDisplayName }}
            </span>
            <span class="dropdown-arrow">▼</span>
          </button>

          <div v-if="isOpen" class="dropdown-menu">
            <ConversationTreeItem
              v-for="(conv, index) in rootConversations"
              :key="conv.id"
              :conversation="conv"
              :index="index"
              :depth="0"
              :all-conversations="conversations"
              :active-conversation-id="activeConversationId"
              :show-bte="true"
              @select="selectConversation"
              @delete="handleDelete"
            />
          </div>
        </div>

        <!-- Cost display (collapsed view) -->
        <div v-if="!isExpanded" class="cost-display" @click="isExpanded = true" title="Billable Token Equivalent - weighted token cost where output tokens are 5x and cache varies">
          <span class="cost-label">Cost:</span>
          <span class="cost-value">{{ formattedBillableTokens }}</span>
          <span v-if="isUpdating" class="updating-indicator">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
          </span>
        </div>

        <!-- Toggle expand button -->
        <button
          type="button"
          class="toggle-btn"
          @click="isExpanded = !isExpanded"
          :title="isExpanded ? 'Collapse' : 'Expand'"
        >
          {{ isExpanded ? '▲' : '▼' }}
        </button>

        <!-- New conversation button -->
        <button
          type="button"
          class="btn btn-new"
          @click="handleCreate"
          title="Start a new conversation"
        >
          <span>+</span>
          New
        </button>
      </div>
    </div>

    <!-- Expanded token breakdown -->
    <div v-if="isExpanded" class="token-breakdown">
      <div class="bte-header" title="Billable Token Equivalent - weighted token cost where output tokens are 5x and cache varies">
        <span class="bte-label">Cost:</span>
        <span class="bte-value">{{ formattedBillableTokens }}</span>
        <span v-if="isUpdating" class="updating-indicator">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </span>
      </div>

      <div class="token-grid">
        <div class="token-item">
          <div class="token-type">Input</div>
          <div class="token-count">{{ formattedTokens.input }}</div>
          <div class="token-weight">×{{ weights.input }}</div>
          <div class="token-weighted">={{ formatWeighted(inputTokens, weights.input) }}</div>
        </div>
        <div class="token-item">
          <div class="token-type">Output</div>
          <div class="token-count">{{ formattedTokens.output }}</div>
          <div class="token-weight">×{{ weights.output }}</div>
          <div class="token-weighted">={{ formatWeighted(outputTokens, weights.output) }}</div>
        </div>
        <div class="token-item" title="Tokens read from cache (90% discount)">
          <div class="token-type">Cache Read</div>
          <div class="token-count">{{ formattedTokens.cacheRead }}</div>
          <div class="token-weight">×{{ weights.cacheRead }}</div>
          <div class="token-weighted">={{ formatWeighted(cacheReadTokens, weights.cacheRead) }}</div>
        </div>
        <div class="token-item" title="Tokens written to cache (25% premium)">
          <div class="token-type">Cache Create</div>
          <div class="token-count">{{ formattedTokens.cacheCreation }}</div>
          <div class="token-weight">×{{ weights.cacheCreation }}</div>
          <div class="token-weighted">={{ formatWeighted(cacheCreationTokens, weights.cacheCreation) }}</div>
        </div>
      </div>

      <div class="breakdown-footer">
        <button type="button" class="settings-btn" @click="openSettings" title="Configure token cost weights">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
      </div>
    </div>

    <!-- Settings modal -->
    <TokenWeightsModal :is-open="showSettings" @close="showSettings = false" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useSettingsStore } from '../stores/settings.js';
import { useUiStore } from '../stores/ui.js';
import { formatTokenCount } from '@claudetools/shared';
import ConversationTreeItem from './ConversationTreeItem.vue';
import TokenWeightsModal from './TokenWeightsModal.vue';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const sessionsStore = useSessionsStore();
const settingsStore = useSettingsStore();
const uiStore = useUiStore();

const isOpen = ref(false);
const isExpanded = ref(false);
const showSettings = ref(false);

// Fetch token weights on mount
onMounted(() => {
  settingsStore.fetchTokenCostWeights();
  document.addEventListener('click', closeDropdown);
});

onUnmounted(() => {
  document.removeEventListener('click', closeDropdown);
});

// Computed values
const conversations = computed(() => sessionsStore.conversations);
const activeConversationId = computed(() => sessionsStore.activeConversationId);
const activeConversation = computed(() => sessionsStore.activeConversation);
const weights = computed(() => settingsStore.tokenCostWeights);

const rootConversations = computed(() => {
  return conversations.value.filter(c => !c.parentConversationId);
});

const isSessionRunning = computed(() => {
  const status = sessionsStore.currentSession?.status;
  return status === 'running' || status === 'starting';
});

const formattedTokens = computed(() => sessionsStore.formattedTokens);
const formattedBillableTokens = computed(() => sessionsStore.formattedBillableTokens);
const isUpdating = computed(() => sessionsStore.isUsageUpdating);

// Raw token values for weighted calculations
const inputTokens = computed(() => {
  if (sessionsStore.runningUsage && sessionsStore.runningUsage.conversationId === sessionsStore.activeConversationId) {
    const conv = sessionsStore.activeConversation;
    return (conv?.inputTokens || 0) + (sessionsStore.runningUsage.inputTokens || 0);
  }
  return sessionsStore.activeConversation?.inputTokens || 0;
});

const outputTokens = computed(() => {
  if (sessionsStore.runningUsage && sessionsStore.runningUsage.conversationId === sessionsStore.activeConversationId) {
    const conv = sessionsStore.activeConversation;
    return (conv?.outputTokens || 0) + (sessionsStore.runningUsage.outputTokens || 0);
  }
  return sessionsStore.activeConversation?.outputTokens || 0;
});

const cacheReadTokens = computed(() => {
  if (sessionsStore.runningUsage && sessionsStore.runningUsage.conversationId === sessionsStore.activeConversationId) {
    const conv = sessionsStore.activeConversation;
    return (conv?.cacheReadInputTokens || 0) + (sessionsStore.runningUsage.cacheReadInputTokens || 0);
  }
  return sessionsStore.activeConversation?.cacheReadInputTokens || 0;
});

const cacheCreationTokens = computed(() => {
  if (sessionsStore.runningUsage && sessionsStore.runningUsage.conversationId === sessionsStore.activeConversationId) {
    const conv = sessionsStore.activeConversation;
    return (conv?.cacheCreationInputTokens || 0) + (sessionsStore.runningUsage.cacheCreationInputTokens || 0);
  }
  return sessionsStore.activeConversation?.cacheCreationInputTokens || 0;
});

// Convert number to ordinal
function toOrdinal(num) {
  const j = num % 10;
  const k = num % 100;
  if (j === 1 && k !== 11) return `${num}st`;
  if (j === 2 && k !== 12) return `${num}nd`;
  if (j === 3 && k !== 13) return `${num}rd`;
  return `${num}th`;
}

function getConversationDisplayName(conv, index) {
  return conv.name || `${toOrdinal(index + 1)} conversation`;
}

const activeConversationDisplayName = computed(() => {
  if (!activeConversation.value) return 'Select conversation';
  const index = conversations.value.findIndex(c => c.id === activeConversationId.value);
  return getConversationDisplayName(activeConversation.value, index >= 0 ? index : 0);
});

function formatWeighted(count, weight) {
  const weighted = (count || 0) * weight;
  return formatTokenCount(Math.round(weighted));
}

function toggleDropdown() {
  isOpen.value = !isOpen.value;
}

function closeDropdown(event) {
  const container = document.querySelector('.conversation-panel');
  if (container && !container.contains(event.target)) {
    isOpen.value = false;
  }
}

async function selectConversation(conversationId) {
  if (conversationId === activeConversationId.value) {
    isOpen.value = false;
    return;
  }

  try {
    await sessionsStore.switchConversation(props.sessionId, conversationId);
    isOpen.value = false;
  } catch (err) {
    uiStore.error(err.message);
  }
}

async function handleCreate() {
  try {
    await sessionsStore.createConversation(props.sessionId);
    uiStore.success('New conversation created');
  } catch (err) {
    uiStore.error(err.message);
  }
}

async function handleDelete(conversationId) {
  if (!confirm('Delete this conversation? This action cannot be undone.')) {
    return;
  }

  try {
    await sessionsStore.deleteConversation(props.sessionId, conversationId);
    isOpen.value = false;
    uiStore.success('Conversation deleted');
  } catch (err) {
    uiStore.error(err.message);
  }
}

function openSettings() {
  showSettings.value = true;
}

// Expose for testing
defineExpose({
  isOpen,
  isExpanded,
  toggleDropdown,
  closeDropdown,
});
</script>

<style scoped>
.conversation-panel {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  margin-bottom: 1rem;
}

.panel-header {
  padding: 0.5rem 0.75rem;
}

.header-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.dropdown-container {
  position: relative;
  flex: 1;
  max-width: 300px;
}

.dropdown-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0.4rem 0.6rem;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  color: var(--color-text);
  font-size: 0.875rem;
  cursor: pointer;
  transition: border-color 0.15s;
}

.dropdown-trigger:hover {
  border-color: var(--color-primary);
}

.dropdown-label {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdown-arrow {
  font-size: 0.5rem;
  color: var(--color-text-soft);
  margin-left: 0.5rem;
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 100%;
  width: max-content;
  max-width: 450px;
  margin-top: 0.25rem;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 100;
  max-height: 350px;
  overflow-y: auto;
  padding: 0.25rem;
}

.cost-display {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.5rem;
  background: var(--color-background);
  border-radius: var(--border-radius);
  cursor: pointer;
  transition: background-color 0.15s;
}

.cost-display:hover {
  background: var(--color-background-mute);
}

.cost-label {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.cost-value {
  font-family: var(--font-mono);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-accent, var(--color-primary));
}

.toggle-btn {
  background: none;
  border: none;
  color: var(--color-text-soft);
  font-size: 0.5rem;
  cursor: pointer;
  padding: 0.25rem;
}

.toggle-btn:hover {
  color: var(--color-text);
}

.btn-new {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.4rem 0.6rem;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  color: var(--color-text);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
  white-space: nowrap;
  margin-left: auto;
}

.btn-new:hover {
  border-color: var(--color-primary);
  background: var(--color-background-soft);
}

@media (max-width: 480px) {
  .btn-new {
    margin-left: 0;
    flex: 1 0 100%;
    justify-content: center;
  }
}

/* Token breakdown (expanded) */
.token-breakdown {
  padding: 0.75rem;
  border-top: 1px solid var(--color-border);
}

.bte-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.bte-label {
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.bte-value {
  font-family: var(--font-mono);
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--color-accent, var(--color-primary));
}

.token-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

@media (min-width: 640px) {
  .token-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.token-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.5rem;
  background: var(--color-background);
  border-radius: 0.25rem;
  text-align: center;
}

.token-type {
  font-size: 0.625rem;
  text-transform: uppercase;
  color: var(--color-text-soft);
  margin-bottom: 0.25rem;
}

.token-count {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text);
}

.token-weight {
  font-size: 0.625rem;
  color: var(--color-text-soft);
}

.token-weighted {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  color: var(--color-accent, var(--color-primary));
}

.breakdown-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  color: var(--color-text-soft);
  cursor: pointer;
  transition: all 0.15s;
}

.settings-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
  background: var(--color-background-soft);
}

/* Updating indicator */
.updating-indicator {
  display: flex;
  gap: 2px;
  align-items: center;
}

.updating-indicator .dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background-color: var(--color-accent, var(--color-primary));
  animation: pulse 1.4s ease-in-out infinite;
}

.updating-indicator .dot:nth-child(2) {
  animation-delay: 0.2s;
}

.updating-indicator .dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes pulse {
  0%, 80%, 100% {
    opacity: 0.3;
    transform: scale(0.8);
  }
  40% {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
