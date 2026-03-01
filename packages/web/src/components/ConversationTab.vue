<template>
  <div class="conversation-tab">
    <!-- Unified Conversation Panel - selector + BTE cost display -->
    <ConversationPanel v-if="!isScheduledForFuture" :session-id="sessionId" />

    <div class="messages" ref="messagesContainer">
      <!-- Hide messages for draft and scheduled sessions (only show in input field) -->
      <template v-if="!isDraft && !isScheduledDraft">
      <MessageBubble
        v-for="message in sessionsStore.messages"
        :key="message.id"
        :message="message"
        :can-branch="canBranch"
        :is-branching="branchingMessageId === message.id"
        :work-logs="sessionsStore.getWorkLogsForMessage(message.id)"
        :ref="el => setMessageBubbleRef(message.id, el)"
        @openBranch="openBranchEditor"
        @closeBranch="closeBranchEditor"
        @branchCreate="handleBranchCreate"
      />
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

      <!-- Jump to latest button (Slack-style) -->
      <button
        v-if="!isNearBottom && hasNewMessages && sessionsStore.messages.length > 0"
        class="jump-to-latest"
        @click="scrollToBottom(true)"
      >
        <svg class="jump-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 3v10M4 9l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>New messages</span>
      </button>
    </div>

    <!-- Token cost panel - aligned with scroll-to-claude-btn -->
    <div class="conversation-controls-row">
      <TokenCostPanel :session-id="sessionId" />

      <!-- Jump to Claude's turn button - shows when at bottom and it's user's turn -->
      <button
        v-if="hasAssistantMessages && isNearBottom && isUsersTurn"
        class="scroll-to-claude-btn"
        @click="scrollToClaudesTurn(sessionsStore.messages)"
        title="Jump to Claude's response"
        aria-label="Scroll to Claude's latest response"
      >
        &uarr;
      </button>
    </div>

    <!-- Todo drawer - only shows when todos exist -->
    <TodoDrawer />

    <MessageInput
      v-if="canSendMessage || isScheduledForFuture"
      ref="messageInputRef"
      :session-id="sessionId"
      :input="input"
      :selected-model="selectedModel"
      :can-send-message="canSendMessage"
      :is-draft="isDraft"
      :is-scheduled-draft="isScheduledDraft"
      :is-scheduled-for-future="isScheduledForFuture"
      :sending="sending"
      :restarting="restarting"
      :save-status="saveStatus"
      :is-send-disabled="isSendDisabled"
      :send-button-disabled-reason="sendButtonDisabledReason"
      :input-has-content="inputHasContent"
      :working-directory="workingDirectory"
      :thinking-enabled="sessionsStore.currentSession?.thinkingEnabled || false"
      :toggling-thinking="togglingThinking"
      :project-id="sessionsStore.currentSession?.projectId"
      :current-template-id="sessionsStore.currentSession?.nextTemplateId"
      :session-status="sessionsStore.currentSession?.status"
      :auto-reschedule-enabled="sessionsStore.currentSession?.autoRescheduleEnabled || false"
      @send="handleSend"
      @start="handleStart"
      @input="handleInput"
      @update:input="input = $event"
      @update:selectedModel="selectedModel = $event"
      @update:attachedFiles="attachedFiles = $event"
      @quickResponseInsert="handleQuickResponseInsert"
      @openQuickResponseSettings="quickResponseSettingsOpen = true"
      @openSlashCommandWizard="showSlashCommandWizard = true"
      @thinkingToggle="handleThinkingToggle"
      @openSchedule="showScheduleModal = true"
      @openAutoReschedule="showAutoRescheduleModal = true"
      @templateChange="handleTemplateChange"
    />

    <RunningState
      v-else-if="sessionsStore.currentSession?.status === 'running'"
      :stopping="stopping"
      :work-logs="unassociatedWorkLogs"
      :partial-thinking="sessionsStore.partialThinking"
      :next-template="nextTemplate"
      :project-id="sessionsStore.currentSession?.projectId"
      :model="sessionsStore.currentSession?.model"
      @stop="handleStop"
    />

    <!-- Error banner - shown above input form when session has error -->
    <ErrorBanner
      v-if="sessionsStore.currentSession?.status === 'error'"
      :error-message="sessionsStore.currentSession.error || 'Unknown error'"
    />

    <!-- Quick Response Settings Modal -->
    <QuickResponseSettings
      :isOpen="quickResponseSettingsOpen"
      :projectId="sessionsStore.currentSession?.projectId"
      @close="quickResponseSettingsOpen = false"
    />

    <!-- Schedule Session Modal -->
    <ScheduleSessionModal
      v-model:isOpen="showScheduleModal"
      :sessionId="sessionId"
      @close="closeScheduleModal"
    />

    <!-- Auto-Reschedule Modal -->
    <AutoRescheduleModal
      :is-open="showAutoRescheduleModal"
      :session="sessionsStore.currentSession"
      @close="showAutoRescheduleModal = false"
      @saved="showAutoRescheduleModal = false"
    />

    <!-- Slash Command Wizard Modal -->
    <SlashCommandWizard
      v-model:isOpen="showSlashCommandWizard"
      :sessionId="sessionId"
      :workingDirectory="workingDirectory"
      mode="execute"
      @executed="handleSlashCommandExecuted"
    />
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { formatDistanceToNow } from 'date-fns';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';
import { useTemplatesStore } from '../stores/templates.js';
import { useProjectDefaultsStore } from '../stores/projectDefaults.js';
import { api } from '../composables/useApi.js';
import { useConversationMessages } from '../composables/useConversationMessages.js';
import { useConversationStreaming } from '../composables/useConversationStreaming.js';
import { useQuickResponsesStore } from '../stores/quickResponses.js';
import { useProjectsStore } from '../stores/projects.js';

