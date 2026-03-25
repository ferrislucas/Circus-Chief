<template>
  <div v-if="!isSessionRunning && conversations.length > 1" class="conversation-panel">
    <!-- Compact header: conversation selector + new button -->
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

        <!-- New conversation button -->
        <button
          type="button"
          class="btn btn-new"
          @click="handleCreate"
          title="Start a new conversation"
        >
          New Conversation
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';
import ConversationTreeItem from './ConversationTreeItem.vue';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const sessionsStore = useSessionsStore();
const uiStore = useUiStore();

const isOpen = ref(false);

onMounted(() => {
  document.addEventListener('click', closeDropdown);
});

onUnmounted(() => {
  document.removeEventListener('click', closeDropdown);
});

// Computed values
const conversations = computed(() => sessionsStore.conversations);
const activeConversationId = computed(() => sessionsStore.activeConversationId);
const activeConversation = computed(() => sessionsStore.activeConversation);

const rootConversations = computed(() => {
  return conversations.value.filter(c => !c.parentConversationId);
});

const isSessionRunning = computed(() => {
  const status = sessionsStore.currentSession?.status;
  return status === 'running' || status === 'starting';
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

// Expose for testing
defineExpose({
  isOpen,
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

</style>
