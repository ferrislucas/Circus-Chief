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
import './KanbanBoard.css';

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