// Sub-components
import TodoDrawer from './TodoDrawer.vue';
import MarkdownViewer from './MarkdownViewer.vue';
import ConversationPanel from './ConversationPanel.vue';
import TokenCostPanel from './TokenCostPanel.vue';
import QuickResponseSettings from './QuickResponseSettings.vue';
import ScheduleSessionModal from './ScheduleSessionModal.vue';
import AutoRescheduleModal from './AutoRescheduleModal.vue';
import SlashCommandWizard from './SlashCommandWizard.vue';
import MessageBubble from './MessageBubble.vue';
import MessageInput from './MessageInput.vue';
import RunningState from './RunningState.vue';
import ErrorBanner from './ErrorBanner.vue';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const sessionsStore = useSessionsStore();
const uiStore = useUiStore();
const templatesStore = useTemplatesStore();
const defaultsStore = useProjectDefaultsStore();
const quickResponsesStore = useQuickResponsesStore();
const projectsStore = useProjectsStore();
const router = useRouter();
const route = useRoute();

// Use composables
const {
  isNearBottom,
  hasNewMessages,
  handleScroll,
  scrollToBottom,
  scrollToClaudesTurn,
} = useConversationMessages();

const {
  partialText,
  clearStreamingState,
  setupSubscriptions,
  teardownSubscriptions,
} = useConversationStreaming(props.sessionId, { scrollToBottom });

// Refs
const input = ref('');
const quickResponseSettingsOpen = ref(false);
const showScheduleModal = ref(false);
const showAutoRescheduleModal = ref(false);
const showSlashCommandWizard = ref(false);
const saveStatus = ref('saved');
const saveError = ref('');
const messageInputRef = ref(null);
const messagesContainer = ref(null);
let inputSyncTimer = null;
let draftSaveTimer = null;
let debounceTimer = null;

const sending = ref(false);
const stopping = ref(false);
const restarting = ref(false);
const togglingThinking = ref(false);
const attachedFiles = ref([]);
const branchingMessageId = ref(null);
const messageBubbleRefs = {};
const selectedModel = ref(null);

// Helper to get textarea ref from MessageInput child
function getTextareaRef() {
  return messageInputRef.value?.textareaRef;
}

// Helper to get file attachment ref from MessageInput child
function getFileAttachmentRef() {
  return messageInputRef.value?.fileAttachmentRef;
}

// Track MessageBubble refs for branch editor access
function setMessageBubbleRef(messageId, el) {
  if (el) {
    messageBubbleRefs[messageId] = el;
  } else {
    delete messageBubbleRefs[messageId];
  }
}

// Computed properties
const canSendMessage = computed(() => {
  const status = sessionsStore.currentSession?.status;
  return status === 'waiting' || status === 'scheduled' || status === 'stopped' || status === 'error';
});

const canBranch = computed(() => {
  const status = sessionsStore.currentSession?.status;
  return status !== 'running' && status !== 'starting';
});

const isUsersTurn = computed(() => {
  const status = sessionsStore.currentSession?.status;
  return status === 'waiting' || status === 'stopped' || status === 'error';
});

