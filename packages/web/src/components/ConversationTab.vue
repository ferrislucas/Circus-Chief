<template>
  <div class="conversation-tab">
    <!-- Conversation Selector -->
    <ConversationSelector :session-id="sessionId" />

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
        <div class="message-content">
          <MarkdownViewer v-if="message.role === 'assistant'" :content="message.content" />
          <template v-else>{{ message.content }}</template>
        </div>
        <div v-if="message.toolUse?.length" class="message-tools">
          <details v-for="(tool, idx) in message.toolUse" :key="idx">
            <summary>Tool: {{ tool.name }}</summary>
            <pre>{{ JSON.stringify(tool.input, null, 2) }}</pre>
          </details>
        </div>
        <!-- Work Log Panel for assistant messages (collapsed by default) -->
        <WorkLogPanel
          v-if="message.role === 'assistant'"
          :work-logs="sessionsStore.getWorkLogsForMessage(message.id)"
        />
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
        <div class="message-content">
          <MarkdownViewer :content="partialText" />
        </div>
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

    <div v-if="isStopped" class="status-message status-stopped">
      <span class="stopped-icon">⏸</span>
      Session stopped - send a message to resume
    </div>

    <form v-if="canSendMessage" @submit.prevent="handleSend" class="input-form">
      <textarea
        v-model="input"
        class="form-input form-textarea"
        :placeholder="isStopped ? 'Send a message to resume session...' : 'Send a follow-up message...'"
        rows="3"
        @keydown.enter.ctrl="handleSend"
      ></textarea>
      <div class="input-controls">
        <div class="session-options">
          <div class="thinking-toggle">
            <label class="toggle-switch">
              <input
                type="checkbox"
                :checked="sessionsStore.currentSession?.thinkingEnabled"
                @change="handleThinkingToggle"
                :disabled="togglingThinking"
              />
              <span class="toggle-slider"></span>
            </label>
            <span class="toggle-label">Thinking</span>
          </div>

          <div class="mode-switcher">
            <span class="mode-label">Mode:</span>
            <div class="mode-buttons">
              <button
                v-for="m in modes"
                :key="m.value"
                type="button"
                :class="['mode-btn', { active: sessionsStore.currentSession?.mode === m.value }]"
                @click="handleModeChange(m.value)"
                :disabled="togglingMode"
                :title="m.description"
              >
                {{ m.label }}
              </button>
            </div>
          </div>
        </div>
        <div class="input-actions">
          <button type="submit" class="btn btn-primary btn-send" :disabled="!input.trim() || sending">
            <span v-if="sending" class="loading-spinner"></span>
            Send
          </button>
        </div>
      </div>
    </form>

    <div v-else-if="sessionsStore.currentSession?.status === 'running'" class="running-state">
      <LiveWorkLogPanel
        :work-logs="unassociatedWorkLogs"
        :partial-thinking="sessionsStore.partialThinking"
      />
      <div class="running-actions">
        <button type="button" class="btn btn-danger btn-send" @click="handleStop" :disabled="stopping">
          <span v-if="stopping" class="loading-spinner"></span>
          Stop
        </button>
      </div>
    </div>

    <div v-else-if="sessionsStore.currentSession?.status === 'completed' || sessionsStore.currentSession?.status === 'error'" class="status-message" :class="sessionsStore.currentSession?.status === 'completed' ? 'status-completed' : 'status-error'">
      <span>{{ sessionsStore.currentSession?.status === 'completed' ? 'Session completed' : 'Session error' }}</span>
      <button type="button" class="btn btn-primary btn-restart" @click="handleRestart" :disabled="restarting">
        <span v-if="restarting" class="loading-spinner"></span>
        Restart Session
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';
import { useSessionSubscription } from '../composables/useWebSocket.js';
import TodoDrawer from './TodoDrawer.vue';
import WorkLogPanel from './WorkLogPanel.vue';
import MarkdownViewer from './MarkdownViewer.vue';
import LiveWorkLogPanel from './LiveWorkLogPanel.vue';
import ConversationSelector from './ConversationSelector.vue';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const sessionsStore = useSessionsStore();
const uiStore = useUiStore();

const input = ref('');
const sending = ref(false);
const stopping = ref(false);
const restarting = ref(false);
const togglingThinking = ref(false);
const togglingMode = ref(false);
const messagesContainer = ref(null);

const modes = [
  { value: 'plan', label: 'Plan', description: 'Agent plans before implementing' },
  { value: 'standard', label: 'Standard', description: 'Balanced approach' },
  { value: 'yolo', label: 'YOLO', description: 'Auto-approve mode' },
];
const partialText = ref('');
const isNearBottom = ref(true);
const hasNewMessages = ref(false);
let debounceTimer = null;

const SCROLL_THRESHOLD = 100; // pixels from bottom to consider "at bottom"

const STORAGE_KEY = `session-draft-${props.sessionId}`;

const canSendMessage = computed(() => {
  const status = sessionsStore.currentSession?.status;
  return status === 'waiting' || status === 'stopped';
});

const isStopped = computed(() => {
  return sessionsStore.currentSession?.status === 'stopped';
});

const unassociatedWorkLogs = computed(() => {
  return sessionsStore.getUnassociatedWorkLogs;
});

// Subscribe to partial messages for streaming and work logs
const { onPartial, onMessage, onWorkLog, onWorkLogsAssociated, onThinkingPartial } = useSessionSubscription(props.sessionId);
let unsubPartial = null;
let unsubMessage = null;
let unsubWorkLog = null;
let unsubWorkLogsAssociated = null;
let unsubThinkingPartial = null;

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

