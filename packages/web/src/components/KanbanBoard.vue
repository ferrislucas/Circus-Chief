<template>
  <div class="kanban-board">
    <div v-if="loading" class="kanban-loading">
      <span class="loading-spinner"></span>
      Loading board...
    </div>

    <div v-else-if="error" class="kanban-error">
      <span class="error-icon">!</span>
      {{ error }}
      <button class="retry-btn" @click="fetchBoard">Retry</button>
    </div>

    <div v-else-if="!board" class="kanban-empty">
      <p>Kanban board is not available for this project.</p>
    </div>

    <div v-else class="kanban-lanes-container">
      <div
        v-for="lane in board.lanes"
        :key="lane.id"
        class="kanban-lane"
        @dragover.prevent
        @drop="handleDrop($event, lane.id)"
      >
        <div class="lane-header">
          <div class="lane-title-row">
            <h3 class="lane-title">{{ lane.name }}</h3>
            <span v-if="lane.onEnterTemplateId || lane.onEnterPrompt" class="lane-automation-indicator" title="Automation enabled">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
              </svg>
            </span>
          </div>
          <div class="lane-header-actions">
            <span class="lane-count">{{ lane.cards?.length || 0 }}</span>
            <button
              class="lane-settings-btn"
              title="Lane settings"
              @click="openLaneSettings(lane)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </button>
          </div>
        </div>

        <div class="lane-cards">
          <div
            v-for="card in lane.cards"
            :key="card.id"
            class="kanban-card"
            draggable="true"
            @dragstart="handleDragStart($event, card)"
            @dragend="handleDragEnd"
          >
            <router-link
              v-if="card.sessions?.[0]"
              :to="`/sessions/${card.sessions[0].id}`"
              class="card-link"
            >
              <div class="card-header">
                <span class="card-status" :class="`status-${card.sessions[0].status}`">
                  {{ getStatusIndicator(card.sessions[0].status) }}
                </span>
                <h4 class="card-title">{{ card.sessions[0].name }}</h4>
              </div>
              <div class="card-meta">
                <span v-if="card.sessions[0].mode" class="card-mode">
                  {{ card.sessions[0].mode }}
                </span>
                <span v-if="card.sessions[0].costUsd" class="card-cost">
                  ${{ card.sessions[0].costUsd.toFixed(2) }}
                </span>
              </div>
            </router-link>
            <button
              class="card-move-btn"
              title="Move to lane"
              @click.prevent="openMoveCardModal(card, lane.id)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 4 19 4 19 8"></polyline>
                <line x1="14" y1="10" x2="19" y2="4"></line>
                <polyline points="9 20 5 20 5 16"></polyline>
                <line x1="10" y1="14" x2="5" y2="20"></line>
              </svg>
            </button>
            <button
              class="card-remove-btn"
              title="Remove from board"
              @click.prevent="handleRemoveCard(card.id)"
            >
              &times;
            </button>
          </div>

          <!-- Empty lane placeholder -->
          <div v-if="!lane.cards?.length" class="lane-empty">
            <span>Drop sessions here</span>
          </div>
        </div>

        <!-- Lane footer with automation info and add session button -->
        <div class="lane-footer">
          <span v-if="lane.onEnterTemplateId" class="lane-automation">
            Auto: triggers template on entry
          </span>
          <span v-else-if="lane.onEnterPrompt" class="lane-automation">
            Auto: runs custom prompt on entry
          </span>
          <button
            class="add-session-btn"
            @click="openAddSession(lane)"
          >
            + Add Session
          </button>
        </div>
      </div>

      <!-- Add lane button -->
      <div class="add-lane-container">
        <button v-if="!showAddLane" class="add-lane-btn" @click="showAddLane = true">
          + Add Lane
        </button>
        <div v-else class="add-lane-form">
          <input
            v-model="newLaneName"
            type="text"
            placeholder="Lane name..."
            class="add-lane-input"
            @keyup.enter="handleAddLane"
            @keyup.escape="cancelAddLane"
          />
          <div class="add-lane-actions">
            <button class="add-lane-confirm" @click="handleAddLane">Add</button>
            <button class="add-lane-cancel" @click="cancelAddLane">Cancel</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Session Modal -->
    <AddSessionToLaneModal
      :is-open="showAddSessionModal"
      :project-id="projectId"
      :lane-id="selectedLaneForAddSession?.id"
      :lane-name="selectedLaneForAddSession?.name"
      @update:is-open="showAddSessionModal = $event"
      @close="closeAddSessionModal"
      @added="onSessionAdded"
    />

    <!-- Lane Settings Modal -->
    <LaneSettingsModal
      :is-open="showLaneSettingsModal"
      :project-id="projectId"
      :lane="selectedLaneForSettings"
      @update:is-open="showLaneSettingsModal = $event"
      @close="closeLaneSettingsModal"
      @updated="onLaneUpdated"
      @deleted="onLaneDeleted"
    />

    <!-- Move Card Modal -->
    <MoveCardModal
      :is-open="showMoveCardModal"
      :project-id="projectId"
      :card-id="selectedCardForMove?.id"
      :current-lane-id="selectedCardCurrentLaneId"
      :session-name="selectedCardForMove?.sessions?.[0]?.name"
      @update:is-open="showMoveCardModal = $event"
      @close="closeMoveCardModal"
      @moved="onCardMoved"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useKanbanStore } from '../stores/kanban.js';
