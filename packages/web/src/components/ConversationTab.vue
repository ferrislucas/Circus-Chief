<template>
  <div class="conversation-tab">
    <!-- Unified Conversation Panel - selector + BTE cost display -->
    <ConversationPanel v-if="!isScheduledForFuture" :session-id="sessionId" />

    <div class="messages" ref="messagesContainer">
      <!-- Hide messages for draft and scheduled sessions (only show in input field) -->
      <template v-if="!isDraft && !isScheduledDraft">
      <MessageItem
        v-for="message in sessionsStore.messages"
        :key="message.id"
        :message="message"
        :can-branch="canBranch"
        :is-branching="branchingMessageId === message.id"
        :work-logs="sessionsStore.getWorkLogsForMessage(message.id)"
        @openBranch="openBranchEditor"
        @branchCreate="handleBranchCreate"
        @closeBranch="closeBranchEditor"
      />
      </template>

      <!-- Streaming partial message -->
      <StreamingMessage v-if="!isDraft && partialText" :content="partialText" />

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
        @click="scrollToClaudesTurn"
        title="Jump to Claude's response"
        aria-label="Scroll to Claude's latest response"
      >
        ↑
      </button>
    </div>

    <!-- Todo drawer - only shows when todos exist -->
    <TodoDrawer />

    <RunningState
      v-if="sessionsStore.currentSession?.status === 'running'"
      :active-model-display-name="activeModelDisplayName"
      :stopping="stopping"
      :work-logs="unassociatedWorkLogs"
      :partial-thinking="sessionsStore.partialThinking"
      :next-template="nextTemplate"
      :project-id="sessionsStore.currentSession?.projectId"
      @stop="handleStop"
    />

    <InputForm
      v-if="canSendMessage || isRunning || isScheduledForFuture"
      ref="inputFormRef"
      :session-id="sessionId"
      :model-value="input"
      :selected-model="selectedModel"
      @update:selectedModel="selectedModel = $event"
      :can-send-message="canSendMessage"
      :is-draft="isDraft"
      :is-scheduled-draft="isScheduledDraft"
      :is-scheduled-for-future="isScheduledForFuture"
      :sending="sending"
      :restarting="restarting"
      :toggling-thinking="togglingThinking"
      :save-status="saveStatus"
      :input-has-content="inputHasContent"
      :thinking-enabled="sessionsStore.currentSession?.thinkingEnabled"
      :working-directory="workingDirectory"
      :project-id="sessionsStore.currentSession?.projectId"
      :current-template-id="sessionsStore.currentSession?.nextTemplateId"
      :session-status="sessionsStore.currentSession?.status"
      :auto-reschedule-enabled="sessionsStore.currentSession?.autoRescheduleEnabled"
      :scheduled-at="sessionsStore.currentSession?.scheduledAt"
      :send-button-disabled-reason="sendButtonDisabledReason"
      :is-send-disabled="isSendDisabled"
      :auto-send-pending-prompt="sessionsStore.currentSession?.autoSendPendingPrompt ?? false"
      @submit="handleFormSubmit"
      @autoSendToggle="handleAutoSendToggle"
      @input="handleInput"
      @quickResponseInsert="handleQuickResponseInsert"
      @openQuickResponseSettings="quickResponseSettingsOpen = true"
      @update:attachedFiles="attachedFiles = $event"
      @openSlashCommand="showSlashCommandWizard = true"
      @thinkingToggle="handleThinkingToggle"
      @openSchedule="showScheduleModal = true"
      @openAutoReschedule="showAutoRescheduleModal = true"
      @templateChange="handleTemplateChange"
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

    <!-- Scheduling Info Panel -->
    <SchedulingInfo v-if="sessionsStore.currentSession" :session="sessionsStore.currentSession" />
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
import { useModelInfo } from '../composables/useModelInfo.js';
import { useMessageScroll } from '../composables/useMessageScroll.js';
import { useDraftSaving } from '../composables/useDraftSaving.js';
import { useSessionControl } from '../composables/useSessionControl.js';
import { api } from '../composables/useApi.js';
import TodoDrawer from './TodoDrawer.vue';
import ConversationPanel from './ConversationPanel.vue';
import TokenCostPanel from './TokenCostPanel.vue';
import MessageItem from './MessageItem.vue';
import StreamingMessage from './StreamingMessage.vue';
import InputForm from './InputForm.vue';
import RunningState from './RunningState.vue';
import QuickResponseSettings from './QuickResponseSettings.vue';
import ScheduleSessionModal from './ScheduleSessionModal.vue';
import AutoRescheduleModal from './AutoRescheduleModal.vue';
import SlashCommandWizard from './SlashCommandWizard.vue';
import SchedulingInfo from './SchedulingInfo.vue';
import { useQuickResponsesStore } from '../stores/quickResponses.js';
import { useProjectsStore } from '../stores/projects.js';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const sessionsStore = useSessionsStore();
const uiStore = useUiStore();
const templatesStore = useTemplatesStore();
const defaultsStore = useProjectDefaultsStore();
const quickResponsesStore = useQuickResponsesStore();
const projectsStore = useProjectsStore();
const { getModelDisplayName } = useModelInfo();
const router = useRouter();
const route = useRoute();