const isDraft = computed(() => {
  if (!sessionsStore.currentSession) return false;
  return sessionsStore.isDraftSession(sessionsStore.currentSession);
});

const isScheduledDraft = computed(() => {
  if (!sessionsStore.currentSession) return false;
  return sessionsStore.isScheduledDraft(sessionsStore.currentSession);
});

const unassociatedWorkLogs = computed(() => {
  return sessionsStore.getUnassociatedWorkLogs;
});

const inputHasContent = computed(() => {
  return input.value.trim().length > 0;
});

const isSendDisabled = computed(() => {
  if (sessionsStore.currentSession?.status === 'scheduled') {
    const scheduledTime = new Date(sessionsStore.currentSession.scheduledAt);
    const now = new Date();
    if (scheduledTime > now) {
      return true;
    }
  }
  return !inputHasContent.value || sending.value;
});

const sendButtonDisabledReason = computed(() => {
  if (!inputHasContent.value) {
    return 'Enter a message to send';
  }
  if (sending.value) {
    return 'Message is being sent...';
  }
  if (sessionsStore.currentSession?.status === 'scheduled') {
    const scheduledTime = new Date(sessionsStore.currentSession.scheduledAt);
    const now = new Date();
    if (scheduledTime > now) {
      return `Session is scheduled for ${formatDistanceToNow(scheduledTime, { addSuffix: true })}`;
    }
  }
  return null;
});

const isScheduledForFuture = computed(() => {
  return sessionsStore.isScheduledDraft(sessionsStore.currentSession);
});

const hasAssistantMessages = computed(() => {
  return sessionsStore.messages.some(msg => msg.role === 'assistant');
});

const nextTemplate = computed(() => {
  const templateId = sessionsStore.currentSession?.nextTemplateId;
  if (!templateId) return null;
  return templatesStore.getTemplateById(templateId);
});

const workingDirectory = computed(() => {
  const session = sessionsStore.currentSession;
  if (!session) {
    console.log('[workingDirectory] No current session');
    return null;
  }

  if (session.gitWorktree) {
    console.log('[workingDirectory] Using session.gitWorktree:', session.gitWorktree);
    return session.gitWorktree;
  }

  let project = projectsStore.currentProject;
  if ((!project || project.id !== session.projectId) && session.projectId) {
    console.log('[workingDirectory] currentProject mismatch or null, falling back to getProjectById');
    project = projectsStore.getProjectById(session.projectId);
  }
  const result = project?.workingDirectory || null;
  console.log('[workingDirectory] Using project.workingDirectory:', result, 'from project:', project?.id);
  return result;
});

// Helper function to get project default model with fallback
function getProjectDefaultModel() {
  const projectId = sessionsStore.currentSession?.projectId;
  if (!projectId) return null;

  const defaults = defaultsStore.getDefaultsForProject(projectId);
  return defaults?.model || null;
}

async function handleSend() {
  const textareaRef = getTextareaRef();
  const currentValue = textareaRef?.value || input.value;
  if (!currentValue.trim() || sending.value) return;

  console.log(`[MODEL AUDIT - Frontend] Sending message with model: "${selectedModel.value}"`);

  sending.value = true;
  try {
    await sessionsStore.sendMessage(props.sessionId, currentValue, attachedFiles.value, selectedModel.value);
    input.value = '';
    if (textareaRef) textareaRef.value = '';
    attachedFiles.value = [];
    getFileAttachmentRef()?.clear();
    await api.updateSessionPendingPrompt(props.sessionId, null);
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    sending.value = false;
  }
}

function handleQuickResponseInsert({ content, autoSubmit }) {
  const currentValue = input.value.trim();
  const newValue = currentValue ? currentValue + '\n\n' + content : content;
  input.value = newValue;

  if (autoSubmit) {
    nextTick(() => {
      handleSend();
    });
  } else {
    nextTick(() => {
      const textareaRef = getTextareaRef();
      if (textareaRef) {
        textareaRef.value = newValue;
        textareaRef.focus();
        textareaRef.selectionStart = textareaRef.selectionEnd = textareaRef.value.length;

        if (canSendMessage.value && newValue.trim()) {
          saveStatus.value = 'unsaved';
          savePendingPrompt(newValue);
        }
      }
    });
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

async function savePendingPrompt(prompt) {
  try {
    saveStatus.value = 'saving';
    saveError.value = '';
    await api.updateSessionPendingPrompt(props.sessionId, prompt);
    saveStatus.value = 'saved';
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
      if (saveStatus.value === 'saved') {
        saveStatus.value = 'saved';
      }
    }, 2000);
  } catch (err) {
    saveStatus.value = 'error';
    saveError.value = err.message;
    console.error('Failed to save pending prompt:', err);
  }
}

