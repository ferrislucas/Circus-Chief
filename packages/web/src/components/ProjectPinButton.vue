<template>
  <button
    type="button"
    class="project-pin-button"
    :class="{ pinned: project.pinned }"
    :aria-label="project.pinned ? `Unpin ${project.name}` : `Pin ${project.name}`"
    :aria-pressed="project.pinned"
    :aria-busy="pending || undefined"
    :disabled="pending"
    @click.stop="$emit('toggle')"
  >
    <svg
      class="project-pin-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M8 3h8l-1 6 3 3v2H6v-2l3-3-1-6Zm4 11v7" />
    </svg>
  </button>
</template>

<script setup>
defineProps({
  project: { type: Object, required: true },
  pending: { type: Boolean, default: false },
});

defineEmits(['toggle']);
</script>

<style scoped>
.project-pin-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: calc(var(--border-radius) * 0.75);
  color: var(--color-text-soft);
  background: transparent;
  cursor: pointer;
}

.project-pin-button:hover:not(:disabled),
.project-pin-button.pinned {
  color: var(--color-primary);
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
}

.project-pin-button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.project-pin-button:disabled {
  cursor: wait;
  opacity: 0.6;
}

.project-pin-icon {
  width: 1rem;
  height: 1rem;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.project-pin-button.pinned .project-pin-icon {
  fill: currentColor;
}
</style>