// Scroll management composable
const { messagesContainer, isNearBottom, hasNewMessages, scrollToBottom, scrollToClaudesTurn } = useMessageScroll({
  messages: computed(() => sessionsStore.messages),
  partialText: computed(() => sessionsStore.partialText),
  activeConversationId: computed(() => sessionsStore.activeConversationId),
});

// Session control composable
const {
  sending, stopping, restarting, togglingThinking,
  handleStop, handleRestart, handleStart, handleSend, handleThinkingToggle,
} = useSessionControl({
  getSessionId: () => props.sessionId,
});

// Local state
const input = ref('');
const quickResponseSettingsOpen = ref(false);
const showScheduleModal = ref(false);
const showAutoRescheduleModal = ref(false);
const showSlashCommandWizard = ref(false);
const inputFormRef = ref(null);
const branchingMessageId = ref(null);
const attachedFiles = ref([]);
const selectedModel = ref(null);

// Draft saving composable
const { saveStatus, saveError, handleInput, savePendingPrompt } = useDraftSaving({
  input,
  canSendMessage: computed(() => canSendMessage.value),
  isRunning: computed(() => isRunning.value),
  getSessionId: () => props.sessionId,
});

// partialText comes from the sessions store (set by SessionDetailView's WebSocket handlers)
const partialText = computed(() => sessionsStore.partialText);

const canSendMessage = computed(() => {
  const status = sessionsStore.currentSession?.status;
  return status === 'waiting' || status === 'scheduled' || status === 'stopped' || status === 'error';
});

