<template>
  <div
    v-if="isOpen"
    class="modal-backdrop"
    @click.self="$emit('close')"
  >
    <div class="modal-content lane-selector-modal">
      <div class="modal-header">
        <h2 class="modal-title">
          Add to Kanban Board
        </h2>
        <button
          class="close-btn"
          aria-label="Close"
          @click="$emit('close')"
        >
          &times;
        </button>
      </div>
      <div class="modal-body">
        <p class="modal-description">
          Select a lane for "{{ sessionName }}":
        </p>
        <div class="lane-options">
          <button
            v-for="lane in lanes"
            :key="lane.id"
            class="lane-option-btn"
            :class="{ 'lane-option-current': lane.id === currentLaneId }"
            :disabled="lane.id === currentLaneId"
            :aria-current="lane.id === currentLaneId ? 'true' : undefined"
            @click="$emit('select-lane', lane)"
          >
            <span class="lane-option-info">
              <span class="lane-option-name">{{ lane.name }}</span>
              <span
                v-if="lane.id === currentLaneId"
                class="lane-option-current-label"
              >
                Current lane
              </span>
            </span>
            <span class="lane-option-count">{{ lane.cards?.length || 0 }} cards</span>
          </button>
        </div>
        <p
          v-if="!lanes.length"
          class="empty-lanes"
        >
          No lanes available. Go to the Kanban tab to create lanes first.
        </p>
      </div>
      <div class="modal-footer">
        <button
          class="btn btn-secondary"
          @click="$emit('close')"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  sessionName: {
    type: String,
    default: '',
  },
  lanes: {
    type: Array,
    default: () => [],
  },
  currentLaneId: {
    type: String,
    default: null,
  },
});

defineEmits(['close', 'select-lane']);
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
  max-width: 400px;
  max-height: 90vh;
  overflow-y: auto;
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
  font-size: 1.125rem;
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
}

.modal-description {
  margin: 0 0 1rem;
  font-size: 0.9rem;
  color: var(--color-text-soft);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--color-border);
}

.lane-options {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.lane-option-btn {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  color: var(--color-text);
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
}

.lane-option-btn:hover {
  border-color: var(--color-primary);
  background: rgba(34, 197, 255, 0.05);
}

.lane-option-btn:disabled {
  cursor: default;
}

.lane-option-btn:disabled:hover {
  border-color: var(--color-primary);
  background: rgba(34, 197, 255, 0.08);
}

.lane-option-current {
  border-color: var(--color-primary);
  background: rgba(34, 197, 255, 0.08);
}

.lane-option-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.125rem;
}

.lane-option-name {
  font-weight: 500;
}

.lane-option-current-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-primary);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.lane-option-count {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.empty-lanes {
  text-align: center;
  color: var(--color-text-soft);
  font-size: 0.875rem;
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 0.25rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  font-size: 0.9rem;
}
</style>
