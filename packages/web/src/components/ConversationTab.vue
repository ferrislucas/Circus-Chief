<template>
  <div class="conversation-tab">
    <!-- Unified Conversation Panel - selector + BTE cost display -->
    <ConversationPanel :session-id="sessionId" />

    <div class="messages" ref="messagesContainer">
      <!-- Hide messages for draft and scheduled sessions (only show in input field) -->
      <template v-if="!isDraft && !isScheduledDraft">
      <div
        v-for="message in sessionsStore.messages"
        :key="message.id"
        :class="['message', `message-${message.role}`]"
        :data-message-id="message.id"
        :data-testid="`message-${message.role}`"
      >
        <div class="message-header">
          <span class="message-role">{{ message.role }}</span>
          <!-- Show model for assistant messages -->
          <span v-if="message.role === 'assistant' && message.model" class="message-model">
            {{ formatModelName(message.model) }}
          </span>
          <span class="message-time">{{ formatTime(message.timestamp) }}</span>
          <!-- Branch button for user messages -->
          <button
            v-if="message.role === 'user' && canBranch && branchingMessageId !== message.id"
            type="button"
            class="branch-btn"
            data-testid="branch-button"
            @click="openBranchEditor(message.id)"
            title="Create a branch from this message"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 2v8M4 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM4 6c0 2 2 4 4 4h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="branch-btn-text">Branch</span>
          </button>
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
        <!-- Branch Editor for user messages -->
        <BranchEditor
          v-if="message.role === 'user' && branchingMessageId === message.id"
          ref="branchEditorRef"
          :message-id="message.id"
          @create="handleBranchCreate"
          @cancel="closeBranchEditor"
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

      <!-- Jump to latest button (Slack-style) -->
      <button
        v-if="!isNearBottom && hasNewMessages"
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

    <form v-if="canSendMessage" @submit.prevent="(isDraft || isScheduledDraft) ? handleStart() : handleSend()" class="input-form">
      <ResizableTextarea
        ref="textareaRef"
        class="form-input form-textarea"
        :placeholder="(isDraft || isScheduledDraft) ? 'Edit your prompt...' : 'Send a follow-up message...'"
        :min-height="80"
        @input="handleInput"
        @keydown="handleKeydown"
      />

      <!-- Quick Responses Panel - shows below the textarea when not running or for draft sessions -->
      <QuickResponsesPanel
        v-if="canSendMessage || isDraft"
        :show-empty="true"
        @insert="handleQuickResponseInsert"
        @openSettings="quickResponseSettingsOpen = true"
      />

      <!-- Send button row -->
      <div class="send-button-row">
        <div v-if="isDraft" class="draft-actions">
          <button type="submit" class="btn btn-primary btn-send-full" :disabled="restarting || saveStatus === 'saving'">
            <span v-if="restarting" class="loading-spinner"></span>
            {{ restarting ? 'Sending...' : 'Send' }}
          </button>
        </div>
        <template v-else>
          <button type="submit" class="btn btn-primary btn-send-full" :disabled="isSendDisabled">
            <span v-if="sending" class="loading-spinner"></span>
            {{ sending ? 'Sending...' : 'Send' }}
          </button>
        </template>
      </div>

      <div class="input-controls">
        <div class="session-options">
          <div class="mode-switcher">
            <ModeSelector :sessionId="sessionId" />
          </div>

          <ModelSelector :sessionId="sessionId" />

          <FileAttachment ref="fileAttachment" @update:files="attachedFiles = $event" />
          <SlashCommandButton
            v-if="workingDirectory"
            @open="showSlashCommandWizard = true"
          />
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
        </div>
      </div>

      <!-- Orchestration Panel - shows after input controls -->
      <OrchestrationPanel
        v-if="canSendMessage || isDraft"
        :session-id="sessionId"
        :project-id="sessionsStore.currentSession?.projectId"
        :current-template-id="sessionsStore.currentSession?.nextTemplateId"
        :session-status="sessionsStore.currentSession?.status"
        :is-draft="isDraft"
        :input-has-content="inputHasContent"
        @openSchedule="showScheduleModal = true"
        @update:templateId="handleTemplateChange"
      />
    </form>

    <div v-else-if="sessionsStore.currentSession?.status === 'running'" class="running-state">
      <!-- Header row with status, token display, and stop button -->
      <div class="running-header">
        <div class="running-status">
          <span class="loading-spinner"></span>
          <span class="running-title">Claude is working...</span>
        </div>
        <button type="button" class="btn btn-danger btn-stop" @click="handleStop" :disabled="stopping">
          <span v-if="stopping" class="loading-spinner"></span>
          Stop
        </button>
      </div>

      <!-- Work logs panel (without its own header) -->
      <LiveWorkLogPanel
        :work-logs="unassociatedWorkLogs"
        :partial-thinking="sessionsStore.partialThinking"
        :show-header="false"
      />

      <!-- Show template indicator while running -->
      <div v-if="nextTemplate" class="template-pending">
        <span class="template-pending-label">Next:</span>
        <router-link
          :to="`/projects/${sessionsStore.currentSession.projectId}/templates`"
          class="template-pending-link"
          :title="`View template: ${nextTemplate.name}`"
        >
          {{ nextTemplate.name }}
        </router-link>
        <span class="template-pending-description">will trigger when Claude finishes</span>
      </div>
    </div>

    <!-- Error banner - shown above input form when session has error -->
    <div v-if="sessionsStore.currentSession?.status === 'error'" class="error-banner">
      <div class="error-header">
        <span class="error-icon">⚠️</span>
        <span class="error-title">Session Error</span>
        <button
          type="button"
          class="btn-icon btn-copy-error"
          @click="copyError"
          title="Copy error message"
        >
          📋
        </button>
      </div>
      <div class="error-content">
        <pre class="error-message">{{ sessionsStore.currentSession.error || 'Unknown error' }}</pre>
      </div>
      <p class="error-hint">You can continue the conversation below, or try a different approach.</p>
    </div>

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
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';
import { useTemplatesStore } from '../stores/templates.js';
import { useSessionSubscription } from '../composables/useWebSocket.js';
import { useSubmitShortcut } from '../composables/useSubmitShortcut.js';
import { api } from '../composables/useApi.js';
import TodoDrawer from './TodoDrawer.vue';
import WorkLogPanel from './WorkLogPanel.vue';
import MarkdownViewer from './MarkdownViewer.vue';
import LiveWorkLogPanel from './LiveWorkLogPanel.vue';
import ConversationPanel from './ConversationPanel.vue';
import TokenCostPanel from './TokenCostPanel.vue';
import FileAttachment from './FileAttachment.vue';
import ModelSelector from './ModelSelector.vue';
import ModeSelector from './ModeSelector.vue';
import TemplateSelector from './TemplateSelector.vue';
import QuickResponsesPanel from './QuickResponsesPanel.vue';
import QuickResponseSettings from './QuickResponseSettings.vue';
import BranchEditor from './BranchEditor.vue';
import ScheduleSessionModal from './ScheduleSessionModal.vue';
import ResizableTextarea from './ResizableTextarea.vue';
import SlashCommandButton from './SlashCommandButton.vue';
import SlashCommandWizard from './SlashCommandWizard.vue';
import OrchestrationPanel from './OrchestrationPanel.vue';
import { useQuickResponsesStore } from '../stores/quickResponses.js';
import { useProjectsStore } from '../stores/projects.js';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const sessionsStore = useSessionsStore();
const uiStore = useUiStore();
const templatesStore = useTemplatesStore();
const quickResponsesStore = useQuickResponsesStore();
const projectsStore = useProjectsStore();

