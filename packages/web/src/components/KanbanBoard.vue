<template>
  <div class="kanban-board">
    <!-- Board header bar: always rendered (outside the loading/error/empty chain) -->
    <div class="board-header-bar">
      <div class="layout-toggle">
        <!-- Columns (horizontal) toggle -->
        <button
          class="layout-toggle-btn"
          :class="{ active: effectiveLayout === 'horizontal' }"
          title="Column layout"
          @click="layoutMode = 'horizontal'"
        >
          <KanbanBoardIcon name="columns" />
        </button>
        <!-- List (vertical/accordion) toggle -->
        <button
          class="layout-toggle-btn"
          :class="{ active: effectiveLayout === 'vertical' }"
          title="List layout"
          @click="layoutMode = 'vertical'"
        >
          <KanbanBoardIcon name="list" />
        </button>
      </div>
    </div>

    <div
      v-if="loading"
      class="kanban-loading"
    >
      <span class="loading-spinner" />
      Loading board...
    </div>

    <div
      v-else-if="error"
      class="kanban-error"
    >
      <span class="error-icon">!</span>
      {{ error }}
      <button
        class="retry-btn"
        @click="fetchBoard"
      >
        Retry
      </button>
    </div>

    <div
      v-else-if="!board"
      class="kanban-empty"
    >
      <p>Kanban board is not available for this project.</p>
    </div>

    <div
      v-else
      class="kanban-lanes-container"
      :class="effectiveLayout === 'vertical' ? 'layout-vertical' : 'layout-horizontal'"
    >
      <div
        v-for="lane in board.lanes"
        :key="lane.id"
        class="kanban-lane"
        @dragover.prevent="effectiveLayout === 'horizontal' ? handleCardDragOver($event, lane.id, lane.cards?.length || 0) : null"
        @drop="effectiveLayout === 'horizontal' ? handleDrop($event, lane.id) : null"
      >
        <div
          class="lane-header"
          :class="{ 'lane-header-accordion': effectiveLayout === 'vertical' }"
          @click="handleLaneHeaderClick(lane.id)"
        >
          <div class="lane-title-row">
            <!-- Chevron: only shown in vertical/accordion mode -->
            <KanbanBoardIcon
              v-if="effectiveLayout === 'vertical'"
              name="chevron"
              class="lane-chevron"
              :class="{ 'lane-chevron-expanded': expandedLanes[lane.id] }"
            />
            <h3 class="lane-title">
              {{ lane.name }}
            </h3>
            <span
              v-if="lane.onEnterTemplateId || lane.onEnterPrompt"
              class="lane-automation-indicator"
              title="Automation enabled"
            >
              <KanbanBoardIcon name="automation" />
            </span>
          </div>
          <div class="lane-header-actions">
            <span class="lane-count">{{ lane.cards?.length || 0 }}</span>
            <button
              class="lane-settings-btn"
              title="Lane settings"
              @click.stop="openLaneSettings(lane)"
            >
              <KanbanBoardIcon name="settings" />
            </button>
          </div>
        </div>

        <!-- Cards: always shown in horizontal; shown when expanded in vertical -->
        <div
          v-show="effectiveLayout === 'horizontal' || expandedLanes[lane.id]"
          class="lane-cards"
        >
          <template
            v-for="(card, cardIndex) in lane.cards"
            :key="card.id"
          >
            <!-- Card drop indicator -->
            <div
              v-if="dragType === 'card' && dropCardLaneId === lane.id && dropCardIndex === cardIndex"
              class="card-drop-indicator"
            />

            <div
              class="kanban-card"
              :class="{ 'dragging': dragType === 'card' && draggedCard?.id === card.id }"
              :draggable="effectiveLayout === 'horizontal'"
              @dragstart.stop="effectiveLayout === 'horizontal' ? handleCardDragStart($event, card, lane.id, cardIndex) : null"
              @dragover.prevent.stop="effectiveLayout === 'horizontal' ? handleCardDragOver($event, lane.id, cardIndex) : null"
              @dragend="effectiveLayout === 'horizontal' ? handleDragEnd() : null"
            >
              <router-link
                v-if="card.sessions?.[0]"
                :to="`/sessions/${card.sessions[0].id}`"
                class="card-link"
              >
                <div class="card-header">
                  <SessionRunningSpinner
                    :active="isCardEffectivelyRunning(card.sessions[0])"
                  />
                  <span
                    v-if="!isCardEffectivelyRunning(card.sessions[0])"
                    class="card-status"
                    :class="`status-${card.sessions[0].status}`"
                  >
                    {{ getStatusIndicator(card.sessions[0].status) }}
                  </span>
                  <h4 class="card-title">
                    {{ card.sessions[0].name }}
                  </h4>
                </div>
                <div class="card-meta">
                  <span
                    v-if="card.sessions[0].mode"
                    class="card-mode"
                  >
                    {{ card.sessions[0].mode }}
                  </span>
                  <PrIndicators
                    v-if="card.sessions[0].prUrl"
                    :pr-url="card.sessions[0].prUrl"
                  />
                </div>
                <div
                  v-if="cardsScheduledInfo[card.id]?.showBadge"
                  class="card-scheduled-info"
                >
                  <span class="status-badge status-scheduled">
                    <KanbanBoardIcon
                      name="schedule"
                      class="schedule-icon-inline"
                    />
                    scheduled
                  </span>
                  <span
                    v-if="cardsScheduledInfo[card.id].timeDisplay"
                    class="scheduled-time"
                    :title="cardsScheduledInfo[card.id].absoluteTime"
                  >
                    {{ cardsScheduledInfo[card.id].timeDisplay }}
                  </span>
                </div>
              </router-link>
              <CommandButtonStatusBar
                v-if="card.sessions?.[0]"
                class="card-command-status"
                :button-statuses="cardButtonStatuses[card.sessions[0].id] || []"
                :session-id="card.sessions[0].id"
              />
              <!-- Card reorder arrows -->
              <div class="card-reorder-arrows">
                <button
                  v-if="cardIndex > 0"
                  class="card-reorder-btn"
                  title="Move card up"
                  @click.prevent="moveCardInLane(lane.id, cardIndex, cardIndex - 1)"
                >
                  <KanbanBoardIcon name="reorder-up" />
                </button>
                <button
                  v-if="cardIndex < lane.cards.length - 1"
                  class="card-reorder-btn"
                  title="Move card down"
                  @click.prevent="moveCardInLane(lane.id, cardIndex, cardIndex + 1)"
                >
                  <KanbanBoardIcon name="reorder-down" />
                </button>
              </div>
              <button
                class="card-move-btn"
                title="Move to lane"
                @click.prevent="openMoveCardModal(card, lane.id)"
              >
                <KanbanBoardIcon name="move" />
              </button>
              <button
                class="card-remove-btn"
                title="Remove from board"
                @click.prevent="handleRemoveCard(card.id)"
              >
                &times;
              </button>
            </div>
          </template>

          <!-- Card drop indicator at end of list -->
          <div
            v-if="dragType === 'card' && dropCardLaneId === lane.id && dropCardIndex === (lane.cards?.length || 0)"
            class="card-drop-indicator"
          />

          <!-- Empty lane placeholder -->
          <div
            v-if="!lane.cards?.length"
            class="lane-empty"
          >
            <span>Drop sessions here</span>
          </div>
        </div>

        <!-- Lane footer: always shown in horizontal; shown when expanded in vertical -->
        <div
          v-show="effectiveLayout === 'horizontal' || expandedLanes[lane.id]"
          class="lane-footer"
        >
          <span
            v-if="lane.onEnterTemplateId"
            class="lane-automation"
          >
            Auto: triggers template on entry
          </span>
          <span
            v-else-if="lane.onEnterPrompt"
            class="lane-automation"
          >
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
        <button
          v-if="!showAddLane"
          class="add-lane-btn"
          @click="showAddLane = true"
        >
          + Add Lane
        </button>
        <div
          v-else
          class="add-lane-form"
        >
          <input
            v-model="newLaneName"
            type="text"
            placeholder="Lane name..."
            class="add-lane-input"
            @keyup.enter="handleAddLane"
            @keyup.escape="cancelAddLane"
          >
          <div class="add-lane-actions">
            <button
              class="add-lane-confirm"
              @click="handleAddLane"
            >
              Add
            </button>
            <button
              class="add-lane-cancel"
              @click="cancelAddLane"
            >
              Cancel
            </button>
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
import { ref, reactive, computed, onMounted, onUnmounted, watch, toRef } from 'vue';
import { formatDistanceToNow, format } from 'date-fns';
import { useKanbanStore } from '../stores/kanban.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { findNearestScheduledTime } from '../utils/scheduleInfo.js';
import { useCardDragDrop } from '../composables/useCardDragDrop.js';
import AddSessionToLaneModal from './AddSessionToLaneModal.vue';
import CommandButtonStatusBar from './CommandButtonStatusBar.vue';
import LaneSettingsModal from './LaneSettingsModal.vue';
import MoveCardModal from './MoveCardModal.vue';
import PrIndicators from './PrIndicators.vue';
import SessionRunningSpinner from './SessionRunningSpinner.vue';
import KanbanBoardIcon from './KanbanBoardIcon.vue';
import { mapRunsToButtonStatuses } from '../utils/commandButtonStatuses.js';
import './KanbanBoard.css';

