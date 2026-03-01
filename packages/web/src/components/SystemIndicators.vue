<template>
  <div
    v-if="hasData"
    class="system-indicators"
    data-testid="system-indicators"
  >
    <!-- CPU Indicator -->
    <div
      class="indicator"
      data-testid="indicator-cpu"
      :title="`CPU: ${Math.round(metrics.cpu.usagePercent)}%`"
    >
      <svg class="indicator-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
        <rect x="9" y="9" width="6" height="6"></rect>
        <line x1="9" y1="1" x2="9" y2="4"></line>
        <line x1="15" y1="1" x2="15" y2="4"></line>
        <line x1="9" y1="20" x2="9" y2="23"></line>
        <line x1="15" y1="20" x2="15" y2="23"></line>
        <line x1="20" y1="9" x2="23" y2="9"></line>
        <line x1="20" y1="14" x2="23" y2="14"></line>
        <line x1="1" y1="9" x2="4" y2="9"></line>
        <line x1="1" y1="14" x2="4" y2="14"></line>
      </svg>
      <div class="indicator-bar-track">
        <div
          class="indicator-bar-fill"
          data-testid="indicator-bar-cpu"
          :style="{
            width: `${metrics.cpu.usagePercent}%`,
            backgroundColor: getColorForPercent(metrics.cpu.usagePercent),
          }"
        ></div>
      </div>
    </div>

    <!-- Memory Indicator -->
    <div
      class="indicator"
      data-testid="indicator-memory"
      :title="`RAM: ${metrics.memory.usedGB.toFixed(1)} / ${metrics.memory.totalGB.toFixed(1)} GB`"
    >
      <svg class="indicator-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 19v-3"></path>
        <path d="M10 19v-3"></path>
        <path d="M14 19v-3"></path>
        <path d="M18 19v-3"></path>
        <path d="M8 11V9"></path>
        <path d="M16 11V9"></path>
        <path d="M12 11V9"></path>
        <path d="M2 15h20"></path>
        <path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.837V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.1a2 2 0 0 0 0-3.837Z"></path>
      </svg>
      <div class="indicator-bar-track">
        <div
          class="indicator-bar-fill"
          data-testid="indicator-bar-memory"
          :style="{
            width: `${metrics.memory.usedPercent}%`,
            backgroundColor: getColorForPercent(metrics.memory.usedPercent),
          }"
        ></div>
      </div>
    </div>

    <!-- Disk Indicator (only when disk data is available) -->
    <div
      v-if="metrics.disk"
      class="indicator"
      data-testid="indicator-disk"
      :title="`Disk: ${Math.round(metrics.disk.freeGB)} GB free`"
    >
      <svg class="indicator-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
      </svg>
      <div class="indicator-bar-track">
        <div
          class="indicator-bar-fill"
          data-testid="indicator-bar-disk"
          :style="{
            width: `${metrics.disk.usedPercent}%`,
            backgroundColor: getColorForPercent(metrics.disk.usedPercent),
          }"
        ></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useWebSocket } from '../composables/useWebSocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { getColorForPercent } from '../utils/systemIndicators.js';

const { on, off } = useWebSocket();

const metrics = ref(null);
const hasData = computed(() => metrics.value !== null);

function handleMetrics(message) {
  metrics.value = message;
}

onMounted(() => {
  on(WS_MESSAGE_TYPES.SYSTEM_METRICS, handleMetrics);
});

onUnmounted(() => {
  off(WS_MESSAGE_TYPES.SYSTEM_METRICS, handleMetrics);
});
</script>

<style scoped>
.system-indicators {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  cursor: default;
}

.indicator-icon {
  color: var(--color-text-soft);
  flex-shrink: 0;
}

.indicator-bar-track {
  width: 28px;
  height: 3px;
  background-color: var(--color-background-mute);
  border-radius: 2px;
  overflow: hidden;
}

.indicator-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.5s ease, background-color 0.3s ease;
  max-width: 100%;
}
</style>
