<template>
  <div
    v-if="visible"
    class="conflict-banner"
    role="alert"
  >
    <p v-if="problem">
      {{ problem.message }} Saving is blocked until this is resolved.
    </p>
    <p v-else>
      {{ conflictText }}
    </p>
    <div class="conflict-actions">
      <button
        type="button"
        :class="buttonClass"
        @click="$emit('use-canonical')"
      >
        Use latest
      </button>
      <button
        type="button"
        :class="buttonClass"
        @click="$emit('keep-mine')"
      >
        Keep mine
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  visible: { type: Boolean, default: false },
  problem: { type: Object, default: null },
  conflictText: { type: String, required: true },
  buttonClass: { type: String, default: 'btn btn-secondary' },
});

defineEmits(['use-canonical', 'keep-mine']);
</script>

<style scoped>
.conflict-banner {
  padding: 0.75rem;
  background-color: rgba(234, 179, 8, 0.1);
  border: 1px solid var(--color-warning, #eab308);
  border-radius: var(--border-radius);
  margin-top: 0.5rem;
}

.conflict-banner p { margin: 0 0 0.5rem; }
.conflict-actions { display: flex; gap: 0.5rem; }
</style>