import AddSessionToLaneModal from './AddSessionToLaneModal.vue';
import LaneSettingsModal from './LaneSettingsModal.vue';
import MoveCardModal from './MoveCardModal.vue';

const props = defineProps({
  projectId: {
    type: String,
    required: true,
  },
});

const kanbanStore = useKanbanStore();

// Local state
const showAddLane = ref(false);
const newLaneName = ref('');
const draggedCard = ref(null);

// Modal state
const showAddSessionModal = ref(false);
const selectedLaneForAddSession = ref(null);
const showLaneSettingsModal = ref(false);
const selectedLaneForSettings = ref(null);
const showMoveCardModal = ref(false);
const selectedCardForMove = ref(null);
const selectedCardCurrentLaneId = ref(null);

// Computed
const board = computed(() => kanbanStore.board);
const loading = computed(() => kanbanStore.loading);
const error = computed(() => kanbanStore.error);

// Methods
const fetchBoard = async () => {
  try {
    await kanbanStore.fetchBoard(props.projectId);
  } catch (err) {
    console.error('Failed to fetch kanban board:', err);
  }
};

const getStatusIndicator = (status) => {
  switch (status) {
    case 'running':
    case 'starting':
      return '●';
    case 'waiting':
      return '◐';
    case 'completed':
      return '✓';
    case 'error':
      return '✕';
    case 'stopped':
      return '■';
    case 'scheduled':
      return '⏰';
    default:
      return '○';
  }
};

const handleDragStart = (event, card) => {
  draggedCard.value = card;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', card.id);
};

const handleDragEnd = () => {
  draggedCard.value = null;
};

const handleDrop = async (event, targetLaneId) => {
  event.preventDefault();
  const cardId = event.dataTransfer.getData('text/plain');

  if (!cardId || !draggedCard.value) return;

  // Don't move if already in this lane
  if (draggedCard.value.laneId === targetLaneId) return;

  try {
    await kanbanStore.moveCard(props.projectId, cardId, targetLaneId, {
      runOnEnterTemplate: true,
    });
  } catch (err) {
    console.error('Failed to move card:', err);
  }
};

const handleRemoveCard = async (cardId) => {
  if (!confirm('Remove this session from the board?')) return;

  try {
    await kanbanStore.removeCard(props.projectId, cardId);
  } catch (err) {
    console.error('Failed to remove card:', err);
  }
};

const handleAddLane = async () => {
  if (!newLaneName.value.trim()) return;

  try {
    await kanbanStore.createLane(props.projectId, {
      name: newLaneName.value.trim(),
    });
    cancelAddLane();
  } catch (err) {
    console.error('Failed to add lane:', err);
  }
};

const cancelAddLane = () => {
  showAddLane.value = false;
  newLaneName.value = '';
};

// Modal handlers
const openAddSession = (lane) => {
  selectedLaneForAddSession.value = lane;
  showAddSessionModal.value = true;
};

const closeAddSessionModal = () => {
  showAddSessionModal.value = false;
  selectedLaneForAddSession.value = null;
};

const onSessionAdded = () => {
  // Session was added successfully, modal handles the close
};

const openLaneSettings = (lane) => {
  selectedLaneForSettings.value = lane;
  showLaneSettingsModal.value = true;
};

const closeLaneSettingsModal = () => {
  showLaneSettingsModal.value = false;
  selectedLaneForSettings.value = null;
};

const onLaneUpdated = () => {
  // Lane was updated successfully, board will refresh via store
};

const onLaneDeleted = () => {
  closeLaneSettingsModal();
  // Lane was deleted, board will refresh via store
};

const openMoveCardModal = (card, currentLaneId) => {
  selectedCardForMove.value = card;
  selectedCardCurrentLaneId.value = currentLaneId;
  showMoveCardModal.value = true;
};

const closeMoveCardModal = () => {
  showMoveCardModal.value = false;
  selectedCardForMove.value = null;
  selectedCardCurrentLaneId.value = null;
};

const onCardMoved = () => {
  closeMoveCardModal();
};

// Watch for project changes
watch(
  () => props.projectId,
  (newId) => {
    if (newId) {
      fetchBoard();
    }
  },
  { immediate: true }
);

onMounted(() => {
  if (props.projectId) {
    fetchBoard();
  }
});
</script>

