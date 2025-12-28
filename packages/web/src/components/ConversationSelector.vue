<template>
  <div class="conversation-selector">
    <div class="selector-row">
      <!-- Dropdown -->
      <div v-if="conversations.length > 1" class="dropdown-container">
        <button
          type="button"
          class="dropdown-trigger"
          :disabled="isDisabled"
          @click.stop="toggleDropdown"
          :title="isDisabled ? 'Stop the session to switch conversations' : 'Switch conversation'"
        >
          <span class="dropdown-label">
            {{ activeConversationDisplayName }}
          </span>
          <span v-if="isDisabled" class="lock-icon">🔒</span>
          <span v-else class="dropdown-arrow">▼</span>
        </button>

        <div v-if="isOpen && !isDisabled" class="dropdown-menu">
          <div
            v-for="(conv, index) in conversations"
            :key="conv.id"
            :class="['dropdown-item', { active: conv.id === activeConversationId }]"
            @click="selectConversation(conv.id)"
          >
            <span class="conv-name">{{ getConversationDisplayName(conv, index) }}</span>
            <span class="conv-meta">
              {{ conv.messageCount || 0 }} msgs
              <span v-if="getConversationTokens(conv)" class="conv-tokens">
                · {{ getConversationTokens(conv) }}
              </span>
            </span>
            <button
              v-if="conversations.length > 1 && conv.id !== activeConversationId"
              type="button"
              class="delete-btn"
              @click.stop="handleDelete(conv.id)"
              title="Delete conversation"
            >
              ×
            </button>
          </div>
        </div>
      </div>

      <!-- New Conversation Button -->
      <button
        type="button"
        class="btn btn-new"
        :disabled="isDisabled"
        @click="handleCreate"
        :title="isDisabled ? 'Stop the session to create new conversation' : 'Start a new conversation'"
      >
        <span v-if="isDisabled" class="lock-icon">🔒</span>
        <span v-else>+</span>
        new conversation
      </button>
    </div>

    <!-- Warning message when disabled -->
    <div v-if="isDisabled && showWarning" class="warning-message">
      Stop the session to switch or create conversations
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const sessionsStore = useSessionsStore();
const uiStore = useUiStore();

const isOpen = ref(false);
const showWarning = ref(false);

const conversations = computed(() => sessionsStore.conversations);
const activeConversationId = computed(() => sessionsStore.activeConversationId);
const activeConversation = computed(() => sessionsStore.activeConversation);

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
  const total = (conv.inputTokens || 0) + (conv.outputTokens || 0);
  return formatTokens(total);
}

// Get display name for the active conversation
const activeConversationDisplayName = computed(() => {
  if (!activeConversation.value) return 'Select conversation';
  const index = conversations.value.findIndex(c => c.id === activeConversationId.value);
  return getConversationDisplayName(activeConversation.value, index >= 0 ? index : 0);
});

// Disable switching while session is running
const isDisabled = computed(() => {
  return sessionsStore.currentSession?.status === 'running';
});

function toggleDropdown() {
  if (isDisabled.value) {
    showWarning.value = true;
    setTimeout(() => { showWarning.value = false; }, 3000);
    return;
  }
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
  if (isDisabled.value) {
    showWarning.value = true;
    setTimeout(() => { showWarning.value = false; }, 3000);
    return;
  }

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
  max-width: 300px;
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

.dropdown-trigger:hover:not(:disabled) {
  border-color: var(--color-primary);
}

.dropdown-trigger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  background: var(--color-background-soft);
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

.lock-icon {
  font-size: 0.75rem;
  margin-left: 0.5rem;
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 0.25rem;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 100;
  max-height: 250px;
  overflow-y: auto;
}

.dropdown-item {
  display: flex;
  align-items: center;
  padding: 0.625rem 0.75rem;
  cursor: pointer;
  transition: background-color 0.15s;
  gap: 0.5rem;
}

.dropdown-item:hover {
  background: var(--color-background-soft);
}

.dropdown-item.active {
  background: rgba(88, 166, 255, 0.1);
  border-left: 3px solid var(--color-primary);
}

.conv-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
}

.conv-meta {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  white-space: nowrap;
}

.conv-tokens {
  font-family: var(--font-mono);
}

.delete-btn {
  padding: 0.125rem 0.375rem;
  background: transparent;
  border: none;
  color: var(--color-text-soft);
  font-size: 1rem;
  cursor: pointer;
  border-radius: 0.25rem;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, background-color 0.15s;
}

.dropdown-item:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: var(--color-danger, #ef4444);
  color: white;
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

.btn-new:hover:not(:disabled) {
  border-color: var(--color-primary);
  background: var(--color-background-soft);
}

.btn-new:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.warning-message {
  margin-top: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: var(--border-radius);
  color: var(--color-warning, #f59e0b);
  font-size: 0.75rem;
}
</style>
