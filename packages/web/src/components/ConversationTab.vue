<template>
  <div
    class="conversation-tab"
    :class="{ 'connection-stale': isStale }"
  >
    <!-- Stale content badge -->
    <StaleBadge :is-stale="isStale" />

    <!-- Unified Conversation Panel - selector + BTE cost display -->
    <ConversationPanel
      v-if="!isScheduledForFuture"
      :session-id="sessionId"
      :hide-new-conversation="hideNewConversation"
    />

    <ConversationMessages
      ref="conversationMessagesRef"
      :session-id="sessionId"
      :is-draft="isDraft"
      :is-scheduled-draft="isScheduledDraft"
      :session-status="sessionsStore.currentSession?.status"
      :scroll-container-ref="scrollContainerRef"
    />

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
      @update:model-value="input = $event"
      @update:selected-model="selectedModel = $event"
      @submit="handleFormSubmit"
      @auto-send-toggle="handleAutoSendToggle"
      @input="handleInput"
      @quick-response-insert="handleQuickResponseInsert"
      @open-quick-response-settings="quickResponseSettingsOpen = true"
      @update:attached-files="attachedFiles = $event"
      @open-slash-command="showSlashCommandWizard = true"
      @thinking-toggle="handleThinkingToggle"
      @open-schedule="showScheduleModal = true"
      @open-auto-reschedule="showAutoRescheduleModal = true"
      @template-change="handleTemplateChange"
    />

    <!-- Scheduling Info Panel (scheduled countdown + auto-reschedule status) -->
    <SchedulingInfo
      v-if="sessionsStore.currentSession"
      :session="sessionsStore.currentSession"
    />

    <!-- Quick Response Settings Modal -->
    <QuickResponseSettings
      :is-open="quickResponseSettingsOpen"
      :project-id="sessionsStore.currentSession?.projectId"
      @close="quickResponseSettingsOpen = false"
    />

    <!-- Schedule Session Modal -->
    <ScheduleSessionModal
      v-model:is-open="showScheduleModal"
      :session-id="sessionId"
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
      v-model:is-open="showSlashCommandWizard"
      :working-directory="workingDirectory"
      mode="insert"
      @insert="handleSlashCommandInsert"
    />
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { formatDistanceToNow } from 'date-fns';
import { useInjectedSessionsStore } from '../composables/useOverlayStore.js';
import { useUiStore } from '../stores/ui.js';
import { useTemplatesStore } from '../stores/templates.js';
import { useProjectDefaultsStore } from '../stores/projectDefaults.js';
import { useModelInfo } from '../composables/useModelInfo.js';
import { useDraftSaving } from '../composables/useDraftSaving.js';
import { useSessionControl } from '../composables/useSessionControl.js';
import { useConnectionStatus } from '../composables/useConnectionStatus.js';
import TodoDrawer from './TodoDrawer.vue';
import ConversationPanel from './ConversationPanel.vue';
import ConversationMessages from './ConversationMessages.vue';
import InputForm from './InputForm.vue';
import RunningState from './RunningState.vue';
import QuickResponseSettings from './QuickResponseSettings.vue';
import ScheduleSessionModal from './ScheduleSessionModal.vue';
import AutoRescheduleModal from './AutoRescheduleModal.vue';
import SchedulingInfo from './SchedulingInfo.vue';
import SlashCommandWizard from './SlashCommandWizard.vue';
import StaleBadge from './StaleBadge.vue';
import { useQuickResponsesStore } from '../stores/quickResponses.js';
import { useProjectsStore } from '../stores/projects.js';

const props = defineProps({
  sessionId: { type: String, required: true },
  scrollContainerRef: { type: Object, default: null },
  hideNewConversation: { type: Boolean, default: false },
});

const sessionsStore = useInjectedSessionsStore();
const uiStore = useUiStore();
const templatesStore = useTemplatesStore();
const defaultsStore = useProjectDefaultsStore();
const quickResponsesStore = useQuickResponsesStore();
const projectsStore = useProjectsStore();
const { getModelDisplayName } = useModelInfo();
const { isStale } = useConnectionStatus();
const route = useRoute();

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
const conversationMessagesRef = ref(null);
const attachedFiles = ref([]);
const selectedModel = ref(null);

// Draft saving composable
const {
  saveStatus,
  saveError,
  handleInput,
  savePendingPrompt,
  flush: flushDraft,
  cancel: cancelDraft,
} = useDraftSaving({
  input,
  canSendMessage: computed(() => canSendMessage.value),
  isRunning: computed(() => isRunning.value),
  getSessionId: () => props.sessionId,
});

const canSendMessage = computed(() => {
  const status = sessionsStore.currentSession?.status;
  return status === 'waiting' || status === 'scheduled' || status === 'stopped' || status === 'error';
});