<style scoped>
.kanban-board {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.kanban-loading,
.kanban-error,
.kanban-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  color: var(--color-text-soft);
  gap: 1rem;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background-color: var(--color-warning);
  color: white;
  border-radius: 50%;
  font-weight: bold;
}

.retry-btn {
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  padding: 0.5rem 1rem;
}

.retry-btn:hover {
  text-decoration: underline;
}

.kanban-lanes-container {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  overflow-x: auto;
  flex: 1;
  align-items: flex-start;
}

.kanban-lane {
  flex-shrink: 0;
  width: 280px;
  background: var(--color-bg-soft, rgba(255, 255, 255, 0.05));
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 200px);
}

.lane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--color-border);
}

.lane-title-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  flex: 1;
  min-width: 0;
}

.lane-title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lane-automation-indicator {
  color: #f59e0b;
  flex-shrink: 0;
}

.lane-header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.lane-count {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  background: var(--color-border);
  padding: 0.125rem 0.5rem;
  border-radius: 10px;
}

.lane-settings-btn {
  background: none;
  border: none;
  color: var(--color-text-soft);
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.6;
  transition: opacity 0.15s, color 0.15s, background-color 0.15s;
}

.kanban-lane:hover .lane-settings-btn {
  opacity: 1;
}

.lane-settings-btn:hover {
  color: var(--color-primary);
  background: var(--color-bg-soft);
}

.lane-cards {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 100px;
}

.lane-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
  color: var(--color-text-soft);
  font-size: 0.75rem;
  border: 2px dashed var(--color-border);
  border-radius: 6px;
  opacity: 0.6;
}

.kanban-card {
  position: relative;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  cursor: grab;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.kanban-card:hover {
  border-color: var(--color-primary);
}

.kanban-card:active {
  cursor: grabbing;
}

.card-link {
  display: block;
  padding: 0.75rem;
  color: var(--color-text);
  text-decoration: none;
}

.card-header {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.card-status {
  flex-shrink: 0;
  font-size: 0.75rem;
}

.card-status.status-running,
.card-status.status-starting {
  color: #10b981;
}

.card-status.status-waiting {
  color: #f59e0b;
}

.card-status.status-completed {
  color: #3b82f6;
}

.card-status.status-error,
.card-status.status-stopped {
  color: #ef4444;
}

.card-status.status-scheduled {
  color: #6b7280;
}

.card-title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.card-meta {
  display: flex;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.card-mode {
  text-transform: capitalize;
}

.card-move-btn {
  position: absolute;
  top: 0.25rem;
  right: 2rem;
  background: none;
  border: none;
  color: var(--color-text-soft);
  cursor: pointer;
  opacity: 0;
  padding: 0.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.2s, color 0.2s;
}

.kanban-card:hover .card-move-btn {
  opacity: 1;
}

.card-move-btn:hover {
  color: var(--color-primary);
}

.card-remove-btn {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  background: none;
  border: none;
  color: var(--color-text-soft);
  cursor: pointer;
  opacity: 0;
  padding: 0.25rem;
  font-size: 1rem;
  line-height: 1;
  transition: opacity 0.2s, color 0.2s;
}

.kanban-card:hover .card-remove-btn {
  opacity: 1;
}

.card-remove-btn:hover {
  color: var(--color-danger, #ef4444);
}

.lane-footer {
  padding: 0.5rem;
  border-top: 1px solid var(--color-border);
  font-size: 0.7rem;
  color: var(--color-text-soft);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.lane-automation {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0 0.5rem;
}

.add-session-btn {
  width: 100%;
  padding: 0.5rem;
  background: transparent;
  border: 1px dashed var(--color-border);
  border-radius: 4px;
  color: var(--color-text-soft);
  cursor: pointer;
  font-size: 0.75rem;
  transition: border-color 0.15s, color 0.15s, background-color 0.15s;
}

.add-session-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: rgba(34, 197, 255, 0.05);
}

.add-lane-container {
  flex-shrink: 0;
  min-width: 200px;
}

.add-lane-btn {
  width: 100%;
  padding: 0.75rem 1rem;
  background: var(--color-bg-soft, rgba(255, 255, 255, 0.05));
  border: 2px dashed var(--color-border);
  border-radius: 8px;
  color: var(--color-text-soft);
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
}

.add-lane-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.add-lane-form {
  background: var(--color-bg-soft, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0.75rem;
}

.add-lane-input {
  width: 100%;
  padding: 0.5rem;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text);
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
}

.add-lane-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.add-lane-actions {
  display: flex;
  gap: 0.5rem;
}

.add-lane-confirm,
.add-lane-cancel {
  flex: 1;
  padding: 0.375rem 0.75rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.75rem;
}

.add-lane-confirm {
  background: var(--color-primary);
  color: white;
}

.add-lane-cancel {
  background: var(--color-border);
  color: var(--color-text);
}
</style>
