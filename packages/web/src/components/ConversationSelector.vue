<template>
  <div
    v-if="!isSessionRunning"
    class="conversation-selector"
  >
    <div class="selector-row">
      <!-- Dropdown -->
      <div
        v-if="conversations.length > 1"
        class="dropdown-container"
      >
        <button
          type="button"
          class="dropdown-trigger"
          data-testid="conversation-selector"
          title="Switch conversation"
          @click.stop="toggleDropdown"
        >
          <span class="dropdown-label">
            {{ activeConversationDisplayName }}
          </span>
          <span class="dropdown-arrow">▼</span>
        </button>

        <div
          v-if="isOpen"
          class="dropdown-menu"
        >
          <!-- Tree view of conversations -->
          <ConversationTreeItem
            v-for="(conv, index) in rootConversations"
            :key="conv.id"
            :conversation="conv"
            :index="index"
            :depth="0"
            :all-conversations="conversations"
            :active-conversation-id="activeConversationId"
            @select="selectConversation"
            @delete="handleDelete"
          />
        </div>
      </div>

      <!-- New Conversation Button -->
      <button
        type="button"
        class="btn btn-new"
        title="Start a new conversation"
        @click="handleCreate"
      >
        <span>+</span>
        new conversation
      </button>
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

const conversations = computed(() => sessionsStore.conversations);
const activeConversationId = computed(() => sessionsStore.activeConversationId);
const activeConversation = computed(() => sessionsStore.activeConversation);

// Root conversations are those without a parent (top-level)
const rootConversations = computed(() => conversations.value.filter(c => !c.parentConversationId));

// Check if session is currently running or starting
const isSessionRunning = computed(() => {
  const status = sessionsStore.currentSession?.status;
  return status === 'running' || status === 'starting';
});

// Convert number to ordinal (1→"1st", 2→"2nd", 3→"3rd", 4→"4th", etc.)
function toOrdinal(num) {
  const j = num % 10;
  const k = num % 100;
  if (j === 1 && k !== 11) return `${num}st`;
  if (j === 2 && k !== 12) return `${num}nd`;
  if (j === 3 && k !== 13) return `${num}rd`;
  return `${num}th`;
}

// Generate display names for conversations (fallback to ordinal format if no name)
function getConversationDisplayName(conv, index) {
  return conv.name || `${toOrdinal(index + 1)} conversation`;
}

// Format token count for display (Issue #175)
function formatTokens(n) {
  if (!n || n === 0) return null;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function getConversationTokens(conv) {
  // Use the store getter for real-time token updates during streaming
  const tokens = sessionsStore.getConversationDisplayTokens(conv.id);
  return formatTokens(tokens.total);
}

// Get display name for the active conversation
const activeConversationDisplayName = computed(() => {
  if (!activeConversation.value) return 'Select conversation';
  const index = conversations.value.findIndex(c => c.id === activeConversationId.value);
  return getConversationDisplayName(activeConversation.value, index >= 0 ? index : 0);
});

function toggleDropdown() {
  isOpen.value = !isOpen.value;
}

function closeDropdown(event) {
  // Close dropdown if clicking outside
  const container = document.querySelector('.conversation-selector');
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

onMounted(() => {
  document.addEventListener('click', closeDropdown);
});

onUnmounted(() => {
  document.removeEventListener('click', closeDropdown);
});

// Expose internal state and methods for testing
defineExpose({
  isOpen,
  toggleDropdown,
  closeDropdown,
});
</script>

<style scoped>
.conversation-selector {
  margin-bottom: 1rem;
}

.selector-row {
  display: flex;
  gap: 0.5rem;
  align-items: stretch;
}

.dropdown-container {
  position: relative;
  flex: 1;
  max-width: 350px;
}

.dropdown-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  color: var(--color-text);
  font-size: 0.875rem;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
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
  font-size: 0.625rem;
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

.btn-new {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem 0.75rem;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  color: var(--color-text);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
  white-space: nowrap;
}

.btn-new:hover {
  border-color: var(--color-primary);
  background: var(--color-background-soft);
}
</style>
