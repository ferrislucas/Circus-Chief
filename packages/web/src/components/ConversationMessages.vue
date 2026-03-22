<template>
  <div class="messages" ref="messagesContainer">
    <!-- Hide messages for draft and scheduled sessions (only show in input field) -->
    <template v-if="!isDraft && !isScheduledDraft">
    <MessageItem
      v-for="message in messages"
      :key="message.id"
      :message="message"
      :can-branch="canBranch"
      :is-branching="branchingMessageId === message.id"
      :work-logs="getWorkLogsForMessage(message.id)"
      @openBranch="openBranchEditor"
      @branchCreate="handleBranchCreate"
      @closeBranch="closeBranchEditor"
    />
    </template>

    <!-- Streaming partial message -->
    <StreamingMessage v-if="!isDraft && partialText" :content="partialText" />

    <!-- Jump to latest button (Slack-style) -->
    <button
      v-if="!isNearBottom && hasNewMessages && messages.length > 0"
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
</template>

<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';
import { useMessageScroll } from '../composables/useMessageScroll.js';
import MessageItem from './MessageItem.vue';
import StreamingMessage from './StreamingMessage.vue';
import TokenCostPanel from './TokenCostPanel.vue';

const props = defineProps({
  sessionId: { type: String, required: true },
  isDraft: { type: Boolean, default: false },
  isScheduledDraft: { type: Boolean, default: false },
  sessionStatus: { type: String, default: null },
  scrollContainerRef: { type: Object, default: null },
});

const sessionsStore = useSessionsStore();
const uiStore = useUiStore();
const router = useRouter();

// Local state
const branchingMessageId = ref(null);

// Derived data from store
const messages = computed(() => sessionsStore.messages);
const partialText = computed(() => sessionsStore.partialText);

// Scroll management composable
const { messagesContainer, isNearBottom, hasNewMessages, scrollToBottom, scrollToClaudesTurn } = useMessageScroll({
  messages,
  partialText,
  activeConversationId: computed(() => sessionsStore.activeConversationId),
  scrollContainer: computed(() => props.scrollContainerRef),
});

const canBranch = computed(() => {
  return props.sessionStatus !== 'running' && props.sessionStatus !== 'starting';
});

const isUsersTurn = computed(() => {
  return props.sessionStatus === 'waiting' || props.sessionStatus === 'stopped' || props.sessionStatus === 'error';
});

const hasAssistantMessages = computed(() => {
  return sessionsStore.messages.some(msg => msg.role === 'assistant');
});

function getWorkLogsForMessage(messageId) {
  return sessionsStore.getWorkLogsForMessage(messageId);
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
      { messageId, prompt }
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

// Expose scrollToBottom so parent can call it
defineExpose({ scrollToBottom });
</script>

<style scoped>
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
