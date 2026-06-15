<template>
  <div
    class="session-header"
    :class="{ 'is-archived': session.archived }"
  >
    <!-- Main header row with status, name, and menu -->
    <div class="session-header-row">
      <SessionNameEditor
        ref="sessionNameEditor"
        :session-id="sessionId"
        :session="session"
      />

      <!-- Overflow menu with secondary actions -->
      <OverflowMenu
        aria-label="Workspace actions"
        :is-archived="session.archived"
        :is-deleting="isDeleting"
        copy-session-id-text="Copy Workspace ID"
        @duplicate="emit('duplicate')"
        @copy-session-id="emit('copySessionId')"
        @archive="emit('archive')"
        @delete="emit('delete')"
      />
    </div>

    <!-- PR indicators and command button status bar -->
    <div class="branch-pr-indicators">
      <div class="left-indicators">
        <SessionKanbanControls
          :starred="session.starred"
          :show-add-to-board="showAddToBoardButton"
          :lane="sessionLane"
          @star="emit('star')"
          @add-to-board="emit('add-to-board', session)"
          @open-move="openMoveModal"
        />
        <GitStatusChip
          :session-id="sessionId"
          :summary-text="gitStatusSummary"
          :loading="gitStatusLoading"
          :error="gitStatusError"
          :has-actionable-status="hasActionableGitStatus"
        />
        <PrUrlEditor
          :session-id="sessionId"
          :pr-url="session.prUrl"
          :summary="summary"
        />
      </div>

      <!-- Command button status indicators for real-time status updates -->
      <CommandButtonStatusBar
        :button-statuses="buttonStatuses"
        :session-id="sessionId"
      />
    </div>

    <!-- Move Card Modal -->
    <MoveCardModal
      :is-open="showMoveCardModal"
      :project-id="session.projectId"
      :card-id="sessionCard?.id"
      :current-lane-id="sessionLane?.id"
      :session-name="session.name"
      @update:is-open="showMoveCardModal = $event"
      @close="showMoveCardModal = false"
      @moved="showMoveCardModal = false"
    />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import OverflowMenu from './OverflowMenu.vue';
import PrUrlEditor from './PrUrlEditor.vue';
import CommandButtonStatusBar from './CommandButtonStatusBar.vue';
import MoveCardModal from './MoveCardModal.vue';
import SessionKanbanControls from './SessionKanbanControls.vue';
import SessionNameEditor from './SessionNameEditor.vue';
import GitStatusChip from './GitStatusChip.vue';
import { useKanbanStore } from '../stores/kanban.js';

const props = defineProps({
  /** The current session ID */
  sessionId: {
    type: String,
    required: true,
  },
  /** The session object */
  session: {
    type: Object,
    required: true,
  },
  /** Summary object for PrIndicators */
  summary: {
    type: Object,
    default: null,
  },
  /** Whether the session is currently being deleted */
  isDeleting: {
    type: Boolean,
    default: false,
  },
  /** Command button statuses to display */
  buttonStatuses: {
    type: Array,
    default: () => [],
  },
  canAddToBoard: {
    type: Boolean,
    default: true,
  },
  gitStatusSummary: { type: String, default: 'Git status unknown' },
  gitStatusLoading: { type: Boolean, default: false },
  gitStatusError: { type: [Object, String], default: null },
  hasActionableGitStatus: { type: Boolean, default: false },
});

const emit = defineEmits(['duplicate', 'copySessionId', 'archive', 'delete', 'star', 'add-to-board']);

const kanbanStore = useKanbanStore();
const sessionNameEditor = ref(null);

// Get the lane name if this session is on the kanban board
const sessionLane = computed(() => {
  const card = kanbanStore.getCardBySessionId(props.sessionId);
  if (!card) return null;
  const lane = kanbanStore.getLaneById(card.laneId);
  return lane;
});

// Get the card for this session
const sessionCard = computed(() => kanbanStore.getCardBySessionId(props.sessionId));

const showAddToBoardButton = computed(() =>
  props.canAddToBoard &&
  !props.session.parentSessionId &&
  !props.session.archived &&
  !sessionCard.value
);

// Move card modal state
const showMoveCardModal = ref(false);

function openMoveModal() {
  showMoveCardModal.value = true;
}

defineExpose({
  isEditingName: computed(() => sessionNameEditor.value?.isEditingName ?? false),
  editNameValue: computed(() => sessionNameEditor.value?.editNameValue ?? ''),
  startEditName: () => sessionNameEditor.value?.startEditName(),
  cancelEditName: () => sessionNameEditor.value?.cancelEditName(),
  clearSessionName: () => sessionNameEditor.value?.clearSessionName(),
  saveSessionName: () => sessionNameEditor.value?.saveSessionName(),
  showMoveCardModal,
});
</script>

<style scoped>
.session-header {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
  padding: 0 0.5rem;
}

.session-header.is-archived {
  border-left: 3px solid #f59e0b;
  padding-left: calc(0.5rem - 3px);
}

.session-header-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--color-text-soft, #888);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  flex-shrink: 0;
}

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text, #ccc);
}

.btn-icon:active {
  background: rgba(255, 255, 255, 0.15);
}

.branch-pr-indicators {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.left-indicators {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}

@media (max-width: 768px) {
  .session-header-row {
    align-items: flex-start;
    min-height: auto;
    padding-top: 0.25rem;
  }

}
</style>
