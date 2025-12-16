<template>
  <div class="conversation-tab">
    <div class="messages" ref="messagesContainer">
      <div
        v-for="message in sessionsStore.messages"
        :key="message.id"
        :class="['message', `message-${message.role}`]"
      >
        <div class="message-header">
          <span class="message-role">{{ message.role }}</span>
          <span class="message-time">{{ formatTime(message.timestamp) }}</span>
        </div>
        <div class="message-content">{{ message.content }}</div>
        <div v-if="message.toolUse?.length" class="message-tools">
          <details v-for="(tool, idx) in message.toolUse" :key="idx">
            <summary>Tool: {{ tool.name }}</summary>
            <pre>{{ JSON.stringify(tool.input, null, 2) }}</pre>
          </details>
        </div>
      </div>

      <!-- Streaming partial message -->
      <div v-if="partialText" class="message message-assistant message-streaming">
        <div class="message-header">
          <span class="message-role">assistant</span>
          <span class="streaming-indicator">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
          </span>
        </div>
        <div class="message-content">{{ partialText }}</div>
      </div>

      <!-- Jump to latest button -->
      <button
        v-if="!isNearBottom && hasNewMessages"
        class="jump-to-latest"
        @click="scrollToBottom(true)"
      >
        New messages below
      </button>
    </div>

    <!-- Todo drawer - only shows when todos exist -->
    <TodoDrawer />

    <form v-if="canSendMessage" @submit.prevent="handleSend" class="input-form">
      <textarea
        v-model="input"
        class="form-input form-textarea"
        placeholder="Send a follow-up message..."
        rows="3"
        @keydown.enter.ctrl="handleSend"
      ></textarea>
      <div class="input-actions">
        <button type="submit" class="btn btn-primary" :disabled="!input.trim() || sending">
          <span v-if="sending" class="loading-spinner"></span>
          Send
        </button>
        <button type="button" class="btn btn-secondary" @click="handleEndSession" :disabled="ending">
          End Session
        </button>
      </div>
    </form>

    <div v-else-if="sessionsStore.currentSession?.status === 'running'" class="status-message">
      <span class="loading-spinner"></span>
      Claude is working...
    </div>

    <div v-else-if="sessionsStore.currentSession?.status === 'completed'" class="status-message status-completed">
      Session completed
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';
import { useSessionSubscription } from '../composables/useWebSocket.js';
import TodoDrawer from './TodoDrawer.vue';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const sessionsStore = useSessionsStore();
const uiStore = useUiStore();

const input = ref('');
const sending = ref(false);
const ending = ref(false);
const messagesContainer = ref(null);
const partialText = ref('');
const isNearBottom = ref(true);
const hasNewMessages = ref(false);
let debounceTimer = null;

const SCROLL_THRESHOLD = 100; // pixels from bottom to consider "at bottom"

const STORAGE_KEY = `session-draft-${props.sessionId}`;

const canSendMessage = computed(() => {
  return sessionsStore.currentSession?.status === 'waiting';
});

// Subscribe to partial messages for streaming
const { onPartial, onMessage } = useSessionSubscription(props.sessionId);
let unsubPartial = null;
let unsubMessage = null;

function handleScroll() {
  if (!messagesContainer.value) return;
  const { scrollTop, scrollHeight, clientHeight } = messagesContainer.value;
  const wasNearBottom = isNearBottom.value;
  isNearBottom.value = scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;

  // Clear new messages indicator when user scrolls to bottom
  if (isNearBottom.value && !wasNearBottom) {
    hasNewMessages.value = false;
  }
}

onMounted(() => {
  // Load draft from localStorage
  const savedDraft = localStorage.getItem(STORAGE_KEY);
  if (savedDraft) {
    input.value = savedDraft;
  }

  // Add scroll event listener
  if (messagesContainer.value) {
    messagesContainer.value.addEventListener('scroll', handleScroll);
  }

  unsubPartial = onPartial((text) => {
    partialText.value = text;
    scrollToBottom();
  });

  // Clear partial text when full message arrives
  unsubMessage = onMessage(() => {
    partialText.value = '';
  });

  // Scroll to bottom on initial load
  scrollToBottom(true);
});