const isRunning = computed(() => {
  return sessionsStore.currentSession?.status === 'running';
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

const activeModelDisplayName = computed(() => {
  const model = sessionsStore.currentSession?.model;
  if (!model) return null;
  return getModelDisplayName(model);
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

// Lifecycle
onMounted(async () => {
  const pending = sessionsStore.currentSession?.pendingPrompt;
  if (pending) {
    input.value = pending;
    nextTick(() => {
      const textareaRef = inputFormRef.value?.textareaRef;
      if (textareaRef) {
        textareaRef.value = pending;
      }
    });
  } else if (isDraft.value && sessionsStore.messages.length > 0) {
    const userMessage = sessionsStore.messages.find(msg => msg.role === 'user');
    if (userMessage) {
      input.value = userMessage.content;
      nextTick(() => {
        const textareaRef = inputFormRef.value?.textareaRef;
        if (textareaRef) {
          textareaRef.value = userMessage.content;
        }
      });
    }
  }

  if (sessionsStore.conversations.length === 0 ||
      sessionsStore.conversations[0]?.sessionId !== props.sessionId) {
    await sessionsStore.fetchConversations(props.sessionId);
  }

  if (sessionsStore.currentSession?.projectId) {
    const projectId = sessionsStore.currentSession.projectId;
    quickResponsesStore.fetchForProject(projectId);

    try {
      await projectsStore.fetchProject(projectId);
    } catch (err) {
      console.error('Failed to fetch project:', err);
    }
  }

  await sessionsStore.fetchWorkLogs(props.sessionId);

  const convId = route.query.conv;
  if (convId && convId !== sessionsStore.activeConversationId) {
    await sessionsStore.switchConversation(props.sessionId, convId);
  }

  scrollToBottom(true);
});

onUnmounted(() => {
  sessionsStore.clearWorkLogs();
});

// Re-fetch messages and work logs when session status changes from running to waiting/completed
watch(
  () => sessionsStore.currentSession?.status,
  async (newStatus, oldStatus) => {
    if (oldStatus === 'running' && (newStatus === 'waiting' || newStatus === 'completed')) {
      console.log(`[CONV] Status changed from ${oldStatus} to ${newStatus}, refetching messages and work logs`);
      sessionsStore.clearPartialText();
      await sessionsStore.fetchMessages(props.sessionId, false, sessionsStore.activeConversationId);
      await sessionsStore.fetchWorkLogs(props.sessionId);
    }

    // Reset auto-send flag on stop/error/completed transitions
    if (newStatus === 'stopped' || newStatus === 'error' || newStatus === 'completed') {
      if (sessionsStore.currentSession?.autoSendPendingPrompt) {
        sessionsStore.updateAutoSendPendingPrompt(props.sessionId, false);
      }
    }

    // If server consumed the pending prompt (auto-send), clear local input.
    // The server broadcasts SESSION_UPDATED with cleared pendingPrompt/autoSendPendingPrompt
    // BEFORE calling continueSession, so by the time the status watcher fires for
    // running→waiting, the store should already reflect the cleared state.
    if (oldStatus === 'running' && newStatus !== 'running') {
      await nextTick();
      const session = sessionsStore.currentSession;
      if (session && !session.pendingPrompt && !session.autoSendPendingPrompt && input.value) {
        // Server cleared the prompt — it was auto-sent
        input.value = '';
      }
    }
  }
);

// Watch for messages loading on draft sessions and populate textarea
watch(
  () => sessionsStore.messages,
  (newMessages) => {
    const textareaRef = inputFormRef.value?.textareaRef;
    if (isDraft.value && textareaRef) {
      const textareaHasContent = textareaRef.value && textareaRef.value.trim().length > 0;
      if (!textareaHasContent) {
        const userMessage = newMessages.find(msg => msg.role === 'user');
        if (userMessage && userMessage.content) {
          input.value = userMessage.content;
          nextTick(() => {
            const ref = inputFormRef.value?.textareaRef;
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

// Message reconciliation watcher
watch(
  () => sessionsStore.activeConversationId,
  async (newConvId, oldConvId) => {
    if (newConvId && newConvId !== oldConvId) {
      sessionsStore.clearPartialText();
      await nextTick();
      console.log(`[CONV] activeConversationId changed to ${newConvId}, refetching messages`);
      await sessionsStore.fetchMessages(props.sessionId, false, newConvId);
    }
  }
);

function getProjectDefaultModel() {
  const projectId = sessionsStore.currentSession?.projectId;
  if (!projectId) return null;
  const defaults = defaultsStore.getDefaultsForProject(projectId);
  return defaults?.model || null;
}

// Watch for conversation query parameter changes
watch(
  () => route.query.conv,
  async (newConvId, oldConvId) => {
    if (newConvId && newConvId !== oldConvId && newConvId !== sessionsStore.activeConversationId) {
      await sessionsStore.switchConversation(props.sessionId, newConvId);
    }
  }
);

// Model initialization from active conversation
watch(
  () => sessionsStore.activeConversation,
  (conv) => {
    if (selectedModel.value === null) {
      selectedModel.value = sessionsStore.currentSession?.model ||
        getProjectDefaultModel() ||
        'sonnet';
    }
  },
  { immediate: true }
);

// Persist model selection to session
watch(selectedModel, async (newModel, oldModel) => {
  if (oldModel !== null && newModel && newModel !== oldModel) {
    try {
      await sessionsStore.updateSessionModel(props.sessionId, newModel);
    } catch (err) {
      console.error('Failed to persist model selection:', err);
    }
  }
});

// Form submission handler
async function handleFormSubmit() {
  // Block submission during running — user must use auto-send instead
  if (isRunning.value) return;

  if (isDraft.value || isScheduledDraft.value) {
    // Start draft session
    const textareaRef = inputFormRef.value?.textareaRef;
    const currentValue = textareaRef?.value || input.value;
    const sessionModel = sessionsStore.currentSession?.pendingModel
      || sessionsStore.currentSession?.model;
    await handleStart(currentValue, sessionModel);
  } else {
    // Send follow-up message
    const textareaRef = inputFormRef.value?.textareaRef;
    const currentValue = textareaRef?.value || input.value;
    const success = await handleSend(currentValue, attachedFiles.value, selectedModel.value);
    if (success) {
      input.value = '';
      if (textareaRef) textareaRef.value = '';
      attachedFiles.value = [];
      inputFormRef.value?.clearFiles();
    }
  }
}

function handleQuickResponseInsert({ content, autoSubmit }) {
  const currentValue = input.value.trim();
  const newValue = currentValue ? currentValue + '\n\n' + content : content;
  input.value = newValue;

  if (autoSubmit) {
    nextTick(() => {
      handleFormSubmit();
    });
  } else {
    nextTick(() => {
      const textareaRef = inputFormRef.value?.textareaRef;
      if (textareaRef) {
        textareaRef.value = newValue;
        textareaRef.focus();
        textareaRef.selectionStart = textareaRef.selectionEnd = textareaRef.value.length;

        if (canSendMessage.value && newValue.trim()) {
          savePendingPrompt(newValue);
        }
      }
    });
  }
}

async function handleAutoSendToggle(enabled) {
  const sessionId = props.sessionId;
  try {
    if (enabled && input.value.trim()) {
      // Save current text immediately so the server has it for auto-send
      await savePendingPrompt(input.value);
    }
    await sessionsStore.updateAutoSendPendingPrompt(sessionId, enabled);
  } catch (err) {
    uiStore.error(`Failed to ${enabled ? 'enable' : 'disable'} auto-send: ${err.message}`);
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
      // Find the MessageItem for this message and reset its branch editor
      // The MessageItem component handles its own branch editor ref
    }
  }
}
</script>

<style scoped>
.conversation-tab {
  display: flex;
  flex-direction: column;
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

/* Slack-style new messages button */
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

/* Mobile adjustments */
@media (max-width: 600px) {
  .scroll-to-claude-btn {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    margin-right: 0.25rem;
  }
}
</style>
