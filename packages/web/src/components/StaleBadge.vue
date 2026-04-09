<template>
  <div
    v-if="isStale"
    class="stale-badge"
    data-testid="stale-badge"
  >
    Content may be outdated
  </div>
</template>

<script setup>
defineProps({
  isStale: { type: Boolean, required: true },
});
</script>

<style scoped>
.stale-badge {
  padding: 0.375rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--color-warning);
  background-color: rgba(210, 153, 34, 0.1);
  border: 1px solid rgba(210, 153, 34, 0.25);
  border-radius: var(--border-radius);
  text-align: center;
  margin-bottom: 0.5rem;
}
</style>
