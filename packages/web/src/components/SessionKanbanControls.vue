<template>
  <!-- Star button (icon only) -->
  <button
    class="btn-icon btn-star"
    :title="starred ? 'Unstar workspace' : 'Star workspace'"
    :class="{ 'is-starred': starred }"
    @click="emit('star')"
  >
    <svg
      v-if="starred"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polygon points="12 2 15.09 10.26 24 10.5 17.18 16.34 19.34 24.5 12 18.92 4.66 24.5 6.82 16.34 0 10.5 8.91 10.26 12 2" />
    </svg>
    <svg
      v-else
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polygon points="12 2 15.09 10.26 24 10.5 17.18 16.34 19.34 24.5 12 18.92 4.66 24.5 6.82 16.34 0 10.5 8.91 10.26 12 2" />
    </svg>
  </button>
  <!-- Add to Kanban board -->
  <button
    v-if="showAddToBoard"
    type="button"
    class="add-to-board-btn"
    title="Add to kanban board"
    @click="emit('add-to-board')"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="2"
        ry="2"
      />
      <line
        x1="9"
        y1="3"
        x2="9"
        y2="21"
      />
      <line
        x1="15"
        y1="3"
        x2="15"
        y2="21"
      />
    </svg>
  </button>
  <!-- Kanban lane indicator -->
  <button
    v-if="lane"
    type="button"
    class="lane-chip lane-chip-clickable"
    :title="`Move from ${lane.name} to another lane`"
    @click="emit('open-move')"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="2"
        ry="2"
      />
      <line
        x1="9"
        y1="3"
        x2="9"
        y2="21"
      />
      <line
        x1="15"
        y1="3"
        x2="15"
        y2="21"
      />
    </svg>
    {{ lane.name }}
  </button>
</template>

<script setup>
defineProps({
  /** Whether the session is starred */
  starred: {
    type: Boolean,
    default: false,
  },
  /** Whether to show the "add to board" button */
  showAddToBoard: {
    type: Boolean,
    default: false,
  },
  /** The kanban lane this session is on, or null if not on board */
  lane: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(['star', 'add-to-board', 'open-move']);
</script>

<style scoped>
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

.btn-star {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

.btn-star svg {
  flex-shrink: 0;
}

.btn-star.is-starred {
  color: var(--color-warning, #f0ad4e);
}

.add-to-board-btn {
  background: none;
  border: none;
  padding: 0.25rem;
  cursor: pointer;
  color: var(--color-text-soft);
  border-radius: var(--border-radius);
  transition: color 0.15s, background-color 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.add-to-board-btn:hover {
  color: var(--color-primary);
  background-color: var(--color-bg-soft);
}

.lane-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  background: var(--color-bg-soft, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.lane-chip-clickable {
  cursor: pointer;
  transition: background-color 0.15s;
}

.lane-chip-clickable:hover {
  background: rgba(255, 255, 255, 0.1);
}

.lane-chip svg {
  flex-shrink: 0;
  opacity: 0.7;
}
</style>