const isRunning = computed(() => sessionsStore.currentSession?.status === 'running');

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

const unassociatedWorkLogs = computed(() => sessionsStore.getUnassociatedWorkLogs);

const inputHasContent = computed(() => input.value.trim().length > 0);

const isSendDisabled = computed(() => {
  if (isStale.value) return true;
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
  if (isStale.value) {
    return 'Waiting for connection...';
  }
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

const isScheduledForFuture = computed(() => sessionsStore.isScheduledDraft(sessionsStore.currentSession));

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

// Statuses that legitimately expect a standing draft on mount.
const RESTORE_ALLOWED_STATUSES = new Set(['waiting', 'scheduled', 'stopped', 'error', 'running']);

/**
 * Compute the initial `input.value` on mount.
 *
 * Critically, skips the restore entirely if we just sent a prompt for this
 * session. Otherwise an overlay remount / session switch / overlay reopen
 * within the TTL window would re-populate the textarea with the prompt we
 * just sent (the "ghost prompt" bug).
 */
function restoreInitialInput() {
  const session = sessionsStore.currentSession;
  const recentlySent = sessionsStore.hasRecentSend?.(session?.id) ?? false;
  if (recentlySent) return;

  const pending = session?.pendingPrompt;
  const statusAllowsRestore = Boolean(session) && (isDraft.value || RESTORE_ALLOWED_STATUSES.has(session?.status));

  if (pending && statusAllowsRestore) {
    // No imperative DOM write — ResizableTextarea's watch(modelValue)
    // syncs the DOM when `input.value` changes.
    input.value = pending;
    return;
  }
  if (isDraft.value && sessionsStore.messages.length > 0) {
    const userMessage = sessionsStore.messages.find(msg => msg.role === 'user');
    if (userMessage) input.value = userMessage.content;
  }
}

// Lifecycle
onMounted(async () => {
  restoreInitialInput();

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

  conversationMessagesRef.value?.scrollToBottom(true);
});

onUnmounted(() => {
  // Flush any pending draft save immediately before the component is destroyed.
  // This ensures drafts typed within the debounce window (500ms) are not lost
  // when the overlay closes or the user switches sessions.
  flushDraft();
  sessionsStore.clearWorkLogs();
});

// Statuses that indicate a session has terminated
const terminalStatuses = new Set(['stopped', 'error', 'completed']);

// Check whether the local input should be cleared when a run ends.
//
// If the session was Sent/Started within the last 5 s (`hasRecentSend`), we
// clear unconditionally — this guarantees the "ghost prompt" cleanup runs
// even if the session object's `pendingPrompt` is momentarily stale from a
// late-arriving WS frame. Otherwise we fall back to the original behavior:
// only clear when the server has no pending prompt and no auto-send is
// queued.
function shouldClearInputAfterRun(session, inputVal) {
  if (!session || !inputVal) return false;
  if (sessionsStore.hasRecentSend?.(session.id)) return true;
  return !session.pendingPrompt && !session.autoSendPendingPrompt;
}

// Re-fetch messages and work logs when session status changes from running to waiting/completed
watch(
  () => sessionsStore.currentSession?.status,
  async (newStatus, oldStatus) => {
    // Only react if currentSession matches this tab's session.
    // When the overlay switches currentSession to a child session,
    // the parent's ConversationTab must not react to the child's status changes.
    if (sessionsStore.currentSession?.id !== props.sessionId) return;

    if (oldStatus === 'running' && (newStatus === 'waiting' || newStatus === 'completed')) {
      console.log(`[CONV] Status changed from ${oldStatus} to ${newStatus}, refetching messages and work logs`);
      sessionsStore.clearPartialText();
      await sessionsStore.fetchMessages(props.sessionId, false, sessionsStore.activeConversationId);
      await sessionsStore.fetchWorkLogs(props.sessionId);
    }

    // Reset auto-send flag on stop/error/completed transitions
    if (terminalStatuses.has(newStatus) && sessionsStore.currentSession?.autoSendPendingPrompt) {
      sessionsStore.updateAutoSendPendingPrompt(props.sessionId, false);
    }

    // If server consumed the pending prompt (auto-send), or this session was
    // just Sent/Started, clear local input. This is the event-driven end
    // condition for the recent-send TTL — when the run ends, we've
    // definitively finished the Send/Start flow, so we drop the marker.
    if (oldStatus === 'running' && newStatus !== 'running') {
      await nextTick();
      const currentSession = sessionsStore.currentSession;
      if (shouldClearInputAfterRun(currentSession, input.value)) {
        input.value = '';
        if (currentSession?.id) {
          sessionsStore.clearRecentSend?.(currentSession.id);
        }
      }
    }
  }
);

// Watch for messages loading on draft sessions and populate textarea.
// Uses `input.value` (the reactive source of truth) rather than peeking at
// the DOM via the textareaRef — the `input` ref is the canonical value.
// Suppresses restore if we just sent a prompt for this session.
watch(
  () => sessionsStore.messages,
  (newMessages) => {
    if (!isDraft.value) return;
    if (input.value && input.value.trim().length > 0) return;
    const recentlySent = sessionsStore.hasRecentSend?.(props.sessionId) ?? false;
    if (recentlySent) return;
    const userMessage = newMessages.find(msg => msg.role === 'user');
    if (userMessage && userMessage.content) {
      input.value = userMessage.content;
    }
  },
  { deep: true, immediate: true }
);

// Message reconciliation watcher
watch(
  () => sessionsStore.activeConversationId,
  async (newConvId, oldConvId) => {
    // Only react if this tab's session is the currently viewed one.
    // When the overlay loads a child session's conversations, it changes
    // activeConversationId — the parent's ConversationTab must not react.
    if (sessionsStore.viewedSessionId && sessionsStore.viewedSessionId !== props.sessionId) return;

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
function getSubmittedInputValue(textareaRef) {
  if (input.value) return input.value;
  return textareaRef?.value || '';
}

function clearSubmittedInput(textareaRef) {
  input.value = '';
  if (textareaRef && textareaRef.value !== '') {
    textareaRef.value = '';
  }
}

async function handleFormSubmit() {
  if (isRunning.value) return;

  // Cancel any pending debounced draft save BEFORE Send/Start. Otherwise a
  // debounce scheduled within the last 500 ms could fire after we've
  // cleared the server's pendingPrompt and re-write the old value back —
  // the "ghost prompt" race.
  cancelDraft();

  const textareaRef = inputFormRef.value?.textareaRef;
  const currentValue = getSubmittedInputValue(textareaRef);
  if (isDraft.value || isScheduledDraft.value) {
    const sessionModel = selectedModel.value
      || sessionsStore.currentSession?.pendingModel
      || sessionsStore.currentSession?.model;
    const success = await handleStart(currentValue, sessionModel);
    if (success) {
      clearSubmittedInput(textareaRef);
      attachedFiles.value = [];
      inputFormRef.value?.clearFiles();
    }
  } else {
    const success = await handleSend(currentValue, attachedFiles.value, selectedModel.value);
    if (success) {
      clearSubmittedInput(textareaRef);
      attachedFiles.value = [];
      inputFormRef.value?.clearFiles();
    }
  }
}

function handleQuickResponseInsert({ content, autoSubmit }) {
  const currentValue = input.value.trim();
  const newValue = currentValue ? `${currentValue  }\n\n${  content}` : content;
  input.value = newValue;

  if (autoSubmit) {
    // Auto-submit path: cancel any pending debounced save, then submit.
    // This mirrors the regular Send invariant (see handleFormSubmit).
    cancelDraft();
    nextTick(() => {
      handleFormSubmit();
    });
  } else {
    // Non-submit path: blur the textarea and persist the inserted text.
    // DOM value syncs automatically via ResizableTextarea's watch(modelValue).
    nextTick(() => {
      const textareaRef = inputFormRef.value?.textareaRef;
      if (textareaRef) {
        textareaRef.blur();
      }
      if (canSendMessage.value && newValue.trim()) {
        savePendingPrompt(newValue);
      }
    });
  }
}

async function handleAutoSendToggle(enabled) {
  const sessionId = props.sessionId;
  try {
    if (enabled && input.value.trim()) {
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

function handleSlashCommandInsert({ text }) {
  const existing = input.value.trim();
  if (existing) {
    input.value = `${text  } ${  existing}`;
  } else {
    input.value = `${text  } `;
  }

  // Focus + caret placement are legitimate imperative operations (there is
  // no reactive equivalent). The textarea VALUE is driven by the reactive
  // `input` ref — no imperative DOM write. We persist the new value by
  // calling `savePendingPrompt` directly (mirroring `handleQuickResponseInsert`),
  // avoiding the synthetic 'input' event indirection.
  nextTick(() => {
    const textareaRef = inputFormRef.value?.textareaRef;
    if (textareaRef) {
      textareaRef.focus();
      textareaRef.selectionStart = textareaRef.selectionEnd = input.value.length;
    }
    if (canSendMessage.value && input.value.trim()) {
      savePendingPrompt(input.value);
    }
  });
}

// Expose flushDraft so parent components (e.g. SessionChatOverlay) can
// force-save pending drafts before switching sessions.
defineExpose({ flushDraft });
</script>

<style scoped>
.conversation-tab {
  display: flex;
  flex-direction: column;
  transition: opacity 0.3s ease;
}

.conversation-tab.connection-stale {
  opacity: 0.5;
}
</style>