async function handleStart() {
  const textareaRef = getTextareaRef();
  const currentValue = textareaRef?.value || input.value;
  if (restarting.value || !currentValue.trim()) return;

  restarting.value = true;
  try {
    await sessionsStore.startSession(props.sessionId, currentValue);
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
    event.target.checked = !newValue;
    uiStore.error(err.message);
  } finally {
    togglingThinking.value = false;
  }
}

async function handleTemplateChange(templateId) {
  try {
    await sessionsStore.updateNextTemplate(props.sessionId, templateId);
  } catch (err) {
    uiStore.error(err.message);
  }
}

function closeScheduleModal() {
  showScheduleModal.value = false;
}

function handleSlashCommandExecuted({ command, args }) {
  scrollToBottom(true);
}

// Branching methods
function openBranchEditor(messageId) {
  branchingMessageId.value = messageId;
}

function closeBranchEditor() {
  branchingMessageId.value = null;
}

async function handleBranchCreate({ messageId, prompt }) {
  let branchCreated = false;
  try {
    const activeConv = sessionsStore.activeConversation;
    if (!activeConv) {
      throw new Error('No active conversation');
    }

    if (!prompt) {
      throw new Error('A prompt is required');
    }

    const branchConversation = await sessionsStore.branchConversation(
      props.sessionId,
      activeConv.id,
      messageId,
      null,
      prompt
    );

    branchCreated = true;

    router.push({
      path: `/sessions/${props.sessionId}/conversation`,
      query: { conv: branchConversation.id }
    });

    closeBranchEditor();
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    if (!branchCreated) {
      const bubbleRef = messageBubbleRefs[messageId];
      if (bubbleRef?.branchEditorRef) {
        bubbleRef.branchEditorRef.resetCreating();
      }
    }
  }
}

// Watchers
watch(
  () => sessionsStore.messages.length,
  (newLen, oldLen) => {
    console.log(`[CONV] messages.length changed: ${oldLen} -> ${newLen}, activeConversationId: ${sessionsStore.activeConversationId}`);
    if (oldLen === 0 && newLen > 0) {
      scrollToBottom(true);
    } else {
      scrollToBottom();
    }
  }
);

watch(
  () => sessionsStore.currentSession?.status,
  async (newStatus, oldStatus) => {
    if (oldStatus === 'running' && (newStatus === 'waiting' || newStatus === 'completed')) {
      console.log(`[CONV] Status changed from ${oldStatus} to ${newStatus}, refetching messages and work logs`);
      clearStreamingState();
      await sessionsStore.fetchMessages(props.sessionId, false);
      await sessionsStore.fetchWorkLogs(props.sessionId);
    }
  }
);

watch(
  () => sessionsStore.messages,
  (newMessages) => {
    const textareaRef = getTextareaRef();
    if (isDraft.value && textareaRef) {
      const textareaHasContent = textareaRef.value && textareaRef.value.trim().length > 0;
      if (!textareaHasContent) {
        const userMessage = newMessages.find(msg => msg.role === 'user');
        if (userMessage && userMessage.content) {
          input.value = userMessage.content;
          nextTick(() => {
            const ref = getTextareaRef();
            if (ref) {
              ref.value = userMessage.content;
            }
          });
        }
      }
    }
  },
  { deep: true, immediate: true }
);

watch(
  () => sessionsStore.activeConversationId,
  async (newConvId, oldConvId) => {
    if (newConvId && newConvId !== oldConvId) {
      clearStreamingState();

      // Reset scroll state when switching conversations
      hasNewMessages.value = false;
      isNearBottom.value = true;

      await nextTick();

      console.log(`[CONV] activeConversationId changed to ${newConvId}, refetching messages`);
      await sessionsStore.fetchMessages(props.sessionId, false);
    }
  }
);

watch(
  () => route.query.conv,
  async (newConvId, oldConvId) => {
    if (newConvId && newConvId !== oldConvId && newConvId !== sessionsStore.activeConversationId) {
      await sessionsStore.switchConversation(props.sessionId, newConvId);
    }
  }
);