onMounted(async () => {
  // Load draft from localStorage
  const savedDraft = localStorage.getItem(STORAGE_KEY);
  if (savedDraft) {
    input.value = savedDraft;
  }

  // Add scroll event listener
  if (messagesContainer.value) {
    messagesContainer.value.addEventListener('scroll', handleScroll);
  }

  // Fetch conversations for this session
  await sessionsStore.fetchConversations(props.sessionId);

  unsubPartial = onPartial((text) => {
    partialText.value = text;
    scrollToBottom();
  });

  // Clear partial text when full message arrives
  unsubMessage = onMessage(() => {
    partialText.value = '';
  });

  // Subscribe to work log updates
  // Note: Work logs are displayed in LiveWorkLogPanel which has its own scroll management
  unsubWorkLog = onWorkLog((log) => {
    sessionsStore.addWorkLog(log);
  });

  // Subscribe to work log association events (re-associate _unassociated logs)
  unsubWorkLogsAssociated = onWorkLogsAssociated((messageId) => {
    sessionsStore.associateWorkLogs(messageId);
  });

  // Subscribe to partial thinking updates for streaming display
  // Note: Partial thinking is displayed in LiveWorkLogPanel which has its own scroll management
  unsubThinkingPartial = onThinkingPartial((thinking) => {
    if (thinking === null) {
      sessionsStore.clearPartialThinking();
    } else {
      sessionsStore.setPartialThinking(thinking);
    }
  });

  // Fetch initial work logs
  await sessionsStore.fetchWorkLogs(props.sessionId);

  // Scroll to bottom on initial load
  scrollToBottom(true);
});

onUnmounted(() => {
  if (unsubPartial) unsubPartial();
  if (unsubMessage) unsubMessage();
  if (unsubWorkLog) unsubWorkLog();
  if (unsubWorkLogsAssociated) unsubWorkLogsAssociated();
  if (unsubThinkingPartial) unsubThinkingPartial();
  if (debounceTimer) clearTimeout(debounceTimer);
  if (messagesContainer.value) {
    messagesContainer.value.removeEventListener('scroll', handleScroll);
  }
  // Clear work logs and conversations when leaving the conversation tab
  sessionsStore.clearWorkLogs();
  sessionsStore.clearConversations();
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

async function handleStop() {
  if (stopping.value) return;

  stopping.value = true;
  try {
    await sessionsStore.stopSession(props.sessionId);
    uiStore.success('Session stopped');
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    stopping.value = false;
  }
}

async function handleRestart() {
  if (restarting.value) return;

  restarting.value = true;
  try {
    await sessionsStore.restartSession(props.sessionId);
    uiStore.success('Session restarted');
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    restarting.value = false;
  }
}

async function handleThinkingToggle(event) {
  if (togglingThinking.value) return;

  const newValue = event.target.checked;
  togglingThinking.value = true;
  try {
    await sessionsStore.updateSessionThinking(props.sessionId, newValue);
  } catch (err) {
    // Revert the checkbox on error
    event.target.checked = !newValue;
    uiStore.error(err.message);
  } finally {
    togglingThinking.value = false;
  }
}

async function handleModeChange(newMode) {
  if (togglingMode.value) return;
  if (sessionsStore.currentSession?.mode === newMode) return;

  togglingMode.value = true;
  try {
    await sessionsStore.updateSessionMode(props.sessionId, newMode);
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    togglingMode.value = false;
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
  overflow-anchor: none; /* Prevent browser scroll anchoring issues during streaming */
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
  flex-direction: column;
  gap: 0.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}

.input-form textarea {
  width: 100%;
}

.input-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.session-options {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  flex-wrap: wrap;
}

.thinking-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.toggle-label {
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.mode-switcher {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.mode-label {
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.mode-buttons {
  display: flex;
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  overflow: hidden;
}

.mode-btn {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  background: var(--color-background);
  border: none;
  border-right: 1px solid var(--color-border);
  color: var(--color-text-soft);
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.mode-btn:last-child {
  border-right: none;
}

.mode-btn:hover:not(:disabled) {
  background: var(--color-bg-hover);
}

.mode-btn.active {
  background: var(--color-primary);
  color: white;
}

.mode-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--color-background-mute);
  border: 1px solid var(--color-border);
  border-radius: 22px;
  transition: 0.2s;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 2px;
  background-color: var(--color-text-soft);
  border-radius: 50%;
  transition: 0.2s;
}

.toggle-switch input:checked + .toggle-slider {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
}

.toggle-switch input:checked + .toggle-slider:before {
  transform: translateX(18px);
  background-color: #fff;
}

.toggle-switch input:disabled + .toggle-slider {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-send {
  min-width: 100px;
  min-height: 48px;
  padding: 0.75rem 1.5rem;
  font-size: 1rem;
  font-weight: 600;
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
  justify-content: space-between;
  gap: 0.5rem;
  padding: 1rem;
  color: var(--color-text-soft);
  border-top: 1px solid var(--color-border);
}

.status-completed {
  color: var(--color-success, #10b981);
}

.status-error {
  color: var(--color-danger, #ef4444);
}

.btn-restart {
  min-width: 140px;
}

.status-stopped {
  color: var(--color-warning, #f59e0b);
  background-color: rgba(245, 158, 11, 0.1);
  border-radius: var(--border-radius);
  margin-bottom: 0.5rem;
}

.stopped-icon {
  font-size: 1rem;
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

.running-state {
  border-top: 1px solid var(--color-border);
  padding-top: 1rem;
}

.running-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 1rem;
}

/* Responsive styles for input controls */
@media (max-width: 600px) {
  .input-controls {
    flex-wrap: wrap;
  }

  .session-options {
    width: 100%;
    justify-content: flex-start;
  }

  .input-actions {
    width: 100%;
    justify-content: flex-end;
  }
}

@media (max-width: 400px) {
  .mode-label {
    display: none;
  }
}
</style>