const props = defineProps({
  projectId: {
    type: String,
    required: true,
  },
});

const kanbanStore = useKanbanStore();
const sessionsStore = useSessionsStore();
const commandButtonsStore = useCommandButtonsStore();

// ==================== Layout state ====================

const LAYOUT_MODE_KEY = 'kanbanLayoutMode';
const VALID_LAYOUT_MODES = ['auto', 'horizontal', 'vertical'];

function readLayoutMode() {
  try {
    const stored = localStorage.getItem(LAYOUT_MODE_KEY);
    return VALID_LAYOUT_MODES.includes(stored) ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

function writeLayoutMode(value) {
  try {
    localStorage.setItem(LAYOUT_MODE_KEY, value);
  } catch {
    // ignore (e.g. private browsing with storage blocked)
  }
}

// layoutMode: 'auto' | 'horizontal' | 'vertical'
// Read synchronously from localStorage so first render uses the restored value.
const layoutMode = ref(readLayoutMode());

watch(layoutMode, (value) => {
  writeLayoutMode(value);
});

// isNarrow: true when the viewport is <= 640px.
// Initialized synchronously to avoid a flash on first render.
const isNarrow = ref(
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(max-width: 640px)').matches
    : false
);

let _mql = null;
const onMqlChange = (e) => { isNarrow.value = e.matches; };

onMounted(() => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    _mql = window.matchMedia('(max-width: 640px)');
    isNarrow.value = _mql.matches;
    _mql.addEventListener('change', onMqlChange);
  }
});

