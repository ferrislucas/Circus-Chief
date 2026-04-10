<template>
  <button
    type="button"
    class="slash-command-btn"
    title="Slash Commands"
    data-testid="slash-command-button"
    @click="emit('open')"
  >
    <span class="slash-icon">/</span>
    <span class="slash-text">Commands</span>
  </button>
</template>

<script setup>
const emit = defineEmits(['open']);
</script>

<style scoped>
.slash-command-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.375rem 0.625rem;
  font-size: 0.875rem;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  color: var(--color-text-soft);
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s, color 0.15s;
}

.slash-command-btn:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.slash-icon {
  font-size: 1rem;
  font-weight: 600;
  font-family: ui-monospace, monospace;
}

.slash-text {
  font-size: 0.75rem;
}

/* Mobile responsive */
@media (max-width: 480px) {
  .slash-text {
    display: none;
  }

  .slash-command-btn {
    padding: 0.375rem;
  }
}
</style>
