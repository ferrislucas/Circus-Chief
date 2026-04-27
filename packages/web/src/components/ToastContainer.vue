<template>
  <Teleport to="body">
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          :class="['toast', `toast-${toast.type}`]"
        >
          <span class="toast-icon">
            <span v-if="toast.type === 'success'">&#10003;</span>
            <span v-else-if="toast.type === 'error'">&#10007;</span>
            <span v-else-if="toast.type === 'warning'">&#9888;</span>
            <span v-else>&#8505;</span>
          </span>
          <span class="toast-message">{{ toast.message }}</span>
          <button
            class="toast-close"
            @click="uiStore.removeToast(toast.id)"
          >
            &times;
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup>
import { computed } from 'vue';
import { useUiStore } from '../stores/ui.js';

const uiStore = useUiStore();
const toasts = computed(() => uiStore.toasts);
</script>

<style scoped>
.toast-icon {
  font-size: 1rem;
}

.toast-message {
  flex: 1;
}

.toast-close {
  background: none;
  border: none;
  color: var(--color-text-soft);
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.toast-close:hover {
  color: var(--color-text);
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
</style>
