<template>
  <div class="changes-tab">
    <div v-if="loading" class="loading-state">
      <span class="loading-spinner"></span>
      Loading changes...
    </div>

    <div v-else-if="error" class="error-message">
      {{ error }}
    </div>

    <div v-else-if="!hasChanges" class="empty-state">
      <p>No git changes to show.</p>
    </div>

    <template v-else>
      <div v-if="staged" class="diff-section">
        <h3>Staged Changes</h3>
        <pre class="diff-content">{{ staged }}</pre>
      </div>

      <div v-if="unstaged" class="diff-section">
        <h3>Unstaged Changes</h3>
        <pre class="diff-content">{{ unstaged }}</pre>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';

const _props = defineProps({
  sessionId: { type: String, required: true },
});

const sessionsStore = useSessionsStore();

const staged = ref('');
const unstaged = ref('');
const loading = ref(false);
const error = ref(null);

const hasChanges = computed(() => staged.value || unstaged.value);

onMounted(async () => {
  if (!sessionsStore.currentSession?.gitWorktree) {
    return;
  }

  loading.value = true;
  try {
    // In a real implementation, this would call the diff service
    // For now, we'll just show a placeholder
    staged.value = '';
    unstaged.value = '';
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.changes-tab {
  padding: 1rem 0;
}

.loading-state {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
  padding: 2rem;
}

.error-message {
  color: var(--color-error);
  padding: 1rem;
  background-color: rgba(248, 81, 73, 0.1);
  border-radius: var(--border-radius);
}

.empty-state {
  text-align: center;
  padding: 2rem;
  color: var(--color-text-soft);
}

.diff-section {
  margin-bottom: 1.5rem;
}

.diff-section h3 {
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
  color: var(--color-text-soft);
}

.diff-content {
  font-size: 0.75rem;
  max-height: 300px;
  overflow: auto;
}
</style>