onUnmounted(() => {
  if (_mql) {
    _mql.removeEventListener('change', onMqlChange);
    _mql = null;
  }
});

// effectiveLayout: the layout actually used for rendering.
const effectiveLayout = computed(() => {
  if (layoutMode.value === 'auto') {
    return isNarrow.value ? 'vertical' : 'horizontal';
  }
  return layoutMode.value;
});

// expandedLanes: record of laneId → boolean (true = expanded).
// All lanes start expanded by default.
const expandedLanes = reactive({});

watch(
  () => kanbanStore.board?.lanes,
  (lanes) => {
    if (lanes) {
      for (const lane of lanes) {
        if (!(lane.id in expandedLanes)) {
          expandedLanes[lane.id] = true;
        }
      }
    }
  },
  { immediate: true }
);

const toggleLane = (laneId) => {
  expandedLanes[laneId] = !expandedLanes[laneId];
};

// Called when the lane header is clicked; only toggles in vertical mode.
const handleLaneHeaderClick = (laneId) => {
  if (effectiveLayout.value === 'vertical') {
    toggleLane(laneId);
  }
};

// ==================== Local state ====================

const showAddLane = ref(false);
const newLaneName = ref('');

// Computed
const board = computed(() => kanbanStore.board);
const loading = computed(() => kanbanStore.loading);
const error = computed(() => kanbanStore.error);
const cardsScheduledInfo = computed(() => {
  const map = {};
  if (!board.value?.lanes) return map;

  for (const lane of board.value.lanes) {
    for (const card of lane.cards || []) {
      const session = card.sessions?.[0];
      if (!session?.id) continue;

      const nearest = findNearestScheduledTime(session.id);

      if (nearest === null) {
        map[card.id] = { showBadge: false, timeDisplay: null, absoluteTime: null };
        continue;
      }

      const scheduledTime = new Date(nearest);
      map[card.id] = {
        showBadge: true,
        timeDisplay: formatDistanceToNow(scheduledTime, { addSuffix: true }),
        absoluteTime: format(scheduledTime, 'MMM d, h:mm a'),
      };
    }
  }

  return map;
});

// Drag-and-drop
const {
  dragType, draggedCard, dropCardLaneId, dropCardIndex,
  handleCardDragStart, handleCardDragOver, handleDragEnd,
  handleDrop, moveCardInLane,
} = useCardDragDrop(board, kanbanStore.reorderCards, kanbanStore.moveCard, toRef(props, 'projectId'));

// Modal state
const showAddSessionModal = ref(false);
const selectedLaneForAddSession = ref(null);
const showLaneSettingsModal = ref(false);
const selectedLaneForSettings = ref(null);
const showMoveCardModal = ref(false);
const selectedCardForMove = ref(null);
const selectedCardCurrentLaneId = ref(null);

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

const isCardEffectivelyRunning = (session) => {
  if (!session?.id) return false;
  if (sessionsStore.getWorkflowEffectiveStatus(session.id) === 'running') {
    return true;
  }
  return ['running', 'starting'].includes(session.status);
};

// Board-level map of session id → button-status indicators. Built once per
// recompute (rather than per-card during render) so the buttonMap and the
// store-session lookup are constructed a single time for the whole board.
const cardButtonStatuses = computed(() => {
  const result = {};
  if (!props.projectId || !board.value) return result;

  // Establish a reactive dependency on command-run WebSocket updates so the
  // whole board recomputes when any run's status changes.
  void sessionsStore.commandRunVersion;

  const buttons = commandButtonsStore.getButtonsByProjectId(props.projectId);
  const buttonMap = Object.fromEntries(buttons.map(b => [b.id, b]));

  // Build the store-session lookup once to avoid a per-card `.find()` scan.
  const storeSessionsById = Object.fromEntries(
    sessionsStore.sessions.map(s => [s.id, s])
  );

  for (const card of board.value.lanes.flatMap(l => l.cards || [])) {
    const session = card.sessions?.[0];
    if (!session?.id) continue;
    const latestRuns =
      storeSessionsById[session.id]?.latestCommandRuns || session.latestCommandRuns || [];
    result[session.id] = mapRunsToButtonStatuses(buttonMap, latestRuns);
  }

  return result;
});

const handleRemoveCard = async (cardId) => {
  if (!confirm('Remove this workspace from the board?')) return;

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
