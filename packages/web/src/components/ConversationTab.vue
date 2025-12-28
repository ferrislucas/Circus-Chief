<template>
  <div class="conversation-tab">
    <!-- Conversation Selector -->
    <ConversationSelector :session-id="sessionId" />

    <!-- Token Usage Panel - shows conversation-level usage (Issue #175) -->
    <TokenUsagePanel class="conversation-usage" />

    <div class="messages" ref="messagesContainer">
      <!-- Hide messages for draft sessions (only show in input field) -->
      <template v-if="!isDraft">
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
        <!-- Attachments display for user messages -->
        <div v-if="message.attachments?.length" class="message-attachments">
          <div v-for="att in message.attachments" :key="att.id" class="attachment-chip">
            <span class="attachment-icon">{{ getAttachmentIcon(att.mimeType) }}</span>
            <span class="attachment-name">{{ att.filename }}</span>
            <span class="attachment-size">({{ formatFileSize(att.size) }})</span>
          </div>
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
      </template>

      <!-- Streaming partial message -->
      <div v-if="!isDraft && partialText" class="message message-assistant message-streaming">
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

    <div v-if="isDraft" class="status-message status-draft">
      <span class="draft-icon">📝</span>
      This session is a draft. Edit your prompt and click "Start Session" to begin.
    </div>

    <div v-if="isStopped && !isDraft" class="status-message status-stopped">
      <span class="stopped-icon">⏸</span>
      Session stopped - send a message to resume
    </div>

    <form v-if="canSendMessage" @submit.prevent="isDraft ? handleStart() : handleSend()" class="input-form">
      <textarea
        v-model="input"
        class="form-input form-textarea"
        :placeholder="isDraft ? 'Edit your prompt...' : (isStopped ? 'Send a message to resume session...' : 'Send a follow-up message...')"
        rows="3"
        @keydown="handleKeydown"
      ></textarea>
      <div class="input-controls">
        <div class="session-options" v-if="!isDraft">
          <FileAttachment ref="fileAttachment" @update:files="attachedFiles = $event" />
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
          <div v-if="isDraft" class="draft-actions">
            <button type="submit" class="btn btn-primary btn-send" :disabled="restarting || saveStatus === 'saving'">
              <span v-if="restarting" class="loading-spinner"></span>
              {{ restarting ? 'Starting...' : 'Start Session' }}
            </button>
            <div :class="['save-indicator', `save-${saveStatus}`]">
              <span v-if="saveStatus === 'saving'" class="save-icon">⏳</span>
              <span v-else-if="saveStatus === 'saved'" class="save-icon">✓</span>
              <span v-else-if="saveStatus === 'error'" class="save-icon">⚠</span>
              <span class="save-text">
                {{ saveStatus === 'saving' ? 'Saving...' : (saveStatus === 'saved' ? 'Saved' : (saveStatus === 'error' ? saveError || 'Save failed' : 'Unsaved')) }}
              </span>
            </div>
          </div>
          <button v-else type="submit" class="btn btn-primary btn-send" :disabled="!input.trim() || sending">
            <span v-if="sending" class="loading-spinner"></span>
            {{ sending ? 'Sending...' : 'Send' }}
          </button>
        </div>
      </div>
      <div v-if="!isDraft" class="model-row">
        <ModelSelector :sessionId="sessionId" />
      </div>

      <!-- Template selector for chaining sessions -->
      <div v-if="!isDraft" class="template-row">
        <TemplateSelector
          :session-id="sessionId"
          :project-id="sessionsStore.currentSession?.projectId"
          :current-template-id="sessionsStore.currentSession?.nextTemplateId"
          :disabled="sessionsStore.currentSession?.status === 'running'"
          @update:templateId="handleTemplateChange"
        />
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

      <!-- Show template indicator while running -->
      <div v-if="sessionsStore.currentSession?.nextTemplateId" class="template-pending">
        <span class="template-pending-label">Next:</span>
        <span class="template-pending-name">Template will trigger when Claude finishes</span>
      </div>
    </div>

    <div v-else-if="sessionsStore.currentSession?.status === 'error'" class="status-message status-error">
      <span>Session error</span>
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
import { useSubmitShortcut } from '../composables/useSubmitShortcut.js';
import { api } from '../composables/useApi.js';
import TodoDrawer from './TodoDrawer.vue';
import WorkLogPanel from './WorkLogPanel.vue';
import MarkdownViewer from './MarkdownViewer.vue';
import LiveWorkLogPanel from './LiveWorkLogPanel.vue';
import ConversationSelector from './ConversationSelector.vue';
import TokenUsagePanel from './TokenUsagePanel.vue';
import FileAttachment from './FileAttachment.vue';
import ModelSelector from './ModelSelector.vue';
import TemplateSelector from './TemplateSelector.vue';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const sessionsStore = useSessionsStore();
const uiStore = useUiStore();

const input = ref('');
const saveStatus = ref('saved'); // 'saved', 'saving', 'error', 'unsaved'
const saveError = ref('');

// Create keyboard shortcut handler
const handleKeydown = useSubmitShortcut(() => {
  if (isDraft.value) {
    handleStart();
  } else {
    handleSend();
  }
});
const sending = ref(false);
const stopping = ref(false);
const restarting = ref(false);
const togglingThinking = ref(false);
const togglingMode = ref(false);
const messagesContainer = ref(null);
const attachedFiles = ref([]);
const fileAttachment = ref(null);
let draftSaveTimer = null;

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

const isDraft = computed(() => {
  if (!sessionsStore.currentSession) return false;
  return sessionsStore.isDraftSession(sessionsStore.currentSession);
});

const unassociatedWorkLogs = computed(() => {
  return sessionsStore.getUnassociatedWorkLogs;
});

// Subscribe to partial messages for streaming, work logs, and conversation events
const {
  onPartial,
  onMessage,
  onWorkLog,
  onWorkLogsAssociated,
  onThinkingPartial,
  onConversationCreated,
  onConversationUpdated,
  onConversationDeleted,
} = useSessionSubscription(props.sessionId);
let unsubPartial = null;
let unsubMessage = null;
let unsubWorkLog = null;
let unsubWorkLogsAssociated = null;
let unsubThinkingPartial = null;
let unsubConvCreated = null;
let unsubConvUpdated = null;
let unsubConvDeleted = null;

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
  // If this is a draft session, load the initial prompt into the input field
  if (isDraft.value && sessionsStore.messages.length > 0) {
    const userMessage = sessionsStore.messages.find(msg => msg.role === 'user');
    if (userMessage) {
      input.value = userMessage.content;
    }
  }

  // Load draft from localStorage (if not a draft session)
  if (!isDraft.value) {
    const savedDraft = localStorage.getItem(STORAGE_KEY);
    if (savedDraft) {
      input.value = savedDraft;
    }
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

  // Subscribe to conversation events for real-time updates
  unsubConvCreated = onConversationCreated((conversation) => {
    sessionsStore.addConversation(conversation);
    // If this is now the active conversation, fetch its messages
    if (conversation.isActive) {
      sessionsStore.fetchMessages(props.sessionId, false);
    }
  });

  unsubConvUpdated = onConversationUpdated((conversation) => {
    sessionsStore.updateConversation(conversation);
  });

  unsubConvDeleted = onConversationDeleted((conversationId, newActiveConv) => {
    sessionsStore.removeConversation(conversationId, newActiveConv);
    // If we have a new active conversation, fetch its messages
    if (newActiveConv) {
      sessionsStore.fetchMessages(props.sessionId, false);
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
  if (unsubConvCreated) unsubConvCreated();
  if (unsubConvUpdated) unsubConvUpdated();
  if (unsubConvDeleted) unsubConvDeleted();
  if (debounceTimer) clearTimeout(debounceTimer);
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  if (messagesContainer.value) {
    messagesContainer.value.removeEventListener('scroll', handleScroll);
  }
  // Clear work logs when leaving the conversation tab
  // Note: Don't clear conversations here - they should persist when switching tabs
  // within the same session. They will be refreshed when switching sessions.
  sessionsStore.clearWorkLogs();
});

// Auto-save draft to database (for draft sessions) and localStorage with debounce
watch(input, (newValue) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (draftSaveTimer) clearTimeout(draftSaveTimer);

  // Mark as unsaved immediately when user types
  if (isDraft.value) {
    saveStatus.value = 'unsaved';
  }

  debounceTimer = setTimeout(() => {
    if (newValue.trim()) {
      localStorage.setItem(STORAGE_KEY, newValue);
      // Auto-save draft to database
      if (isDraft.value) {
        saveDraftPrompt(newValue);
      }
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

// Re-fetch work logs when session status changes from running to waiting/completed
// This ensures work logs are properly associated after Claude's turn ends
watch(
  () => sessionsStore.currentSession?.status,
  async (newStatus, oldStatus) => {
    if (oldStatus === 'running' && (newStatus === 'waiting' || newStatus === 'completed')) {
      await sessionsStore.fetchWorkLogs(props.sessionId);
    }
  }
);

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString();
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getAttachmentIcon(mimeType) {
  if (!mimeType) return '📎';
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('text/') || mimeType === 'application/json') return '📄';
  if (mimeType === 'application/pdf') return '📕';
  if (mimeType.includes('javascript') || mimeType.includes('typescript')) return '📜';
  return '📎';
}

async function handleSend() {
  if (!input.value.trim() || sending.value) return;

  sending.value = true;
  try {
    await sessionsStore.sendMessage(props.sessionId, input.value, attachedFiles.value);
    input.value = '';
    attachedFiles.value = [];
    fileAttachment.value?.clear();
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

async function saveDraftPrompt(prompt) {
  try {
    saveStatus.value = 'saving';
    saveError.value = '';
    await api.updateSessionInitialPrompt(props.sessionId, prompt);
    saveStatus.value = 'saved';
    // Reset save status after 2 seconds
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
      if (saveStatus.value === 'saved') {
        saveStatus.value = 'saved';
      }
    }, 2000);
  } catch (err) {
    saveStatus.value = 'error';
    saveError.value = err.message;
    console.error('Failed to save draft prompt:', err);
  }
}

async function handleStart() {
  if (restarting.value || !input.value.trim()) return;

  restarting.value = true;
  try {
    // Pass the current prompt to the start API
    await api.startSession(props.sessionId, input.value);
    uiStore.success('Session started');
    // Clear localStorage draft on successful start
    localStorage.removeItem(STORAGE_KEY);
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

async function handleTemplateChange(templateId) {
  try {
    await sessionsStore.updateNextTemplate(props.sessionId, templateId);
  } catch (err) {
    uiStore.error(err.message);
  }
}
</script>

<style scoped>
.conversation-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.conversation-usage {
  margin-bottom: 1rem;
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

.message-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding-top: 0.5rem;
  border-top: 1px dashed var(--color-border);
}

.attachment-chip {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  font-size: 0.75rem;
}

.attachment-icon {
  font-size: 0.875rem;
}

.attachment-name {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
}

.attachment-size {
  color: var(--color-text-soft);
  font-size: 0.625rem;
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
  user-select: none;
  -webkit-user-select: none;
}

.mode-btn:last-child {
  border-right: none;
}

.mode-btn:hover:not(:disabled) {
  background: var(--color-bg-hover);
}

.mode-btn.active,
.mode-btn.active:focus {
  background: var(--color-primary);
  color: white;
  outline: none;
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

.draft-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
}

.save-indicator {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  border-radius: 0.375rem;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  min-height: 40px;
}

.save-saving {
  border-color: rgba(100, 200, 255, 0.5);
  background: rgba(100, 200, 255, 0.05);
  color: var(--color-accent);
}

.save-saved {
  border-color: rgba(34, 197, 94, 0.5);
  background: rgba(34, 197, 94, 0.05);
  color: var(--color-success, #22c55e);
}

.save-error {
  border-color: rgba(239, 68, 68, 0.5);
  background: rgba(239, 68, 68, 0.05);
  color: var(--color-danger, #ef4444);
}

.save-unsaved {
  border-color: rgba(251, 146, 60, 0.5);
  background: rgba(251, 146, 60, 0.05);
  color: var(--color-warning, #fb923c);
}

.save-icon {
  font-size: 1rem;
  font-weight: 600;
  flex-shrink: 0;
}

.save-text {
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
}

.model-row {
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border);
  margin-top: 0.75rem;
}

.template-row {
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border);
  margin-top: 0.75rem;
}

.template-pending {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  margin-top: 0.75rem;
  background: var(--color-bg-soft);
  border-radius: 0.375rem;
  border: 1px solid var(--color-border);
  font-size: 0.875rem;
}

.template-pending-label {
  color: var(--color-text-soft);
  font-weight: 500;
}

.template-pending-name {
  color: var(--color-text);
  font-size: 0.75rem;
  font-style: italic;
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

.status-draft {
  color: var(--color-info, #3b82f6);
  background-color: rgba(59, 130, 246, 0.1);
  border-radius: var(--border-radius);
  margin-bottom: 0.5rem;
}

.draft-icon {
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