watch(
  () => sessionsStore.activeConversation,
  (conv) => {
    if (conv) {
      selectedModel.value = sessionsStore.currentSession?.model ||
        getProjectDefaultModel() ||
        'sonnet';
    } else {
      selectedModel.value = sessionsStore.currentSession?.model ||
        getProjectDefaultModel() ||
        'sonnet';
    }
  },
  { immediate: true }
);

watch(selectedModel, async (newModel, oldModel) => {
  // Only persist if this is a user-initiated change (not initial load)
  if (oldModel !== null && newModel && newModel !== oldModel) {
    try {
      await sessionsStore.updateSessionModel(props.sessionId, newModel);
    } catch (err) {
      console.error('Failed to persist model selection:', err);
    }
  }
});
</script>

<style scoped>
.conversation-tab {
  display: flex;
  flex-direction: column;
  /* Removed height: 100% - causes layout issues on iPad Safari when combined with
     sticky positioning and internal scroll containers. The natural document flow
     works correctly without it. */
}

.messages {
  padding: 0.25rem 0;
  position: relative;
  max-height: 65vh;
  overflow-y: auto;
  scroll-behavior: smooth;
}

.conversation-controls-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.25rem 0;
  position: relative;
  min-height: 32px;
}

/* Streaming message styles (kept here since streaming bubble is inline) */
.message {
  padding: 1rem;
  margin-bottom: 1rem;
  border-radius: var(--border-radius);
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
}

.message-assistant {
  background-color: var(--color-background-soft);
}

.message-streaming {
  border-color: var(--color-accent);
  border-style: dashed;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.message-role {
  font-weight: 600;
  font-size: 0.875rem;
  text-transform: capitalize;
}

.message-content {
  white-space: pre-wrap;
  word-break: break-word;
}

/* Override pre-wrap for rendered markdown to prevent double line breaks */
.message-content :deep(.markdown-viewer) {
  white-space: normal;
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

.scroll-to-claude-btn {
  padding: 0.375rem 0.75rem;
  background: rgba(31, 41, 55, 0.85);
  border: 1px solid rgba(75, 85, 99, 0.5);
  border-radius: 6px;
  color: rgba(156, 163, 175, 0.9);
  cursor: pointer;
  transition: all 0.15s ease;
  backdrop-filter: blur(4px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  white-space: nowrap;
  line-height: 1;
  font-weight: 500;
  min-width: 2rem;
}

.scroll-to-claude-btn:hover {
  background: rgba(55, 65, 81, 0.95);
  color: rgba(209, 213, 219, 1);
}

.scroll-to-claude-btn:active {
  transform: scale(0.95);
}

/* Slack-style new messages button - sticky within the scrollable messages container */
.jump-to-latest {
  position: sticky;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.375rem;
  width: fit-content;
  margin: 0 auto;
  padding: 0.5rem 0.875rem;
  background: #1a1d21;
  color: #e8e8e8;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 24px;
  cursor: pointer;
  font-size: 0.8125rem;
  font-weight: 500;
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.3),
    0 4px 12px rgba(0, 0, 0, 0.25);
  z-index: 10;
  animation: slideUp 0.15s ease-out;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

.jump-to-latest:hover {
  background: #222529;
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.35),
    0 6px 16px rgba(0, 0, 0, 0.3);
}

.jump-to-latest:active {
  transform: translateX(-50%) scale(0.97);
}

.jump-arrow {
  flex-shrink: 0;
  opacity: 0.9;
}

@keyframes slideUp {
  from {
    transform: translateX(-50%) translateY(8px);
    opacity: 0;
  }
  to {
    transform: translateX(-50%) translateY(0);
    opacity: 1;
  }
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

.running-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.running-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-text-soft);
  font-size: 0.875rem;
}

.running-title {
  font-weight: 500;
}

.btn-stop {
  min-height: 36px;
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  flex-shrink: 0;
}

/* Responsive messages container height */
@media (min-width: 1200px) {
  .messages {
    max-height: 70vh;
  }
}

@media (max-height: 700px) {
  .messages {
    max-height: 50vh;
  }
}

@media (max-height: 500px) {
  .messages {
    max-height: 40vh;
  }
}

/* Mobile adjustments for scroll-to-claude button and input controls */
@media (max-width: 600px) {
  .scroll-to-claude-btn {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    margin-right: 0.25rem;
  }
}
</style>
