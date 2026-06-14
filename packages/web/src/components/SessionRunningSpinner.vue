<template>
  <span
    v-if="active"
    class="session-running-spinner active-spinner"
    :title="title"
    aria-label="Workspace running"
  />
</template>

<script setup>
defineProps({
  active: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: 'Workspace running...',
  },
});
</script>

<style scoped>
.session-running-spinner {
  display: inline-block;
  width: 0.75rem;
  height: 0.75rem;
  border: 2px solid rgba(6, 182, 212, 0.3);
  border-top-color: #06b6d4;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