onUnmounted(() => {
  if (unsubPartial) unsubPartial();
  if (unsubMessage) unsubMessage();
  if (debounceTimer) clearTimeout(debounceTimer);
  if (messagesContainer.value) {
    messagesContainer.value.removeEventListener('scroll', handleScroll);
  }
});

// Save draft to localStorage with debounce
watch(input, (newValue) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (newValue.trim()) {
      localStorage.setItem(STORAGE_KEY, newValue);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, 500);
});

function scrollToBottom(force = false) {
  nextTick(() => {
    if (messagesContainer.value && (force || isNearBottom.value)) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
      isNearBottom.value = true;
      hasNewMessages.value = false;
    } else if (messagesContainer.value) {
      // User has scrolled up, mark that there are new messages
      hasNewMessages.value = true;
    }
  });
}

watch(
  () => sessionsStore.messages.length,
  (newLen, oldLen) => {
    // Force scroll when messages first load, conditional scroll otherwise
    if (oldLen === 0 && newLen > 0) {
      scrollToBottom(true);
    } else {
      scrollToBottom();
    }
  }
);

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString();
}

async function handleSend() {
  if (!input.value.trim() || sending.value) return;

  sending.value = true;
  try {
    await sessionsStore.sendMessage(props.sessionId, input.value);
    input.value = '';
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    sending.value = false;
  }
}

async function handleEndSession() {
  if (ending.value) return;

  ending.value = true;
  try {
    await sessionsStore.endSession(props.sessionId);
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    ending.value = false;
  }
}
</script>

<style scoped>
.conversation-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.messages {
  flex: 1;
  overflow-y: auto;
  max-height: 500px;
  padding: 1rem 0;
  position: relative;
}

.message {
  padding: 1rem;
  margin-bottom: 1rem;
  border-radius: var(--border-radius);
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
}

.message-user {
  background-color: rgba(88, 166, 255, 0.1);
  border-color: rgba(88, 166, 255, 0.3);
}

.message-assistant {
  background-color: var(--color-background-soft);
}

.message-streaming {
  border-color: var(--color-accent);
  border-style: dashed;
}

.message-system {
  background-color: rgba(139, 148, 158, 0.1);
  border-color: rgba(139, 148, 158, 0.3);
}

.message-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.message-role {
  font-weight: 600;
  font-size: 0.875rem;
  text-transform: capitalize;
}

.message-time {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.message-content {
  white-space: pre-wrap;
  word-break: break-word;
}

.message-tools {
  margin-top: 0.75rem;
}

.message-tools details {
  margin-top: 0.5rem;
}

.message-tools summary {
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.message-tools pre {
  margin-top: 0.5rem;
  font-size: 0.75rem;
}

.input-form {
  display: flex;
  gap: 0.5rem;
  align-items: flex-end;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}

.input-form textarea {
  flex: 1;
}

.input-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.btn-secondary {
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
  color: var(--color-text-soft);
}

.btn-secondary:hover {
  background-color: var(--color-background-mute);
}

.status-message {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  color: var(--color-text-soft);
  border-top: 1px solid var(--color-border);
}

.status-completed {
  color: var(--color-success, #10b981);
}

.jump-to-latest {
  position: sticky;
  bottom: 0.5rem;
  left: 50%;
  transform: translateX(-50%);
  display: block;
  margin: 0 auto;
  padding: 0.5rem 1rem;
  background-color: var(--color-accent);
  color: white;
  border: none;
  border-radius: 1rem;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  transition: background-color 0.2s, transform 0.2s;
  z-index: 10;
}

.jump-to-latest:hover {
  background-color: var(--color-accent-hover, var(--color-accent));
  transform: translateX(-50%) scale(1.05);
}

/* Streaming indicator animation */
.streaming-indicator {
  display: flex;
  gap: 0.25rem;
  align-items: center;
}

.streaming-indicator .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--color-accent);
  animation: pulse 1.4s ease-in-out infinite;
}

.streaming-indicator .dot:nth-child(2) {
  animation-delay: 0.2s;
}

.streaming-indicator .dot:nth-child(3) {
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
