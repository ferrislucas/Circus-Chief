<template>
  <div class="conversation-tab">
    <!-- Unified Conversation Panel - selector + BTE cost display -->
    <ConversationPanel v-if="!isScheduledForFuture" :session-id="sessionId" :hide-new-conversation="hideNewConversation" />

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

    <!-- Scheduling Info Panel (scheduled countdown + auto-reschedule status) -->
    <SchedulingInfo
      v-if="sessionsStore.currentSession"
      :session="sessionsStore.currentSession"
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
      :workingDirectory="workingDirectory"
      mode="insert"
      @insert="handleSlashCommandInsert"
    />

  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { formatDistanceToNow } from 'date-fns';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';
import { useTemplatesStore } from '../stores/templates.js';
import { useProjectDefaultsStore } from '../stores/projectDefaults.js';
import { useModelInfo } from '../composables/useModelInfo.js';
import { useDraftSaving } from '../composables/useDraftSaving.js';
import { useSessionControl } from '../composables/useSessionControl.js';
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
import { useQuickResponsesStore } from '../stores/quickResponses.js';
import { useProjectsStore } from '../stores/projects.js';

const props = defineProps({
  sessionId: { type: String, required: true },
  scrollContainerRef: { type: Object, default: null },
  hideNewConversation: { type: Boolean, default: false },
});

const sessionsStore = useSessionsStore();
const uiStore = useUiStore();
const templatesStore = useTemplatesStore();
const defaultsStore = useProjectDefaultsStore();
const quickResponsesStore = useQuickResponsesStore();
const projectsStore = useProjectsStore();
const { getModelDisplayName } = useModelInfo();
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
const { saveStatus, saveError, handleInput, savePendingPrompt } = useDraftSaving({
  input,
  canSendMessage: computed(() => canSendMessage.value),
  isRunning: computed(() => isRunning.value),
  getSessionId: () => props.sessionId,
});

const canSendMessage = computed(() => {
  const status = sessionsStore.currentSession?.status;
  return status === 'waiting' || status === 'scheduled' || status === 'stopped' || status === 'error';
});

const isRunning = computed(() => {
  return sessionsStore.currentSession?.status === 'running';
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

  conversationMessagesRef.value?.scrollToBottom(true);
});

onUnmounted(() => {
  sessionsStore.clearWorkLogs();
});

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
    if (newStatus === 'stopped' || newStatus === 'error' || newStatus === 'completed') {
      if (sessionsStore.currentSession?.autoSendPendingPrompt) {
        sessionsStore.updateAutoSendPendingPrompt(props.sessionId, false);
      }
    }

    // If server consumed the pending prompt (auto-send), clear local input.
    if (oldStatus === 'running' && newStatus !== 'running') {
      await nextTick();
      const session = sessionsStore.currentSession;
      if (session && !session.pendingPrompt && !session.autoSendPendingPrompt && input.value) {
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
async function handleFormSubmit() {
  if (isRunning.value) return;

  if (isDraft.value || isScheduledDraft.value) {
    const textareaRef = inputFormRef.value?.textareaRef;
    const currentValue = textareaRef?.value || input.value;
    const sessionModel = selectedModel.value
      || sessionsStore.currentSession?.pendingModel
      || sessionsStore.currentSession?.model;
    await handleStart(currentValue, sessionModel);
  } else {
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
    input.value = text + ' ' + existing;
  } else {
    input.value = text + ' ';
  }

  nextTick(() => {
    const textareaRef = inputFormRef.value?.textareaRef;
    if (textareaRef) {
      textareaRef.value = input.value;
      textareaRef.focus();
      textareaRef.selectionStart = textareaRef.selectionEnd = input.value.length;
      textareaRef.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}
</script>

<style scoped>
.conversation-tab {
  display: flex;
  flex-direction: column;
}
</style>
