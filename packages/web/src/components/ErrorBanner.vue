<template>
  <div class="error-banner">
    <div class="error-header">
      <span class="error-icon">&#x26A0;&#xFE0F;</span>
      <span class="error-title">Session Error</span>
      <button
        type="button"
        class="btn-icon btn-copy-error"
        @click="copyError"
        title="Copy error message"
      >
        &#x1F4CB;
      </button>
    </div>
    <div class="error-content">
      <pre class="error-message">{{ errorMessage }}</pre>
    </div>
    <p class="error-hint">You can continue the conversation below, or try a different approach.</p>
  </div>
</template>

<script setup>
import { useUiStore } from '../stores/ui.js';

const props = defineProps({
  errorMessage: { type: String, default: 'Unknown error' },
});

const uiStore = useUiStore();

async function copyError() {
  try {
    await navigator.clipboard.writeText(props.errorMessage);
    uiStore.success('Error copied to clipboard');
  } catch (err) {
    uiStore.error('Failed to copy error');
  }
}
</script>

<style scoped>
.error-banner {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: var(--border-radius);
  padding: 1rem;
  margin-bottom: 1rem;
  margin-top: 1rem;
}

.error-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.error-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

.error-title {
  font-weight: 600;
  color: var(--color-danger, #ef4444);
  flex: 1;
}

.btn-copy-error {
  padding: 0.25rem 0.5rem;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.15s;
  font-size: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  min-height: 32px;
}

.btn-copy-error:hover {
  opacity: 1;
  background: var(--color-bg-hover);
}

.btn-copy-error:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error-content {
  background: var(--color-background);
  border-radius: 4px;
  padding: 0.75rem;
  margin-bottom: 0.75rem;
  max-height: 200px;
  overflow-y: auto;
}

.error-message {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, monospace;
  line-height: 1.4;
}

.error-hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--color-text-soft);
}
</style>