const input = ref('');
const quickResponseSettingsOpen = ref(false);
const showScheduleModal = ref(false);
const showSlashCommandWizard = ref(false);
const saveStatus = ref('saved'); // 'saved', 'saving', 'error', 'unsaved'
const saveError = ref('');
const textareaRef = ref(null);
let inputSyncTimer = null;

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
const messagesContainer = ref(null);
const attachedFiles = ref([]);
const fileAttachment = ref(null);
const branchingMessageId = ref(null); // Message ID currently being branched from
const branchEditorRef = ref(null);
let draftSaveTimer = null;

const partialText = ref('');
const isNearBottom = ref(true);
const hasNewMessages = ref(false);
let debounceTimer = null;
let partialThrottleTimer = null;
let pendingPartialText = null;
const PARTIAL_THROTTLE_MS = 150; // Throttle streaming updates to reduce CPU load on iPad

const SCROLL_THRESHOLD = 100; // pixels from bottom to consider "at bottom"

const canSendMessage = computed(() => {
  const status = sessionsStore.currentSession?.status;
  return status === 'waiting' || status === 'scheduled' || status === 'stopped' || status === 'error';
});

const canBranch = computed(() => {
  const status = sessionsStore.currentSession?.status;
  // Can only branch when session is not running
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

// Computed to check if input has content (for button disabled state)
// Uses reactive input.value as source of truth
const inputHasContent = computed(() => {
  // Check reactive input value (synced from textarea via handleInput or watch)
  return input.value.trim().length > 0;
});

// Computed for send button disabled state - avoids re-evaluating on every render
const isSendDisabled = computed(() => {
  return !inputHasContent.value || sending.value;
});

// Check if there are any assistant messages for the scroll-to-claude button
const hasAssistantMessages = computed(() => {
  return sessionsStore.messages.some(msg => msg.role === 'assistant');
});

// Computed property to get template details for the next template indicator
const nextTemplate = computed(() => {
  const templateId = sessionsStore.currentSession?.nextTemplateId;
  if (!templateId) return null;
  return templatesStore.getTemplateById(templateId);
});

// Computed property to get the working directory for slash commands
const workingDirectory = computed(() => {
  const session = sessionsStore.currentSession;
  if (!session) {
    console.log('[workingDirectory] No current session');
    return null;
  }

  // Use git worktree if available, otherwise get from project
  if (session.gitWorktree) {
    console.log('[workingDirectory] Using session.gitWorktree:', session.gitWorktree);
    return session.gitWorktree;
  }

  // First try currentProject if it matches the session's project,
  // then fall back to getProjectById (for direct session navigation or when
  // currentProject is stale from a different project view)
  let project = projectsStore.currentProject;
  if ((!project || project.id !== session.projectId) && session.projectId) {
    console.log('[workingDirectory] currentProject mismatch or null, falling back to getProjectById');
    project = projectsStore.getProjectById(session.projectId);
  }
  const result = project?.workingDirectory || null;
  console.log('[workingDirectory] Using project.workingDirectory:', result, 'from project:', project?.id);
  return result;
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
  // Load pendingPrompt from session data (works for both draft and waiting sessions)
  const pending = sessionsStore.currentSession?.pendingPrompt;
  if (pending) {
    input.value = pending;
    // Set textarea value directly
    nextTick(() => {
      if (textareaRef.value) {
        textareaRef.value.value = pending;
      }
    });
  } else if (isDraft.value && sessionsStore.messages.length > 0) {
    // Fallback: If this is a draft session without pendingPrompt, load from initial message
    const userMessage = sessionsStore.messages.find(msg => msg.role === 'user');
    if (userMessage) {
      input.value = userMessage.content;
      // Set textarea value directly
      nextTick(() => {
        if (textareaRef.value) {
          textareaRef.value.value = userMessage.content;
        }
      });
    }
  }

  // Add scroll event listener
  if (messagesContainer.value) {
    messagesContainer.value.addEventListener('scroll', handleScroll);
  }

  // Only fetch conversations if not already loaded for this session
  // This prevents overwriting updated data (e.g., token counts during streaming)
  if (sessionsStore.conversations.length === 0 ||
      sessionsStore.conversations[0]?.sessionId !== props.sessionId) {
    await sessionsStore.fetchConversations(props.sessionId);
  }

  // Fetch quick responses and project data for the project
  if (sessionsStore.currentSession?.projectId) {
    const projectId = sessionsStore.currentSession.projectId;
    quickResponsesStore.fetchForProject(projectId);

    // Always fetch the project to ensure workingDirectory is available for slash commands
    // This is especially important when navigating directly to a session URL
    try {
      await projectsStore.fetchProject(projectId);
    } catch (err) {
      console.error('Failed to fetch project:', err);
    }
  }

  // Throttle partial text updates to reduce CPU load on iPad
  // Without throttling, rapid updates cause excessive re-renders and markdown parsing
  unsubPartial = onPartial((text) => {
    pendingPartialText = text;

    // If no throttle timer is running, update immediately and start timer
    if (!partialThrottleTimer) {
      partialText.value = text;
      scrollToBottom();

      partialThrottleTimer = setTimeout(() => {
        // Apply any pending update that arrived during throttle period
        if (pendingPartialText !== null && pendingPartialText !== partialText.value) {
          partialText.value = pendingPartialText;
          scrollToBottom();
        }
        partialThrottleTimer = null;
        pendingPartialText = null;
      }, PARTIAL_THROTTLE_MS);
    }
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
    console.log(`[CONV] CONVERSATION_CREATED event: conversation ${conversation.id}, isActive: ${conversation.isActive}`);
    sessionsStore.addConversation(conversation);
    // The watcher on activeConversationId will trigger the fetch automatically
  });

  unsubConvUpdated = onConversationUpdated((conversation) => {
    console.log(`[CONV] CONVERSATION_UPDATED event: conversation ${conversation.id}, isActive: ${conversation.isActive}`);
    sessionsStore.updateConversation(conversation);
  });

  unsubConvDeleted = onConversationDeleted((conversationId, newActiveConv) => {
    console.log(`[CONV] CONVERSATION_DELETED event: deleted ${conversationId}, newActive: ${newActiveConv?.id || 'none'}`);
    sessionsStore.removeConversation(conversationId, newActiveConv);
    // If we have a new active conversation, fetch its messages
    if (newActiveConv) {
      console.log(`[CONV] CONVERSATION_DELETED: fetching messages for new active conversation ${newActiveConv.id}`);
      sessionsStore.fetchMessages(props.sessionId, false);
    }
  });

  // NOTE: onUsageUpdate subscription moved to SessionDetailView.onMounted to ensure
  // conversations are loaded before usage updates arrive (avoids race conditions)

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
  // NOTE: unsubUsage removed - subscription moved to SessionDetailView
  if (debounceTimer) clearTimeout(debounceTimer);
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  if (inputSyncTimer) clearTimeout(inputSyncTimer);
  if (partialThrottleTimer) clearTimeout(partialThrottleTimer);
  if (messagesContainer.value) {
    messagesContainer.value.removeEventListener('scroll', handleScroll);
  }
  // Clear work logs when leaving the conversation tab
  // Note: Don't clear conversations here - they should persist when switching tabs
  // within the same session. They will be refreshed when switching sessions.
  sessionsStore.clearWorkLogs();
});

// Handle textarea input with debounced sync to reactive state and server
// This prevents Vue reactivity from firing on every keystroke
function handleInput(event) {
  const value = event.target.value;

  // Sync to reactive state IMMEDIATELY (for button enabling to work)
  input.value = value;

  // Mark as unsaved immediately (but only if status changed)
  if (saveStatus.value !== 'unsaved' && saveStatus.value !== 'saving') {
    saveStatus.value = 'unsaved';
  }

  // Debounce the server save
  if (inputSyncTimer) clearTimeout(inputSyncTimer);
  if (draftSaveTimer) clearTimeout(draftSaveTimer);

  inputSyncTimer = setTimeout(() => {
    // Auto-save to server (for all waiting/stopped/error sessions)
    if (canSendMessage.value) {
      savePendingPrompt(value);
    }
  }, 500); // Debounce 500ms for server save
}

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

function scrollToClaudesTurn() {
  nextTick(() => {
    if (!messagesContainer.value) return;

    // Find the last assistant message
    const lastAssistantIndex = sessionsStore.messages.findLastIndex(msg => msg.role === 'assistant');
    if (lastAssistantIndex < 0) return;

    const lastAssistantMsg = sessionsStore.messages[lastAssistantIndex];
    const msgElement = document.querySelector(`[data-message-id="${lastAssistantMsg.id}"]`);

    if (msgElement) {
      // Calculate offset within the container and scroll directly
      // This avoids scrollIntoView which scrolls parent containers too
      const containerRect = messagesContainer.value.getBoundingClientRect();
      const elementRect = msgElement.getBoundingClientRect();
      const offsetTop = elementRect.top - containerRect.top + messagesContainer.value.scrollTop;

      messagesContainer.value.scrollTo({
        top: offsetTop,
        behavior: 'smooth'
      });
    }
  });
}

watch(
  () => sessionsStore.messages.length,
  (newLen, oldLen) => {
    console.log(`[CONV] messages.length changed: ${oldLen} → ${newLen}, activeConversationId: ${sessionsStore.activeConversationId}`);
    // Force scroll when messages first load, conditional scroll otherwise
    if (oldLen === 0 && newLen > 0) {
      scrollToBottom(true);
    } else {
      scrollToBottom();
    }
  }
);

// Re-fetch messages and work logs when session status changes from running to waiting/completed
// This ensures the UI shows the correct messages after Claude's turn ends.
// Note: fetchMessages() uses a smart merge strategy that preserves any messages
// already in the store (delivered via WebSocket) that aren't yet in the API response.
// This prevents a race condition where messages disappear if the database write
// hasn't completed before the status change triggers this refetch.
watch(
  () => sessionsStore.currentSession?.status,
  async (newStatus, oldStatus) => {
    if (oldStatus === 'running' && (newStatus === 'waiting' || newStatus === 'completed')) {
      console.log(`[CONV] Status changed from ${oldStatus} to ${newStatus}, refetching messages and work logs`);
      // Fetch messages first, then work logs - this ensures messages are visible
      await sessionsStore.fetchMessages(props.sessionId, false);
      await sessionsStore.fetchWorkLogs(props.sessionId);
    }
  }
);

// Watch for messages loading on draft sessions and populate textarea
watch(
  () => sessionsStore.messages,
  (newMessages) => {
    // Only populate textarea for draft sessions that don't have textarea content yet
    if (isDraft.value && textareaRef.value) {
      const textareaHasContent = textareaRef.value.value && textareaRef.value.value.trim().length > 0;
      if (!textareaHasContent) {
        const userMessage = newMessages.find(msg => msg.role === 'user');
        if (userMessage && userMessage.content) {
          input.value = userMessage.content;
          nextTick(() => {
            if (textareaRef.value) {
              textareaRef.value.value = userMessage.content;
            }
          });
        }
      }
    }
  },
  { deep: true, immediate: true }
);

// Message reconciliation watcher - always fetch messages when conversation changes
// This ensures the UI always shows the correct messages for the active conversation
watch(
  () => sessionsStore.activeConversationId,
  async (newConvId, oldConvId) => {
    if (newConvId && newConvId !== oldConvId) {
      // Wait a tick for any pending message updates to complete
      await nextTick();

      // Always refetch when conversation changes - no status check
      // This prevents the UI from showing stale messages from a previous conversation
      console.log(`[CONV] activeConversationId changed to ${newConvId}, refetching messages`);
      await sessionsStore.fetchMessages(props.sessionId, false);
    }
  }
);

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString();
}

/**
 * Format model name for display
 * Converts "claude-3-5-sonnet-20241022" to "claude-3.5-sonnet"
 * @param {string} model - The model name
 * @returns {string} Formatted model name
 */
function formatModelName(model) {
  if (!model) return '';
  return model
    .replace(/-(\d{8})$/, '')  // Remove date suffix
    .replace(/-(\d)-(\d)-/, '-$1.$2-');  // Convert 3-5 to 3.5
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
  // Sync from textarea directly in case debounce timer hasn't fired
  const currentValue = textareaRef.value?.value || input.value;
  if (!currentValue.trim() || sending.value) return;

  sending.value = true;
  try {
    await sessionsStore.sendMessage(props.sessionId, currentValue, attachedFiles.value);
    input.value = '';
    if (textareaRef.value) textareaRef.value.value = '';
    attachedFiles.value = [];
    fileAttachment.value?.clear();
    // Clear pending prompt on server
    await api.updateSessionPendingPrompt(props.sessionId, null);
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    sending.value = false;
  }
}

function handleQuickResponseInsert({ content, autoSubmit }) {
  if (autoSubmit) {
    // Auto-submit: send immediately
    input.value = content;
    nextTick(() => {
      handleSend();
    });
  } else {
    // Insert content into input field for editing
    const currentValue = input.value.trim();
    const newValue = currentValue ? currentValue + '\n\n' + content : content;

    // Update reactive state
    input.value = newValue;

    // Ensure DOM updates and focus
    nextTick(() => {
      if (textareaRef.value) {
        // Update textarea DOM element
        textareaRef.value.value = newValue;

        // Focus textarea
        textareaRef.value.focus();

        // Set cursor to end
        textareaRef.value.selectionStart = textareaRef.value.selectionEnd = textareaRef.value.value.length;

        // Mark as unsaved and trigger auto-save
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

async function copyError() {
  const error = sessionsStore.currentSession?.error || 'Unknown error';
  try {
    await navigator.clipboard.writeText(error);
    uiStore.success('Error copied to clipboard');
  } catch (err) {
    uiStore.error('Failed to copy error');
  }
}

async function savePendingPrompt(prompt) {
  try {
    saveStatus.value = 'saving';
    saveError.value = '';
    await api.updateSessionPendingPrompt(props.sessionId, prompt);
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
    console.error('Failed to save pending prompt:', err);
  }
}

async function handleStart() {
  // Sync from textarea directly in case debounce timer hasn't fired
  const currentValue = textareaRef.value?.value || input.value;
  if (restarting.value || !currentValue.trim()) return;

  restarting.value = true;
  try {
    // Pass the current prompt to the start method via the store
    // This ensures the UI updates immediately via Vue reactivity
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
    // Revert the checkbox on error
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

function handleScheduled() {
  closeScheduleModal();
}

function handleSlashCommandExecuted({ command, args }) {
  // Scroll to bottom to show the new message being processed
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

    await sessionsStore.branchConversation(
      props.sessionId,
      activeConv.id,
      messageId,
      null, // name auto-generated from prompt
      prompt
    );

    branchCreated = true;
    closeBranchEditor();
    uiStore.success('Branch created - Claude is responding');

    // Scroll to show the new content
    scrollToBottom(true);
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    // Always ensure the creating state is reset if branch wasn't successfully created
    // (if branchCreated is true, the editor is already closed by closeBranchEditor)
    if (!branchCreated && branchEditorRef.value) {
      branchEditorRef.value.resetCreating();
    }
  }
}
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
  flex: 1;
  overflow-y: auto;
  max-height: 500px;
  padding: 0.25rem 0;
  position: relative;
  overflow-anchor: none; /* Prevent browser scroll anchoring issues during streaming */
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
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.message-role {
  font-weight: 600;
  font-size: 0.875rem;
  text-transform: capitalize;
}

.message-time {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.message-model {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  padding: 0.125rem 0.375rem;
  background: var(--color-background-mute);
  border-radius: 0.25rem;
  font-family: ui-monospace, monospace;
}

/* Branch button - always visible for user messages */
.branch-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  margin-left: 0.5rem;
  padding: 0.5rem;
  min-width: 44px;
  min-height: 44px;
  background: rgba(139, 92, 246, 0.1);
  border: 1px solid rgba(139, 92, 246, 0.25);
  border-radius: 0.375rem;
  color: rgba(139, 92, 246, 0.8);
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 500;
  transition: background-color 0.15s, border-color 0.15s, color 0.15s;
}

.branch-btn:hover {
  background: rgba(139, 92, 246, 0.2);
  border-color: rgba(139, 92, 246, 0.4);
  color: rgba(139, 92, 246, 0.95);
}

.branch-btn:active {
  transform: scale(0.97);
}

.branch-btn-text {
  display: none;
}

@media (min-width: 480px) {
  .branch-btn-text {
    display: inline;
  }
}

.message-content {
  white-space: pre-wrap;
  word-break: break-word;
}

/* Override pre-wrap for rendered markdown to prevent double line breaks */
.message-content :deep(.markdown-viewer) {
  white-space: normal;
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
}

.input-form textarea {
  width: 100%;
}

.input-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.session-options {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  flex: 1;
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

.send-button-row {
  padding-top: 0.75rem;
  margin-bottom: 14px;
  display: flex;
  justify-content: center;
}

.btn-send-full {
  width: 100%;
  min-height: 52px;
  padding: 1rem 1.5rem;
  font-size: 1.1rem;
  font-weight: 600;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.draft-actions {
  width: 100%;
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

.template-pending-link {
  color: var(--color-accent);
  text-decoration: none;
  font-weight: 500;
  transition: color 0.15s;
}

.template-pending-link:hover {
  color: var(--color-accent);
  text-decoration: underline;
}

.template-pending-description {
  color: var(--color-text-soft);
  font-size: 0.75rem;
  font-style: italic;
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

/* Error banner styles */
.error-banner {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: var(--border-radius);
  padding: 1rem;
  margin-bottom: 1rem;
  margin-top: 1rem;
}

.error-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.error-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

.error-title {
  font-weight: 600;
  color: var(--color-danger, #ef4444);
  flex: 1;
}

.btn-copy-error {
  padding: 0.25rem 0.5rem;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.15s;
  font-size: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  min-height: 32px;
}

.btn-copy-error:hover {
  opacity: 1;
  background: var(--color-bg-hover);
}

.btn-copy-error:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error-content {
  background: var(--color-background);
  border-radius: 4px;
  padding: 0.75rem;
  margin-bottom: 0.75rem;
  max-height: 200px;
  overflow-y: auto;
}

.error-message {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, monospace;
  line-height: 1.4;
}

.error-hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--color-text-soft);
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
  bottom: 0.75rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.375rem;
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
  transform: translateX(-50%) scale(0.98);
}

.jump-arrow {
  flex-shrink: 0;
  opacity: 0.9;
}

@keyframes slideUp {
  from {
    transform: translateX(-50%) translateY(12px);
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

/* Responsive styles for input controls */
@media (max-width: 600px) {
  .input-controls {
    flex-wrap: wrap;
  }

  .session-options {
    width: 100%;
    justify-content: flex-start;
  }

  /* Mobile adjustments for scroll-to-claude button */
  .scroll-to-claude-btn {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    margin-right: 0.25rem;
  }
}

@media (max-width: 400px) {
  .mode-label {
    display: none;
  }
}

/* Hide "Claude is working..." text on extremely small screens */
@media (max-width: 360px) {
  .running-title {
    display: none;
  }
}
</style>
