<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="modal-backdrop"
      data-testid="system-stat-modal"
      @click.self="close"
      @keydown.escape="handleEscape"
    >
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title" data-testid="stat-detail-title">{{ title }}</h2>
          <button @click="close" class="close-btn" aria-label="Close">&times;</button>
        </div>

        <div class="modal-body">
          <!-- Disk data unavailable fallback -->
          <div v-if="statType === 'disk' && !metrics.disk" class="stat-unavailable">
            Disk data unavailable
          </div>

          <!-- Stat details -->
          <div v-else class="stat-details">
            <!-- Large percentage display -->
            <div
              class="stat-percentage"
              data-testid="stat-detail-percentage"
              :style="{ color: colorForPercent }"
            >
              {{ displayPercentage }}%
            </div>

            <!-- Wide progress bar -->
            <div class="stat-bar-track">
              <div
                class="stat-bar-fill"
                data-testid="stat-detail-bar"
                :style="{
                  width: `${displayPercentage}%`,
                  backgroundColor: colorForPercent,
                }"
              ></div>
            </div>

            <!-- Status badge -->
            <div class="stat-status-row">
              <span
                class="stat-status"
                data-testid="stat-detail-status"
                :style="{ color: colorForPercent }"
              >
                {{ statusLabel }}
              </span>
            </div>

            <!-- Detail rows -->
            <div class="stat-detail-rows">
              <!-- CPU-specific details -->
              <template v-if="statType === 'cpu'">
                <div class="stat-detail-row" data-testid="stat-detail-row-cores">
                  <span class="detail-label">Cores</span>
                  <span class="detail-value">{{ metrics.cpu.coreCount }}</span>
                </div>
                <div class="stat-detail-row" data-testid="stat-detail-row-model">
                  <span class="detail-label">Model</span>
                  <span class="detail-value">{{ metrics.cpu.model }}</span>
                </div>
              </template>

              <!-- Memory-specific details -->
              <template v-if="statType === 'memory'">
                <div class="stat-detail-row" data-testid="stat-detail-row-used">
                  <span class="detail-label">Used</span>
                  <span class="detail-value">{{ metrics.memory.usedGB.toFixed(1) }} GB</span>
                </div>
                <div class="stat-detail-row" data-testid="stat-detail-row-total">
                  <span class="detail-label">Total</span>
                  <span class="detail-value">{{ metrics.memory.totalGB.toFixed(1) }} GB</span>
                </div>
                <div class="stat-detail-row" data-testid="stat-detail-row-free">
                  <span class="detail-label">Free</span>
                  <span class="detail-value">{{ freeMemoryGB.toFixed(1) }} GB</span>
                </div>
              </template>

              <!-- Disk-specific details -->
              <template v-if="statType === 'disk' && metrics.disk">
                <div class="stat-detail-row" data-testid="stat-detail-row-free">
                  <span class="detail-label">Free</span>
                  <span class="detail-value">{{ metrics.disk.freeGB.toFixed(1) }} GB</span>
                </div>
                <div class="stat-detail-row" data-testid="stat-detail-row-total">
                  <span class="detail-label">Total</span>
                  <span class="detail-value">{{ metrics.disk.totalGB.toFixed(1) }} GB</span>
                </div>
                <div class="stat-detail-row" data-testid="stat-detail-row-used">
                  <span class="detail-label">Used</span>
                  <span class="detail-value">{{ usedDiskGB.toFixed(1) }} GB</span>
                </div>
              </template>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button @click="close" class="btn btn-secondary">Close</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue';
import { getColorForPercent } from '../utils/systemIndicators.js';

const props = defineProps({
  isOpen: Boolean,
  statType: {
    type: String,
    validator: (value) => ['cpu', 'memory', 'disk', null].includes(value),
    default: null,
  },
  metrics: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['close']);

// Title based on stat type
const title = computed(() => {
  switch (props.statType) {
    case 'cpu':
      return 'CPU Usage';
    case 'memory':
      return 'Memory Usage';
    case 'disk':
      return 'Disk Usage';
    default:
      return '';
  }
});

// Display percentage based on stat type
const displayPercentage = computed(() => {
  switch (props.statType) {
    case 'cpu':
      return Math.round(props.metrics.cpu.usagePercent * 10) / 10;
    case 'memory':
      return Math.round(props.metrics.memory.usedPercent * 10) / 10;
    case 'disk':
      return props.metrics.disk ? Math.round(props.metrics.disk.usedPercent * 10) / 10 : 0;
    default:
      return 0;
  }
});

// Color for percentage
const colorForPercent = computed(() => getColorForPercent(displayPercentage.value));

// Status label based on thresholds
const statusLabel = computed(() => {
  const percent = displayPercentage.value;
  if (percent >= 80) return 'High';
  if (percent >= 60) return 'Elevated';
  return 'Normal';
});

// Computed values for memory and disk
const freeMemoryGB = computed(() => {
  return props.metrics.memory.totalGB - props.metrics.memory.usedGB;
});

const usedDiskGB = computed(() => {
  if (!props.metrics.disk) return 0;
  return props.metrics.disk.totalGB - props.metrics.disk.freeGB;
});

function close() {
  emit('close');
}

function handleEscape(event) {
  if (event.key === 'Escape' && props.isOpen) {
    close();
  }
}

// Handle Escape key when modal is open
function handleKeyDown(event) {
  if (event.key === 'Escape' && props.isOpen) {
    close();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});
</script>

<style scoped>
/* Modal styles - dark theme */
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
  display: flex;
  flex-direction: column;
  background: var(--color-background-secondary, #1f2937);
  border-radius: 0.5rem;
  width: 100%;
  max-width: 450px;
  max-height: 90vh;
  overflow: hidden;
  border: 1px solid var(--color-border);
}

.modal-header {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--color-border);
}

.modal-title {
  margin: 0;
  font-size: 1.25rem;
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
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 1.5rem;
}

.modal-footer {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--color-border);
}

/* Stat details styles */
.stat-unavailable {
  text-align: center;
  padding: 2rem;
  color: var(--color-text-soft);
  font-size: 1rem;
}

.stat-details {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
}

.stat-percentage {
  font-size: 4rem;
  font-weight: 700;
  line-height: 1;
}

.stat-bar-track {
  width: 100%;
  height: 12px;
  background-color: var(--color-background-mute);
  border-radius: 6px;
  overflow: hidden;
}

.stat-bar-fill {
  height: 100%;
  border-radius: 6px;
  transition: width 0.5s ease, background-color 0.3s ease;
}

.stat-status-row {
  display: flex;
  justify-content: center;
}

.stat-status {
  font-size: 1rem;
  font-weight: 600;
  padding: 0.25rem 0.75rem;
  border-radius: 0.25rem;
  background: rgba(255, 255, 255, 0.05);
}

.stat-detail-rows {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}

.stat-detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.detail-label {
  color: var(--color-text-soft);
  font-size: 0.95rem;
}

.detail-value {
  color: var(--color-text);
  font-weight: 500;
  font-size: 0.95rem;
}

/* Button styles */
.btn {
  padding: 0.5rem 1rem;
  border-radius: 0.25rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  font-size: 0.9rem;
  transition: opacity 0.2s, background-color 0.2s;
}

.btn-secondary {
  background: var(--color-background);
  border: 1px solid var(--color-border);
  color: var(--color-text);
}

.btn-secondary:hover {
  background: var(--color-background-secondary);
}
</style>
