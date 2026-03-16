<template>
  <div class="split-divider" data-testid="split-view-divider">
    <div class="split-divider-buttons">
      <button
        v-for="opt in modes"
        :key="opt.id"
        :class="['split-mode-btn', { active: mode === opt.id }]"
        :data-testid="`split-mode-${opt.id}`"
        :title="`${opt.label} (${opt.shortcut})`"
        @click="$emit('update:mode', opt.id)"
      >
        <svg v-if="opt.id === 'split'" class="split-mode-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
          <!-- Split icon: two horizontal sections -->
          <rect x="1" y="1" width="12" height="5" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
          <rect x="1" y="8" width="12" height="5" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
        </svg>
        <svg v-else-if="opt.id === 'workLogs'" class="split-mode-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
          <!-- Logs icon: stacked lines -->
          <path d="M2 3h10M2 7h10M2 11h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span class="split-mode-label">{{ opt.label }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue';

const props = defineProps({
  mode: { type: String, default: 'split' }, // 'split' | 'workLogs'
});

const emit = defineEmits(['update:mode']);

// Mode options
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const modKey = isMac ? '\u21E7\u2318' : 'Ctrl+Shift+';

const modes = [
  { id: 'split', label: 'Split', shortcut: `${modKey}1` },
  { id: 'workLogs', label: 'Logs', shortcut: `${modKey}2` },
];

// Keyboard shortcuts: Cmd/Ctrl+Shift+1/2
function handleKeydown(e) {
  if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
  const modeMap = { '1': 'split', '2': 'workLogs' };
  const mode = modeMap[e.key];
  if (mode) {
    e.preventDefault();
    emit('update:mode', mode);
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<style scoped>
.split-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  flex-shrink: 0;
  background: var(--color-background-soft);
  position: relative;
}

/* Gradient borders - fade at edges for a floating feel */
.split-divider::before,
.split-divider::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    var(--color-border) 15%,
    var(--color-border) 85%,
    transparent
  );
}
.split-divider::before { top: 0; }
.split-divider::after { bottom: 0; }

.split-divider-buttons {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.split-mode-btn {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.125rem 0.75rem;
  min-height: 24px;
  min-width: 44px; /* Touch target */
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-soft);
  cursor: pointer;
  font-size: 0.75rem;
  transition: color 0.15s, background 0.15s;
}

/* Active indicator: subtle background fill */
.split-mode-btn.active {
  color: var(--color-primary);
  background: rgba(88, 166, 255, 0.08);
}

.split-mode-btn:hover:not(.active) {
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text);
}

.split-mode-btn:active {
  transform: scale(0.97);
}

.split-mode-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

/* Icon-only on small screens (matches Tailwind sm breakpoint at 640px) */
@media (max-width: 639px) {
  .split-mode-label { display: none; }
}

/* Entrance animation */
@keyframes dividerEntrance {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.split-divider.animate-entrance {
  animation: dividerEntrance 0.2s ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .split-divider.animate-entrance { animation: none; }
}
</style>
