<template>
  <div
    ref="messagesContainer"
    class="messages"
  >
    <!-- Hide messages for draft and scheduled sessions (only show in input field) -->
    <template v-if="!isDraft && !isScheduledDraft">
      <MessageItem
        v-for="message in messages"
        :key="message.id"
        :message="message"
        :can-branch="canBranch"
        :is-branching="branchingMessageId === message.id"
        :work-logs="getWorkLogsForMessage(message.id)"
        @open-branch="openBranchEditor"
        @branch-create="handleBranchCreate"
        @close-branch="closeBranchEditor"
      />
    </template>

    <!-- Streaming partial message -->
    <StreamingMessage
      v-if="!isDraft && partialText"
      :content="partialText"
    />
  </div>

  <!-- Token cost panel - aligned with scroll-to-claude-btn -->
  <div class="conversation-controls-row">
    <TokenCostPanel :session-id="sessionId" />

    <!-- Jump to Claude's turn button - shows when at bottom and it's user's turn -->
    <button
      v-if="hasAssistantMessages && isUsersTurn"
      class="scroll-to-claude-btn"
      title="Jump to Claude's response"
      aria-label="Scroll to Claude's latest response"
      @click="scrollToClaudesTurn"
    >
      💬
    </button>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useInjectedSessionsStore } from '../composables/useOverlayStore.js';
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

const sessionsStore = useInjectedSessionsStore();
const uiStore = useUiStore();
const router = useRouter();

// Local state
const branchingMessageId = ref(null);

// Derived data from store
const messages = computed(() => sessionsStore.messages);
const partialText = computed(() => sessionsStore.partialText);

// Scroll management composable
const { messagesContainer, isNearBottom, scrollToBottom, scrollToClaudesTurn } = useMessageScroll({
  messages,
  partialText,
  activeConversationId: computed(() => sessionsStore.activeConversationId),
  scrollContainer: computed(() => props.scrollContainerRef),
});

const canBranch = computed(() => props.sessionStatus !== 'running' && props.sessionStatus !== 'starting');

const isUsersTurn = computed(() => props.sessionStatus === 'waiting' || props.sessionStatus === 'stopped' || props.sessionStatus === 'error');

const hasAssistantMessages = computed(() => sessionsStore.messages.some(msg => msg.role === 'assistant'));

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
  padding: 0.5rem 0.75rem;
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
  font-size: 1rem;
  white-space: nowrap;
  line-height: 1;
  font-weight: 500;
  min-width: 44px;
  min-height: 44px;
}

.scroll-to-claude-btn:hover {
  background: rgba(55, 65, 81, 0.95);
  color: rgba(209, 213, 219, 1);
}

.scroll-to-claude-btn:active {
  transform: scale(0.95);
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

/* Mobile adjustments — preserve the 44×44 tap target so the button
   remains tappable on small/phone-sized viewports. */
@media (max-width: 600px) {
  .scroll-to-claude-btn {
    padding: 0.5rem 0.75rem;
    font-size: 1rem;
    min-width: 44px;
    min-height: 44px;
  }
}
</style>
