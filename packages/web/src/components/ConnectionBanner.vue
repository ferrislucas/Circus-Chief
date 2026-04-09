<template>
  <Transition name="banner-slide">
    <div
      v-if="showBanner"
      class="connection-banner"
      :class="bannerClass"
      data-testid="connection-banner"
      role="alert"
    >
      <span
        class="banner-dot"
        :class="dotClass"
      />
      <span class="banner-text">{{ bannerText }}</span>
    </div>
  </Transition>
</template>

<script setup>
import { computed } from 'vue';
import { useConnectionStatus } from '../composables/useConnectionStatus.js';

const { isStale, connectionStatus, reconnectAttempt } = useConnectionStatus();

const showBanner = computed(() => isStale.value);

const bannerClass = computed(() => {
  if (connectionStatus.value === 'reconnecting') return 'banner-warning';
  if (connectionStatus.value === 'disconnected') return 'banner-error';
  return '';
});

const dotClass = computed(() => {
  if (connectionStatus.value === 'reconnecting') return 'dot-pulse';
  return '';
});

const bannerText = computed(() => {
  if (connectionStatus.value === 'reconnecting') {
    const attempt = reconnectAttempt.value;
    return `Connection lost — reconnecting${attempt > 0 ? ` (attempt ${attempt})` : ''}...`;
  }
  return 'Disconnected from server';
});
</script>

<style scoped>
.connection-banner {
  position: sticky;
  top: var(--header-height-computed, 51px);
  z-index: 99;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  font-size: 0.8125rem;
  font-weight: 500;
}

.banner-warning {
  background-color: rgba(210, 153, 34, 0.15);
  border-bottom: 1px solid rgba(210, 153, 34, 0.3);
  color: var(--color-warning);
}

.banner-error {
  background-color: rgba(248, 81, 73, 0.15);
  border-bottom: 1px solid rgba(248, 81, 73, 0.3);
  color: var(--color-error);
}

.banner-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.banner-warning .banner-dot {
  background-color: var(--color-warning);
}

.banner-error .banner-dot {
  background-color: var(--color-error);
}

.dot-pulse {
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* Slide transition */
.banner-slide-enter-active {
  transition: all 0.3s ease-out;
}
.banner-slide-leave-active {
  transition: all 0.2s ease-in;
}
.banner-slide-enter-from {
  transform: translateY(-100%);
  opacity: 0;
}
.banner-slide-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}
</style>
