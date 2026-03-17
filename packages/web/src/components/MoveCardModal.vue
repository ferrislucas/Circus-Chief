<template>
  <div v-if="isOpen" class="modal-backdrop" @click.self="close">
    <div class="modal-content" role="dialog" aria-labelledby="modal-title">
      <div class="modal-header">
        <h2 id="modal-title" class="modal-title">Move to Lane</h2>
        <button @click="close" class="close-btn" aria-label="Close modal">&times;</button>
      </div>

      <div class="modal-body">
        <div class="moving-info">
          <span class="moving-label">Moving:</span>
          <span class="moving-session-name">{{ displayName }}</span>
        </div>

        <div v-if="lanes.length === 0" class="empty-state">
          <p>No lanes available</p>
        </div>

        <div v-else class="lanes-list">
          <div
            v-for="lane in lanes"
            :key="lane.id"
            class="lane-row"
            :class="{
              'lane-row-current': lane.id === currentLaneId,
              'lane-row-disabled': lane.id === currentLaneId
            }"
          >
            <label class="lane-label">
              <input
                type="radio"
                :name="`lane-${cardId}`"
                :value="lane.id"
                v-model="selectedLaneId"
                :disabled="lane.id === currentLaneId"
                :aria-disabled="lane.id === currentLaneId"
                :aria-label="`Move to ${lane.name}`"
              />
              <span class="lane-info">
                <span class="lane-name">{{ lane.name }}</span>
                <span v-if="lane.id === currentLaneId" class="lane-current-badge">(current)</span>
                <span v-if="hasAutomation(lane)" class="lane-automation-icon" title="Automation enabled">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
                  </svg>
                </span>
              </span>
            </label>
          </div>
        </div>

        <div v-if="showAutomationCheckbox" class="automation-option">
          <label class="checkbox-label">
            <input
              type="checkbox"
              v-model="runOnEnterTemplate"
              aria-label="Run automation on entry"
            />
            <span>Run automation on entry</span>
          </label>
        </div>
      </div>

      <div class="modal-footer">
        <button @click="close" class="btn btn-secondary">Cancel</button>
        <button
          @click="handleMove"
          class="btn btn-primary"
          :disabled="!canMove || moving"
          aria-label="Move card to selected lane"
        >
          {{ moving ? 'Moving...' : 'Move' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useKanbanStore } from '../stores/kanban.js';
import { useUiStore } from '../stores/ui.js';

const props = defineProps({
  isOpen: Boolean,
  projectId: {
    type: String,
    required: true,
  },
  cardId: {
    type: String,
    required: true,
  },
  currentLaneId: {
    type: String,
    required: true,
  },
  sessionName: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['update:isOpen', 'close', 'moved']);

const kanbanStore = useKanbanStore();
const uiStore = useUiStore();

const selectedLaneId = ref(null);
const runOnEnterTemplate = ref(true);
const moving = ref(false);

// Computed
const lanes = computed(() => kanbanStore.board?.lanes || []);

const displayName = computed(() => {
  if (props.sessionName) {
    return props.sessionName;
  }
  return props.cardId || 'Unnamed session';
});

const selectedLane = computed(() => {
  if (!selectedLaneId.value) return null;
  return lanes.value.find((l) => l.id === selectedLaneId.value) || null;
});

const showAutomationCheckbox = computed(() => {
  if (!selectedLane.value) return false;
  return hasAutomation(selectedLane.value);
});

const canMove = computed(() => {
  return selectedLaneId.value && selectedLaneId.value !== props.currentLaneId;
});

// Methods
function hasAutomation(lane) {
  if (!lane) return false;
  return !!(lane.onEnterTemplateId || lane.onEnterPrompt);
}

function close() {
  emit('update:isOpen', false);
  emit('close');
  // Reset state
  selectedLaneId.value = null;
  runOnEnterTemplate.value = true;
}

async function handleMove() {
  if (!canMove.value || !props.cardId) return;

  moving.value = true;
  try {
    await kanbanStore.moveCard(
      props.projectId,
      props.cardId,
      selectedLaneId.value,
      { runOnEnterTemplate: runOnEnterTemplate.value }
    );
    uiStore.success('Card moved successfully');
    emit('moved');
    close();
  } catch (err) {
    console.error('Failed to move card:', err);
    uiStore.error(err.message || 'Failed to move card');
  } finally {
    moving.value = false;
  }
}

// Reset automation checkbox when switching lanes
watch(selectedLaneId, (newLaneId, oldLaneId) => {
  if (newLaneId !== oldLaneId) {
    const newLane = lanes.value.find((l) => l.id === newLaneId);
    // Default to checked if the new lane has automation
    runOnEnterTemplate.value = hasAutomation(newLane);
  }
});

// Watch for isOpen changes to reset state when modal opens
watch(
  () => props.isOpen,
  (isOpen) => {
    if (!isOpen) {
      // State will be reset by close() method
      return;
    }
    // Reset when opening
    selectedLaneId.value = null;
    runOnEnterTemplate.value = true;
  }
);
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--color-background-secondary, #1f2937);
  border-radius: 0.5rem;
  width: 100%;
  max-width: 500px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--color-border);
}

.modal-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text);
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  color: var(--color-text-soft);
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  color: var(--color-text);
}

.modal-body {
  padding: 1.5rem;
  flex: 1;
  overflow-y: auto;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--color-border);
}

.moving-info {
  margin-bottom: 1.5rem;
  padding: 0.75rem;
  background: var(--color-bg-soft, rgba(255, 255, 255, 0.05));
  border-radius: 0.25rem;
}

.moving-label {
  display: block;
  font-size: 0.75rem;
  color: var(--color-text-soft);
  margin-bottom: 0.25rem;
}

.moving-session-name {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  color: var(--color-text-soft);
}

.lanes-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.lane-row {
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  transition: background-color 0.15s, border-color 0.15s;
}

.lane-row:not(.lane-row-disabled):hover {
  background: var(--color-bg-soft);
  border-color: var(--color-primary);
}

.lane-row-current {
  opacity: 0.6;
}

.lane-label {
  display: flex;
  align-items: center;
  padding: 0.75rem;
  cursor: pointer;
  gap: 0.75rem;
  width: 100%;
}

.lane-label input[type="radio"] {
  flex-shrink: 0;
  width: 1rem;
  height: 1rem;
  cursor: pointer;
}

.lane-label input[type="radio"]:disabled {
  cursor: not-allowed;
}

.lane-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
}

.lane-name {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text);
}

.lane-current-badge {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  font-style: italic;
}

.lane-automation-icon {
  color: #f59e0b;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.automation-option {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--color-text);
}

.checkbox-label input[type="checkbox"] {
  width: 1rem;
  height: 1rem;
  cursor: pointer;
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 0.25rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  font-size: 0.9rem;
  transition: opacity 0.2s, background-color 0.2s;
}

.btn-primary {
  background: var(--color-primary);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--color-background);
  border: 1px solid var(--color-border);
  color: var(--color-text);
}

.btn-secondary:hover {
  background: var(--color-background-secondary);
}
</style>
